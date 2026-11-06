#[path = "src/icon_pixels.rs"]
mod icon_pixels;
fn main() {
    println!("cargo:rerun-if-changed=src/icon_pixels.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let sizes = [16usize, 32, 48, 64, 256];
    let mut images = Vec::new();
    for size in sizes {
        let pixels = icon_pixels::rgba(size);
        let mut dib = Vec::new();
        for v in [
            40u32,
            size as u32,
            (size * 2) as u32,
            0x00200001,
            0,
            (size * size * 4) as u32,
            0,
            0,
            0,
            0,
        ] {
            dib.extend(v.to_le_bytes());
        }
        for y in (0..size).rev() {
            for x in 0..size {
                let p = &pixels[(y * size + x) * 4..][..4];
                dib.extend([p[2], p[1], p[0], p[3]]);
            }
        }
        dib.resize(dib.len() + size.div_ceil(32) * 4 * size, 0);
        images.push(dib);
    }
    let mut ico = vec![0, 0, 1, 0, 5, 0];
    let mut offset = 6 + 16 * sizes.len();
    for (size, dib) in sizes.into_iter().zip(&images) {
        ico.extend([size as u8, size as u8, 0, 0, 1, 0, 32, 0]);
        ico.extend((dib.len() as u32).to_le_bytes());
        ico.extend((offset as u32).to_le_bytes());
        offset += dib.len();
    }
    for dib in images {
        ico.extend(dib);
    }
    let path = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("mare.ico");
    std::fs::write(&path, ico).unwrap();
    winresource::WindowsResource::new()
        .set_icon(path.to_str().unwrap())
        .set("FileDescription", "Maré Browser")
        .set("ProductName", "Maré Browser")
        .set("OriginalFilename", "Mare.exe")
        .compile()
        .expect("Windows icon/resource compilation");
}
