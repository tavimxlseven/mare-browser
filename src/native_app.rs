//! JSON-lines workers for bundled native apps. This path never creates a WebView.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_NOTEBOOK_BYTES: usize = 96 * 1024;
const MAX_NOTES: usize = 200;

/// Return Some only for worker invocations; call this before the browser event loop.
pub fn run_if_requested() -> Option<Result<(), String>> {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if !arguments.iter().any(|arg| arg == "--native-app") {
        return None;
    }
    let result = (|| {
        if arguments.len() != 4 || arguments[0] != "--native-app" || arguments[2] != "--data-dir" {
            return Err("Uso: --native-app notes|calculator|spotify --data-dir DIRETORIO_ABSOLUTO".into());
        }
        let app_id = arguments[1]
            .to_str()
            .ok_or("Identificador de app inválido.")?;
        if !matches!(app_id, "notes" | "calculator" | "spotify") {
            return Err("App nativo desconhecido.".into());
        }
        let directory = PathBuf::from(&arguments[3]);
        if !directory.is_absolute() {
            return Err("O diretório do app deve ser absoluto.".into());
        }
        let mut app = NativeApp::new(app_id, &directory)?;
        let stdin = io::stdin();
        let stdout = io::stdout();
        let mut input = stdin.lock();
        let mut output = stdout.lock();
        while let Some(line) = read_protocol_line(&mut input).map_err(|e| e.to_string())? {
            let response = match serde_json::from_str::<Value>(&line) {
                Ok(request) => app.handle(request),
                Err(_) => {
                    json!({"id":null,"method":null,"result":null,"error":{"code":"invalid_json","message":"Mensagem JSON inválida."}})
                }
            };
            let bytes = serde_json::to_vec(&response).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_MESSAGE_BYTES {
                return Err("A resposta excede o limite do protocolo.".into());
            }
            output
                .write_all(&bytes)
                .and_then(|()| output.write_all(b"\n"))
                .and_then(|()| output.flush())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    Some(result)
}

/// Bounded framing: never allocate an arbitrarily long stdin/stdout line.
pub fn read_protocol_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut bytes = Vec::new();
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Mensagem sem terminador.",
                ))
            };
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(buffer.len(), |index| index + 1);
        if bytes.len() + count > MAX_MESSAGE_BYTES + 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Mensagem excede o limite.",
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if newline.is_some() {
            bytes.pop();
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Mensagem não é UTF-8."));
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Note {
    id: u64,
    title: String,
    body: String,
    updated_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct Notebook {
    next_id: u64,
    notes: Vec<Note>,
}

impl Default for Notebook {
    fn default() -> Self {
        Self {
            next_id: 1,
            notes: Vec::new(),
        }
    }
}

struct NativeApp {
    id: String,
    directory: PathBuf,
    notebook: Notebook,
    spotify: Option<crate::spotify::Spotify>,
}

impl NativeApp {
    fn new(id: &str, directory: &Path) -> Result<Self, String> {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let notebook = if id == "notes" {
            match fs::read(directory.join("notes.json")) {
                Ok(bytes) => {
                    if bytes.len() > MAX_NOTEBOOK_BYTES {
                        return Err("O arquivo de notas excede o limite e foi preservado.".into());
                    }
                    let notebook: Notebook = serde_json::from_slice(&bytes).map_err(|_| {
                        "O arquivo de notas está inválido e foi preservado.".to_string()
                    })?;
                    let mut ids = std::collections::HashSet::new();
                    if notebook.notes.len() > MAX_NOTES
                        || notebook.notes.iter().any(|note| {
                            note.id == 0 || note.id >= notebook.next_id || !ids.insert(note.id)
                        })
                    {
                        return Err(
                            "O arquivo de notas contém identificadores inválidos e foi preservado."
                                .into(),
                        );
                    }
                    notebook
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => Notebook::default(),
                Err(error) => return Err(format!("Não foi possível abrir as notas: {error}")),
            }
        } else {
            Notebook::default()
        };
        Ok(Self {
            id: id.into(),
            directory: directory.to_path_buf(),
            notebook,
            spotify: if id == "spotify" {
                Some(crate::spotify::Spotify::new(directory)?)
            } else {
                None
            },
        })
    }

    fn handle(&mut self, request: Value) -> Value {
        let id = request["id"].as_u64();
        let method = request["method"].as_str().unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(json!({}));
        let result = if id.is_none() || !params.is_object() || method.len() > 48 {
            Err("Mensagem de app inválida.".into())
        } else if let Some(spotify) = self.spotify.as_mut() {
            spotify.handle(method, &params)
        } else if method == "hello" {
            Ok(
                json!({"app_id":self.id,"protocol_version":1,"methods":if self.id=="notes" {vec!["list","create","update","delete"]} else {vec!["calculate"]}}),
            )
        } else if self.id == "calculator" && method == "calculate" {
            params["expression"].as_str().ok_or_else(|| "Informe uma expressão.".to_string()).and_then(|expression| {
                calculate(expression).map(|value| json!({"expression":expression,"value":value,"display":value.to_string()}))
            })
        } else if self.id == "notes" {
            self.notes_request(method, &params)
        } else {
            Err("Operação não disponível neste app.".into())
        };
        match result {
            Ok(result) => json!({"id":id,"method":method,"result":result,"error":null}),
            Err(message) => {
                json!({"id":id,"method":method,"result":null,"error":{"code":"operation_failed","message":message}})
            }
        }
    }

    fn notes_request(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        let mut notebook = self.notebook.clone();
        let mut selected_id = None;
        match method {
            "list" => (),
            "create" => {
                if notebook.notes.len() >= MAX_NOTES {
                    return Err("O limite de 200 notas foi atingido.".into());
                }
                let title = note_text(params, "title", 160)?.unwrap_or_else(|| "Sem título".into());
                let body = note_text(params, "body", 65_536)?.unwrap_or_default();
                let id = notebook.next_id;
                notebook.next_id = notebook
                    .next_id
                    .checked_add(1)
                    .ok_or("O limite de identificadores foi atingido.")?;
                notebook.notes.insert(
                    0,
                    Note {
                        id,
                        title,
                        body,
                        updated_at: timestamp(),
                    },
                );
                selected_id = Some(id);
            }
            "update" => {
                let id = params["id"].as_u64().ok_or("Nota inválida.")?;
                let note = notebook
                    .notes
                    .iter_mut()
                    .find(|note| note.id == id)
                    .ok_or("Esta nota não existe.")?;
                if let Some(title) = note_text(params, "title", 160)? {
                    note.title = title;
                }
                if let Some(body) = note_text(params, "body", 65_536)? {
                    note.body = body;
                }
                note.updated_at = timestamp();
                selected_id = Some(id);
            }
            "delete" => {
                let id = params["id"].as_u64().ok_or("Nota inválida.")?;
                let Some(index) = notebook.notes.iter().position(|note| note.id == id) else {
                    return Err("Esta nota não existe.".into());
                };
                notebook.notes.remove(index);
            }
            _ => return Err("Operação não disponível neste app.".into()),
        }
        if method != "list" {
            let bytes = serde_json::to_vec(&notebook).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_NOTEBOOK_BYTES {
                return Err(
                    "As notas atingiram o limite de 96 KB. Reduza o texto ou remova uma nota."
                        .into(),
                );
            }
            let temporary =
                self.directory
                    .join(format!(".notes-{}-{}.tmp", std::process::id(), timestamp()));
            let result = (|| {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
                drop(file);
                fs::rename(&temporary, self.directory.join("notes.json"))
            })();
            if let Err(error) = result {
                let _ = fs::remove_file(&temporary);
                return Err(format!("Não foi possível salvar a nota: {error}"));
            }
            self.notebook = notebook;
        }
        Ok(json!({"notes":self.notebook.notes,"selected_id":selected_id}))
    }
}

fn note_text(params: &Value, key: &str, max_characters: usize) -> Result<Option<String>, String> {
    let Some(value) = params.get(key) else {
        return Ok(None);
    };
    let text = value
        .as_str()
        .ok_or_else(|| format!("O campo {key} deve ser texto."))?;
    if text.chars().count() > max_characters {
        return Err(format!(
            "O campo {key} excede o limite de {max_characters} caracteres."
        ));
    }
    if text.contains('\0') {
        return Err("O texto contém um caractere inválido.".into());
    }
    if key == "title" && text.trim().is_empty() {
        return Ok(Some("Sem título".into()));
    }
    Ok(Some(text.into()))
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

pub fn calculate(expression: &str) -> Result<f64, String> {
    if expression.len() > 4096 {
        return Err("A expressão é longa demais.".into());
    }
    let mut parser = Parser {
        bytes: expression.as_bytes(),
        position: 0,
        depth: 0,
    };
    let value = parser.expression()?;
    parser.whitespace();
    if parser.position != parser.bytes.len() {
        return Err(format!(
            "Símbolo inesperado na posição {}.",
            parser.position + 1
        ));
    }
    if !value.is_finite() {
        return Err("O resultado excede o intervalo permitido.".into());
    }
    Ok(if value == 0.0 { 0.0 } else { value })
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
    depth: usize,
}
impl Parser<'_> {
    fn whitespace(&mut self) {
        while self
            .bytes
            .get(self.position)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.position += 1;
        }
    }
    fn consume(&mut self, character: u8) -> bool {
        self.whitespace();
        if self.bytes.get(self.position) == Some(&character) {
            self.position += 1;
            true
        } else {
            false
        }
    }
    fn expression(&mut self) -> Result<f64, String> {
        let mut value = self.term()?;
        loop {
            if self.consume(b'+') {
                value += self.term()?;
            } else if self.consume(b'-') {
                value -= self.term()?;
            } else {
                return Ok(value);
            }
        }
    }
    fn term(&mut self) -> Result<f64, String> {
        let mut value = self.factor()?;
        loop {
            if self.consume(b'*') {
                value *= self.factor()?;
            } else if self.consume(b'/') {
                let divisor = self.factor()?;
                if divisor == 0.0 {
                    return Err("Não é possível dividir por zero.".into());
                }
                value /= divisor;
            } else if self.consume(b'%') {
                let divisor = self.factor()?;
                if divisor == 0.0 {
                    return Err("Não é possível dividir por zero.".into());
                }
                value %= divisor;
            } else {
                return Ok(value);
            }
        }
    }
    fn factor(&mut self) -> Result<f64, String> {
        self.depth += 1;
        if self.depth > 64 {
            return Err("A expressão tem parênteses ou sinais demais.".into());
        }
        let result = if self.consume(b'+') {
            self.factor()
        } else if self.consume(b'-') {
            self.factor().map(|value| -value)
        } else if self.consume(b'(') {
            let value = self.expression()?;
            if !self.consume(b')') {
                return Err("Feche o parêntese da expressão.".into());
            }
            Ok(value)
        } else {
            self.number()
        };
        self.depth -= 1;
        result
    }
    fn number(&mut self) -> Result<f64, String> {
        self.whitespace();
        let start = self.position;
        while self
            .bytes
            .get(self.position)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'.' || *byte == b',')
        {
            self.position += 1;
        }
        if self
            .bytes
            .get(self.position)
            .is_some_and(|byte| *byte == b'e' || *byte == b'E')
        {
            self.position += 1;
            if self
                .bytes
                .get(self.position)
                .is_some_and(|byte| *byte == b'+' || *byte == b'-')
            {
                self.position += 1;
            }
            while self
                .bytes
                .get(self.position)
                .is_some_and(u8::is_ascii_digit)
            {
                self.position += 1;
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.position])
            .map_err(|_| "Número inválido.")?
            .replace(',', ".");
        text.parse::<f64>()
            .map_err(|_| format!("Informe um número na posição {}.", start + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn calculator_respects_precedence_parentheses_decimal_and_rejects_invalid_programs() {
        assert_eq!(calculate("2 + 3 * (4 - 1)").unwrap(), 11.0);
        assert_eq!(calculate("-(-2,5) / +0.5").unwrap(), 5.0);
        assert_eq!(calculate("1e3 + 5 % 2").unwrap(), 1001.0);
        for expression in ["1/0", "1.2.3", "2(3)", "let x = 5", "1e9999", "(1+2", ""] {
            assert!(calculate(expression).is_err(), "{expression}");
        }
        assert!(calculate(&format!("{}1{}", "(".repeat(100), ")".repeat(100))).is_err());
    }

    #[test]
    fn native_notes_crud_survives_restart_without_losing_data_on_invalid_updates() {
        let directory = std::env::temp_dir().join(format!(
            "mare-notes-test-{}-{}",
            std::process::id(),
            timestamp()
        ));
        let mut app = NativeApp::new("notes", &directory).unwrap();
        let response = app.handle(
            json!({"id":1,"method":"create","params":{"title":"A","body":"Primeiro texto"}}),
        );
        let id = response["result"]["selected_id"].as_u64().unwrap();
        assert!(response["error"].is_null());
        let invalid = app.handle(json!({"id":2,"method":"update","params":{"id":id,"body":123}}));
        assert!(invalid["error"].is_object());
        drop(app);
        let mut reopened = NativeApp::new("notes", &directory).unwrap();
        let list = reopened.handle(json!({"id":3,"method":"list","params":{}}));
        assert_eq!(list["result"]["notes"][0]["body"], "Primeiro texto");
        let update = reopened.handle(
            json!({"id":4,"method":"update","params":{"id":id,"title":"B","body":"Salvo"}}),
        );
        assert_eq!(update["result"]["notes"][0]["title"], "B");
        let deleted = reopened.handle(json!({"id":5,"method":"delete","params":{"id":id}}));
        assert!(deleted["result"]["notes"].as_array().unwrap().is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn protocol_is_bounded_and_requires_a_complete_utf8_frame() {
        assert_eq!(
            read_protocol_line(&mut Cursor::new(b"{}\r\n")).unwrap(),
            Some("{}".into())
        );
        assert!(read_protocol_line(&mut Cursor::new(b"{\"partial\":")).is_err());
        assert!(read_protocol_line(&mut Cursor::new(vec![b'x'; MAX_MESSAGE_BYTES + 2])).is_err());
        assert!(read_protocol_line(&mut Cursor::new(vec![0xff, b'\n'])).is_err());
    }
}
