(() => {
  "use strict";
  const paths = {
    play: '<path d="M7 4.5v15l12-7.5Z" fill="currentColor" stroke="none"/>',
    pause:
      '<rect x="6" y="4" width="4" height="16" rx="1.5" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.5" fill="currentColor" stroke="none"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="2"/><path d="m4 18 5-5 4 3 3-5 5 7"/>',
    sidebar:
      '<rect x="2.5" y="4" width="19" height="16" rx="3.6"/><path d="M6 4h3v16H6q-3.5 0-3.5-3.5v-9Q2.5 4 6 4Z" fill="currentColor" opacity=".24" stroke="none"/><path d="M9 4.5v15"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    forward: '<path d="m9 5 7 7-7 7"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    reload: '<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    download:
      '<circle cx="12" cy="12" r="9.1" fill="currentColor" fill-opacity=".09"/><path d="M12 6.7v9.4m-4-4 4 4 4-4" stroke-width="1.95"/>',
    share:
      '<path d="M7.9 9H6.5A2.5 2.5 0 0 0 4 11.5v7A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 17.5 9h-1.4" fill="currentColor" fill-opacity=".08"/><path d="M12 14.7V2.6m-3.7 3.8L12 2.6l3.7 3.8"/>',
    overview:
      '<path d="M4.8 16.5h-.6a2 2 0 0 1-2-2V5.8a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v.6"/><rect x="7" y="8" width="14.5" height="12.7" rx="3" fill="currentColor" fill-opacity=".12"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    compass:
      '<circle cx="12" cy="12" r="9"/><path d="m4.8 19.2 6.2-8.3 8.2-6.1-6.1 8.2Z" fill="#eaf8ff" stroke="none"/><path d="m4.8 19.2 6.2-8.3 2.1 2.1Z" fill="#ff7b29" stroke="none"/>',
    noise:
      '<path d="M4 12V11a8 8 0 0 1 16 0v1" stroke="#ad9adc"/><path d="M6 12H5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1Z" stroke="#f64d97"/><path d="M18 12h1a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-1Z" stroke="#45d8e8"/><path d="M8 15h1l1-2 2 5 2-7 1 4h1" stroke="#ad9adc"/>',
    home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-7h6v7"/>',
    book: '<path d="M12 6C8 3 4 4 2.5 5v14c3-1.5 6-1.5 9.5 1 3.5-2.5 6.5-2.5 9.5-1V5c-1.5-1-5.5-2-9.5 1Zm0 0v14"/>',
    glasses:
      '<circle cx="6.5" cy="14.5" r="4.5"/><circle cx="17.5" cy="14.5" r="4.5"/><path d="M11 14c.7-.7 1.3-.7 2 0M2 14l2-9h3m15 9-2-9h-3"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v6l4 2"/>',
    settings:
      '<path d="m9 3-.7 2.4-2 .9L4 5.5 2 9l1.8 1.6v2.8L2 15l2 3.5 2.3-.8 2 .9L9 21h4l.7-2.4 2-.9 2.3.8 2-3.5-1.8-1.6v-2.8L20 9l-2-3.5-2.3.8-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    private:
      '<path d="M3 9h18l-2 9-5-2-2-3-2 3-5 2-2-9Z"/><path d="M6 12h3m6 0h3M6 9l2-5h8l2 5"/>',
    sliders:
      '<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9L12 3Z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
    printer:
      '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7Z"/><path d="M17 10h1"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    folder:
      '<path d="M2.5 7.2a2 2 0 0 1 2-2h4.2c1.6 0 1.9 2.4 3.7 2.4h6.7a2.3 2.3 0 0 1 2.4 2.3v7.8a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5Z" fill="currentColor" fill-opacity=".16"/><path d="M3 10h18"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    pin: '<path d="m15 3 6 6-4 1-4 6-2-2-6 6m6-6-3-3 6-4 1-4Z"/>',
    tab: '<path d="M3 8V5h7l2 3h9v12H3V8Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-5 2 2-16"/>',
    performance:
      '<rect x="2.4" y="4.4" width="19.2" height="15.2" rx="4" fill="currentColor" fill-opacity=".09"/><path d="M5.4 13h3l2.4-5.1 3 8 2.1-4h2.8" stroke-width="1.85"/>',
    extension:
      '<path d="M4 8a2 2 0 0 1 2-2h3.2a2.8 2.8 0 1 1 5.5 0H18a2 2 0 0 1 2 2v3.1a2.8 2.8 0 1 0 0 5.4V19a2 2 0 0 1-2 2h-3.2a2.8 2.8 0 1 0-5.6 0H6a2 2 0 0 1-2-2Z" fill="currentColor" fill-opacity=".13"/>',
    shield:
      '<path d="M12 2.3c2.2 1.7 5.3 2.8 8 3v6.3c0 4.5-3.1 8.1-8 10.1-4.9-2-8-5.6-8-10.1V5.3c2.7-.2 5.8-1.3 8-3Z" fill="currentColor" fill-opacity=".18"/><path d="M6.4 13.4c2.4.2 3.3-3.2 5.5-3.2 1.5 0 2 1.6 3.5 1.6.7 0 1.4-.3 2.1-.9" stroke-width="2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    zoom: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8M10 6v8"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    reader: '<path d="M5 4h14M5 8h14M5 12h14M5 16h10M5 20h10"/>',
    apps: '<g fill="currentColor" stroke="none"><rect x="2.8" y="3.8" width="7.8" height="7.8" rx="2.4"/><rect x="13.3" y="3" width="7.2" height="7.2" rx="2.2" transform="rotate(13 16.9 6.6)" opacity=".68"/><rect x="2.8" y="14.2" width="7.8" height="7.8" rx="2.4" opacity=".68"/><rect x="13.1" y="14.2" width="7.8" height="7.8" rx="2.4"/></g>',
    notes:
      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    calculator:
      '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
    music:
      '<path d="M9 17.8V6l10.5-2v11.7"/><path d="m9 6 10.5-2v3.5L9 9.5Z" fill="currentColor" stroke="none"/><g fill="currentColor" stroke="none"><ellipse cx="6.2" cy="18" rx="3.7" ry="2.9" transform="rotate(-18 6.2 18)"/><ellipse cx="16.6" cy="16" rx="3.7" ry="2.9" transform="rotate(-18 16.6 16)"/></g>',
    spotify:
      '<circle cx="12" cy="12" r="11" fill="#1ed760" stroke="none"/><g stroke="#092317" stroke-width="1.7"><path d="M5.6 9.2c4.6-1.4 8.6-1 12.8 1.1M6.6 12.3c3.8-1.1 7.2-.8 10.8 1M7.7 15.2c3-.8 5.7-.5 8.6.8"/></g>',
    discord:
      '<path d="M7 4.5 9 4l.6 1.3a17 17 0 0 1 4.8 0L15 4l2 .5c2.4 3.2 3.6 7.2 3.8 11.4-1.7 1.4-3.5 2.2-5.4 2.6L14.3 17a13 13 0 0 0 2.1-1.1 13 13 0 0 1-8.8 0L9.7 17l-1.1 1.5a16 16 0 0 1-5.4-2.6C3.4 11.7 4.6 7.7 7 4.5Z" fill="#8993ff" stroke="none"/><ellipse cx="8.6" cy="11.8" rx="1.5" ry="1.8" fill="#202441" stroke="none"/><ellipse cx="15.4" cy="11.8" rx="1.5" ry="1.8" fill="#202441" stroke="none"/>',
  };
  window.compassIcon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.globe}</svg>`;
})();
