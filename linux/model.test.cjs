"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  M = require("./model.cjs");
test("navigation never accepts privileged URLs", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hello",
    "compass-ui://app/",
    "https://user:secret@example.com/",
  ]) {
    assert.equal(M.pageURL(url), null);
    assert.throws(() => M.normalize(url));
  }
  assert.equal(
    M.normalize("travis scott"),
    "https://duckduckgo.com/?q=travis%20scott",
  );
  assert.equal(M.normalize("example.com"), "https://example.com/");
});
test("private sessions never persist and restored IDs do not collide", () => {
  const s = M.initial();
  const normal = M.newTab(s, "https://example.com/");
  M.newTab(s, "https://private.example/", true);
  s.downloads.push({ id: 900, path: "/tmp/private", private: true });
  const publicState = M.persistent(s);
  assert(!publicState.tabs.some((t) => t.private));
  assert.equal(publicState.downloads.length, 0);
  const restored = M.initial(publicState);
  assert(restored.tabs.some((t) => t.url === normal.url));
  assert(!restored.tabs.some((t) => t.private));
  assert(M.newTab(restored).id > normal.id);
});
test("restore disabled, malformed profile entries and interrupted downloads", () => {
  const s = M.initial({
    settings: { restore_session: false, theme: "bad" },
    tabs: [{ id: 1, url: "file:///etc/passwd" }],
    history: [{ title: "bad", url: "javascript:alert(1)" }],
    downloads: [{ id: 22, path: "/tmp/file", status: "downloading" }],
  });
  assert.equal(s.tabs[0].url, M.START);
  assert.equal(s.history.length, 0);
  assert.equal(s.settings.theme, "system");
  assert.equal(s.downloads[0].status, "interrupted");
  assert(M.newTab(s).id > 22);
});
test("updates select the newest Ubuntu installer and reject unrelated assets", async () => {
  const updates = require("./updates.cjs");
  const release = (version, tag = "ubuntu-v" + version, host = "github.com") => {
    const name = "compass-browser_" + version + "-1_amd64.deb";
    return {
      tag_name: tag,
      assets: [{
        name,
        browser_download_url: "https://" + host + "/tavimxlseven/mare-browser/releases/download/" + tag + "/" + name,
      }],
    };
  };
  const entries = [
    release("0.6.9"),
    release("0.6.10"),
    release("1.2.3", "v1.2.3"),
    release("2.0.0", "ubuntu-v2.0.0", "example.org"),
    { ...release("3.0.0"), draft: true },
  ];
  const respond = async () => ({ ok: true, json: async () => entries });
  assert.equal((await updates.check(respond, "0.6.9")).version, "0.6.10");
  assert.equal(await updates.check(respond, "0.6.10"), null);
  assert.equal(await updates.check(respond, "0.7.0"), null);
});
