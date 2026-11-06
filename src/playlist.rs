//! Cached public playlist metadata; no audio is downloaded by this operation.
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
pub struct Catalog {
    directory: PathBuf,
    active: Value,
    job: Option<mpsc::Receiver<Result<Value, String>>>,
}
impl Catalog {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.into(),
            active: Value::Null,
            job: None,
        }
    }
    fn path(&self, uri: &str) -> PathBuf {
        self.directory
            .join(format!("playlist-{}.json", uri.replace(':', "-")))
    }
    pub fn open(&mut self, input: &str, refresh: bool) -> Result<(), String> {
        let (uri, url, kind) = crate::spotify::normalize_link(input)?;
        if !matches!(kind.as_str(), "playlist" | "album") {
            return Err("Selecione uma playlist ou álbum.".into());
        }
        if self.job.is_some() {
            return Err("Aguarde a leitura da playlist atual.".into());
        }
        if !refresh {
            if let Ok(bytes) = fs::read(self.path(&uri)) {
                if bytes.len() <= 2_000_000 {
                    if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                        if v["uri"] == uri
                            && v["state"] == "ready"
                            && v["tracks"]
                                .as_array()
                                .is_some_and(|items| items.len() <= 2000)
                        {
                            self.active = v;
                            return Ok(());
                        }
                    }
                }
            }
        }
        let executable = crate::components::executable("sunnify")
            .ok_or("O componente de metadados não acompanha este pacote.")?;
        let runtime = self.directory.join("runtime");
        fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        let (tx, rx) = mpsc::channel();
        self.job = Some(rx);
        self.active = json!({"uri":uri,"state":"loading","tracks":[]});
        std::thread::spawn(move || {
            let result = (|| -> Result<Value, String> {
                use std::os::windows::process::CommandExt;
                let mut child = Command::new(executable)
                    .args(["info", &url, "--json"])
                    .env("APPDATA", &runtime)
                    .env("LOCALAPPDATA", &runtime)
                    .env("TEMP", &runtime)
                    .env("TMP", &runtime)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .creation_flags(0x08004000)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                let _tree = crate::components::ProcessTree::new(&child)?;
                let mut stdout = child
                    .stdout
                    .take()
                    .ok_or("Canal de metadados indisponível.")?;
                let reader = std::thread::spawn(move || {
                    let mut bytes = Vec::new();
                    stdout
                        .by_ref()
                        .take(2_000_001)
                        .read_to_end(&mut bytes)
                        .map(|_| bytes)
                });
                let deadline = Instant::now() + Duration::from_secs(45);
                let status = loop {
                    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                        break status;
                    }
                    if Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(
                            "A leitura da playlist excedeu 45 segundos. Tente atualizar.".into(),
                        );
                    }
                    std::thread::sleep(Duration::from_millis(50));
                };
                let bytes = reader
                    .join()
                    .map_err(|_| "Falha na leitura de metadados.")?
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 2_000_000 {
                    return Err("Esta playlist excede o limite de metadados.".into());
                }
                let v: Value =
                    serde_json::from_slice(&bytes).map_err(|_| "Resposta de playlist inválida.")?;
                if !status.success() {
                    return Err(v["message"]
                        .as_str()
                        .unwrap_or("A playlist precisa ser pública e acessível.")
                        .into());
                }
                let tracks = v["tracks"]
                    .as_array()
                    .ok_or("Não foram retornadas faixas.")?;
                if tracks.len() > 2000 {
                    return Err("Esta versão aceita até 2000 faixas por playlist.".into());
                }
                let mut normalized = Vec::new();
                for t in tracks {
                    let id = t["id"].as_str().unwrap_or("");
                    if crate::spotify::normalize_link(&format!("spotify:track:{id}")).is_err() {
                        continue;
                    }
                    normalized.push(json!({"uri":format!("spotify:track:{id}"),"title":t["title"].as_str().unwrap_or("").chars().take(300).collect::<String>(),"artists":t["artists"].as_str().unwrap_or("").chars().take(200).collect::<String>(),"duration_ms":t["duration_ms"].as_u64().unwrap_or(0)}));
                }
                Ok(
                    json!({"uri":uri,"state":"ready","name":v["name"],"owner":v["owner"],"tracks":normalized}),
                )
            })();
            let _ = tx.send(result);
        });
        Ok(())
    }
    pub fn snapshot(&mut self) -> Value {
        if let Some(result) = self.job.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.job = None;
            match result {
                Ok(v) => {
                    let uri = v["uri"].as_str().unwrap_or("");
                    let path = self.path(uri);
                    let temp = path.with_extension("tmp");
                    match serde_json::to_vec(&v)
                        .map_err(|e| e.to_string())
                        .and_then(|bytes| {
                            fs::write(&temp, bytes)
                                .and_then(|()| fs::rename(&temp, path))
                                .map_err(|e| e.to_string())
                        }) {
                        Ok(()) => self.active = v,
                        Err(e) => {
                            self.active["state"] = json!("error");
                            self.active["error"] = json!(e);
                        }
                    }
                }
                Err(e) => {
                    self.active["state"] = json!("error");
                    self.active["error"] = json!(e);
                }
            }
        }
        self.active.clone()
    }
}
