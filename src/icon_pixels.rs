//! Rasterized from assets/compass.svg by scripts/brand-icons.cjs.
pub fn rgba(size: usize) -> Vec<u8> {
    let source = include_bytes!("../assets/compass-256.rgba");
    let mut pixels = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let x0 = x * 256 / size;
            let y0 = y * 256 / size;
            let x1 = ((x + 1) * 256 / size).max(x0 + 1).min(256);
            let y1 = ((y + 1) * 256 / size).max(y0 + 1).min(256);
            let mut sum = [0u32; 4];
            for row in y0..y1 {
                for col in x0..x1 {
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += source[(row * 256 + col) * 4 + channel] as u32;
                    }
                }
            }
            let count = ((x1 - x0) * (y1 - y0)) as u32;
            pixels.extend(sum.map(|value| (value / count) as u8));
        }
    }
    pixels
}
