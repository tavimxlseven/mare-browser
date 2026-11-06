//! Optional Discord IPC activity. No Discord tokens or account API requests.
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
pub struct Presence {
    path: PathBuf,
    client_id: String,
    enabled: bool,
    pipe: Option<fs::File>,
    buffer: Vec<u8>,
    state: String,
    last: String,
    retry: Instant,
    last_sent: Instant,
    sequence: u64,
}
impl Presence {
    pub fn new(directory: &Path) -> Self {
        let path = directory.join("presence.json");
        let settings = fs::read(&path)
            .ok()
            .filter(|b| b.len() < 4096)
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .unwrap_or(Value::Null);
        Self {
            path,
            client_id: settings["client_id"]
                .as_str()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or(option_env!("MARE_DISCORD_CLIENT_ID").unwrap_or("1568194392156668016"))
                .into(),
            enabled: settings["enabled"].as_bool().unwrap_or(false),
            pipe: None,
            buffer: Vec::new(),
            state: "disabled".into(),
            last: String::new(),
            retry: Instant::now() - Duration::from_secs(20),
            last_sent: Instant::now() - Duration::from_secs(20),
            sequence: 0,
        }
    }
    pub fn configure(&mut self, settings: &Value) -> Result<(), String> {
        let client_id = settings["client_id"]
            .as_str()
            .unwrap_or(&self.client_id)
            .trim()
            .to_owned();
        if !client_id.is_empty()
            && (!(17..=22).contains(&client_id.len())
                || !client_id.bytes().all(|c| c.is_ascii_digit()))
        {
            return Err("Application ID do Discord inválido.".into());
        }
        self.clear();
        self.pipe = None;
        self.client_id = client_id;
        self.enabled = settings["enabled"].as_bool().unwrap_or(false);
        self.last.clear();
        self.retry = Instant::now() - Duration::from_secs(20);
        let temp = self.path.with_extension("tmp");
        fs::write(
            &temp,
            serde_json::to_vec(&json!({"client_id":self.client_id,"enabled":self.enabled}))
                .map_err(|e| e.to_string())?,
        )
        .and_then(|()| fs::rename(temp, &self.path))
        .map_err(|e| e.to_string())
    }
    pub fn snapshot(&self) -> Value {
        json!({"enabled":self.enabled,"client_id":self.client_id,"state":self.state})
    }
    fn send(&mut self, opcode: u32, value: &Value) -> std::io::Result<()> {
        let data = serde_json::to_vec(value)?;
        let Some(pipe) = self.pipe.as_mut() else {
            return Err(std::io::Error::other("Discord fechado"));
        };
        pipe.write_all(&opcode.to_le_bytes())?;
        pipe.write_all(&(data.len() as u32).to_le_bytes())?;
        pipe.write_all(&data)
    }
    fn connect(&mut self) {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            System::Pipes::{SetNamedPipeHandleState, NAMED_PIPE_MODE},
        };
        #[cfg(debug_assertions)]
        let test_pipe = std::env::var("MARE_DISCORD_IPC_TEST")
            .ok()
            .filter(|p| p.starts_with(r"\\.\pipe\mare-qa-"));
        #[cfg(not(debug_assertions))]
        let test_pipe: Option<String> = None;
        for index in 0..10 {
            let path = test_pipe
                .clone()
                .unwrap_or_else(|| format!(r"\\.\pipe\discord-ipc-{index}"));
            if let Ok(file) = fs::OpenOptions::new().read(true).write(true).open(path) {
                let mode = NAMED_PIPE_MODE(1);
                if unsafe {
                    SetNamedPipeHandleState(HANDLE(file.as_raw_handle()), Some(&mode), None, None)
                }
                .is_err()
                {
                    continue;
                }
                self.pipe = Some(file);
                self.buffer.clear();
                self.state = "connecting".into();
                if self
                    .send(0, &json!({"v":1,"client_id":self.client_id}))
                    .is_err()
                {
                    self.pipe = None;
                }
                return;
            }
        }
        self.state = "discord_closed".into();
    }
    fn pump(&mut self) {
        let Some(pipe) = self.pipe.as_mut() else {
            return;
        };
        let mut bytes = [0u8; 4096];
        loop {
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::{Foundation::HANDLE, System::Pipes::PeekNamedPipe};
            let mut available = 0;
            if unsafe {
                PeekNamedPipe(
                    HANDLE(pipe.as_raw_handle()),
                    None,
                    0,
                    None,
                    Some(&mut available),
                    None,
                )
            }
            .is_err()
            {
                self.pipe = None;
                self.state = "disconnected".into();
                return;
            }
            if available == 0 {
                break;
            }
            let count = (available as usize).min(bytes.len());
            match pipe.read(&mut bytes[..count]) {
                Ok(0) => {
                    self.pipe = None;
                    self.state = "disconnected".into();
                    return;
                }
                Ok(n) => {
                    self.buffer.extend_from_slice(&bytes[..n]);
                    if self.buffer.len() > 65536 {
                        self.pipe = None;
                        self.buffer.clear();
                        return;
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.raw_os_error() == Some(232) =>
                {
                    break
                }
                Err(_) => {
                    self.pipe = None;
                    self.state = "disconnected".into();
                    return;
                }
            }
        }
        while self.buffer.len() >= 8 {
            let opcode = u32::from_le_bytes(self.buffer[0..4].try_into().unwrap());
            let len = u32::from_le_bytes(self.buffer[4..8].try_into().unwrap()) as usize;
            if len > 65528 {
                self.pipe = None;
                self.buffer.clear();
                break;
            }
            if self.buffer.len() < len + 8 {
                break;
            }
            let bytes = self.buffer[8..len + 8].to_vec();
            self.buffer.drain(..len + 8);
            if opcode == 2 {
                self.pipe = None;
                self.state = "rejected".into();
                break;
            }
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if opcode == 3 {
                    let _ = self.send(4, &value);
                } else if value["evt"] == "READY" {
                    self.state = "ready".into();
                    self.last.clear();
                } else if value["evt"] == "ERROR" {
                    self.state = "rejected".into();
                } else if value["cmd"] == "SET_ACTIVITY" {
                    self.state = if value["data"].is_null() {
                        "ready"
                    } else {
                        "active"
                    }
                    .into();
                }
            }
        }
    }
    fn clear(&mut self) {
        if self.pipe.is_some() {
            self.sequence += 1;
            let _=self.send(1,&json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id(),"activity":null},"nonce":self.sequence.to_string()}));
        }
    }
    pub fn update(
        &mut self,
        track: Option<(&str, &str)>,
        playing: bool,
        position: u64,
        duration: u64,
        artwork: &str,
    ) {
        if !self.enabled || self.client_id.is_empty() {
            self.state = if self.enabled {
                "needs_application_id"
            } else {
                "disabled"
            }
            .into();
            return;
        }
        if self.pipe.is_none() && self.retry.elapsed() > Duration::from_secs(15) {
            self.retry = Instant::now();
            self.connect();
        }
        self.pump();
        if self.pipe.is_none() || self.state == "connecting" {
            return;
        }
        let key = if playing {
            format!(
                "{}:{}:{}",
                track.map(|t| t.0).unwrap_or(""),
                position / 15000,
                duration
            )
        } else {
            "paused".into()
        };
        if key == self.last || self.last_sent.elapsed() < Duration::from_secs(2) {
            return;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let activity = if let Some((title, artist)) = track.filter(|_| playing) {
            let title = title.chars().take(128).collect::<String>();
            let artist = artist.chars().take(128).collect::<String>();
            let mut value = json!({"type":2,"status_display_type":1,"details":title,"state":if artist.is_empty(){"Maré Music"}else{artist.as_str()},"timestamps":{"start":now.saturating_sub(position/1000),"end":now.saturating_add(duration.saturating_sub(position)/1000)},"instance":false});
            if crate::spotify::safe_artwork(artwork) {
                value["assets"] = json!({"large_image":artwork,"large_text":title});
            }
            value
        } else {
            Value::Null
        };
        self.sequence += 1;
        if self.send(1,&json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id(),"activity":activity},"nonce":self.sequence.to_string()})).is_err(){self.pipe=None;self.state="disconnected".into();}else{self.last=key;self.last_sent=Instant::now();}
    }
}
impl Drop for Presence {
    fn drop(&mut self) {
        self.clear();
    }
}
