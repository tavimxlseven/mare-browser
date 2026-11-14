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
    #[serde(default)]
    playlist_additions: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    playlist_orders: std::collections::BTreeMap<String, Vec<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    #[serde(default)]
    cloud_owned: bool,
    #[serde(default)]
    duration_ms: u64,
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
    #[serde(default)]
    cloud_id: String,
    id: u64,
    name: String,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    uris: Vec<String>,
}
pub struct Spotify {
    cloud: crate::music_cloud::Cloud,
    path: PathBuf,
    library: Library,
    music: crate::music::Music,
    account: crate::spotify_account::Account,
    playlists: crate::playlist::Catalog,
    covers: crate::covers::Covers,
    search: crate::music_search::Search,
    metadata_dirty: bool,
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
            cloud: crate::music_cloud::Cloud::new(directory),
            path,
            library,
            music: crate::music::Music::new(directory)?,
            account: crate::spotify_account::Account::new(),
            playlists: crate::playlist::Catalog::new(directory),
            covers: crate::covers::Covers::new(directory),
            search: crate::music_search::Search::new(directory),
            metadata_dirty: true,
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
                    cloud_owned: false,
                    duration_ms: 0,
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
        self.metadata_dirty = true;
        Ok(())
    }
    fn sync_music_metadata(&mut self) {
        if !self.metadata_dirty {
            return;
        }
        self.metadata_dirty = false;
        self.search.set_library(
            self.library
                .entries
                .iter()
                .filter(|entry| entry.kind == "track")
                .filter_map(|entry| serde_json::to_value(entry).ok())
                .collect(),
        );
        self.music
            .retain_catalog(self.library.entries.iter().map(|entry| entry.uri.as_str()));
        for entry in &self.library.entries {
            if entry.kind == "track" {
                self.music.catalog_track(
                    &entry.uri,
                    &entry.title,
                    &entry.artists,
                    &entry.thumbnail,
                );
            }
        }
    }
    fn decorate_artwork(&self, result: &mut Value) {
        if let Some(artwork) = result["artwork"].as_object_mut() {
            for entry in &self.library.entries {
                if entry.kind == "track" && safe_artwork(&entry.thumbnail) {
                    artwork.insert(entry.uri.clone(), json!(entry.thumbnail));
                }
            }
        }
    }
    fn snapshot(&mut self) -> Value {
        self.sync_music_metadata();
        self.music.sync_artwork(self.covers.poll());
        if let Some(items) = self.account.take_imports() {
            if let Err(error) = self.merge_account(items) {
                self.account.fail_import(error);
            }
        }
        let installed = |variable: &str, suffix: &str| {
            std::env::var_os(variable).is_some_and(|p| PathBuf::from(p).join(suffix).is_file())
        };
        let mut result = json!({"entries":self.library.entries,"collections":self.library.collections,"playback_available":false,"local_playback_available":true,"spotify_installed":installed("APPDATA","Spotify/Spotify.exe"),"search_available":true,"spicetify_installed":installed("LOCALAPPDATA","spicetify/spicetify.exe"),"mode":"local_library","account_connected":false});
        if let (Some(result), Some(music)) =
            (result.as_object_mut(), self.music.snapshot().as_object())
        {
            result.extend(music.clone());
        }
        result["playlist"] = self.playlists.snapshot();
        result["playlist_additions"] = json!(self.library.playlist_additions);
        result["playlist_orders"] = json!(self.library.playlist_orders);
        result["cloud"] = self.cloud.snapshot();
        result["search"] = self.search.snapshot();
        if let Some(object) = result.as_object_mut() {
            object.extend(self.covers.snapshot().as_object().unwrap().clone());
        }
        self.decorate_artwork(&mut result);
        let account = self.account.snapshot();
        result["account_connected"] = account["connected"].clone();
        result["account"] = account;
        result
    }
    fn library_events(&self, old: &Library) -> Vec<Value> {
        let mut events = Vec::new();
        let mut push = |kind: &str, data: Value| {
            if let Some(event) = crate::music_cloud::Cloud::seed(kind, data) {
                events.push(event);
            }
        };
        let id = |uri: &str| uri.strip_prefix("spotify:track:").unwrap_or("").to_string();
        for track in &self.library.entries {
            if track.kind == "track"
                && id(&track.uri).len() == 22
                && old
                    .entries
                    .iter()
                    .find(|t| t.uri == track.uri)
                    .is_none_or(|prior| {
                        serde_json::to_value(prior).ok() != serde_json::to_value(track).ok()
                    })
            {
                push(
                    "track",
                    json!({"id":id(&track.uri),"title":track.title,"artists":track.artists,"thumbnail":track.thumbnail,"duration_ms":track.duration_ms,"liked":track.favorite}),
                );
            }
        }
        for source in &self.library.entries {
            if matches!(source.kind.as_str(), "playlist" | "album")
                && !old.entries.iter().any(|entry| entry.uri == source.uri)
            {
                push(
                    "source",
                    json!({"url":source.url,"name":source.title,"art":source.thumbnail}),
                );
            } else if source.kind == "playlist"
                && old
                    .entries
                    .iter()
                    .find(|e| e.uri == source.uri)
                    .is_some_and(|e| e.title != source.title || e.thumbnail != source.thumbnail)
            {
                push(
                    "playlist_meta",
                    json!({"id":source.uri.rsplit(':').next(),"name":source.title,"art":source.thumbnail}),
                );
            }
        }
        for collection in &self.library.collections {
            if old
                .collections
                .iter()
                .find(|c| c.id == collection.id)
                .is_none_or(|prior| {
                    serde_json::to_value(prior).ok() != serde_json::to_value(collection).ok()
                })
            {
                push(
                    "playlist",
                    json!({"id":if collection.cloud_id.is_empty(){format!("local:{}",collection.id)}else{collection.cloud_id.clone()},"name":collection.name,"art":collection.thumbnail,"tracks":collection.uris.iter().map(|uri|id(uri)).filter(|id|id.len()==22).collect::<Vec<_>>()}),
                );
            }
        }
        for source in &old.entries {
            if !self
                .library
                .entries
                .iter()
                .any(|entry| entry.uri == source.uri)
            {
                if source.kind == "track" && id(&source.uri).len() == 22 {
                    push("delete_track", json!({"id":id(&source.uri)}));
                } else if matches!(source.kind.as_str(), "album" | "playlist") {
                    push(
                        "delete_playlist",
                        json!({"id":source.uri.rsplit(':').next()}),
                    );
                }
            }
        }
        for c in &old.collections {
            if !self
                .library
                .collections
                .iter()
                .any(|current| current.id == c.id)
            {
                push(
                    "delete_playlist",
                    json!({"id":if c.cloud_id.is_empty(){format!("local:{}",c.id)}else{c.cloud_id.clone()}}),
                );
            }
        }
        for (source, tracks) in &self.library.playlist_additions {
            for uri in tracks {
                if id(uri).len() != 22 {
                    continue;
                }
                if !old
                    .playlist_additions
                    .get(source)
                    .is_some_and(|ids| ids.contains(uri))
                {
                    push(
                        "add",
                        json!({"id":source.rsplit(':').next(),"track":id(uri)}),
                    );
                }
            }
        }
        for (source, tracks) in &self.library.playlist_orders {
            if old.playlist_orders.get(source) != Some(tracks) {
                push(
                    "order",
                    json!({"id":source.rsplit(':').next(),"tracks":tracks.iter().map(|uri|id(uri)).filter(|id|id.len()==22).collect::<Vec<_>>()}),
                );
            }
        }
        events
    }
    fn playlist_download_metadata(&self, uri: &str, kind: &str) -> Option<Value> {
        let cached = self.playlists.cached(uri);
        let managed = self
            .library
            .entries
            .iter()
            .any(|e| e.uri == uri && e.cloud_owned);
        if cached.is_none() && !managed {
            return None;
        }
        let mut tracks = cached
            .as_ref()
            .and_then(|c| c["tracks"].as_array())
            .cloned()
            .unwrap_or_default();
        for extra in self
            .library
            .playlist_additions
            .get(uri)
            .into_iter()
            .flatten()
        {
            if !tracks.iter().any(|t| t["uri"] == *extra) {
                if let Some(entry) = self.library.entries.iter().find(|e| e.uri == *extra) {
                    tracks.push(json!({"uri":entry.uri,"title":entry.title,"artists":entry.artists,"duration_ms":entry.duration_ms}));
                }
            }
        }
        if let Some(order) = self.library.playlist_orders.get(uri) {
            if managed {
                tracks.retain(|t| {
                    t["uri"]
                        .as_str()
                        .is_some_and(|u| order.iter().any(|o| o == u))
                });
            }
            tracks.sort_by_key(|t| {
                order
                    .iter()
                    .position(|uri| t["uri"] == *uri)
                    .unwrap_or(usize::MAX)
            });
        }
        for track in &mut tracks {
            track["id"] = json!(track["uri"].as_str()?.rsplit(':').next()?);
        }
        Some(json!({"type":kind,"tracks":tracks}))
    }
    fn merge_cloud(&mut self, value: &Value) -> Result<(), String> {
        let mut next = self.library.clone();
        let mut managed = std::collections::BTreeSet::new();
        for track in value["tracks"].as_array().into_iter().flatten() {
            let uri = format!("spotify:track:{}", track["id"].as_str().unwrap_or(""));
            let Ok((uri, url, kind)) = normalize_link(&uri) else {
                continue;
            };
            managed.insert(uri.clone());
            let artwork = track["art"]
                .as_str()
                .filter(|s| safe_artwork(s))
                .unwrap_or("")
                .to_string();
            let title = track["title"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(300)
                .collect::<String>();
            let artist = track["artist"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(300)
                .collect::<String>();
            if let Some(entry) = next.entries.iter_mut().find(|e| e.uri == uri) {
                entry.cloud_owned = true;
                entry.title = title;
                entry.artists = artist;
                entry.favorite = track["liked"]
                    .as_bool()
                    .unwrap_or(track["liked"].as_u64() == Some(1));
                if !artwork.is_empty() {
                    entry.thumbnail = artwork;
                }
                entry.duration_ms = track["duration_ms"].as_u64().unwrap_or(0);
            } else {
                next.entries.push(Entry {
                    cloud_owned: true,
                    duration_ms: track["duration_ms"].as_u64().unwrap_or(0),
                    uri,
                    url,
                    kind,
                    title,
                    artists: artist,
                    thumbnail: artwork,
                    favorite: track["liked"]
                        .as_bool()
                        .unwrap_or(track["liked"].as_u64() == Some(1)),
                    collection: None,
                });
            }
        }
        let mut collection_ids = std::collections::BTreeSet::new();
        for playlist in value["playlists"].as_array().into_iter().flatten() {
            let artwork = playlist["art"]
                .as_str()
                .filter(|s| safe_playlist_artwork(s))
                .unwrap_or("")
                .to_owned();
            let id = playlist["id"].as_str().unwrap_or("");
            let name = playlist["name"]
                .as_str()
                .unwrap_or("Playlist")
                .chars()
                .take(100)
                .collect::<String>();
            let tracks = playlist["tracks"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|id| {
                    let uri = format!("spotify:track:{}", id.as_str()?);
                    normalize_link(&uri).ok().map(|t| t.0)
                })
                .collect::<Vec<_>>();
            if let Ok((uri, url, kind)) = normalize_link(playlist["source"].as_str().unwrap_or(""))
            {
                managed.insert(uri.clone());
                if playlist["importing"].as_bool() == Some(true) && tracks.is_empty() {
                    continue;
                }
                if let Some(entry) = next.entries.iter_mut().find(|entry| entry.uri == uri) {
                    entry.title = name;
                    entry.cloud_owned = true;
                    entry.thumbnail = artwork.clone();
                } else {
                    next.entries.push(Entry {
                        cloud_owned: true,
                        duration_ms: 0,
                        uri: uri.clone(),
                        url,
                        kind,
                        title: name,
                        artists: String::new(),
                        thumbnail: artwork.clone(),
                        favorite: false,
                        collection: None,
                    });
                }
                next.playlist_additions.insert(uri.clone(), tracks.clone());
                next.playlist_orders.insert(uri, tracks);
            } else {
                collection_ids.insert(id.to_string());
                let prefix = format!("pc:{}:", self.cloud.device_id());
                let own_id = id
                    .strip_prefix(&prefix)
                    .and_then(|id| id.parse::<u64>().ok());
                if let Some(c) = next
                    .collections
                    .iter_mut()
                    .find(|c| c.cloud_id == id || (c.cloud_id.is_empty() && Some(c.id) == own_id))
                {
                    c.name = name;
                    c.thumbnail = artwork.clone();
                    c.uris = tracks;
                    c.cloud_id = id.into();
                } else {
                    let local = next.next_id.max(1);
                    next.next_id = local + 1;
                    next.collections.push(Collection {
                        cloud_id: id.into(),
                        id: local,
                        name,
                        thumbnail: artwork,
                        uris: tracks,
                    });
                }
            }
        }
        next.entries
            .retain(|entry| !entry.cloud_owned || managed.contains(&entry.uri));
        next.collections
            .retain(|c| c.cloud_id.is_empty() || collection_ids.contains(&c.cloud_id));
        for entry in &mut next.entries {
            if entry.collection.is_some_and(|id| {
                next.collections
                    .iter()
                    .any(|c| c.id == id && !c.uris.contains(&entry.uri))
            }) {
                entry.collection = None;
            }
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if next.entries.len() > 1000 || bytes.len() > 524288 {
            return Err("A biblioteca sincronizada excede o limite deste perfil; os dados locais foram preservados.".into());
        }
        let temp = self.path.with_extension("tmp");
        fs::write(&temp, bytes)
            .and_then(|_| fs::rename(temp, &self.path))
            .map_err(|e| e.to_string())?;
        self.library = next;
        self.metadata_dirty = true;
        Ok(())
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        if method == "cloud_login" {
            let seed = self.library_events(&Library::default());
            self.cloud.login(
                params["origin"].as_str().unwrap_or(""),
                params["username"].as_str().unwrap_or(""),
                params["password"].as_str().unwrap_or(""),
                seed,
            )?;
            return Ok(self.snapshot());
        }
        if method == "cloud_pair" {
            let seed = self.library_events(&Library::default());
            self.cloud.connect(
                params["origin"].as_str().unwrap_or(""),
                params["code"].as_str().unwrap_or(""),
                seed,
            )?;
            return Ok(self.snapshot());
        }
        if method == "cloud_disconnect" {
            self.cloud.disconnect();
            return Ok(self.snapshot());
        }
        if method == "cloud_publish" {
            self.cloud.publish(params["player"].clone());
            return Ok(json!({"ok":true}));
        }
        if method == "cloud_ack" {
            self.cloud.ack(params["id"].as_u64().unwrap_or(0));
            return Ok(json!({"ok":true}));
        }
        if method == "cloud_command" {
            self.cloud.command(
                params["target"].as_str().unwrap_or("").into(),
                params["command"].clone(),
            );
            return Ok(json!({"ok":true}));
        }
        let mut merged = false;
        if let Some(library) = self.cloud.take_library() {
            match self.merge_cloud(&library) {
                Ok(()) => merged = true,
                Err(error) => self.cloud.retry_library(error),
            }
        }
        let mutation = matches!(
            method,
            "import_search"
                | "import_link"
                | "save_link"
                | "favorite"
                | "remove"
                | "set_collection"
                | "create_collection"
                | "rename_collection"
                | "edit_playlist"
                | "remove_from_collection"
                | "delete_collection"
                | "add_to_playlist"
                | "reorder_playlist"
        );
        let before = mutation.then(|| self.library.clone());
        let mut result = self.handle_local(method, params)?;
        if let Some(before) = before {
            for event in self.library_events(&before) {
                self.cloud
                    .enqueue(event["type"].as_str().unwrap_or(""), event["data"].clone());
            }
        }
        if merged {
            result = self.snapshot();
        }
        result["cloud"] = self.cloud.snapshot();
        Ok(result)
    }
    fn handle_local(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        if method == "search" {
            self.search
                .request(params["query"].as_str().unwrap_or(""))?;
            return Ok(self.snapshot());
        }
        if method == "import_search" {
            let track = self.search.track(params["uri"].as_str().unwrap_or(""))?;
            let mut next = self.library.clone();
            if let Some(entry) = next
                .entries
                .iter_mut()
                .find(|entry| entry.uri == track["uri"])
            {
                entry.title = track["title"].as_str().unwrap().into();
                entry.artists = track["artists"].as_str().unwrap_or("").into();
                entry.thumbnail = track["thumbnail"].as_str().unwrap_or("").into();
                entry.duration_ms = track["duration_ms"].as_u64().unwrap_or(entry.duration_ms);
            } else {
                if next.entries.len() >= 1000 {
                    return Err("Sua biblioteca atingiu o limite de itens.".into());
                }
                next.entries.insert(
                    0,
                    Entry {
                        cloud_owned: false,
                        duration_ms: track["duration_ms"].as_u64().unwrap_or(0),
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
            self.metadata_dirty = true;
            if params["download"].as_bool() == Some(true) {
                self.handle_local("download", &json!({"url":track["uri"],"total_tracks":1}))?;
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
            self.sync_music_metadata();
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
                | "save_session"
                | "presence_config"
        ) {
            let mut arguments = params.clone();
            if method == "download" {
                if let Ok((uri, _, kind)) = normalize_link(params["url"].as_str().unwrap_or("")) {
                    if kind == "track" {
                        if let Some(track) = self
                            .library
                            .entries
                            .iter()
                            .find(|t| t.uri == uri && t.duration_ms > 0)
                        {
                            arguments["metadata"] = json!({"type":"track","id":uri.rsplit(':').next(),"title":track.title,"artists":track.artists,"duration_ms":track.duration_ms});
                        }
                    } else if let Some(metadata) = self.playlist_download_metadata(&uri, &kind) {
                        arguments["metadata"] = metadata;
                    }
                }
            }
            self.music.handle(method, &arguments)?;
            if matches!(method, "volume" | "save_session") {
                return Ok(self.music.snapshot_since(params["revision"].as_u64()));
            }
            return Ok(self.snapshot());
        }
        let mut next = self.library.clone();
        match method {
            "reorder_playlist" => {
                let order: Vec<String> = serde_json::from_value(params["order"].clone())
                    .map_err(|_| "Ordem inválida.")?;
                if order.len() > 2000
                    || order
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        != order.len()
                {
                    return Err("Ordem inválida.".into());
                }
                if let Some(target) = params["playlist"].as_str() {
                    let active = self.playlists.snapshot();
                    if active["uri"] != target || active["state"] != "ready" {
                        return Err("Abra a playlist antes de reordenar.".into());
                    }
                    let mut expected: std::collections::BTreeSet<String> = active["tracks"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|t| t["uri"].as_str().map(String::from))
                        .collect();
                    expected.extend(
                        next.playlist_additions
                            .get(target)
                            .into_iter()
                            .flatten()
                            .cloned(),
                    );
                    if next
                        .entries
                        .iter()
                        .any(|e| e.uri == target && e.cloud_owned)
                    {
                        if let Some(visible) = next.playlist_orders.get(target) {
                            expected.retain(|uri| visible.contains(uri));
                        }
                    }
                    if order
                        .iter()
                        .cloned()
                        .collect::<std::collections::BTreeSet<_>>()
                        != expected
                    {
                        return Err("A playlist mudou. Atualize antes de reordenar.".into());
                    }
                    next.playlist_orders.insert(target.into(), order);
                } else {
                    let id = params["collection"]
                        .as_u64()
                        .ok_or("Selecione uma playlist.")?;
                    let collection = next
                        .collections
                        .iter_mut()
                        .find(|c| c.id == id)
                        .ok_or("Playlist não encontrada.")?;
                    if order.iter().collect::<std::collections::BTreeSet<_>>()
                        != collection.uris.iter().collect()
                    {
                        return Err("A playlist mudou. Atualize antes de reordenar.".into());
                    }
                    collection.uris = order;
                }
            }
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
                        params["thumbnail"]
                            .as_str()
                            .filter(|s| safe_artwork(s))
                            .unwrap_or("")
                            .into(),
                    )
                };
                if let Some(entry) = next.entries.iter_mut().find(|e| e.uri == uri) {
                    entry.title = title;
                    entry.thumbnail = thumbnail;
                    if let Some(artists) = params["artists"].as_str() {
                        entry.artists = artists.chars().take(300).collect();
                    }
                } else {
                    if next.entries.len() >= 1000 {
                        return Err("O limite inicial é de 1000 itens.".into());
                    }
                    next.entries.insert(
                        0,
                        Entry {
                            cloud_owned: false,
                            duration_ms: params["duration_ms"].as_u64().unwrap_or(0),
                            artists: params["artists"]
                                .as_str()
                                .unwrap_or("")
                                .chars()
                                .take(300)
                                .collect(),
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
            "add_to_playlist" => {
                let uri = params["uri"].as_str().ok_or("Selecione uma música.")?;
                if !next
                    .entries
                    .iter()
                    .any(|entry| entry.uri == uri && entry.kind == "track")
                {
                    return Err("Salve esta música na biblioteca primeiro.".into());
                }
                if let Some(target) = params["playlist"].as_str() {
                    if !next
                        .entries
                        .iter()
                        .any(|entry| entry.uri == target && entry.kind == "playlist")
                    {
                        return Err("Playlist importada não encontrada.".into());
                    }
                    let tracks = next.playlist_additions.entry(target.into()).or_default();
                    if !tracks.iter().any(|track| track == uri) {
                        if tracks.len() >= 2000 {
                            return Err("Esta playlist atingiu 2000 músicas adicionadas.".into());
                        }
                        tracks.push(uri.into());
                    }
                } else {
                    let id = params["collection"]
                        .as_u64()
                        .ok_or("Escolha uma playlist.")?;
                    let collection = next
                        .collections
                        .iter_mut()
                        .find(|c| c.id == id)
                        .ok_or("Playlist não encontrada.")?;
                    if !collection.uris.iter().any(|track| track == uri) {
                        collection.uris.push(uri.into());
                    }
                }
            }
            "favorite" | "remove" | "set_collection" => {
                let uri = params["uri"].as_str().ok_or("Selecione um item.")?;
                if method == "remove" {
                    next.entries.retain(|e| e.uri != uri);
                    for collection in &mut next.collections {
                        collection.uris.retain(|item| item != uri);
                    }
                    next.playlist_additions.remove(uri);
                    for tracks in next.playlist_additions.values_mut() {
                        tracks.retain(|item| item != uri);
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
                    cloud_id: String::new(),
                    id,
                    name: name.into(),
                    thumbnail: String::new(),
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
            "edit_playlist" => {
                let name = params["name"].as_str().unwrap_or("").trim();
                if name.is_empty() || name.chars().count() > 100 {
                    return Err("Use um nome entre 1 e 100 caracteres.".into());
                }
                let artwork = params["art"].as_str();
                if artwork.is_some_and(|art| !safe_playlist_artwork(art)) {
                    return Err("Capa inválida. Escolha uma imagem menor.".into());
                }
                if let Some(uri) = params["uri"].as_str() {
                    let entry = next
                        .entries
                        .iter_mut()
                        .find(|e| e.uri == uri && e.kind == "playlist")
                        .ok_or("Playlist não encontrada.")?;
                    entry.title = name.into();
                    if let Some(art) = artwork {
                        entry.thumbnail = art.into();
                    }
                } else {
                    let collection = next
                        .collections
                        .iter_mut()
                        .find(|c| Some(c.id) == params["id"].as_u64())
                        .ok_or("Playlist não encontrada.")?;
                    collection.name = name.into();
                    if let Some(art) = artwork {
                        collection.thumbnail = art.into();
                    }
                }
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
        self.metadata_dirty = true;
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
fn safe_playlist_artwork(input: &str) -> bool {
    if input.is_empty() || (input.len() <= 600 && safe_artwork(input)) {
        return true;
    }
    if input.len() > 32768 {
        return false;
    }
    use base64::Engine;
    [
        ("data:image/jpeg;base64,", 0),
        ("data:image/png;base64,", 1),
        ("data:image/webp;base64,", 2),
    ]
    .iter()
    .any(|(prefix, kind)| {
        input
            .strip_prefix(prefix)
            .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
            .is_some_and(|bytes| match kind {
                0 => bytes.starts_with(b"\xff\xd8\xff"),
                1 => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                _ => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
            })
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
    #[test]
    fn playlist_edits_survive_restart_and_cloud_covers_are_merged() {
        let dir = std::env::temp_dir().join(format!(
            "mare-playlist-covers-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        let uri = "spotify:playlist:4uLU6hMCjMI75M1A2tKUQC";
        app.handle("save_link", &json!({"url":uri,"title":"Original"}))
            .unwrap();
        let before = app.library.clone();
        app.handle(
            "edit_playlist",
            &json!({"uri":uri,"name":"Edited","art":"https://i.scdn.co/image/fixture"}),
        )
        .unwrap();
        assert!(app
            .library_events(&before)
            .iter()
            .any(|e| e["type"] == "playlist_meta"));
        assert!(app
            .handle(
                "edit_playlist",
                &json!({"uri":uri,"name":"Bad","art":"data:image/svg+xml;base64,PHN2Zz4="})
            )
            .is_err());
        drop(app);
        let mut app = Spotify::new(&dir).unwrap();
        assert_eq!(app.library.entries[0].title, "Edited");
        assert_eq!(
            app.library.entries[0].thumbnail,
            "https://i.scdn.co/image/fixture"
        );
        app.merge_cloud(&json!({"tracks":[],"playlists":[{"id":"4uLU6hMCjMI75M1A2tKUQC","source":"https://open.spotify.com/playlist/4uLU6hMCjMI75M1A2tKUQC","name":"Phone edit","art":"https://i.scdn.co/image/phone","tracks":[]}]})).unwrap();
        assert_eq!(
            app.library.entries[0].thumbnail,
            "https://i.scdn.co/image/phone"
        );
        assert_eq!(app.library.entries[0].title, "Phone edit");
        drop(app);
        fs::remove_dir_all(dir).unwrap();
    }
    use super::*;
    #[test]
    fn imported_and_local_playlist_additions_survive_restart_and_removal() {
        let dir = std::env::temp_dir().join(format!(
            "mare-playlist-additions-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        let uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
        let playlist = "spotify:playlist:4uLU6hMCjMI75M1A2tKUQC";
        app.handle("save_link", &json!({"url":uri,"title":"Song"}))
            .unwrap();
        app.handle("save_link", &json!({"url":playlist,"title":"Imported"}))
            .unwrap();
        app.handle("create_collection", &json!({"name":"Created"}))
            .unwrap();
        for _ in 0..2 {
            app.handle("add_to_playlist", &json!({"uri":uri,"playlist":playlist}))
                .unwrap();
            app.handle("add_to_playlist", &json!({"uri":uri,"collection":1}))
                .unwrap();
        }
        assert!(app
            .handle("add_to_playlist", &json!({"uri":uri,"playlist":uri}))
            .is_err());
        drop(app);
        let mut app = Spotify::new(&dir).unwrap();
        let snapshot = app.snapshot();
        assert_eq!(snapshot["playlist_additions"][playlist], json!([uri]));
        assert_eq!(snapshot["collections"][0]["uris"], json!([uri]));
        app.handle("remove", &json!({"uri":uri})).unwrap();
        assert_eq!(app.snapshot()["playlist_additions"][playlist], json!([]));
        drop(app);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn playlist_download_follows_manual_additions_and_cloud_order() {
        let dir = std::env::temp_dir().join(format!(
            "mare-playlist-order-test-{}",
            crate::model::now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        let p = "spotify:playlist:pppppppppppppppppppppp";
        let a = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
        let b = "spotify:track:bbbbbbbbbbbbbbbbbbbbbb";
        app.handle("save_link", &json!({"url":p,"title":"Imported"}))
            .unwrap();
        app.handle(
            "save_link",
            &json!({"url":b,"title":"Added","artists":"Artist","duration_ms":200000}),
        )
        .unwrap();
        app.handle("add_to_playlist", &json!({"uri":b,"playlist":p}))
            .unwrap();
        fs::write(dir.join("playlist-spotify-playlist-pppppppppppppppppppppp.json"),serde_json::to_vec(&json!({"uri":p,"state":"ready","tracks":[{"uri":a,"title":"Original","artists":"Artist","duration_ms":200000}]})).unwrap()).unwrap();
        app.library
            .playlist_orders
            .insert(p.into(), vec![b.into(), a.into()]);
        let metadata = app.playlist_download_metadata(p, "playlist").unwrap();
        assert_eq!(metadata["tracks"][0]["id"], "bbbbbbbbbbbbbbbbbbbbbb");
        assert_eq!(metadata["tracks"][1]["id"], "aaaaaaaaaaaaaaaaaaaaaa");
        app.library
            .entries
            .iter_mut()
            .find(|e| e.uri == p)
            .unwrap()
            .cloud_owned = true;
        app.library.playlist_orders.insert(p.into(), vec![b.into()]);
        let metadata = app.playlist_download_metadata(p, "playlist").unwrap();
        assert_eq!(metadata["tracks"].as_array().unwrap().len(), 1);
        drop(app);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn legacy_youtube_entries_never_generate_invalid_spotify_sync_events() {
        let dir =
            std::env::temp_dir().join(format!("mare-cloud-legacy-test-{}", crate::model::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let mut app = Spotify::new(&dir).unwrap();
        app.library.entries=serde_json::from_value(json!([
          {"uri":"youtube:video:abcdefghijk","url":"https://www.youtube.com/watch?v=abcdefghijk","kind":"track","title":"Local fixture","thumbnail":"","favorite":false},
          {"uri":"spotify:track:aaaaaaaaaaaaaaaaaaaaaa","url":"https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaaa","kind":"track","title":"Catalog fixture","thumbnail":"","favorite":false}
        ])).unwrap();
        let events = app.library_events(&Library::default());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["data"]["id"], "aaaaaaaaaaaaaaaaaaaaaa");
        let previous = app.library.clone();
        app.library.entries.clear();
        let events = app.library_events(&previous);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "delete_track");
        drop(app);
        fs::remove_dir_all(dir).unwrap();
    }
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
        fs::write(
            dir.join("library.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
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
