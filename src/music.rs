//! Native local audio and a short-lived, unmodified Sunnify CLI subprocess.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: u64,
    pub title: String,
    pub artists: String,
    path: PathBuf,
    #[serde(default)]
    source_uri: String,
    #[serde(default)]
    track_uri: String,
    #[serde(default)]
    artwork: String,
}
#[derive(Default)]
struct Progress {
    events: Vec<Value>,
    last: Value,
    done: u64,
    latest: Value,
}
struct Download {
    child: Child,
    started: std::time::Instant,
    progress: Arc<Mutex<Progress>>,
    reader: Option<thread::JoinHandle<()>>,
    tree: Option<crate::components::ProcessTree>,
    temporary: PathBuf,
    source_uri: String,
    play_after: bool,
}
pub struct Music {
    directory: PathBuf,
    tracks: Vec<Track>,
    catalog: BTreeMap<String, (String, String, String)>,
    download: Option<Download>,
    last_download: Value,
    current: Option<u64>,
    audio: Option<crate::audio::Player>,
    volume: u32,
    session: crate::music_session::Session,
    checkpoint_at: std::time::Instant,
    revision: u64,
    completed: BTreeSet<String>,
    pub presence: crate::presence::Presence,
}
impl Drop for Download {
    fn drop(&mut self) {
        // Kill the owned process tree before removing this run's extraction directory.
        self.tree.take();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if self
            .temporary
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with("job-"))
            && self
                .temporary
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|s| s == "tmp")
        {
            let _ = fs::remove_dir_all(&self.temporary);
        }
    }
}
fn source(input: &str) -> Result<(String, String, String), String> {
    if let Some(id) = crate::music_search::video_id(input) {
        return Ok((
            input.into(),
            format!("https://www.youtube.com/watch?v={id}"),
            "track".into(),
        ));
    }
    crate::spotify::normalize_link(input)
}
impl Music {
    pub fn retain_catalog<'a>(&mut self, entries: impl Iterator<Item = &'a str>) {
        let mut keys = entries.collect::<BTreeSet<_>>();
        for track in &self.tracks {
            keys.insert(track.track_uri.as_str());
            keys.insert(track.source_uri.as_str());
        }
        self.catalog.retain(|uri, _| keys.contains(uri.as_str()));
    }
    pub fn catalog_track(&mut self, uri: &str, title: &str, artists: &str, artwork: &str) {
        if !uri.starts_with("spotify:track:")
            || artists.trim().is_empty()
            || title.trim().is_empty()
        {
            return;
        }
        if self
            .catalog
            .get(uri)
            .is_some_and(|m| m.0 == title && m.1 == artists && m.2 == artwork)
        {
            return;
        }
        self.catalog
            .insert(uri.into(), (title.into(), artists.into(), artwork.into()));
    }
    fn apply_catalog(&mut self) {
        let mut changed = false;
        for track in &mut self.tracks {
            let uri = if track.track_uri.starts_with("spotify:track:") {
                &track.track_uri
            } else {
                &track.source_uri
            };
            if let Some((title, artists, artwork)) = self.catalog.get(uri) {
                if &track.title != title
                    || &track.artists != artists
                    || (!artwork.is_empty() && &track.artwork != artwork)
                {
                    track.title = title.clone();
                    track.artists = artists.clone();
                    if !artwork.is_empty() && crate::spotify::safe_artwork(artwork) {
                        track.artwork = artwork.clone();
                    }
                    changed = true;
                }
            }
        }
        if changed {
            self.revision = self.revision.saturating_add(1);
            let _ = self.save();
        }
    }

    pub fn sync_artwork(&mut self, covers: &std::collections::BTreeMap<String, String>) {
        let mut changed = false;
        for t in &mut self.tracks {
            let uri = if t.track_uri.is_empty() {
                &t.source_uri
            } else {
                &t.track_uri
            };
            let authoritative = self
                .catalog
                .get(uri)
                .map(|entry| &entry.2)
                .filter(|url| !url.is_empty());
            if let Some(url) = authoritative.or_else(|| covers.get(uri)) {
                if &t.artwork != url {
                    t.artwork = url.clone();
                    changed = true;
                }
            }
        }
        if changed {
            self.revision = self.revision.saturating_add(1);
            let _ = self.save();
        }
    }
    pub fn new(directory: &Path) -> Result<Self, String> {
        let root = directory.join("audio");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let bytes = fs::read(directory.join("downloaded.json"));
        let tracks = match bytes {
            Ok(bytes) if bytes.len() <= 1_048_576 => serde_json::from_slice(&bytes)
                .map_err(|_| "Índice de áudio inválido; arquivo preservado.")?,
            Ok(_) => return Err("Índice de áudio excede o limite.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut session = crate::music_session::Session::load(directory);
        let tracks: Vec<Track> = tracks;
        session.track_id = session
            .track_id
            .filter(|id| tracks.iter().any(|t| t.id == *id && t.path.is_file()));
        let mut music = Self {
            directory: directory.into(),
            tracks,
            catalog: BTreeMap::new(),
            download: None,
            last_download: json!({"state":"idle"}),
            current: session.track_id,
            audio: None,
            volume: session.volume,
            session,
            checkpoint_at: std::time::Instant::now(),
            revision: 0,
            completed: match fs::read(directory.join("completed-downloads.json")) {
                Ok(bytes) if bytes.len() <= 131072 => serde_json::from_slice(&bytes)
                    .map_err(|_| "Registro de downloads inválido; arquivo preservado.")?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeSet::new(),
                _ => return Err("Não foi possível ler o registro de downloads.".into()),
            },
            presence: crate::presence::Presence::new(directory),
        };
        if music.index_playlist_ids() {
            // These IDs can be recovered again from the original manifests.
            let _ = music.save();
        }
        Ok(music)
    }
    // The original CLI records exact Spotify IDs beside finished playlist files.
    // Match only filenames already registered by Maré, never open a manifest-supplied path.
    fn index_playlist_ids(&mut self) -> bool {
        let Ok(root) = self.directory.join("audio").canonicalize() else {
            return false;
        };
        let mut folders = BTreeMap::<PathBuf, BTreeMap<String, usize>>::new();
        for (index, track) in self.tracks.iter().enumerate() {
            if !track.track_uri.is_empty()
                || !track.path.starts_with(&root)
                || !(track.source_uri.starts_with("spotify:playlist:")
                    || track.source_uri.starts_with("spotify:album:"))
            {
                continue;
            }
            if let (Some(folder), Some(name)) = (
                track.path.parent(),
                track.path.file_name().and_then(|n| n.to_str()),
            ) {
                folders
                    .entry(folder.into())
                    .or_default()
                    .insert(name.into(), index);
            }
        }
        let mut changed = false;
        for (dir, names) in folders {
            let Ok(file) = fs::File::open(dir.join(".sunnify-manifest.jsonl")) else {
                continue;
            };
            let mut content = String::new();
            if file.take(1_048_577).read_to_string(&mut content).is_err()
                || content.len() > 1_048_576
            {
                continue;
            }
            for line in content.lines() {
                let Ok(row) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                let Some(index) = row["file"].as_str().and_then(|name| names.get(name)) else {
                    continue;
                };
                let Some(id) = row["id"]
                    .as_str()
                    .filter(|id| id.len() == 22 && id.bytes().all(|c| c.is_ascii_alphanumeric()))
                else {
                    continue;
                };
                self.tracks[*index].track_uri = format!("spotify:track:{id}");
                changed = true;
            }
        }
        changed
    }
    fn save(&self) -> Result<(), String> {
        let path = self.directory.join("downloaded.json");
        let temp = path.with_extension("tmp");
        let bytes = serde_json::to_vec(&self.tracks).map_err(|e| e.to_string())?;
        if bytes.len() > 1_048_576 {
            return Err("Índice local cheio.".into());
        }
        fs::write(&temp, bytes)
            .and_then(|()| fs::rename(temp, path))
            .map_err(|e| e.to_string())?;
        let path = self.directory.join("completed-downloads.json");
        let temp = path.with_extension("tmp");
        fs::write(
            &temp,
            serde_json::to_vec(&self.completed).map_err(|e| e.to_string())?,
        )
        .and_then(|()| fs::rename(temp, path))
        .map_err(|e| e.to_string())
    }
    fn add_file(&mut self, path: &Path, title: &str, artists: &str) -> bool {
        let Ok(path) = path.canonicalize() else {
            return false;
        };
        let Ok(root) = self.directory.join("audio").canonicalize() else {
            return false;
        };
        if !path.starts_with(root)
            || !path.is_file()
            || !matches!(
                path.extension()
                    .and_then(|s| s.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("mp3" | "wav" | "m4a")
            )
            || self.tracks.len() >= 2000
        {
            return false;
        }
        if self.tracks.iter().any(|track| track.path == path) {
            return false;
        }
        let id = self
            .tracks
            .iter()
            .map(|track| track.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        self.tracks.push(Track {
            id,
            title: title.chars().take(300).collect(),
            artists: artists.chars().take(200).collect(),
            path,
            source_uri: String::new(),
            track_uri: String::new(),
            artwork: String::new(),
        });
        self.revision = self.revision.saturating_add(1);
        true
    }
    fn poll_download(&mut self) {
        let Some(download) = self.download.as_mut() else {
            return;
        };
        let finished = download.child.try_wait().ok().flatten();
        self.last_download["elapsed_s"] = json!(download.started.elapsed().as_secs());
        let source_uri = download.source_uri.clone();
        let play_after = download.play_after;
        if finished.is_some() {
            if let Some(reader) = download.reader.take() {
                let _ = reader.join();
            }
        }
        let (events, last) = if let Ok(mut progress) = download.progress.lock() {
            self.last_download["completed_tracks"] = json!(progress.done);
            self.last_download["last_track"] = progress.latest.clone();
            (std::mem::take(&mut progress.events), progress.last.clone())
        } else {
            (Vec::new(), Value::Null)
        };
        if !last.is_null() {
            self.last_download["event"] = last.clone();
        }
        let mut changed = false;
        for event in events {
            if matches!(
                event["event"].as_str(),
                Some("track_done" | "track_skipped")
            ) {
                changed |= self.add_file(
                    Path::new(event["file"].as_str().unwrap_or("")),
                    event["title"].as_str().unwrap_or("Áudio local"),
                    event["artists"].as_str().unwrap_or(""),
                );
                if let Ok(path) = Path::new(event["file"].as_str().unwrap_or("")).canonicalize() {
                    if let Some(track) = self.tracks.iter_mut().find(|t| t.path == path) {
                        self.last_download["ready_track_id"] = json!(track.id);
                        if track.source_uri.is_empty() {
                            track.source_uri = source_uri.clone();
                            changed = true;
                        }
                        if let Some(id) = event["spotify_id"].as_str() {
                            let uri = format!("spotify:track:{id}");
                            if crate::spotify::normalize_link(&uri).is_ok() {
                                track.track_uri = uri;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        if changed {
            self.revision = self.revision.saturating_add(1);
            if let Err(error) = self.save() {
                self.last_download["error"] = json!(error);
            }
        }
        if let Some(status) = finished {
            if self.last_download["kind"] != "track" && self.index_playlist_ids() {
                self.revision = self.revision.saturating_add(1);
                let _ = self.save();
            }
            let confirmed = status.success()
                && self
                    .tracks
                    .iter()
                    .any(|t| t.source_uri == source_uri && t.path.is_file());
            self.last_download["state"] = json!(if confirmed { "completed" } else { "failed" });
            self.last_download["exit_code"] = json!(status.code());
            if last["event"] == "run_summary" {
                if let (Some(landed), Some(skipped)) =
                    (last["landed"].as_u64(), last["skipped"].as_u64())
                {
                    self.last_download["completed_tracks"] = json!(landed.saturating_add(skipped));
                }
            }
            self.download = None;
            if confirmed {
                self.completed.insert(source_uri.clone());
                self.revision = self.revision.saturating_add(1);
                if let Err(error) = self.save() {
                    self.last_download["error"] = json!(error);
                }
                if play_after {
                    if let Some(id) = self
                        .tracks
                        .iter()
                        .find(|t| t.source_uri == source_uri)
                        .map(|t| t.id)
                    {
                        if let Err(error) = self.handle("play_local", &json!({"id":id})) {
                            self.last_download["error"] = json!(error);
                        }
                    }
                }
            }
        }
    }
    pub fn snapshot(&mut self) -> Value {
        self.snapshot_since(None)
    }
    pub fn snapshot_since(&mut self, known_revision: Option<u64>) -> Value {
        self.poll_download();
        self.apply_catalog();
        let (mode, position, duration) =
            self.audio
                .as_ref()
                .map(|p| p.snapshot())
                .unwrap_or(if self.current.is_some() {
                    ("paused", self.session.position_ms, self.session.duration_ms)
                } else {
                    ("stopped", 0, 0)
                });
        if self.audio.is_some() && self.checkpoint_at.elapsed().as_secs() >= 10 {
            let _ = self.checkpoint();
        }
        let track = self
            .current
            .and_then(|id| self.tracks.iter().find(|t| t.id == id));
        self.presence.update(
            track.map(|t| (t.title.as_str(), t.artists.as_str())),
            mode == "playing",
            position,
            duration,
            track.map(|t| t.artwork.as_str()).unwrap_or(""),
        );
        let mut snapshot = json!({"library_revision":self.revision,"player":{"track_id":self.current,"state":mode,"position_ms":position,"duration_ms":duration,"volume":self.volume},"download":self.last_download,"sunnify_available":crate::components::executable("sunnify").is_some(),"downloader_pid":self.download.as_ref().map(|d|d.child.id()),"presence":self.presence.snapshot()});
        snapshot["session"] = self.session.ui.clone();
        if known_revision != Some(self.revision) {
            snapshot["completed_sources"] = json!(self.completed);
            snapshot["local_tracks"]=json!(self.tracks.iter().map(|t|json!({"id":t.id,"title":t.title,"artists":t.artists,"source_uri":t.source_uri,"track_uri":t.track_uri,"artwork":t.artwork,"available":t.path.is_file()})).collect::<Vec<_>>());
        }
        snapshot
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<(), String> {
        self.poll_download();
        match method {
            "save_session" => {
                self.session.ui = crate::music_session::validate_ui(params)?;
                self.checkpoint()?;
            }
            "delete_local" => {
                if self.download.is_some() {
                    return Err("Aguarde ou cancele o download antes de excluir uma música.".into());
                }
                let id = params["id"]
                    .as_u64()
                    .ok_or("Selecione uma música baixada.")?;
                let index = self
                    .tracks
                    .iter()
                    .position(|t| t.id == id)
                    .ok_or("Música não encontrada.")?;
                let track = self.tracks[index].clone();
                let root = self
                    .directory
                    .join("audio")
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                match track.path.canonicalize() {
                    Ok(path) if path.starts_with(&root) && path.is_file() => {
                        if self.current == Some(id) {
                            self.audio = None;
                            self.current = None;
                            self.presence.clear();
                        }
                        fs::remove_file(path)
                            .map_err(|e| format!("Não foi possível excluir a música: {e}"))?;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    _ => return Err("Arquivo fora da biblioteca de áudio.".into()),
                }
                self.tracks.remove(index);
                self.completed.remove(&track.source_uri);
                self.completed.remove(&track.track_uri);
                self.revision = self.revision.saturating_add(1);
                self.save()?;
            }
            "download" => {
                let (uri, url, kind) = source(params["url"].as_str().unwrap_or(""))?;
                if let Some(download) = self.download.as_mut().filter(|d| d.source_uri == uri) {
                    download.play_after |= params["play_after"].as_bool().unwrap_or(false);
                    return Ok(());
                }
                let cached = self
                    .tracks
                    .iter()
                    .find(|t| (t.source_uri == uri || t.track_uri == uri) && t.path.is_file())
                    .map(|t| t.id);
                if let Some(id) =
                    cached.filter(|_| kind == "track" || self.completed.contains(&uri))
                {
                    if self.download.is_none() {
                        self.last_download = json!({"state":"completed","uri":uri,"url":url,"kind":kind,"cached":true,"ready_track_id":id,"job_id":crate::model::now_ms()});
                    }
                    if params["play_after"].as_bool() == Some(true) {
                        self.handle("play_local", &json!({"id":id}))?;
                    }
                    return Ok(());
                }
                if self.download.is_some() {
                    return Err("Já existe um download em andamento. Cancele ou aguarde.".into());
                }
                if !matches!(kind.as_str(), "track" | "album" | "playlist") {
                    return Err("Baixe uma faixa, álbum ou playlist.".into());
                }
                let youtube = crate::music_search::video_id(&uri).is_some();
                let runtime = self.directory.join("runtime");
                let temp = runtime.join("tmp").join(format!(
                    "job-{}-{}",
                    std::process::id(),
                    crate::model::now_ms()
                ));
                fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
                let mut command = if youtube {
                    crate::music_search::command(&self.directory)?
                } else {
                    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
                    Command::new(executable)
                };
                if youtube {
                    command.args([
                        "--no-playlist", "--no-simulate", "--no-mtime", "--concurrent-fragments", "4",
                        "--progress", "--newline", "--progress-delta", "1", "--output-na-placeholder", "null",
                        "--progress-template", r#"download:{"event":"transfer","received":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes)j}"#,
                        "--format", "bestaudio[ext=m4a]/bestaudio[ext=mp4]", "--output",
                    ])
                        .arg(self.directory.join("audio").join("%(id)s.%(ext)s"))
                        .args(["--print",r#"after_move:{"event":"track_done","file":%(filepath)j,"title":%(title)j,"artists":%(uploader)j}"#,&url]);
                } else {
                    command
                        .args(["--music-source-worker", &url])
                        .arg(self.directory.join("audio"))
                        .arg(&self.directory);
                }
                command
                    .env("APPDATA", &runtime)
                    .env("LOCALAPPDATA", &runtime)
                    .env("TEMP", &temp)
                    .env("TMP", &temp)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null());
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x0800_0000 | 0x0000_4000);
                let mut child = command.spawn().map_err(|e| e.to_string())?;
                let tree = match crate::components::ProcessTree::new(&child) {
                    Ok(tree) => tree,
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(error);
                    }
                };
                let output = child
                    .stdout
                    .take()
                    .ok_or("Canal do downloader indisponível.")?;
                let progress = Arc::new(Mutex::new(Progress::default()));
                let sink = Arc::clone(&progress);
                let reader = thread::spawn(move || {
                    let mut reader = BufReader::new(output);
                    while let Ok(Some(line)) = crate::native_app::read_protocol_line(&mut reader) {
                        if let Ok(event) = serde_json::from_str::<Value>(&line) {
                            if let Ok(mut state) = sink.lock() {
                                if matches!(
                                    event["event"].as_str(),
                                    Some("track_done" | "track_skipped")
                                ) && state.events.len() < 2000
                                {
                                    state.events.push(event.clone());
                                    state.done = state.done.saturating_add(1);
                                    state.latest = event.clone();
                                }
                                state.last = event;
                            }
                        }
                    }
                });
                self.last_download = json!({"state":"running","url":url,"uri":uri,"kind":kind,"job_id":crate::model::now_ms(),"completed_tracks":0,"total_tracks":if kind == "track" {1} else {params["total_tracks"].as_u64().unwrap_or(0).min(2000)}});
                self.download = Some(Download {
                    child,
                    started: std::time::Instant::now(),
                    progress,
                    reader: Some(reader),
                    tree: Some(tree),
                    temporary: temp,
                    source_uri: uri,
                    play_after: params["play_after"].as_bool().unwrap_or(false),
                });
            }
            "cancel_download" => {
                if let Some(download) = self.download.as_mut() {
                    download.play_after = false;
                    download.tree.take();
                    let _ = download.child.kill();
                    let _ = download.child.wait();
                    self.poll_download();
                    self.last_download["state"] = json!("cancelled");
                }
            }
            "scan_local" => {
                self.revision = self.revision.saturating_add(1);
                let mut folders = vec![self.directory.join("audio")];
                let mut seen = 0;
                while let Some(folder) = folders.pop() {
                    let Ok(entries) = fs::read_dir(folder) else {
                        continue;
                    };
                    for item in entries.flatten() {
                        seen += 1;
                        if seen > 5000 {
                            break;
                        }
                        let path = item.path();
                        let Ok(kind) = item.file_type() else { continue };
                        if kind.is_symlink() {
                            continue;
                        }
                        if kind.is_dir() {
                            folders.push(path);
                        } else {
                            let title = path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("Áudio local");
                            self.add_file(&path, title, "");
                        }
                    }
                    if seen > 5000 {
                        break;
                    }
                }
                self.save()?;
            }
            "play_local" => {
                let id = params["id"].as_u64().ok_or("Selecione um áudio local.")?;
                let track = self
                    .tracks
                    .iter()
                    .find(|track| track.id == id)
                    .ok_or("Áudio não encontrado.")?;
                let path = track
                    .path
                    .canonicalize()
                    .map_err(|_| "O arquivo de áudio não está mais disponível.")?;
                if !path.starts_with(
                    self.directory
                        .join("audio")
                        .canonicalize()
                        .map_err(|e| e.to_string())?,
                ) {
                    return Err("Arquivo fora da biblioteca local.".into());
                }
                let audio = crate::audio::Player::open(&path, self.volume)?;
                if params["resume"] == true
                    && self.session.track_id == Some(id)
                    && self.session.position_ms < self.session.duration_ms
                {
                    audio.seek(self.session.position_ms)?;
                }
                self.audio = Some(audio);
                self.current = Some(id);
                if let Some(track) = self.tracks.iter_mut().find(|t| t.id == id) {
                    if params["artwork"].as_str() == Some("") {
                        track.artwork.clear();
                    }
                    if let Some(art) = params["artwork"]
                        .as_str()
                        .filter(|url| crate::spotify::safe_artwork(url))
                    {
                        track.artwork = art.into();
                    }
                    if let Some(uri) = params["track_uri"].as_str().filter(|uri| {
                        crate::music_search::video_id(uri).is_some()
                            || crate::spotify::normalize_link(uri)
                                .is_ok_and(|(_, _, kind)| kind == "track")
                    }) {
                        track.track_uri = uri.into();
                    }
                }
                self.revision = self.revision.saturating_add(1);
                let _ = self.save();
            }
            "pause" => {
                self.audio.as_ref().ok_or("Selecione uma faixa.")?.pause();
            }
            "resume" => {
                if self.audio.is_none() {
                    let id = self.current.ok_or("Selecione uma faixa.")?;
                    return self.handle("play_local", &json!({"id":id,"resume":true}));
                }
                self.audio.as_ref().ok_or("Selecione uma faixa.")?.resume();
            }
            "stop" => {
                self.audio = None;
                self.current = None;
            }
            "seek" => {
                let position = params["position_ms"]
                    .as_u64()
                    .ok_or("Posição inválida.")?
                    .min(86_400_000);
                if let Some(audio) = &self.audio {
                    audio.seek(position)?;
                } else if self.current.is_some() && self.session.duration_ms > 0 {
                    self.session.position_ms = position.min(self.session.duration_ms);
                } else {
                    return Err("Selecione uma faixa.".into());
                }
            }
            "volume" => {
                self.volume = params["value"].as_u64().ok_or("Volume inválido.")?.min(100) as u32;
                if let Some(audio) = &self.audio {
                    audio.volume(self.volume);
                }
            }
            "presence_config" => self.presence.configure(params)?,
            _ => return Err("Operação de áudio desconhecida.".into()),
        }
        if matches!(
            method,
            "volume" | "play_local" | "pause" | "stop" | "seek" | "delete_local"
        ) {
            self.checkpoint()?;
        }
        Ok(())
    }
    fn checkpoint(&mut self) -> Result<(), String> {
        if let Some(audio) = &self.audio {
            let (_, position, duration) = audio.snapshot();
            self.session.position_ms = position;
            self.session.duration_ms = duration;
        } else if self.current != self.session.track_id || self.current.is_none() {
            self.session.position_ms = 0;
            self.session.duration_ms = 0;
        }
        self.session.track_id = self.current;
        self.session.volume = self.volume;
        self.session.save(&self.directory)?;
        self.checkpoint_at = std::time::Instant::now();
        Ok(())
    }
}
impl Drop for Music {
    fn drop(&mut self) {
        let _ = self.checkpoint();
        self.audio = None;
        if let Some(mut download) = self.download.take() {
            let _ = download.child.kill();
            let _ = download.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn playlist_download_can_be_reused_by_track_id_after_restart() {
        let dir = std::env::temp_dir().join(format!(
            "mare-manifest-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        let mut music = Music::new(&dir).unwrap();
        let album = dir.join("audio").join("Test album");
        fs::create_dir(&album).unwrap();
        let file = album.join("same name.mp3");
        fs::write(&file, [0; 16]).unwrap();
        assert!(music.add_file(&file, "Song", "Artist"));
        music.tracks[0].source_uri = "spotify:album:0000000000000000000002".into();
        music.save().unwrap();
        drop(music);
        let id = "0000000000000000000001";
        fs::write(album.join(".sunnify-manifest.jsonl"), format!("broken\n{{\"id\":\"{id}\",\"file\":\"same name.mp3\"}}\n{{\"id\":\"0000000000000000000003\",\"file\":\"../same name.mp3\"}}\n")).unwrap();
        let mut music = Music::new(&dir).unwrap();
        let uri = format!("spotify:track:{id}");
        music.handle("download", &json!({"url":uri})).unwrap();
        let state = music.snapshot();
        assert_eq!(state["local_tracks"][0]["track_uri"], uri);
        assert_eq!(state["download"]["cached"], true);
        assert_eq!(state["download"]["ready_track_id"], 1);
        assert!(state["downloader_pid"].is_null());
        drop(music);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn spotify_identity_updates_and_persists_download_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "mare-catalog-audio-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        let mut music = Music::new(&dir).unwrap();
        let file = dir.join("audio/own-metadata-fixture.wav");
        fs::write(&file, []).unwrap();
        let uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
        music.tracks.push(Track {
            id: 1,
            title: "Extractor title".into(),
            artists: "Channel".into(),
            path: file,
            source_uri: uri.into(),
            track_uri: String::new(),
            artwork: String::new(),
        });
        music.catalog_track(
            uri,
            "Canonical song",
            "Canonical artist",
            "https://i.scdn.co/image/own-fixture",
        );
        let state = music.snapshot();
        assert_eq!(state["local_tracks"][0]["title"], "Canonical song");
        assert_eq!(state["local_tracks"][0]["artists"], "Canonical artist");
        assert_eq!(
            state["local_tracks"][0]["artwork"],
            "https://i.scdn.co/image/own-fixture"
        );
        let revision = state["library_revision"].clone();
        music.sync_artwork(&BTreeMap::from([(
            uri.into(),
            "https://i.scdn.co/image/different-resolution".into(),
        )]));
        assert_eq!(music.snapshot()["library_revision"], revision);
        drop(music);
        let mut restored = Music::new(&dir).unwrap();
        assert_eq!(
            restored.snapshot()["local_tracks"][0]["artists"],
            "Canonical artist"
        );
        drop(restored);
        fs::remove_dir_all(dir).unwrap();
    }
}
