//! Read-only process accounting. Only explicit engine/worker PIDs and their owned descendants.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use wry::WebView;
#[derive(Clone, Debug)]
pub struct Seed {
    pub pid: u32,
    pub group: String,
    pub label: String,
}
#[derive(Default)]
struct Sampler {
    previous: HashMap<u32, (u64, u64)>,
    time: Option<Instant>,
}
pub struct Monitor {
    sampler: Arc<Mutex<Sampler>>,
    pending: Arc<AtomicBool>,
    last: Instant,
}
impl Default for Monitor {
    fn default() -> Self {
        Self {
            sampler: Arc::new(Mutex::new(Sampler::default())),
            pending: Arc::new(AtomicBool::new(false)),
            last: Instant::now() - Duration::from_secs(5),
        }
    }
}
impl Monitor {
    pub fn request(&mut self, seeds: Vec<Seed>, callback: impl FnOnce(Value) + Send + 'static) {
        if self.last.elapsed() < Duration::from_millis(750)
            || self.pending.swap(true, Ordering::Relaxed)
        {
            return;
        }
        self.last = Instant::now();
        let sampler = self.sampler.clone();
        let pending = self.pending.clone();
        thread::spawn(move || {
            let result = sampler
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .sample(seeds);
            pending.store(false, Ordering::Relaxed);
            callback(result);
        });
    }
}
pub fn engine_seeds<'a>(views: impl Iterator<Item = &'a WebView>) -> Vec<Seed> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    use wry::WebViewExtWindows;
    let mut groups = HashSet::new();
    let mut seeds = BTreeMap::new();
    for view in views {
        unsafe {
            let mut browser = 0;
            if view.webview().BrowserProcessId(&mut browser).is_err() || !groups.insert(browser) {
                continue;
            }
            seeds.insert(
                browser,
                Seed {
                    pid: browser,
                    group: "Motor WebView2".into(),
                    label: "Navegador WebView2".into(),
                },
            );
            if let Ok(environment) = view.environment().cast::<ICoreWebView2Environment8>() {
                if let Ok(infos) = environment.GetProcessInfos() {
                    let mut count = 0;
                    if infos.Count(&mut count).is_err() {
                        continue;
                    }
                    for index in 0..count.min(512) {
                        if let Ok(info) = infos.GetValueAtIndex(index) {
                            let mut pid = 0;
                            let mut kind = COREWEBVIEW2_PROCESS_KIND_BROWSER;
                            if info.ProcessId(&mut pid).is_err() || pid <= 0 {
                                continue;
                            }
                            let _ = info.Kind(&mut kind);
                            let label = match kind {
                                COREWEBVIEW2_PROCESS_KIND_BROWSER => "Navegador WebView2",
                                COREWEBVIEW2_PROCESS_KIND_RENDERER => "Renderizador WebView2",
                                COREWEBVIEW2_PROCESS_KIND_GPU => "GPU WebView2",
                                COREWEBVIEW2_PROCESS_KIND_UTILITY => "Serviço WebView2",
                                COREWEBVIEW2_PROCESS_KIND_SANDBOX_HELPER => "Isolamento WebView2",
                                _ => "Auxiliar WebView2",
                            };
                            seeds.insert(
                                pid as u32,
                                Seed {
                                    pid: pid as u32,
                                    group: "Motor WebView2".into(),
                                    label: label.into(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    seeds.into_values().collect()
}
#[derive(Clone)]
struct Process {
    pid: u32,
    parent: u32,
    name: String,
}
fn select(seeds: Vec<Seed>, processes: &[Process]) -> BTreeMap<u32, Seed> {
    let mut selected: BTreeMap<_, _> = seeds.into_iter().map(|s| (s.pid, s)).collect();
    for _ in 0..32 {
        let mut added = false;
        for process in processes {
            if selected.contains_key(&process.pid) {
                continue;
            }
            if let Some(parent) = selected.get(&process.parent) {
                let engine = process.name.eq_ignore_ascii_case("msedgewebview2.exe")
                    || process.name.eq_ignore_ascii_case("crashpad_handler.exe");
                if parent.group != "Compass Browser" && (parent.group != "Motor WebView2" || engine)
                    || engine
                {
                    let seed = Seed {
                        pid: process.pid,
                        group: if engine {
                            "Motor WebView2".into()
                        } else {
                            parent.group.clone()
                        },
                        label: if engine {
                            "Auxiliar WebView2".into()
                        } else {
                            process.name.clone()
                        },
                    };
                    selected.insert(process.pid, seed);
                    added = true;
                }
            }
        }
        if !added || selected.len() >= 512 {
            break;
        }
    }
    selected
}
#[derive(Serialize)]
struct Row {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    group: String,
    exe: String,
    working_set_bytes: Option<u64>,
    private_working_set_bytes: Option<u64>,
    private_bytes: Option<u64>,
    cpu_percent: Option<f64>,
}
fn cpu(
    previous: Option<(u64, u64)>,
    created: u64,
    time: u64,
    elapsed: f64,
    cores: u32,
) -> Option<f64> {
    let (old_created, old) = previous?;
    if old_created != created || time < old || elapsed <= 0.0 {
        return None;
    }
    Some(
        ((time - old) as f64 / (elapsed * 10_000_000.0 * cores.max(1) as f64) * 100.0)
            .clamp(0.0, 100.0),
    )
}
impl Sampler {
    fn sample(&mut self, seeds: Vec<Seed>) -> Value {
        use windows::Win32::{
            Foundation::{CloseHandle, FILETIME},
            System::{Diagnostics::ToolHelp::*, ProcessStatus::*, Threading::*},
        };
        let now = Instant::now();
        let elapsed = self
            .time
            .map(|t| now.duration_since(t).as_secs_f64())
            .unwrap_or(0.0);
        let mut processes = Vec::new();
        unsafe {
            if let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                let mut entry = PROCESSENTRY32W {
                    dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                    ..Default::default()
                };
                if Process32FirstW(snapshot, &mut entry).is_ok() {
                    loop {
                        let n = entry
                            .szExeFile
                            .iter()
                            .position(|c| *c == 0)
                            .unwrap_or(entry.szExeFile.len());
                        processes.push(Process {
                            pid: entry.th32ProcessID,
                            parent: entry.th32ParentProcessID,
                            name: String::from_utf16_lossy(&entry.szExeFile[..n]),
                        });
                        if Process32NextW(snapshot, &mut entry).is_err() {
                            break;
                        }
                    }
                }
                let _ = CloseHandle(snapshot);
            }
        }
        let process_map: HashMap<_, _> = processes.iter().map(|p| (p.pid, p)).collect();
        let selected = select(seeds, &processes);
        let truncated = selected.len() > 512;
        let cores = unsafe { GetActiveProcessorCount(0xffff) }.max(1);
        let mut next = HashMap::new();
        let mut rows = Vec::new();
        for seed in selected.into_values().take(512) {
            let mut row = Row {
                pid: seed.pid,
                parent_pid: process_map.get(&seed.pid).map(|p| p.parent),
                exe: process_map
                    .get(&seed.pid)
                    .map(|p| p.name.clone())
                    .unwrap_or_default(),
                name: seed.label,
                group: seed.group,
                working_set_bytes: None,
                private_working_set_bytes: None,
                private_bytes: None,
                cpu_percent: None,
            };
            unsafe {
                if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, seed.pid)
                {
                    let mut memory = PROCESS_MEMORY_COUNTERS_EX2 {
                        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
                        ..Default::default()
                    };
                    if GetProcessMemoryInfo(
                        handle,
                        (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX2).cast(),
                        memory.cb,
                    )
                    .is_ok()
                    {
                        row.working_set_bytes = Some(memory.WorkingSetSize as u64);
                        row.private_bytes = Some(memory.PrivateUsage as u64);
                        row.private_working_set_bytes = Some(memory.PrivateWorkingSetSize as u64);
                    } else {
                        let mut memory = PROCESS_MEMORY_COUNTERS_EX {
                            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                            ..Default::default()
                        };
                        if GetProcessMemoryInfo(
                            handle,
                            (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX).cast(),
                            memory.cb,
                        )
                        .is_ok()
                        {
                            row.working_set_bytes = Some(memory.WorkingSetSize as u64);
                            row.private_bytes = Some(memory.PrivateUsage as u64);
                        }
                    }
                    let (mut created, mut exited, mut kernel, mut user) = (
                        FILETIME::default(),
                        FILETIME::default(),
                        FILETIME::default(),
                        FILETIME::default(),
                    );
                    if GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)
                        .is_ok()
                    {
                        let ticks = |t: FILETIME| {
                            ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
                        };
                        let created = ticks(created);
                        let time = ticks(kernel) + ticks(user);
                        row.cpu_percent = cpu(
                            self.previous.get(&seed.pid).copied(),
                            created,
                            time,
                            elapsed,
                            cores,
                        );
                        next.insert(seed.pid, (created, time));
                    }
                    let _ = CloseHandle(handle);
                }
            }
            rows.push(row);
        }
        self.time = Some(now);
        self.previous = next;
        rows.sort_by(|a, b| a.group.cmp(&b.group).then(a.pid.cmp(&b.pid)));
        let sampled = rows.iter().filter(|r| r.private_bytes.is_some()).count();
        let private_sampled = rows
            .iter()
            .filter(|r| r.private_working_set_bytes.is_some())
            .count();
        let cpu_sampled = rows.iter().filter(|r| r.cpu_percent.is_some()).count();
        json!({"sampled_at":crate::model::now_ms(),"root_pid":std::process::id(),"logical_processors":cores,"process_count":rows.len(),"sampled_processes":sampled,"private_ram_samples":private_sampled,"cpu_samples":cpu_sampled,"truncated":truncated,"totals":{"working_set_bytes":rows.iter().filter_map(|r|r.working_set_bytes).sum::<u64>(),"private_working_set_bytes":if private_sampled==rows.len()&&!rows.is_empty(){Some(rows.iter().filter_map(|r|r.private_working_set_bytes).sum::<u64>())}else{None},"private_bytes":rows.iter().filter_map(|r|r.private_bytes).sum::<u64>(),"cpu_percent":if cpu_sampled>0{Some(rows.iter().filter_map(|r|r.cpu_percent).sum::<f64>())}else{None}},"processes":rows})
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descendants_are_scoped_and_pids_unique() {
        let seed = |pid, group: &str| Seed {
            pid,
            group: group.into(),
            label: group.into(),
        };
        let p = |pid, parent, name: &str| Process {
            pid,
            parent,
            name: name.into(),
        };
        let selected = select(
            vec![
                seed(1, "Compass Browser"),
                seed(3, "Spotify"),
                seed(4, "Motor WebView2"),
            ],
            &[
                p(4, 1, "msedgewebview2.exe"),
                p(5, 4, "msedgewebview2.exe"),
                p(6, 3, "Sunnify.exe"),
                p(7, 6, "ffmpeg.exe"),
                p(8, 999, "msedgewebview2.exe"),
                p(9, 1, "Spotify.exe"),
            ],
        );
        assert_eq!(
            selected.keys().copied().collect::<Vec<_>>(),
            vec![1, 3, 4, 5, 6, 7]
        );
    }
    #[test]
    fn cpu_uses_machine_capacity_and_rejects_reused_pids() {
        assert_eq!(cpu(Some((1, 10)), 1, 20_000_010, 1.0, 4), Some(50.0));
        assert_eq!(cpu(Some((1, 10)), 2, 20, 1.0, 4), None);
        assert_eq!(cpu(None, 1, 20, 1.0, 4), None);
    }
}
