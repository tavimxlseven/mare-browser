//! Per-profile link delivery. URLs stay in memory; no login URLs are written to IPC files.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const LIMIT: u64 = 65_536;

pub fn valid_url(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 16_384
        && !value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '"')
        && url::Url::parse(value).is_ok_and(|u| {
            matches!(u.scheme(), "http" | "https")
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        })
}

pub fn urls(arguments: impl IntoIterator<Item = String>) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        let value = if argument == "--open-url" {
            arguments.next().ok_or("Endereço ausente.")?
        } else if argument.starts_with("http://") || argument.starts_with("https://") {
            argument
        } else {
            return Err("Argumento de inicialização desconhecido.".into());
        };
        if !valid_url(&value) || result.len() >= 8 {
            return Err("Endereço externo inválido.".into());
        }
        result.push(value);
    }
    Ok(result)
}

#[derive(Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    nonce: String,
}
#[derive(Serialize, Deserialize)]
struct Request {
    nonce: String,
    urls: Vec<String>,
}

pub enum Launch {
    Primary(Instance),
    Forwarded,
}
pub struct Instance {
    _lock: File,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    endpoint: PathBuf,
}
impl Drop for Instance {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        let _ = fs::remove_file(&self.endpoint);
    }
}

fn forward(path: &Path, urls: &[String]) -> Result<(), String> {
    let started = std::time::Instant::now();
    for _ in 0..30 {
        if started.elapsed() > Duration::from_secs(4) {
            break;
        }
        let sent = (|| -> Option<()> {
            let mut bytes = Vec::new();
            File::open(path)
                .ok()?
                .take(1025)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() > 1024 {
                return None;
            }
            let endpoint: Endpoint = serde_json::from_slice(&bytes).ok()?;
            if endpoint.nonce.len() != 32 {
                return None;
            }
            let address = SocketAddr::from((Ipv4Addr::LOCALHOST, endpoint.port));
            let mut stream =
                TcpStream::connect_timeout(&address, Duration::from_millis(200)).ok()?;
            stream.set_read_timeout(Some(Duration::from_secs(1))).ok()?;
            stream
                .set_write_timeout(Some(Duration::from_secs(1)))
                .ok()?;
            let mut request = serde_json::to_vec(&Request {
                nonce: endpoint.nonce,
                urls: urls.to_vec(),
            })
            .ok()?;
            request.push(b'\n');
            if request.len() as u64 > LIMIT {
                return None;
            }
            stream.write_all(&request).ok()?;
            let mut response = [0; 3];
            stream.read_exact(&mut response).ok()?;
            (response == *b"OK\n").then_some(())
        })();
        if sent.is_some() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(60));
    }
    Err("O Compass aberto não respondeu. Tente abrir o link novamente.".into())
}

impl Instance {
    pub fn acquire(
        directory: &Path,
        urls: &[String],
        deliver: impl Fn(Vec<String>) -> bool + Send + 'static,
    ) -> Result<Launch, String> {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let runtime = directory.join("runtime");
        fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        // The OS releases the exclusive handle on exit, including crashes. Keep the zero-byte file.
        let lock_path = directory.join("browser-instance.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let endpoint_path = runtime.join("browser-instance.json");
        let lock = match options.open(lock_path) {
            Ok(lock) => lock,
            Err(error) if error.raw_os_error() == Some(32) => {
                forward(&endpoint_path, urls)?;
                return Ok(Launch::Forwarded);
            }
            Err(error) => return Err(error.to_string()),
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| "Falha ao preparar a comunicação local.")?;
        let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let endpoint = Endpoint {
            port: listener.local_addr().map_err(|e| e.to_string())?.port(),
            nonce: nonce.clone(),
        };
        let temporary = endpoint_path.with_extension("tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(&endpoint).map_err(|e| e.to_string())?,
        )
        .and_then(|()| fs::rename(temporary, &endpoint_path))
        .map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("compass-links".into())
            .spawn(move || {
                while !stopping.load(Ordering::Relaxed) {
                    let Ok((mut stream, peer)) = listener.accept() else {
                        thread::sleep(Duration::from_millis(80));
                        continue;
                    };
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                    let mut bytes = Vec::new();
                    let read = BufReader::new(&mut stream)
                        .take(LIMIT + 1)
                        .read_until(b'\n', &mut bytes);
                    let accepted = read.is_ok()
                        && bytes.len() as u64 <= LIMIT
                        && bytes.last() == Some(&b'\n')
                        && serde_json::from_slice::<Request>(&bytes).is_ok_and(|request| {
                            let matches = Sha256::digest(request.nonce.as_bytes())
                                == Sha256::digest(nonce.as_bytes());
                            matches
                                && request.urls.len() <= 8
                                && request.urls.iter().all(|url| valid_url(url))
                                && deliver(request.urls)
                        });
                    let _ = stream.write_all(if accepted { b"OK\n" } else { b"NO\n" });
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Launch::Primary(Self {
            _lock: lock,
            stop,
            worker: Some(worker),
            endpoint: endpoint_path,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_links_preserve_oauth_queries_and_reject_privileged_schemes() {
        let url =
            "https://example.com/auth?state=a%2Bb&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb";
        assert_eq!(urls(["--open-url".into(), url.into()]).unwrap(), vec![url]);
        for bad in [
            "javascript:alert(1)",
            "file:///C:/test",
            "riotclient://open",
            "https://user:password@example.com/",
            "https://example.com/\n",
            "--native-app",
        ] {
            assert!(urls(["--open-url".into(), bad.into()]).is_err());
        }
        assert!(urls(["--open-url".into()]).is_err());
    }
    #[test]
    #[cfg(windows)]
    fn repeated_launch_delivers_links_to_the_owner_and_recovers_after_exit() {
        let directory = std::env::temp_dir().join(format!(
            "compass-launch-{}-{}",
            std::process::id(),
            crate::model::now_ms()
        ));
        let (tx, rx) = std::sync::mpsc::channel();
        let Launch::Primary(owner) =
            Instance::acquire(&directory, &[], move |urls| tx.send(urls).is_ok()).unwrap()
        else {
            panic!("expected owner");
        };
        let link = "https://example.com/?state=a%2Bb".to_string();
        assert!(matches!(
            Instance::acquire(&directory, std::slice::from_ref(&link), |_| false).unwrap(),
            Launch::Forwarded
        ));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), vec![link]);
        let endpoint: Endpoint = serde_json::from_slice(
            &fs::read(directory.join("runtime/browser-instance.json")).unwrap(),
        )
        .unwrap();
        let mut bad = TcpStream::connect((Ipv4Addr::LOCALHOST, endpoint.port)).unwrap();
        bad.write_all(b"{\"nonce\":\"wrong\",\"urls\":[]}\n")
            .unwrap();
        let mut reply = [0; 3];
        bad.read_exact(&mut reply).unwrap();
        assert_eq!(&reply, b"NO\n");
        assert!(rx.try_recv().is_err());
        drop(owner);
        assert!(matches!(
            Instance::acquire(&directory, &[], |_| true).unwrap(),
            Launch::Primary(_)
        ));
        let _ = fs::remove_dir_all(directory);
    }
}
