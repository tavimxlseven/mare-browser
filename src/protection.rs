//! Request filtering for the Windows WebView2 host.
//!
//! This is Compass's integration with the unmodified, MPL-2.0-licensed
//! `adblock-rust` engine. Filter data is separately licensed; see assets/filters.

use adblock::{
    lists::{FilterSet, ParseOptions},
    request::Request,
    Engine,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use url::Url;

const EASYLIST: &str = include_str!("../assets/filters/easylist.txt");
const EASYPRIVACY: &str = include_str!("../assets/filters/easyprivacy.txt");
const ENGINE_NAME: &str = "adblock-rust 0.13.5";
const LIST_VERSION: &str = "202611060034";
const NOTIFY_INTERVAL: Duration = Duration::from_millis(100);

/// Collected only after a page finishes loading. Values are bounded and are
/// never persisted; they let the Rust engine select relevant generic CSS rules.
pub const COSMETIC_CANDIDATES_SCRIPT: &str = r#"
(() => {
  const classes = new Set(), ids = new Set();
  let visited = 0;
  for (const element of document.querySelectorAll('[class],[id]')) {
    if (++visited > 12000) break;
    if (element.id && element.id.length <= 200 && ids.size < 4000) ids.add(element.id);
    for (const name of element.classList) {
      if (name.length <= 200 && classes.size < 4000) classes.add(name);
    }
  }
  return {classes:[...classes], ids:[...ids]};
})()
"#;

#[derive(Clone, Debug, Serialize)]
pub struct ProtectionSnapshot {
    pub enabled: bool,
    pub site_enabled: bool,
    pub host: String,
    pub blocked: u64,
    pub rules_count: usize,
    pub engine: &'static str,
    pub lists: [&'static str; 2],
    pub list_version: &'static str,
    pub status: &'static str,
}

#[derive(Default)]
struct TabProtection {
    url: String,
    blocked: u64,
    attached: bool,
    last_notification: Option<Instant>,
}

struct Inner {
    engine: Engine,
    enabled: bool,
    exceptions: HashSet<String>,
    tabs: HashMap<u64, TabProtection>,
    rules_count: usize,
}

#[derive(Clone)]
pub struct Protection(Arc<Mutex<Inner>>);

impl Default for Protection {
    fn default() -> Self {
        Self::new()
    }
}

impl Protection {
    pub fn new() -> Self {
        Self::with_lists(&[EASYLIST, EASYPRIVACY])
    }

    fn with_lists(lists: &[&str]) -> Self {
        let mut set = FilterSet::new(false);
        for list in lists {
            set.add_filter_list((*list).to_owned(), ParseOptions::default());
        }
        let engine = Engine::new_with_filter_set(set);
        let rules_count = engine
            .get_debug_info()
            .source_info
            .iter()
            .map(|source| (source.network_filter_count + source.cosmetic_filter_count) as usize)
            .sum();
        Self(Arc::new(Mutex::new(Inner {
            engine,
            enabled: true,
            exceptions: HashSet::new(),
            tabs: HashMap::new(),
            rules_count,
        })))
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn configure(&self, enabled: bool, exceptions: &[String]) {
        let mut inner = self.inner();
        inner.enabled = enabled;
        inner.exceptions = exceptions
            .iter()
            .filter_map(|value| exception_host(value))
            .collect();
    }

    /// Call from the top-level NavigationStarting handler, including reloads.
    /// `about:blank` is deliberately ignored during native view construction.
    pub fn begin_navigation(&self, tab_id: u64, url: &str) {
        if host_for_url(url).is_none() {
            return;
        }
        let mut inner = self.inner();
        let tab = inner.tabs.entry(tab_id).or_default();
        tab.url = url.into();
        tab.blocked = 0;
        tab.last_notification = None;
    }

    pub fn remove_tab(&self, tab_id: u64) {
        self.inner().tabs.remove(&tab_id);
    }

    pub fn snapshot(&self, tab_id: u64, url: &str) -> ProtectionSnapshot {
        let inner = self.inner();
        let host = host_for_url(url).unwrap_or_default();
        let site_enabled = !host.is_empty() && !inner.exceptions.contains(&host);
        let tab = inner.tabs.get(&tab_id);
        let available = tab.is_some_and(|tab| tab.attached);
        ProtectionSnapshot {
            enabled: inner.enabled,
            site_enabled,
            host,
            blocked: tab.map_or(0, |tab| tab.blocked),
            rules_count: inner.rules_count,
            engine: ENGINE_NAME,
            lists: ["EasyList", "EasyPrivacy"],
            list_version: LIST_VERSION,
            status: if !inner.enabled {
                "disabled"
            } else if !site_enabled {
                "site_disabled"
            } else if !available {
                "unavailable"
            } else {
                "active"
            },
        }
    }

    fn should_block(
        &self,
        tab_id: u64,
        url: &str,
        request_type: &str,
        method: &str,
        referer: &str,
    ) -> bool {
        if host_for_url(url).is_none() {
            return false;
        }
        let inner = self.inner();
        let Some(tab) = inner.tabs.get(&tab_id) else {
            return false;
        };
        let Some(host) = host_for_url(&tab.url) else {
            return false;
        };
        if !inner.enabled || inner.exceptions.contains(&host) {
            return false;
        }
        let source = if host_for_url(referer).is_some() {
            referer
        } else {
            &tab.url
        };
        let Ok(request) = Request::new(url, source, request_type, method) else {
            return false;
        };
        inner.engine.check_network_request(&request).should_block()
    }

    /// Records a response only after WebView2 accepts the synthetic block.
    /// Notification frequency is bounded; snapshots always read the exact count.
    fn record_block(&self, tab_id: u64) -> bool {
        let mut inner = self.inner();
        let Some(tab) = inner.tabs.get_mut(&tab_id) else {
            return false;
        };
        tab.blocked = tab.blocked.saturating_add(1);
        if tab
            .last_notification
            .is_some_and(|last| last.elapsed() < NOTIFY_INTERVAL)
        {
            return false;
        }
        tab.last_notification = Some(Instant::now());
        true
    }

    /// Domain-specific and relevant generic CSS selectors only. No downloaded
    /// JavaScript, scriptlets, procedural actions or replacement resources run.
    pub fn cosmetics_script(
        &self,
        tab_id: u64,
        url: &str,
        classes: &[String],
        ids: &[String],
    ) -> String {
        let inner = self.inner();
        let enabled = inner.enabled
            && host_for_url(url).is_some_and(|host| !inner.exceptions.contains(&host))
            && inner.tabs.get(&tab_id).is_some_and(|tab| tab.url == url);
        let mut selectors = if enabled {
            let resources = inner.engine.url_cosmetic_resources(url);
            let mut selectors = resources.hide_selectors;
            if !resources.generichide {
                selectors.extend(inner.engine.hidden_class_id_selectors(
                    classes.iter().take(4000),
                    ids.iter().take(4000),
                    &resources.exceptions,
                ));
            }
            selectors
                .into_iter()
                .filter(|value| value.len() <= 2000)
                .take(5000)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        selectors.sort_unstable();
        let selectors = serde_json::to_string(&selectors).unwrap_or_else(|_| "[]".into());
        format!(
            r#"(() => {{
          document.getElementById('__mare_protection_css')?.remove();
          const selectors = {selectors};
          if (!selectors.length) return;
          const style = document.createElement('style');
          style.id = '__mare_protection_css';
          style.textContent = selectors.filter(selector => {{
            try {{ return CSS.supports('selector(' + selector + ')'); }} catch {{ return false; }}
          }}).map(selector => selector + '{{display:none!important}}').join('\n');
          (document.head || document.documentElement).append(style);
        }})()"#
        )
    }

    /// Attach before loading a remote URL. WebView2 retains the COM event handler
    /// until this WebView is destroyed. Modern request-source filtering includes
    /// documents, subresources, child frames and supported worker requests.
    #[cfg(windows)]
    pub fn attach(
        &self,
        view: &wry::WebView,
        tab_id: u64,
        on_block: impl Fn(u64) + 'static,
    ) -> Result<(), String> {
        use webview2_com::{
            take_pwstr, Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler,
        };
        use windows::{
            core::{w, Interface, PWSTR},
            Win32::System::Com::IStream,
        };
        use wry::WebViewExtWindows;

        let webview = view.webview();
        let environment = view.environment();
        let modern = webview.cast::<ICoreWebView2_22>().map_err(|_| {
            "A proteção requer uma versão recente do Microsoft Edge WebView2 Runtime.".to_owned()
        })?;
        // SAFETY: All calls run on the WebView's owning STA thread. The COM
        // objects and callback are retained by WebView2; out-strings are freed.
        unsafe {
            modern
                .AddWebResourceRequestedFilterWithRequestSourceKinds(
                    w!("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )
                .map_err(|error| error.to_string())?;
        }
        let protection = self.clone();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: The callback is invoked by WebView2 on its owning thread.
            unsafe {
                let request = args.Request()?;
                let mut uri = PWSTR::null();
                request.Uri(&mut uri)?;
                let url = take_pwstr(uri);
                let mut method = PWSTR::null();
                request.Method(&mut method)?;
                let method = take_pwstr(method).to_ascii_lowercase();
                let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_OTHER;
                args.ResourceContext(&mut context)?;
                let mut referer = PWSTR::null();
                if let Ok(headers) = request.Headers() {
                    let _ = headers.GetHeader(w!("Referer"), &mut referer);
                }
                let referer = take_pwstr(referer);
                let request_type = match context {
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => {
                        let inner = protection.inner();
                        if inner.tabs.get(&tab_id).is_some_and(|tab| tab.url == url) {
                            "document"
                        } else {
                            "subdocument"
                        }
                    }
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST
                    | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH
                    | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE => "xmlhttprequest",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
                    _ => "other",
                };
                if protection.should_block(tab_id, &url, request_type, &method, &referer) {
                    let response = environment.CreateWebResourceResponse(
                        None::<&IStream>,
                        403,
                        w!("Blocked by Mare"),
                        w!("Content-Type: text/plain\r\nContent-Length: 0\r\nCache-Control: no-store\r\n"),
                    )?;
                    args.SetResponse(&response)?;
                    if protection.record_block(tab_id) {
                        on_block(tab_id);
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: This registration uses the same live STA WebView and callback.
        unsafe { webview.add_WebResourceRequested(&handler, &mut token) }
            .map_err(|error| error.to_string())?;
        self.inner().tabs.entry(tab_id).or_default().attached = true;
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn attach(
        &self,
        _view: &wry::WebView,
        _tab_id: u64,
        _on_block: impl Fn(u64) + 'static,
    ) -> Result<(), String> {
        Err("O filtro de rede nativo está disponível no Windows nesta versão.".into())
    }
}

pub fn host_for_url(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    Some(url.host_str()?.trim_end_matches('.').to_ascii_lowercase())
}

fn exception_host(value: &str) -> Option<String> {
    host_for_url(value).or_else(|| host_for_url(&format!("https://{}", value.trim())))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_RULES: &str = "||ads.advertising.test^$third-party\n@@||ads.advertising.test/allowed.js$script\n||127.0.0.1*/mare-blocked-resource.js$script\nexample.test##.sponsored\n##.ad-slot\n";

    fn test_engine() -> Protection {
        let protection = Protection::with_lists(&[TEST_RULES]);
        protection.begin_navigation(1, "https://example.test/article");
        protection
    }

    #[test]
    fn network_types_first_party_and_filter_exceptions_are_respected() {
        let protection = test_engine();
        assert!(protection.should_block(
            1,
            "https://ads.advertising.test/banner.js",
            "script",
            "get",
            ""
        ));
        assert!(!protection.should_block(
            1,
            "https://ads.advertising.test/allowed.js",
            "script",
            "get",
            ""
        ));
        assert!(!protection.should_block(1, "https://example.test/app.js", "script", "get", ""));
        protection.begin_navigation(1, "https://ads.advertising.test/");
        assert!(!protection.should_block(
            1,
            "https://ads.advertising.test/banner.js",
            "script",
            "get",
            ""
        ));
    }

    #[test]
    fn policy_exceptions_apply_to_top_level_site_not_advertiser() {
        let protection = test_engine();
        protection.configure(true, &["EXAMPLE.test".into()]);
        assert!(!protection.should_block(
            1,
            "https://ads.advertising.test/banner.js",
            "script",
            "get",
            ""
        ));
        protection.configure(false, &[]);
        assert!(!protection.should_block(
            1,
            "https://ads.advertising.test/banner.js",
            "script",
            "get",
            ""
        ));
        protection.configure(true, &[]);
        assert!(protection.should_block(
            1,
            "https://ads.advertising.test/banner.js",
            "script",
            "get",
            ""
        ));
    }

    #[test]
    fn counters_only_record_actual_blocks_and_reset_on_reload() {
        let protection = test_engine();
        assert_eq!(
            protection
                .snapshot(1, "https://example.test/article")
                .blocked,
            0
        );
        assert!(protection.record_block(1));
        assert!(!protection.record_block(1));
        assert_eq!(
            protection
                .snapshot(1, "https://example.test/article")
                .blocked,
            2
        );
        protection.begin_navigation(1, "https://example.test/article");
        assert_eq!(
            protection
                .snapshot(1, "https://example.test/article")
                .blocked,
            0
        );
        protection.remove_tab(1);
        assert!(!protection.record_block(1));
    }

    #[test]
    fn cosmetic_filters_and_disable_respect_page_policy() {
        let protection = test_engine();
        let script = protection.cosmetics_script(
            1,
            "https://example.test/article",
            &["ad-slot".into()],
            &[],
        );
        assert!(script.contains(".sponsored"));
        assert!(script.contains(".ad-slot"));
        assert!(script.contains("textContent"));
        protection.configure(false, &[]);
        assert!(!protection
            .cosmetics_script(1, "https://example.test/article", &["ad-slot".into()], &[])
            .contains(".sponsored"));
    }

    #[test]
    fn bundled_lists_block_known_ad_and_tracker_requests() {
        let protection = Protection::new();
        protection.begin_navigation(1, "https://example.com/article");
        assert!(protection.should_block(
            1,
            "https://googleads.g.doubleclick.net/pagead/ads",
            "script",
            "get",
            ""
        ));
        assert!(protection.should_block(
            1,
            "https://www.google-analytics.com/analytics.js",
            "script",
            "get",
            ""
        ));
        assert!(!protection.should_block(
            1,
            "https://example.com/assets/app.js",
            "script",
            "get",
            ""
        ));
        assert!(
            protection
                .snapshot(1, "https://example.com/article")
                .rules_count
                > 100_000
        );
    }
}
