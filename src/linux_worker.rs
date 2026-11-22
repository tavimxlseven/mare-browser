// The desktop hosts launch native apps over bounded JSON lines.
mod apps;
mod audio;
mod catalog_search;
mod components;
mod covers;
#[cfg(target_os = "linux")]
mod extensions;
mod model;
mod music;
mod music_cloud;
#[cfg(target_os = "macos")]
mod music_remote;
mod music_search;
mod music_session;
mod music_source;
mod native_app;
mod playlist;
mod portable;
mod presence;
#[cfg(target_os = "linux")]
mod protection;
mod spotify;
mod spotify_account;

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::args().nth(1).as_deref() == Some("--prepare-extension") {
        let mut args = std::env::args_os().skip(2);
        let result = match (args.next(), args.next()) {
            (Some(directory), Some(input)) => extensions::store_id(&input.to_string_lossy())
                .and_then(|id| extensions::prepare(std::path::Path::new(&directory), &id)),
            _ => Err("O diretório e o link da extensão são obrigatórios.".into()),
        };
        match result {
            Ok(package) => println!("{}", serde_json::json!({
                "summary": package.summary,
                "id": package.id,
                    "folder": package.folder.file_name().and_then(std::ffi::OsStr::to_str),
            })),
            Err(error) => println!("{}", serde_json::json!({"error": error})),
        }
        return;
    }
    #[cfg(target_os = "linux")]
    let host_arg = "--linux-host";
    #[cfg(target_os = "macos")]
    let host_arg = "--noise-host";
    if std::env::args().nth(1).as_deref() == Some(host_arg) {
        if let Err(error) = host() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    #[cfg(target_os = "linux")]
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
            #[cfg(target_os = "macos")]
            eprintln!("Abra o Noise Music pelo Finder.");
            #[cfg(target_os = "linux")]
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
        #[cfg(target_os = "macos")]
        Remote(Value),
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
    #[cfg(target_os = "macos")]
    let remote_tx = tx.clone();
    #[cfg(target_os = "macos")]
    let mut remote = music_remote::Manager::default();
    let mut apps = apps::AppManager::new(&directory, move |event| {
        let _ = tx.send(Message::App(event));
    })?;
    #[cfg(target_os = "linux")]
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
                if !apps.handle_event(&event) {
                    continue;
                }
                #[cfg(target_os = "macos")]
                if event.app_id == "spotify" && remote.enabled() {
                    if event.kind == "exited" {
                        remote.stop();
                    } else {
                        remote.update(&event.payload["result"]);
                    }
                    send(json!({"kind":"remote_status","status":remote.status()}))?;
                }
                send(json!({"kind":"app","event":event,"apps":apps.snapshot()}))?;
            }
            #[cfg(target_os = "macos")]
            Ok(Message::Remote(value)) => {
                if remote.enabled() {
                    if value["action"] == "refresh" {
                        let _ = apps.request_with_id(
                            "spotify", 0, "playback_status", json!({"revision":remote.revision()}),
                        );
                    } else {
                        send(json!({"kind":"remote_action","value":value}))?;
                    }
                }
            }
            Ok(Message::Request(v)) => {
                let cmd = v["cmd"].as_str().unwrap_or("");
                let id = v["id"].as_str().unwrap_or("");
                #[cfg(target_os = "macos")]
                if cmd.starts_with("apps_") && id != "spotify" {
                    send(json!({"seq":v["seq"],"error":"App indisponível."}))?;
                    continue;
                }
                #[cfg(target_os = "linux")]
                let tab = v["tab"].as_u64().unwrap_or(0);
                #[cfg(target_os = "linux")]
                let url = v["url"].as_str().unwrap_or("");
                let result: Result<Value, String> = match cmd {
                    "apps_install" => apps.install(id).map(|()| apps.snapshot()),
                    #[cfg(target_os = "linux")]
                    "apps_uninstall" => apps.uninstall(id).map(|()| apps.snapshot()),
                    "apps_open" => apps.start(id).map(|()| apps.snapshot()),
                    #[cfg(target_os = "macos")]
                    "music_remote" => {
                        if v["enabled"] != true {
                            remote.stop();
                            Ok(remote.status())
                        } else if apps.snapshot()["open_ids"].as_array()
                            .is_some_and(|ids| ids.iter().any(|id| id == "spotify")) {
                            let tx = remote_tx.clone();
                            remote.start(move |value| {
                                let _ = tx.try_send(Message::Remote(value));
                            }).map(|()| {
                                let _ = apps.request_with_id("spotify", 0, "list", json!({}));
                                remote.status()
                            })
                        } else {
                            Err("Abra o Noise Music antes de ativar o controle.".into())
                        }
                    }
                    "apps_close" => {
                        #[cfg(target_os = "macos")]
                        if id == "spotify" {
                            remote.stop();
                            send(json!({"kind":"remote_status","status":remote.status()}))?;
                        }
                        apps.close(id);
                        Ok(apps.snapshot())
                    }
                    #[cfg(target_os = "linux")]
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
                    #[cfg(target_os = "linux")]
                    "filter_configure" => {
                        let exceptions: Vec<String> =
                            serde_json::from_value(v["exceptions"].clone()).unwrap_or_default();
                        protection.configure(v["enabled"] == true, &exceptions);
                        Ok(Value::Null)
                    }
                    #[cfg(target_os = "linux")]
                    "filter_begin" => {
                        protection.begin_navigation(tab, url);
                        protection.attach_linux(tab);
                        Ok(Value::Null)
                    }
                    #[cfg(target_os = "linux")]
                    "filter_close" => {
                        protection.remove_tab(tab);
                        Ok(Value::Null)
                    }
                    #[cfg(target_os = "linux")]
                    "filter" => Ok(
                        json!({"cancel":protection.check_linux(tab,url,v["type"].as_str().unwrap_or("other"),v["method"].as_str().unwrap_or("GET"),v["referer"].as_str().unwrap_or(""))}),
                    ),
                    #[cfg(target_os = "linux")]
                    "filter_snapshot" => Ok(json!(protection.snapshot(tab, url))),
                    #[cfg(target_os = "linux")]
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
