//! Chrome Web Store packages, verified before unpacking into the persistent profile.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};
use webview2_com::{
    take_pwstr, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    Microsoft::Web::WebView2::Win32::*, ProfileAddBrowserExtensionCompletedHandler,
    ProfileGetBrowserExtensionsCompletedHandler,
};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::{WebView, WebViewExtWindows};

#[derive(Debug, Clone)]
pub struct Prepared {
    pub id: String,
    pub folder: PathBuf,
    pub summary: Value,
}

pub fn store_id(input: &str) -> Result<String, String> {
    let input = input.trim();
    if valid_id(input) {
        return Ok(input.into());
    }
    let url = url::Url::parse(input).map_err(|_| "Cole o link da extensão na Chrome Web Store.")?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("chromewebstore.google.com" | "chrome.google.com")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Use um link HTTPS da Chrome Web Store.".into());
    }
    url.path_segments()
        .and_then(|mut parts| parts.rfind(|p| !p.is_empty()))
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .ok_or("O link não contém um ID de extensão válido.".into())
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

// Small bounded protobuf reader for the CRX3 header. ZIP contents stay opaque until verified.
fn fields(mut bytes: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    fn varint(bytes: &mut &[u8]) -> Result<u64, String> {
        let mut value = 0u64;
        for shift in (0..=63).step_by(7) {
            let (&byte, rest) = bytes.split_first().ok_or("Cabeçalho CRX truncado.")?;
            *bytes = rest;
            if shift == 63 && byte > 1 {
                return Err("Cabeçalho CRX inválido.".into());
            }
            value |= u64::from(byte & 127) << shift;
            if byte < 128 {
                return Ok(value);
            }
        }
        Err("Cabeçalho CRX inválido.".into())
    }
    let mut result = Vec::new();
    while !bytes.is_empty() {
        if result.len() > 64 {
            return Err("Cabeçalho CRX excede o limite.".into());
        }
        let tag = varint(&mut bytes)?;
        if tag >> 3 == 0 {
            return Err("Cabeçalho CRX inválido.".into());
        }
        match tag & 7 {
            2 => {
                let size = usize::try_from(varint(&mut bytes)?).map_err(|_| "CRX inválido.")?;
                let value = bytes.get(..size).ok_or("Cabeçalho CRX truncado.")?;
                result.push((tag >> 3, value));
                bytes = &bytes[size..];
            }
            0 => {
                varint(&mut bytes)?;
            }
            _ => return Err("Formato de cabeçalho CRX não suportado.".into()),
        }
    }
    Ok(result)
}
fn extension_id(key: &[u8]) -> String {
    Sha256::digest(key)[..16]
        .iter()
        .flat_map(|byte| {
            [
                char::from(b'a' + (byte >> 4)),
                char::from(b'a' + (byte & 15)),
            ]
        })
        .collect()
}
fn verify_crx<'a>(
    bytes: &'a [u8],
    id: &str,
    require_store: bool,
) -> Result<(&'a [u8], Vec<u8>), String> {
    if !valid_id(id) {
        return Err("Identidade de extensão inválida.".into());
    }
    if bytes.len() < 12 || &bytes[..4] != b"Cr24" || bytes[4..8] != 3u32.to_le_bytes() {
        return Err("A loja não retornou um pacote CRX3 compatível.".into());
    }
    let size = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if size > 1_048_576 || size > bytes.len() - 12 {
        return Err("Cabeçalho CRX inválido.".into());
    }
    let header = fields(&bytes[12..12 + size])?;
    let signed = header
        .iter()
        .find(|(tag, _)| *tag == 10000)
        .map(|(_, data)| *data)
        .ok_or("CRX sem assinatura de identidade.")?;
    let identity = fields(signed)?
        .into_iter()
        .find(|(tag, _)| *tag == 1)
        .map(|(_, value)| value)
        .ok_or("CRX sem identidade.")?;
    let expected: Vec<u8> = id
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| (b[0] - b'a') * 16 + (b[1] - b'a'))
        .collect();
    if identity != expected {
        return Err("A identidade do pacote difere da extensão solicitada.".into());
    }
    let zip = &bytes[12 + size..];
    let mut message = Vec::with_capacity(20 + signed.len() + zip.len());
    message.extend_from_slice(b"CRX3 SignedData\0");
    message.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    message.extend_from_slice(signed);
    message.extend_from_slice(zip);
    let mut developer_key = None;
    let mut publisher_verified = !require_store;
    let publisher_hash = [
        0x61, 0xf7, 0xf2, 0xa6, 0xbf, 0xcf, 0x74, 0xcd, 0x0b, 0xc1, 0xfe, 0x24, 0x97, 0xcc, 0x9b,
        0x04, 0x25, 0x4c, 0x65, 0x8f, 0x79, 0xf2, 0x14, 0x53, 0x92, 0x86, 0x7e, 0xa8, 0x36, 0x63,
        0x67, 0xcf,
    ];
    for (tag, proof) in header.iter().filter(|(tag, _)| matches!(*tag, 2 | 3)) {
        let proof = fields(proof)?;
        let key = proof
            .iter()
            .find(|(t, _)| *t == 1)
            .map(|(_, v)| *v)
            .unwrap_or_default();
        let signature = proof
            .iter()
            .find(|(t, _)| *t == 2)
            .map(|(_, v)| *v)
            .unwrap_or_default();
        let developer = extension_id(key) == id;
        let publisher = Sha256::digest(key).as_slice() == publisher_hash;
        if !developer && !publisher {
            continue;
        }
        // CRX RSA public keys use DER SubjectPublicKeyInfo. ring expects PKCS#1.
        let rsa = if *tag == 2 {
            rsa_pkcs1(key).unwrap_or_default()
        } else {
            key
        };
        let verified = if *tag == 2 {
            ring::signature::UnparsedPublicKey::new(
                &ring::signature::RSA_PKCS1_1024_8192_SHA256_FOR_LEGACY_USE_ONLY,
                rsa,
            )
            .verify(&message, signature)
            .is_ok()
        } else {
            // DER SPKI P-256 ends with an uncompressed 65-byte EC point.
            key.len() >= 65
                && ring::signature::UnparsedPublicKey::new(
                    &ring::signature::ECDSA_P256_SHA256_ASN1,
                    &key[key.len() - 65..],
                )
                .verify(&message, signature)
                .is_ok()
        };
        if verified && developer {
            developer_key = Some(key.to_vec());
        }
        if verified && publisher {
            publisher_verified = true;
        }
    }
    if let Some(key) = developer_key.filter(|_| publisher_verified) {
        return Ok((zip, key));
    }
    Err("A assinatura da extensão não pôde ser verificada.".into())
}
fn rsa_pkcs1(key: &[u8]) -> Option<&[u8]> {
    fn tlv(bytes: &[u8]) -> Option<(u8, &[u8], &[u8])> {
        let (&tag, rest) = bytes.split_first()?;
        let (&first, rest) = rest.split_first()?;
        let (len, rest) = if first < 128 {
            (first as usize, rest)
        } else {
            let count = (first & 127) as usize;
            if count == 0 || count > 4 {
                return None;
            }
            let mut len = 0usize;
            for byte in rest.get(..count)? {
                len = len.checked_mul(256)?.checked_add(*byte as usize)?;
            }
            (len, &rest[count..])
        };
        Some((tag, rest.get(..len)?, rest.get(len..)?))
    }
    let (tag, sequence, _) = tlv(key)?;
    if tag != 0x30 {
        return None;
    }
    let (_, _, rest) = tlv(sequence)?;
    let (tag, bits, _) = tlv(rest)?;
    if tag != 3 || bits.first() != Some(&0) {
        return None;
    }
    Some(&bits[1..])
}

pub fn prepare(root: &Path, id: &str) -> Result<Prepared, String> {
    if !valid_id(id) {
        return Err("ID inválido.".into());
    }
    let mut endpoint = url::Url::parse("https://clients2.google.com/service/update2/crx").unwrap();
    endpoint
        .query_pairs_mut()
        .append_pair("response", "redirect")
        .append_pair("prodversion", "150.0.0.0")
        .append_pair("acceptformat", "crx3")
        .append_pair("x", &format!("id={id}&installsource=ondemand&uc"));
    let bytes = fetch(endpoint.as_str())?;
    let (data, key) = verify_crx(&bytes, id, true)?;
    let folder = root.join(format!("pending-{id}"));
    if folder.exists() {
        fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let result = unpack(data, &folder, &key, id);
    if result.is_err() {
        let _ = fs::remove_dir_all(&folder);
    }
    result.map(|summary| Prepared {
        id: id.into(),
        folder,
        summary,
    })
}
fn unpack(data: &[u8], folder: &Path, key: &[u8], id: &str) -> Result<Value, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;
    if zip.len() > 8000 {
        return Err("A extensão excede o limite de arquivos.".into());
    }
    let mut total = 0u64;
    for index in 0..zip.len() {
        let mut item = zip.by_index(index).map_err(|e| e.to_string())?;
        let path = item
            .enclosed_name()
            .ok_or("O pacote contém um caminho inseguro.")?;
        if item.name().contains('\\')
            || item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            || path
                .components()
                .any(|p| p.as_os_str().to_string_lossy().contains(':'))
        {
            return Err("O pacote contém um caminho inseguro.".into());
        }
        if path.starts_with("_metadata") {
            continue;
        }
        total = total.saturating_add(item.size());
        if total > 268_435_456 || item.size() > 67_108_864 {
            return Err("A extensão excede o limite de tamanho.".into());
        }
        let target = folder.join(path);
        if item.is_dir() {
            fs::create_dir_all(target).map_err(|e| e.to_string())?;
            continue;
        }
        fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut item.by_ref().take(67_108_865), &mut output)
            .map_err(|e| e.to_string())?;
    }
    let manifest_path = folder.join("manifest.json");
    let bytes = fs::read(&manifest_path).map_err(|_| "Extensão sem manifest.json.")?;
    if bytes.len() > 1_048_576 {
        return Err("Manifesto excede o limite.".into());
    }
    let mut manifest: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Manifesto de extensão inválido.")?;
    if !manifest.is_object() || manifest["manifest_version"] != 3 {
        return Err("Esta versão aceita extensões Manifest V3. A loja pode oferecer extensões incompatíveis com o WebView2.".into());
    }
    manifest["key"] = json!(STANDARD.encode(key));
    fs::write(manifest_path, serde_json::to_vec_pretty(&manifest).unwrap())
        .map_err(|e| e.to_string())?;
    let name = manifest["name"].as_str().unwrap_or(id);
    let mut name = name.to_string();
    if name.starts_with("__MSG_") {
        let lang = manifest["default_locale"]
            .as_str()
            .filter(|l| l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
            .unwrap_or("en");
        if let Ok(bytes) = fs::read(folder.join("_locales").join(lang).join("messages.json")) {
            if let Ok(messages) = serde_json::from_slice::<Value>(&bytes) {
                let key = name.trim_start_matches("__MSG_").trim_end_matches("__");
                if let Some(text) = messages[key]["message"].as_str() {
                    name = text.into();
                }
            }
        }
    }
    let permissions: Vec<Value> = ["permissions", "host_permissions"]
        .iter()
        .flat_map(|key| {
            manifest[*key]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| v.is_string())
                .cloned()
        })
        .take(100)
        .collect();
    Ok(
        json!({"id":id,"name":name.chars().take(160).collect::<String>(),"version":manifest["version"],"permissions":permissions,"popup":popup(&manifest)}),
    )
}
pub fn popup(manifest: &Value) -> Option<&str> {
    manifest["action"]["default_popup"].as_str().filter(|p| {
        !p.is_empty()
            && !p.contains([':', '\\'])
            && !p.starts_with('/')
            && !p.split('/').any(|s| s == "..")
    })
}
fn profile(view: &WebView) -> Result<ICoreWebView2Profile7, String> {
    unsafe {
        view.webview()
            .cast::<ICoreWebView2_13>()
            .and_then(|v| v.Profile())
            .and_then(|p| p.cast())
            .map_err(|_| "Atualize o WebView2 Runtime para gerenciar extensões.".into())
    }
}
pub fn install(
    view: &WebView,
    folder: &Path,
    done: impl FnOnce(Result<(), String>) + 'static,
) -> Result<(), String> {
    let profile = profile(view)?;
    let handler =
        ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
            done(
                result
                    .and_then(|_| {
                        extension.ok_or_else(|| {
                            windows::core::Error::from_hresult(windows::core::HRESULT(
                                0x80004005u32 as i32,
                            ))
                        })
                    })
                    .map(|_| ())
                    .map_err(|e| format!("O WebView2 não aceitou esta extensão: {e}")),
            );
            Ok(())
        }));
    unsafe {
        profile
            .AddBrowserExtension(&HSTRING::from(folder.as_os_str()), &handler)
            .map_err(|e| e.to_string())
    }
}
pub fn list(
    view: &WebView,
    root: PathBuf,
    done: impl FnOnce(Value) + 'static,
) -> Result<(), String> {
    let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
        move |result, list| {
            let mut values = Vec::new();
            if result.is_ok() {
                if let Some(list) = list {
                    unsafe {
                        let mut count = 0;
                        let _ = list.Count(&mut count);
                        for index in 0..count.min(100) {
                            if let Ok(extension) = list.GetValueAtIndex(index) {
                                let (mut id, mut name) = (PWSTR::null(), PWSTR::null());
                                let mut enabled = windows::core::BOOL::default();
                                if extension.Id(&mut id).is_ok()
                                    && extension.Name(&mut name).is_ok()
                                {
                                    let id = take_pwstr(id);
                                    let name = take_pwstr(name);
                                    // The runtime also reports its own PDF/clipboard extensions.
                                    // They belong to WebView2, not to the user's extension list.
                                    if !valid_id(&id)
                                        || !root.join(&id).join("manifest.json").is_file()
                                    {
                                        continue;
                                    }
                                    let _ = extension.IsEnabled(&mut enabled);
                                    let manifest = fs::read(root.join(&id).join("manifest.json"))
                                        .ok()
                                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                                        .unwrap_or_default();
                                    values.push(json!({"id":id,"name":name,"enabled":enabled.as_bool(),"popup":popup(&manifest)}));
                                }
                            }
                        }
                    }
                }
            }
            done(json!({"items":values,"error":result.err().map(|e|e.to_string())}));
            Ok(())
        },
    ));
    unsafe {
        profile(view)?
            .GetBrowserExtensions(&handler)
            .map_err(|e| e.to_string())
    }
}
pub fn change(
    view: &WebView,
    id: String,
    enabled: Option<bool>,
    done: impl FnOnce(Result<(), String>) + 'static,
) -> Result<(), String> {
    let handler =
        ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
            if let Err(e) = result {
                done(Err(e.to_string()));
                return Ok(());
            }
            if let Some(list) = list {
                unsafe {
                    let mut count = 0;
                    let _ = list.Count(&mut count);
                    for index in 0..count.min(100) {
                        if let Ok(extension) = list.GetValueAtIndex(index) {
                            let mut value = PWSTR::null();
                            if extension.Id(&mut value).is_ok() && take_pwstr(value) == id {
                                let done = std::rc::Rc::new(std::cell::RefCell::new(Some(done)));
                                let completed = done.clone();
                                if let Some(enabled) = enabled {
                                    let callback = BrowserExtensionEnableCompletedHandler::create(
                                        Box::new(move |r| {
                                            if let Some(done) = completed.borrow_mut().take() {
                                                done(r.map_err(|e| e.to_string()));
                                            }
                                            Ok(())
                                        }),
                                    );
                                    if let Err(error) = extension.Enable(enabled, &callback) {
                                        if let Some(done) = done.borrow_mut().take() {
                                            done(Err(error.to_string()));
                                        }
                                    }
                                } else {
                                    let callback = BrowserExtensionRemoveCompletedHandler::create(
                                        Box::new(move |r| {
                                            if let Some(done) = completed.borrow_mut().take() {
                                                done(r.map_err(|e| e.to_string()));
                                            }
                                            Ok(())
                                        }),
                                    );
                                    if let Err(error) = extension.Remove(&callback) {
                                        if let Some(done) = done.borrow_mut().take() {
                                            done(Err(error.to_string()));
                                        }
                                    }
                                }
                                return Ok(());
                            }
                        }
                    }
                }
            }
            done(Err("Extensão não encontrada.".into()));
            Ok(())
        }));
    unsafe {
        profile(view)?
            .GetBrowserExtensions(&handler)
            .map_err(|e| e.to_string())
    }
}

fn fetch(input: &str) -> Result<Vec<u8>, String> {
    use windows::{
        core::{w, PCWSTR},
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
            Err("Falha ao conectar à loja.".to_string())
        } else {
            Ok(Handle(p))
        }
    };
    let mut url = url::Url::parse(input).map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    unsafe {
        let session = checked(WinHttpOpen(
            w!("MareExtensions/0.3"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 5000, 10000, 15000, 15000).map_err(|e| e.to_string())?;
        for _ in 0..6 {
            let host = url.host_str().unwrap_or("");
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.port().is_some()
                || !(host == "clients2.google.com"
                    || host.ends_with(".googleusercontent.com")
                    || host.ends_with(".gvt1.com"))
            {
                return Err("Redirecionamento da loja não reconhecido.".into());
            }
            let connection = checked(WinHttpConnect(session.0, &HSTRING::from(host), 443, 0))?;
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
                .map_err(|e| e.to_string())?;
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
                let mut location = [0u16; 4096];
                let mut size = (location.len() * 2) as u32;
                WinHttpQueryHeaders(
                    request.0,
                    WINHTTP_QUERY_LOCATION,
                    PCWSTR::null(),
                    Some(location.as_mut_ptr().cast()),
                    &mut size,
                    std::ptr::null_mut(),
                )
                .map_err(|e| e.to_string())?;
                let location = String::from_utf16_lossy(&location[..size as usize / 2]);
                url = url
                    .join(location.trim_end_matches('\0'))
                    .map_err(|e| e.to_string())?;
                continue;
            }
            if status != 200 {
                return Err(format!("A Chrome Web Store retornou HTTP {status}. Extensões pagas, restritas ou indisponíveis não podem ser instaladas por este fluxo."));
            }
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0u8; 65536];
                let mut read = 0;
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
                .map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..read as usize]);
                if bytes.len() > 67_108_864 || started.elapsed().as_secs() > 90 {
                    return Err("O pacote excedeu o limite de tamanho ou tempo.".into());
                }
            }
            return Ok(bytes);
        }
    }
    Err("A loja excedeu o limite de redirecionamentos.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_crx_is_bound_to_id_and_archive_and_unpacks() {
        let id = include_str!("../assets/tests/extension-rsa-id.txt").trim();
        let package = include_bytes!("../assets/tests/extension-rsa.crx");
        let (zip, key) = verify_crx(package, id, false).unwrap();
        assert!(verify_crx(package, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false).is_err());
        let mut altered = package.to_vec();
        *altered.last_mut().unwrap() ^= 1;
        assert!(verify_crx(&altered, id, false).is_err());
        let folder = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-profiles")
            .join(format!("extension-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let summary = unpack(zip, &folder, &key, id).unwrap();
        assert_eq!(summary["name"], "Mare extension test fixture");
        let manifest: Value =
            serde_json::from_slice(&fs::read(folder.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(
            extension_id(&STANDARD.decode(manifest["key"].as_str().unwrap()).unwrap()),
            id
        );
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    #[ignore = "network: downloads a public Chrome Web Store package without installing it"]
    fn public_store_package_has_a_valid_signature() {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-profiles/store-download-qa");
        let prepared = prepare(&root, "aapbdbdomjkkjkaonfhkkikfgjllcleb").unwrap();
        assert!(prepared.folder.join("manifest.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn store_urls_and_ids_are_scoped() {
        let id = "ddkjiahejlhfcafbddmgiahcphecmpfh";
        assert_eq!(
            store_id(&format!(
                "https://chromewebstore.google.com/detail/ublock/{id}"
            ))
            .unwrap(),
            id
        );
        for input in [
            "https://evil.example/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://chromewebstore.google.com@evil.example/a",
            "../manifest.json",
            "abcdefghijklmnopqrstuvxyzabcdefg",
        ] {
            assert!(store_id(input).is_err());
        }
        assert!(verify_crx(b"not a signed package", id, false).is_err());
    }
    #[test]
    fn extension_popup_cannot_escape_its_origin() {
        for path in ["../a.html", "https://evil.example", "/a", "a\\b"] {
            assert!(popup(&json!({"action":{"default_popup":path}})).is_none());
        }
    }
}
