#[path = "../src/icon_ico.rs"]
mod icon_ico;
#[path = "../src/icon_pixels.rs"]
mod icon_pixels;
fn main() -> std::io::Result<()> {
    let destination = std::env::args_os()
        .nth(1)
        .expect("expected ICO destination");
    std::fs::write(destination, icon_ico::encode())
}
