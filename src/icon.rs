/// Original compass shared with the executable resource.
pub fn window_icon() -> Option<tao::window::Icon> {
    tao::window::Icon::from_rgba(crate::icon_pixels::rgba(64), 64, 64).ok()
}
