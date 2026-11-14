//! Independent public music search. Helpers run only for a bounded request.
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc,
};
pub fn video_id(uri: &str) -> Option<&str> {
    uri.strip_prefix("youtube:video:").filter(|id| {
        id.len() == 11
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
pub fn command(directory: &Path) -> Result<Command, String> {
    let executable = crate::components::executable("yt-dlp")
        .ok_or("O componente de busca não acompanha este pacote.")?;
    let runtime = directory.join("runtime/search");
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let mut command = Command::new(executable);
    command
        .args([
            "--ignore-config",
            "--no-warnings",
            "--encoding",
            "utf-8",
            "--socket-timeout",
            "10",
            "--retries",
            "1",
        ])
        .arg("--cache-dir")
        .arg(runtime.join("extractor-cache"))
        .env("TEMP", &runtime)
        .env("TMP", &runtime)
        .env("DENO_DIR", runtime.join("deno"));
    if let Some(deno) = crate::components::executable("deno") {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    }
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08004000);
    Ok(command)
}
pub struct Search {
    directory: PathBuf,
    library: Vec<Value>,
    query: String,
    result: Value,
    job: Option<mpsc::Receiver<(String, Result<Value, String>)>>,
    revision: u64,
}
impl Search {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.into(),
            library: Vec::new(),
            query: String::new(),
            result: json!({"state":"idle","items":[]}),
            job: None,
            revision: 0,
        }
    }
    pub fn request(&mut self, query: &str) -> Result<(), String> {
        let query = query.trim();
        if query.chars().count() > 120 {
            return Err("Pesquise usando até 120 caracteres.".into());
        }
        if query == self.query && self.result["state"] == "ready" && self.result["degraded"] != true
        {
            return Ok(());
        }
        self.query = query.into();
        self.revision += 1;
        self.result = json!({"state":if query.is_empty(){"idle"}else{"loading"},"query":query,"items":[],"provider":"Spotify"});
        if self.job.is_none() && !query.is_empty() {
            if let Err(error) = self.start() {
                self.result = json!({"state":"error","query":self.query,"items":[],"error":error});
            }
        }
        Ok(())
    }
    fn start(&mut self) -> Result<(), String> {
        let query = self.query.clone();
        let directory = self.directory.clone();
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("mare-catalog".into())
            .spawn(move || {
                let result = crate::catalog_search::search_cached(&query, &directory);
                let _ = tx.send((query, result));
            })
            .map_err(|e| e.to_string())?;
        self.job = Some(rx);
        Ok(())
    }
    pub fn snapshot(&mut self) -> Value {
        if let Some(result) = self.job.as_ref().and_then(|job| job.try_recv().ok()) {
            self.job = None;
            if result.0 == self.query {
                self.result=result.1.unwrap_or_else(|_| {
                    let terms: Vec<String> = self.query.split_whitespace().map(str::to_lowercase).collect();
                    let items: Vec<Value> = self.library.iter().filter(|entry| {
                        let text = format!("{} {}", entry["title"].as_str().unwrap_or(""), entry["artists"].as_str().unwrap_or("")).to_lowercase();
                        terms.iter().all(|term| text.contains(term))
                    }).take(25).cloned().collect();
                    if items.is_empty() {
                        json!({"state":"error","query":self.query,"provider":"Spotify","items":[],"error":"O catálogo de músicas está temporariamente indisponível. Aguarde um momento e tente novamente; sua biblioteca continua disponível."})
                    } else {
                        json!({"state":"ready","query":self.query,"provider":"Spotify","via":"library","degraded":true,"items":items,"warning":"O catálogo está temporariamente indisponível. Mostrando músicas da sua biblioteca."})
                    }
                });
                self.revision += 1;
            } else if !self.query.is_empty() {
                if let Err(error) = self.start() {
                    self.result = json!({"state":"error","error":error,"items":[]});
                }
            }
        }
        let mut result = self.result.clone();
        result["revision"] = json!(self.revision);
        result
    }
    pub fn set_library(&mut self, entries: Vec<Value>) {
        self.library = entries;
    }
    pub fn track(&mut self, uri: &str) -> Result<Value, String> {
        self.snapshot()["items"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry["uri"] == uri)
            .cloned()
            .ok_or_else(|| "Pesquise e selecione uma música válida.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_catalog_uses_only_matching_library_tracks() {
        let mut search = Search::new(Path::new("unused-search-test"));
        search.query = "singer song".into();
        search.set_library(vec![json!({"uri":"spotify:track:4uLU6hMCjMI75M1A2tKUQC","title":"Song","artists":"Singer"}), json!({"uri":"spotify:track:0uLU6hMCjMI75M1A2tKUQC","title":"Other","artists":"Singer"})]);
        let (tx, rx) = mpsc::channel();
        tx.send((search.query.clone(), Err("HTTP 500".into())))
            .unwrap();
        search.job = Some(rx);
        let result = search.snapshot();
        assert_eq!(result["via"], "library");
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"][0]["title"], "Song");
        assert_eq!(
            search
                .track("spotify:track:4uLU6hMCjMI75M1A2tKUQC")
                .unwrap()["artists"],
            "Singer"
        );
        // A saved fallback must not make the refresh action an inert same-query request.
        let (_tx, rx) = mpsc::channel();
        search.job = Some(rx);
        search.request("singer song").unwrap();
        assert_eq!(search.snapshot()["state"], "loading");
    }
    #[test]
    fn video_ids_are_fixed_identifiers() {
        assert_eq!(video_id("youtube:video:BaW_jenozKc"), Some("BaW_jenozKc"));
        for input in [
            "youtube:video:../file.exe",
            "youtube:video:ABCDEFGHIJ?",
            "youtube:video:ABCDEFGHIJK&x",
            "https://youtube.com/watch?v=BaW_jenozKc",
            "spotify:track:BaW_jenozKc",
        ] {
            assert_eq!(video_id(input), None);
        }
    }
    #[test]
    fn search_rejects_unbounded_queries_and_unselected_tracks() {
        let mut search = Search::new(Path::new("unused-search-test"));
        assert!(search.request(&"a".repeat(121)).is_err());
        assert_eq!(search.snapshot()["state"], "idle");
        assert!(search.track("youtube:video:BaW_jenozKc").is_err());
        search.request("  ").unwrap();
        assert_eq!(search.snapshot()["state"], "idle");
    }
}
