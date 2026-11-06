/// Original compass icon, drawn locally without Apple's application assets.
pub fn window_icon() -> Option<tao::window::Icon> {
    let size = 64;
    let mut pixels = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - 31.5;
            let dy = y as f64 - 31.5;
            let r = dx.hypot(dy);
            let mut color = if r < 30.5 {
                [28, 121, 220, 255]
            } else {
                [0, 0, 0, 0]
            };
            if (27.0..29.5).contains(&r) {
                color = [229, 244, 255, 255];
            }
            if r < 24.0
                && ((dx.abs() < 0.8 && dy.abs() > 20.0) || (dy.abs() < 0.8 && dx.abs() > 20.0))
            {
                color = [231, 244, 255, 255];
            }
            let across = (dx + dy).abs();
            let along = (dx - dy) / std::f64::consts::SQRT_2;
            if along.abs() < 23.0 && across < (23.0 - along.abs()) * 0.42 {
                color = if along > 0.0 {
                    [255, 100, 107, 255]
                } else {
                    [239, 248, 255, 255]
                };
            }
            if r < 2.1 {
                color = [248, 251, 255, 255];
            }
            pixels.extend_from_slice(&color);
        }
    }
    tao::window::Icon::from_rgba(pixels, size as u32, size as u32).ok()
}
