use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub const START_URL: &str = "mare://start";
const MAX_HISTORY: usize = 1_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tab {
    pub id: u64,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub favicon: String,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub loading: bool,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub can_go_back: bool,
    #[serde(default)]
    pub can_go_forward: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: u64,
    pub title: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub visited_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReadingItem {
    pub id: u64,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub read: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Download {
    pub id: u64,
    pub filename: String,
    pub path: String,
    pub status: String,
    #[serde(default)]
    pub received: u64,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub resumable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: String,
    pub search_engine: String,
    pub restore_session: bool,
    pub automatic_updates: bool,
    pub home_background: String,
    pub shield_enabled: bool,
    pub shield_exceptions: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            search_engine: "duckduckgo".into(),
            restore_session: true,
            automatic_updates: true,
            home_background: "aurora".into(),
            shield_enabled: true,
            shield_exceptions: Vec::new(),
        }
    }
}

impl Settings {
    pub fn sanitize(&mut self) {
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            self.theme = "system".into();
        }
        if !["duckduckgo", "google", "bing", "brave"].contains(&self.search_engine.as_str()) {
            self.search_engine = "duckduckgo".into();
        }
        if !["aurora", "ocean", "dusk", "minimal"].contains(&self.home_background.as_str()) {
            self.home_background = "aurora".into();
        }
        self.shield_exceptions = self
            .shield_exceptions
            .iter()
            .take(128)
            .filter(|host| !host.contains(['/', '\\', '@', '?', '#']))
            .filter_map(|host| Url::parse(&format!("https://{host}")).ok())
            .filter(|url| url.port().is_none())
            .filter_map(|url| url.host_str().map(str::to_owned))
            .collect();
        self.shield_exceptions.sort();
        self.shield_exceptions.dedup();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrowserState {
    #[serde(default)]
    pub site_icons: std::collections::BTreeMap<String, String>,
    pub tabs: Vec<Tab>,
    pub active_id: u64,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
    #[serde(default)]
    pub reading_list: Vec<ReadingItem>,
    #[serde(default)]
    pub downloads: Vec<Download>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default = "app_version")]
    pub version: String,
    // Persist the high-water mark even when a private tab is omitted from disk.
    #[serde(default = "initial_id")]
    next_id: u64,
}

fn initial_id() -> u64 {
    1
}

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

impl Default for BrowserState {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserState {
    pub fn new() -> Self {
        let mut state = Self {
            site_icons: Default::default(),
            tabs: Vec::new(),
            active_id: 0,
            bookmarks: Vec::new(),
            history: Vec::new(),
            reading_list: Vec::new(),
            downloads: Vec::new(),
            settings: Settings::default(),
            version: app_version(),
            next_id: 1,
        };
        for (title, url) in [
            ("Wikipedia", "https://www.wikipedia.org/"),
            ("GitHub", "https://github.com/"),
            ("Apple", "https://www.apple.com/"),
            ("Rust", "https://www.rust-lang.org/"),
            ("YouTube", "https://www.youtube.com/"),
        ] {
            let id = state.allocate_id();
            state.bookmarks.push(Bookmark {
                id,
                title: title.into(),
                url: url.into(),
            });
        }
        state.new_tab(START_URL.to_owned(), false);
        state
    }

    pub fn trim_downloads(&mut self) {
        let mut terminal = 0;
        self.downloads.retain(|download| {
            if matches!(
                download.status.as_str(),
                "choosing" | "downloading" | "paused" | "pending" | "started"
            ) {
                return true;
            }
            terminal += 1;
            terminal <= 200
        });
    }
    /// Allocate IDs for downloads and other host-created records as well as tabs.
    pub fn allocate_id(&mut self) -> u64 {
        let id = self.next_id.max(1);
        self.next_id = id.checked_add(1).expect("browser ID space exhausted");
        id
    }

    pub fn new_tab(&mut self, url: String, private: bool) -> u64 {
        let url = canonical_page_url(&url).unwrap_or_else(|| START_URL.into());
        let id = self.allocate_id();
        let loading = url != START_URL;
        self.tabs.push(Tab {
            id,
            title: page_title(&url),
            url,
            favicon: String::new(),
            app_id: None,
            loading,
            private,
            pinned: false,
            can_go_back: false,
            can_go_forward: false,
        });
        self.active_id = id;
        id
    }

    pub fn close_tab(&mut self, id: u64) -> bool {
        let Some(index) = self.tabs.iter().position(|tab| tab.id == id) else {
            return false;
        };
        self.tabs.remove(index);
        if self.tabs.is_empty() {
            self.new_tab(START_URL.into(), false);
        } else if self.active_id == id {
            self.active_id = self.tabs[index.min(self.tabs.len() - 1)].id;
        }
        true
    }

    pub fn activate(&mut self, id: u64) -> bool {
        if self.tabs.iter().any(|tab| tab.id == id) {
            self.active_id = id;
            true
        } else {
            false
        }
    }

    pub fn active_tab(&self) -> Option<&Tab> {
        self.tabs.iter().find(|tab| tab.id == self.active_id)
    }

    pub fn active_tab_mut(&mut self) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|tab| tab.id == self.active_id)
    }

    pub fn navigate(&mut self, id: u64, url: String) -> bool {
        let Some(url) = canonical_page_url(&url) else {
            return false;
        };
        let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) else {
            return false;
        };
        tab.title = page_title(&url);
        if Url::parse(&tab.url).ok().map(|u| u.origin())
            != Url::parse(&url).ok().map(|u| u.origin())
        {
            tab.favicon.clear();
        }
        tab.loading = url != START_URL;
        tab.url = url;
        true
    }

    pub fn set_title(&mut self, id: u64, title: String) {
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
            tab.title = if title.trim().is_empty() {
                page_title(&tab.url)
            } else {
                title.trim().chars().take(512).collect()
            };
            if !tab.private {
                if let Some(entry) = self.history.iter_mut().find(|entry| entry.url == tab.url) {
                    entry.title = tab.title.clone();
                }
            }
        }
    }

    pub fn finish_load(&mut self, id: u64) {
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
            tab.loading = false;
        }
        self.record_visit(id);
    }

    /// Returns true when added, false when removed or the URL is unsupported.
    pub fn toggle_bookmark(&mut self, url: &str, title: &str) -> bool {
        let Some(url) = canonical_web_url(url) else {
            return false;
        };
        if let Some(index) = self.bookmarks.iter().position(|item| item.url == url) {
            self.bookmarks.remove(index);
            return false;
        }
        let id = self.allocate_id();
        self.bookmarks.push(Bookmark {
            id,
            title: cleaned_title(title, &url),
            url,
        });
        true
    }

    /// Returns false for an existing item or an unsupported URL.
    pub fn add_reading(&mut self, url: &str, title: &str) -> bool {
        let Some(url) = canonical_web_url(url) else {
            return false;
        };
        if self.reading_list.iter().any(|item| item.url == url) {
            return false;
        }
        let id = self.allocate_id();
        self.reading_list.insert(
            0,
            ReadingItem {
                id,
                title: cleaned_title(title, &url),
                url,
                read: false,
            },
        );
        true
    }

    /// Record only real public page visits, newest first, once per URL.
    pub fn record_visit(&mut self, id: u64) {
        let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) else {
            return;
        };
        if tab.private || canonical_web_url(&tab.url).is_none() {
            return;
        }
        let entry = HistoryEntry {
            url: tab.url.clone(),
            title: tab.title.clone(),
            visited_at: now_ms(),
        };
        self.history.retain(|item| item.url != entry.url);
        self.history.insert(0, entry);
        self.history.truncate(MAX_HISTORY);
    }

    /// Reconcile a persisted session before the host creates native webviews.
    pub(crate) fn prepare_after_load(&mut self) {
        self.repair_id_counter();
        self.tabs
            .retain(|tab| !tab.private && canonical_page_url(&tab.url).is_some());
        self.bookmarks
            .retain(|item| canonical_web_url(&item.url).is_some());
        self.reading_list
            .retain(|item| canonical_web_url(&item.url).is_some());
        self.history
            .retain(|item| canonical_web_url(&item.url).is_some());
        self.history.truncate(MAX_HISTORY);
        for tab in &mut self.tabs {
            tab.loading = false;
            tab.can_go_back = false;
            tab.can_go_forward = false;
        }
        for download in &mut self.downloads {
            if download.status == "concluído" {
                download.status = "completed".into();
            }
            download.resumable = false;
            if download.status == "downloading"
                || download.status == "pending"
                || download.status == "choosing"
                || download.status == "paused"
            {
                download.status = "interrupted".into();
            }
        }
        self.trim_downloads();
        if !self.settings.restore_session {
            self.tabs.clear();
        }
        if self.tabs.is_empty() {
            self.new_tab(START_URL.into(), false);
        } else if self.active_tab().is_none() {
            self.active_id = self.tabs[0].id;
        }
        self.settings.sanitize();
        self.version = app_version();
    }

    fn repair_id_counter(&mut self) {
        let highest = self
            .tabs
            .iter()
            .map(|item| item.id)
            .chain(self.bookmarks.iter().map(|item| item.id))
            .chain(self.reading_list.iter().map(|item| item.id))
            .chain(self.downloads.iter().map(|item| item.id))
            .max()
            .unwrap_or(0);
        self.next_id = self.next_id.max(highest.saturating_add(1)).max(1);
    }

    pub(crate) fn public_session(&self) -> Self {
        let mut public = self.clone();
        public.tabs.retain(|tab| !tab.private);
        if !public.tabs.iter().any(|tab| tab.id == public.active_id) {
            public.active_id = public.tabs.first().map_or(0, |tab| tab.id);
        }
        public
    }
}

fn cleaned_title(title: &str, url: &str) -> String {
    if title.trim().is_empty() {
        page_title(url)
    } else {
        title.trim().chars().take(512).collect()
    }
}

fn page_title(url: &str) -> String {
    if url == START_URL {
        "Página inicial".into()
    } else {
        Url::parse(url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_owned))
            .unwrap_or_else(|| url.to_owned())
    }
}

fn canonical_web_url(input: &str) -> Option<String> {
    let url = Url::parse(input).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then(|| url.to_string())
}

fn canonical_page_url(input: &str) -> Option<String> {
    if input == START_URL || input == "mare://start/" {
        Some(START_URL.into())
    } else {
        canonical_web_url(input)
    }
}

/// Turn an address-bar value into a web URL; executable/local schemes are rejected.
pub fn normalize_input(input: &str, search_engine: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() || input == START_URL || input == "mare://start/" {
        return Ok(START_URL.into());
    }
    if input.len() > 16_384 {
        return Err("O endereço é muito longo.".into());
    }
    let lower = input.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return canonical_web_url(input).ok_or_else(|| "O endereço informado não é válido.".into());
    }

    // Host:port is an address, even though URL parsers interpret `localhost:` as a scheme.
    let authority = input.split(['/', '?', '#']).next().unwrap_or(input);
    let local_host = authority.eq_ignore_ascii_case("localhost")
        || authority.to_ascii_lowercase().starts_with("localhost:");
    let bracketed_ip = authority.starts_with('[');
    let ipv4 = authority
        .split(':')
        .next()
        .unwrap_or("")
        .parse::<std::net::Ipv4Addr>()
        .is_ok();
    let has_port = authority.rsplit_once(':').is_some_and(|(_, port)| {
        !port.is_empty() && port.chars().all(|character| character.is_ascii_digit())
    });
    if let Some((scheme, _)) = input.split_once(':') {
        let valid_scheme = scheme
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
            && scheme.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
            });
        let host_with_port = has_port && (local_host || ipv4 || scheme.contains('.'));
        if valid_scheme && !host_with_port {
            return Err("Use um endereço HTTP ou HTTPS. Esse tipo de link não é permitido.".into());
        }
    }
    let looks_like_domain = authority.contains('.') && !authority.contains('@');
    if !input.chars().any(char::is_whitespace)
        && (local_host || bracketed_ip || ipv4 || looks_like_domain)
    {
        let scheme = if local_host || bracketed_ip || ipv4 {
            "http"
        } else {
            "https"
        };
        return canonical_web_url(&format!("{scheme}://{input}"))
            .ok_or_else(|| "O endereço informado não é válido.".into());
    }
    let endpoint = match search_engine {
        "google" => "https://www.google.com/search",
        "bing" => "https://www.bing.com/search",
        "brave" => "https://search.brave.com/search",
        _ => "https://duckduckgo.com/",
    };
    let mut search =
        Url::parse(endpoint).map_err(|_| "Não foi possível iniciar a pesquisa.".to_string())?;
    search.query_pairs_mut().append_pair("q", input);
    Ok(search.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_local_addresses_and_search() {
        for (input, expected) in [
            (
                " github.com/rust-lang/rust ",
                "https://github.com/rust-lang/rust",
            ),
            ("https://example.com", "https://example.com/"),
            ("localhost:8080/test?q=1", "http://localhost:8080/test?q=1"),
            ("127.0.0.1:3000", "http://127.0.0.1:3000/"),
            ("[::1]:8000/index", "http://[::1]:8000/index"),
            ("example.com:8443", "https://example.com:8443/"),
            ("", START_URL),
        ] {
            assert_eq!(
                normalize_input(input, "duckduckgo").unwrap(),
                expected,
                "{input}"
            );
        }
        let query = "Rust café & memória #2026";
        let url = Url::parse(&normalize_input(query, "google").unwrap()).unwrap();
        assert_eq!(url.host_str(), Some("www.google.com"));
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "q").unwrap().1,
            query
        );
    }

    #[test]
    fn executable_and_local_schemes_never_reach_webviews() {
        for input in [
            "javascript:alert(1)",
            "JaVaScRiPt: alert(1)",
            "data:text/html,test",
            "file:///C:/private",
            "ftp://example.com",
            "about:blank",
            "mare://settings",
            "C:\\secrets.txt",
            "https://",
            "https://example.com:999999",
        ] {
            assert!(normalize_input(input, "duckduckgo").is_err(), "{input}");
        }
    }

    #[test]
    fn private_visits_are_absent_and_last_tab_can_be_closed() {
        let mut state = BrowserState::new();
        let private = state.new_tab("https://private.example/".into(), true);
        state.finish_load(private);
        assert!(state.history.is_empty());
        let normal = state.new_tab("https://example.com/".into(), false);
        state.set_title(normal, "Example".into());
        state.finish_load(normal);
        state.finish_load(normal);
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].title, "Example");
        while state.tabs.len() > 1 {
            state.close_tab(state.tabs[0].id);
        }
        let last = state.tabs[0].id;
        assert!(state.close_tab(last));
        assert_eq!(state.tabs.len(), 1);
        assert_eq!(state.active_tab().unwrap().url, START_URL);
        assert_ne!(state.active_id, last);
    }

    #[test]
    fn allocation_is_global_and_bookmark_urls_are_canonical() {
        let mut state = BrowserState::new();
        let tab = state.new_tab(START_URL.into(), false);
        assert!(state.toggle_bookmark("https://example.com", "Example"));
        let bookmark_id = state.bookmarks.last().unwrap().id;
        assert!(bookmark_id > tab);
        assert!(!state.toggle_bookmark("https://example.com/", "Example"));
        assert!(state.add_reading("https://example.com", "Example"));
        assert!(!state.add_reading("https://example.com/", "Duplicate"));
        assert!(state.reading_list[0].id > bookmark_id);
    }

    #[test]
    fn download_history_is_bounded_without_discarding_active_transfers() {
        let mut state = BrowserState::new();
        for id in 0..250 {
            state.downloads.push(Download {
                id,
                filename: "fixture".into(),
                path: String::new(),
                status: "completed".into(),
                received: 1,
                total: Some(1),
                error: None,
                resumable: false,
            });
        }
        state.downloads.push(Download {
            id: 999,
            filename: "active".into(),
            path: String::new(),
            status: "paused".into(),
            received: 1,
            total: Some(2),
            error: None,
            resumable: true,
        });
        state.trim_downloads();
        assert_eq!(state.downloads.len(), 201);
        assert_eq!(state.downloads.last().unwrap().id, 999);
    }
    #[test]
    fn settings_reject_unimplemented_values() {
        let mut settings = Settings {
            theme: "invalid".into(),
            search_engine: "https://tracking.invalid".into(),
            home_background: "arbitrary-css".into(),
            restore_session: false,
            ..Settings::default()
        };
        settings.sanitize();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.search_engine, "duckduckgo");
        assert_eq!(settings.home_background, "aurora");
        assert!(!settings.restore_session);
    }

    #[test]
    fn legacy_settings_enable_protection_and_normalize_exceptions() {
        let mut settings: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(settings.shield_enabled);
        assert!(settings.shield_exceptions.is_empty());
        settings.shield_exceptions = vec![
            "EXAMPLE.com".into(),
            "example.com".into(),
            "bad/path".into(),
            "user@example.net".into(),
            "example.net:9090".into(),
        ];
        settings.sanitize();
        assert_eq!(settings.shield_exceptions, vec!["example.com"]);
        assert_eq!(settings.theme, "dark");
    }
}
