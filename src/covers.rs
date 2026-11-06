//! Bounded, lazy public cover lookup. Two network jobs maximum, no resident helper process.
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
};
pub struct Covers {
    path: PathBuf,
    map: BTreeMap<String, String>,
    pending: HashSet<String>,
    queue: VecDeque<String>,
    tx: mpsc::Sender<(String, Option<String>)>,
    rx: mpsc::Receiver<(String, Option<String>)>,
    active: usize,
    revision: u64,
}
impl Covers {
    pub fn new(dir: &Path) -> Self {
        let path = dir.join("artwork.json");
        let map = fs::read(&path)
            .ok()
            .filter(|b| b.len() <= 1048576)
            .and_then(|b| serde_json::from_slice::<BTreeMap<String, String>>(&b).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|(uri, url)| {
                crate::spotify::normalize_link(uri).is_ok_and(|(_, _, kind)| kind == "track")
                    && crate::spotify::safe_artwork(url)
            })
            .take(2000)
            .collect();
        let (tx, rx) = mpsc::channel();
        Self {
            path,
            map,
            pending: HashSet::new(),
            queue: VecDeque::new(),
            tx,
            rx,
            active: 0,
            revision: 0,
        }
    }
    pub fn request(&mut self, params: &Value) -> Vec<String> {
        for uri in params["uris"]
            .as_array()
            .into_iter()
            .flatten()
            .take(24)
            .filter_map(Value::as_str)
        {
            if self.queue.len() >= 128 {
                break;
            }
            if crate::spotify::normalize_link(uri).is_ok_and(|(_, _, kind)| kind == "track")
                && !self.map.contains_key(uri)
                && self.pending.insert(uri.into())
            {
                self.queue.push_back(uri.into());
            }
        }
        self.start();
        params["uris"]
            .as_array()
            .into_iter()
            .flatten()
            .take(24)
            .filter_map(Value::as_str)
            .filter(|uri| self.pending.contains(*uri) || self.map.contains_key(*uri))
            .map(str::to_owned)
            .collect()
    }
    fn start(&mut self) {
        while self.active < 2 {
            let Some(uri) = self.queue.pop_front() else {
                break;
            };
            self.active += 1;
            let tx = self.tx.clone();
            std::thread::spawn(move || {
                let artwork = crate::spotify::normalize_link(&uri)
                    .ok()
                    .and_then(|(_, url, _)| crate::spotify::fetch_metadata(&url).ok())
                    .and_then(|v| {
                        v["thumbnail_url"]
                            .as_str()
                            .filter(|url| crate::spotify::safe_artwork(url))
                            .map(str::to_owned)
                    });
                let _ = tx.send((uri, artwork));
            });
        }
    }
    pub fn poll(&mut self) -> &BTreeMap<String, String> {
        let mut changed = false;
        while let Ok((uri, url)) = self.rx.try_recv() {
            self.active = self.active.saturating_sub(1);
            if let Some(url) = url {
                if self.map.len() < 2000 {
                    self.map.insert(uri, url);
                    self.revision = self.revision.saturating_add(1);
                    changed = true;
                }
            }
        }
        self.start();
        if changed {
            if let Ok(bytes) = serde_json::to_vec(&self.map) {
                if bytes.len() <= 1048576 {
                    let tmp = self.path.with_extension("tmp");
                    let _ = fs::write(&tmp, bytes).and_then(|()| fs::rename(tmp, &self.path));
                }
            }
        }
        &self.map
    }
    pub fn snapshot(&self) -> Value {
        serde_json::json!({"artwork":self.map,"artwork_revision":self.revision})
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
}
