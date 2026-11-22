#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(not(target_os = "macos"))]
mod interface;
#[cfg(windows)]
include!("windows.rs");
#[cfg(unix)]
include!("linux_worker.rs");
