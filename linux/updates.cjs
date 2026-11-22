"use strict";

const releases = "https://api.github.com/repos/tavimxlseven/mare-browser/releases";
const downloadBase = "https://github.com/tavimxlseven/mare-browser/releases/download/";
const versionPattern = "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
const ubuntuTag = new RegExp("^ubuntu-v" + versionPattern + "$");
const macosTag = new RegExp("^macos-v" + versionPattern + "$");

function compare(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function latestUbuntuRelease(entries) {
  return latestRelease(entries);
}

function latestRelease(entries, arch) {
  if (!Array.isArray(entries)) throw Error("Resposta inválida do GitHub.");
  let latest = null;
  for (const release of entries) {
    const match = (arch ? macosTag : ubuntuTag).exec(release?.tag_name);
    if (!match || release.draft || !Array.isArray(release.assets)) continue;
    const version = match.slice(1).join(".");
    const name = arch
      ? "Noise-Music-" + version + "-macos-" + arch + ".zip"
      : "compass-browser_" + version + "-1_amd64.deb";
    const url = downloadBase + release.tag_name + "/" + name;
    if (!release.assets.some((asset) => asset?.name === name && asset.browser_download_url === url))
      continue;
    if (!latest || compare(version, latest.version) > 0) latest = { version, url };
  }
  return latest;
}

async function check(fetch, current, arch) {
  const timeout = AbortSignal.timeout(12000);
  // Follow paginated results until at least one matching release is found.
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(releases + "?per_page=100&page=" + page, {
      headers: { Accept: "application/vnd.github+json" },
      redirect: "error",
      signal: timeout,
    });
    if (!response.ok) throw Error("O GitHub retornou HTTP " + response.status + ".");
    const entries = await response.json();
    const latest = latestRelease(entries, arch);
    if (latest)
      return compare(latest.version, current) > 0 ? latest : null;
    if (entries.length < 100) break;
  }
  return null;
}

module.exports = { check, latestUbuntuRelease };
