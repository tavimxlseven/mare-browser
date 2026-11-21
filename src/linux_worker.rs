// The Linux Chromium host launches these same native apps over bounded JSON lines.
mod apps;
mod audio;
mod catalog_search;
mod components;
mod covers;
mod model;
mod music;
mod music_cloud;
mod music_search;
mod music_session;
mod music_source;
mod native_app;
mod playlist;
mod portable;
mod presence;
mod protection;
mod spotify;
mod spotify_account;

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--linux-host") {
        if let Err(error) = host() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().any(|arg| arg == "--dump-interface") {
        print!("{}", interface::html());
        return;
    }
    let result = music_source::run_if_requested().or_else(native_app::run_if_requested);
    match result {
        Some(Ok(())) => (),
        Some(Err(error)) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
        None => {
            eprintln!(
                "Abra Compass Browser pelo menu de aplicativos ou pelo comando compass-browser."
            );
            std::process::exit(2);
        }
    }
}

fn host() -> Result<(), String> {
    use serde_json::{json, Value};
    use std::{
        io::{BufReader, Write},
        sync::mpsc,
        time::Duration,
    };
    enum Message {
        Request(Value),
        App(apps::AppEvent),
        End,
    }
    let directory = std::env::args_os()
        .nth(2)
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .ok_or("Perfil absoluto obrigatório.")?;
    let (tx, rx) = mpsc::sync_channel(512);
    let input = tx.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(std::io::stdin());
        while let Ok(Some(line)) = native_app::read_protocol_line(&mut reader) {
            let Ok(value) = serde_json::from_str(&line) else {
                break;
            };
            if input.send(Message::Request(value)).is_err() {
                return;
            }
        }
        let _ = input.send(Message::End);
    });
    let mut apps = apps::AppManager::new(&directory, move |event| {
        let _ = tx.send(Message::App(event));
    })?;
    let protection = protection::Protection::new();
    let mut output = std::io::stdout().lock();
    let mut send = |value: Value| -> Result<(), String> {
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        output
            .write_all(&bytes)
            .and_then(|()| output.write_all(b"\n"))
            .and_then(|()| output.flush())
            .map_err(|e| e.to_string())
    };
    send(json!({"kind":"ready","apps":apps.snapshot()}))?;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Message::End) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Ok(Message::App(event)) => {
                apps.handle_event(&event);
                send(json!({"kind":"app","event":event,"apps":apps.snapshot()}))?;
            }
            Ok(Message::Request(v)) => {
                let cmd = v["cmd"].as_str().unwrap_or("");
                let id = v["id"].as_str().unwrap_or("");
                let tab = v["tab"].as_u64().unwrap_or(0);
                let url = v["url"].as_str().unwrap_or("");
                let result: Result<Value, String> = match cmd {
                    "apps_install" => apps.install(id).map(|()| apps.snapshot()),
                    "apps_uninstall" => apps.uninstall(id).map(|()| apps.snapshot()),
                    "apps_open" => apps.start(id).map(|()| apps.snapshot()),
                    "apps_close" => {
                        apps.close(id);
                        Ok(apps.snapshot())
                    }
                    "apps_background" => {
                        apps.deactivate();
                        Ok(apps.snapshot())
                    }
                    "apps_request" => apps
                        .request_with_id(
                            id,
                            v["request_id"].as_u64().unwrap_or(0),
                            v["method"].as_str().unwrap_or(""),
                            v["params"].clone(),
                        )
                        .map(|()| Value::Null),
                    "filter_configure" => {
                        let exceptions: Vec<String> =
                            serde_json::from_value(v["exceptions"].clone()).unwrap_or_default();
                        protection.configure(v["enabled"] == true, &exceptions);
                        Ok(Value::Null)
                    }
                    "filter_begin" => {
                        protection.begin_navigation(tab, url);
                        protection.attach_linux(tab);
                        Ok(Value::Null)
                    }
                    "filter_close" => {
                        protection.remove_tab(tab);
                        Ok(Value::Null)
                    }
                    "filter" => Ok(
                        json!({"cancel":protection.check_linux(tab,url,v["type"].as_str().unwrap_or("other"),v["method"].as_str().unwrap_or("GET"),v["referer"].as_str().unwrap_or(""))}),
                    ),
                    "filter_snapshot" => Ok(json!(protection.snapshot(tab, url))),
                    "filter_cosmetics" => {
                        let classes: Vec<String> =
                            serde_json::from_value(v["classes"].clone()).unwrap_or_default();
                        let ids: Vec<String> =
                            serde_json::from_value(v["ids"].clone()).unwrap_or_default();
                        Ok(json!(protection.cosmetics_script(tab, url, &classes, &ids)))
                    }
                    _ => Err("Comando de host desconhecido.".into()),
                };
                send(match result {
                    Ok(value) => json!({"seq":v["seq"],"result":value}),
                    Err(error) => json!({"seq":v["seq"],"error":error}),
                })?;
            }
        }
    }
    apps.shutdown();
    Ok(())
}
