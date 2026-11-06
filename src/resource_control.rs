use std::collections::HashMap;
use wry::WebView;

#[cfg(windows)]
use std::{
    cell::Cell,
    rc::Rc,
    time::{Duration, Instant},
};
#[cfg(windows)]
use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2_3, TrySuspendCompletedHandler};
#[cfg(windows)]
use windows::core::Interface;
#[cfg(windows)]
use wry::WebViewExtWindows;

#[cfg(windows)]
struct TabActivity {
    background: Rc<Cell<bool>>,
    pending: Rc<Cell<bool>>,
    attempted: Instant,
    background_since: Instant,
}

/// Ask the engine to suspend hidden tabs without destroying their documents.
/// The engine may decline, for example while media is playing.
#[derive(Default)]
pub struct ResourceControl {
    #[cfg(windows)]
    tabs: HashMap<u64, TabActivity>,
}

impl ResourceControl {
    pub fn remove(&mut self, id: u64) {
        #[cfg(windows)]
        if let Some(activity) = self.tabs.remove(&id) {
            activity.background.set(false);
        }
        #[cfg(not(windows))]
        let _ = id;
    }

    pub fn set_background(&mut self, id: u64, view: &WebView, background: bool) {
        #[cfg(windows)]
        {
            let Ok(native) = view.webview().cast::<ICoreWebView2_3>() else {
                return;
            };
            let activity = self.tabs.entry(id).or_insert_with(|| TabActivity {
                background: Rc::new(Cell::new(false)),
                pending: Rc::new(Cell::new(false)),
                attempted: Instant::now() - Duration::from_secs(3),
                background_since: Instant::now(),
            });
            let was_background = activity.background.replace(background);
            if background && !was_background {
                activity.background_since = Instant::now();
            }
            if !background {
                // Also resume inside the completion callback if a pending suspension races this.
                if was_background {
                    unsafe {
                        let _ = native.Resume();
                    }
                }
                return;
            }
            if activity.background_since.elapsed() < Duration::from_secs(30) {
                return;
            }
            if activity.pending.get() || activity.attempted.elapsed() < Duration::from_secs(2) {
                return;
            }
            let mut suspended = windows::core::BOOL::default();
            unsafe {
                let _ = native.IsSuspended(&mut suspended);
            }
            if suspended.as_bool() {
                return;
            }
            activity.attempted = Instant::now();
            activity.pending.set(true);
            let desired = activity.background.clone();
            let pending = activity.pending.clone();
            let resume = native.clone();
            let handler = TrySuspendCompletedHandler::create(Box::new(move |result, success| {
                pending.set(false);
                if result.is_ok() && success && !desired.get() {
                    unsafe {
                        let _ = resume.Resume();
                    }
                }
                Ok(())
            }));
            if unsafe { native.TrySuspend(&handler) }.is_err() {
                activity.pending.set(false);
            }
        }
        #[cfg(not(windows))]
        let _ = (id, view, background);
    }

    pub fn suspended_count(&self, views: &HashMap<u64, WebView>) -> usize {
        #[cfg(windows)]
        {
            views
                .values()
                .filter(|view| {
                    let Ok(native) = view.webview().cast::<ICoreWebView2_3>() else {
                        return false;
                    };
                    let mut suspended = windows::core::BOOL::default();
                    unsafe { native.IsSuspended(&mut suspended).is_ok() && suspended.as_bool() }
                })
                .count()
        }
        #[cfg(not(windows))]
        {
            let _ = views;
            0
        }
    }
}
