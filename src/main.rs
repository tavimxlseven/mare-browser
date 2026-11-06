#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod icon;
mod model;
mod storage;

use model::{normalize_input, BrowserState, Download, Settings, Tab, START_URL};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Window, WindowBuilder},
};
use wry::{
    dpi::{LogicalPosition, LogicalSize as WebSize},
    NewWindowResponse, PageLoadEvent, Rect, WebContext, WebView, WebViewBuilder,
};
#[cfg(windows)]
use wry::{WebViewBuilderExtWindows, WebViewExtWindows};

#[derive(Debug)]
enum BrowserEvent {
    Command(Value),
    Navigation(u64, u64, String),
    Loaded(u64, u64, bool, String),
    Title(u64, u64, String),
    DocumentTitle(u64, u64, String, String),
    Popup(u64, u64, String, bool),
    DownloadStarted(String, PathBuf, bool),
    DownloadFinished(String, Option<PathBuf>, bool),
    Shortcut(u64, u64, String, bool),
}

#[derive(Clone, Copy)]
struct Viewport {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Viewport {
    fn rect(self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: WebSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

struct Browser {
    views: HashMap<u64, WebView>,
    view_generations: HashMap<u64, u64>,
    next_generation: u64,
    maintenance_view: Option<WebView>,
    chrome: WebView,
    window: Window,
    context: WebContext,
    state: BrowserState,
    proxy: EventLoopProxy<BrowserEvent>,
    data_dir: PathBuf,
    viewport: Viewport,
    overlay: bool,
    closed_tabs: Vec<Tab>,
    private_downloads: HashSet<u64>,
    download_urls: HashMap<String, VecDeque<u64>>,
    zoom: f64,
    startup_error: Option<String>,
}

fn embedded_ui() -> String {
    include_str!("../ui/index.html")
        .replace("<link rel=\"stylesheet\" href=\"styles.css\">", &format!("<style>{}</style>", include_str!("../ui/styles.css")))
        .replace("<script src=\"app.js\"></script>", &format!("<script>{}</script>", include_str!("../ui/app.js")))
        .replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'\">")
}

fn data_directory() -> PathBuf {
    if let Some(path) = std::env::var_os("MARE_DATA_DIR") {
        return PathBuf::from(path);
    }
    #[cfg(windows)]
    if Path::new("D:\\").exists() {
        return PathBuf::from("D:\\MareBrowserData");
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("mare-data")))
        .unwrap_or_else(|| PathBuf::from("mare-data"))
}

fn allowed_navigation(url: &str) -> bool {
    url == "about:blank"
        || url::Url::parse(url)
            .is_ok_and(|u| matches!(u.scheme(), "https" | "http") && u.host_str().is_some())
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Não foi possível obter aleatoriedade do sistema.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

static DOWNLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn unique_download_path(directory: &Path, suggested: &Path) -> PathBuf {
    let filename = download_filename(suggested);
    loop {
        let sequence = DOWNLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            "{}-{}-{sequence}-{filename}",
            model::now_ms(),
            std::process::id()
        ));
        if !path.exists() {
            return path;
        }
    }
}

fn download_filename(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|p| p.to_str())
        .unwrap_or("download");
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(180)
        .collect();
    let clean = clean.trim_matches(['.', ' ']);
    if clean.is_empty() {
        "download".into()
    } else {
        clean.into()
    }
}

const PAGE_SHORTCUTS: &str = r#"
(() => {
  if (window.top !== window) return;
  const send = window.ipc.postMessage.bind(window.ipc);
  const nonce = __MARE_NONCE__;
  const publish = (key, shift) => send('{"nonce":"' + nonce + '","key":"' + key + '","shift":' + (shift ? 'true' : 'false') + '}');
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['l','t','w','tab','f','d','h','j','b','n','r','p','+','=','-','0'].includes(key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      publish(key, e.shiftKey);
    } else if (e.key === 'F5') {
      e.preventDefault(); publish('reload', false);
    } else if (e.key === 'F12') {
      e.preventDefault(); publish('devtools', false);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); publish(e.key === 'ArrowLeft' ? 'back' : 'forward', false);
    }
  }, true);
})();
"#;

impl Browser {
    fn current_view(&self, id: u64, generation: u64) -> bool {
        self.view_generations.get(&id) == Some(&generation) && self.views.contains_key(&id)
    }
    fn remove_view(&mut self, id: u64) {
        self.view_generations.remove(&id);
        self.views.remove(&id);
    }
    fn notify(&self, message: &str) {
        let _ = self
            .chrome
            .evaluate_script(&format!("window.mare?.notify?.({});", json!(message)));
    }
    fn publish(&mut self) {
        for tab in &mut self.state.tabs {
            if let Some(view) = self.views.get(&tab.id) {
                tab.can_go_back = view.can_go_back().unwrap_or(false);
                tab.can_go_forward = view.can_go_forward().unwrap_or(false);
            }
        }
        let title = self
            .state
            .active_tab()
            .map(|t| t.title.as_str())
            .unwrap_or("Maré");
        self.window.set_title(&format!("{title} — Maré"));
        if let Ok(snapshot) = serde_json::to_string(&self.state) {
            let _ = self
                .chrome
                .evaluate_script(&format!("window.mare?.receive({snapshot});"));
        }
    }
    fn save(&self) {
        let mut public = self.state.clone();
        public
            .downloads
            .retain(|d| !self.private_downloads.contains(&d.id));
        if let Err(error) = storage::save(&self.data_dir, &public) {
            self.notify(&format!("Não foi possível salvar os dados: {error}"));
        }
    }
    fn create_view(&mut self, id: u64) -> Result<(), String> {
        let tab = self
            .state
            .tabs
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or("Aba inexistente")?;
        if tab.url == START_URL || self.views.contains_key(&id) {
            return Ok(());
        }
        let nav = self.proxy.clone();
        let load = self.proxy.clone();
        let title = self.proxy.clone();
        let popup = self.proxy.clone();
        let start = self.proxy.clone();
        let finish = self.proxy.clone();
        let shortcut = self.proxy.clone();
        let private = tab.private;
        let generation = self.next_generation;
        self.next_generation += 1;
        let nonce = random_nonce()?;
        let shortcuts = PAGE_SHORTCUTS.replace("__MARE_NONCE__", &json!(nonce).to_string());
        let downloads = self.data_dir.join("Downloads");
        std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
        let mut builder = WebViewBuilder::new_with_web_context(&mut self.context)
            .with_bounds(self.viewport.rect())
            .with_visible(false)
            .with_focused(false)
            .with_url(&tab.url)
            .with_incognito(private)
            .with_devtools(true)
            .with_background_color((255, 255, 255, 255))
            .with_initialization_script_for_main_only(shortcuts, true)
            .with_ipc_handler(move |request| {
                // Remote pages cannot reach the privileged chrome command dispatcher.
                if request.body().len() > 1_024 {
                    return;
                }
                if let Ok(value) = serde_json::from_str::<Value>(request.body()) {
                    if value["nonce"].as_str() != Some(nonce.as_str()) {
                        return;
                    }
                    let key = value["key"].as_str().unwrap_or("");
                    if [
                        "l", "t", "w", "tab", "f", "d", "h", "j", "b", "n", "r", "p", "+", "=",
                        "-", "0", "reload", "back", "forward", "devtools",
                    ]
                    .contains(&key)
                    {
                        let _ = shortcut.send_event(BrowserEvent::Shortcut(
                            id,
                            generation,
                            key.into(),
                            value["shift"].as_bool().unwrap_or(false),
                        ));
                    }
                }
            })
            .with_navigation_handler(move |url| {
                let allowed = allowed_navigation(&url);
                if allowed {
                    let _ = nav.send_event(BrowserEvent::Navigation(id, generation, url));
                }
                allowed
            })
            .with_on_page_load_handler(move |event, url| {
                let _ = load.send_event(BrowserEvent::Loaded(
                    id,
                    generation,
                    matches!(event, PageLoadEvent::Finished),
                    url,
                ));
            })
            .with_document_title_changed_handler(move |text| {
                let _ = title.send_event(BrowserEvent::Title(id, generation, text));
            })
            .with_new_window_req_handler(move |url, _| {
                if allowed_navigation(&url) {
                    let _ = popup.send_event(BrowserEvent::Popup(id, generation, url, private));
                }
                NewWindowResponse::Deny
            })
            .with_download_started_handler(move |url, path| {
                *path = unique_download_path(&downloads, path);
                let _ = start.send_event(BrowserEvent::DownloadStarted(url, path.clone(), private));
                true
            })
            .with_download_completed_handler(move |url, path, success| {
                let _ = finish.send_event(BrowserEvent::DownloadFinished(url, path, success));
            });
        #[cfg(windows)]
        {
            builder = builder
                .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
                .with_browser_accelerator_keys(false)
                .with_default_context_menus(true);
        }
        let view = builder
            .build_as_child(&self.window)
            .map_err(|e| e.to_string())?;
        let _ = view.zoom(self.zoom);
        let _ = view.zoom(self.zoom);
        self.view_generations.insert(id, generation);
        self.views.insert(id, view);
        Ok(())
    }
    fn arrange(&mut self) {
        let active = self.state.active_id;
        let remote = self.state.active_tab().is_some_and(|t| t.url != START_URL);
        if remote {
            if let Err(error) = self.create_view(active) {
                self.notify(&format!("Não foi possível abrir a página: {error}"));
            }
        }
        for (&id, view) in &self.views {
            let visible = id == active && remote && !self.overlay;
            if visible {
                let _ = view.set_bounds(self.viewport.rect());
            }
            let _ = view.set_visible(visible);
        }
    }
    fn navigate(&mut self, input: &str) {
        match normalize_input(input, &self.state.settings.search_engine) {
            Ok(url) => {
                let id = self.state.active_id;
                if self.state.navigate(id, url.clone()) {
                    if url == START_URL {
                        self.remove_view(id);
                    } else if let Some(view) = self.views.get(&id) {
                        if let Err(error) = view.load_url(&url) {
                            self.notify(&error.to_string());
                        }
                    }
                }
                self.arrange();
            }
            Err(error) => self.notify(&error),
        }
    }
    fn new_tab(&mut self, input: &str, private: bool) {
        match normalize_input(input, &self.state.settings.search_engine) {
            Ok(url) => {
                self.state.new_tab(url, private);
                self.arrange();
            }
            Err(error) => self.notify(&error),
        }
    }
    fn close_tab(&mut self, id: u64) {
        if let Some(tab) = self.state.tabs.iter().find(|t| t.id == id).cloned() {
            if !tab.private {
                self.closed_tabs.push(tab);
                if self.closed_tabs.len() > 25 {
                    self.closed_tabs.remove(0);
                }
            }
        }
        self.state.close_tab(id);
        self.remove_view(id);
        self.arrange();
    }
    fn clear_browsing_data(&mut self) {
        if self.maintenance_view.is_none() {
            let mut builder = WebViewBuilder::new_with_web_context(&mut self.context)
                .with_url("about:blank")
                .with_visible(false)
                .with_focused(false)
                .with_incognito(false);
            #[cfg(windows)]
            {
                builder =
                    builder.with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI");
            }
            match builder.build_as_child(&self.window) {
                Ok(view) => self.maintenance_view = Some(view),
                Err(error) => {
                    self.notify(&format!("Falha ao acessar os dados de navegação: {error}"));
                    return;
                }
            }
        }
        match self
            .maintenance_view
            .as_ref()
            .unwrap()
            .clear_all_browsing_data()
        {
            Ok(()) => {
                self.state.history.clear();
                self.notify("Limpeza de cookies e dados dos sites iniciada.");
            }
            Err(error) => self.notify(&format!("Falha ao iniciar a limpeza de dados: {error}")),
        }
    }
    fn command(&mut self, value: Value, control_flow: &mut ControlFlow) {
        let cmd = value["cmd"].as_str().unwrap_or("");
        let id = value["id"].as_u64().unwrap_or(self.state.active_id);
        let url = value["url"].as_str().unwrap_or(START_URL);
        match cmd {
            "layout" => {
                self.viewport = Viewport {
                    x: value["x"].as_f64().unwrap_or(0.0).max(0.0),
                    y: value["y"].as_f64().unwrap_or(100.0).max(0.0),
                    width: value["width"]
                        .as_f64()
                        .unwrap_or(1000.0)
                        .clamp(1.0, 20000.0),
                    height: value["height"]
                        .as_f64()
                        .unwrap_or(700.0)
                        .clamp(1.0, 20000.0),
                };
                self.overlay = value["overlay"].as_bool().unwrap_or(false);
                self.arrange();
                return;
            }
            "ready" => {
                self.arrange();
                if let Some(error) = self.startup_error.take() {
                    self.notify(&format!("Perfil anterior preservado: {error}"));
                }
            }
            "navigate" => self.navigate(url),
            "new_tab" => self.new_tab(url, value["private"].as_bool().unwrap_or(false)),
            "activate" => {
                self.state.activate(id);
                self.arrange();
            }
            "close_tab" => self.close_tab(id),
            "reopen_tab" => {
                if let Some(tab) = self.closed_tabs.pop() {
                    self.new_tab(&tab.url, false);
                }
            }
            "duplicate_tab" => {
                if let Some(tab) = self.state.tabs.iter().find(|t| t.id == id).cloned() {
                    self.new_tab(&tab.url, tab.private);
                }
            }
            "close_other_tabs" => {
                let ids: Vec<u64> = self
                    .state
                    .tabs
                    .iter()
                    .filter(|t| t.id != id && !t.pinned)
                    .map(|t| t.id)
                    .collect();
                self.state.activate(id);
                for other in ids {
                    self.close_tab(other);
                }
            }
            "pin_tab" => {
                if let Some(tab) = self.state.tabs.iter_mut().find(|t| t.id == id) {
                    tab.pinned = !tab.pinned;
                }
                self.state.tabs.sort_by_key(|t| !t.pinned);
            }
            "reorder_tabs" => {
                if let Some(ids) = value["ids"].as_array() {
                    self.state.tabs.sort_by_key(|t| {
                        (
                            !t.pinned,
                            ids.iter()
                                .position(|v| v.as_u64() == Some(t.id))
                                .unwrap_or(usize::MAX),
                        )
                    });
                }
            }
            "back" | "forward" | "reload" | "stop" | "print" | "devtools" | "reader" => {
                if let Some(view) = self.views.get(&self.state.active_id) {
                    let result = match cmd {
                        "back" => view.go_back(),
                        "forward" => view.go_forward(),
                        "reload" => view.reload(),
                        "print" => view.print(),
                        "reader" => view.evaluate_script(include_str!("reader.js")),
                        "devtools" => {
                            view.open_devtools();
                            Ok(())
                        }
                        "stop" => {
                            #[cfg(windows)]
                            {
                                unsafe {
                                    let _ = view.webview().Stop();
                                }
                            }
                            #[cfg(not(windows))]
                            {
                                let _ = view.evaluate_script("window.stop()");
                            }
                            if let Some(tab) = self.state.active_tab_mut() {
                                tab.loading = false;
                            }
                            Ok(())
                        }
                        _ => Ok(()),
                    };
                    if let Err(error) = result {
                        self.notify(&error.to_string());
                    }
                }
            }
            "toggle_bookmark" => {
                if let Some(tab) = self.state.active_tab().cloned() {
                    self.state.toggle_bookmark(&tab.url, &tab.title);
                }
            }
            "add_bookmark" => match normalize_input(url, &self.state.settings.search_engine) {
                Ok(url) if url != START_URL => {
                    let title = value["title"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or(&url);
                    if let Some(item) = self.state.bookmarks.iter_mut().find(|b| b.url == url) {
                        item.title = title.into();
                    } else {
                        self.state.toggle_bookmark(&url, title);
                    }
                }
                _ => self.notify("Informe um endereço de site válido."),
            },
            "remove_bookmark" => self.state.bookmarks.retain(|b| b.id != id),
            "add_reading" => {
                if let Some(tab) = self.state.active_tab().cloned() {
                    self.state.add_reading(&tab.url, &tab.title);
                }
            }
            "remove_reading" => self.state.reading_list.retain(|b| b.id != id),
            "mark_read" => {
                if let Some(item) = self.state.reading_list.iter_mut().find(|b| b.id == id) {
                    item.read = !item.read;
                }
            }
            "clear_history" => {
                self.state.history.clear();
                self.notify("Histórico apagado.");
            }
            "clear_data" => {
                self.clear_browsing_data();
            }
            "settings" => {
                let mut merged = serde_json::to_value(&self.state.settings).unwrap_or(json!({}));
                if let (Some(target), Some(incoming)) =
                    (merged.as_object_mut(), value["settings"].as_object())
                {
                    for (key, val) in incoming {
                        target.insert(key.clone(), val.clone());
                    }
                }
                if let Ok(mut settings) = serde_json::from_value::<Settings>(merged) {
                    settings.sanitize();
                    self.state.settings = settings;
                }
            }
            "zoom" => {
                self.zoom = value["factor"].as_f64().unwrap_or(1.0).clamp(0.25, 4.0);
                for view in self.views.values() {
                    let _ = view.zoom(self.zoom);
                }
            }
            "find" => {
                if let Some(view) = self.views.get(&self.state.active_id) {
                    let query = value["query"].as_str().unwrap_or("");
                    let backwards = value["direction"].as_str() == Some("previous");
                    let _ = view.evaluate_script(&format!(
                        "window.find({}, false, {}, true, false, false, false)",
                        json!(query),
                        backwards
                    ));
                }
            }
            "copy_url" => {
                if let Some(tab) = self.state.active_tab() {
                    let _ = self
                        .chrome
                        .evaluate_script(&format!("window.mare?.copy?.({});", json!(tab.url)));
                }
            }
            "open_download" | "reveal_download" => self.open_download(id, cmd == "open_download"),
            "window" => match value["action"].as_str().unwrap_or("") {
                "minimize" => self.window.set_minimized(true),
                "maximize" => self.window.set_maximized(!self.window.is_maximized()),
                "close" => {
                    self.save();
                    *control_flow = ControlFlow::Exit;
                }
                "drag" => {
                    let _ = self.window.drag_window();
                }
                _ => (),
            },
            _ => (),
        }
        self.publish();
        if cmd != "ready" {
            self.save();
        }
    }
    fn open_download(&self, id: u64, open: bool) {
        let Some(item) = self
            .state
            .downloads
            .iter()
            .find(|d| d.id == id && d.status == "completed")
        else {
            return;
        };
        let Ok(path) = Path::new(&item.path).canonicalize() else {
            self.notify("O arquivo não está mais neste local.");
            return;
        };
        let Ok(directory) = self.data_dir.join("Downloads").canonicalize() else {
            return;
        };
        if !path.starts_with(directory) {
            self.notify("O arquivo não pertence à pasta de downloads do Maré.");
            return;
        }
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let safe_document = [
            "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "mp3", "mp4", "wav",
        ]
        .contains(&extension.as_str());
        #[cfg(windows)]
        {
            if open && safe_document {
                let _ = Command::new("explorer.exe").arg(&path).spawn();
            } else {
                let _ = Command::new("explorer.exe")
                    .arg(format!("/select,{}", path.display()))
                    .spawn();
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (open, safe_document);
        }
    }
    fn handle(&mut self, event: BrowserEvent, control_flow: &mut ControlFlow) {
        match event {
            BrowserEvent::Command(value) => {
                self.command(value, control_flow);
                return;
            }
            BrowserEvent::Navigation(id, generation, url) => {
                if !self.current_view(id, generation) {
                    return;
                }
                if let Some(tab) = self.state.tabs.iter_mut().find(|t| t.id == id) {
                    tab.url = url;
                    tab.loading = true;
                }
            }
            BrowserEvent::Loaded(id, generation, finished, url) => {
                if !self.current_view(id, generation) {
                    return;
                }
                if let Some(tab) = self.state.tabs.iter_mut().find(|t| t.id == id) {
                    tab.url = url.clone();
                    tab.loading = !finished;
                }
                if finished {
                    self.state.finish_load(id);
                    if let Some(view) = self.views.get(&id) {
                        let proxy = self.proxy.clone();
                        let _ =
                            view.evaluate_script_with_callback("document.title", move |result| {
                                if let Ok(title) = serde_json::from_str::<String>(&result) {
                                    let _ = proxy.send_event(BrowserEvent::DocumentTitle(
                                        id,
                                        generation,
                                        url.clone(),
                                        title,
                                    ));
                                }
                            });
                    }
                    self.save();
                }
            }
            BrowserEvent::Title(id, generation, title) => {
                if !self.current_view(id, generation) {
                    return;
                }
                self.state.set_title(id, title);
            }
            BrowserEvent::DocumentTitle(id, generation, url, title) => {
                if !self.current_view(id, generation)
                    || !self
                        .state
                        .tabs
                        .iter()
                        .any(|tab| tab.id == id && tab.url == url)
                {
                    return;
                }
                self.state.set_title(id, title);
                self.save();
            }
            BrowserEvent::Popup(id, generation, url, private) => {
                if self.current_view(id, generation) {
                    self.new_tab(&url, private);
                }
            }
            BrowserEvent::DownloadStarted(url, path, private) => {
                let id = self.state.allocate_id();
                if private {
                    self.private_downloads.insert(id);
                }
                self.download_urls.entry(url).or_default().push_back(id);
                self.state.downloads.insert(
                    0,
                    Download {
                        id,
                        filename: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                        path: path.to_string_lossy().into(),
                        status: "downloading".into(),
                    },
                );
                self.notify("Download iniciado.");
            }
            BrowserEvent::DownloadFinished(url, path, success) => {
                let matched_id = path
                    .as_ref()
                    .and_then(|path| {
                        self.state
                            .downloads
                            .iter()
                            .find(|item| {
                                Path::new(&item.path) == path && item.status == "downloading"
                            })
                            .map(|item| item.id)
                    })
                    .or_else(|| {
                        self.download_urls
                            .get(&url)
                            .and_then(|ids| (ids.len() == 1).then(|| ids[0]))
                    });
                if let Some(id) = matched_id {
                    if let Some(ids) = self.download_urls.get_mut(&url) {
                        ids.retain(|other| *other != id);
                        if ids.is_empty() {
                            self.download_urls.remove(&url);
                        }
                    }
                    if let Some(item) = self.state.downloads.iter_mut().find(|d| d.id == id) {
                        item.status = if success { "completed" } else { "failed" }.into();
                        if let Some(path) = path {
                            item.path = path.to_string_lossy().into();
                        }
                    }
                    self.save();
                }
                self.notify(if success {
                    "Download concluído."
                } else {
                    "O download não foi concluído."
                });
            }
            BrowserEvent::Shortcut(id, generation, key, shift) => {
                if id != self.state.active_id || !self.current_view(id, generation) {
                    return;
                }
                if key == "back" || key == "forward" || key == "devtools" {
                    self.command(json!({"cmd":key}), control_flow);
                    return;
                }
                let _ = self.chrome.focus();
                let _ = self.chrome.evaluate_script(&format!(
                    "window.mare?.shortcut?.({}, {});",
                    json!(key),
                    shift
                ));
            }
        }
        self.publish();
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = data_directory();
    std::fs::create_dir_all(&data_dir)?;
    let (state, startup_error) = match storage::load(&data_dir) {
        Ok(state) => (state, None),
        Err(error) => {
            if data_dir.join("state.json").exists() {
                return Err(std::io::Error::other(error).into());
            }
            (BrowserState::new(), Some(error))
        }
    };
    let event_loop = EventLoopBuilder::<BrowserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Maré")
        .with_window_icon(icon::window_icon())
        .with_inner_size(LogicalSize::new(1280.0, 820.0))
        .with_min_inner_size(LogicalSize::new(760.0, 520.0))
        .with_decorations(false)
        .build(&event_loop)?;
    let ui_proxy = proxy.clone();
    let mut ui_context = WebContext::new(Some(data_dir.join("interface")));
    let mut chrome_builder = WebViewBuilder::new_with_web_context(&mut ui_context)
        .with_html(embedded_ui())
        .with_devtools(cfg!(debug_assertions))
        .with_navigation_handler({
            let initial_html = std::cell::Cell::new(true);
            move |url| {
                if matches!(url.as_str(), "about:blank" | "about:blank/" | "") {
                    return true;
                }
                // Wry loads with_html through a local data:text/html document on this runtime.
                // Only that controlled initial document may use a data URL.
                let allow = url.starts_with("data:text/html") && initial_html.replace(false);
                #[cfg(debug_assertions)]
                eprintln!(
                    "Maré interface navigation: scheme={}, bytes={}, initial={allow}",
                    url.split(':').next().unwrap_or("unknown"),
                    url.len()
                );
                allow
            }
        })
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            if request.body().len() <= 256_000 {
                if let Ok(value) = serde_json::from_str::<Value>(request.body()) {
                    let _ = ui_proxy.send_event(BrowserEvent::Command(value));
                }
            }
        });
    #[cfg(windows)]
    {
        chrome_builder = chrome_builder
            .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
            .with_browser_accelerator_keys(false)
            .with_default_context_menus(false);
    }
    let chrome = chrome_builder.build(&window)?;
    let mut browser = Browser {
        views: HashMap::new(),
        view_generations: HashMap::new(),
        next_generation: 1,
        maintenance_view: None,
        chrome,
        window,
        context: WebContext::new(Some(data_dir.join("web-profile"))),
        state,
        proxy,
        data_dir,
        viewport: Viewport {
            x: 0.0,
            y: 100.0,
            width: 1280.0,
            height: 720.0,
        },
        overlay: false,
        closed_tabs: Vec::new(),
        private_downloads: HashSet::new(),
        download_urls: HashMap::new(),
        zoom: 1.0,
        startup_error,
    };
    event_loop.run(move |event, _, control_flow| {
        let _ = &ui_context; // Keep the UI context alive until its webview closes.
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(event) => browser.handle(event, control_flow),
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                browser.save();
                *control_flow = ControlFlow::Exit;
            }
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            }
            | Event::WindowEvent {
                event: WindowEvent::ScaleFactorChanged { .. },
                ..
            } => browser.arrange(),
            _ => (),
        }
    });
}
fn main() {
    if let Err(error) = run() {
        let path = data_directory().join("startup-error.txt");
        let _ = std::fs::write(&path, error.to_string());
        eprintln!("Maré não iniciou: {error}\nDetalhes: {}", path.display());
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_navigation_does_not_execute_local_schemes() {
        assert!(allowed_navigation("https://example.com"));
        assert!(allowed_navigation("http://localhost:8080"));
        for url in [
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
            "ms-settings:privacy",
            "data:text/html,hi",
        ] {
            assert!(!allowed_navigation(url));
        }
    }
    #[test]
    fn downloaded_names_stay_single_safe_components() {
        assert_eq!(download_filename(Path::new("report.pdf")), "report.pdf");
        assert_eq!(download_filename(Path::new("..")), "download");
        assert!(!download_filename(Path::new("bad:name?.txt")).contains(':'));
    }
}
