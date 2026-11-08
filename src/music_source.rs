//! Audio-first selection around original metadata and downloader executables.
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
};

fn normalized(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn contains(text: &str, words: &str) -> bool {
    format!(" {text} ").contains(&format!(" {words} "))
}

pub fn select<'a>(
    entries: &'a [Value],
    title: &str,
    artists: &str,
    duration: f64,
) -> Option<&'a Value> {
    let expected = normalized(title.split('(').next().unwrap_or(title));
    let artist = normalized(artists.split([',', '&']).next().unwrap_or(artists));
    entries
        .iter()
        .filter_map(|entry| {
            let id = entry["id"].as_str()?;
            crate::music_search::video_id(&format!("youtube:video:{id}"))?;
            if entry["is_live"].as_bool() == Some(true) {
                return None;
            }
            let name = normalized(entry["title"].as_str().unwrap_or(""));
            let channel = normalized(
                entry["uploader"]
                    .as_str()
                    .or(entry["channel"].as_str())
                    .unwrap_or(""),
            );
            if expected.is_empty()
                || !contains(&name, &expected)
                || (!artist.is_empty() && !name.contains(&artist) && !channel.contains(&artist))
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
            ] {
                if contains(&name, marker) && !contains(&normalized(title), marker) {
                    return None;
                }
            }
            let actual = entry["duration"].as_f64().unwrap_or(0.0);
            let difference = (actual - duration).abs();
            if duration > 0.0 && (actual <= 0.0 || difference > 12.0_f64.max(duration * 0.06)) {
                return None;
            }
            let rank = if name.contains("official audio") {
                100.0
            } else if name.contains("lyric") || name.contains("letra") {
                90.0
            } else if channel.ends_with("topic") {
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

fn run(url: &str, folder: &Path, runtime: &Path) -> Result<(), String> {
    crate::spotify::normalize_link(url)?;
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let metadata_cli =
        crate::components::executable("sunnify").ok_or("Componente de metadados ausente.")?;
    let mut metadata_command = Command::new(metadata_cli);
    use std::os::windows::process::CommandExt;
    metadata_command
        .args(["info", url, "--json"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08004000);
    let output = metadata_command.output().map_err(|e| e.to_string())?;
    if !output.status.success() || output.stdout.len() > 5_000_000 {
        return Err("Não foi possível ler as músicas do Spotify.".into());
    }
    let metadata: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "Metadados inválidos.")?;
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
    let (mut landed, mut skipped, mut failed) = (0, 0, 0);
    for track in tracks {
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
            for hint in ["lyrics", "official audio"] {
                let query = format!("ytsearch8:{artists} {title} {hint}");
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
                if let Some(item) = select(
                    data["entries"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                    title,
                    artists,
                    track["duration_ms"].as_f64().unwrap_or(0.0) / 1000.0,
                ) {
                    selected = item["id"].as_str().map(String::from);
                    break;
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
    emit(json!({"event":"run_summary","landed":landed,"skipped":skipped,"failed":failed}));
    if failed > 0 {
        return Err("Algumas faixas não possuem uma fonte de áudio compatível.".into());
    }
    Ok(())
}

pub fn run_if_requested() -> Option<Result<(), String>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("--music-source-worker") {
        return None;
    }
    Some(if args.len() == 5 {
        run(&args[2], Path::new(&args[3]), Path::new(&args[4]))
    } else {
        Err("Argumentos de download inválidos.".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
