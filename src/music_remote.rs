//! Opt-in IPv4 LAN playback control. No filesystem, accounts or audio endpoints.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const PAGE: &str = include_str!("../ui/music-remote.html");
struct Pairing {
    pin: String,
    expires: Instant,
    attempts: u8,
    window: Instant,
    sessions: HashMap<String, Instant>,
}
struct Shared {
    stop: AtomicBool,
    pairing: Mutex<Pairing>,
    state: Mutex<Value>,
}
struct Running {
    shared: Arc<Shared>,
    listener: Option<thread::JoinHandle<()>>,
    port: u16,
    urls: Vec<String>,
}
#[derive(Default)]
pub struct Manager {
    running: Option<Running>,
    cache: Value,
}
fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn new_pin() -> Result<String, String> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(format!("{:08}", u32::from_le_bytes(bytes) % 100_000_000))
}
fn local_peer(ip: IpAddr) -> bool {
    matches!(ip, IpAddr::V4(ip) if ip.is_private() || ip.is_loopback())
}
fn display_ip() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // UDP connect chooses a route; no packet is sent to this documentation address.
    socket.connect("192.0.2.1:9").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if ip.is_private() => Some(ip),
        _ => None,
    }
}
fn local_ips() -> Vec<Ipv4Addr> {
    let mut ips = display_ip().into_iter().collect::<Vec<_>>();
    #[cfg(windows)]
    unsafe {
        use windows::Win32::NetworkManagement::IpHelper::{
            GetIpAddrTable, MIB_IPADDRROW_XP, MIB_IPADDRTABLE,
        };
        let mut size = 0u32;
        let _ = GetIpAddrTable(None, &mut size, false);
        if size > 0 && size <= 65536 {
            let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
            let table = buffer.as_mut_ptr().cast::<MIB_IPADDRTABLE>();
            if GetIpAddrTable(Some(table), &mut size, false) == 0 {
                let offset = std::mem::offset_of!(MIB_IPADDRTABLE, table);
                let available = (buffer.len() * 8).saturating_sub(offset)
                    / std::mem::size_of::<MIB_IPADDRROW_XP>();
                let count = ((*table).dwNumEntries as usize).min(available).min(64);
                for row in std::slice::from_raw_parts((*table).table.as_ptr(), count) {
                    let ip = Ipv4Addr::from(row.dwAddr.to_ne_bytes());
                    if ip.is_private() && !ips.contains(&ip) {
                        ips.push(ip);
                    }
                }
            }
        }
    }
    ips.sort_by_key(|ip| (ip.octets()[0] != 192, ip.octets()));
    ips.dedup();
    ips.truncate(8);
    ips
}
impl Manager {
    pub fn enabled(&self) -> bool {
        self.running.is_some()
    }
    pub fn start(&mut self, notify: impl Fn(Value) + Send + 'static) -> Result<(), String> {
        self.start_at(Ipv4Addr::UNSPECIFIED, notify)
    }
    fn start_at(
        &mut self,
        address: Ipv4Addr,
        notify: impl Fn(Value) + Send + 'static,
    ) -> Result<(), String> {
        if self.running.is_some() {
            return self.renew();
        }
        let listener = TcpListener::bind((address, 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            pairing: Mutex::new(Pairing {
                pin: new_pin()?,
                expires: Instant::now() + Duration::from_secs(300),
                attempts: 0,
                window: Instant::now(),
                sessions: HashMap::new(),
            }),
            state: Mutex::new(json!({"ready":false})),
        });
        let server = shared.clone();
        let handle = thread::Builder::new()
            .name("mare-music-remote".into())
            .spawn(move || {
                let mut refresh = Instant::now() - Duration::from_secs(2);
                let mut command_at = Instant::now() - Duration::from_secs(1);
                while !server.stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, peer)) => {
                            let response = if !local_peer(peer.ip()) {
                                Reply::error(403, "Acesso permitido somente na rede local.")
                            } else {
                                match read_request(&mut stream) {
                                    Ok(request) => route(
                                        &server,
                                        port,
                                        request,
                                        &notify,
                                        &mut refresh,
                                        &mut command_at,
                                    ),
                                    Err(status) => Reply::error(status, "Solicitação inválida."),
                                }
                            };
                            let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
                            let _ = response.write(&mut stream);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10))
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        self.cache = Value::Null;
        self.running = Some(Running {
            shared,
            listener: Some(handle),
            port,
            urls: local_ips()
                .into_iter()
                .map(|ip| format!("http://{ip}:{port}"))
                .collect(),
        });
        Ok(())
    }
    pub fn renew(&mut self) -> Result<(), String> {
        if let Some(run) = &self.running {
            let mut pair = run
                .shared
                .pairing
                .lock()
                .map_err(|_| "Pareamento indisponível.")?;
            pair.pin = new_pin()?;
            pair.expires = Instant::now() + Duration::from_secs(300);
            pair.attempts = 0;
            pair.window = Instant::now();
        }
        Ok(())
    }
    pub fn stop(&mut self) {
        if let Some(mut run) = self.running.take() {
            run.shared.stop.store(true, Ordering::Release);
            // Closing an app must not wait for an idle HTTP socket on the UI thread.
            if let Some(handle) = run.listener.take() {
                thread::spawn(move || {
                    let _ = handle.join();
                });
            }
        }
        self.cache = Value::Null;
    }
    pub fn status(&self) -> Value {
        let Some(run) = &self.running else {
            return json!({"enabled":false});
        };
        let Ok(pair) = run.shared.pairing.lock() else {
            return json!({"enabled":false});
        };
        json!({"enabled":true,"urls":run.urls,"port":run.port,"code":pair.pin,"expires_in":pair.expires.saturating_duration_since(Instant::now()).as_secs(),"paired":pair.sessions.values().filter(|until|**until>Instant::now()).count()})
    }
    pub fn revision(&self) -> Option<u64> {
        self.cache["library_revision"].as_u64()
    }
    pub fn update(&mut self, delta: &Value) {
        let Some(run) = &self.running else {
            return;
        };
        let Some(fields) = delta.as_object() else {
            return;
        };
        if !self.cache.is_object() {
            self.cache = json!({});
        }
        for key in ["player", "local_tracks", "library_revision"] {
            if let Some(value) = fields.get(key) {
                self.cache[key] = value.clone();
            }
        }
        let current = self.cache["player"]["track_id"].as_u64();
        let track = self.cache["local_tracks"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|t| t["id"].as_u64() == current && current.is_some());
        let artwork = track
            .and_then(|t| t["artwork"].as_str())
            .filter(|url| crate::spotify::safe_artwork(url))
            .unwrap_or("");
        let can_play = self.cache["local_tracks"]
            .as_array()
            .is_some_and(|tracks| tracks.iter().any(|track| track["available"] == true));
        let public = json!({"ready":true,"can_play":can_play,"player":self.cache["player"],"track":track.map(|t|json!({"title":t["title"],"artists":t["artists"],"artwork":artwork}))});
        if let Ok(mut state) = run.shared.state.lock() {
            *state = public;
        }
    }
}
impl Drop for Manager {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}
fn read_request(stream: &mut TcpStream) -> Result<Request, u16> {
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|_| 400u16)?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut bytes = Vec::new();
    let end = loop {
        if Instant::now() > deadline {
            return Err(408);
        }
        let mut chunk = [0u8; 1024];
        let n = stream.read(&mut chunk).map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(at) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
            break at + 4;
        }
        if bytes.len() > 8192 {
            return Err(413);
        }
    };
    if end > 8192 {
        return Err(413);
    }
    let header = std::str::from_utf8(&bytes[..end]).map_err(|_| 400u16)?;
    let mut lines = header.split("\r\n");
    let first: Vec<_> = lines.next().ok_or(400u16)?.split_whitespace().collect();
    if first.len() != 3 || !matches!(first[2], "HTTP/1.1" | "HTTP/1.0") {
        return Err(400);
    }
    let method = first[0].to_owned();
    let path = first[1].to_owned();
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or(400u16)?;
        if headers
            .insert(key.trim().to_ascii_lowercase(), value.trim().to_owned())
            .is_some()
        {
            return Err(400);
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err(400);
    }
    let size: usize = headers
        .get("content-length")
        .map(|s| s.parse())
        .transpose()
        .map_err(|_| 400u16)?
        .unwrap_or(0);
    if size > 2048 {
        return Err(413);
    }
    let mut body = bytes[end..].to_vec();
    while body.len() < size {
        if Instant::now() > deadline {
            return Err(408);
        }
        let mut chunk = [0u8; 1024];
        let n = stream.read(&mut chunk).map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        body.extend_from_slice(&chunk[..n]);
    }
    if body.len() != size {
        return Err(400);
    }
    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}
struct Reply {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}
impl Reply {
    fn json(status: u16, value: Value) -> Self {
        Self {
            status,
            content_type: "application/json; charset=utf-8",
            body: value.to_string().into_bytes(),
        }
    }
    fn error(status: u16, message: &str) -> Self {
        Self::json(status, json!({"error":message}))
    }
    fn write(self, stream: &mut TcpStream) -> std::io::Result<()> {
        write!(stream,"HTTP/1.1 {} Response\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src https://i.scdn.co https://mosaic.scdn.co https://image-cdn-ak.spotifycdn.com https://image-cdn-fa.spotifycdn.com https://i.ytimg.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\n\r\n",self.status,self.content_type,self.body.len())?;
        stream.write_all(&self.body)
    }
}
fn valid_host(host: &str, port: u16) -> bool {
    host.parse::<SocketAddr>()
        .is_ok_and(|addr| addr.port() == port && local_peer(addr.ip()))
}
fn action(value: &Value) -> Option<Value> {
    let name = value["action"].as_str()?;
    let params = match name {
        "toggle" | "pause" | "resume" | "next" | "previous" => json!({}),
        "volume" => {
            let v = value["value"].as_u64().filter(|v| *v <= 100)?;
            json!({"value":v})
        }
        "seek" => {
            let v = value["position_ms"].as_u64().filter(|v| *v <= 86_400_000)?;
            json!({"position_ms":v})
        }
        _ => return None,
    };
    Some(json!({"action":name,"params":params}))
}
fn route(
    shared: &Shared,
    port: u16,
    request: Request,
    notify: &impl Fn(Value),
    refresh: &mut Instant,
    command_at: &mut Instant,
) -> Reply {
    if shared.stop.load(Ordering::Acquire) {
        return Reply::error(503, "Controle encerrado.");
    }
    let host = request
        .headers
        .get("host")
        .map(String::as_str)
        .unwrap_or("");
    if !valid_host(host, port)
        || request
            .headers
            .get("origin")
            .is_some_and(|origin| origin != &format!("http://{host}"))
    {
        return Reply::error(403, "Origem não permitida.");
    }
    if request.method == "GET" && request.path == "/" {
        return Reply {
            status: 200,
            content_type: "text/html; charset=utf-8",
            body: PAGE.as_bytes().to_vec(),
        };
    }
    if request.method == "POST"
        && !request
            .headers
            .get("content-type")
            .is_some_and(|v| v.split(';').next() == Some("application/json"))
    {
        return Reply::error(415, "Use JSON.");
    }
    if request.method == "POST" && request.path == "/api/pair" {
        let Ok(value) = serde_json::from_slice::<Value>(&request.body) else {
            return Reply::error(400, "Código inválido.");
        };
        let Ok(mut pair) = shared.pairing.lock() else {
            return Reply::error(503, "Pareamento indisponível.");
        };
        if pair.window.elapsed() > Duration::from_secs(60) {
            pair.attempts = 0;
            pair.window = Instant::now();
        }
        if pair.attempts >= 5 {
            return Reply::error(429, "Aguarde um minuto antes de tentar novamente.");
        }
        pair.attempts += 1;
        if Instant::now() > pair.expires || value["code"].as_str() != Some(pair.pin.as_str()) {
            return Reply::error(401, "Código incorreto ou expirado. Confira o Noise.");
        }
        pair.sessions.retain(|_, until| *until > Instant::now());
        if pair.sessions.len() >= 4 {
            return Reply::error(
                429,
                "Limite de celulares pareados. Reinicie o controle no Noise.",
            );
        }
        let Ok(token) = random_hex() else {
            return Reply::error(503, "Não foi possível parear.");
        };
        pair.sessions.insert(
            token.clone(),
            Instant::now() + Duration::from_secs(8 * 3600),
        );
        return Reply::json(200, json!({"token":token}));
    }
    let bearer = request
        .headers
        .get("authorization")
        .and_then(|h| h.strip_prefix("Bearer "));
    let authorized = shared.pairing.lock().is_ok_and(|pair| {
        bearer
            .and_then(|token| pair.sessions.get(token))
            .is_some_and(|until| *until > Instant::now())
    });
    if !authorized {
        return Reply::error(401, "Pareie este celular pelo código mostrado no Noise.");
    }
    if request.method == "POST" && request.path == "/api/disconnect" {
        if let (Some(token), Ok(mut pair)) = (bearer, shared.pairing.lock()) {
            pair.sessions.remove(token);
        }
        return Reply::json(200, json!({"disconnected":true}));
    }
    if request.method == "GET" && request.path == "/api/state" {
        if refresh.elapsed() >= Duration::from_millis(900) {
            *refresh = Instant::now();
            notify(json!({"action":"refresh"}));
        }
        return match shared.state.lock() {
            Ok(state) => Reply::json(200, state.clone()),
            Err(_) => Reply::error(503, "Player indisponível."),
        };
    }
    if request.method == "POST" && request.path == "/api/control" {
        let Some(command) = serde_json::from_slice::<Value>(&request.body)
            .ok()
            .and_then(|v| action(&v))
        else {
            return Reply::error(400, "Controle não permitido.");
        };
        if command_at.elapsed() < Duration::from_millis(150) {
            return Reply::error(429, "Aguarde um instante.");
        }
        *command_at = Instant::now();
        notify(command);
        return Reply::json(202, json!({"accepted":true}));
    }
    Reply::error(404, "Endereço não encontrado.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    fn exchange(
        manager: &Manager,
        method: &str,
        path: &str,
        body: Value,
        token: &str,
        origin: Option<&str>,
    ) -> (u16, Value) {
        let port = manager.running.as_ref().unwrap().port;
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let data = if method == "POST" {
            body.to_string()
        } else {
            String::new()
        };
        let authorization = if token.is_empty() {
            String::new()
        } else {
            format!("Authorization: Bearer {token}\r\n")
        };
        let origin = origin
            .map(|s| format!("Origin: {s}\r\n"))
            .unwrap_or_default();
        write!(stream,"{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{authorization}{origin}\r\n{data}",data.len()).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        let (head, body) = reply.split_once("\r\n\r\n").unwrap();
        let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, serde_json::from_str(body).unwrap_or(Value::Null))
    }
    #[test]
    fn paired_lan_controls_are_bounded_and_do_not_expose_profile_data() {
        let (tx, rx) = mpsc::channel();
        let mut manager = Manager::default();
        assert!(!manager.enabled());
        manager
            .start_at(Ipv4Addr::LOCALHOST, move |v| {
                let _ = tx.send(v);
            })
            .unwrap();
        manager.update(&json!({"library_revision":4,"player":{"track_id":7,"state":"playing","position_ms":1000,"duration_ms":90000,"volume":40},"local_tracks":[{"id":7,"title":"Own fixture","artists":"Test artist","available":true,"path":"D:/secret/example.wav","artwork":"https://i.scdn.co/image/test"}],"account_token":"DO-NOT-EXPOSE"}));
        assert_eq!(
            exchange(&manager, "GET", "/api/state", Value::Null, "", None).0,
            401
        );
        let code = manager.status()["code"].as_str().unwrap().to_owned();
        let (status, paired) = exchange(
            &manager,
            "POST",
            "/api/pair",
            json!({"code":code}),
            "",
            None,
        );
        assert_eq!(status, 200);
        let token = paired["token"].as_str().unwrap();
        assert_eq!(token.len(), 64);
        let (status, state) = exchange(&manager, "GET", "/api/state", Value::Null, token, None);
        assert_eq!(status, 200);
        assert_eq!(state["track"]["title"], "Own fixture");
        assert_eq!(state["can_play"], true);
        let serialized = state.to_string();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("DO-NOT-EXPOSE"));
        assert!(state.get("local_tracks").is_none());
        assert_eq!(
            exchange(
                &manager,
                "GET",
                "/api/state",
                Value::Null,
                token,
                Some("https://evil.example")
            )
            .0,
            403
        );
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/control",
                json!({"action":"download","url":"file:///private"}),
                token,
                None
            )
            .0,
            400
        );
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/control",
                json!({"action":"volume","value":101}),
                token,
                None
            )
            .0,
            400
        );
        for _ in rx.try_iter() {}
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/control",
                json!({"action":"pause"}),
                token,
                None
            )
            .0,
            202
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap()["action"],
            "pause"
        );
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/control",
                json!({"action":"pause"}),
                token,
                None
            )
            .0,
            429
        );
        assert_eq!(
            exchange(&manager, "POST", "/api/disconnect", json!({}), token, None).0,
            200
        );
        assert_eq!(
            exchange(&manager, "GET", "/api/state", Value::Null, token, None).0,
            401
        );
        manager.stop();
        assert!(!manager.enabled());
        assert!(manager.status().get("code").is_none());
    }
    #[test]
    fn pairing_has_expiry_attempt_limit_and_no_arbitrary_methods() {
        let mut manager = Manager::default();
        manager.start_at(Ipv4Addr::LOCALHOST, |_| {}).unwrap();
        {
            let mut pair = manager
                .running
                .as_ref()
                .unwrap()
                .shared
                .pairing
                .lock()
                .unwrap();
            pair.expires = Instant::now() - Duration::from_secs(1);
        }
        let code = manager.status()["code"].clone();
        for _ in 0..5 {
            assert_eq!(
                exchange(
                    &manager,
                    "POST",
                    "/api/pair",
                    json!({"code":code}),
                    "",
                    None
                )
                .0,
                401
            );
        }
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/pair",
                json!({"code":code}),
                "",
                None
            )
            .0,
            429
        );
        manager.renew().unwrap();
        let code = manager.status()["code"].clone();
        assert_eq!(
            exchange(
                &manager,
                "POST",
                "/api/pair",
                json!({"code":code}),
                "",
                None
            )
            .0,
            200
        );
        assert!(action(&json!({"action":"seek","position_ms":-1})).is_none());
        assert!(action(&json!({"action":"eval"})).is_none());
        assert!(action(&json!({"action":"refresh"})).is_none());
        assert!(!local_peer("8.8.8.8".parse().unwrap()));
        assert!(local_peer("192.168.1.2".parse().unwrap()));
        assert!(!valid_host("evil.example:1234", 1234));
        assert!(!valid_host("127.0.0.1:1235", 1234));
    }
    #[test]
    fn http_framing_rejects_large_bodies_and_duplicate_lengths() {
        for headers in [
            "Content-Length: 100000",
            "Content-Length: 0\r\nContent-Length: 0",
            "Transfer-Encoding: chunked",
        ] {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let reader = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                read_request(&mut stream).err().unwrap()
            });
            let mut stream = TcpStream::connect(address).unwrap();
            write!(
                stream,
                "POST /api/pair HTTP/1.1\r\nHost: localhost\r\n{headers}\r\n\r\n"
            )
            .unwrap();
            assert!([400, 413].contains(&reader.join().unwrap()));
        }
    }
}
