// The Linux Chromium host launches these same native apps over bounded JSON lines.
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
mod spotify;
mod spotify_account;

fn main() {
    if std::env::args().any(|arg| arg == "--dump-interface") {
        print!("{}", interface::html());
        return;
    }
    let result = music_source::run_if_requested().or_else(native_app::run_if_requested);
    match result {
        Some(Ok(())) => (),
        Some(Err(error)) => { eprintln!("{error}"); std::process::exit(1); }
        None => { eprintln!("Abra Compass Browser pelo menu de aplicativos ou pelo comando compass-browser."); std::process::exit(2); }
    }
}
