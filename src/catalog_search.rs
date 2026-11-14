//! Public Spotify metadata via XWolf. No account tokens or token endpoint.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::{fs, path::Path};

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn cached_result(items: &[Value], query: &str) -> Result<Value, String> {
    let raw: Vec<Value> = items
        .iter()
        .filter_map(|item| {
            let id = item["uri"].as_str()?.strip_prefix("spotify:track:")?;
            let mut entry = item.clone();
            entry["id"] = json!(id);
            Some(entry)
        })
        .collect();
    normalize(&json!({"success":true,"results":raw}), query)
}

// Only public metadata is cached, inside the current user's profile. Never tokens or audio URLs.
pub fn search_cached(query: &str, directory: &Path) -> Result<Value, String> {
    with_cache(query, directory, search)
}

fn with_cache(
    query: &str,
    directory: &Path,
    mut fetch: impl FnMut(&str) -> Result<Value, String>,
) -> Result<Value, String> {
    let path = directory.join("runtime/catalog-cache.json");
    let mut cache: Vec<Value> = fs::metadata(&path)
        .ok()
        .filter(|m| m.len() <= 2_000_000)
        .and_then(|_| fs::read(&path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let key = query.trim().to_lowercase();
    cache.retain(|entry| now().saturating_sub(entry["saved"].as_u64().unwrap_or(0)) <= 7 * 86400);
    cache.truncate(24);
    let saved = cache
        .iter()
        .find(|entry| entry["key"] == key)
        .and_then(|entry| entry["items"].as_array())
        .and_then(|items| cached_result(items, query).ok());
    let mut result = fetch(query);
    // One bounded retry for transient upstream failures. Authentication/rate limits are not retried.
    if saved.is_none()
        && result.as_ref().is_err_and(|e| {
            ["HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504"]
                .iter()
                .any(|status| e.contains(status))
        })
    {
        std::thread::sleep(std::time::Duration::from_millis(350));
        result = fetch(query);
    }
    match result {
        Ok(result) => {
            cache.retain(|entry| entry["key"] != key);
            cache.insert(0, json!({"key":key,"saved":now(),"items":result["items"]}));
            cache.truncate(24);
            if let (Some(parent), Ok(bytes)) = (path.parent(), serde_json::to_vec(&cache)) {
                if bytes.len() <= 2_000_000 && fs::create_dir_all(parent).is_ok() {
                    let temporary = path.with_extension("tmp");
                    let _ =
                        fs::write(&temporary, bytes).and_then(|()| fs::rename(temporary, &path));
                }
            }
            Ok(result)
        }
        Err(error) => match saved {
            Some(mut result) => {
                result["via"] = json!("cache");
                result["degraded"] = json!(true);
                result["warning"] = json!("O catálogo está temporariamente indisponível. Mostrando resultados salvos desta busca.");
                Ok(result)
            }
            None => Err(error),
        },
    }
}

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
        if artists.is_empty() { artists=entry["artists"].as_str().unwrap_or("").chars().take(300).collect(); }
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
    fn fixture() -> Value {
        normalize(&json!({"success":true,"results":[{"id":"4uLU6hMCjMI75M1A2tKUQC","title":"Song","artists":["Singer"],"thumbnail":"https://i.scdn.co/image/test"}]}), "song").unwrap()
    }
    #[test]
    fn transient_failure_is_retried_once_and_rate_limit_is_not() {
        let directory =
            std::env::temp_dir().join(format!("noise-catalog-retry-{}", crate::model::now_ms()));
        let mut calls = 0;
        let result = with_cache("song", &directory, |_| {
            calls += 1;
            if calls == 1 {
                Err("HTTP 500".into())
            } else {
                Ok(fixture())
            }
        })
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(result["via"], "XWolf");
        let mut limited = 0;
        assert!(with_cache("other", &directory, |_| {
            limited += 1;
            Err("HTTP 429".into())
        })
        .is_err());
        assert_eq!(limited, 1);
        let _ = fs::remove_dir_all(directory);
    }
    #[test]
    fn cache_survives_restart_preserves_identity_and_expires() {
        let directory =
            std::env::temp_dir().join(format!("noise-catalog-cache-{}", crate::model::now_ms()));
        with_cache("song", &directory, |_| Ok(fixture())).unwrap();
        let mut calls = 0;
        let result = with_cache("SONG", &directory, |_| {
            calls += 1;
            Err("HTTP 500".into())
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(result["via"], "cache");
        assert_eq!(result["degraded"], true);
        assert_eq!(result["query"], "SONG");
        assert_eq!(result["items"][0]["artists"], "Singer");
        assert_eq!(result["items"][0]["uri"], fixture()["items"][0]["uri"]);
        assert_eq!(
            result["items"][0]["thumbnail"],
            fixture()["items"][0]["thumbnail"]
        );
        assert!(with_cache("unrelated", &directory, |_| Err("offline".into())).is_err());
        let path = directory.join("runtime/catalog-cache.json");
        let mut cache: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        cache[0]["saved"] = json!(now() - 8 * 86400);
        fs::write(&path, serde_json::to_vec(&cache).unwrap()).unwrap();
        assert!(with_cache("song", &directory, |_| Err("offline".into())).is_err());
        fs::write(&path, b"not json").unwrap();
        assert!(with_cache("song", &directory, |_| Err("offline".into())).is_err());
        let _ = fs::remove_dir_all(directory);
    }
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
