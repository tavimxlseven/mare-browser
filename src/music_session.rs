//! Bounded local playback preferences; no credentials or autoplay.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub volume: u32,
    pub track_id: Option<u64>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub ui: Value,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            volume: 80,
            track_id: None,
            position_ms: 0,
            duration_ms: 0,
            ui: json!({}),
        }
    }
}
pub fn validate_ui(value: &Value) -> Result<Value, String> {
    let ids = |name: &str| -> Result<Vec<u64>, String> {
        let array = value[name].as_array().ok_or("Fila inválida.")?;
        if array.len() > 2000 {
            return Err("Fila muito extensa.".into());
        }
        array
            .iter()
            .map(|v| {
                v.as_u64()
                    .filter(|n| *n > 0)
                    .ok_or_else(|| "Faixa inválida.".into())
            })
            .collect()
    };
    let order = ids("order")?;
    let original = ids("original")?;
    let position = value["position"]
        .as_i64()
        .filter(|p| *p >= -1 && *p < order.len() as i64)
        .ok_or("Posição da fila inválida.")?;
    let repeat = value["repeat"]
        .as_str()
        .filter(|v| matches!(*v, "off" | "all" | "one"))
        .ok_or("Repetição inválida.")?;
    let filter = value["filter"].as_str().unwrap_or("all");
    if !matches!(
        filter,
        "all" | "playlists" | "playlist" | "downloaded" | "favorites"
    ) && filter.parse::<u64>().is_err()
    {
        return Err("Biblioteca inválida.".into());
    }
    let playlist = match value["playlist"].as_str() {
        Some(uri) => Some(
            crate::spotify::normalize_link(uri)
                .ok()
                .filter(|(_, _, kind)| matches!(kind.as_str(), "playlist" | "album"))
                .ok_or("Playlist inválida.")?
                .0,
        ),
        None => None,
    };
    Ok(
        json!({"order":order,"original":original,"position":position,"repeat":repeat,"shuffled":value["shuffled"]==true,"filter":filter,"playlist":playlist}),
    )
}
impl Session {
    pub fn load(directory: &Path) -> Self {
        let mut session: Self = fs::read(directory.join("playback-session.json"))
            .ok()
            .filter(|bytes| bytes.len() <= 131072)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        session.volume = session.volume.min(100);
        session.duration_ms = session.duration_ms.min(86_400_000);
        session.position_ms = session.position_ms.min(session.duration_ms);
        session.ui = validate_ui(&session.ui).unwrap_or_else(|_| json!({}));
        session
    }
    pub fn save(&self, directory: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() > 131072 {
            return Err("Sessão de música muito extensa.".into());
        }
        let path = directory.join("playback-session.json");
        let temp = path.with_extension("tmp");
        fs::write(&temp, bytes)
            .and_then(|()| fs::rename(temp, path))
            .map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_is_bounded_and_keeps_only_playback_fields() {
        let input = json!({"order":[1,2],"original":[2,1],"position":0,"repeat":"all","shuffled":true,"filter":"downloaded","playlist":null,"token":"discard","path":"discard"});
        let clean = validate_ui(&input).unwrap();
        assert!(clean.get("token").is_none());
        assert!(clean.get("path").is_none());
        let mut invalid = input.clone();
        invalid["order"] = json!(["file:///x"]);
        assert!(validate_ui(&invalid).is_err());
        invalid = input.clone();
        invalid["position"] = json!(9);
        assert!(validate_ui(&invalid).is_err());
        invalid = input.clone();
        invalid["order"] = json!(vec![1; 2001]);
        assert!(validate_ui(&invalid).is_err());
        let dir = std::env::temp_dir().join(format!("mare-session-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        Session {
            volume: 23,
            track_id: Some(2),
            position_ms: 12000,
            duration_ms: 90000,
            ui: clean.clone(),
        }
        .save(&dir)
        .unwrap();
        let saved = Session::load(&dir);
        assert_eq!(saved.volume, 23);
        assert_eq!(saved.position_ms, 12000);
        assert_eq!(saved.ui, clean);
        fs::remove_file(dir.join("playback-session.json")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
