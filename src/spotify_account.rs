//! Read-only PKCE authorization; access/refresh tokens never leave worker memory.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
const REDIRECT: &str = "http://127.0.0.1:43821/callback";
#[derive(Default)]
struct Session {
    token: Option<String>,
    state: String,
    error: Option<String>,
    imports: Option<Vec<Value>>,
    truncated: bool,
}
pub struct Account {
    client_id: String,
    shared: Arc<Mutex<Session>>,
    cancel: Arc<AtomicBool>,
    url: Option<String>,
}
impl Account {
    pub fn new() -> Self {
        Self {
            client_id: option_env!("MARE_SPOTIFY_CLIENT_ID").unwrap_or("").into(),
            shared: Arc::new(Mutex::new(Session::default())),
            cancel: Arc::new(AtomicBool::new(false)),
            url: None,
        }
    }
    pub fn snapshot(&self) -> Value {
        let s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        json!({"configured":!self.client_id.is_empty(),"connected":s.token.is_some(),"state":s.state,"error":s.error,"authorization_url":if s.state=="awaiting_authorization"{self.url.as_deref()}else{None},"truncated":s.truncated})
    }
    pub fn take_imports(&self) -> Option<Vec<Value>> {
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .imports
            .take()
    }
    pub fn has_imports(&self) -> bool {
        self.shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .imports
            .is_some()
    }
    pub fn fail_import(&self, message: String) {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        s.error = Some(message);
        s.state = "error".into();
    }
    pub fn handle(&mut self, method: &str) -> Result<(), String> {
        match method {
            "account_disconnect" => {
                self.cancel.store(true, Ordering::Relaxed);
                self.shared = Arc::new(Mutex::new(Session::default()));
                self.url = None;
                Ok(())
            }
            "account_begin" => {
                if self.client_id.len() != 32
                    || !self.client_id.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Esta build precisa de um Client ID público registrado pelo mantenedor do Maré.".into());
                }
                let listener = TcpListener::bind("127.0.0.1:43821").map_err(|_| {
                    "A porta de autorização está ocupada. Aguarde e tente novamente."
                })?;
                listener.set_nonblocking(true).map_err(|e| e.to_string())?;
                self.cancel.store(true, Ordering::Relaxed);
                self.cancel = Arc::new(AtomicBool::new(false));
                self.shared = Arc::new(Mutex::new(Session {
                    state: "awaiting_authorization".into(),
                    ..Session::default()
                }));
                let mut bytes = [0u8; 64];
                getrandom::fill(&mut bytes)
                    .map_err(|_| "Não foi possível criar uma sessão segura.")?;
                let verifier = URL_SAFE_NO_PAD.encode(&bytes[..32]);
                let state = URL_SAFE_NO_PAD.encode(&bytes[32..]);
                let challenge = pkce(&verifier);
                let mut url = url::Url::parse("https://accounts.spotify.com/authorize").unwrap();
                url.query_pairs_mut().extend_pairs([
                    ("response_type", "code"),
                    ("client_id", self.client_id.as_str()),
                    ("redirect_uri", REDIRECT),
                    (
                        "scope",
                        "playlist-read-private playlist-read-collaborative user-library-read",
                    ),
                    ("state", state.as_str()),
                    ("code_challenge_method", "S256"),
                    ("code_challenge", challenge.as_str()),
                ]);
                self.url = Some(url.into());
                let shared = self.shared.clone();
                let cancel = self.cancel.clone();
                let client_id = self.client_id.clone();
                thread::spawn(move || {
                    let result = authorize(listener, &cancel, &client_id, &state, &verifier);
                    if cancel.load(Ordering::Relaxed) {
                        return;
                    }
                    let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                    match result {
                        Ok(token) => {
                            s.token = Some(token.clone());
                            s.state = "importing".into();
                            drop(s);
                            let imported = import(&token, &cancel);
                            if cancel.load(Ordering::Relaxed) {
                                return;
                            }
                            let mut session = shared.lock().unwrap_or_else(|e| e.into_inner());
                            match imported {
                                Ok((items, truncated)) => {
                                    session.imports = Some(items);
                                    session.truncated = truncated;
                                    session.state = "imported".into();
                                }
                                Err(error) => {
                                    session.error = Some(error);
                                    session.state = "error".into();
                                }
                            }
                        }
                        Err(e) => {
                            s.error = Some(e);
                            s.state = "error".into();
                        }
                    }
                });
                Ok(())
            }
            "account_import" => {
                let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
                if s.state == "importing" {
                    return Err("A importação já está em andamento.".into());
                }
                let token = s.token.clone().ok_or("Conecte sua conta primeiro.")?;
                s.state = "importing".into();
                s.error = None;
                drop(s);
                let shared = self.shared.clone();
                let cancel = self.cancel.clone();
                thread::spawn(move || {
                    let result = import(&token, &cancel);
                    if cancel.load(Ordering::Relaxed) {
                        return;
                    }
                    let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                    match result {
                        Ok((items, truncated)) => {
                            s.imports = Some(items);
                            s.truncated = truncated;
                            s.state = "imported".into();
                        }
                        Err(error) => {
                            s.error = Some(error);
                            s.state = "error".into();
                        }
                    }
                });
                Ok(())
            }
            _ => Err("Operação de conta desconhecida.".into()),
        }
    }
}
impl Drop for Account {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
fn pkce(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn authorize(
    listener: TcpListener,
    cancel: &AtomicBool,
    client_id: &str,
    state: &str,
    verifier: &str,
) -> Result<String, String> {
    let end = Instant::now() + Duration::from_secs(180);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Autorização cancelada.".into());
        }
        if Instant::now() >= end {
            return Err("A autorização expirou. Tente novamente.".into());
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let mut bytes = Vec::new();
                let mut chunk = [0u8; 1024];
                while bytes.len() < 8192 {
                    let count = stream
                        .read(&mut chunk)
                        .map_err(|_| "Resposta local incompleta.")?;
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&chunk[..count]);
                    if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&bytes);
                let path = request
                    .lines()
                    .next()
                    .and_then(|l| l.strip_prefix("GET "))
                    .and_then(|l| l.split(' ').next())
                    .unwrap_or("");
                let url = url::Url::parse(&format!("http://127.0.0.1:43821{path}"))
                    .map_err(|_| "Resposta local inválida.")?;
                let fields: std::collections::HashMap<_, _> =
                    url.query_pairs().into_owned().collect();
                if url.path() != "/callback"
                    || fields.get("state").map(String::as_str) != Some(state)
                {
                    let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let body="Autorizacao recebida. Volte ao app Spotify no Mare. Esta aba privada pode ser fechada.";
                let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                if fields.contains_key("error") {
                    return Err("Você não autorizou o acesso à biblioteca.".into());
                }
                let code = fields.get("code").ok_or("Código de autorização ausente.")?;
                let body = url::form_urlencoded::Serializer::new(String::new())
                    .extend_pairs([
                        ("grant_type", "authorization_code"),
                        ("client_id", client_id),
                        ("code", code.as_str()),
                        ("redirect_uri", REDIRECT),
                        ("code_verifier", verifier),
                    ])
                    .finish();
                let token = http("accounts.spotify.com", "/api/token", Some(&body), None)?;
                return token["access_token"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "O Spotify não retornou um token de acesso.".into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err("A autorização local falhou.".into()),
        }
    }
}
fn import(token: &str, cancel: &AtomicBool) -> Result<(Vec<Value>, bool), String> {
    let started = Instant::now();
    let mut items = Vec::new();
    let mut truncated = false;
    for endpoint in ["playlists", "tracks"] {
        for page in 0..10 {
            if cancel.load(Ordering::Relaxed) {
                return Err("Importação cancelada.".into());
            }
            if started.elapsed() > Duration::from_secs(60) {
                return Err("A importação excedeu o tempo. Tente novamente.".into());
            }
            let response = http(
                "api.spotify.com",
                &format!("/v1/me/{endpoint}?limit=50&offset={}", page * 50),
                None,
                Some(token),
            )?;
            for item in response["items"]
                .as_array()
                .ok_or("O Spotify retornou uma biblioteca inválida.")?
            {
                let content = if endpoint == "tracks" {
                    &item["track"]
                } else {
                    item
                };
                if content["uri"].as_str().is_none() {
                    continue;
                }
                items.push(json!({"uri":content["uri"],"title":content["name"],"thumbnail":if endpoint=="tracks"{&content["album"]["images"][0]["url"]}else{&content["images"][0]["url"]},"favorite":endpoint=="tracks"}));
            }
            if response["next"].is_null() {
                break;
            }
            if page == 9 {
                truncated = true;
            }
        }
    }
    Ok((items, truncated))
}
fn http(host: &str, path: &str, body: Option<&str>, token: Option<&str>) -> Result<Value, String> {
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::Networking::WinHttp::*,
    };
    if !matches!(host, "accounts.spotify.com" | "api.spotify.com")
        || !path.starts_with('/')
        || token.is_some_and(|t| t.contains(['\r', '\n']))
    {
        return Err("Destino Spotify inválido.".into());
    }
    struct Handle(*mut std::ffi::c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = WinHttpCloseHandle(self.0);
            }
        }
    }
    let check = |p: *mut std::ffi::c_void| {
        if p.is_null() {
            Err("Falha ao conectar ao Spotify.".to_string())
        } else {
            Ok(Handle(p))
        }
    };
    unsafe {
        let session = check(WinHttpOpen(
            w!("MareMusic/0.3"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 3000, 3000, 3000, 3000)
            .map_err(|_| "Tempo de conexão excedido.")?;
        let connection = check(WinHttpConnect(session.0, &HSTRING::from(host), 443, 0))?;
        let request = check(WinHttpOpenRequest(
            connection.0,
            if body.is_some() {
                w!("POST")
            } else {
                w!("GET")
            },
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
        .map_err(|_| "Conexão segura indisponível.")?;
        let headers = token
            .map(|token| format!("Authorization: Bearer {token}\r\n"))
            .unwrap_or_else(|| "Content-Type: application/x-www-form-urlencoded\r\n".into());
        let headers: Vec<u16> = headers.encode_utf16().collect();
        let body = body.unwrap_or("").as_bytes();
        WinHttpSendRequest(
            request.0,
            Some(&headers),
            if body.is_empty() {
                None
            } else {
                Some(body.as_ptr().cast())
            },
            body.len() as u32,
            body.len() as u32,
            0,
        )
        .and_then(|()| WinHttpReceiveResponse(request.0, std::ptr::null_mut()))
        .map_err(|_| "O Spotify não respondeu à solicitação.")?;
        let mut status = 0u32;
        let mut size = 4;
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut size,
            std::ptr::null_mut(),
        )
        .map_err(|_| "Resposta HTTP inválida.")?;
        if status != 200 {
            return Err(match status {
                401 => "A sessão Spotify expirou. Conecte sua conta novamente.".into(),
                403 => "O Spotify não permitiu esta operação para a conta/aplicativo.".into(),
                429 => {
                    "Limite de solicitações do Spotify atingido. Aguarde antes de tentar novamente."
                        .into()
                }
                _ => format!("Spotify retornou HTTP {status}."),
            });
        }
        let mut bytes = Vec::new();
        let started = Instant::now();
        loop {
            let mut chunk = [0u8; 4096];
            let mut read = 0;
            WinHttpReadData(request.0, chunk.as_mut_ptr().cast(), 4096, &mut read)
                .map_err(|_| "Resposta incompleta do Spotify.")?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..read as usize]);
            if bytes.len() > 1_048_576 || started.elapsed() > Duration::from_secs(8) {
                return Err("Resposta Spotify excedeu o limite.".into());
            }
        }
        serde_json::from_slice(&bytes).map_err(|_| "Resposta Spotify inválida.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(
            pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
