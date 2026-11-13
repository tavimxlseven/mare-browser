// Optional artwork tool: npm install --prefix .tools/icons @resvg/resvg-js
// node scripts/music-icons.cjs --resvg=./.tools/icons/node_modules/@resvg/resvg-js
const fs = require("node:fs");
const path = require("node:path");
const modulePath = process.argv.find((v) => v.startsWith("--resvg="))?.slice(8);
const { Resvg } = require(
  modulePath ? path.resolve(modulePath) : "@resvg/resvg-js",
);
const root = path.resolve(__dirname, "../mobile/public");
const mark = fs.readFileSync(path.join(root, "music-mark.svg"), "utf8");
for (const size of [180, 192, 512]) {
  const svg = mark.replace(
    "<defs>",
    '<rect width="512" height="512" fill="#101015"/><defs>',
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();
  fs.writeFileSync(path.join(root, "music-icon-" + size + ".png"), png);
  fs.writeFileSync(path.join(root, "icon-" + size + ".png"), png);
}
const maskable =
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#101015"/><svg x="72" y="72" width="368" height="368" viewBox="0 0 512 512">' +
  mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "") +
  "</svg></svg>";
fs.writeFileSync(
  path.join(root, "music-icon-maskable-512.png"),
  new Resvg(maskable).render().asPng(),
);
