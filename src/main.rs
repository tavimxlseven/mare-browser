#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod apps;
mod audio;
mod catalog_search;
mod components;
mod composition;
mod covers;
mod downloads;
mod extensions;
mod icon;
mod icon_pixels;
mod model;
mod music;
mod music_remote;
mod music_search;
mod music_session;
mod native_app;
mod permissions;
mod playlist;
mod presence;
mod protection;
mod resource_control;
mod spotify;
mod spotify_account;
mod storage;
mod task_manager;

use model::{normalize_input, BrowserState, Download, Settings, Tab, START_URL};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Command,
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
    MusicRemote(Value),
    Navigation(u64, u64, String),
    Loaded(u64, u64, bool, String),
    Title(u64, u64, String),
    DocumentTitle(u64, u64, String, String),
    Popup(u64, u64, String, bool),
    DownloadChanged(downloads::Update),
    DownloadSelected(u64, Result<Option<PathBuf>, String>),
    Shortcut(u64, u64, String, bool),
    App(apps::AppEvent),
    ProtectionChanged(u64),
    Cosmetics(u64, u64, String, String),
    Resources(Value),
    Favicon(u64, u64, String, String),
    GuardReady(u64, u64, String, bool),
    Media(u64, u64, bool),
    Audio(u64, u64, bool),
    StorageError(String),
    Permission(Value),
    ExtensionPrepared(Result<extensions::Prepared, String>),
    Extensions(Value),
    ExtensionChanged(Result<(), String>),
}

#[derive(Clone, Copy)]
struct Viewport {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Viewport {
    fn fitted(self, old: (f64, f64), new: (f64, f64)) -> Self {
        let right = (old.0 - self.x - self.width).max(0.0);
        let bottom = (old.1 - self.y - self.height).max(0.0);
        let x = self.x.min((new.0 - 1.0).max(0.0));
        let y = self.y.min((new.1 - 1.0).max(0.0));
        Self {
            x,
            y,
            width: (new.0 - x - right).max(1.0),
            height: (new.1 - y - bottom).max(1.0),
        }
    }
    fn rect(self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: WebSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

struct Browser {
    apps: apps::AppManager,
    resources: resource_control::ResourceControl,
    monitor: task_manager::Monitor,
    writer: storage::Writer,
    media_tabs: HashSet<u64>,
    audio_tabs: HashSet<u64>,
    view_bounds: HashMap<u64, [f64; 4]>,
    extension_root: PathBuf,
    pending_extension: Option<extensions::Prepared>,
    extension_busy: bool,
    permissions: permissions::Manager,
    music_remote: music_remote::Manager,
    protection: protection::Protection,
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
    layout_size: (f64, f64),
    chrome_size: (u32, u32),
    overlay: bool,
    chrome_panels: Vec<Value>,
    external_viewport: Option<Viewport>,
    last_external_layout: String,
    external_window: usize,
    guard_scripts: HashMap<u64, String>,
    closed_tabs: Vec<Tab>,
    private_downloads: HashSet<u64>,
    downloads: downloads::Manager,
    download_ids: HashMap<u64, u64>,
    zoom: f64,
    startup_error: Option<String>,
}

fn embedded_ui() -> String {
    include_str!("../ui/index.html")
        .replace("<link rel=\"stylesheet\" href=\"styles.css\">", &format!("<style>{}</style><style>{}</style>", include_str!("../ui/styles.css"), include_str!("../ui/spotify.css")))
        .replace("<script src=\"app.js\"></script>", &format!("<script>{}\n{}\n{}\n{}\n{}</script>", include_str!("../ui/music-queue.js"),include_str!("../ui/music-layout.js"),include_str!("../ui/music-tools.js"),include_str!("../ui/spotify.js"),include_str!("../ui/app.js")))
        .replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https: http:; connect-src 'none'; base-uri 'none'; form-action 'none'\">")
}

fn data_directory() -> PathBuf {
    if let Some(path) = std::env::var_os("MARE_DATA_DIR") {
        return PathBuf::from(path);
    }
    #[cfg(windows)]
    if Path::new("D:\\").exists() {
        return PathBuf::from("D:\\MareBrowserData");
    }
    std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("MareBrowser").join("User Data"))
        .unwrap_or_else(|| PathBuf::from("mare-data"))
}

fn allowed_navigation(url: &str) -> bool {
    url == "about:blank"
        || url::Url::parse(url).is_ok_and(|u| {
            (matches!(u.scheme(), "https" | "http") && u.host_str().is_some())
                || (u.scheme() == "chrome-extension"
                    && u.host_str().is_some_and(extensions::valid_id))
        })
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Não foi possível obter aleatoriedade do sistema.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn allowed_interface_navigation(url: &str) -> bool {
    matches!(
        url,
        "about:blank" | "about:blank/" | "" | "mare-ui://localhost/" | "https://mare-ui.localhost/"
    )
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
  const media = () => send(JSON.stringify({nonce, media_active: Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended && m.readyState >= 2)}));
  for (const event of ['playing','pause','ended','emptied']) document.addEventListener(event, () => setTimeout(media, 0), true);
  addEventListener('DOMContentLoaded', media, {once:true});
  const publish = (key, shift) => send('{"nonce":"' + nonce + '","key":"' + key + '","shift":' + (shift ? 'true' : 'false') + '}');
  addEventListener('pointerdown', e => { if(e.isTrusted) publish('dismiss',false); }, true);
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;
    if(e.key==='Escape'&&e.shiftKey){e.preventDefault();publish('task-manager',false);return;}
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
        self.permissions.close_tab(id);
        self.media_tabs.remove(&id);
        self.audio_tabs.remove(&id);
        self.view_bounds.remove(&id);
        self.resources.remove(id);
        self.guard_scripts.remove(&id);
        self.protection.remove_tab(id);
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
        let mut app_state = self.apps.snapshot();
        if let Some(tab) = self
            .state
            .tabs
            .iter()
            .find(|t| t.app_id.as_deref() == Some("discord"))
        {
            if let Some(catalog) = app_state["catalog"].as_array_mut() {
                if let Some(app) = catalog.iter_mut().find(|a| a["id"] == "discord") {
                    app["running"] = json!(true);
                    app["web_tab_id"] = json!(tab.id);
                }
            }
        }
        let app_title = app_state["catalog"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|app| app["id"] == app_state["active_id"] && app_state["active_id"].is_string())
            .and_then(|app| app["name"].as_str());
        let title = app_title
            .or_else(|| self.state.active_tab().map(|tab| tab.title.as_str()))
            .unwrap_or("Maré");
        self.window.set_title(&format!("{title} — Maré"));
        if let Ok(mut snapshot) = serde_json::to_value(&self.state) {
            snapshot["apps"] = app_state;
            snapshot["music_remote"] = self.music_remote.status();
            let active_url = self
                .state
                .active_tab()
                .map(|tab| tab.url.as_str())
                .unwrap_or(START_URL);
            snapshot["protection"] =
                json!(self.protection.snapshot(self.state.active_id, active_url));
            snapshot["runtime"] = json!({
                "open_tabs": self.state.tabs.len(),
                "loaded_tabs": self.views.len(),
                "visible_tabs": self.views.iter().filter_map(|(id,view)|composition::visible(view).then_some(*id)).collect::<Vec<_>>(),
                "suspended_tabs": self.resources.suspended_count(&self.views),
            });
            #[cfg(debug_assertions)]
            {
                let size = self.window.inner_size();
                let scale = self.window.scale_factor();
                let bounds = |view: &WebView| {
                    view.bounds().ok().map(|r| {
                        let p = r.position.to_physical::<i32>(scale);
                        let s = r.size.to_physical::<u32>(scale);
                        json!([p.x, p.y, s.width, s.height])
                    })
                };
                snapshot["runtime"]["geometry"] = json!({"window":[size.width,size.height],"scale":scale,"chrome":bounds(&self.chrome),"page":self.views.get(&self.state.active_id).and_then(bounds)});
            }
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
        self.writer.queue(public);
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
        let navigation_protection = self.protection.clone();
        let load = self.proxy.clone();
        let title = self.proxy.clone();
        let popup = self.proxy.clone();

        let shortcut = self.proxy.clone();
        let media = self.proxy.clone();
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
            .with_url("about:blank")
            .with_incognito(private)
            .with_devtools(true)
            .with_background_color((255, 255, 255, 255))
            .with_initialization_script_for_main_only(shortcuts, true)
            .with_initialization_script_for_main_only(include_str!("youtube.js").replace("__MARE_YOUTUBE_POLICY__",&json!({"enabled":self.state.settings.shield_enabled,"exceptions":self.state.settings.shield_exceptions}).to_string()),true)
            .with_ipc_handler(move |request| {
                // Remote pages cannot reach the privileged chrome command dispatcher.
                if request.body().len() > 1_024 {
                    return;
                }
                if let Ok(value) = serde_json::from_str::<Value>(request.body()) {
                    if value["nonce"].as_str() != Some(nonce.as_str()) {
                        return;
                    }
                    if let Some(playing) = value["media_active"].as_bool() {
                        let _ = media.send_event(BrowserEvent::Media(id, generation, playing));
                        return;
                    }
                    let key = value["key"].as_str().unwrap_or("");
                    if [
                        "l",
                        "t",
                        "w",
                        "tab",
                        "f",
                        "d",
                        "h",
                        "j",
                        "b",
                        "n",
                        "r",
                        "p",
                        "+",
                        "=",
                        "-",
                        "0",
                        "reload",
                        "back",
                        "forward",
                        "devtools",
                        "dismiss",
                        "task-manager",
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
                if url == "about:blank" {
                    return true;
                }
                let allowed = allowed_navigation(&url);
                if allowed {
                    navigation_protection.begin_navigation(id, &url);
                    let _ = nav.send_event(BrowserEvent::Navigation(id, generation, url));
                }
                allowed
            })
            .with_on_page_load_handler(move |event, url| {
                if url == "about:blank" {
                    return;
                }
                let _ = load.send_event(BrowserEvent::Loaded(
                    id,
                    generation,
                    matches!(event, PageLoadEvent::Finished),
                    url,
                ));
            })
            .with_document_title_changed_handler(move |text| {
                if text.is_empty() || text == "about:blank" {
                    return;
                }
                let _ = title.send_event(BrowserEvent::Title(id, generation, text));
            })
            .with_new_window_req_handler(move |url, _| {
                if allowed_navigation(&url) {
                    let _ = popup.send_event(BrowserEvent::Popup(id, generation, url, private));
                }
                NewWindowResponse::Deny
            });
        #[cfg(windows)]
        {
            builder = builder
                .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
                .with_browser_extensions_enabled(true)
                .with_browser_accelerator_keys(false)
                .with_scroll_bar_style(wry::ScrollBarStyle::FluentOverlay)
                .with_default_context_menus(true);
        }
        let view = builder
            .build_as_child(&self.window)
            .map_err(|e| e.to_string())?;
        {
            use tao::platform::windows::WindowExtWindows;
            let changes = self.proxy.clone();
            let selected = self.proxy.clone();
            self.downloads.attach(
                &view,
                self.window.hwnd() as usize,
                private,
                std::rc::Rc::new(move |update| {
                    let _ = changes.send_event(BrowserEvent::DownloadChanged(update));
                }),
                std::sync::Arc::new(move |token, result| {
                    let _ = selected.send_event(BrowserEvent::DownloadSelected(token, result));
                }),
            )?;
        }
        let _ = view.zoom(self.zoom);
        {
            use webview2_com::{
                take_pwstr, FaviconChangedEventHandler,
                Microsoft::Web::WebView2::Win32::ICoreWebView2_15,
            };
            use windows::core::{Interface, PWSTR};
            use wry::WebViewExtWindows;
            if let Ok(native) = view.webview().cast::<ICoreWebView2_15>() {
                let proxy = self.proxy.clone();
                unsafe {
                    let _ = native.add_FaviconChanged(
                        &FaviconChangedEventHandler::create(Box::new(move |sender, _| {
                            if let Some(sender) = sender {
                                if let Ok(native) = sender.cast::<ICoreWebView2_15>() {
                                    let (mut uri, mut source) = (PWSTR::null(), PWSTR::null());
                                    if native.FaviconUri(&mut uri).is_ok()
                                        && sender.Source(&mut source).is_ok()
                                    {
                                        let _ = proxy.send_event(BrowserEvent::Favicon(
                                            id,
                                            generation,
                                            take_pwstr(source),
                                            take_pwstr(uri),
                                        ));
                                    }
                                }
                            }
                            Ok(())
                        })),
                        &mut 0,
                    );
                }
            }
        }
        let blocked_proxy = self.proxy.clone();
        {
            let proxy = self.proxy.clone();
            self.permissions.attach(&view, id, move |value| {
                let _ = proxy.send_event(BrowserEvent::Permission(value));
            })?;
        }
        {
            use webview2_com::{
                IsDocumentPlayingAudioChangedEventHandler,
                Microsoft::Web::WebView2::Win32::ICoreWebView2_8,
            };
            use windows::core::Interface;
            if let Ok(native) = view.webview().cast::<ICoreWebView2_8>() {
                let proxy = self.proxy.clone();
                unsafe {
                    let _ = native.add_IsDocumentPlayingAudioChanged(
                        &IsDocumentPlayingAudioChangedEventHandler::create(Box::new(
                            move |sender, _| {
                                if let Some(sender) = sender {
                                    if let Ok(native) = sender.cast::<ICoreWebView2_8>() {
                                        let mut playing = windows::core::BOOL::default();
                                        if native.IsDocumentPlayingAudio(&mut playing).is_ok() {
                                            let _ = proxy.send_event(BrowserEvent::Audio(
                                                id,
                                                generation,
                                                playing.as_bool(),
                                            ));
                                        }
                                    }
                                }
                                Ok(())
                            },
                        )),
                        &mut 0,
                    );
                }
            }
        }
        self.protection.attach(&view, id, move |tab_id| {
            let _ = blocked_proxy.send_event(BrowserEvent::ProtectionChanged(tab_id));
        })?;
        self.view_generations.insert(id, generation);
        self.views.insert(id, view);
        self.views
            .get(&id)
            .unwrap()
            .load_url(&tab.url)
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    fn arrange(&mut self) {
        let size = self.window.inner_size();
        if size.width == 0 || size.height == 0 {
            return;
        }
        if self.chrome_size != (size.width, size.height) {
            // Child WebView destruction can detach Wry's parent resize subclass.
            // Always size the chrome container/controller ourselves, using physical pixels.
            let bounds = Rect {
                position: wry::dpi::PhysicalPosition::new(0, 0).into(),
                size: wry::dpi::PhysicalSize::new(size.width, size.height).into(),
            };
            if self.chrome.set_bounds(bounds).is_ok() {
                self.chrome_size = (size.width, size.height);
            }
        }
        let logical = size.to_logical::<f64>(self.window.scale_factor());
        let viewport = self
            .viewport
            .fitted(self.layout_size, (logical.width, logical.height));
        let active = self.state.active_id;
        let app_state = self.apps.snapshot();
        let app_active = app_state["active_id"].as_str().is_some();
        let remote = self.state.active_tab().is_some_and(|t| t.url != START_URL);
        if remote {
            if let Err(error) = self.create_view(active) {
                self.notify(&format!("Não foi possível abrir a página: {error}"));
            }
        }
        for (&id, view) in &self.views {
            // An app tab covers the web surface; keep the selected document visible
            // to WebView2 so media does not receive a hidden-page pause transition.
            let selected = id == active && remote;
            let playing = self.media_tabs.contains(&id) || self.audio_tabs.contains(&id);
            let realtime = self
                .state
                .tabs
                .iter()
                .any(|tab| tab.id == id && tab.app_id.as_deref() == Some("discord"));
            let visible = selected || playing || realtime;
            let bounds = [viewport.x, viewport.y, viewport.width, viewport.height];
            if selected && self.view_bounds.get(&id) != Some(&bounds) {
                let _ = view.set_bounds(viewport.rect());
                self.view_bounds.insert(id, bounds);
            }
            if composition::visible(view) != visible {
                let _ = view.set_visible(visible);
            }
            if visible && (!selected || app_active) {
                composition::cover(view);
            }
            self.resources
                .set_background(id, view, !selected && !playing && !realtime);
        }
        if remote && !app_active {
            if let Some(view) = self.views.get(&active) {
                composition::raise_content(view);
            }
        }
        let external_active = app_state["active_id"] == "discord";
        let external_open = app_state["open_ids"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == "discord"));
        #[cfg(windows)]
        if external_open {
            use tao::platform::windows::WindowExtWindows;
            let v = self
                .external_viewport
                .unwrap_or(self.viewport)
                .fitted(self.layout_size, (logical.width, logical.height));
            let s = self.window.scale_factor();
            let params = json!({"parent":self.window.hwnd() as usize,"rect":[(v.x*s) as i32,(v.y*s) as i32,(v.width*s) as i32,(v.height*s) as i32],"visible":external_active});
            let key = params.to_string();
            if key != self.last_external_layout {
                self.last_external_layout = key;
                let _ = self.apps.request("discord", "host_layout", params);
            }
        } else {
            self.last_external_layout.clear();
        }
        let cutout = if external_active {
            self.external_viewport
                .unwrap_or(self.viewport)
                .fitted(self.layout_size, (logical.width, logical.height))
        } else {
            viewport
        };
        let size = self.window.inner_size();
        #[cfg(windows)]
        if external_active {
            use tao::platform::windows::WindowExtWindows;
            composition::raise_external(self.window.hwnd() as usize, self.external_window);
        }
        composition::arrange(
            &self.chrome,
            [cutout.x, cutout.y, cutout.width, cutout.height],
            &self.chrome_panels,
            (!external_active && (!remote || app_active))
                || self.overlay
                || (external_active && self.external_window == 0),
            self.window.scale_factor(),
            (size.width, size.height),
        );
    }
    fn navigate(&mut self, input: &str) {
        match normalize_input(input, &self.state.settings.search_engine) {
            Ok(url) => {
                let id = self.state.active_id;
                self.permissions.close_tab(id);
                if let Some(tab) = self.state.tabs.iter_mut().find(|t| t.id == id) {
                    tab.app_id = None;
                }
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
    fn ensure_maintenance_view(&mut self) -> Result<(), String> {
        if self.maintenance_view.is_none() {
            let view = WebViewBuilder::new_with_web_context(&mut self.context)
                .with_url("about:blank")
                .with_visible(false)
                .with_focused(false)
                .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
                .with_browser_extensions_enabled(true)
                .with_scroll_bar_style(wry::ScrollBarStyle::FluentOverlay)
                .build_as_child(&self.window)
                .map_err(|e| e.to_string())?;
            self.maintenance_view = Some(view);
        }
        Ok(())
    }
    fn list_extensions(&mut self) {
        if let Err(error) = self.ensure_maintenance_view() {
            self.notify(&error);
            return;
        }
        let proxy = self.proxy.clone();
        if let Err(error) = extensions::list(
            self.maintenance_view.as_ref().unwrap(),
            self.extension_root.clone(),
            move |value| {
                let _ = proxy.send_event(BrowserEvent::Extensions(value));
            },
        ) {
            self.notify(&error);
        }
    }
    fn maintain_background_tabs(&mut self) {
        for (&id, view) in &self.views {
            self.resources.set_background(
                id,
                view,
                id != self.state.active_id
                    && !self.media_tabs.contains(&id)
                    && !self.audio_tabs.contains(&id)
                    && !self
                        .state
                        .tabs
                        .iter()
                        .any(|tab| tab.id == id && tab.app_id.as_deref() == Some("discord")),
            );
        }
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
                builder = builder
                    .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
                    .with_browser_extensions_enabled(true)
                    .with_scroll_bar_style(wry::ScrollBarStyle::FluentOverlay);
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
        if [
            "navigate",
            "new_tab",
            "activate",
            "reopen_tab",
            "duplicate_tab",
        ]
        .contains(&cmd)
        {
            self.apps.deactivate();
        }
        match cmd {
            "permission_answer" => {
                self.permissions.answer(
                    value["id"].as_u64().unwrap_or(0),
                    value["allow"].as_bool().unwrap_or(false),
                    value["remember"].as_bool().unwrap_or(false),
                );
                return;
            }
            "extensions_list" => {
                self.list_extensions();
                return;
            }
            "extensions_prepare" => {
                if self.extension_busy || self.pending_extension.is_some() {
                    self.notify("Conclua ou cancele a instalação atual.");
                    return;
                }
                match extensions::store_id(value["url"].as_str().unwrap_or("")) {
                    Ok(id) => {
                        if self.extension_root.join(&id).exists() {
                            self.notify("Esta extensão já foi preparada. Remova a instalação anterior antes de instalar novamente.");
                            return;
                        }
                        self.extension_busy = true;
                        let root = self.extension_root.clone();
                        let proxy = self.proxy.clone();
                        std::thread::spawn(move || {
                            let result = extensions::prepare(&root, &id);
                            let _ = proxy.send_event(BrowserEvent::ExtensionPrepared(result));
                        });
                        let _ = self.chrome.evaluate_script(
                            "window.mare?.extensionsEvent({state:'downloading'});",
                        );
                    }
                    Err(error) => self.notify(&error),
                }
                return;
            }
            "extensions_cancel" => {
                if let Some(prepared) = self.pending_extension.take() {
                    std::thread::spawn(move || {
                        let _ = std::fs::remove_dir_all(prepared.folder);
                    });
                }
                self.list_extensions();
                return;
            }
            "extensions_install" => {
                if let Some(prepared) = self.pending_extension.take() {
                    if let Err(error) = self.ensure_maintenance_view() {
                        self.notify(&error);
                        return;
                    }
                    let target = self.extension_root.join(&prepared.id);
                    if let Err(error) = std::fs::rename(&prepared.folder, &target) {
                        self.notify(&error.to_string());
                        return;
                    }
                    let proxy = self.proxy.clone();
                    let rollback = prepared.folder.clone();
                    let failed = target.clone();
                    if let Err(error) = extensions::install(
                        self.maintenance_view.as_ref().unwrap(),
                        &target,
                        move |result| {
                            if result.is_err() {
                                let _ = std::fs::rename(&failed, &rollback);
                            }
                            let _ = proxy.send_event(BrowserEvent::ExtensionChanged(result));
                        },
                    ) {
                        let _ = std::fs::rename(&target, &prepared.folder);
                        self.notify(&error);
                        let _ = self.chrome.evaluate_script(&format!(
                            "window.mare?.extensionsEvent({});",
                            json!({"state":"error","error":error})
                        ));
                    }
                }
                return;
            }
            "extensions_enable" | "extensions_remove" => {
                let id = value["id"].as_str().unwrap_or("").to_string();
                if !extensions::valid_id(&id)
                    || !self
                        .extension_root
                        .join(&id)
                        .join("manifest.json")
                        .is_file()
                {
                    return;
                }
                if let Err(error) = self.ensure_maintenance_view() {
                    self.notify(&error);
                    return;
                }
                let enabled = if cmd == "extensions_enable" {
                    Some(value["enabled"].as_bool().unwrap_or(true))
                } else {
                    None
                };
                let proxy = self.proxy.clone();
                let root = self.extension_root.clone();
                let remove = id.clone();
                if let Err(error) = extensions::change(
                    self.maintenance_view.as_ref().unwrap(),
                    id,
                    enabled,
                    move |result| {
                        if result.is_ok() && enabled.is_none() {
                            let folder = root.join(remove);
                            std::thread::spawn(move || {
                                let _ = std::fs::remove_dir_all(folder);
                            });
                        }
                        let _ = proxy.send_event(BrowserEvent::ExtensionChanged(result));
                    },
                ) {
                    self.notify(&error);
                }
                return;
            }
            "extension_open" => {
                let id = value["id"].as_str().unwrap_or("");
                if extensions::valid_id(id) {
                    let manifest =
                        std::fs::read(self.extension_root.join(id).join("manifest.json"))
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                            .unwrap_or_default();
                    if let Some(path) = extensions::popup(&manifest) {
                        self.apps.deactivate();
                        self.state
                            .new_tab(format!("chrome-extension://{id}/{path}"), false);
                        self.arrange();
                        self.publish();
                    }
                }
                return;
            }
            "resources_poll" => {
                let mut seeds = vec![task_manager::Seed {
                    pid: std::process::id(),
                    group: "Maré Browser".into(),
                    label: "Maré Browser · principal".into(),
                }];
                let apps = self.apps.snapshot();
                for app in apps["running"].as_array().into_iter().flatten() {
                    if let Some(pid) = app["pid"].as_u64() {
                        let name = match app["id"].as_str().unwrap_or("") {
                            "spotify" => "Spotify",
                            "discord" => "Discord · larperCord",
                            "notes" => "Notas",
                            "calculator" => "Calculadora",
                            _ => "App",
                        };
                        seeds.push(task_manager::Seed {
                            pid: pid as u32,
                            group: name.into(),
                            label: format!("{name} · worker"),
                        });
                    }
                }
                seeds.extend(task_manager::engine_seeds(
                    std::iter::once(&self.chrome)
                        .chain(self.views.values())
                        .chain(self.maintenance_view.iter()),
                ));
                let proxy = self.proxy.clone();
                self.monitor.request(seeds, move |result| {
                    let _ = proxy.send_event(BrowserEvent::Resources(result));
                });
                return;
            }
            "engine_task_manager" => {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_6;
                use windows::core::Interface;
                let view = self
                    .views
                    .get(&self.state.active_id)
                    .unwrap_or(&self.chrome);
                if let Ok(native) = view.webview().cast::<ICoreWebView2_6>() {
                    unsafe {
                        let _ = native.OpenTaskManagerWindow();
                    }
                }
                return;
            }
            #[cfg(debug_assertions)]
            "qa_resize" => {
                let width = value["width"]
                    .as_f64()
                    .unwrap_or(1280.0)
                    .clamp(760.0, 2200.0);
                let height = value["height"]
                    .as_f64()
                    .unwrap_or(820.0)
                    .clamp(520.0, 1400.0);
                self.window.set_inner_size(LogicalSize::new(width, height));
                self.arrange();
                self.publish();
                return;
            }
            "shield_toggle" => {
                self.state.settings.shield_enabled = value["enabled"]
                    .as_bool()
                    .unwrap_or(!self.state.settings.shield_enabled);
                self.refresh_protection(true);
            }
            "shield_site_toggle" => {
                if let Some(host) = self
                    .state
                    .active_tab()
                    .and_then(|tab| protection::host_for_url(&tab.url))
                {
                    let enabled = value["enabled"]
                        .as_bool()
                        .unwrap_or(self.state.settings.shield_exceptions.contains(&host));
                    self.state
                        .settings
                        .shield_exceptions
                        .retain(|item| item != &host);
                    if !enabled {
                        self.state.settings.shield_exceptions.push(host);
                    }
                    self.refresh_protection(true);
                }
            }
            "apps_install" | "apps_uninstall" | "apps_open" => {
                let app_id = value["id"].as_str().unwrap_or("");
                if app_id == "spotify" && cmd == "apps_uninstall" {
                    self.music_remote.stop();
                }
                if app_id == "discord" && cmd == "apps_open" {
                    if let Err(error) = self.apps.install("discord") {
                        self.notify(&error);
                        return;
                    }
                    self.apps.deactivate();
                    if let Some(id) = self
                        .state
                        .tabs
                        .iter()
                        .find(|t| t.app_id.as_deref() == Some("discord"))
                        .map(|t| t.id)
                    {
                        self.state.activate(id);
                    } else {
                        let id = self.state.new_tab("https://discord.com/app".into(), false);
                        if let Some(tab) = self.state.tabs.iter_mut().find(|t| t.id == id) {
                            tab.app_id = Some("discord".into());
                            tab.title = "Discord".into();
                        }
                    }
                    self.arrange();
                    self.publish();
                    self.save();
                    return;
                }
                if app_id == "discord" && cmd == "apps_uninstall" {
                    let ids: Vec<_> = self
                        .state
                        .tabs
                        .iter()
                        .filter(|t| t.app_id.as_deref() == Some("discord"))
                        .map(|t| t.id)
                        .collect();
                    for id in ids {
                        self.close_tab(id);
                    }
                }
                let result = match cmd {
                    "apps_install" => self.apps.install(app_id),
                    "apps_uninstall" => self.apps.uninstall(app_id),
                    _ => self.apps.start(app_id),
                };
                if let Err(error) = result {
                    self.notify(&error);
                }
                self.arrange();
            }
            "music_remote" => {
                if value["enabled"] == true {
                    let open = self.apps.snapshot()["open_ids"]
                        .as_array()
                        .is_some_and(|ids| ids.iter().any(|id| id == "spotify"));
                    if open {
                        let proxy = self.proxy.clone();
                        match self.music_remote.start(move |value| {
                            let _ = proxy.send_event(BrowserEvent::MusicRemote(value));
                        }) {
                            Ok(()) => {
                                let _ = self.apps.request_with_id("spotify", 0, "list", json!({}));
                            }
                            Err(error) => self.notify(&error),
                        }
                    } else {
                        self.notify("Abra o app de música antes de ativar o controle.");
                    }
                } else {
                    self.music_remote.stop();
                }
            }
            "apps_close" => {
                let active = self.apps.snapshot()["active_id"]
                    .as_str()
                    .map(str::to_owned);
                if let Some(app_id) = value["id"].as_str().map(str::to_owned).or(active) {
                    if app_id == "spotify" {
                        self.music_remote.stop();
                    }
                    self.apps.close(&app_id);
                }
                self.arrange();
            }
            "apps_background" => {
                self.apps.deactivate();
                self.arrange();
            }
            "apps_request" => {
                let result = self.apps.request_with_id(
                    value["id"].as_str().unwrap_or(""),
                    value["request_id"].as_u64().unwrap_or(0),
                    value["method"].as_str().unwrap_or(""),
                    value["params"].clone(),
                );
                if let Err(error) = result {
                    let _ = self.chrome.evaluate_script(&format!(
                        "window.mare?.appsRequestFailed({},{});",
                        value["request_id"].as_u64().unwrap_or(0),
                        json!(error)
                    ));
                }
                return;
            }
            "layout" => {
                self.layout_size = (
                    value["window_width"]
                        .as_f64()
                        .unwrap_or(self.layout_size.0)
                        .clamp(1.0, 20000.0),
                    value["window_height"]
                        .as_f64()
                        .unwrap_or(self.layout_size.1)
                        .clamp(1.0, 20000.0),
                );
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
                self.chrome_panels = value["panels"].as_array().cloned().unwrap_or_default();
                self.external_viewport = value["app_bounds"]
                    .as_array()
                    .filter(|r| r.len() == 4)
                    .map(|r| Viewport {
                        x: r[0].as_f64().unwrap_or(0.0),
                        y: r[1].as_f64().unwrap_or(166.0),
                        width: r[2].as_f64().unwrap_or(1280.0).clamp(1.0, 20000.0),
                        height: r[3].as_f64().unwrap_or(500.0).clamp(1.0, 20000.0),
                    });
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
                let protection_before = (
                    self.state.settings.shield_enabled,
                    self.state.settings.shield_exceptions.clone(),
                );
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
                if protection_before
                    != (
                        self.state.settings.shield_enabled,
                        self.state.settings.shield_exceptions.clone(),
                    )
                {
                    self.refresh_protection(true);
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
            "spotify_open" => {
                if let Ok((uri, _, _)) =
                    spotify::normalize_link(value["url"].as_str().unwrap_or(""))
                {
                    #[cfg(windows)]
                    unsafe {
                        use windows::{
                            core::{w, HSTRING, PCWSTR},
                            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
                        };
                        let target = HSTRING::from(uri);
                        let result = ShellExecuteW(
                            None,
                            w!("open"),
                            &target,
                            PCWSTR::null(),
                            PCWSTR::null(),
                            SW_SHOWNORMAL,
                        );
                        if result.0 as isize <= 32 {
                            self.notify("Não foi possível abrir o Spotify instalado.");
                        }
                    }
                } else {
                    self.notify("Link do Spotify inválido.");
                }
            }
            "cancel_download" | "resume_download" => {
                if let Some((&token, _)) = self.download_ids.iter().find(|(_, value)| **value == id)
                {
                    if let Err(e) = self.downloads.command(token, cmd == "resume_download") {
                        self.notify(&e);
                    }
                }
            }
            "open_download" | "reveal_download" => self.open_download(id, cmd == "open_download"),
            "window" => match value["action"].as_str().unwrap_or("") {
                "minimize" => self.window.set_minimized(true),
                "maximize" => self.window.set_maximized(!self.window.is_maximized()),
                "close" => {
                    self.apps.shutdown();
                    self.save();
                    self.writer.flush();
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
    fn refresh_protection(&mut self, reload: bool) {
        self.state.settings.sanitize();
        self.protection.configure(
            self.state.settings.shield_enabled,
            &self.state.settings.shield_exceptions,
        );
        for tab in &self.state.tabs {
            if let Some(view) = self.views.get(&tab.id) {
                let script = self.protection.cosmetics_script(tab.id, &tab.url, &[], &[]);
                let _ = view.evaluate_script(&script);
                use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
                use windows::core::HSTRING;
                use wry::WebViewExtWindows;
                let config = format!(
                    "window.__mareYoutubeShield?.configure({});",
                    json!({"enabled":self.state.settings.shield_enabled,"exceptions":self.state.settings.shield_exceptions})
                );
                let _ = view.evaluate_script(&config);
                let proxy = self.proxy.clone();
                let id = tab.id;
                let generation = self.view_generations[&id];
                unsafe {
                    let _ = view.webview().AddScriptToExecuteOnDocumentCreated(
                        &HSTRING::from(config),
                        &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                            move |result, token| {
                                if result.is_ok() {
                                    let _ = proxy.send_event(BrowserEvent::GuardReady(
                                        id, generation, token, reload,
                                    ));
                                }
                                Ok(())
                            },
                        )),
                    );
                }
            }
        }
    }
    fn handle(&mut self, event: BrowserEvent, control_flow: &mut ControlFlow) {
        if let BrowserEvent::StorageError(error) = &event {
            self.notify(&format!("Falha ao salvar o perfil: {error}"));
            return;
        }
        match event {
            BrowserEvent::Permission(value) => {
                if !value["id"]
                    .as_u64()
                    .is_some_and(|id| self.permissions.contains(id))
                {
                    return;
                }
                let _ = self
                    .chrome
                    .evaluate_script(&format!("window.mare?.permissionRequest({value});"));
                return;
            }
            BrowserEvent::ExtensionPrepared(result) => {
                self.extension_busy = false;
                match result {
                    Ok(prepared) => {
                        let _ = self.chrome.evaluate_script(&format!(
                            "window.mare?.extensionsEvent({});",
                            json!({"state":"review","prepared":prepared.summary})
                        ));
                        self.pending_extension = Some(prepared);
                    }
                    Err(error) => {
                        self.notify(&error);
                        let _ = self.chrome.evaluate_script(&format!(
                            "window.mare?.extensionsEvent({});",
                            json!({"state":"error","error":error})
                        ));
                    }
                }
                return;
            }
            BrowserEvent::Extensions(value) => {
                let _ = self
                    .chrome
                    .evaluate_script(&format!("window.mare?.extensionsEvent({value});"));
                return;
            }
            BrowserEvent::ExtensionChanged(result) => {
                if let Err(error) = result {
                    self.notify(&error);
                    let _ = self.chrome.evaluate_script(&format!(
                        "window.mare?.extensionsEvent({});",
                        json!({"state":"error","error":error})
                    ));
                } else {
                    self.notify("Extensões atualizadas. Recarregue as páginas abertas para aplicar as mudanças.");
                }
                self.list_extensions();
                return;
            }
            BrowserEvent::StorageError(_) => unreachable!(),
            BrowserEvent::Media(id, generation, playing) => {
                if self.current_view(id, generation) {
                    let changed = if playing {
                        self.media_tabs.insert(id)
                    } else {
                        self.media_tabs.remove(&id)
                    };
                    if changed {
                        self.arrange();
                    }
                }
                return;
            }
            BrowserEvent::Audio(id, generation, playing) => {
                if self.current_view(id, generation) {
                    let changed = if playing {
                        self.audio_tabs.insert(id)
                    } else {
                        self.audio_tabs.remove(&id)
                    };
                    if changed {
                        self.arrange();
                    }
                }
                return;
            }
            BrowserEvent::Favicon(id, generation, url, icon) => {
                if !self.current_view(id, generation)
                    || icon.len() > 2048
                    || !url::Url::parse(&icon).is_ok_and(|u| {
                        matches!(u.scheme(), "http" | "https")
                            && u.username().is_empty()
                            && u.password().is_none()
                    })
                {
                    return;
                }
                if let Some(tab) = self
                    .state
                    .tabs
                    .iter_mut()
                    .find(|t| t.id == id && t.url == url)
                {
                    tab.favicon = icon.clone();
                    if !tab.private {
                        if let Ok(url) = url::Url::parse(&url) {
                            self.state
                                .site_icons
                                .insert(url.origin().ascii_serialization(), icon);
                            while self.state.site_icons.len() > 128 {
                                self.state.site_icons.pop_first();
                            }
                        }
                    }
                }
            }
            BrowserEvent::GuardReady(id, generation, token, reload) => {
                if !self.current_view(id, generation) {
                    return;
                }
                if let Some(old) = self.guard_scripts.insert(id, token) {
                    use wry::WebViewExtWindows;
                    unsafe {
                        let _ = self.views[&id]
                            .webview()
                            .RemoveScriptToExecuteOnDocumentCreated(&windows::core::HSTRING::from(
                                old,
                            ));
                    }
                }
                if reload && id == self.state.active_id {
                    let _ = self.views[&id].reload();
                }
                return;
            }
            BrowserEvent::Resources(result) => {
                let _ = self
                    .chrome
                    .evaluate_script(&format!("window.mare?.resources?.({});", result));
                return;
            }
            BrowserEvent::ProtectionChanged(id) => {
                if id != self.state.active_id {
                    return;
                }
            }
            BrowserEvent::Cosmetics(id, generation, url, result) => {
                if !self.current_view(id, generation)
                    || !self
                        .state
                        .tabs
                        .iter()
                        .any(|tab| tab.id == id && tab.url == url)
                {
                    return;
                }
                if let Ok(data) = serde_json::from_str::<Value>(&result) {
                    let strings = |key: &str| -> Vec<String> {
                        data[key]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .take(4000)
                            .map(str::to_owned)
                            .collect()
                    };
                    let script = self.protection.cosmetics_script(
                        id,
                        &url,
                        &strings("classes"),
                        &strings("ids"),
                    );
                    if let Some(view) = self.views.get(&id) {
                        let _ = view.evaluate_script(&script);
                    }
                }
                return;
            }
            BrowserEvent::MusicRemote(value) => {
                if !self.apps.snapshot()["open_ids"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id == "spotify"))
                {
                    self.music_remote.stop();
                    self.publish();
                    return;
                }
                if !self.music_remote.enabled() {
                    return;
                }
                if value["action"] == "refresh" {
                    let _ = self.apps.request_with_id(
                        "spotify",
                        0,
                        "playback_status",
                        json!({"revision":self.music_remote.revision()}),
                    );
                } else {
                    let _ = self
                        .chrome
                        .evaluate_script(&format!("window.mare?.remoteMusic({value});"));
                }
                return;
            }
            BrowserEvent::App(event) => {
                if !self.apps.handle_event(&event) {
                    return;
                }
                if event.app_id == "spotify" {
                    if event.kind == "exited" {
                        self.music_remote.stop();
                    } else {
                        self.music_remote.update(&event.payload["result"]);
                    }
                }
                if event.app_id == "discord" {
                    if event.kind == "exited" {
                        self.external_window = 0;
                        self.last_external_layout.clear();
                    } else if event.payload["result"]["attached"] == true {
                        self.external_window =
                            event.payload["result"]["window"].as_u64().unwrap_or(0) as usize;
                    }
                }
                let _ = self
                    .chrome
                    .evaluate_script(&format!("window.mare?.appsEvent?.({});", json!(event)));
                // Player ticks do not change browser tabs or window geometry.
                if event.app_id == "spotify" && event.payload["method"] == "playback_status" {
                    return;
                }
                self.arrange();
            }
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
                        let cosmetic_proxy = self.proxy.clone();
                        let cosmetic_url = url.clone();
                        let _ = view.evaluate_script_with_callback(
                            protection::COSMETIC_CANDIDATES_SCRIPT,
                            move |result| {
                                let _ = cosmetic_proxy.send_event(BrowserEvent::Cosmetics(
                                    id,
                                    generation,
                                    cosmetic_url.clone(),
                                    result,
                                ));
                            },
                        );
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
                    self.arrange();
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
            BrowserEvent::DownloadChanged(update) => {
                let id = if let Some(id) = self.download_ids.get(&update.token) {
                    *id
                } else {
                    let id = self.state.allocate_id();
                    self.download_ids.insert(update.token, id);
                    if update.private {
                        self.private_downloads.insert(id);
                    }
                    self.state.downloads.insert(
                        0,
                        Download {
                            id,
                            filename: update.filename.clone(),
                            path: String::new(),
                            status: "choosing".into(),
                            received: 0,
                            total: None,
                            error: None,
                            resumable: false,
                        },
                    );
                    id
                };
                if let Some(item) = self.state.downloads.iter_mut().find(|d| d.id == id) {
                    if !update.path.is_empty() {
                        item.path = update.path;
                        item.filename = update.filename;
                    }
                    let changed = item.status != update.status;
                    item.status = update.status;
                    item.received = update.received;
                    item.total = update.total;
                    item.error = update.error;
                    item.resumable = update.resumable;
                    if changed {
                        self.save();
                    }
                }
            }
            BrowserEvent::DownloadSelected(token, result) => {
                match self.downloads.selected(token, result) {
                    Ok(Some(path)) => {
                        if let Some(id) = self.download_ids.get(&token) {
                            if let Some(item) =
                                self.state.downloads.iter_mut().find(|d| d.id == *id)
                            {
                                item.path = path.to_string_lossy().into();
                                item.filename = path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .into();
                                item.status = "downloading".into();
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(e) => self.notify(&format!("Não foi possível salvar: {e}")),
                }
            }
            BrowserEvent::Shortcut(id, generation, key, shift) => {
                if id != self.state.active_id || !self.current_view(id, generation) {
                    return;
                }
                if key == "dismiss" {
                    let _ = self.chrome.evaluate_script("window.mare?.dismiss?.();");
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
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            windows::core::w!("Mare.Browser"),
        );
    }
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
    let app_proxy = proxy.clone();
    let protection = protection::Protection::new();
    protection.configure(
        state.settings.shield_enabled,
        &state.settings.shield_exceptions,
    );
    let apps = apps::AppManager::new(&data_dir, move |event| {
        let _ = app_proxy.send_event(BrowserEvent::App(event));
    })
    .map_err(std::io::Error::other)?;
    let window = WindowBuilder::new()
        .with_title("Maré")
        .with_window_icon(icon::window_icon())
        .with_inner_size(LogicalSize::new(1280.0, 820.0))
        .with_min_inner_size(LogicalSize::new(760.0, 520.0))
        .with_decorations(false)
        .build(&event_loop)?;
    let ui_proxy = proxy.clone();
    let mut ui_context = WebContext::new(Some(data_dir.join("interface")));
    let chrome_html = embedded_ui().into_bytes();
    let mut chrome_builder = WebViewBuilder::new_with_web_context(&mut ui_context)
        // A stable, intercepted origin enables persistent Web Storage. No server is opened.
        .with_custom_protocol("mare-ui".into(), move |_, request| {
            let root = request.method() == "GET" && request.uri().path() == "/";
            wry::http::Response::builder()
                .status(if root { 200 } else { 404 })
                .header("Content-Type", "text/html; charset=utf-8")
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(std::borrow::Cow::Owned(if root {
                    chrome_html.clone()
                } else {
                    Vec::new()
                }))
                .expect("static interface response headers")
        })
        .with_url("mare-ui://localhost/")
        .with_devtools(cfg!(debug_assertions))
        .with_navigation_handler(|url| allowed_interface_navigation(&url))
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
            .with_https_scheme(true)
            .with_additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI")
            .with_browser_accelerator_keys(false)
            .with_scroll_bar_style(wry::ScrollBarStyle::FluentOverlay)
            .with_default_context_menus(false);
    }
    let chrome = chrome_builder.with_transparent(true).build(&window)?;
    let mut browser = Browser {
        apps,
        resources: resource_control::ResourceControl::default(),
        monitor: task_manager::Monitor::default(),
        writer: storage::Writer::new(data_dir.clone(), {
            let proxy = proxy.clone();
            move |error| {
                let _ = proxy.send_event(BrowserEvent::StorageError(error));
            }
        }),
        media_tabs: HashSet::new(),
        audio_tabs: HashSet::new(),
        view_bounds: HashMap::new(),
        protection,
        views: HashMap::new(),
        view_generations: HashMap::new(),
        next_generation: 1,
        maintenance_view: None,
        chrome,
        window,
        context: WebContext::new(Some(data_dir.join("web-profile"))),
        state,
        proxy,
        data_dir: data_dir.clone(),
        viewport: Viewport {
            x: 0.0,
            y: 100.0,
            width: 1280.0,
            height: 720.0,
        },
        layout_size: (1280.0, 820.0),
        chrome_size: (0, 0),
        overlay: false,
        chrome_panels: Vec::new(),
        extension_root: data_dir.join("extensions"),
        pending_extension: None,
        extension_busy: false,
        permissions: permissions::Manager::default(),
        music_remote: music_remote::Manager::default(),
        external_viewport: None,
        last_external_layout: String::new(),
        external_window: 0,
        guard_scripts: HashMap::new(),
        closed_tabs: Vec::new(),
        private_downloads: HashSet::new(),
        downloads: downloads::Manager::default(),
        download_ids: HashMap::new(),
        zoom: 1.0,
        startup_error,
    };
    let mut background_tick = std::time::Instant::now() + std::time::Duration::from_secs(5);
    event_loop.run(move |event, _, control_flow| {
        let _ = &ui_context; // Keep the UI context alive until its webview closes.
        if std::time::Instant::now() >= background_tick {
            browser.maintain_background_tabs();
            background_tick = std::time::Instant::now() + std::time::Duration::from_secs(5);
        }
        *control_flow = ControlFlow::WaitUntil(background_tick);
        match event {
            Event::UserEvent(event) => browser.handle(event, control_flow),
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if browser.apps.snapshot()["open_ids"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some("notes")))
                {
                    let _ = browser
                        .chrome
                        .evaluate_script("window.mare?.requestClose?.();");
                } else {
                    browser.apps.shutdown();
                    browser.save();
                    browser.writer.flush();
                    *control_flow = ControlFlow::Exit;
                }
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
    if let Some(result) = native_app::run_if_requested() {
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
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
    fn interface_origin_is_stable_and_cannot_navigate_to_external_content() {
        assert!(allowed_interface_navigation("mare-ui://localhost/"));
        assert!(allowed_interface_navigation("https://mare-ui.localhost/"));
        for url in [
            "https://example.com/",
            "https://mare-ui.localhost.evil.example/",
            "http://mare-ui.localhost/",
            "https://mare-ui.localhost/other",
            "data:text/html,hi",
            "file:///C:/test.html",
            "javascript:alert(1)",
        ] {
            assert!(!allowed_interface_navigation(url));
        }
    }
    #[test]
    fn viewport_resize_preserves_toolbar_sidebar_and_bottom_insets() {
        let v = Viewport {
            x: 200.0,
            y: 96.0,
            width: 1080.0,
            height: 700.0,
        };
        let resized = v.fitted((1280.0, 820.0), (940.0, 600.0));
        assert_eq!(
            [resized.x, resized.y, resized.width, resized.height],
            [200.0, 96.0, 740.0, 480.0]
        );
        let tiny = v.fitted((1280.0, 820.0), (1.0, 1.0));
        assert_eq!(
            [tiny.x, tiny.y, tiny.width, tiny.height],
            [0.0, 0.0, 1.0, 1.0]
        );
    }
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
