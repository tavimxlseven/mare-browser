//! Optional account sync. Outbound HTTPS only; credentials are protected by Windows DPAPI.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Serialize, Deserialize)]
struct Config {
    origin: String,
    token: String,
    id: String,
    user: Value,
}
#[derive(Default)]
struct State {
    config: Option<Config>,
    connecting: bool,
    error: String,
    events: Vec<Value>,
    player: Value,
    update: Option<Value>,
    devices: Value,
    session: Value,
    commands: Value,
    revision: String,
    ack: u64,
}
pub struct Cloud {
    shared: Arc<Mutex<State>>,
    cancel: Arc<AtomicBool>,
    directory: PathBuf,
}
fn event(kind: &str, data: Value) -> Result<Value, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Não foi possível preparar a sincronização.")?;
    Ok(
        json!({"id":bytes.iter().map(|b|format!("{b:02x}")).collect::<String>(),"type":kind,"data":data}),
    )
}
pub fn origin(input: &str) -> Result<String, String> {
    let input = input.trim();
    let address = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url =
        url::Url::parse(&address).map_err(|_| "Informe o endereço HTTPS do seu Maré Música.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Use apenas o endereço HTTPS do servidor, sem usuário, senha ou caminho.".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
fn write_events(directory: &Path, events: &[Value]) {
    if let Ok(bytes) = serde_json::to_vec(events) {
        let temp = directory.join("cloud-events.tmp");
        if fs::write(&temp, bytes).is_ok() {
            let _ = fs::rename(temp, directory.join("cloud-events.json"));
        }
    }
}
impl Cloud {
    pub fn new(directory: &Path) -> Self {
        let config = fs::read(directory.join("cloud-session.bin"))
            .ok()
            .filter(|b| b.len() < 16384)
            .and_then(|b| protect(&b, false).ok())
            .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
            .filter(|c| origin(&c.origin).is_ok());
        let events = fs::read(directory.join("cloud-events.json"))
            .ok()
            .filter(|b| b.len() < 1_500_000)
            .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
            .unwrap_or_default();
        let mut cloud = Self {
            shared: Arc::new(Mutex::new(State {
                config,
                events,
                ..State::default()
            })),
            cancel: Arc::new(AtomicBool::new(false)),
            directory: directory.into(),
        };
        if cloud.connected() {
            cloud.run(None, vec![]);
        }
        cloud
    }
    pub fn connected(&self) -> bool {
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .config
            .is_some()
    }
    pub fn device_id(&self) -> String {
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .config
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_default()
    }
    pub fn snapshot(&self) -> Value {
        let s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        json!({"connected":s.config.is_some(),"connecting":s.connecting,"error":s.error,"origin":s.config.as_ref().map(|c|&c.origin),"id":s.config.as_ref().map(|c|&c.id),"user":s.config.as_ref().map(|c|&c.user),"pending":s.events.len(),"devices":s.devices,"session":s.session,"commands":s.commands})
    }
    pub fn connect(&mut self, input: &str, code: &str, seed: Vec<Value>) -> Result<(), String> {
        let origin = origin(input)?;
        let code = code.replace([' ', '-'], "").to_uppercase();
        if code.len() != 8 || !code.bytes().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Use o código de oito caracteres mostrado no celular.".into());
        }
        self.disconnect();
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .connecting = true;
        self.run(
            Some((origin, json!({"code":code,"name":"Maré no PC"}))),
            seed,
        );
        Ok(())
    }
    pub fn login(
        &mut self,
        input: &str,
        username: &str,
        password: &str,
        seed: Vec<Value>,
    ) -> Result<(), String> {
        let server = origin(input)?;
        if username.trim().is_empty() || password.is_empty() || password.len() > 512 {
            return Err("Informe seu usuário e senha do Maré Música.".into());
        }
        self.disconnect();
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .connecting = true;
        self.run(
            Some((
                server,
                json!({"username":username.trim(),"password":password}),
            )),
            seed,
        );
        Ok(())
    }
    pub fn enqueue(&self, kind: &str, data: Value) {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        if s.config.is_none() {
            return;
        }
        if s.events.len() >= 3000 {
            s.error = "Há muitas alterações pendentes. Aguarde a sincronização antes de continuar."
                .into();
            return;
        }
        if let Ok(value) = event(kind, data) {
            s.events.push(value);
            write_events(&self.directory, &s.events);
        }
    }
    pub fn seed(kind: &str, data: Value) -> Option<Value> {
        event(kind, data).ok()
    }
    pub fn publish(&self, player: Value) {
        self.shared.lock().unwrap_or_else(|e| e.into_inner()).player = player;
    }
    pub fn ack(&self, id: u64) {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        s.ack = s.ack.max(id);
        s.commands = json!([]);
    }
    pub fn take_library(&self) -> Option<Value> {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        if !s.events.is_empty() {
            return None;
        }
        s.update.take()
    }
    pub fn retry_library(&self, error: String) {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        s.revision.clear();
        s.error = error;
    }
    pub fn command(&self, target: String, command: Value) {
        let config = self
            .shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .config
            .clone();
        let shared = self.shared.clone();
        if let Some(c) = config {
            thread::spawn(move || {
                if let Err(error) = http(
                    &c.origin,
                    "/api/devices/commands",
                    Some(&c.token),
                    &json!({"target":target,"command":command}),
                ) {
                    shared.lock().unwrap_or_else(|e| e.into_inner()).error = error;
                }
            });
        }
    }
    pub fn disconnect(&mut self) {
        let guard = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        self.cancel.store(true, Ordering::Release);
        self.cancel = Arc::new(AtomicBool::new(false));
        let old = guard.config.clone();
        let _ = fs::remove_file(self.directory.join("cloud-session.bin"));
        let _ = fs::remove_file(self.directory.join("cloud-events.json"));
        drop(guard);
        self.shared = Arc::new(Mutex::new(State::default()));
        if let Some(c) = old {
            thread::spawn(move || {
                let _ = http(
                    &c.origin,
                    "/api/devices/disconnect",
                    Some(&c.token),
                    &json!({}),
                );
            });
        }
    }
    fn run(&mut self, pair: Option<(String, Value)>, seed: Vec<Value>) {
        let shared = self.shared.clone();
        let cancel = self.cancel.clone();
        let directory = self.directory.clone();
        thread::spawn(move || {
            if let Some((origin, credentials)) = pair {
                let result = (|| -> Result<Config, String> {
                    let r = http(
                        &origin,
                        if credentials.get("code").is_some() {
                            "/api/devices/claim"
                        } else {
                            "/api/devices/login"
                        },
                        None,
                        &credentials,
                    )?;
                    let c = Config {
                        origin,
                        token: r["token"]
                            .as_str()
                            .ok_or("Resposta de pareamento inválida.")?
                            .into(),
                        id: r["id"]
                            .as_str()
                            .ok_or("Resposta de pareamento inválida.")?
                            .into(),
                        user: json!({"username":r["user"]["username"].as_str().unwrap_or("").chars().take(100).collect::<String>()}),
                    };
                    if c.token.len() != 43
                        || !c
                            .token
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                        || c.id.len() != 24
                        || !c.id.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        return Err("Resposta de pareamento inválida.".into());
                    }
                    let protected =
                        protect(&serde_json::to_vec(&c).map_err(|e| e.to_string())?, true)?;
                    let _guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                    if cancel.load(Ordering::Acquire) {
                        return Err("Pareamento cancelado.".into());
                    }
                    let path = directory.join("cloud-session.tmp");
                    fs::write(&path, protected)
                        .and_then(|_| fs::rename(path, directory.join("cloud-session.bin")))
                        .map_err(|_| "Não foi possível salvar a conexão protegida.")?;
                    Ok(c)
                })();
                let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                if cancel.load(Ordering::Acquire) {
                    return;
                }
                s.connecting = false;
                match result {
                    Ok(c) => {
                        s.config = Some(c);
                        s.events.extend(seed);
                        write_events(&directory, &s.events)
                    }
                    Err(e) => {
                        s.error = e;
                        return;
                    }
                }
            }
            while !cancel.load(Ordering::Acquire) {
                let (config, payload) = {
                    let s = shared.lock().unwrap_or_else(|e| e.into_inner());
                    let mut size = 0;
                    let events: Vec<_> = s
                        .events
                        .iter()
                        .take(100)
                        .take_while(|event| {
                            size += serde_json::to_vec(event).map(|v| v.len()).unwrap_or(120000);
                            size < 60000
                        })
                        .collect();
                    (
                        s.config.clone(),
                        json!({"revision":s.revision,"events":events,"player":s.player,"ack":s.ack}),
                    )
                };
                let Some(c) = config else { break };
                let result = http(&c.origin, "/api/devices/sync", Some(&c.token), &payload);
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                {
                    let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                    if cancel.load(Ordering::Acquire) {
                        break;
                    }
                    match result {
                        Ok(r) => {
                            let accepted = r["accepted"].as_array().cloned().unwrap_or_default();
                            s.events.retain(|event| !accepted.contains(&event["id"]));
                            write_events(&directory, &s.events);
                            s.revision = r["revision"].as_str().unwrap_or("").into();
                            s.devices = r["devices"].clone();
                            s.session = r["session"].clone();
                            s.commands = r["commands"].clone();
                            if r["library"].is_object() {
                                s.update = Some(r["library"].clone());
                            }
                            s.error.clear();
                        }
                        Err(e) => s.error = e,
                    }
                }
                for _ in 0..15 {
                    if cancel.load(Ordering::Acquire) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
        });
    }
}
impl Drop for Cloud {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows::{
        core::w,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::*,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                w!("Maré Música"),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| "Não foi possível acessar a conexão protegida do Windows.")?;
        let value = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(value)
    }
}
fn http(origin: &str, path: &str, token: Option<&str>, body: &Value) -> Result<Value, String> {
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
            Err("Não foi possível conectar ao seu Maré Música.".to_string())
        } else {
            Ok(Handle(p))
        }
    };
    let url = url::Url::parse(origin).map_err(|_| "Endereço inválido.")?;
    let bytes = serde_json::to_vec(body).map_err(|e| e.to_string())?;
    if bytes.len() > 1_900_000 {
        return Err("Sincronização excede o limite por pedido.".into());
    }
    let headers = format!(
        "Content-Type: application/json\r\nOrigin: {origin}\r\n{}",
        token
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default()
    )
    .encode_utf16()
    .collect::<Vec<_>>();
    unsafe {
        let session = checked(WinHttpOpen(
            w!("MareMusicSync/1"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 4000, 4000, 4000, 4000)
            .map_err(|_| "O servidor demorou a responder.")?;
        let connection = checked(WinHttpConnect(
            session.0,
            &HSTRING::from(url.host_str().ok_or("Endereço inválido.")?),
            url.port_or_known_default().unwrap_or(443),
            0,
        ))?;
        let request = checked(WinHttpOpenRequest(
            connection.0,
            w!("POST"),
            &HSTRING::from(path),
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
        .map_err(|_| "Conexão indisponível.")?;
        WinHttpSendRequest(
            request.0,
            Some(&headers),
            Some(bytes.as_ptr().cast()),
            bytes.len() as u32,
            bytes.len() as u32,
            0,
        )
        .and_then(|_| WinHttpReceiveResponse(request.0, std::ptr::null_mut()))
        .map_err(|_| "Não foi possível acessar o servidor. A biblioteca local foi preservada.")?;
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
        .map_err(|_| "Resposta inválida.")?;
        if status != 200 {
            return Err(if status == 401 {
                match path {
                    "/api/devices/login" => "Usuário ou senha não conferem. Use a mesma conta do Maré Música do celular.",
                    "/api/devices/claim" => "Código expirado ou já utilizado. Gere outro código no celular.",
                    _ => "Sessão encerrada ou revogada. Entre novamente na sua conta do Maré Música.",
                }.into()
            } else {
                format!("O servidor recusou a sincronização (HTTP {status}).")
            });
        }
        let mut data = Vec::new();
        let start = std::time::Instant::now();
        loop {
            let mut buffer = [0u8; 8192];
            let mut read = 0;
            WinHttpReadData(request.0, buffer.as_mut_ptr().cast(), 8192, &mut read)
                .map_err(|_| "Resposta interrompida.")?;
            if read == 0 {
                break;
            }
            data.extend_from_slice(&buffer[..read as usize]);
            if data.len() > 2_000_000 || start.elapsed().as_secs() > 20 {
                return Err("Resposta excede o limite de sincronização.".into());
            }
        }
        serde_json::from_slice(&data)
            .map_err(|_| "O servidor não retornou uma resposta válida.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origins_are_tls_roots_without_embedded_credentials() {
        assert_eq!(origin("music.example").unwrap(), "https://music.example");
        assert_eq!(
            origin("https://music.example/").unwrap(),
            "https://music.example"
        );
        for invalid in [
            "http://music.example",
            "https://user:secret@music.example",
            "https://music.example/api",
            "https://music.example/?token=secret",
            "https://music.example/#secret",
        ] {
            assert!(origin(invalid).is_err());
        }
    }
    #[test]
    fn windows_protects_session_and_pending_edits_block_stale_merges() {
        let raw = br#"{"token":"private test fixture"}"#;
        let encrypted = protect(raw, true).unwrap();
        assert_ne!(encrypted, raw);
        assert_eq!(protect(&encrypted, false).unwrap(), raw);
        let dir = std::env::temp_dir().join(format!("mare-cloud-test-{}", crate::model::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let cloud = Cloud::new(&dir);
        {
            let mut s = cloud.shared.lock().unwrap();
            s.events.push(event("track", json!({})).unwrap());
            s.update = Some(json!({"tracks":[]}));
        }
        assert!(cloud.take_library().is_none());
        cloud.shared.lock().unwrap().events.clear();
        assert!(cloud.take_library().is_some());
        drop(cloud);
        fs::remove_dir_all(dir).unwrap();
    }
}
