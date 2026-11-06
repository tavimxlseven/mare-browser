//! Host the original larperCord window in an app tab, with a separate data directory.
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::*,
    },
};
pub struct Larper {
    child: Child,
    window: HWND,
    _tree: crate::components::ProcessTree,
    attached: bool,
}
impl Larper {
    pub fn new(directory: &Path) -> Result<Self, String> {
        let executable = crate::components::executable("larpercord")
            .ok_or("O componente larperCord não acompanha este pacote.")?;
        let config = directory.join("config");
        let cache = directory.join("cache");
        fs::create_dir_all(&config)
            .and_then(|()| fs::create_dir_all(&cache))
            .map_err(|e| e.to_string())?;
        let mut command = Command::new(&executable);
        command
            .current_dir(executable.parent().unwrap())
            .args(["--lang", "pt"])
            .env("XDG_CONFIG_HOME", &config)
            .env("XDG_CACHE_HOME", &cache)
            .env("APPDATA", &config)
            .env("LOCALAPPDATA", &cache)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if std::env::var_os("MARE_APP_QA_DEMO").is_some() {
            command.args(["--demo", "--no-live"]);
        }
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let tree = match crate::components::ProcessTree::new(&child) {
            Ok(tree) => tree,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        struct Search {
            pid: u32,
            window: HWND,
        }
        unsafe extern "system" fn find(hwnd: HWND, param: LPARAM) -> BOOL {
            let search = &mut *(param.0 as *mut Search);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == search.pid && GetWindow(hwnd, GW_OWNER).ok().is_none() {
                search.window = hwnd;
                return BOOL(0);
            }
            BOOL(1)
        }
        let mut search = Search {
            pid: child.id(),
            window: HWND::default(),
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while search.window.0.is_null() {
            unsafe {
                let _ = EnumWindows(Some(find), LPARAM(&mut search as *mut _ as isize));
            }
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("O larperCord encerrou durante a abertura.".into());
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err("A janela do larperCord não ficou pronta.".into());
            }
            thread::sleep(Duration::from_millis(30));
        }
        unsafe {
            let _ = ShowWindow(search.window, SW_HIDE);
        }
        Ok(Self {
            child,
            window: search.window,
            _tree: tree,
            attached: false,
        })
    }
    pub fn handle(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("O larperCord foi encerrado.".into());
        }
        if method == "host_layout" {
            let parent = params["parent"]
                .as_u64()
                .filter(|p| *p > 0)
                .ok_or("Janela do host inválida.")?;
            let rect = &params["rect"];
            let coord = |i: usize| rect[i].as_i64().unwrap_or(0).clamp(0, 32000) as i32;
            unsafe {
                if !self.attached {
                    let style = GetWindowLongPtrW(self.window, GWL_STYLE) as u32;
                    SetWindowLongPtrW(
                        self.window,
                        GWL_STYLE,
                        ((style
                            & !(WS_POPUP.0
                                | WS_CAPTION.0
                                | WS_THICKFRAME.0
                                | WS_MINIMIZEBOX.0
                                | WS_MAXIMIZEBOX.0))
                            | WS_CHILD.0) as isize,
                    );
                    SetParent(self.window, Some(HWND(parent as *mut _)))
                        .map_err(|e| format!("Falha ao incorporar larperCord: {e}"))?;
                    self.attached = true;
                }
                SetWindowPos(
                    self.window,
                    None,
                    coord(0),
                    coord(1),
                    coord(2).max(1),
                    coord(3).max(1),
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                )
                .map_err(|e| e.to_string())?;
                let _ = ShowWindow(
                    self.window,
                    if params["visible"].as_bool().unwrap_or(false) {
                        SW_SHOWNOACTIVATE
                    } else {
                        SW_HIDE
                    },
                );
            }
        } else if !matches!(method, "hello" | "status") {
            return Err("Operação do larperCord indisponível.".into());
        }
        Ok(
            json!({"app_id":"discord","protocol_version":1,"external_pid":self.child.id(),"window":self.window.0 as usize,"attached":self.attached,"parent":unsafe{GetParent(self.window).ok().map(|p|p.0 as usize)},"visible":unsafe{IsWindowVisible(self.window).as_bool()},"engine":"larperCord 0.6.0 · Zig/SDL","demo":std::env::var_os("MARE_APP_QA_DEMO").is_some()}),
        )
    }
}
impl Drop for Larper {
    fn drop(&mut self) {
        unsafe {
            let _ = PostMessageW(
                Some(self.window),
                WM_CLOSE,
                windows::Win32::Foundation::WPARAM(0),
                LPARAM(0),
            );
        }
        let deadline = Instant::now() + Duration::from_millis(400);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
