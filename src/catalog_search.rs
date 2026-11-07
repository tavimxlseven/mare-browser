//! Public Spotify metadata via XWolf. No account tokens or token endpoint.
use serde_json::{json, Value};
use std::collections::HashSet;

fn normalize(data: &Value, query: &str) -> Result<Value, String> {
    if data["success"] != true {
        return Err("O catálogo Spotify está indisponível. Tente novamente.".into());
    }
    let results = data["results"]
        .as_array()
        .ok_or("Resposta de catálogo inválida.")?;
    let mut ids = HashSet::new();
    let items: Vec<Value> = results.iter().take(50).filter_map(|entry| {
        let id = entry["id"].as_str()?;
        let (uri, url, _) = crate::spotify::normalize_link(&format!("spotify:track:{id}")).ok()?;
        if !ids.insert(uri.clone()) { return None; }
        let title = entry["title"].as_str()?.trim().chars().take(300).collect::<String>();
        if title.is_empty() { return None; }
        let mut artists = entry["artists"].as_array().into_iter().flatten().take(10).filter_map(|a|a.as_str().or(a["name"].as_str())).map(|a|a.chars().take(100).collect::<String>()).collect::<Vec<_>>().join(", ");
        if artists.is_empty() { artists=entry["artist"].as_str().unwrap_or("").chars().take(300).collect(); }
        let thumbnail = entry["thumbnail"].as_str().filter(|url| crate::spotify::safe_artwork(url) && !url.contains("ytimg.com")).unwrap_or("");
        Some(json!({"uri":uri,"url":url,"kind":"track","title":title,"artists":artists,"thumbnail":thumbnail,"album":entry["album"].as_str().unwrap_or("").chars().take(300).collect::<String>(),"duration_ms":entry["duration_ms"].as_u64().unwrap_or(0).min(86_400_000)}))
    }).take(25).collect();
    if !results.is_empty() && items.is_empty() {
        return Err("O catálogo não retornou faixas válidas.".into());
    }
    Ok(json!({"state":"ready","provider":"Spotify","via":"XWolf","query":query,"items":items}))
}

#[cfg(windows)]
pub fn search(query: &str) -> Result<Value, String> {
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::Networking::WinHttp::*,
    };
    struct Handle(*mut std::ffi::c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = WinHttpCloseHandle(self.0);
            }
        }
    }
    let checked = |p: *mut std::ffi::c_void| {
        if p.is_null() {
            Err("Não foi possível conectar ao Spotify.".to_string())
        } else {
            Ok(Handle(p))
        }
    };
    let mut endpoint = url::Url::parse("https://spotify.xwolf.space/api/search").unwrap();
    endpoint
        .query_pairs_mut()
        .append_pair("q", query)
        .append_pair("type", "track")
        .append_pair("limit", "25");
    let target = HSTRING::from(format!(
        "{}?{}",
        endpoint.path(),
        endpoint.query().unwrap_or("")
    ));
    // Handles are private to this synchronous worker request. TLS validation stays enabled.
    unsafe {
        let session = checked(WinHttpOpen(
            w!("MareSpotify/0.1"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 3000, 3000, 3000, 3000).map_err(|e| e.to_string())?;
        let connection = checked(WinHttpConnect(session.0, w!("spotify.xwolf.space"), 443, 0))?;
        let request = checked(WinHttpOpenRequest(
            connection.0,
            w!("GET"),
            &target,
            PCWSTR::null(),
            PCWSTR::null(),
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        ))?;
        WinHttpSetOption(
            Some(request.0.cast_const()),
            WINHTTP_OPTION_REDIRECT_POLICY,
            Some(&WINHTTP_OPTION_REDIRECT_POLICY_NEVER.to_ne_bytes()),
        )
        .map_err(|e| e.to_string())?;
        WinHttpSendRequest(request.0, None, None, 0, 0, 0)
            .and_then(|()| WinHttpReceiveResponse(request.0, std::ptr::null_mut()))
            .map_err(|_| {
                "O catálogo Spotify via XWolf não respondeu. Tente novamente.".to_string()
            })?;
        let mut status = 0u32;
        let mut size = 4u32;
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut size,
            std::ptr::null_mut(),
        )
        .map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(format!(
                "O catálogo via XWolf retornou HTTP {status}. Tente novamente."
            ));
        }
        let mut bytes = Vec::new();
        let started = std::time::Instant::now();
        loop {
            let mut buffer = [0u8; 4096];
            let mut read = 0;
            WinHttpReadData(
                request.0,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                &mut read,
            )
            .map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..read as usize]);
            if bytes.len() > 1_048_576 || started.elapsed().as_secs() > 12 {
                return Err("Resposta de metadados excedeu o limite.".into());
            }
        }
        let data: Value =
            serde_json::from_slice(&bytes).map_err(|_| "O catálogo retornou JSON inválido.")?;
        normalize(&data, query)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_has_canonical_spotify_identity_and_safe_artwork() {
        let id = "4uLU6hMCjMI75M1A2tKUQC";
        let raw = json!({"success":true,"results":[{"id":id,"title":"Song","artists":["Singer"],"url":"https://evil.example/","thumbnail":"https://i.scdn.co/image/test","duration_ms":200000},{"id":id,"title":"Duplicate"},{"id":"../../bad","title":"Bad"}]});
        let result = normalize(&raw, "song").unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"][0]["uri"], format!("spotify:track:{id}"));
        assert_eq!(
            result["items"][0]["url"],
            format!("https://open.spotify.com/track/{id}")
        );
        assert_eq!(result["items"][0]["artists"], "Singer");
        assert_eq!(
            result["items"][0]["thumbnail"],
            "https://i.scdn.co/image/test"
        );
    }
    #[test]
    fn unavailable_or_malformed_catalog_is_not_an_empty_success() {
        assert!(normalize(&json!({"success":false}), "q").is_err());
        assert!(normalize(&json!({"success":true}), "q").is_err());
        assert!(normalize(
            &json!({"success":true,"results":[{"id":"bad","title":"x"}]}),
            "q"
        )
        .is_err());
        assert_eq!(
            normalize(&json!({"success":true,"results":[]}), "q").unwrap()["items"],
            json!([])
        );
    }
}
