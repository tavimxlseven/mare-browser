pub fn html() -> String {
    fn inline_section(html: &mut String, name: &str, content: &str) {
        let start = format!("<!-- MARE_{name}_START -->");
        let end = format!("<!-- MARE_{name}_END -->");
        let first = html.find(&start).expect("embedded UI start marker") + start.len();
        let last = first + html[first..].find(&end).expect("embedded UI end marker");
        html.replace_range(first..last, content);
    }
    let mut html = include_str!("../ui/index.html").to_owned();
    inline_section(
        &mut html,
        "STYLES",
        &format!(
            "<style>{}</style><style>{}</style><style>{}</style><style>{}</style>",
            include_str!("../ui/styles.css"),
            include_str!("../ui/spotify.css"),
            include_str!("../mobile/public/music-polish.css"),
            include_str!("../ui/browser-tools.css")
        ),
    );
    inline_section(
        &mut html,
        "SCRIPTS",
        &format!(
            "<script>{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}</script>",
            include_str!("../mobile/public/sortable.js"),
            include_str!("../mobile/public/devices-ui.js"),
            include_str!("../ui/music-queue.js"),
            include_str!("../ui/music-layout.js"),
            include_str!("../ui/music-tools.js"),
            include_str!("../ui/music-streaming.js"),
            include_str!("../ui/music-listening.js"),
            include_str!("../ui/spotify.js"),
            include_str!("../ui/browser-tools.js"),
            include_str!("../ui/icons.js"),
            include_str!("../ui/app.js")
        ),
    );
    html.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https: http:; connect-src 'none'; media-src https:; base-uri 'none'; form-action 'none'\">")
}
