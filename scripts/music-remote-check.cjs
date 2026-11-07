const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(
  require("node:path").join(__dirname, "../ui/music-remote.html"),
  "utf8",
);
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!blocks.length) throw Error("Remote controller script missing");
blocks.forEach(
  (block, index) =>
    new vm.Script(block[1], {
      filename: "music-remote-inline-" + index + ".js",
    }),
);
console.log("PASS remote controller inline JavaScript syntax");
