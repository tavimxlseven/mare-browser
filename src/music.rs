//! Native local audio and a short-lived, unmodified Sunnify CLI subprocess.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::BufReader,
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
    download: Option<Download>,
    last_download: Value,
    current: Option<u64>,
    audio: Option<crate::audio::Player>,
    volume: u32,
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
impl Music {
    pub fn sync_artwork(&mut self, covers: &std::collections::BTreeMap<String, String>) {
        let mut changed = false;
        for t in &mut self.tracks {
            if let Some(url) = covers.get(if t.track_uri.is_empty() {
                &t.source_uri
            } else {
                &t.track_uri
            }) {
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
        Ok(Self {
            directory: directory.into(),
            tracks,
            download: None,
            last_download: json!({"state":"idle"}),
            current: None,
            audio: None,
            volume: 80,
            revision: 0,
            completed: match fs::read(directory.join("completed-downloads.json")) {
                Ok(bytes) if bytes.len() <= 131072 => serde_json::from_slice(&bytes)
                    .map_err(|_| "Registro de downloads inválido; arquivo preservado.")?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeSet::new(),
                _ => return Err("Não foi possível ler o registro de downloads.".into()),
            },
            presence: crate::presence::Presence::new(directory),
        })
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
        let source_uri = download.source_uri.clone();
        let play_after = download.play_after;
        if finished.is_some() {
            if let Some(reader) = download.reader.take() {
                let _ = reader.join();
            }
        }
        let (events, last) = if let Ok(mut progress) = download.progress.lock() {
            (std::mem::take(&mut progress.events), progress.last.clone())
        } else {
            (Vec::new(), Value::Null)
        };
        if !last.is_null() {
            self.last_download["event"] = last;
        }
        if let Ok(progress) = download.progress.lock() {
            self.last_download["completed_tracks"] = json!(progress.done);
            self.last_download["last_track"] = progress.latest.clone();
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
                        if track.source_uri.is_empty() {
                            track.source_uri = source_uri.clone();
                            changed = true;
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
            let confirmed = status.success()
                && self
                    .tracks
                    .iter()
                    .any(|t| t.source_uri == source_uri && t.path.is_file());
            self.last_download["state"] = json!(if confirmed { "completed" } else { "failed" });
            self.last_download["exit_code"] = json!(status.code());
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
        let (mode, position, duration) = self
            .audio
            .as_ref()
            .map(|p| p.snapshot())
            .unwrap_or(("stopped", 0, 0));
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
        if known_revision != Some(self.revision) {
            snapshot["completed_sources"] = json!(self.completed);
            snapshot["local_tracks"]=json!(self.tracks.iter().map(|t|json!({"id":t.id,"title":t.title,"artists":t.artists,"source_uri":t.source_uri,"track_uri":t.track_uri,"artwork":t.artwork,"available":t.path.is_file()})).collect::<Vec<_>>());
        }
        snapshot
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<(), String> {
        self.poll_download();
        match method {
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
                let (uri, _, _) =
                    crate::spotify::normalize_link(params["url"].as_str().unwrap_or(""))?;
                if let Some(download) = self.download.as_mut().filter(|d| d.source_uri == uri) {
                    download.play_after |= params["play_after"].as_bool().unwrap_or(false);
                    return Ok(());
                }
                if self.completed.contains(&uri)
                    && self
                        .tracks
                        .iter()
                        .any(|t| t.source_uri == uri && t.path.is_file())
                {
                    if params["play_after"].as_bool() == Some(true) {
                        let id = self.tracks.iter().find(|t| t.source_uri == uri).unwrap().id;
                        self.handle("play_local", &json!({"id":id}))?;
                    }
                    return Ok(());
                }
                if self.download.is_some() {
                    return Err("Já existe um download em andamento. Cancele ou aguarde.".into());
                }
                let (_, url, kind) =
                    crate::spotify::normalize_link(params["url"].as_str().unwrap_or(""))?;
                if !matches!(kind.as_str(), "track" | "album" | "playlist") {
                    return Err("Baixe uma faixa, álbum ou playlist.".into());
                }
                let executable = crate::components::executable("sunnify")
                    .ok_or("O componente Sunnify não acompanha este pacote.")?;
                let runtime = self.directory.join("runtime");
                let temp = runtime.join("tmp").join(format!(
                    "job-{}-{}",
                    std::process::id(),
                    crate::model::now_ms()
                ));
                fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
                let mut command = Command::new(executable);
                command
                    .args(["download", &url, "--out"])
                    .arg(self.directory.join("audio"))
                    .args([
                        "--format",
                        "mp3",
                        "--quality",
                        "192",
                        "--no-loose-match",
                        "--json",
                    ])
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
                self.last_download = json!({"state":"running","url":url,"completed_tracks":0,"total_tracks":params["total_tracks"].as_u64().unwrap_or(0).min(2000)});
                self.download = Some(Download {
                    child,
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
                        crate::spotify::normalize_link(uri)
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
                self.audio
                    .as_ref()
                    .ok_or("Selecione uma faixa.")?
                    .seek(position)?;
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
        Ok(())
    }
}
impl Drop for Music {
    fn drop(&mut self) {
        self.audio = None;
        if let Some(mut download) = self.download.take() {
            let _ = download.child.kill();
            let _ = download.child.wait();
        }
    }
}
