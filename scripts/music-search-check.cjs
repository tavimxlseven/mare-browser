const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const root = {};
vm.runInNewContext(fs.readFileSync("ui/music-tools.js", "utf8"), {
  window: root, setTimeout, clearTimeout,
});
const nodes = new Map();
for (const key of [".spotify-search", ".music-heading", ".music-list-heading", ".spotify-library"])
  nodes.set(key, { innerHTML: "", classList: { remove() {} }, setAttribute() {} });
const element = {
  querySelector: (selector) => nodes.get(selector) || null,
  addEventListener() {}, removeEventListener() {},
};
const track = {
  uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", title: 'Blue Bird <"edition">',
  artists: "Akano", duration_ms: 100000, thumbnail: "https://i.scdn.co/image/test",
};
const state = { entries: [], search: { state: "ready", query: "blue", items: [track] } };
const tools = root.attachMusicTools({
  element, data: () => state, rows: () => [], invoke: async () => {},
  icon: () => "<svg></svg>",
  escape: (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]),
  localFor: () => null, layout: { config: {} }, redraw() {},
});
try {
  nodes.get(".spotify-search").oninput({ target: { value: "blue" } });
  tools.renderSearch();
  let html = nodes.get(".spotify-library").innerHTML;
  for (const name of ["music-search-art", "music-search-info", "music-search-status", "music-search-actions"])
    assert.ok(html.includes(`class="${name}"`), `Missing layout wrapper ${name}`);
  assert.ok(html.includes('width="48" height="48"'), "Album art must reserve compact dimensions before loading");
  assert.ok(html.includes("Blue Bird &lt;&quot;edition&quot;&gt;"));
  assert.ok(!html.includes('<"edition">'));
  state.search.via = "cache";
  state.search.warning = "Catálogo indisponível <retry>";
  tools.renderSearch();
  html = nodes.get(".spotify-library").innerHTML;
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('data-action="retry_search"'));
  assert.ok(html.includes("Catálogo indisponível &lt;retry&gt;"));
  assert.ok(html.includes("Resultados salvos de uma busca anterior"));
  track.thumbnail = "";
  tools.renderSearch();
  assert.ok(!nodes.get(".spotify-library").innerHTML.includes("<img"));
  console.log("PASS search rows constrain artwork, escape metadata and identify cached fallback results");
} finally { tools.dispose(); }
