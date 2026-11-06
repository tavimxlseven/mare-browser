//! Native save selection and operation tracking, retaining the engine's streaming downloader.
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use webview2_com::{
    BytesReceivedChangedEventHandler, DownloadStartingEventHandler,
    Microsoft::Web::WebView2::Win32::*, StateChangedEventHandler,
};
use windows::{
    core::{Interface, HSTRING, PWSTR},
    Win32::{Foundation::HWND, System::Com::*, UI::Shell::*},
};
use wry::{WebView, WebViewExtWindows};
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Update {
    pub token: u64,
    pub filename: String,
    pub path: String,
    pub status: String,
    pub received: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub resumable: bool,
    pub private: bool,
}
struct Pending {
    args: ICoreWebView2DownloadStartingEventArgs,
    deferral: ICoreWebView2Deferral,
}
#[derive(Default)]
struct Inner {
    pending: HashMap<u64, Pending>,
    operations: HashMap<u64, ICoreWebView2DownloadOperation>,
}
#[derive(Clone, Default)]
pub struct Manager(Rc<RefCell<Inner>>);
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
pub type Pick = Arc<dyn Fn(u64, Result<Option<PathBuf>, String>) + Send + Sync>;
fn string(get: impl FnOnce(&mut PWSTR) -> windows::core::Result<()>) -> String {
    let mut p = PWSTR::null();
    if get(&mut p).is_err() {
        return String::new();
    }
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0.cast()));
        s
    }
}
fn snapshot(op: &ICoreWebView2DownloadOperation, token: u64, private: bool) -> Update {
    unsafe {
        let path = string(|p| op.ResultFilePath(p));
        let mut received = 0;
        let mut total = 0;
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
        let mut resume = windows::core::BOOL::default();
        let _ = op.BytesReceived(&mut received);
        let _ = op.TotalBytesToReceive(&mut total);
        let _ = op.State(&mut state);
        let _ = op.InterruptReason(&mut reason);
        let _ = op.CanResume(&mut resume);
        let mut result = Update {
            token,
            filename: Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            path,
            status: if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                "completed"
            } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                    "cancelled"
                } else {
                    "failed"
                }
            } else {
                "downloading"
            }
            .into(),
            received: received.max(0) as u64,
            total: (total > 0).then_some(total as u64),
            error: None,
            resumable: resume.as_bool(),
            private,
        };
        if result.status == "failed" {
            result.error = Some(format!(
                "{} (código {})",
                match reason {
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_FAILED =>
                        "Falha ao gravar o arquivo",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_ACCESS_DENIED =>
                        "Acesso negado à pasta",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_NO_SPACE => "Sem espaço no disco",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_NAME_TOO_LONG =>
                        "Nome do arquivo muito longo",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_TOO_LARGE =>
                        "O arquivo excede o tamanho suportado pelo destino",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_MALICIOUS
                    | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_BLOCKED_BY_POLICY
                    | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_SECURITY_CHECK_FAILED =>
                        "O arquivo foi bloqueado pela proteção do sistema",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_DISCONNECTED
                    | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_FAILED
                    | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_SERVER_DOWN
                    | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_TIMEOUT =>
                        "A conexão foi interrompida",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_CERTIFICATE_PROBLEM =>
                        "O certificado do servidor não pôde ser validado",
                    COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_CONTENT_LENGTH_MISMATCH =>
                        "O servidor enviou um arquivo incompleto",
                    _ => "O download foi interrompido",
                },
                reason.0
            ));
        }
        if result.status == "completed" && !Path::new(&result.path).is_file() {
            result.status = "missing".into();
            result.error = Some("O arquivo não está mais na pasta escolhida.".into());
        }
        result
    }
}
impl Manager {
    pub fn attach(
        &self,
        view: &WebView,
        parent: usize,
        private: bool,
        changed: Rc<dyn Fn(Update)>,
        picked: Pick,
    ) -> Result<(), String> {
        let inner = self.0.clone();
        let native = view
            .webview()
            .cast::<ICoreWebView2_4>()
            .map_err(|e| e.to_string())?;
        unsafe {
            native
                .add_DownloadStarting(
                    &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let token = SEQUENCE.fetch_add(1, Ordering::Relaxed);
                        let op = args.DownloadOperation()?;
                        args.SetHandled(true)?;
                        let deferral = args.GetDeferral()?;
                        let path = string(|p| args.ResultFilePath(p));
                        let filename = crate::download_filename(Path::new(&path));
                        let uri = string(|p| op.Uri(p));
                        inner.borrow_mut().pending.insert(
                            token,
                            Pending {
                                args: args.clone(),
                                deferral,
                            },
                        );
                        inner.borrow_mut().operations.insert(token, op.clone());
                        changed(Update {
                            token,
                            filename: filename.clone(),
                            status: "choosing".into(),
                            private,
                            ..Default::default()
                        });
                        let report = changed.clone();
                        op.add_StateChanged(
                            &StateChangedEventHandler::create(Box::new(move |op, _| {
                                if let Some(op) = op {
                                    report(snapshot(&op, token, private))
                                }
                                Ok(())
                            })),
                            &mut 0,
                        )?;
                        let report = changed.clone();
                        let mut last = Instant::now();
                        op.add_BytesReceivedChanged(
                            &BytesReceivedChangedEventHandler::create(Box::new(move |op, _| {
                                if last.elapsed().as_millis() >= 200 {
                                    last = Instant::now();
                                    if let Some(op) = op {
                                        report(snapshot(&op, token, private))
                                    }
                                }
                                Ok(())
                            })),
                            &mut 0,
                        )?;
                        let picked = picked.clone();
                        std::thread::spawn(move || {
                            #[cfg(debug_assertions)]
                            if url::Url::parse(&uri)
                                .is_ok_and(|u| u.host_str() == Some("127.0.0.1"))
                            {
                                if let Some(root) =
                                    std::env::var_os("MARE_QA_DOWNLOAD_DIR").filter(|p| {
                                        p.to_string_lossy().to_ascii_lowercase().contains("qa")
                                    })
                                {
                                    let root = PathBuf::from(root);
                                    let _ = std::fs::create_dir_all(&root);
                                    picked(token, Ok(Some(available_path(&root, &filename))));
                                    return;
                                }
                            }
                            let _ = &uri;
                            picked(token, save_dialog(parent, &filename));
                        });
                        Ok(())
                    })),
                    &mut 0,
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn selected(
        &self,
        token: u64,
        result: Result<Option<PathBuf>, String>,
    ) -> Result<Option<PathBuf>, String> {
        let Some(pending) = self.0.borrow_mut().pending.remove(&token) else {
            return Ok(None);
        };
        unsafe {
            let accepted = match result {
                Ok(Some(path)) => pending
                    .args
                    .SetResultFilePath(&HSTRING::from(path.as_path()))
                    .map_err(|e| e.to_string())
                    .map(|()| Some(path)),
                Ok(None) => Ok(None),
                Err(e) => Err(e),
            };
            if !matches!(accepted, Ok(Some(_))) {
                let _ = pending.args.SetCancel(true);
            }
            let complete = pending.deferral.Complete().map_err(|e| e.to_string());
            complete?;
            accepted
        }
    }
    pub fn command(&self, token: u64, resume: bool) -> Result<(), String> {
        let inner = self.0.borrow();
        let op = inner
            .operations
            .get(&token)
            .ok_or("Esta transferência não está mais ativa.")?;
        unsafe {
            if resume {
                op.Resume()
            } else {
                op.Cancel()
            }
        }
        .map_err(|e| e.to_string())
    }
}
fn available_path(root: &Path, name: &str) -> PathBuf {
    let p = root.join(name);
    if !p.exists() {
        return p;
    }
    let stem = Path::new(name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let ext = Path::new(name)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for i in 1u64.. {
        let p = root.join(format!("{stem} ({i}){ext}"));
        if !p.exists() {
            return p;
        }
    }
    unreachable!()
}
fn save_dialog(parent: usize, filename: &str) -> Result<Option<PathBuf>, String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| -> windows::core::Result<Option<PathBuf>> {
            let dialog: IFileSaveDialog =
                CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetTitle(&HSTRING::from("Salvar download"))?;
            dialog.SetFileName(&HSTRING::from(filename))?;
            dialog.SetOptions(
                FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR,
            )?;
            if let Ok(folder) = SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None) {
                let text = folder.to_string()?;
                CoTaskMemFree(Some(folder.0.cast()));
                let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(text), None)?;
                dialog.SetDefaultFolder(&item)?;
            }
            match dialog.Show(Some(HWND(parent as *mut _))) {
                Ok(()) => {
                    let item = dialog.GetResult()?;
                    let p = item.GetDisplayName(SIGDN_FILESYSPATH)?;
                    let text = p.to_string()?;
                    CoTaskMemFree(Some(p.0.cast()));
                    Ok(Some(PathBuf::from(text)))
                }
                Err(e) if e.code().0 as u32 == 0x800704c7 => Ok(None),
                Err(e) => Err(e),
            }
        })();
        CoUninitialize();
        result.map_err(|e| e.to_string())
    }
}
