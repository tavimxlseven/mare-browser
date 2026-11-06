/* The chrome has the only privileged IPC connection. Remote pages are separate
 * native child webviews and never receive this document or its commands. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const paths = {
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1M5.5 11h1M5.5 14h1"/>',
    back: '<path d="m15 5-7 7 7 7"/>', forward: '<path d="m9 5 7 7-7 7"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    reload: '<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', plus: '<path d="M12 4v16M4 12h16"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',
    share: '<path d="M12 15V3m-4 4 4-4 4 4M7 9H5v12h14V9h-2"/>',
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16.8 7.2-3 6.6-6.6 3 3-6.6 6.6-3Z"/><path d="m10.2 10.2 3.6 3.6M12 3v1M12 20v1M3 12h1M20 12h1"/>',
    home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-7h6v7"/>',
    book: '<path d="M12 6C8 3 4 4 2.5 5v14c3-1.5 6-1.5 9.5 1 3.5-2.5 6.5-2.5 9.5-1V5c-1.5-1-5.5-2-9.5 1Zm0 0v14"/>',
    glasses: '<circle cx="6.5" cy="14.5" r="4.5"/><circle cx="17.5" cy="14.5" r="4.5"/><path d="M11 14c.7-.7 1.3-.7 2 0M2 14l2-9h3m15 9-2-9h-3"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v6l4 2"/>',
    settings: '<path d="m9 3-.7 2.4-2 .9L4 5.5 2 9l1.8 1.6v2.8L2 15l2 3.5 2.3-.8 2 .9L9 21h4l.7-2.4 2-.9 2.3.8 2-3.5-1.8-1.6v-2.8L20 9l-2-3.5-2.3.8-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    private: '<path d="M3 9h18l-2 9-5-2-2-3-2 3-5 2-2-9Z"/><path d="M6 12h3m6 0h3M6 9l2-5h8l2 5"/>',
    sliders: '<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9L12 3Z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
    printer: '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7Z"/><path d="M17 10h1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    folder: '<path d="M3 6h7l2 2h9v12H3V6Z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    pin: '<path d="m15 3 6 6-4 1-4 6-2-2-6 6m6-6-3-3 6-4 1-4Z"/>',
    tab: '<path d="M3 8V5h7l2 3h9v12H3V8Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-5 2 2-16"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    zoom: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8M10 6v8"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    reader: '<path d="M5 4h14M5 8h14M5 12h14M5 16h10M5 20h10"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.globe}</svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hostname = (url) => {try{return new URL(url).hostname.replace(/^www\./,'');}catch{return url === 'mare://start' ? 'Página inicial' : String(url || '');}};
  const isStart = tab => !tab || tab.url === 'mare://start' || tab.url === 'about:blank';
  const active = () => state.tabs.find(t => t.id === state.active_id) || state.tabs[0];
  const isNative = !!window.ipc?.postMessage;
  let state = {
    tabs:[{id:1,title:'Página inicial',url:'mare://start',loading:false,private:false,pinned:false,can_go_back:false,can_go_forward:false}],active_id:1,
    bookmarks:[{id:10,title:'Wikipedia',url:'https://pt.wikipedia.org'},{id:11,title:'GitHub',url:'https://github.com'},{id:12,title:'Apple',url:'https://www.apple.com'},{id:13,title:'Rust',url:'https://www.rust-lang.org'},{id:14,title:'YouTube',url:'https://www.youtube.com'}],
    history:[],reading_list:[],downloads:[],settings:{theme:'system',search_engine:'duckduckgo',restore_session:true,home_background:'aurora'},version:'0.1.0'
  };
  const ui = {sidebar:false,section:'bookmarks',query:'',popup:null,overlay:null,find:false,zoom:1,suggestion:0,dragId:null,editing:null};
  let layoutFrame, lastLayout = '', toastTimer, suggestionTimer, findTimer, lastActiveId;
  const previouslyClosed = [];
  const media = matchMedia('(prefers-color-scheme: dark)');
  const dateFormat = new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  function hydrateIcons(root = document) { $$('[data-icon]',root).forEach(el => {el.innerHTML=icon(el.dataset.icon);}); }
  function send(command) {
    if (isNative) { window.ipc.postMessage(JSON.stringify(command)); }
    else { preview(command); }
  }
  function notify(message) {
    clearTimeout(toastTimer);$('#toast').textContent=String(message);$('#toast').hidden=false;
    toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4300);
  }
  function updateLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame=requestAnimationFrame(()=>{
      const r=$('#viewport').getBoundingClientRect();
      const data={cmd:'layout',x:r.x,y:r.y,width:r.width,height:r.height,overlay:!$('#popup').hidden || !$('#overlay').hidden || !$('#suggestions').hidden || (ui.sidebar&&innerWidth<=520)};
      const encoded=JSON.stringify(data);if(encoded!==lastLayout){lastLayout=encoded;send(data);}
    });
  }
  function applyTheme() {
    document.documentElement.dataset.theme=state.settings.theme==='system'?(media.matches?'dark':'light'):state.settings.theme;
    $('#startpage').className=`wallpaper ${['aurora','ocean','dusk','minimal'].includes(state.settings.home_background)?state.settings.home_background:'aurora'}`;
  }
  function receive(incoming) {
    try {const next=typeof incoming==='string'?JSON.parse(incoming):incoming;if(!next || (next.tabs&&!Array.isArray(next.tabs)))return;state={...state,...next,settings:{...state.settings,...next.settings}};render();}
    catch(error){notify('Não foi possível atualizar a interface.');}
  }
  function render() {
    const tab=active();if(!tab)return;
    applyTheme();document.title=`${tab.title || hostname(tab.url)} — Maré`;
    document.body.classList.toggle('private-mode',!!tab.private);
    $('#back').disabled=!tab.can_go_back;$('#forward').disabled=!tab.can_go_forward;
    $('#address-form').classList.toggle('loading',!!tab.loading);
    if(document.activeElement!==$('#address') || lastActiveId!==state.active_id) $('#address').value=isStart(tab)?'':tab.url;
    $('#reload').innerHTML=icon(tab.loading?'close':'reload');$('#reload').title=tab.loading?'Parar carregamento (Esc)':'Recarregar (Ctrl+R)';$('#reload').setAttribute('aria-label',tab.loading?'Parar carregamento':'Recarregar página');
    $('#site-info').innerHTML=icon(isStart(tab)?(tab.private?'private':'search'):(tab.url.startsWith('https:')?'lock':'globe'));
    $('#reader-button').hidden=isStart(tab);
    $('#startpage').hidden=!isStart(tab);$('#remote-placeholder').hidden=isStart(tab);
    $('#remote-domain').textContent=hostname(tab.url);
    if(!isNative && !isStart(tab)) {$('#remote-placeholder p').textContent='Prévia da interface';$('#remote-domain').textContent=`${tab.url} — abra o aplicativo Maré para navegar.`;$('.remote-spinner').style.animation='none';}
    $('.private-note').hidden=!tab.private;$('#welcome-label').textContent=tab.private?'Um espaço só seu.':'Um novo horizonte.';
    $('.welcome-subtitle').textContent=tab.private?'O histórico desta aba não será salvo.':'Comece por onde você gosta.';
    $('#version-label').textContent=state.version ? `v${state.version}` : '';
    renderTabs();renderHome();renderSidebar();
    if(ui.overlay==='overview')renderOverview();
    if(ui.popup==='downloads')renderDownloads();
    lastActiveId=state.active_id;updateLayout();
  }
  function renderTabs() {
    const target=$('#tabs');const scroll=target.scrollLeft;
    target.innerHTML=state.tabs.map(tab=>`<div class="tab${tab.private?' private':''}${tab.pinned?' pinned':''}${tab.loading?' loading':''}" role="tab" aria-selected="${tab.id===state.active_id}" tabindex="${tab.id===state.active_id?0:-1}" data-tab="${tab.id}" draggable="true" title="${esc(tab.title || hostname(tab.url))}${tab.private?' (privada)':''}\n${esc(tab.url)}"><span class="tab-icon">${icon(tab.loading?'reload':tab.private?'private':isStart(tab)?'compass':'globe')}</span><span class="tab-title">${esc(tab.title || hostname(tab.url))}</span>${tab.pinned?'':`<button class="tab-close" data-close-tab="${tab.id}" aria-label="Fechar ${esc(tab.title || 'aba')}" tabindex="-1">${icon('close')}</button>`}</div>`).join('');
    target.scrollLeft=scroll;
    $$('[data-tab]',target).forEach(el=>{
      el.addEventListener('click',e=>{if(!e.target.closest('[data-close-tab]')){closeTransient();send({cmd:'activate',id:Number(el.dataset.tab)});}});
      el.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();send({cmd:'close_tab',id:Number(el.dataset.tab)});}});
      el.addEventListener('contextmenu',e=>{e.preventDefault();showTabMenu(Number(el.dataset.tab),e.clientX,e.clientY);});
      el.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key===' '){e.preventDefault();send({cmd:'activate',id:Number(el.dataset.tab)});}
        if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();cycleTabs(e.key==='ArrowLeft'?-1:1);}
        if(e.key==='Delete'){send({cmd:'close_tab',id:Number(el.dataset.tab)});}
      });
      el.addEventListener('dragstart',e=>{ui.dragId=Number(el.dataset.tab);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',el.dataset.tab);});
      el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');e.dataTransfer.dropEffect='move';});
      el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
      el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag-over');const ids=state.tabs.map(t=>t.id),from=ids.indexOf(ui.dragId),to=ids.indexOf(Number(el.dataset.tab));if(from>=0&&to>=0){ids.splice(to,0,...ids.splice(from,1));send({cmd:'reorder_tabs',ids});}});
      el.addEventListener('dragend',()=>{ui.dragId=null;$$('.drag-over').forEach(item=>item.classList.remove('drag-over'));});
    });
    $$('[data-close-tab]',target).forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();send({cmd:'close_tab',id:Number(el.dataset.closeTab)});}));
  }
  const tileColor=url=>{const h=hostname(url);return h.includes('youtube')?'#cf3544':h.includes('rust')?'#874c36':h.includes('wikipedia')?'#3c3c48':h.includes('github')?'#5a4b74':h.includes('apple')?'#6d7180':'#4b72a6';};
  const letter = item => (item.title || hostname(item.url)).trim().slice(0,1).toLocaleUpperCase('pt-BR');
  const emptyCard = (glyph,title,text) => `<div class="home-empty"><div class="empty-glyph">${icon(glyph)}</div><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`;
  function homeRow(item) {return `<button class="home-row" data-go="${esc(item.url)}" title="${esc(item.url)}"><div class="library-icon">${esc(letter(item))}</div><div><span class="item-title">${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(hostname(item.url))}</span></div></button>`;}
  function renderHome() {
    $('#favorites').innerHTML=state.bookmarks.length?state.bookmarks.slice(0,16).map(item=>`<div class="favorite-wrap" style="position:relative;min-width:0"><button class="favorite" data-go="${esc(item.url)}" title="${esc(item.url)}" style="width:100%"><span class="favorite-tile" style="--tile-color:${tileColor(item.url)}">${esc(letter(item))}</span><span class="favorite-name">${esc(item.title || hostname(item.url))}</span></button></div>`).join(''):'<div class="favorites-empty">Seus sites favoritos ficam aqui. Use + para adicionar o primeiro.</div>';
    const reading=state.reading_list.filter(item=>!item.read).slice(0,3);
    $('#reading-preview').innerHTML=reading.length?`<div class="home-rows">${reading.map(homeRow).join('')}</div>`:emptyCard('glasses','Guarde uma boa leitura para depois.','Adicione uma página pelo botão de compartilhar na barra de ferramentas.');
    const seen=new Set();const recent=state.history.filter(item=>{if(seen.has(item.url))return false;seen.add(item.url);return true;}).slice(0,3);
    $('#recent-preview').innerHTML=recent.length?`<div class="home-rows">${recent.map(homeRow).join('')}</div>`:emptyCard('history','A sua próxima descoberta começa aqui.','Os sites que você visitar aparecerão nesta seção.');
    $$('[data-go]',$('#startpage')).forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.go)));
    $$('.favorite-wrap',$('#favorites')).forEach((el,i)=>el.addEventListener('contextmenu',e=>{e.preventDefault();showFavoriteMenu(state.bookmarks[i],e.clientX,e.clientY);}));
  }
  function renderSidebar() {
    $('#sidebar').hidden=!ui.sidebar;$('#sidebar-toggle').setAttribute('aria-pressed',String(ui.sidebar));$('#sidebar-toggle').setAttribute('aria-expanded',String(ui.sidebar));
    $('#sidebar-title').textContent={bookmarks:'Favoritos',reading:'Lista de leitura',history:'Histórico'}[ui.section];
    $$('[data-section]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.section===ui.section)));
    $('#sidebar-add').hidden=ui.section==='history';$('#sidebar-add').title=ui.section==='reading'?'Adicionar página atual à lista':'Adicionar favorito';
    const q=ui.query.toLocaleLowerCase('pt-BR');const items=(ui.section==='bookmarks'?state.bookmarks:ui.section==='reading'?state.reading_list:state.history).filter(item=>`${item.title} ${item.url}`.toLocaleLowerCase('pt-BR').includes(q));
    const empty=ui.section==='bookmarks'?['star','Seus lugares favoritos','Adicione um site com o botão +.']:ui.section==='reading'?['glasses','Um pouco de leitura, depois','Salve uma página pelo menu Compartilhar.']:['history','Uma página em branco','Seu histórico aparecerá aqui.'];
    $('#sidebar-list').innerHTML=items.length?items.slice(0,250).map((item,index)=>`<div class="library-item" role="button" tabindex="0" data-library-index="${index}" title="${esc(item.url)}"><span class="library-icon">${esc(letter(item))}</span><div class="item-copy"><span class="item-title">${item.read?'✓ ':''}${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(ui.section==='history'?`${hostname(item.url)} · ${formatDate(item.visited_at)}`:hostname(item.url))}</span></div>${ui.section!=='history'?`<button class="item-action" data-library-remove="${index}" title="Remover" aria-label="Remover ${esc(item.title)}">${icon('close')}</button>`:''}</div>`).join(''):`<div class="library-empty">${icon(q?'search':empty[0])}<p>${esc(q?'Nenhum resultado':empty[1])}</p>${esc(q?'Tente outro título ou endereço.':empty[2])}</div>`;
    $$('[data-library-index]').forEach(el=>{
      const item=items[Number(el.dataset.libraryIndex)];el.addEventListener('click',e=>{if(!e.target.closest('[data-library-remove]'))navigate(item.url);});
      el.addEventListener('keydown',e=>{if(e.key==='Enter'){navigate(item.url);}});
      el.addEventListener('contextmenu',e=>{e.preventDefault();if(ui.section==='bookmarks')showFavoriteMenu(item,e.clientX,e.clientY);if(ui.section==='reading')showReadingMenu(item,e.clientX,e.clientY);});
    });
    $$('[data-library-remove]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();const item=items[Number(el.dataset.libraryRemove)];send({cmd:ui.section==='reading'?'remove_reading':'remove_bookmark',id:item.id});}));
    if(ui.section==='history'&&state.history.length){const btn=document.createElement('button');btn.className='text-button';btn.style.cssText='display:block;margin:18px auto 0';btn.textContent='Limpar histórico…';btn.addEventListener('click',confirmHistory);$('#sidebar-list').append(btn);}
  }
  function formatDate(value) {try{return dateFormat.format(new Date(value));}catch{return '';}}
  function navigate(url) {closeTransient();send({cmd:'navigate',url});$('#address').blur();}
  function newTab(privateTab=false,url='mare://start') {closeTransient();send({cmd:'new_tab',url,private:privateTab});if(url==='mare://start')setTimeout(focusAddress,70);}
  function focusAddress() {closeTransient();$('#address').focus();$('#address').select();renderSuggestions();}
  function cycleTabs(direction) {const index=state.tabs.findIndex(t=>t.id===state.active_id);const tab=state.tabs[(index+direction+state.tabs.length)%state.tabs.length];if(tab)send({cmd:'activate',id:tab.id});}
  function toggleSidebar(section) {ui.sidebar=section?true:!ui.sidebar;if(section){ui.section=section;ui.query='';$('#library-search').value='';}closeTransient();renderSidebar();updateLayout();}
  function closeTransient() {$('#popup').hidden=true;$('#suggestions').hidden=true;$('#address').setAttribute('aria-expanded','false');$('#overlay').hidden=true;$('#overlay-panel').className='';ui.popup=null;ui.overlay=null;updateLayout();}
  function renderSuggestions() {
    const q=$('#address').value.trim().toLocaleLowerCase('pt-BR'),target=$('#suggestions');
    if(document.activeElement!==$('#address'))return;
    const seen=new Set();const matches=[...state.bookmarks,...state.history].filter(item=>{if(seen.has(item.url))return false;seen.add(item.url);return !q||`${item.title} ${item.url}`.toLocaleLowerCase('pt-BR').includes(q);}).slice(0,7);
    const search=q?`<button class="suggestion" role="option" data-suggest="${esc($('#address').value.trim())}">${icon('search')}<span><span class="item-title">Pesquisar “${esc($('#address').value.trim())}”</span><span class="item-subtitle">${esc({duckduckgo:'DuckDuckGo',google:'Google',bing:'Bing'}[state.settings.search_engine]||'DuckDuckGo')}</span></span></button>`:'';
    target.innerHTML=`${search}<div class="suggestion-heading">${q?'Favoritos e histórico':'Favoritos'}</div>${matches.map(item=>`<button class="suggestion" role="option" data-suggest="${esc(item.url)}">${icon('globe')}<span><span class="item-title">${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(hostname(item.url))}</span></span></button>`).join('')}${!matches.length?'<div class="suggestion-heading">Nenhuma página encontrada na sua biblioteca.</div>':''}`;
    const r=$('#address-form').getBoundingClientRect();target.style.left=`${r.left}px`;target.style.top=`${r.bottom+6}px`;target.style.width=`${r.width}px`;target.hidden=false;ui.suggestion=-1;
    $('#address').setAttribute('aria-expanded','true');$$('[data-suggest]',target).forEach(el=>el.addEventListener('mousedown',e=>{e.preventDefault();navigate(el.dataset.suggest);}));updateLayout();
  }
  function showPopup(html,anchor,kind='menu',position) {
    closeTransient();const popup=$('#popup');popup.innerHTML=html;popup.hidden=false;ui.popup=kind;
    const r=anchor?anchor.getBoundingClientRect():null;const x=position?.x ?? r?.right ?? innerWidth-20;const y=position?.y ?? ((r?.bottom ?? 45)+7);
    popup.style.left=`${Math.max(8,Math.min(x-popup.offsetWidth,innerWidth-popup.offsetWidth-8))}px`;
    popup.style.top=`${Math.max(8,Math.min(y,innerHeight-popup.offsetHeight-10))}px`;
    $$('[data-menu-action]',popup).forEach(el=>el.addEventListener('click',()=>{const action=el.dataset.menuAction;closeTransient();menuAction(action,el.dataset.id);}));updateLayout();
  }
  const menuItem=(glyph,label,action,shortcut='',id='',danger=false)=>`<button class="menu-item${danger?' danger':''}" data-menu-action="${esc(action)}" data-id="${esc(id)}">${icon(glyph)}<span>${esc(label)}</span>${shortcut?`<span class="shortcut">${esc(shortcut)}</span>`:''}</button>`;
  const separator='<hr class="menu-separator">';
  function showShare() {const tab=active(),saved=state.bookmarks.some(b=>b.url===tab.url);showPopup(menuItem('copy','Copiar endereço','copy')+separator+menuItem('star',saved?'Remover dos Favoritos':'Adicionar aos Favoritos','bookmark','Ctrl+D')+menuItem('glasses','Adicionar à Lista de Leitura','reading')+separator+menuItem('printer','Imprimir…','print','Ctrl+P'),$('#share-button'),'share');}
  function showMore() {showPopup(menuItem('plus','Nova aba','new','Ctrl+T')+menuItem('private','Nova aba privada','private','Ctrl+Shift+N')+menuItem('history','Reabrir aba fechada','reopen','Ctrl+Shift+T')+separator+menuItem('book','Favoritos','bookmarks','Ctrl+B')+menuItem('history','Histórico','history','Ctrl+H')+menuItem('download','Downloads','downloads','Ctrl+J')+separator+menuItem('reader','Modo de leitura','reader','Ctrl+Shift+R')+menuItem('search','Buscar nesta página…','find','Ctrl+F')+menuItem('zoom',`Zoom: ${Math.round(ui.zoom*100)}%`,'zoom')+menuItem('printer','Imprimir…','print','Ctrl+P')+separator+menuItem('settings','Ajustes…','settings')+menuItem('code','Ferramentas de desenvolvedor','devtools','F12'),$('#more-button'),'more');}
  function showTabMenu(id,x,y) {const tab=state.tabs.find(t=>t.id===id);if(!tab)return;showPopup(menuItem('tab','Duplicar aba','duplicate','',id)+menuItem('pin',tab.pinned?'Desafixar aba':'Fixar aba','pin','',id)+separator+menuItem('close','Fechar aba','close','Ctrl+W',id)+menuItem('tab','Fechar outras abas','close-others','',id)+separator+menuItem('history','Reabrir aba fechada','reopen','Ctrl+Shift+T'),null,'tab',{x:x+260,y});}
  function showFavoriteMenu(item,x,y) {if(!item)return;showPopup(menuItem('tab','Abrir em nova aba','bookmark-new','',item.id)+menuItem('settings','Editar favorito…','bookmark-edit','',item.id)+separator+menuItem('trash','Remover favorito','bookmark-remove','',item.id,true),null,'favorite',{x:x+260,y});}
  function showReadingMenu(item,x,y) {showPopup(menuItem('check',item.read?'Marcar como não lido':'Marcar como lido','reading-read','',item.id)+menuItem('trash','Remover da lista','reading-remove','',item.id,true),null,'reading',{x:x+260,y});}
  function menuAction(action,id) {
    const numericId=Number(id);
    switch(action){
      case 'new':newTab();break;case 'private':newTab(true);break;case 'copy':copyUrl();break;
      case 'bookmark':if(!isStart(active())){send({cmd:'toggle_bookmark'});}else{showBookmarkDialog();}break;
      case 'reading':if(!isStart(active()))send({cmd:'add_reading'});else notify('Abra uma página para adicioná-la à Lista de Leitura.');break;
      case 'bookmarks':toggleSidebar('bookmarks');break;case 'history':toggleSidebar('history');break;
      case 'downloads':showDownloads();break;case 'settings':showSettings();break;case 'find':showFind();break;
      case 'print':send({cmd:'print'});break;case 'devtools':send({cmd:'devtools'});break;case 'reader':send({cmd:'reader'});break;
      case 'zoom':showZoom();break;case 'pin':send({cmd:'pin_tab',id:numericId});break;
      case 'duplicate':send({cmd:'duplicate_tab',id:numericId});break;case 'close':send({cmd:'close_tab',id:numericId});break;
      case 'close-others':send({cmd:'close_other_tabs',id:numericId});break;case 'reopen':send({cmd:'reopen_tab'});break;
      case 'bookmark-new':{const b=state.bookmarks.find(b=>b.id===numericId);if(b)newTab(!!active().private,b.url);break;}
      case 'bookmark-edit':showBookmarkDialog(state.bookmarks.find(b=>b.id===numericId));break;
      case 'bookmark-remove':send({cmd:'remove_bookmark',id:numericId});break;
      case 'reading-read':send({cmd:'mark_read',id:numericId});break;
      case 'reading-remove':send({cmd:'remove_reading',id:numericId});break;
      case 'zoom-in':setZoom(ui.zoom+.1);break;case 'zoom-out':setZoom(ui.zoom-.1);break;case 'zoom-reset':setZoom(1);break;
    }
  }
  async function copy(text) {
    const value=String(text || '');
    try {
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);notify('Endereço copiado.');return true;
    } catch {
      const previous=document.activeElement,field=document.createElement('textarea');
      field.value=value;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
      document.body.append(field);field.focus();field.select();let copied=false;
      try{copied=document.execCommand('copy');}catch{}
      field.remove();previous?.focus();
      if(copied){notify('Endereço copiado.');return true;}
      closeTransient();$('#address').value=value;$('#address').focus();$('#address').select();
      notify('Endereço selecionado. Pressione Ctrl+C para copiar.');return false;
    }
  }
  function copyUrl() {if(isNative){send({cmd:'copy_url'});}else copy(active().url);}
  function showDownloads() {showPopup('', $('#downloads-button'),'downloads');renderDownloads();updateLayout();}
  function renderDownloads() {
    const target=$('#popup');target.innerHTML=`<div class="popup-heading">Downloads<small>${state.downloads.length||''}</small></div>${state.downloads.length?state.downloads.slice().reverse().slice(0,20).map(item=>`<div class="download-entry"><span>${icon('download')}</span><div><span class="item-title">${esc(item.filename)}</span><span class="item-subtitle">${esc(downloadStatus(item.status))}</span></div>${item.status==='completed'||item.status==='concluído'?`<button data-open-download="${item.id}" title="Abrir arquivo" aria-label="Abrir ${esc(item.filename)}">${icon('external')}</button><button data-reveal-download="${item.id}" title="Mostrar na pasta" aria-label="Mostrar na pasta">${icon('folder')}</button>`:''}</div>`).join(''):`<div class="download-empty">${icon('download')}Seus downloads aparecem aqui.<br>Baixe um arquivo para começar.</div>`}`;
    $$('[data-open-download]',target).forEach(el=>el.addEventListener('click',()=>send({cmd:'open_download',id:Number(el.dataset.openDownload)})));
    $$('[data-reveal-download]',target).forEach(el=>el.addEventListener('click',()=>send({cmd:'reveal_download',id:Number(el.dataset.revealDownload)})));
  }
  function downloadStatus(status) {return {completed:'Concluído',downloading:'Baixando…',failed:'Falha no download',cancelled:'Cancelado',started:'Baixando…'}[status]||status;}
  function showOverlay(kind,title,body,cls='') {
    closeTransient();ui.overlay=kind;$('#overlay-panel').className=cls;$('#overlay-panel').innerHTML=`<div class="dialog-heading"><h2 id="overlay-title">${esc(title)}</h2><button class="icon-button" data-dialog-close aria-label="Fechar">${icon('close')}</button></div>${body}`;$('#overlay').hidden=false;
    $('[data-dialog-close]')?.addEventListener('click',closeTransient);updateLayout();
    requestAnimationFrame(()=>{$('#overlay-panel input,#overlay-panel select,#overlay-panel button')?.focus();});
  }
  function showSettings() {
    const s=state.settings;const wallpapers=[['aurora','Aurora'],['ocean','Oceano'],['dusk','Entardecer'],['minimal','Discreto']];
    showOverlay('settings','Ajustes do Maré',`<section class="settings-section"><h3>Aparência</h3><div class="theme-picker">${[['system','Automática'],['light','Clara'],['dark','Escura']].map(([value,label])=>`<button class="theme-choice" data-theme-choice="${value}" aria-pressed="${s.theme===value}">${label}</button>`).join('')}</div></section><section class="settings-section"><h3>Navegação</h3><div class="setting-row"><label for="search-engine">Mecanismo de pesquisa</label><select id="search-engine"><option value="duckduckgo">DuckDuckGo</option><option value="google">Google</option><option value="bing">Bing</option></select></div><div class="setting-row"><label for="restore-session">Continuar de onde parei<small>Reabrir as abas comuns ao iniciar o Maré.</small></label><label class="switch"><input id="restore-session" type="checkbox" ${s.restore_session?'checked':''}><span></span></label></div></section><section class="settings-section"><h3>Página inicial</h3><div class="wallpaper-picker">${wallpapers.map(([value,label])=>`<button class="wallpaper-choice wallpaper ${value}" data-wallpaper="${value}" aria-pressed="${s.home_background===value}"><span class="landscape" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${label}</button>`).join('')}</div></section><section class="settings-section"><h3>Dados de navegação</h3><div class="setting-row"><div class="setting-label">Histórico<small>${state.history.length} ${state.history.length===1?'página registrada':'páginas registradas'}</small></div><button class="button" id="clear-history">Limpar histórico…</button></div><div class="setting-row"><div class="setting-label">Cookies e dados dos sites<small>Limpar pode encerrar sessões nos sites.</small></div><button class="button danger" id="clear-data">Limpar dados…</button></div></section><p class="about-footer">Maré ${esc(state.version)} · Navegador de código aberto<br>Interface inspirada no Safari. Projeto independente.</p>`);
    $('#search-engine').value=s.search_engine;
    $$('[data-theme-choice]').forEach(el=>el.addEventListener('click',()=>{changeSettings({theme:el.dataset.themeChoice});$$('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button===el)));}));
    $$('[data-wallpaper]').forEach(el=>el.addEventListener('click',()=>{changeSettings({home_background:el.dataset.wallpaper});$$('[data-wallpaper]').forEach(button=>button.setAttribute('aria-pressed',String(button===el)));}));
    $('#search-engine').addEventListener('change',e=>changeSettings({search_engine:e.target.value}));
    $('#restore-session').addEventListener('change',e=>changeSettings({restore_session:e.target.checked}));
    $('#clear-history').addEventListener('click',confirmHistory);$('#clear-data').addEventListener('click',confirmData);
  }
  function changeSettings(values) {state.settings={...state.settings,...values};applyTheme();send({cmd:'settings',settings:state.settings});}
  function showBookmarkDialog(item) {
    const current=active();ui.editing=item?.id??null;
    showOverlay('bookmark',item?'Editar favorito':'Adicionar favorito',`<form id="bookmark-form"><div class="dialog-field"><label for="bookmark-title">Nome</label><input id="bookmark-title" value="${esc(item?.title || (!isStart(current)?current.title:''))}" placeholder="Nome do site" required maxlength="160"></div><div class="dialog-field"><label for="bookmark-url">Endereço</label><input id="bookmark-url" value="${esc(item?.url || (!isStart(current)?current.url:''))}" placeholder="https://exemplo.com" required spellcheck="false" autocomplete="url"></div><div class="field-error" id="bookmark-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" id="bookmark-cancel">Cancelar</button><button type="submit" class="button primary">${item?'Salvar':'Adicionar'}</button></div></form>`);
    $('#bookmark-cancel').addEventListener('click',closeTransient);
    $('#bookmark-form').addEventListener('submit',e=>{
      e.preventDefault();let url=$('#bookmark-url').value.trim();if(!/^\w+:/.test(url))url=`https://${url}`;
      try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname)throw new Error();url=parsed.href;}catch{$('#bookmark-error').textContent='Digite um endereço válido que comece com http:// ou https://.';$('#bookmark-url').focus();return;}
      const title=$('#bookmark-title').value.trim()||hostname(url);if(item)send({cmd:'remove_bookmark',id:item.id});send({cmd:'add_bookmark',url,title});closeTransient();notify(item?'Favorito atualizado.':'Favorito adicionado.');
    });
  }
  function confirmHistory() {showOverlay('confirm','Limpar histórico?',`<p class="dialog-intro">Os endereços das páginas visitadas serão removidos do Maré. Seus favoritos e sua Lista de Leitura serão mantidos.</p><div class="dialog-actions"><button class="button" id="confirm-cancel">Cancelar</button><button class="button primary" id="confirm-clear">Limpar histórico</button></div>`);$('#confirm-cancel').onclick=closeTransient;$('#confirm-clear').onclick=()=>{send({cmd:'clear_history'});closeTransient();notify('Histórico limpo.');};}
  function confirmData() {showOverlay('confirm','Limpar dados dos sites?',`<p class="dialog-intro">Isso remove cookies, cache e armazenamento dos sites deste perfil. Você poderá precisar entrar nas suas contas novamente.</p><div class="dialog-actions"><button class="button" id="confirm-cancel">Cancelar</button><button class="button primary" id="confirm-clear">Limpar dados</button></div>`);$('#confirm-cancel').onclick=closeTransient;$('#confirm-clear').onclick=()=>{send({cmd:'clear_data'});closeTransient();};}
  function showOverview() {showOverlay('overview',`${state.tabs.length} ${state.tabs.length===1?'aba aberta':'abas abertas'}`,'','overview-panel');renderOverview();}
  function renderOverview() {
    $('#overlay-panel').innerHTML=`<div class="dialog-heading"><h2 id="overlay-title">${state.tabs.length} ${state.tabs.length===1?'aba aberta':'abas abertas'}</h2><button class="button" id="overview-new">Nova aba</button><button class="icon-button" data-dialog-close aria-label="Fechar visão geral">${icon('close')}</button></div><div class="overview-grid">${state.tabs.map(tab=>`<div class="overview-card${tab.id===state.active_id?' active':''}"><button class="overview-close" data-overview-close="${tab.id}" aria-label="Fechar ${esc(tab.title)}">${icon('close')}</button><button data-overview-tab="${tab.id}" style="width:100%;padding:0;text-align:left;color:inherit"><span class="overview-preview">${isStart(tab)?`<span class="landscape" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${icon(tab.private?'private':'compass')}`:icon(tab.private?'private':'globe')}</span><span class="overview-title">${esc(tab.title || hostname(tab.url))}</span><span class="overview-domain">${esc(hostname(tab.url))}${tab.private?' · Privada':''}</span></button></div>`).join('')}</div>`;
    $('[data-dialog-close]').onclick=closeTransient;$('#overview-new').onclick=()=>newTab();
    $$('[data-overview-tab]').forEach(el=>el.onclick=()=>{closeTransient();send({cmd:'activate',id:Number(el.dataset.overviewTab)});});
    $$('[data-overview-close]').forEach(el=>el.onclick=()=>send({cmd:'close_tab',id:Number(el.dataset.overviewClose)}));
  }
  function showFind() {closeTransient();ui.find=true;$('#find-bar').hidden=false;$('#find-input').focus();$('#find-input').select();updateLayout();}
  function closeFind() {ui.find=false;$('#find-bar').hidden=true;send({cmd:'find',query:'',direction:'next'});updateLayout();}
  function find(direction='next') {send({cmd:'find',query:$('#find-input').value,direction});}
  function setZoom(factor) {ui.zoom=Math.max(.5,Math.min(3,Math.round(factor*10)/10));send({cmd:'zoom',factor:ui.zoom});notify(`Zoom: ${Math.round(ui.zoom*100)}%`);}
  function showZoom() {showPopup(menuItem('plus','Ampliar','zoom-in','Ctrl++')+menuItem('zoom',`${Math.round(ui.zoom*100)}% — tamanho real`,'zoom-reset','Ctrl+0')+menuItem('close','Reduzir','zoom-out','Ctrl+−'),$('#more-button'),'zoom');}
  function shortcut(key,shift=false) {
    const k=key.toLowerCase();
    if(k==='l'){focusAddress();return true;}if(k==='t'){shift?send({cmd:'reopen_tab'}):newTab();return true;}
    if(k==='w'){send({cmd:'close_tab',id:state.active_id});return true;}if(k==='tab'){cycleTabs(shift?-1:1);return true;}
    if(k==='n'&&shift){newTab(true);return true;}if(k==='f'){showFind();return true;}
    if(k==='d'){menuAction('bookmark');return true;}if(k==='h'){toggleSidebar('history');return true;}
    if(k==='j'){showDownloads();return true;}if(k==='b'){toggleSidebar();return true;}
    if(k==='p'){send({cmd:'print'});return true;}if(k==='r'||k==='reload'){send({cmd:shift&&k==='r'?'reader':'reload'});return true;}
    if(k==='+'||k==='='){setZoom(ui.zoom+.1);return true;}if(k==='-'){setZoom(ui.zoom-.1);return true;}if(k==='0'){setZoom(1);return true;}
    return false;
  }
  function preview(command) {
    const tab=active();let changed=true;
    switch(command.cmd){
      case 'ready':case 'layout':return;
      case 'new_tab':{const id=Math.max(...state.tabs.map(t=>t.id),0)+1;state.tabs.push({id,title:command.url==='mare://start'?'Página inicial':hostname(command.url),url:command.url,private:command.private,pinned:false,loading:false,can_go_back:false,can_go_forward:false});state.active_id=id;break;}
      case 'navigate':{let url=command.url;if(!/^https?:\/\//i.test(url)&&url!=='mare://start')url=/^[^\s]+\.[^\s]+$/.test(url)?`https://${url}`:`https://duckduckgo.com/?q=${encodeURIComponent(url)}`;tab.url=url;tab.title=hostname(url);break;}
      case 'activate':state.active_id=command.id;break;
      case 'close_tab':{const item=state.tabs.find(t=>t.id===command.id);if(item)previouslyClosed.push({...item});state.tabs=state.tabs.filter(t=>t.id!==command.id);if(!state.tabs.length){state.tabs=[{id:1,title:'Página inicial',url:'mare://start',private:false}];}if(!state.tabs.some(t=>t.id===state.active_id))state.active_id=state.tabs.at(-1).id;break;}
      case 'reopen_tab':{const item=previouslyClosed.pop();if(item){item.id=Math.max(...state.tabs.map(t=>t.id))+1;state.tabs.push(item);state.active_id=item.id;}break;}
      case 'duplicate_tab':{const t=state.tabs.find(t=>t.id===command.id);if(t){const id=Math.max(...state.tabs.map(t=>t.id))+1;state.tabs.push({...t,id});state.active_id=id;}break;}
      case 'pin_tab':{const t=state.tabs.find(t=>t.id===command.id);if(t)t.pinned=!t.pinned;break;}
      case 'close_other_tabs':state.tabs=state.tabs.filter(t=>t.id===command.id);state.active_id=command.id;break;
      case 'reorder_tabs':state.tabs=command.ids.map(id=>state.tabs.find(t=>t.id===id)).filter(Boolean);break;
      case 'add_bookmark':state.bookmarks.push({id:Date.now(),url:command.url,title:command.title});break;
      case 'remove_bookmark':state.bookmarks=state.bookmarks.filter(b=>b.id!==command.id);break;
      case 'toggle_bookmark':{const index=state.bookmarks.findIndex(b=>b.url===tab.url);if(index>=0)state.bookmarks.splice(index,1);else state.bookmarks.push({id:Date.now(),title:tab.title,url:tab.url});break;}
      case 'add_reading':if(!state.reading_list.some(r=>r.url===tab.url)){state.reading_list.push({id:Date.now(),title:tab.title,url:tab.url,read:false});notify('Página adicionada à Lista de Leitura.');}break;
      case 'remove_reading':state.reading_list=state.reading_list.filter(r=>r.id!==command.id);break;
      case 'mark_read':{const r=state.reading_list.find(r=>r.id===command.id);if(r)r.read=!r.read;break;}
      case 'settings':state.settings={...state.settings,...command.settings};break;
      case 'clear_history':state.history=[];break;
      case 'window':changed=false;notify('Os controles da janela funcionam no aplicativo Maré.');break;
      case 'copy_url':copyUrl();return;
      default:changed=false;
    }
    if(changed)render();
  }
  hydrateIcons();
  $('#address-form').addEventListener('submit',e=>{e.preventDefault();const choices=$$('[data-suggest]',$('#suggestions'));if(!$('#suggestions').hidden&&ui.suggestion>=0&&choices[ui.suggestion])navigate(choices[ui.suggestion].dataset.suggest);else if($('#address').value.trim())navigate($('#address').value.trim());});
  $('#address').addEventListener('focus',()=>{renderSuggestions();});
  $('#address').addEventListener('input',()=>{clearTimeout(suggestionTimer);suggestionTimer=setTimeout(renderSuggestions,70);});
  $('#address').addEventListener('keydown',e=>{
    if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const choices=$$('[data-suggest]',$('#suggestions'));if(!choices.length)return;ui.suggestion=(ui.suggestion+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices.forEach((el,i)=>el.setAttribute('aria-selected',String(i===ui.suggestion)));}
    if(e.key==='Escape'){closeTransient();$('#address').value=isStart(active())?'':active().url;$('#address').blur();}
  });
  $('#back').onclick=()=>send({cmd:'back'});$('#forward').onclick=()=>send({cmd:'forward'});
  $('#reload').onclick=()=>send({cmd:active().loading?'stop':'reload'});
  $('#reader-button').onclick=()=>send({cmd:'reader'});
  $('#sidebar-toggle').onclick=()=>toggleSidebar();$('#sidebar-close').onclick=()=>toggleSidebar();
  $('#sidebar-start').onclick=()=>navigate('mare://start');$('#new-tab').onclick=()=>newTab();
  $('#private-button').onclick=()=>newTab(true);$('#share-button').onclick=()=>ui.popup==='share'?closeTransient():showShare();
  $('#more-button').onclick=()=>ui.popup==='more'?closeTransient():showMore();
  $('#downloads-button').onclick=()=>ui.popup==='downloads'?closeTransient():showDownloads();
  $('#overview-button').onclick=()=>ui.overlay==='overview'?closeTransient():showOverview();
  $('#settings-button').onclick=showSettings;$('#customize').onclick=showSettings;$('#add-favorite').onclick=()=>showBookmarkDialog();
  $('#sidebar-add').onclick=()=>ui.section==='reading'?menuAction('reading'):showBookmarkDialog();
  $('#reading-all').onclick=()=>toggleSidebar('reading');$('#history-all').onclick=()=>toggleSidebar('history');
  $$('[data-section]').forEach(el=>el.onclick=()=>{ui.section=el.dataset.section;ui.query='';$('#library-search').value='';renderSidebar();});
  $('#library-search').addEventListener('input',e=>{ui.query=e.target.value;renderSidebar();});
  $('#site-info').onclick=()=>{const tab=active();showPopup(`<div class="popup-info"><strong>${esc(isStart(tab)?'Maré':hostname(tab.url))}</strong><p>${esc(isStart(tab)?'Seu navegador de código aberto.':tab.url.startsWith('https:')?'Esta página usa uma conexão HTTPS.':'Esta página usa uma conexão HTTP sem criptografia.')}</p>${tab.private?'<p>Esta aba não salva o histórico de páginas visitadas.</p>':''}</div>`,$('#site-info'),'info');};
  $('#find-bar').onsubmit=e=>{e.preventDefault();find();};$('#find-input').oninput=()=>{clearTimeout(findTimer);findTimer=setTimeout(()=>find(),180);};
  $('#find-prev').onclick=()=>find('previous');$('#find-close').onclick=closeFind;
  $$('[data-window]').forEach(el=>el.onclick=()=>send({cmd:'window',action:el.dataset.window}));
  $('#titlebar').addEventListener('mousedown',e=>{if(e.button===0&&!e.target.closest('button,input,form'))send({cmd:'window',action:'drag'});});
  $('#titlebar').addEventListener('dblclick',e=>{if(!e.target.closest('button,input,form'))send({cmd:'window',action:'maximize'});});
  document.addEventListener('mousedown',e=>{if(!$('#popup').hidden&&!e.target.closest('#popup')&&!e.target.closest('#share-button,#more-button,#downloads-button,#site-info')){$('#popup').hidden=true;ui.popup=null;updateLayout();}if(!$('#suggestions').hidden&&!e.target.closest('#suggestions,#address-form')){$('#suggestions').hidden=true;$('#address').setAttribute('aria-expanded','false');updateLayout();}});
  $('#overlay').addEventListener('mousedown',e=>{if(e.target===$('#overlay'))closeTransient();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(!$('#overlay').hidden||!$('#popup').hidden||!$('#suggestions').hidden)closeTransient();else if(ui.find)closeFind();else send({cmd:'stop'});return;}
    if(e.key==='F12'){e.preventDefault();send({cmd:'devtools'});return;}
    if(e.key==='F5'){e.preventDefault();send({cmd:'reload'});return;}
    if(e.key==='F6'){e.preventDefault();focusAddress();return;}
    if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();send({cmd:'back'});return;}if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();send({cmd:'forward'});return;}
    if((e.ctrlKey||e.metaKey)&&shortcut(e.key,e.shiftKey)){e.preventDefault();return;}
    if(e.key==='Tab'&&!$('#overlay').hidden){const items=$$('button,input,select,[tabindex="0"]',$('#overlay-panel')).filter(el=>!el.disabled&&!el.hidden);if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  window.addEventListener('resize',()=>{if(!$('#suggestions').hidden)renderSuggestions();updateLayout();});
  new ResizeObserver(updateLayout).observe($('#viewport'));
  media.addEventListener('change',applyTheme);
  window.mare={receive,notify,shortcut,focusAddress,showSettings,copy};
  render();send({cmd:'ready'});
})();
