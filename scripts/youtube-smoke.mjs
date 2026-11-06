import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const source = fs
  .readFileSync("src/youtube.js", "utf8")
  .replace(
    "__MARE_YOUTUBE_POLICY__",
    JSON.stringify({ enabled: true, exceptions: [] }),
  );
function setup(host) {
  const c = vm.createContext({
    location: { hostname: host },
    document: { documentElement: null },
    addEventListener() {},
    setTimeout,
    clearTimeout,
  });
  vm.runInContext("window=globalThis;", c);
  vm.runInContext(source, c);
  return c;
}
const c = setup("www.youtube.com");
const response = vm.runInContext(
  `JSON.parse('{"adPlacements":[{"ad":"x"}],"playerAds":[{}],"videoDetails":{"videoId":"original","title":"Original video"},"streamingData":{"formats":[{"url":"legitimate-media"}]}}')`,
  c,
);
assert.equal(response.adPlacements, undefined);
assert.equal(response.playerAds, undefined);
assert.equal(response.videoDetails.videoId, "original");
assert.equal(response.streamingData.formats[0].url, "legitimate-media");
vm.runInContext(
  'ytInitialPlayerResponse={adSlots:[1],videoDetails:{videoId:"second"}}',
  c,
);
assert.equal(c.ytInitialPlayerResponse.adSlots, undefined);
assert.equal(c.ytInitialPlayerResponse.videoDetails.videoId, "second");
vm.runInContext(
  "__mareYoutubeShield.configure({enabled:false,exceptions:[]})",
  c,
);
assert.equal(
  vm.runInContext("JSON.parse('{\"playerAds\":[1]}').playerAds.length", c),
  1,
);
vm.runInContext(
  '__mareYoutubeShield.configure({enabled:true,exceptions:["www.youtube.com"]})',
  c,
);
assert.equal(
  vm.runInContext(
    "JSON.parse('{\"adPlacements\":[1]}').adPlacements.length",
    c,
  ),
  1,
);
const other = setup("example.com");
assert.equal(other.__mareYoutubeShield, undefined);
assert.equal(
  vm.runInContext("JSON.parse('{\"playerAds\":[1]}').playerAds.length", other),
  1,
);
console.log(
  "PASS YouTube response filtering preserves video/streams, handles initial player data, respects disable/site exceptions and leaves other sites untouched",
);
