//! Stable releases only; stream to disk and verify before offering installation.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const REPOSITORY: &str = "https://github.com/tavimxlseven/mare-browser";
// The public release asset endpoint avoids unauthenticated GitHub API rate limits.
const LATEST: &str =
    "https://github.com/tavimxlseven/mare-browser/releases/latest/download/SHA256SUMS.txt";
const MAX_SETUP: u64 = 512 * 1024 * 1024;
#[derive(Default)]
struct State {
    value: Value,
    ready: Option<(PathBuf, String)>,
    busy: bool,
    last_check: Option<Instant>,
}
#[derive(Clone, Default)]
pub struct Manager(Arc<Mutex<State>>);
impl Manager {
    pub fn snapshot(&self) -> Value {
        self.0.lock().unwrap().value.clone()
    }
    pub fn check(&self, root: PathBuf, manual: bool, changed: impl Fn() + Send + 'static) {
        {
            let mut state = self.0.lock().unwrap();
            if state.busy
                || state.ready.is_some()
                || (!manual
                    && state
                        .last_check
                        .is_some_and(|time| time.elapsed() < Duration::from_secs(3600)))
            {
                return;
            }
            state.busy = true;
            state.last_check = Some(Instant::now());
            state.value = json!({"status":"checking", "manual":manual});
        }
        changed();
        let this = self.clone();
        std::thread::spawn(move || {
            cleanup_installed_setups(&root);
            let result = prepare(&root, |value| {
                this.0.lock().unwrap().value = value;
                changed();
            });
            let mut state = this.0.lock().unwrap();
            match result {
                Ok(Some((path, digest, version))) => {
                    state.ready = Some((path, digest));
                    state.value = json!({"status":"ready", "version":version, "manual":manual});
                }
                Ok(None) => state.value = json!({"status":"current", "manual":manual}),
                Err(error) => {
                    state.value = json!({"status":"error", "message":error, "manual":manual})
                }
            }
            state.busy = false;
            drop(state);
            changed();
        });
    }
    pub fn install_on_close(&self) -> Result<(), String> {
        let ready = self.0.lock().unwrap().ready.take();
        let Some((path, digest)) = ready else {
            return Ok(());
        };
        let result = (|| {
            if file_digest(&path)? != digest {
                return Err(
                    "O instalador mudou após a verificação. Baixe a atualização novamente."
                        .to_string(),
                );
            }
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let folder = exe.parent().ok_or("Pasta do Compass indisponível.")?;
            std::process::Command::new(path)
                .args([
                    "/VERYSILENT",
                    "/SUPPRESSMSGBOXES",
                    "/NORESTART",
                    "/MAREUPDATE=1",
                ])
                .arg(format!("/DIR={}", folder.display()))
                .spawn()
                .map_err(|_| "Não foi possível iniciar o instalador da atualização.".to_string())?;
            Ok(())
        })();
        if let Err(error) = &result {
            self.0.lock().unwrap().value = json!({"status":"error","message":error,"manual":true});
        }
        result
    }
}
fn cleanup_installed_setups(root: &Path) {
    let Ok(files) = std::fs::read_dir(root.join("updates")) else {
        return;
    };
    let current = version(env!("CARGO_PKG_VERSION")).unwrap();
    for file in files.flatten() {
        if !file.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let name = file.file_name();
        let name = name.to_string_lossy();
        let number = name
            .strip_prefix("Mare-Setup-")
            .and_then(|s| s.strip_suffix("-x64.exe"));
        if number.and_then(version).is_some_and(|v| v <= current) {
            let _ = std::fs::remove_file(file.path());
        }
    }
}
fn version(input: &str) -> Option<(u32, u32, u32)> {
    let mut parts = input.strip_prefix('v').unwrap_or(input).split('.');
    let mut next = || {
        let s = parts.next()?;
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    let value = (next()?, next()?, next()?);
    if parts.next().is_some() {
        None
    } else {
        Some(value)
    }
}
fn checksum(manifest: &str, asset: &str) -> Result<String, String> {
    let matches: Vec<_> = manifest
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let digest = fields.next()?;
            let file = fields.next()?.trim_start_matches('*');
            (file == asset
                && fields.next().is_none()
                && digest.len() == 64
                && digest.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| digest.to_ascii_lowercase())
        })
        .collect();
    if matches.len() == 1 {
        Ok(matches[0].clone())
    } else {
        Err("A versão não tem uma soma de verificação válida.".into())
    }
}
fn latest_setup(manifest: &str) -> Result<(String, String, String), String> {
    let mut setups = Vec::new();
    for line in manifest.lines() {
        let Some(asset) = line.split_whitespace().nth(1) else {
            continue;
        };
        let asset = asset.trim_start_matches('*');
        let Some(number) = asset
            .strip_prefix("Mare-Setup-")
            .and_then(|name| name.strip_suffix("-x64.exe"))
        else {
            continue;
        };
        let Some(parsed) = version(number) else {
            continue;
        };
        if number != format!("{}.{}.{}", parsed.0, parsed.1, parsed.2) {
            continue;
        }
        setups.push((
            number.to_string(),
            asset.to_string(),
            checksum(manifest, asset)?,
        ));
    }
    if setups.len() == 1 {
        Ok(setups.remove(0))
    } else {
        Err("O manifesto não identifica um instalador estável único.".into())
    }
}
fn file_digest(path: &Path) -> Result<String, String> {
    let mut input = File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn allowed_url(url: &url::Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    match url.host_str().unwrap_or("") {
        "github.com" => {
            url.path() == "/tavimxlseven/mare-browser/releases/latest/download/SHA256SUMS.txt"
                || url
                    .path()
                    .starts_with("/tavimxlseven/mare-browser/releases/download/v")
        }
        "release-assets.githubusercontent.com" | "objects.githubusercontent.com" => true,
        _ => false,
    }
}
fn small_file(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fetch(url, max, |chunk| {
        bytes.extend_from_slice(chunk);
        Ok(())
    })?;
    Ok(bytes)
}
fn prepare(
    root: &Path,
    progress: impl Fn(Value),
) -> Result<Option<(PathBuf, String, String)>, String> {
    let latest_manifest = String::from_utf8(small_file(LATEST, 65536)?)
        .map_err(|_| "Manifesto de atualização inválido.")?;
    let (number, asset, expected) = latest_setup(&latest_manifest)?;
    let remote = version(&number).ok_or("Versão da atualização inválida.")?;
    if remote <= version(env!("CARGO_PKG_VERSION")).unwrap() {
        return Ok(None);
    }
    let tag = format!("v{number}");
    let base = format!("{REPOSITORY}/releases/download/{tag}");
    let manifest = String::from_utf8(small_file(&format!("{base}/SHA256SUMS.txt"), 65536)?)
        .map_err(|_| "Manifesto de atualização inválido.")?;
    if checksum(&manifest, &asset)? != expected {
        return Err("O manifesto da versão mudou. Tente verificar novamente.".into());
    }
    let folder = root.join("updates");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let final_path = folder.join(&asset);
    if final_path.is_file() && file_digest(&final_path)? == expected {
        return Ok(Some((final_path, expected, number)));
    }
    let part = folder.join(format!("{asset}.part"));
    let result = (|| {
        let mut file = File::create(&part).map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut received = 0u64;
        let mut last = Instant::now() - Duration::from_secs(1);
        fetch(&format!("{base}/{asset}"), MAX_SETUP, |chunk| {
            file.write_all(chunk).map_err(|e| e.to_string())?;
            digest.update(chunk);
            received += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(300) {
                progress(json!({"status":"downloading", "version":number, "received":received}));
                last = Instant::now();
            }
            Ok(())
        })?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if format!("{:x}", digest.finalize()) != expected {
            return Err("O instalador não passou pela verificação SHA-256.".into());
        }
        // Windows rename cannot replace an old corrupt target.
        if final_path.exists() {
            std::fs::remove_file(&final_path).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
        Ok(Some((final_path, expected, number)))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(part);
    }
    result
}
fn fetch(
    input: &str,
    max: u64,
    mut chunk: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
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
            Err("Não foi possível conectar ao GitHub.".to_string())
        } else {
            Ok(Handle(p))
        }
    };
    let mut url = url::Url::parse(input).map_err(|_| "Endereço de atualização inválido.")?;
    let started = Instant::now();
    unsafe {
        let session = checked(WinHttpOpen(
            w!("MareUpdater/1"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 5000, 10000, 30000, 30000).map_err(|e| e.to_string())?;
        for _ in 0..6 {
            if !allowed_url(&url) {
                return Err("Redirecionamento de atualização não reconhecido.".into());
            }
            let connection = checked(WinHttpConnect(
                session.0,
                &HSTRING::from(url.host_str().unwrap()),
                443,
                0,
            ))?;
            let request = checked(WinHttpOpenRequest(
                connection.0,
                w!("GET"),
                &HSTRING::from(format!(
                    "{}{}",
                    url.path(),
                    url.query().map(|q| format!("?{q}")).unwrap_or_default()
                )),
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
            .map_err(|e| e.to_string())?;
            WinHttpSendRequest(request.0, None, None, 0, 0, 0)
                .and_then(|()| WinHttpReceiveResponse(request.0, std::ptr::null_mut()))
                .map_err(|_| "A conexão com o GitHub falhou.")?;
            let (mut status, mut size) = (0u32, 4u32);
            WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                PCWSTR::null(),
                Some((&mut status as *mut u32).cast()),
                &mut size,
                std::ptr::null_mut(),
            )
            .map_err(|e| e.to_string())?;
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                let mut location = [0u16; 8192];
                let mut size = (location.len() * 2) as u32;
                WinHttpQueryHeaders(
                    request.0,
                    WINHTTP_QUERY_LOCATION,
                    PCWSTR::null(),
                    Some(location.as_mut_ptr().cast()),
                    &mut size,
                    std::ptr::null_mut(),
                )
                .map_err(|_| "Redirecionamento inválido.")?;
                url = url
                    .join(
                        String::from_utf16_lossy(&location[..size as usize / 2])
                            .trim_end_matches('\0'),
                    )
                    .map_err(|_| "Redirecionamento inválido.")?;
                continue;
            }
            if status != 200 {
                return Err(format!(
                    "O GitHub retornou HTTP {status}. Tente novamente mais tarde."
                ));
            }
            let mut received = 0u64;
            loop {
                let mut buffer = [0u8; 65536];
                let mut read = 0;
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
                .map_err(|_| "O download da atualização foi interrompido.")?;
                if read == 0 {
                    break;
                }
                received += read as u64;
                if received > max || started.elapsed() > Duration::from_secs(900) {
                    return Err("A atualização excedeu o limite de tamanho ou tempo.".into());
                }
                chunk(&buffer[..read as usize])?;
            }
            return Ok(());
        }
    }
    Err("Limite de redirecionamentos da atualização excedido.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modified_installer_is_rejected_without_launching_it() {
        let root = std::env::temp_dir().join(format!("mare-updater-qa-{}", crate::model::now_ms()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("tampered.exe");
        std::fs::write(&path, b"changed after verification").unwrap();
        let manager = Manager::default();
        manager.0.lock().unwrap().ready = Some((path.clone(), "0".repeat(64)));
        assert!(manager.install_on_close().unwrap_err().contains("mudou"));
        assert_eq!(manager.snapshot()["status"], "error");
        assert!(manager.0.lock().unwrap().ready.is_none());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn only_stable_numeric_versions() {
        assert!(version("v0.5.1") > version("0.5.0"));
        for invalid in ["v0.5.0-beta", "1.2", "1.2.3.4", "../1.2.3", "1..2"] {
            assert!(version(invalid).is_none())
        }
    }
    #[test]
    fn manifest_requires_exact_asset_and_unambiguous_digest() {
        let hash = "ab".repeat(32);
        assert_eq!(
            checksum(
                &format!("{hash}  Mare-Setup-1.0.0-x64.exe"),
                "Mare-Setup-1.0.0-x64.exe"
            )
            .unwrap(),
            hash
        );
        assert!(checksum(&format!("{hash}  other.exe"), "Mare-Setup-1.0.0-x64.exe").is_err());
        assert!(checksum(&format!("{hash}  app.exe\n{hash} app.exe"), "app.exe").is_err());
        assert!(checksum("not-a-hash app.exe", "app.exe").is_err());
        let (number, asset, digest) =
            latest_setup(&format!("{hash}  Mare-Setup-1.0.0-x64.exe")).unwrap();
        assert_eq!(
            (number.as_str(), asset.as_str(), digest.as_str()),
            ("1.0.0", "Mare-Setup-1.0.0-x64.exe", hash.as_str())
        );
        for invalid in [
            format!("{hash} Mare-Setup-1.0.0-beta-x64.exe"),
            format!("{hash} ../../Mare-Setup-1.0.0-x64.exe"),
            format!("{hash} Mare-Setup-01.0.0-x64.exe"),
            format!("{hash} Mare-Setup-1.0.0-x64.exe\n{hash} Mare-Setup-2.0.0-x64.exe"),
        ] {
            assert!(latest_setup(&invalid).is_err());
        }
    }
    #[test]
    fn updater_urls_cannot_escape_trusted_hosts() {
        for input in [
            LATEST,
            "https://release-assets.githubusercontent.com/file?signature=example",
            "https://github.com/tavimxlseven/mare-browser/releases/download/v1.0.0/SHA256SUMS.txt",
        ] {
            assert!(allowed_url(&url::Url::parse(input).unwrap()))
        }
        for input in [
            "http://github.com/tavimxlseven/mare-browser/releases/download/v1.0.0/app.exe",
            "https://github.com/other/repo/releases/download/v1/a.exe",
            "https://release-assets.githubusercontent.com.evil.test/a",
            "https://user@objects.githubusercontent.com/a",
            "https://objects.githubusercontent.com:8443/a",
            "file:///C:/app.exe",
        ] {
            assert!(!allowed_url(&url::Url::parse(input).unwrap()))
        }
    }
}
