//! Independent public music search. Helpers run only for a bounded request.
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
pub fn video_id(uri: &str) -> Option<&str> {
    uri.strip_prefix("youtube:video:").filter(|id| {
        id.len() == 11
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
pub fn command(directory: &Path) -> Result<Command, String> {
    let executable = crate::components::executable("yt-dlp")
        .ok_or("O componente de busca não acompanha este pacote.")?;
    let runtime = directory.join("runtime/search");
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let mut command = Command::new(executable);
    command
        .args([
            "--ignore-config",
            "--no-cache-dir",
            "--no-warnings",
            "--encoding",
            "utf-8",
            "--socket-timeout",
            "10",
            "--retries",
            "1",
        ])
        .env("TEMP", &runtime)
        .env("TMP", &runtime)
        .env("DENO_DIR", runtime.join("deno"));
    if let Some(deno) = crate::components::executable("deno") {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    }
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08004000);
    Ok(command)
}
pub struct Search {
    directory: PathBuf,
    query: String,
    result: Value,
    job: Option<mpsc::Receiver<(String, Result<Value, String>)>>,
    revision: u64,
}
impl Search {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.into(),
            query: String::new(),
            result: json!({"state":"idle","items":[]}),
            job: None,
            revision: 0,
        }
    }
    pub fn request(&mut self, query: &str) -> Result<(), String> {
        let query = query.trim();
        if query.chars().count() > 120 {
            return Err("Pesquise usando até 120 caracteres.".into());
        }
        if query == self.query && self.result["state"] == "ready" {
            return Ok(());
        }
        self.query = query.into();
        self.revision += 1;
        self.result = json!({"state":if query.is_empty(){"idle"}else{"loading"},"query":query,"items":[],"provider":"YouTube"});
        if self.job.is_none() && !query.is_empty() {
            self.start()?
        }
        Ok(())
    }
    fn start(&mut self) -> Result<(), String> {
        let query = self.query.clone();
        let mut command = command(&self.directory)?;
        command
            .args([
                "--flat-playlist",
                "--dump-single-json",
                "--skip-download",
                "--playlist-end",
                "25",
            ])
            .arg(format!("ytsearch25:{query} music"));
        let (tx, rx) = mpsc::channel();
        self.job = Some(rx);
        std::thread::spawn(move || {
            let result = (|| -> Result<Value, String> {
                let mut child = command
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|e| e.to_string())?;
                let _tree = crate::components::ProcessTree::new(&child)?;
                let mut stdout = child.stdout.take().ok_or("Busca sem resposta.")?;
                let reader = std::thread::spawn(move || {
                    let mut bytes = Vec::new();
                    stdout
                        .by_ref()
                        .take(2_000_001)
                        .read_to_end(&mut bytes)
                        .map(|_| bytes)
                });
                let deadline = Instant::now() + Duration::from_secs(40);
                let status = loop {
                    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                        break status;
                    }
                    if Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("A busca demorou demais. Tente novamente.".into());
                    }
                    std::thread::sleep(Duration::from_millis(30));
                };
                let bytes = reader
                    .join()
                    .map_err(|_| "A busca foi interrompida.")?
                    .map_err(|e| e.to_string())?;
                if !status.success() || bytes.len() > 2_000_000 {
                    return Err("Não foi possível consultar o catálogo agora.".into());
                }
                let source: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| "O catálogo retornou dados inválidos.")?;
                let items:Vec<Value>=source["entries"].as_array().into_iter().flatten().take(25).filter_map(|entry|{
                let id=entry["id"].as_str()?;let uri=format!("youtube:video:{id}");video_id(&uri)?;
                if entry["is_live"].as_bool()==Some(true){return None}
                Some(json!({"uri":uri,"url":format!("https://www.youtube.com/watch?v={id}"),"kind":"track","title":entry["title"].as_str().unwrap_or("Música").chars().take(300).collect::<String>(),"artists":entry["channel"].as_str().or(entry["uploader"].as_str()).unwrap_or("").chars().take(200).collect::<String>(),"duration_ms":(entry["duration"].as_f64().unwrap_or(0.0).clamp(0.0,86400.0)*1000.0)as u64,"thumbnail":format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")}))
            }).collect();
                Ok(json!({"state":"ready","provider":"YouTube","query":query,"items":items}))
            })();
            let _ = tx.send((query, result));
        });
        Ok(())
    }
    pub fn snapshot(&mut self) -> Value {
        if let Some(result) = self.job.as_ref().and_then(|job| job.try_recv().ok()) {
            self.job = None;
            if result.0 == self.query {
                self.result=result.1.unwrap_or_else(|error|json!({"state":"error","query":self.query,"provider":"YouTube","items":[],"error":error}));
                self.revision += 1;
            } else if !self.query.is_empty() {
                if let Err(error) = self.start() {
                    self.result = json!({"state":"error","error":error,"items":[]});
                }
            }
        }
        let mut result = self.result.clone();
        result["revision"] = json!(self.revision);
        result
    }
    pub fn track(&mut self, uri: &str) -> Result<Value, String> {
        self.snapshot()["items"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry["uri"] == uri)
            .cloned()
            .ok_or_else(|| "Pesquise e selecione uma música válida.".into())
    }
}
