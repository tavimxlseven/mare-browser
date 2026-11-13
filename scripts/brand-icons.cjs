// Same optional @resvg/resvg-js dependency and --resvg argument as music-icons.cjs.
const fs = require('node:fs');
const path = require('node:path');
const modulePath = process.argv.find(v => v.startsWith('--resvg='))?.slice(8);
const { Resvg } = require(modulePath ? path.resolve(modulePath) : '@resvg/resvg-js');
const root = path.resolve(__dirname, '..');
const compass = fs.readFileSync(path.join(root, 'assets/compass.svg'), 'utf8');
const rendered = new Resvg(compass, { fitTo: { mode: 'width', value: 256 } }).render();
fs.writeFileSync(path.join(root, 'assets/compass-256.rgba'), rendered.pixels);
fs.writeFileSync(path.join(root, 'docs/screenshots/compass-icon.png'), rendered.asPng());
const music = fs.readFileSync(path.join(root, 'mobile/public/music-mark.svg'), 'utf8');
fs.writeFileSync(path.join(root, 'docs/screenshots/noise-icon.png'), new Resvg(music, { fitTo: { mode: 'width', value: 256 } }).render().asPng());
