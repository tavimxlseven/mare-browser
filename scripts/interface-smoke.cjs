// Check the exact HTML produced by the packaged executable, not a separate UI preview.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { Script } = require("node:vm");
const executable = resolve(
  process.argv.find((a) => a.startsWith("--exe="))?.slice(6) ||
    "dist/Mare/Mare.exe",
);
const html = execFileSync(executable, ["--dump-interface"], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 15000,
  maxBuffer: 4 * 1024 * 1024,
});
for (const name of [
  "styles.css",
  "spotify.css",
  "music-queue.js",
  "music-layout.js",
  "music-tools.js",
  "spotify.js",
  "app.js",
  "browser-tools.js",
  "browser-tools.css",
]) {
  assert.ok(
    html.includes(readFileSync(join(__dirname, "../ui", name), "utf8")),
    `Executable is missing ${name}`,
  );
}
for (const name of ["sortable.js", "devices-ui.js", "music-polish.css"]) {
  assert.ok(
    html.includes(
      readFileSync(join(__dirname, "../mobile/public", name), "utf8"),
    ),
    `Executable is missing ${name}`,
  );
}
assert.equal((html.match(/<style>/g) || []).length, 4);
assert.ok(!/<link\s[^>]*rel=["']stylesheet["']/i.test(html));
assert.ok(!/<script\s[^>]*src=/i.test(html));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
new Script(scripts[0][1], { filename: "packaged-interface.js" });
console.log(
  "PASS packaged executable contains all four stylesheets and eight valid inline scripts; no external UI files required",
);
