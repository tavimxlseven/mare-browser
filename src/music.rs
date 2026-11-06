//! Native local audio and a short-lived, unmodified Sunnify CLI subprocess.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
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
}
#[derive(Default)]
struct Progress {
    events: Vec<Value>,
    last: Value,
}
struct Download {
    child: Child,
    progress: Arc<Mutex<Progress>>,
    reader: Option<thread::JoinHandle<()>>,
    tree: Option<crate::components::ProcessTree>,
    temporary: PathBuf,
}
pub struct Music {
    directory: PathBuf,
    tracks: Vec<Track>,
    download: Option<Download>,
    last_download: Value,
    current: Option<u64>,
    volume: u32,
    revision: u64,
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
            volume: 80,
            revision: 0,
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
        });
        self.revision = self.revision.saturating_add(1);
        true
    }
    fn poll_download(&mut self) {
        let Some(download) = self.download.as_mut() else {
            return;
        };
        let finished = download.child.try_wait().ok().flatten();
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
            }
        }
        if changed {
            if let Err(error) = self.save() {
                self.last_download["error"] = json!(error);
            }
        }
        if let Some(status) = finished {
            self.last_download["state"] = json!(if status.success() {
                "completed"
            } else {
                "failed"
            });
            self.last_download["exit_code"] = json!(status.code());
            self.download = None;
        }
    }
    pub fn snapshot(&mut self) -> Value {
        self.snapshot_since(None)
    }
    pub fn snapshot_since(&mut self, known_revision: Option<u64>) -> Value {
        self.poll_download();
        let mode = if self.current.is_some() {
            mci("status mare_audio mode").unwrap_or_else(|_| "stopped".into())
        } else {
            "stopped".into()
        };
        let position = mci("status mare_audio position")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let duration = mci("status mare_audio length")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let track = self
            .current
            .and_then(|id| self.tracks.iter().find(|t| t.id == id));
        self.presence.update(
            track.map(|t| (t.title.as_str(), t.artists.as_str())),
            mode == "playing",
            position,
            duration,
        );
        let mut snapshot = json!({"library_revision":self.revision,"player":{"track_id":self.current,"state":mode,"position_ms":position,"duration_ms":duration,"volume":self.volume},"download":self.last_download,"sunnify_available":crate::components::executable("sunnify").is_some(),"downloader_pid":self.download.as_ref().map(|d|d.child.id()),"presence":self.presence.snapshot()});
        if known_revision != Some(self.revision) {
            snapshot["local_tracks"]=json!(self.tracks.iter().map(|t|json!({"id":t.id,"title":t.title,"artists":t.artists,"available":t.path.is_file()})).collect::<Vec<_>>());
        }
        snapshot
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<(), String> {
        self.poll_download();
        match method {
            "download" => {
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
                command.creation_flags(0x0800_0000);
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
                                }
                                state.last = event;
                            }
                        }
                    }
                });
                self.last_download = json!({"state":"running","url":url});
                self.download = Some(Download {
                    child,
                    progress,
                    reader: Some(reader),
                    tree: Some(tree),
                    temporary: temp,
                });
            }
            "cancel_download" => {
                if let Some(mut download) = self.download.take() {
                    let _ = download.child.kill();
                    let _ = download.child.wait();
                    drop(download);
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
                let _ = mci("close mare_audio");
                mci(&format!(
                    "open \"{}\" type mpegvideo alias mare_audio",
                    path.display()
                ))?;
                mci("set mare_audio time format milliseconds")?;
                mci(&format!(
                    "setaudio mare_audio volume to {}",
                    self.volume * 10
                ))?;
                mci("play mare_audio")?;
                self.current = Some(id);
            }
            "pause" => {
                mci("pause mare_audio")?;
            }
            "resume" => {
                mci("play mare_audio")?;
            }
            "stop" => {
                let _ = mci("close mare_audio");
                self.current = None;
            }
            "seek" => {
                let position = params["position_ms"]
                    .as_u64()
                    .ok_or("Posição inválida.")?
                    .min(86_400_000);
                let playing = mci("status mare_audio mode")? == "playing";
                mci(&format!("seek mare_audio to {position}"))?;
                if playing {
                    mci("play mare_audio")?;
                }
            }
            "volume" => {
                self.volume = params["value"].as_u64().ok_or("Volume inválido.")?.min(100) as u32;
                if self.current.is_some() {
                    mci(&format!(
                        "setaudio mare_audio volume to {}",
                        self.volume * 10
                    ))?;
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
        let _ = mci("close mare_audio");
        if let Some(mut download) = self.download.take() {
            let _ = download.child.kill();
            let _ = download.child.wait();
        }
    }
}
fn mci(command: &str) -> Result<String, String> {
    use windows::{
        core::HSTRING,
        Win32::Media::Multimedia::{mciGetErrorStringW, mciSendStringW},
    };
    unsafe {
        let mut response = [0u16; 512];
        let code = mciSendStringW(&HSTRING::from(command), Some(&mut response), None);
        if code != 0 {
            let mut message = [0u16; 256];
            let _ = mciGetErrorStringW(code, &mut message);
            return Err(format!(
                "Áudio: {}",
                String::from_utf16_lossy(
                    &message[..message
                        .iter()
                        .position(|c| *c == 0)
                        .unwrap_or(message.len())]
                )
            ));
        }
        Ok(String::from_utf16_lossy(
            &response[..response
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(response.len())],
        )
        .trim()
        .into())
    }
}
