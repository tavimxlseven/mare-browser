use crate::model::BrowserState;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const STATE_FILE: &str = "state.json";
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;
static RECOVERY_ID: AtomicU64 = AtomicU64::new(1);

fn preserve_invalid_profile(path: &Path, reason: &str) -> String {
    let backup = path.with_file_name(format!(
        "state-corrupt-{}-{}-{}.json",
        crate::model::now_ms(),
        std::process::id(),
        RECOVERY_ID.fetch_add(1, Ordering::Relaxed)
    ));
    // Reserve the destination, then preserve the original bytes without logging them.
    let mut reserved_destination = false;
    let result = (|| {
        let reserved = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)?;
        reserved_destination = true;
        drop(reserved);
        fs::rename(path, &backup)
    })();
    match result {
        Ok(()) => format!("{reason} Original preservado em {}.", backup.display()),
        Err(error) => {
            if reserved_destination {
                let _ = fs::remove_file(&backup);
            }
            format!(
                "{reason} O original permanece em {}; falha ao preservar uma cópia: {error}",
                path.display()
            )
        }
    }
}

/// A missing profile starts clean. A damaged existing profile is reported intact.
pub fn load(data_dir: &Path) -> Result<BrowserState, String> {
    let path = data_dir.join(STATE_FILE);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BrowserState::new())
        }
        Err(error) => return Err(format!("Não foi possível ler {}: {error}", path.display())),
    };
    if metadata.len() > MAX_STATE_BYTES {
        return Err(preserve_invalid_profile(
            &path,
            "O perfil excede o limite de 16 MB.",
        ));
    }
    let file = File::open(&path)
        .map_err(|error| format!("Não foi possível abrir {}: {error}", path.display()))?;
    let mut state: BrowserState = match serde_json::from_reader(file) {
        Ok(state) => state,
        Err(error) => {
            let reason = format!(
                "O perfil contém dados inválidos (linha {}, coluna {}).",
                error.line(),
                error.column()
            );
            return Err(preserve_invalid_profile(&path, &reason));
        }
    };
    state.prepare_after_load();
    Ok(state)
}

/// Commit a public-only snapshot through a same-directory atomic rename.
pub fn save(data_dir: &Path, state: &BrowserState) -> Result<(), String> {
    fs::create_dir_all(data_dir)
        .map_err(|error| format!("Não foi possível criar {}: {error}", data_dir.display()))?;
    let path = data_dir.join(STATE_FILE);
    let temp_path = data_dir.join(format!(
        ".state-{}-{}.tmp",
        std::process::id(),
        crate::model::now_ms()
    ));
    let public = state.public_session();
    let bytes = serde_json::to_vec_pretty(&public)
        .map_err(|error| format!("Não foi possível preparar o perfil: {error}"))?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err("O perfil excede o limite de 16 MB. Remova entradas do histórico ou favoritos antes de salvar.".into());
    }
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        // Rust uses replace-existing semantics on Windows for file -> file rename.
        fs::rename(&temp_path, &path)?;
        Ok::<(), std::io::Error>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Não foi possível salvar {}: {error}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::START_URL;

    static NEXT_TEST: AtomicU64 = AtomicU64::new(1);

    fn profile_dir() -> std::path::PathBuf {
        // Keep test I/O beside the project rather than filling the system disk.
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-profiles")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT_TEST.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn public_session_round_trip_excludes_private_tabs_and_retains_id_high_water_mark() {
        let dir = profile_dir();
        let mut state = BrowserState::new();
        state.tabs.clear();
        let public_id = state.new_tab("https://example.com/".into(), false);
        state.finish_load(public_id);
        let private_id = state.new_tab("https://private.example/secret".into(), true);
        state.finish_load(private_id);
        save(&dir, &state).unwrap();
        let bytes = fs::read_to_string(dir.join(STATE_FILE)).unwrap();
        assert!(!bytes.contains("private.example"));
        let mut restored = load(&dir).unwrap();
        assert_eq!(restored.tabs.len(), 1);
        assert_eq!(restored.active_id, public_id);
        assert_eq!(restored.history.len(), 1);
        assert!(restored.new_tab(START_URL.into(), false) > private_id);
        // A second save must replace the existing file on Windows too.
        save(&dir, &restored).unwrap();
        assert_eq!(load(&dir).unwrap().tabs.len(), 2);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_existing_profile_is_preserved_before_fresh_state_can_be_saved() {
        let dir = profile_dir();
        let original = b"{invalid-json";
        fs::write(dir.join(STATE_FILE), original).unwrap();
        let diagnostic = load(&dir).unwrap_err();
        assert!(!diagnostic.contains("invalid-json"));
        let backup = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("state-corrupt-")
            })
            .unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        save(&dir, &BrowserState::new()).unwrap();
        assert_eq!(fs::read(backup).unwrap(), original);
        assert!(load(&dir).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn old_profiles_recover_the_id_counter_and_reject_unsupported_page_schemes() {
        let dir = profile_dir();
        let mut json = serde_json::to_value(BrowserState::new()).unwrap();
        json.as_object_mut().unwrap().remove("next_id");
        json["tabs"][0]["id"] = 10_000.into();
        json["active_id"] = 10_000.into();
        json["bookmarks"][0]["url"] = "javascript:alert(1)".into();
        fs::write(dir.join(STATE_FILE), serde_json::to_vec(&json).unwrap()).unwrap();
        let mut state = load(&dir).unwrap();
        assert_eq!(state.active_id, 10_000);
        assert!(state
            .bookmarks
            .iter()
            .all(|item| !item.url.starts_with("javascript:")));
        assert!(state.new_tab(START_URL.into(), false) > 10_000);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn disabled_restore_and_all_private_sessions_open_a_fresh_public_tab() {
        let dir = profile_dir();
        let mut state = BrowserState::new();
        state.settings.restore_session = false;
        let id = state.active_id;
        state.navigate(id, "https://example.com/".into());
        save(&dir, &state).unwrap();
        assert_eq!(load(&dir).unwrap().active_tab().unwrap().url, START_URL);
        state.settings.restore_session = true;
        state.tabs.clear();
        state.new_tab("https://secret.example/".into(), true);
        save(&dir, &state).unwrap();
        let restored = load(&dir).unwrap();
        assert_eq!(restored.tabs.len(), 1);
        assert!(!restored.tabs[0].private);
        assert_eq!(restored.tabs[0].url, START_URL);
        fs::remove_dir_all(dir).unwrap();
    }
}
