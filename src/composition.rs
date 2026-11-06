//! Keep web content alive behind chrome. Regions make native child HWNDs cooperate.
use serde_json::Value;
use wry::WebView;

pub fn cover(view: &WebView) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::*;
        use wry::WebViewExtWindows;
        let _ = SetWindowPos(
            view.hwnd(),
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    #[cfg(not(windows))]
    let _ = view;
}

pub fn raise_content(view: &WebView) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::*;
        use wry::WebViewExtWindows;
        let _ = SetWindowPos(
            view.hwnd(),
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    #[cfg(not(windows))]
    let _ = view;
}

/// Order the embedded native surface above web content; chrome is raised after this.
pub fn raise_external(parent: usize, child: usize) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
        let window = HWND(child as *mut _);
        if child != 0 && GetParent(window).ok() == Some(HWND(parent as *mut _)) {
            let _ = SetWindowPos(
                window,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
    #[cfg(not(windows))]
    let _ = (parent, child);
}

pub fn visible(view: &WebView) -> bool {
    #[cfg(windows)]
    {
        use wry::WebViewExtWindows;
        let mut visible = windows::core::BOOL::default();
        unsafe { view.controller().IsVisible(&mut visible).is_ok() && visible.as_bool() }
    }
    #[cfg(not(windows))]
    {
        let _ = view;
        true
    }
}

pub fn arrange(
    chrome: &WebView,
    viewport: [f64; 4],
    panels: &[Value],
    full: bool,
    scale: f64,
    size: (u32, u32),
) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::{Graphics::Gdi::*, UI::WindowsAndMessaging::*};
        use wry::WebViewExtWindows;
        let region = CreateRectRgn(0, 0, size.0 as i32, size.1 as i32);
        if region.0.is_null() {
            return;
        }
        if !full {
            let [x, y, w, h] = viewport;
            let hole = CreateRectRgn(
                (x * scale).floor() as i32,
                (y * scale).floor() as i32,
                ((x + w) * scale).ceil() as i32,
                ((y + h) * scale).ceil() as i32,
            );
            CombineRgn(Some(region), Some(region), Some(hole), RGN_DIFF);
            let _ = DeleteObject(hole.into());
            for panel in panels.iter().take(12) {
                let rect = |i: usize| panel[i].as_f64().unwrap_or(0.0).clamp(-100.0, 20000.0);
                let (x, y, w, h) = (rect(0), rect(1), rect(2), rect(3));
                let extra = CreateRectRgn(
                    ((x - 12.0) * scale).floor() as i32,
                    ((y - 12.0) * scale).floor() as i32,
                    ((x + w + 12.0) * scale).ceil() as i32,
                    ((y + h + 12.0) * scale).ceil() as i32,
                );
                CombineRgn(Some(region), Some(region), Some(extra), RGN_OR);
                let _ = DeleteObject(extra.into());
            }
        }
        // A successful SetWindowRgn transfers region ownership to the window manager.
        if SetWindowRgn(chrome.hwnd(), Some(region), true) == 0 {
            let _ = DeleteObject(region.into());
        }
        let _ = SetWindowPos(
            chrome.hwnd(),
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    #[cfg(not(windows))]
    let _ = (chrome, viewport, panels, full, scale, size);
}
