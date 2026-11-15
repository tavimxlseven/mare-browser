const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const root = {};
vm.runInNewContext(fs.readFileSync("ui/music-streaming.js", "utf8"), {window:root,performance,setTimeout,clearTimeout,console});
class AudioFixture extends EventTarget {
  constructor() { super(); this.dataset={}; this.paused=true; this.currentTime=0; this.duration=180; this.readyState=1; this.ended=false; this.src=""; }
  play() { this.paused=false; this.dispatchEvent(new Event("playing")); return Promise.resolve(); }
  pause() { this.paused=true; this.dispatchEvent(new Event("pause")); }
  load() { this.currentTime=0; }
  removeAttribute() { this.src=""; }
  getAttribute() { return this.src; }
  remove() {}
}
const track = id => ({id,track_uri:"spotify:track:"+String(id).padStart(22,"0"),duration_ms:180000});
(async()=>{
 const audio=new AudioFixture(), calls=[], notices=[];
 let persistentHost = false;
 let releaseFirst;
 const engine=root.createNoiseStreaming({element:{append(){throw Error("Audio must not live in a detachable app pane");},ownerDocument:{body:{append(){persistentHost=true;}}}},getState:()=>({player:{volume:25}}),makeAudio:()=>audio,changed(){},notify:s=>notices.push(s),request:async(method,params)=>{
   calls.push({method,params});
   if(method==="cloud_stream") {
     if(params.track_id.endsWith("1")) return await new Promise(resolve=>releaseFirst=resolve);
     return {state:"ready",url:"https://music.example/stream/fixture/"+params.track_id};
   }
   return {};
 }});
 const first=engine.start(track(1));
 assert.equal(persistentHost,true);
 await new Promise(resolve=>setImmediate(resolve));
 const second=engine.start(track(2)); await second;
 releaseFirst({state:"ready",url:"https://music.example/stream/obsolete"}); await first;
 assert.ok(audio.src.endsWith("0000000000000000000002"),"An obsolete request must never replace the current song");
 assert.equal(engine.snapshot().track_id,2);
 assert.equal(engine.snapshot().state,"playing");
 assert.equal(audio.volume,0.0625);
 await engine.command("seek",{position_ms:30000}); assert.equal(audio.currentTime,30);
 await engine.command("pause"); assert.equal(engine.snapshot().state,"paused");
 await engine.command("resume"); assert.equal(engine.snapshot().state,"playing");
 await engine.command("volume",{value:10}); assert.ok(Math.abs(audio.volume-0.01)<0.00001);
 assert.ok(!calls.some(c=>["download","import_search"].includes(c.method)),"Streaming must never start a local download");
 engine.dispose(); assert.equal(audio.src,""); assert.equal(engine.snapshot(),null);
 assert.equal(notices.length,0);
 console.log("PASS streaming uses one media element, isolates stale play requests, preserves transport/volume and never downloads locally");
})().catch(error=>{console.error(error);process.exitCode=1;});
