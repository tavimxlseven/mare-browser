//! Audio-first selection around original metadata and downloader executables.
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

fn normalized(text: &str) -> String {
    text.nfkd()
        .filter(|c| !is_combining_mark(*c) && !['\'', '’', 'ʼ'].contains(c))
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn contains(text: &str, words: &str) -> bool {
    if words
        .chars()
        .any(|c| ('\u{3040}'..='\u{9fff}').contains(&c))
    {
        return text.contains(words);
    }
    format!(" {text} ").contains(&format!(" {words} "))
}

fn search_title(title: &str) -> String {
    let mut value = title.to_lowercase();
    if let Some((base, suffix)) = value.rsplit_once(" - ") {
        if suffix.contains("remaster")
            || suffix.starts_with("with ")
            || suffix.contains("director's edit")
        {
            value = base.to_string();
        }
    }
    if value.contains("bzrp music sessions") {
        value = value
            .replace("vol. ", "")
            .replace("vol ", "")
            .replace('#', "");
        if let Some((base, suffix)) = value.rsplit_once('/') {
            if suffix.chars().all(|c| c.is_ascii_digit()) {
                value = base.into();
            }
        }
    }
    value
}
pub fn select<'a>(
    entries: &'a [Value],
    title: &str,
    artists: &str,
    duration: f64,
) -> Option<&'a Value> {
    choose(entries, title, artists, duration, false, false)
}

fn choose<'a>(
    entries: &'a [Value],
    title: &str,
    artists: &str,
    duration: f64,
    fallback: bool,
    alias: bool,
) -> Option<&'a Value> {
    let cleaned = search_title(title);
    let base = cleaned.split('(').next().unwrap_or(&cleaned).trim();
    let expected = normalized(if base.is_empty() { &cleaned } else { base });
    let credits = artists
        .split([',', '&'])
        .map(normalized)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let id = entry["id"].as_str()?;
            crate::music_search::video_id(&format!("youtube:video:{id}"))?;
            if entry["is_live"].as_bool() == Some(true) {
                return None;
            }
            let name = normalized(&search_title(entry["title"].as_str().unwrap_or("")));
            let channel = normalized(
                entry["uploader"]
                    .as_str()
                    .or(entry["channel"].as_str())
                    .unwrap_or(""),
            );
            if expected.is_empty()
                || !contains(&name, &expected)
                || (!alias
                    && !credits.is_empty()
                    && !credits
                        .iter()
                        .any(|artist| contains(&name, artist) || contains(&channel, artist)))
            {
                return None;
            }
            for marker in [
                "official video",
                "music video",
                "video oficial",
                "videoclipe",
                "live",
                "cover",
                "remix",
                "slowed",
                "sped up",
                "karaoke",
                "instrumental",
                "432hz",
                "432 hz",
                "nightcore",
                "best part",
            ] {
                if contains(&name, marker)
                    && !contains(&normalized(title), marker)
                    && !(fallback
                        && [
                            "official video",
                            "music video",
                            "video oficial",
                            "videoclipe",
                        ]
                        .contains(&marker))
                {
                    return None;
                }
            }
            let actual = entry["duration"].as_f64().unwrap_or(0.0);
            let difference = (actual - duration).abs();
            let tolerance = if alias {
                if expected.split_whitespace().count() >= 4 {
                    5.0
                } else {
                    3.0
                }
            } else if fallback {
                45.0_f64.max(duration * 0.2)
            } else {
                12.0_f64.max(duration * 0.06)
            };
            if alias && (duration <= 0.0 || expected.split_whitespace().count() < 2) {
                return None;
            }
            if duration > 0.0 && (actual <= 0.0 || difference > tolerance) {
                return None;
            }
            if fallback {
                return Some((entry, -(index as f64)));
            }
            let rank = if name.contains("official audio") {
                100.0
            } else if ["lyric", "letra", "歌詞", "字幕"]
                .iter()
                .any(|m| name.contains(m))
            {
                90.0
            } else if channel.ends_with("topic") || name.contains("visualizer") {
                85.0
            } else if name.contains("audio") {
                75.0
            } else {
                return None;
            };
            Some((entry, rank - difference.min(60.0)))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(entry, _)| entry)
}

fn emit(event: Value) {
    println!("{event}");
}

fn run(url: &str, folder: &Path, runtime: &Path, cached: Option<&Path>) -> Result<(), String> {
    crate::spotify::normalize_link(url)?;
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    use std::os::windows::process::CommandExt;
    let metadata: Value = if let Some(path) = cached {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 2_000_000 {
            return Err("Metadados excedem o limite.".into());
        }
        let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "Metadados inválidos.")?;
        if value["type"] == "track"
            && value["id"].as_str() != url.trim_end_matches('/').split('/').next_back()
        {
            return Err("Identidade da faixa inválida.".into());
        }
        value
    } else {
        let metadata_cli =
            crate::components::executable("sunnify").ok_or("Componente de metadados ausente.")?;
        let mut metadata_command = Command::new(metadata_cli);
        metadata_command
            .args(["info", url, "--json"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08004000);
        let output = metadata_command.output().map_err(|e| e.to_string())?;
        if !output.status.success() || output.stdout.len() > 5_000_000 {
            return Err("Não foi possível ler as músicas do Spotify.".into());
        }
        let value: Value =
            serde_json::from_slice(&output.stdout).map_err(|_| "Metadados inválidos.")?;
        value
    };
    let tracks = if metadata["type"] == "track" {
        vec![metadata]
    } else {
        metadata["tracks"]
            .as_array()
            .ok_or("Playlist indisponível.")?
            .clone()
    };
    if tracks.is_empty() || tracks.len() > 2000 {
        return Err("A playlist precisa ter entre 1 e 2000 faixas.".into());
    }
    emit(json!({"event":"run_started","total_tracks":tracks.len(),"policy":"audio-first"}));
    let mut seen = std::collections::HashSet::new();
    let pending = std::sync::Mutex::new(std::collections::VecDeque::from(
        tracks
            .into_iter()
            .filter(|t| seen.insert(t["id"].clone().to_string()))
            .collect::<Vec<_>>(),
    ));
    let stats = std::sync::Mutex::new((0u64, 0u64, 0u64));
    std::thread::scope(|scope| {
        for _ in 0..2 {
            scope.spawn(|| loop {
                let track = pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .pop_front();
                let Some(track) = track else { break };
                let result = download_one(track, folder, runtime);
                let mut counts = stats.lock().unwrap_or_else(|e| e.into_inner());
                counts.0 += result.0;
                counts.1 += result.1;
                counts.2 += result.2;
            });
        }
    });
    let (landed, skipped, failed) = stats.into_inner().unwrap_or_else(|e| e.into_inner());
    emit(json!({"event":"run_summary","landed":landed,"skipped":skipped,"failed":failed}));
    if failed > 0 {
        return Err("Algumas faixas não possuem uma fonte de áudio compatível.".into());
    }
    Ok(())
}

fn download_one(track: Value, folder: &Path, runtime: &Path) -> (u64, u64, u64) {
    let (mut landed, mut skipped, mut failed) = (0, 0, 0);
    for track in [track] {
        let identifier = track["id"].as_str().unwrap_or("");
        if crate::spotify::normalize_link(&format!("spotify:track:{identifier}")).is_err() {
            failed += 1;
            continue;
        }
        let title = track["title"].as_str().unwrap_or("");
        let artists = track["artists"].as_str().unwrap_or("");
        let path = folder.join(format!("{identifier}.m4a"));
        if path.is_file() && path.metadata().is_ok_and(|m| m.len() > 0) {
            skipped += 1;
            emit(
                json!({"event":"track_skipped","file":path,"title":title,"artists":artists,"spotify_id":identifier}),
            );
            continue;
        }
        emit(json!({"event":"matching","title":title,"artists":artists,"policy":"audio-first"}));
        let result = (|| -> Result<(), String> {
            let mut selected = None;
            let mut candidates = Vec::new();
            let duration = track["duration_ms"].as_f64().unwrap_or(0.0) / 1000.0;
            let native = title
                .chars()
                .chain(artists.chars())
                .any(|c| ('\u{3040}'..='\u{9fff}').contains(&c));
            let hints: &[&str] = if native {
                &["歌詞 フル", "official audio", "lyrics"]
            } else {
                &["lyrics", "official audio"]
            };
            for hint in hints {
                let primary = artists.split([',', '&']).next().unwrap_or(artists).trim();
                let query = format!("ytsearch12:{primary} {} {hint}", search_title(title));
                let search = crate::music_search::command(runtime)?
                    .args([
                        "--flat-playlist",
                        "--dump-single-json",
                        "--skip-download",
                        &query,
                    ])
                    .stdin(Stdio::null())
                    .stderr(Stdio::null())
                    .output()
                    .map_err(|e| e.to_string())?;
                if !search.status.success() || search.stdout.len() > 2_000_000 {
                    continue;
                }
                let data: Value =
                    serde_json::from_slice(&search.stdout).map_err(|_| "Busca inválida.")?;
                let entries = data["entries"].as_array().map(Vec::as_slice).unwrap_or(&[]);
                candidates.extend_from_slice(entries);
                if let Some(item) = select(entries, title, artists, duration) {
                    selected = item["id"].as_str().map(String::from);
                    break;
                }
            }
            if selected.is_none() {
                let query = format!("ytsearch12:{}", search_title(title));
                let output = crate::music_search::command(runtime)?
                    .args([
                        "--flat-playlist",
                        "--dump-single-json",
                        "--skip-download",
                        &query,
                    ])
                    .stdin(Stdio::null())
                    .stderr(Stdio::null())
                    .output()
                    .map_err(|e| e.to_string())?;
                if output.status.success() && output.stdout.len() < 2_000_000 {
                    if let Ok(result) = serde_json::from_slice::<Value>(&output.stdout) {
                        let entries = result["entries"]
                            .as_array()
                            .map(Vec::as_slice)
                            .unwrap_or(&[]);
                        selected = choose(entries, title, artists, duration, true, false)
                            .or_else(|| choose(&candidates, title, artists, duration, true, false))
                            .or_else(|| choose(entries, title, artists, duration, true, true))
                            .and_then(|entry| entry["id"].as_str())
                            .map(String::from);
                    }
                }
            }
            let video =
                selected.ok_or("Nenhuma versão de áudio ou lyrics compatível foi encontrada.")?;
            let mut command = crate::music_search::command(runtime)?;
            command.args(["--no-playlist","--no-simulate","--no-mtime","--newline","--progress","--progress-delta","1","--output-na-placeholder","null",
                "--progress-template",r#"download:{"event":"transfer","received":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes)j}"#,
                "--format","bestaudio[ext=m4a]/bestaudio[ext=mp4]","--output"]).arg(&path)
                .arg(format!("https://www.youtube.com/watch?v={video}")).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Ok(event) = serde_json::from_str::<Value>(&line) {
                        if event["event"] == "transfer" {
                            emit(event);
                        }
                    }
                }
            }
            if !child.wait().map_err(|e| e.to_string())?.success()
                || !path.is_file()
                || path.metadata().map_err(|e| e.to_string())?.len() == 0
            {
                return Err("A fonte de áudio não concluiu esta faixa.".into());
            }
            Ok(())
        })();
        if let Err(error) = result {
            failed += 1;
            emit(json!({"event":"warning","message":error,"title":title}));
        } else {
            landed += 1;
            emit(
                json!({"event":"track_done","file":path,"title":title,"artists":artists,"spotify_id":identifier}),
            );
        }
    }
    (landed, skipped, failed)
}

pub fn run_if_requested() -> Option<Result<(), String>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("--music-source-worker") {
        return None;
    }
    Some(if args.len() == 5 || args.len() == 6 {
        run(
            &args[2],
            Path::new(&args[3]),
            Path::new(&args[4]),
            args.get(5).map(Path::new),
        )
    } else {
        Err("Argumentos de download inválidos.".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_keep_original_identity_and_allow_only_small_upload_padding() {
        let item = json!({"id":"AAAAAAAAAAA","title":"Singer - Meet Me in the Pale Moonlight","duration":207});
        assert!(choose(
            std::slice::from_ref(&item),
            "Meet Me in the Pale Moonlight",
            "Distributor",
            202.536,
            true,
            false
        )
        .is_none());
        assert!(choose(
            std::slice::from_ref(&item),
            "Meet Me in the Pale Moonlight",
            "Distributor",
            202.536,
            true,
            true
        )
        .is_some());
        assert!(choose(
            &[item],
            "Meet Me in the Pale Moonlight",
            "Distributor",
            180.0,
            true,
            true
        )
        .is_none());
    }
    #[test]
    fn japanese_subtitles_are_recognized_without_word_spaces() {
        let item = json!({"id":"AAAAAAAAAAA","title":"7!!『ラヴァーズ』中日字幕","duration":222});
        assert_eq!(
            select(&[item], "ラヴァーズ", "7!!", 222.0).unwrap()["id"],
            "AAAAAAAAAAA"
        );
    }
    #[test]
    fn prefers_audio_and_rejects_videos_wrong_artists_and_duration() {
        let candidates = json!([
            {"id":"AAAAAAAAAAA","title":"Artist - Song (Official Music Video)","duration":200},
            {"id":"BBBBBBBBBBB","title":"Other Artist - Song (Lyrics)","uploader":"Other","duration":200},
            {"id":"CCCCCCCCCCC","title":"Artist - Song (Lyrics)","duration":200},
            {"id":"DDDDDDDDDDD","title":"Artist - Song (Official Audio)","duration":201},
            {"id":"EEEEEEEEEEE","title":"Artist - Song (Lyrics)","duration":400}
        ]);
        assert_eq!(
            select(candidates.as_array().unwrap(), "Song", "Artist", 200.0).unwrap()["id"],
            "DDDDDDDDDDD"
        );
        assert!(select(
            &[json!({"id":"AAAAAAAAAAA","title":"Artist - Song Official Video","duration":200})],
            "Song",
            "Artist",
            200.0
        )
        .is_none());
    }
}
