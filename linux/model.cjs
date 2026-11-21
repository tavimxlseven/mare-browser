"use strict";
const START = "mare://start";
const defaults = {theme:"system", search_engine:"duckduckgo", restore_session:true, automatic_updates:true, home_background:"aurora", shield_enabled:true, shield_exceptions:[]};
function pageURL(value) {
  if (value === START) return START;
  try { const u = new URL(value); return ["http:","https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function normalize(value, engine="duckduckgo") {
  const text = String(value || "").trim().slice(0,8192);
  if (!text) return START;
  if (pageURL(text)) return pageURL(text);
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^(localhost|[\w.-]+\.\w+):\d+(\/|$)/i.test(text)) throw Error("Esse tipo de endereço não é permitido.");
  if (!/\s/.test(text) && /^(localhost(:\d+)?|([\w-]+\.)+[\w-]+(:\d+)?)(\/|$)/.test(text)) return pageURL("https://"+text);
  return ({google:"https://www.google.com/search?q=",bing:"https://www.bing.com/search?q=",brave:"https://search.brave.com/search?q="}[engine] || "https://duckduckgo.com/?q=") + encodeURIComponent(text);
}
function settings(value={}) {
  const s = {...defaults,...value};
  for (const [key,allowed] of Object.entries({theme:["system","light","dark"],search_engine:["duckduckgo","google","bing","brave"],home_background:["aurora","ocean","dusk","minimal"]})) if (!allowed.includes(s[key])) s[key]=defaults[key];
  s.shield_exceptions = [...new Set((Array.isArray(s.shield_exceptions)?s.shield_exceptions:[]).filter(h=>typeof h==="string" && /^[a-z\d.-]+$/i.test(h)).slice(0,128))];
  for (const key of ["restore_session","automatic_updates","shield_enabled"]) s[key]=s[key]!==false;
  return s;
}
function initial(saved={}) {
  const state={version:"0.6.4", next_id:Math.max(10,Number(saved.next_id)||10), site_icons:{}, tabs:[], active_id:0, bookmarks:[], history:[],reading_list:[],downloads:[],settings:settings(saved.settings)};
  for (const key of ["bookmarks","history","reading_list"]) state[key]=(Array.isArray(saved[key])?saved[key]:[]).filter(x=>x&&pageURL(x.url)&&typeof x.title==="string").slice(0,1000);
  if (!Array.isArray(saved.bookmarks)) state.bookmarks=[["Wikipedia","https://www.wikipedia.org/"],["GitHub","https://github.com/"],["Apple","https://www.apple.com/"],["Rust","https://www.rust-lang.org/"],["YouTube","https://www.youtube.com/"]].map(([title,url])=>({id:state.next_id++,title,url}));
  state.downloads=(Array.isArray(saved.downloads)?saved.downloads:[]).filter(d=>d&&Number.isSafeInteger(d.id)&&typeof d.path==="string").slice(0,200).map(d=>({...d,status:["downloading","paused","choosing"].includes(d.status)?"interrupted":d.status,resumable:false}));
  if (state.settings.restore_session) for (const t of (Array.isArray(saved.tabs)?saved.tabs:[]).slice(0,100)) {
    if (t.private || !pageURL(t.url)) continue;
    const tab=newTab(state,t.url); tab.pinned=!!t.pinned;
    if (t.id===saved.active_id) state.restored_active=tab.id;
  }
  if (!state.tabs.length) newTab(state,START);
  state.active_id=state.restored_active || state.tabs[0].id; delete state.restored_active;
  state.next_id=Math.max(state.next_id,...[...state.bookmarks,...state.reading_list,...state.downloads].map(x=>(Number(x.id)||0)+1));
  return state;
}
function newTab(state,url=START,privateTab=false) {
  const tab={id:state.next_id++,title:url===START?"Página inicial":new URL(url).hostname,url,favicon:"",app_id:null,private:!!privateTab,pinned:false,loading:url!==START,can_go_back:false,can_go_forward:false};
  state.tabs.push(tab);state.active_id=tab.id;return tab;
}
function persistent(state) {
  return {...state,tabs:state.tabs.filter(t=>!t.private),downloads:state.downloads.filter(d=>!d.private),history:state.history.slice(0,1000)};
}
module.exports={START,defaults,pageURL,normalize,settings,initial,newTab,persistent};
