// Isolated fixture only. Never approves a callback or launches Riot Client.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP,connect,until} from './lib/cdp.mjs';
const exe=resolve(process.argv.find(a=>a.startsWith('--exe='))?.slice(6)||'dist/Mare/Mare.exe');
const profile=await mkdtemp(join(tmpdir(),'compass-protocol-qa-'));
const callback='riotclient://auth/callback?code=NOT_A_REAL_CODE&state=COMPASS_QA_ONLY';
const html=`<title>Local protocol fixture</title><link rel="icon" href="data:,"><button id="redirect" onclick="location.href='${callback}'">Redirect fixture</button><button id="popup" onclick="window.open('${callback}')">Popup fixture</button>`;
const fixture=createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html)});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const base=`http://127.0.0.1:${fixture.address().port}`;
const probe=socketServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const child=spawn(exe,['--open-url',base+'/'],{windowsHide:true,stdio:'ignore',env:{...process.env,MARE_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
let c,p;
try{
 await until('fixture interface',async()=>{try{c=await connect(port);return true}catch{return false}},30000);
 await c.ipc({cmd:'ready'});
 const target=await until('fixture page',async()=>{for(const host of ['127.0.0.1','[::1]']){try{const list=await fetch(`http://${host}:${port}/json/list`).then(r=>r.json());const target=list.find(t=>t.url===base+'/');if(target)return target}catch{}}return null});
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});p=new CDP(ws);
 ws.addEventListener('message',e=>{const message=JSON.parse(String(e.data));if(message.method==='Fetch.requestPaused')p.call('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(html).toString('base64')}).catch(()=>{})});
 await p.call('Fetch.enable',{patterns:[{urlPattern:'https://authenticate.riotgames.com/__compass_fixture*'}]});
 await c.eval('window.__protocolQA={state:null};var previousProtocolQA=window.mare.receive;window.mare.receive=s=>{window.__protocolQA.state=typeof s==="string"?JSON.parse(s):s;previousProtocolQA(s)};true');
 for(const button of ['redirect','popup']){
  await p.call('Page.navigate',{url:`https://authenticate.riotgames.com/__compass_fixture?mode=${button}`});
  await until('mock trusted origin',()=>p.eval(`location.href===${JSON.stringify(`https://authenticate.riotgames.com/__compass_fixture?mode=${button}`)}&&document.readyState==="complete"&&Boolean(document.querySelector("#redirect"))`));
  await p.call('Runtime.evaluate',{expression:`document.querySelector('#${button}').click();true`,userGesture:true});
  await until(`${button} confirmation`,()=>c.eval('!document.querySelector("#overlay").hidden&&document.querySelector("#overlay").textContent.includes("Abrir Riot Client?")'));
  assert.equal(await c.eval('document.querySelector("#overlay").textContent.includes("NOT_A_REAL_CODE")'),false);
  await c.click('[data-permission-deny]');
  await c.ipc({cmd:'ready'});
  await until('permission closed',()=>c.eval('document.querySelector("#overlay").hidden'));
  assert.equal(await c.eval('window.__protocolQA.state.tabs.some(t=>t.url.startsWith("riotclient:"))'),false);
  assert.equal(await c.eval('JSON.stringify(window.__protocolQA.state).includes("NOT_A_REAL_CODE")'),false);
 }
 await p.call('Page.navigate',{url:base+'/untrusted'});await until('untrusted fixture',()=>p.eval(`location.origin===${JSON.stringify(base)}`));
 await p.call('Runtime.evaluate',{expression:'document.querySelector("#redirect").click();true',userGesture:true});await delay(500);
 assert.equal(await c.eval('document.querySelector("#overlay").hidden'),true);
 console.log('PASS redirect and popup callbacks request one-shot confirmation; callback secrets are absent from chrome/history; untrusted origins are blocked (no app launched)');
 const closed=once(child,'close');await c.ipc({cmd:'window',action:'close'});await closed;
}catch(error){
 console.error('Private QA diagnostics',JSON.stringify({exit:child.exitCode,targets:await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()).then(list=>list.map(t=>({type:t.type,url:t.url}))).catch(()=>[]),ui:await c?.eval('document.body.innerText.slice(-2000)').catch(()=>null)}));
 throw error;
}finally{p?.close();c?.close();if(child.exitCode===null)child.kill();fixture.close()}
