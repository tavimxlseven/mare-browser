import fs from "node:fs";
import path from "node:path";
const metadata = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""),
);
const ids = new Set(metadata.resolve.nodes.map((n) => n.id));
const packages = metadata.packages
  .filter((p) => ids.has(p.id) && p.name !== "mare-browser")
  .sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
let output = fs
  .readFileSync("THIRD_PARTY_LICENSES.txt", "utf8")
  .replace("MARÉ BROWSER 0.3.0", "MARÉ BROWSER 0.3.2");
const added = packages.filter(
  (p) => !output.includes(`${p.name} ${p.version} —`),
);
if (added.length) {
  output += "\n\nADDITIONAL DEPENDENCIES — MARÉ 0.3.2\n\n";
  for (const p of added)
    output += `${p.name} ${p.version} — ${p.license || "see upstream license"} — ${p.repository || p.homepage || "https://crates.io/crates/" + p.name}\n`;
  for (const p of added) {
    const root = path.dirname(p.manifest_path);
    const candidates = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(e.name),
      )
      .map((e) => path.join(root, e.name));
    if (p.license_file) candidates.push(path.resolve(root, p.license_file));
    let count = 0;
    for (const file of new Set(candidates)) {
      if (!fs.existsSync(file) || fs.statSync(file).size > 1500000) continue;
      const license = fs
        .readFileSync(file, "utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      if (!license) continue;
      count++;
      if (output.includes(license)) continue;
      output += `\n${"=".repeat(70)}\n${p.name} ${p.version} — ${path.basename(file)}\n${"=".repeat(70)}\n\n${license}\n`;
    }
    if (!count) {
      const vcsPath = path.join(root, ".cargo_vcs_info.json"),
        vcs = fs.existsSync(vcsPath)
          ? JSON.parse(fs.readFileSync(vcsPath, "utf8"))
          : null;
      const repo = (p.repository || "").replace(/\.git$/, "");
      if (
        !repo.startsWith("https://github.com/") ||
        !/^[a-f0-9]{40}$/.test(vcs?.git?.sha1 || "")
      )
        throw Error("License provenance missing for " + p.name);
      const directory = "assets/licenses";
      fs.mkdirSync(directory, { recursive: true });
      for (const name of [
        "LICENSE",
        "LICENSE.txt",
        "LICENSE-MIT",
        "LICENSE-APACHE",
      ]) {
        const file = path.join(
          directory,
          repo.split("/").at(-1) +
            "-" +
            vcs.git.sha1.slice(0, 12) +
            "-" +
            name.replace(".txt", "") +
            ".txt",
        );
        let license = "";
        if (fs.existsSync(file)) license = fs.readFileSync(file, "utf8");
        else {
          const url =
            repo.replace(
              "https://github.com/",
              "https://raw.githubusercontent.com/",
            ) +
            "/" +
            vcs.git.sha1 +
            "/" +
            name;
          const r = await fetch(url);
          if (!r.ok) continue;
          license = await r.text();
          fs.writeFileSync(file, license);
        }
        count++;
        const text = license.replace(/\r\n/g, "\n").trim();
        if (!output.includes(text))
          output += `\n${"=".repeat(70)}\n${p.name} ${p.version} — upstream ${name} at ${vcs.git.sha1}\n${"=".repeat(70)}\n\n${text}\n`;
      }
      if (!count) throw Error("License text missing for " + p.name);
    }
  }
}
fs.writeFileSync("THIRD_PARTY_LICENSES.txt", output);
let notices = fs
  .readFileSync("THIRD_PARTY_NOTICES.md", "utf8")
  .replace("Maré Browser 0.3.0", "Maré Browser 0.3.2");
if (!notices.includes("| rodio |"))
  notices = notices.replace(
    "| Rust Standard Library |",
    "| rodio | 0.21.1 | MIT OR Apache-2.0 | [Upstream](https://github.com/RustAudio/rodio) |\n| cpal | 0.16.0 | Apache-2.0 | [Upstream](https://github.com/RustAudio/cpal) |\n| symphonia | 0.5.5 | MPL-2.0 | [Upstream](https://github.com/pdeljanov/Symphonia) |\n| winresource | 0.1.34 | MIT | [Upstream](https://github.com/BenjaminRi/winresource) |\n| Rust Standard Library |",
  );
notices = notices.replace(/111/g, String(packages.length));
fs.writeFileSync("THIRD_PARTY_NOTICES.md", notices);
console.log(
  JSON.stringify({ resolvedCrates: packages.length, added: added.length }),
);
