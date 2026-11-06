//! Site permission requests stay pending until the user makes a choice in chrome.
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};
use webview2_com::{
    take_pwstr, Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
};
use windows::core::{Interface, PWSTR};
use wry::{WebView, WebViewExtWindows};

struct Pending {
    tab: u64,
    args: ICoreWebView2PermissionRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}
impl Drop for Pending {
    fn drop(&mut self) {
        unsafe {
            let _ = self.deferral.Complete();
        }
    }
}
#[derive(Default)]
pub struct Manager {
    pending: Rc<RefCell<HashMap<u64, Pending>>>,
    next: Rc<Cell<u64>>,
}
impl Manager {
    pub fn attach(
        &self,
        view: &WebView,
        tab: u64,
        show: impl Fn(Value) + 'static,
    ) -> Result<(), String> {
        let pending = self.pending.clone();
        let next = self.next.clone();
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            unsafe {
                let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                args.PermissionKind(&mut kind)?;
                let label = match kind {
                    COREWEBVIEW2_PERMISSION_KIND_CAMERA => "câmera",
                    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microfone",
                    COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notificações",
                    COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "área de transferência",
                    _ => return Ok(()),
                };
                if pending.borrow().len() >= 8 {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                    return Ok(());
                }
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let origin = url::Url::parse(&take_pwstr(uri))
                    .map(|u| u.origin().ascii_serialization())
                    .unwrap_or_default();
                let id = next.get().saturating_add(1);
                next.set(id);
                let deferral = args.GetDeferral()?;
                pending.borrow_mut().insert(
                    id,
                    Pending {
                        tab,
                        args,
                        deferral,
                    },
                );
                show(json!({"id":id,"tab_id":tab,"origin":origin,"permission":label}));
            }
            Ok(())
        }));
        unsafe {
            view.webview()
                .add_PermissionRequested(&handler, &mut 0)
                .map_err(|e| e.to_string())
        }
    }
    pub fn contains(&self, id: u64) -> bool { self.pending.borrow().contains_key(&id) }
    pub fn answer(&self, id: u64, allow: bool, remember: bool) {
        if let Some(p) = self.pending.borrow_mut().remove(&id) {
            unsafe {
                if let Ok(args) = p.args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
                    let _ = args.SetSavesInProfile(remember);
                }
                let _ = p.args.SetState(if allow {
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                } else {
                    COREWEBVIEW2_PERMISSION_STATE_DENY
                });
            }
        }
    }
    pub fn close_tab(&self, tab: u64) {
        let ids: Vec<_> = self
            .pending
            .borrow()
            .iter()
            .filter(|(_, p)| p.tab == tab)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.answer(id, false, false)
        }
    }
}
