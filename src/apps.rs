//! Bundled, allowlisted native apps. No executable is downloaded or selected by a manifest.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use crate::native_app::{read_protocol_line, MAX_MESSAGE_BYTES};

#[derive(Clone, Debug, Serialize)]
pub struct AppEvent {
    pub app_id: String,
    pub instance_id: u64,
    pub kind: String,
    pub payload: Value,
}

struct RunningApp {
    id: String,
    instance_id: u64,
    child: Child,
    requests: mpsc::SyncSender<String>,
}

pub struct AppManager {
    directory: PathBuf,
    installed: BTreeSet<String>,
    running: BTreeMap<String, RunningApp>,
    active_id: Option<String>,
    open_order: Vec<String>,
    stopping: BTreeMap<u64, (String, u32)>,
    reapers: Vec<thread::JoinHandle<()>>,
    next_instance: u64,
    next_request: u64,
    callback: Arc<dyn Fn(AppEvent) + Send + Sync>,
    responses: BTreeMap<String, AppEvent>,
}

fn available(id: &str) -> bool {
    matches!(id, "notes" | "calculator" | "spotify" | "discord")
}

impl AppManager {
    pub fn new(
        data_dir: &Path,
        on_event: impl Fn(AppEvent) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let directory = data_dir.join("apps");
        fs::create_dir_all(&directory).map_err(|e| format!("Falha ao preparar os apps: {e}"))?;
        let directory = directory
            .canonicalize()
            .map_err(|e| format!("Falha ao resolver a pasta dos apps: {e}"))?;
        let installed_path = directory.join("installed.json");
        let installed = match fs::read(&installed_path) {
            Ok(bytes) => {
                if bytes.len() > 65_536 {
                    return Err("O registro de apps excede o limite permitido.".into());
                }
                let ids: Vec<String> = serde_json::from_slice(&bytes).map_err(|_| {
                    "O registro de apps está inválido e foi preservado.".to_string()
                })?;
                ids.into_iter().filter(|id| available(id)).collect()
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeSet::new(),
            Err(error) => return Err(format!("Falha ao ler o registro de apps: {error}")),
        };
        Ok(Self {
            directory,
            installed,
            running: BTreeMap::new(),
            active_id: None,
            open_order: Vec::new(),
            stopping: BTreeMap::new(),
            reapers: Vec::new(),
            next_instance: 1,
            next_request: 1,
            callback: Arc::new(on_event),
            responses: BTreeMap::new(),
        })
    }

    pub fn snapshot(&self) -> Value {
        let mut catalog: Vec<Value> =
            serde_json::from_str(include_str!("../assets/apps/catalog.json")).unwrap_or_default();
        for app in &mut catalog {
            let id = app["id"].as_str().unwrap_or("").to_string();
            let running = self.running.get(&id);
            app["installed"] = json!(self.installed.contains(&id));
            app["running"] = json!(running.is_some());
            app["pid"] = running
                .map(|app| json!(app.child.id()))
                .unwrap_or(Value::Null);
        }
        let mut running: Vec<Value> = self
            .open_order
            .iter()
            .filter_map(|id| self.running.get(id))
            .map(|app| json!({"id":app.id,"pid":app.child.id(),"status":"running"}))
            .collect();
        let open: Vec<Value> = self
            .open_order
            .iter()
            .filter_map(|id| catalog.iter().find(|app| app["id"].as_str() == Some(id)))
            .cloned()
            .collect();
        let stopping: Vec<Value> = self
            .stopping
            .values()
            .map(|(id, pid)| json!({"id":id,"pid":pid,"status":"stopping"}))
            .collect();
        running.extend(stopping.iter().cloned());
        json!({
            "catalog": catalog,
            "active_id": self.active_id,
            "open": open,
            "open_ids": self.open_order,
            "running": running,
            "process_count": self.running.len() + self.stopping.len(),
            "stopping": stopping,
            "last_response": self.active_id.as_ref().and_then(|id|self.responses.get(id)),
            "responses": self.responses,
            "protocol_version": 1
        })
    }

    pub fn install(&mut self, id: &str) -> Result<(), String> {
        if !available(id) {
            return Err("Este app não está disponível para instalação.".into());
        }
        let mut installed = self.installed.clone();
        installed.insert(id.into());
        self.save_installed(&installed)?;
        self.installed = installed;
        Ok(())
    }

    pub fn uninstall(&mut self, id: &str) -> Result<(), String> {
        if !available(id) {
            return Err("App desconhecido.".into());
        }
        self.close(id);
        let mut installed = self.installed.clone();
        installed.remove(id);
        self.save_installed(&installed)?;
        self.installed = installed;
        // Keep user documents; uninstall never silently deletes a notebook.
        Ok(())
    }

    fn save_installed(&self, installed: &BTreeSet<String>) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(installed).map_err(|e| e.to_string())?;
        let temporary = self
            .directory
            .join(format!(".installed-{}.tmp", std::process::id()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, self.directory.join("installed.json"))
        })();
        result.map_err(|e| format!("Falha ao salvar o registro de apps: {e}"))
    }

    pub fn start(&mut self, id: &str) -> Result<(), String> {
        self.collect_reapers();
        if !available(id) || !self.installed.contains(id) {
            return Err("Instale um app disponível antes de abri-lo.".into());
        }
        if self
            .stopping
            .values()
            .any(|(stopping_id, _)| stopping_id == id)
        {
            return Err(
                "O app ainda está salvando e encerrando. Abra novamente em instantes.".into(),
            );
        }
        if self.running.contains_key(id) {
            self.active_id = Some(id.into());
            return Ok(());
        }
        let app_directory = self.directory.join(id);
        fs::create_dir_all(&app_directory).map_err(|e| e.to_string())?;
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut command = Command::new(executable);
        command
            .arg("--native-app")
            .arg(id)
            .arg("--data-dir")
            .arg(&app_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, not a second browser window.
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Falha ao iniciar o app: {e}"))?;
        let Some(mut input) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("O app não disponibilizou o canal de entrada.".into());
        };
        let Some(output) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("O app não disponibilizou o canal de saída.".into());
        };
        let instance_id = self.next_instance;
        self.next_instance = self.next_instance.saturating_add(1);
        let (requests, receiver) = mpsc::sync_channel::<String>(32);
        let write_callback = Arc::clone(&self.callback);
        let app_id = id.to_string();
        thread::spawn(move || {
            for request in receiver {
                if input
                    .write_all(request.as_bytes())
                    .and_then(|()| input.write_all(b"\n"))
                    .and_then(|()| input.flush())
                    .is_err()
                {
                    write_callback(AppEvent {
                        app_id,
                        instance_id,
                        kind: "exited".into(),
                        payload: json!({"error":"O canal do app foi encerrado."}),
                    });
                    break;
                }
            }
        });
        let read_callback = Arc::clone(&self.callback);
        let app_id = id.to_string();
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            let failure = loop {
                match read_protocol_line(&mut reader) {
                    Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(payload) if payload.is_object() => read_callback(AppEvent {
                            app_id: app_id.clone(),
                            instance_id,
                            kind: "response".into(),
                            payload,
                        }),
                        _ => break Some("O app enviou uma resposta inválida."),
                    },
                    Ok(None) => break None,
                    Err(_) => {
                        break Some("O app excedeu o limite do protocolo ou encerrou a conexão.")
                    }
                }
            };
            read_callback(AppEvent {
                app_id,
                instance_id,
                kind: "exited".into(),
                payload: json!({"error":failure}),
            });
        });
        self.running.insert(
            id.into(),
            RunningApp {
                id: id.into(),
                instance_id,
                child,
                requests,
            },
        );
        self.active_id = Some(id.into());
        self.open_order.push(id.into());
        self.responses.remove(id);
        let method = if id == "notes" || id == "spotify" {
            "list"
        } else {
            "hello"
        };
        self.request(id, method, json!({}))?;
        Ok(())
    }

    /// Select the last web tab without closing any native app tab.
    pub fn deactivate(&mut self) {
        self.active_id = None;
    }

    /// Close exactly one native app tab, preserving every other worker and web tab.
    pub fn close(&mut self, app_id: &str) {
        self.collect_reapers();
        if let Some(app) = self.running.remove(app_id) {
            self.open_order.retain(|id| id != app_id);
            self.responses.remove(app_id);
            if self.active_id.as_deref() == Some(app_id) {
                self.active_id = None;
            }
            let RunningApp {
                id,
                instance_id,
                mut child,
                requests,
            } = app;
            self.stopping.insert(instance_id, (id.clone(), child.id()));
            // Dropping the sender lets the writer drain queued saves, then close stdin.
            // The app consumes those requests before exiting on EOF. Reaping never blocks the UI.
            drop(requests);
            let callback = Arc::clone(&self.callback);
            self.reapers.push(thread::spawn(move || {
                let deadline = Instant::now()
                    + Duration::from_millis(if id == "discord" { 3500 } else { 750 });
                let mut forced = false;
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        _ if Instant::now() >= deadline => {
                            forced = true;
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        _ => thread::sleep(Duration::from_millis(10)),
                    }
                }
                callback(AppEvent {
                    app_id: id,
                    instance_id,
                    kind: "exited".into(),
                    payload: json!({"error":null,"forced":forced,"reaped":true}),
                });
            }));
        }
    }

    /// Full browser shutdown: wait for every outstanding child reaper before the event loop exits.
    pub fn shutdown(&mut self) {
        let ids: Vec<String> = self.running.keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
        for reaper in self.reapers.drain(..) {
            let _ = reaper.join();
        }
        self.stopping.clear();
        self.active_id = None;
    }

    fn collect_reapers(&mut self) {
        let mut index = 0;
        while index < self.reapers.len() {
            if self.reapers[index].is_finished() {
                let _ = self.reapers.swap_remove(index).join();
            } else {
                index += 1;
            }
        }
    }

    pub fn request(&mut self, id: &str, method: &str, params: Value) -> Result<u64, String> {
        let request_id = self.next_request;
        self.next_request = self.next_request.saturating_add(1);
        self.request_with_id(id, request_id, method, params)?;
        Ok(request_id)
    }

    pub fn request_with_id(
        &mut self,
        id: &str,
        request_id: u64,
        method: &str,
        params: Value,
    ) -> Result<(), String> {
        let app = self
            .running
            .get(id)
            .ok_or("Abra o app antes de enviar uma operação.")?;
        if method.len() > 48 || !params.is_object() {
            return Err("Operação de app inválida.".into());
        }
        let message =
            serde_json::to_string(&json!({"id":request_id,"method":method,"params":params}))
                .map_err(|e| e.to_string())?;
        if message.len() > MAX_MESSAGE_BYTES {
            return Err("A operação excede o limite do app.".into());
        }
        app.requests.try_send(message).map_err(|error| match error {
            mpsc::TrySendError::Full(_) => "O app está ocupado. Tente novamente.".into(),
            mpsc::TrySendError::Disconnected(_) => "O app encerrou sua conexão.".into(),
        })
    }

    pub fn handle_event(&mut self, event: &AppEvent) -> bool {
        self.collect_reapers();
        if self
            .stopping
            .get(&event.instance_id)
            .is_some_and(|(id, _)| id == &event.app_id)
        {
            if event.kind == "exited" && event.payload["reaped"] == true {
                self.stopping.remove(&event.instance_id);
                return true;
            }
            return false;
        }
        if !self
            .running
            .get(&event.app_id)
            .is_some_and(|app| app.instance_id == event.instance_id)
        {
            return false;
        }
        if event.kind == "exited" {
            self.close(&event.app_id);
        } else if event.kind == "response" {
            self.responses.insert(event.app_id.clone(), event.clone());
        }
        true
    }
}

impl Drop for AppManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_available_bundled_apps_can_be_installed_and_registration_is_persistent() {
        let directory = std::env::temp_dir().join(format!(
            "mare-apps-test-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        let mut manager = AppManager::new(&directory, |_| {}).unwrap();
        assert!(manager.install("../other.exe").is_err());
        assert!(manager.install("unknown-app").is_err());
        manager.install("notes").unwrap();
        assert_eq!(manager.snapshot()["process_count"], 0);
        drop(manager);
        let mut restored = AppManager::new(&directory, |_| {}).unwrap();
        assert!(restored.snapshot()["catalog"]
            .as_array()
            .unwrap()
            .iter()
            .any(|app| app["id"] == "notes" && app["installed"] == true));
        let documents = directory.join("apps/notes");
        fs::create_dir_all(&documents).unwrap();
        fs::write(documents.join("notes.json"), "keep user notes").unwrap();
        restored.uninstall("notes").unwrap();
        assert!(documents.join("notes.json").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
