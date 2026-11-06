//! Music library, public catalog search and native playback orchestration.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Default, Serialize, Deserialize)]
struct Library {
    entries: Vec<Entry>,
    collections: Vec<Collection>,
    next_id: u64,
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    uri: String,
    url: String,
    kind: String,
    title: String,
    #[serde(default)]
    artists: String,
    thumbnail: String,
    favorite: bool,
    collection: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Collection {
    id: u64,
    name: String,
    #[serde(default)]
    uris: Vec<String>,
}
pub struct Spotify {
    path: PathBuf,
    library: Library,
    music: crate::music::Music,
    account: crate::spotify_account::Account,
    playlists: crate::playlist::Catalog,
    covers: crate::covers::Covers,
    search: crate::music_search::Search,
}

pub fn normalize_link(input: &str) -> Result<(String, String, String), String> {
    let input = input.trim();
    let (kind, id) = if input.starts_with("spotify:") {
        let parts: Vec<_> = input.split(':').collect();
        if parts.len() != 3 {
            return Err("URI do Spotify inválida.".into());
        }
        (parts[1].to_owned(), parts[2].to_owned())
    } else {
        let url = url::Url::parse(input.trim()).map_err(|_| "Cole um link completo do Spotify.")?;
        if url.scheme() != "https"
            || url.host_str() != Some("open.spotify.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return Err("Use um link https://open.spotify.com/.".into());
        }
        let mut parts: Vec<_> = url
            .path_segments()
            .ok_or("Link inválido.")?
            .filter(|s| !s.is_empty())
            .collect();
        if parts.first().is_some_and(|s| s.starts_with("intl-")) {
            parts.remove(0);
        }
        if parts.len() != 2 {
            return Err("Este link não aponta para um item do Spotify.".into());
        }
        (parts[0].to_owned(), parts[1].to_owned())
    };
    if !["track", "album", "artist", "playlist", "show", "episode"].contains(&kind.as_str())
        || id.len() != 22
        || !id.bytes().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("Tipo ou identificador Spotify inválido.".into());
    }
    Ok((
        format!("spotify:{kind}:{id}"),
        format!("https://open.spotify.com/{kind}/{id}"),
        kind,
    ))
}

impl Spotify {
    pub fn new(directory: &Path) -> Result<Self, String> {
        let path = directory.join("library.json");
        let mut library: Library = match fs::read(&path) {
            Ok(bytes) if bytes.len() <= 524288 => serde_json::from_slice(&bytes)
                .map_err(|_| "Biblioteca inválida; o arquivo foi preservado.".to_string())?,
            Ok(_) => return Err("A biblioteca excede 512 KB e foi preservada.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Library {
                next_id: 1,
                ..Library::default()
            },
            Err(e) => return Err(e.to_string()),
        };
        // Preserve memberships from profiles written before multi-playlist support.
        for entry in &library.entries {
            if let Some(collection) = library
                .collections
                .iter_mut()
                .find(|collection| Some(collection.id) == entry.collection)
            {
                if !collection.uris.contains(&entry.uri) {
                    collection.uris.push(entry.uri.clone());
                }
            }
        }
        Ok(Self {
            path,
            library,
            music: crate::music::Music::new(directory)?,
            account: crate::spotify_account::Account::new(),
            playlists: crate::playlist::Catalog::new(directory),
            covers: crate::covers::Covers::new(directory),
            search: crate::music_search::Search::new(directory),
        })
    }
    fn merge_account(&mut self, items: Vec<Value>) -> Result<(), String> {
        let mut next = self.library.clone();
        for item in items {
            let Ok((uri, url, kind)) = normalize_link(item["uri"].as_str().unwrap_or("")) else {
                continue;
            };
            let Some(title) = item["title"].as_str() else {
                continue;
            };
            let title = title.chars().take(300).collect();
            let favorite = item["favorite"].as_bool().unwrap_or(false);
            let thumbnail = item["thumbnail"]
                .as_str()
                .filter(|s| safe_artwork(s))
                .unwrap_or("")
                .to_owned();
            if let Some(entry) = next.entries.iter_mut().find(|e| e.uri == uri) {
                entry.title = title;
                entry.thumbnail = thumbnail;
                entry.favorite |= favorite;
            } else if next.entries.len() < 1000 {
                next.entries.push(Entry {
                    artists: String::new(),
                    uri,
                    url,
                    kind,
                    title,
                    thumbnail,
                    favorite,
                    collection: None,
                });
            } else {
                return Err("A importação excedeu o limite de 1000 links. A biblioteca existente foi preservada.".into());
            }
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if bytes.len() > 524288 {
            return Err("Importação excedeu 512 KB; biblioteca existente preservada.".into());
        }
        let temp = self.path.with_extension("tmp");
        fs::write(&temp, bytes)
            .and_then(|()| fs::rename(temp, &self.path))
            .map_err(|e| e.to_string())?;
        self.library = next;
        Ok(())
    }
    fn snapshot(&mut self) -> Value {
        self.music.sync_artwork(self.covers.poll());
        if let Some(items) = self.account.take_imports() {
            if let Err(error) = self.merge_account(items) {
                self.account.fail_import(error);
            }
        }
        let installed = |variable: &str, suffix: &str| {
            std::env::var_os(variable).is_some_and(|p| PathBuf::from(p).join(suffix).is_file())
        };
        let mut result = json!({"entries":self.library.entries,"collections":self.library.collections,"playback_available":false,"local_playback_available":true,"spotify_installed":installed("APPDATA","Spotify/Spotify.exe"),"search_available":crate::components::executable("yt-dlp").is_some(),"spicetify_installed":installed("LOCALAPPDATA","spicetify/spicetify.exe"),"mode":"local_library","account_connected":false});
        if let (Some(result), Some(music)) =
            (result.as_object_mut(), self.music.snapshot().as_object())
        {
            result.extend(music.clone());
        }
        result["playlist"] = self.playlists.snapshot();
        result["search"] = self.search.snapshot();
        if let Some(object) = result.as_object_mut() {
            object.extend(self.covers.snapshot().as_object().unwrap().clone());
        }
        let account = self.account.snapshot();
        result["account_connected"] = account["connected"].clone();
        result["account"] = account;
        result
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        if method == "search" {
            self.search
                .request(params["query"].as_str().unwrap_or(""))?;
            return Ok(self.snapshot());
        }
        if method == "import_search" {
            let track = self.search.track(params["uri"].as_str().unwrap_or(""))?;
            let mut next = self.library.clone();
            if !next.entries.iter().any(|entry| entry.uri == track["uri"]) {
                if next.entries.len() >= 1000 {
                    return Err("Sua biblioteca atingiu o limite de itens.".into());
                }
                next.entries.insert(
                    0,
                    Entry {
                        uri: track["uri"].as_str().unwrap().into(),
                        url: track["url"].as_str().unwrap().into(),
                        title: track["title"].as_str().unwrap().into(),
                        artists: track["artists"].as_str().unwrap_or("").into(),
                        kind: "track".into(),
                        thumbnail: track["thumbnail"].as_str().unwrap_or("").into(),
                        favorite: false,
                        collection: None,
                    },
                );
            }
            let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
            if bytes.len() > 512 * 1024 {
                return Err("A biblioteca atingiu o limite de tamanho.".into());
            }
            let temp = self.path.with_extension("tmp");
            fs::write(&temp, bytes)
                .and_then(|()| fs::rename(temp, &self.path))
                .map_err(|e| e.to_string())?;
            self.library = next;
            if params["download"].as_bool() == Some(true) {
                self.music
                    .handle("download", &json!({"url":track["uri"],"total_tracks":1}))?;
            }
            return Ok(self.snapshot());
        }
        if method == "open_playlist" {
            self.playlists.open(
                params["uri"].as_str().unwrap_or(""),
                params["refresh"].as_bool().unwrap_or(false),
            )?;
            return Ok(self.snapshot());
        }
        if method == "artwork" {
            let accepted = self.covers.request(params);
            let mut result = self.snapshot();
            result["artwork_requests"] = json!(accepted);
            return Ok(result);
        }
        if method == "playback_status" {
            self.music.sync_artwork(self.covers.poll());
            if self.account.has_imports() {
                return Ok(self.snapshot());
            }
            let mut result = self.music.snapshot_since(params["revision"].as_u64());
            result["search"] = self.search.snapshot();
            result["playlist"] = self.playlists.snapshot();
            if params["artwork_revision"].as_u64() != Some(self.covers.revision()) {
                if let Some(object) = result.as_object_mut() {
                    object.extend(self.covers.snapshot().as_object().unwrap().clone());
                }
            }
            let account = self.account.snapshot();
            result["account_connected"] = account["connected"].clone();
            result["account"] = account;
            return Ok(result);
        }
        if matches!(
            method,
            "account_begin" | "account_import" | "account_disconnect"
        ) {
            self.account.handle(method)?;
            return Ok(self.snapshot());
        }
        if matches!(method, "hello" | "list" | "status") {
            return Ok(self.snapshot());
        }
        if matches!(
            method,
            "download"
                | "cancel_download"
                | "scan_local"
                | "delete_local"
                | "play_local"
                | "pause"
                | "resume"
                | "stop"
                | "seek"
                | "volume"
                | "presence_config"
        ) {
            self.music.handle(method, params)?;
            return Ok(self.snapshot());
        }
        let mut next = self.library.clone();
        match method {
            "import_link" | "save_link" => {
                let (uri, url, kind) = normalize_link(params["url"].as_str().unwrap_or(""))?;
                let (title, thumbnail) = if method == "import_link" {
                    let data = fetch_metadata(&url)?;
                    if data["provider_name"].as_str() != Some("Spotify") {
                        return Err("Resposta de metadados inesperada.".into());
                    }
                    let title = data["title"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .ok_or("O Spotify não retornou o título deste item.")?
                        .chars()
                        .take(300)
                        .collect();
                    let thumbnail = data["thumbnail_url"]
                        .as_str()
                        .filter(|s| safe_artwork(s))
                        .unwrap_or("")
                        .to_owned();
                    (title, thumbnail)
                } else {
                    (
                        params["title"]
                            .as_str()
                            .unwrap_or("Link salvo")
                            .chars()
                            .take(300)
                            .collect(),
                        String::new(),
                    )
                };
                if let Some(entry) = next.entries.iter_mut().find(|e| e.uri == uri) {
                    entry.title = title;
                    entry.thumbnail = thumbnail;
                } else {
                    if next.entries.len() >= 1000 {
                        return Err("O limite inicial é de 1000 itens.".into());
                    }
                    next.entries.insert(
                        0,
                        Entry {
                            artists: String::new(),
                            uri,
                            url,
                            kind,
                            title,
                            thumbnail,
                            favorite: false,
                            collection: None,
                        },
                    );
                }
            }
            "favorite" | "remove" | "set_collection" => {
                let uri = params["uri"].as_str().ok_or("Selecione um item.")?;
                if method == "remove" {
                    next.entries.retain(|e| e.uri != uri);
                    for collection in &mut next.collections {
                        collection.uris.retain(|item| item != uri);
                    }
                } else {
                    let collection = params["collection"].as_u64();
                    if method == "set_collection"
                        && collection.is_some_and(|id| !next.collections.iter().any(|c| c.id == id))
                    {
                        return Err("Coleção inexistente.".into());
                    }
                    let entry = next
                        .entries
                        .iter_mut()
                        .find(|e| e.uri == uri)
                        .ok_or("Item inexistente.")?;
                    if method == "favorite" {
                        entry.favorite = !entry.favorite;
                    } else {
                        entry.collection = collection;
                        if collection.is_none() {
                            for list in &mut next.collections {
                                list.uris.retain(|item| item != uri);
                            }
                        }
                        if let Some(collection) = next
                            .collections
                            .iter_mut()
                            .find(|c| Some(c.id) == collection)
                        {
                            if !collection.uris.iter().any(|item| item == uri) {
                                collection.uris.push(uri.into());
                            }
                        }
                    }
                }
            }
            "create_collection" => {
                let name = params["name"].as_str().unwrap_or("").trim();
                if name.is_empty() || name.chars().count() > 60 || next.collections.len() >= 200 {
                    return Err(
                        "Informe um nome de até 60 caracteres (máximo 200 playlists).".into(),
                    );
                }
                let id = next.next_id.max(1);
                next.next_id = id.checked_add(1).ok_or("Limite de coleções.")?;
                next.collections.push(Collection {
                    id,
                    name: name.into(),
                    uris: Vec::new(),
                });
            }
            "rename_collection" => {
                let id = params["id"].as_u64().ok_or("Playlist inválida.")?;
                let name = params["name"].as_str().unwrap_or("").trim();
                if name.is_empty() || name.chars().count() > 60 {
                    return Err("Use um nome entre 1 e 60 caracteres.".into());
                }
                next.collections
                    .iter_mut()
                    .find(|c| c.id == id)
                    .ok_or("Playlist não encontrada.")?
                    .name = name.into();
            }
            "remove_from_collection" => {
                let id = params["id"].as_u64().ok_or("Playlist inválida.")?;
                let uri = params["uri"].as_str().ok_or("Música inválida.")?;
                next.collections
                    .iter_mut()
                    .find(|c| c.id == id)
                    .ok_or("Playlist não encontrada.")?
                    .uris
                    .retain(|value| value != uri);
                for entry in &mut next.entries {
                    if entry.uri == uri && entry.collection == Some(id) {
                        entry.collection = None;
                    }
                }
            }
            "delete_collection" => {
                let id = params["id"].as_u64().ok_or("Coleção inválida.")?;
                next.collections.retain(|c| c.id != id);
                for entry in &mut next.entries {
                    if entry.collection == Some(id) {
                        entry.collection = None;
                    }
                }
            }
            _ => {
                return Err(
                    "Operação não disponível. Reprodução interna ainda não implementada.".into(),
                )
            }
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if bytes.len() > 524288 {
            return Err("A biblioteca atingiu o limite de 512 KB.".into());
        }
        use std::io::Write;
        let temporary = self.path.with_extension("tmp");
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        self.library = next;
        Ok(self.snapshot())
    }
}
pub(crate) fn safe_artwork(input: &str) -> bool {
    url::Url::parse(input).is_ok_and(|u| {
        u.scheme() == "https"
            && matches!(
                u.host_str(),
                Some(
                    "i.scdn.co"
                        | "i.ytimg.com"
                        | "mosaic.scdn.co"
                        | "image-cdn-ak.spotifycdn.com"
                        | "image-cdn-fa.spotifycdn.com"
                )
            )
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
    })
}

#[cfg(windows)]
pub(crate) fn fetch_metadata(item_url: &str) -> Result<Value, String> {
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
    let mut endpoint = url::Url::parse("https://open.spotify.com/oembed").unwrap();
    endpoint.query_pairs_mut().append_pair("url", item_url);
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
        WinHttpSetTimeouts(session.0, 1500, 1500, 1500, 1500).map_err(|e| e.to_string())?;
        let connection = checked(WinHttpConnect(session.0, w!("open.spotify.com"), 443, 0))?;
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
                "O Spotify não respondeu. Tente novamente ou salve o link sem metadados."
                    .to_string()
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
                "O Spotify retornou HTTP {status}. Nenhum item foi adicionado."
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
            if bytes.len() > 65536 || started.elapsed().as_secs() > 5 {
                return Err("Resposta de metadados excedeu o limite.".into());
            }
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "Metadados inválidos recebidos do Spotify.".into())
    }
}
#[cfg(not(windows))]
fn fetch_metadata(_: &str) -> Result<Value, String> {
    Err("Importação online disponível no Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_are_canonical_and_cannot_target_other_services() {
        let id = "4uLU6hMCjMI75M1A2tKUQC";
        assert_eq!(
            normalize_link(&format!(
                "https://open.spotify.com/intl-pt/track/{id}?si=private"
            ))
            .unwrap()
            .0,
            format!("spotify:track:{id}")
        );
        for bad in [
            "https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC",
            "spotify:track:../x",
            "file:///secret",
            "https://user@open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        ] {
            assert!(normalize_link(bad).is_err())
        }
    }
    #[test]
    fn local_library_survives_restart_and_invalid_operations() {
        let dir = std::env::temp_dir().join(format!(
            "mare-spotify-test-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        let url = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
        app.handle("save_link", &json!({"url":url,"title":"Own fixture"}))
            .unwrap();
        app.handle("create_collection", &json!({"name":"Local"}))
            .unwrap();
        let uri = normalize_link(url).unwrap().0;
        app.handle("favorite", &json!({"uri":uri})).unwrap();
        app.handle("set_collection", &json!({"uri":uri,"collection":1}))
            .unwrap();
        assert!(app
            .handle("set_collection", &json!({"uri":uri,"collection":999}))
            .is_err());
        app.handle("create_collection", &json!({"name":"Second"}))
            .unwrap();
        app.handle("set_collection", &json!({"uri":uri,"collection":2}))
            .unwrap();
        app.handle("remove_from_collection", &json!({"uri":uri,"id":2}))
            .unwrap();
        app.handle("set_collection", &json!({"uri":uri,"collection":1}))
            .unwrap();
        let playlists = app.handle("list", &json!({})).unwrap();
        assert_eq!(playlists["collections"][0]["uris"][0], uri);
        assert_eq!(
            playlists["collections"][1]["uris"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        drop(app);
        let mut restored = Spotify::new(&dir).unwrap();
        let result = restored.handle("list", &json!({})).unwrap();
        assert_eq!(result["entries"][0]["favorite"], true);
        assert_eq!(result["entries"][0]["collection"], 1);
        assert_eq!(result["playback_available"], false);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn legacy_playlist_membership_survives_adding_another_playlist() {
        let dir = std::env::temp_dir().join(format!(
            "mare-playlist-migration-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
        let legacy = json!({"entries":[{"uri":uri,"url":"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC","kind":"track","title":"Legacy fixture","thumbnail":"","favorite":true,"collection":1}],"collections":[{"id":1,"name":"Existing"},{"id":2,"name":"Second"}],"next_id":3});
        fs::write(dir.join("library.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        app.handle("set_collection", &json!({"uri":uri,"collection":2}))
            .unwrap();
        drop(app);
        let mut app = Spotify::new(&dir).unwrap();
        let result = app.handle("list", &json!({})).unwrap();
        assert_eq!(result["collections"][0]["uris"][0], uri);
        assert_eq!(result["collections"][1]["uris"][0], uri);
        assert_eq!(result["entries"][0]["favorite"], true);
        drop(app);
        fs::remove_dir_all(dir).unwrap();
    }

}
