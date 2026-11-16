//! One-shot consent for Riot's desktop sign-in callback. Callback URLs stay in host memory.
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    time::{Duration, Instant},
};
use webview2_com::{
    take_pwstr, LaunchingExternalUriSchemeEventHandler, Microsoft::Web::WebView2::Win32::*,
    NewWindowRequestedEventHandler,
};
use windows::core::{Interface, PWSTR};
use wry::{WebView, WebViewExtWindows};

pub fn riot_scheme(uri: &str) -> bool {
    uri.len() <= 16_384
        && !uri
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '"')
        && url::Url::parse(uri).is_ok_and(|u| {
            u.scheme() == "riotclient" && u.username().is_empty() && u.password().is_none()
        })
}
fn trusted_origin(origin: &str) -> Option<String> {
    let url = url::Url::parse(origin).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && (host == "riotgames.com" || host.ends_with(".riotgames.com")))
    .then(|| url.origin().ascii_serialization())
}
struct Pending {
    tab: u64,
    uri: String,
    started: Instant,
}
#[derive(Clone, Default)]
pub struct Manager {
    pending: Rc<RefCell<HashMap<u64, Pending>>>,
    next: Rc<Cell<u64>>,
}
impl Manager {
    fn offer(&self, tab: u64, origin: &str, uri: &str) -> Option<Value> {
        self.expire();
        let origin = trusted_origin(origin)?;
        if !riot_scheme(uri)
            || self.pending.borrow().len() >= 8
            || self.pending.borrow().values().any(|p| p.tab == tab)
        {
            return None;
        }
        let id = self.next.get().saturating_add(1);
        self.next.set(id);
        self.pending.borrow_mut().insert(
            id,
            Pending {
                tab,
                uri: uri.into(),
                started: Instant::now(),
            },
        );
        Some(
            json!({"id":id,"tab_id":tab,"origin":origin,"permission":"Riot Client","kind":"external_app"}),
        )
    }
    pub fn attach(
        &self,
        view: &WebView,
        tab: u64,
        show: impl Fn(Value) + 'static,
    ) -> Result<bool, String> {
        let Ok(native) = view.webview().cast::<ICoreWebView2_18>() else {
            return Ok(false);
        };
        let show: Rc<dyn Fn(Value)> = Rc::new(show);
        let manager = self.clone();
        let notify = show.clone();
        let handler = LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            unsafe {
                args.SetCancel(true)?;
                let mut uri = PWSTR::null();
                let mut origin = PWSTR::null();
                args.Uri(&mut uri)?;
                args.InitiatingOrigin(&mut origin)?;
                if let Some(request) = manager.offer(tab, &take_pwstr(origin), &take_pwstr(uri)) {
                    notify(request);
                }
            }
            Ok(())
        }));
        unsafe {
            native
                .add_LaunchingExternalUriScheme(&handler, &mut 0)
                .map_err(|e| e.to_string())?;
        }
        // window.open callbacks are intercepted too, without creating a second browser window.
        let manager = self.clone();
        let popup = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            unsafe {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if !riot_scheme(&uri) {
                    return Ok(());
                }
                args.SetHandled(true)?;
                if let Ok(args) = args.cast::<ICoreWebView2NewWindowRequestedEventArgs3>() {
                    let frame = args.OriginalSourceFrameInfo()?;
                    let mut source = PWSTR::null();
                    frame.Source(&mut source)?;
                    if let Some(request) = manager.offer(tab, &take_pwstr(source), &uri) {
                        show(request);
                    }
                }
            }
            Ok(())
        }));
        unsafe {
            view.webview()
                .add_NewWindowRequested(&popup, &mut 0)
                .map_err(|e| e.to_string())?;
        }
        Ok(true)
    }
    pub fn contains(&self, id: u64) -> bool {
        self.expire();
        self.pending.borrow().contains_key(&id)
    }
    pub fn expire(&self) {
        self.pending
            .borrow_mut()
            .retain(|_, p| p.started.elapsed() < Duration::from_secs(120));
    }
    pub fn close_tab(&self, tab: u64) {
        self.pending.borrow_mut().retain(|_, p| p.tab != tab);
    }
    fn answer_with(
        &self,
        id: u64,
        allow: bool,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.expire();
        let pending = self
            .pending
            .borrow_mut()
            .remove(&id)
            .ok_or("A solicitação expirou. Inicie o login novamente no Riot Client.")?;
        if allow {
            open(&pending.uri)?;
        }
        Ok(())
    }
    pub fn answer(&self, id: u64, allow: bool) -> Result<(), String> {
        self.answer_with(id, allow, |uri| {
            use windows::{core::{w, HSTRING, PCWSTR}, Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}};
            let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(uri), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
            if result.0 as isize <= 32 { Err("Não foi possível abrir o Riot Client. Verifique a instalação do aplicativo e tente novamente.".into()) } else { Ok(()) }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callbacks_require_riot_https_and_explicit_one_shot_consent() {
        let manager = Manager::default();
        let uri = "riotclient://auth/callback?code=FAKE%2Bcode&state=FAKE%26state";
        for origin in [
            "http://authenticate.riotgames.com",
            "https://riotgames.com.evil.test",
            "https://example.com",
            "null",
        ] {
            assert!(manager.offer(1, origin, uri).is_none());
        }
        for unsafe_uri in [
            "file:///C:/test",
            "javascript:alert(1)",
            "ms-settings:defaultapps",
            "riotclient://auth/\"bad",
            "riotclient://auth/\n",
        ] {
            assert!(manager
                .offer(1, "https://authenticate.riotgames.com", unsafe_uri)
                .is_none());
        }
        let request = manager
            .offer(
                1,
                "https://authenticate.riotgames.com/?private=not-shown",
                uri,
            )
            .unwrap();
        assert!(!request.to_string().contains("FAKE"));
        assert!(!request.to_string().contains("private"));
        let id = request["id"].as_u64().unwrap();
        assert!(manager
            .offer(1, "https://authenticate.riotgames.com", uri)
            .is_none());
        manager
            .answer_with(id, false, |_| panic!("cancel must not launch"))
            .unwrap();
        assert!(manager
            .answer_with(id, true, |_| panic!("replay must not launch"))
            .is_err());
        let id = manager
            .offer(1, "https://authenticate.riotgames.com", uri)
            .unwrap()["id"]
            .as_u64()
            .unwrap();
        manager
            .answer_with(id, true, |actual| {
                assert_eq!(actual, uri);
                Ok(())
            })
            .unwrap();
        assert!(manager
            .answer_with(id, true, |_| panic!("one shot only"))
            .is_err());
        let id = manager
            .offer(1, "https://authenticate.riotgames.com", uri)
            .unwrap()["id"]
            .as_u64()
            .unwrap();
        manager.close_tab(1);
        assert!(!manager.contains(id));
    }
}
