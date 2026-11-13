#[path = "src/icon_ico.rs"]
mod icon_ico;
#[path = "src/icon_pixels.rs"]
mod icon_pixels;
fn main() {
    println!("cargo:rerun-if-changed=src/icon_pixels.rs");
    println!("cargo:rerun-if-changed=assets/compass-256.rgba");
    println!("cargo:rerun-if-changed=src/icon_ico.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let ico = icon_ico::encode();
    let path = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("mare.ico");
    std::fs::write(&path, ico).unwrap();
    winresource::WindowsResource::new()
        .set_icon(path.to_str().unwrap())
        .set("FileDescription", "Compass Browser")
        .set("ProductName", "Compass Browser")
        .set("OriginalFilename", "Mare.exe")
        .compile()
        .expect("Windows icon/resource compilation");
}
