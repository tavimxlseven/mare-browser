#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod interface;
#[cfg(windows)]
include!("windows.rs");
#[cfg(target_os = "linux")]
include!("linux_worker.rs");
