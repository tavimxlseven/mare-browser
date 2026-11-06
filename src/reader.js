(() => {
  'use strict';
  const existing = document.getElementById('__mare_reader_view');
  if (existing) { existing.remove(); return; }
  const candidates = [...document.querySelectorAll('article,main,[role="main"]')];
  const article = candidates.sort((a,b) => (b.innerText||'').length-(a.innerText||'').length)[0] || document.body;
  const copy = article.cloneNode(true);
  copy.querySelectorAll('script,style,nav,header,footer,aside,form,button,iframe,svg,[hidden],[aria-hidden="true"]').forEach(el=>el.remove());
  const paragraphs = [...copy.querySelectorAll('h1,h2,h3,h4,p,blockquote,pre,li')]
    .filter(el=>!el.parentElement?.closest('p,li,blockquote,pre'))
    .map(el=>({tag:el.tagName.toLowerCase(),text:el.textContent.trim()}))
    .filter(item=>item.text.length>0);
  if (!paragraphs.length) paragraphs.push({tag:'p',text:(article.innerText||document.body.innerText||'Esta página não tem texto para exibir.').slice(0,500000)});
  const host=document.createElement('div');
  host.id='__mare_reader_view';
  Object.assign(host.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'#f8f6f1',color:'#282723',overflow:'auto'});
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=`:host{color-scheme:light}*{box-sizing:border-box}main{max-width:780px;padding:50px 38px 100px;margin:auto}header{position:sticky;top:0;display:flex;align-items:center;gap:15px;padding:15px 25px;background:#f8f6f1f5;border-bottom:1px solid #d9d6cf;font:13px system-ui}header span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button{border:1px solid #d1cdc4;background:#fff;color:#282723;border-radius:7px;padding:7px 13px;cursor:pointer;font:13px system-ui}button:focus-visible{outline:2px solid #0879e8;outline-offset:3px}h1{font:700 38px/1.25 Georgia,serif;margin:0 0 35px}h2{font:700 28px/1.3 Georgia,serif;margin:38px 0 15px}h3,h4{font:700 23px/1.4 Georgia,serif;margin:30px 0 14px}p,li,blockquote{font:21px/1.75 Georgia,serif;margin:0 0 22px;white-space:pre-wrap}li{margin-left:25px}blockquote{border-left:3px solid #b9b1a2;padding-left:24px;color:#5e584e}pre{font:15px/1.7 monospace;overflow:auto;background:#eeebe4;padding:20px;border-radius:7px;white-space:pre-wrap}@media(max-width:600px){main{padding:30px 22px 70px}h1{font-size:30px}p,li,blockquote{font-size:18px}}@media(prefers-color-scheme:dark){:host,header{background:#25252a!important;color:#e8e5de}header{border-color:#4c4b50}button{background:#39383e;color:#e8e5de;border-color:#59575e}pre{background:#333238}blockquote{color:#c4bfb5}}`;
  shadow.append(style);
  const header=document.createElement('header');
  const label=document.createElement('span');label.textContent='Modo de leitura · '+location.hostname;
  const smaller=document.createElement('button');smaller.textContent='A−';smaller.setAttribute('aria-label','Diminuir texto');
  const larger=document.createElement('button');larger.textContent='A+';larger.setAttribute('aria-label','Aumentar texto');
  const close=document.createElement('button');close.textContent='Fechar';close.onclick=()=>host.remove();
  header.append(label,smaller,larger,close);shadow.append(header);
  const main=document.createElement('main');main.setAttribute('role','article');
  const title=document.createElement('h1');title.textContent=document.title;main.append(title);
  for(const item of paragraphs){if(item.tag==='h1'&&item.text===document.title)continue;const element=document.createElement(item.tag);element.textContent=item.text;main.append(element);}
  shadow.append(main);document.documentElement.append(host);
  let scale=1;const resize=delta=>{scale=Math.max(.75,Math.min(1.8,scale+delta));main.style.zoom=String(scale);};
  smaller.onclick=()=>resize(-.1);larger.onclick=()=>resize(.1);
  host.addEventListener('keydown',e=>{if(e.key==='Escape'){host.remove();e.preventDefault();e.stopPropagation();}});
  close.focus();
})();
