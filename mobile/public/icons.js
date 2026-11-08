"use strict";
const iconPaths = {
  music:
    '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  library: '<path d="M4 4v16M9 4v16M15 4l5 15M3 20h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  cloud:
    '<path d="M6 18a5 5 0 0 1-1-9 7 7 0 0 1 13-1 5 5 0 0 1 0 10M12 12v9m-3-3 3 3 3-3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  chevron: '<path d="m7 9 5 5 5-5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path class="solid" d="m8 5 11 7-11 7Z"/>',
  pause: '<path class="solid" d="M7 5h3v14H7zm7 0h3v14h-3Z"/>',
  next: '<path class="solid" d="m5 5 10 7-10 7zm12 0h2v14h-2Z"/>',
  previous: '<path class="solid" d="m19 5-10 7 10 7zM5 5h2v14H5Z"/>',
  heart:
    '<path d="M20 5c-3-3-6-1-8 1C10 4 7 2 4 5s-1 6 1 8l7 7 7-7c2-2 4-5 1-8Z"/>',
  shuffle:
    '<path d="M3 6h3c4 0 7 12 11 12h4M17 14l4 4-4 4M3 18h3c1.5 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"/>',
  repeat:
    '<path d="M4 11V8a3 3 0 0 1 3-3h13l-4-4m4 4-4 4M20 13v3a3 3 0 0 1-3 3H4l4-4m-4 4 4 4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="m9 7 3-3a5 5 0 0 1 7 7l-3 3M8 10l-3 3a5 5 0 0 0 7 7l3-3M8 16l8-8"/>',
  playlist:
    '<path d="M4 5h12M4 10h12M4 15h6M17 12v7"/><ellipse cx="14.5" cy="19.5" rx="2.5" ry="2"/>',
  share: '<path d="M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  retry: '<path d="M20 8A8 8 0 1 0 20 16M20 3v5h-5"/>',
};
function icon(name) {
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    (iconPaths[name] || iconPaths.music) +
    "</svg>"
  );
}
function applyIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]"))
    el.innerHTML = icon(el.dataset.icon);
}
applyIcons();
