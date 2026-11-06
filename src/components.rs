//! Fixed component locations. Neither a manifest nor a web page chooses an executable.
use std::path::PathBuf;

pub fn executable(component: &str) -> Option<PathBuf> {
    let relative = match component {
        "sunnify" => "sunnify/Sunnify.exe",
        "yt-dlp" => "music/yt-dlp.exe",
        "deno" => "music/deno.exe",
        "larpercord" => "larpercord/larperCord/larpercord.exe",
        _ => return None,
    };
    let root = std::env::current_exe().ok()?.parent()?.join("components");
    let path = root.join(relative);
    if path.is_file() {
        return Some(path);
    }
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("dist/Mare/components")
            .join(relative);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[cfg(windows)]
pub struct ProcessTree(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl ProcessTree {
    pub fn new(child: &std::process::Child) -> Result<Self, String> {
        use std::{mem::size_of, os::windows::io::AsRawHandle};
        use windows::Win32::{
            Foundation::{CloseHandle, HANDLE},
            System::JobObjects::*,
        };
        unsafe {
            let handle = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if let Err(error) = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .and_then(|()| AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle())))
            {
                let _ = CloseHandle(handle);
                return Err(error.to_string());
            }
            Ok(Self(handle))
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
