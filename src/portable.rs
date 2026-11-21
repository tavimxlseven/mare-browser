//! Linux implementations of the OS services used by the existing native apps.
use serde_json::Value;
use std::{io::Read, process::Command, time::Duration};

pub trait CommandExt {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}
impl CommandExt for Command {
    fn creation_flags(&mut self, _: u32) -> &mut Self {
        self
    }
}
pub fn prepare_job(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

pub fn json(
    url: &str,
    body: Option<&[u8]>,
    token: Option<&str>,
    content_type: &str,
    origin: Option<&str>,
) -> Result<Value, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Endereço inválido.")?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("A conexão deve usar HTTPS sem credenciais no endereço.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("NoiseMusic/0.6.4 (Linux)")
        .build()
        .map_err(|_| "Conexão segura indisponível.")?;
    let mut request = if let Some(body) = body {
        client
            .post(url)
            .header("Content-Type", content_type)
            .body(body.to_vec())
    } else {
        client.get(url)
    };
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(origin) = origin {
        request = request.header("Origin", origin);
    }
    let response = request
        .send()
        .map_err(|_| "Não foi possível acessar o servidor. Verifique sua conexão.")?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "Usuário, senha ou sessão inválidos. Entre novamente na conta.".into(),
            429 => "Limite de solicitações atingido. Aguarde e tente novamente.".into(),
            code => format!("O servidor retornou HTTP {code}. Tente novamente."),
        });
    }
    let mut bytes = Vec::new();
    response
        .take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Resposta interrompida.")?;
    if bytes.len() > 2_000_000 {
        return Err("Resposta excede o limite permitido.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "O servidor retornou uma resposta inválida.".into())
}

fn key() -> Result<[u8; 32], String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{io::Write, process::Stdio};
    let output = Command::new("secret-tool")
        .args([
            "lookup",
            "application",
            "noise-music",
            "purpose",
            "cloud-session-v1",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| {
            "Instale libsecret-tools e desbloqueie o chaveiro do Ubuntu para salvar a conta."
        })?;
    if output.status.success() {
        let bytes = STANDARD
            .decode(String::from_utf8_lossy(&output.stdout).trim())
            .map_err(|_| "Chave protegida inválida.")?;
        return bytes
            .try_into()
            .map_err(|_| "Chave protegida inválida.".into());
    }
    let mut key = [0; 32];
    getrandom::fill(&mut key).map_err(|_| "Gerador seguro indisponível.")?;
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label=Noise Music",
            "application",
            "noise-music",
            "purpose",
            "cloud-session-v1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Chaveiro indisponível.")?;
    child
        .stdin
        .take()
        .ok_or("Chaveiro indisponível.")?
        .write_all(STANDARD.encode(key).as_bytes())
        .map_err(|_| "Falha ao salvar a chave.")?;
    if !child
        .wait()
        .map_err(|_| "Chaveiro indisponível.")?
        .success()
    {
        return Err("Desbloqueie o chaveiro do Ubuntu para salvar sua conta com segurança.".into());
    }
    Ok(key)
}
pub fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    crypt(bytes, encrypt, &key()?)
}
fn crypt(bytes: &[u8], encrypt: bool, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
    let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).map_err(|_| "Chave inválida.")?);
    if encrypt {
        let mut nonce = [0; 12];
        getrandom::fill(&mut nonce).map_err(|_| "Gerador seguro indisponível.")?;
        let mut data = bytes.to_vec();
        key.seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(b"noise-cloud-v1"),
            &mut data,
        )
        .map_err(|_| "Falha ao proteger a conta.")?;
        let mut output = nonce.to_vec();
        output.extend(data);
        Ok(output)
    } else {
        let nonce: [u8; 12] = bytes
            .get(..12)
            .ok_or("Sessão protegida inválida.")?
            .try_into()
            .unwrap();
        let mut data = bytes[12..].to_vec();
        let clear = key
            .open_in_place(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(b"noise-cloud-v1"),
                &mut data,
            )
            .map_err(|_| "Sessão inválida ou chaveiro diferente. Entre novamente.")?;
        Ok(clear.to_vec())
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn session_cipher_authenticates_the_key_and_payload() {
        let raw = b"private session fixture";
        let mut sealed = super::crypt(raw, true, &[1; 32]).unwrap();
        assert_ne!(sealed, raw);
        assert_eq!(super::crypt(&sealed, false, &[1; 32]).unwrap(), raw);
        assert!(super::crypt(&sealed, false, &[2; 32]).is_err());
        sealed[13] ^= 1;
        assert!(super::crypt(&sealed, false, &[1; 32]).is_err());
        assert!(super::crypt(&[], false, &[1; 32]).is_err());
    }
}
