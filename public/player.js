const s=io(),$=id=>document.getElementById(id);
let code='',me='',cfg=null,startAt=0,score=0,lock=false,first=null,cards=[],ticker=null,currentGameId=null,currentGameSeed=1,completed=false,latestRanking=[],joinedOnce=false;
const idioms=['守株|待兔','畫蛇|添足','一心|一意','自相|矛盾','亡羊|補牢','井底|之蛙','掩耳|盜鈴','刻舟|求劍','狐假|虎威','胸有|成竹','雪中|送炭','錦上|添花','半途|而廢','水落|石出','大驚|小怪','東張|西望','七上|八下','三心|二意','九牛|一毛','四面|八方','異口|同聲','手忙|腳亂','天長|地久','風平|浪靜','千言|萬語','百發|百中','五花|八門','一舉|兩得','名列|前茅','聚精|會神','全神|貫注','迫不|及待'];
const poems=['床前明月光|疑是地上霜','舉頭望明月|低頭思故鄉','白日依山盡|黃河入海流','欲窮千里目|更上一層樓','春眠不覺曉|處處聞啼鳥','夜來風雨聲|花落知多少','兩個黃鸝鳴翠柳|一行白鷺上青天','窗含西嶺千秋雪|門泊東吳萬里船','松下問童子|言師採藥去','只在此山中|雲深不知處','慈母手中線|遊子身上衣','誰言寸草心|報得三春暉','離離原上草|一歲一枯榮','野火燒不盡|春風吹又生','空山不見人|但聞人語響','返景入深林|復照青苔上','月落烏啼霜滿天|江楓漁火對愁眠','姑蘇城外寒山寺|夜半鐘聲到客船','朝辭白帝彩雲間|千里江陵一日還','兩岸猿聲啼不住|輕舟已過萬重山','千山鳥飛絕|萬徑人蹤滅','孤舟蓑笠翁|獨釣寒江雪','危樓高百尺|手可摘星辰','不敢高聲語|恐驚天上人','小時不識月|呼作白玉盤','又疑瑤台鏡|飛在青雲端','獨在異鄉為異客|每逢佳節倍思親','遙知兄弟登高處|遍插茱萸少一人','故人西辭黃鶴樓|煙花三月下揚州','孤帆遠影碧空盡|唯見長江天際流','葡萄美酒夜光杯|欲飲琵琶馬上催','醉臥沙場君莫笑|古來征戰幾人回'];
const roomInput=$('room'),nameInput=$('name'),joinPanel=$('join'),waitPanel=$('wait'),gamePanel=$('game'),topBar=$('top'),overlayEl=$('overlay'),msgEl=$('msg'),roomShowEl=$('roomShow'),rulesEl=$('rules'),timerEl=$('timer'),boardEl=$('board'),resultEl=$('result'),latePanel=$('late');
roomInput.value=new URLSearchParams(location.search).get('room')||'';
const savedName=roomInput.value?localStorage.getItem('mk:'+roomInput.value+':name'):'';if(savedName)nameInput.value=savedName;
if(roomInput.value){s.emit('peekRoom',{code:roomInput.value},r=>{if(!r?.ok)return;if(r.state!=='waiting'&&!savedName){joinPanel.classList.add('hidden');latePanel.classList.remove('hidden');$('lateMsg').textContent=r.state==='finished'?'本局已結束':'比賽已開始';}})}
$('joinBtn').onclick=()=>{
  code=roomInput.value.trim();me=nameInput.value.trim();
  if(!code){msgEl.textContent='請使用主控分享的玩家網址進入';return}
  if(!me){msgEl.textContent='請輸入玩家名稱';return}
  s.emit('join',{code,name:me},r=>{
    if(!r?.ok){msgEl.textContent=r?.msg||'加入失敗';return}
    cfg=r.room.settings;joinedOnce=true;localStorage.setItem('mk:'+code+':name',me);joinPanel.classList.add('hidden');roomShowEl.textContent=code;rulesEl.textContent=ruleText(cfg);
    if(r.room.state==='playing'&&r.resume){startGame(r.resume.gameSeed,r.resume.gameId,r.resume.started,r.resume.gameEnds,true);return}
    waitPanel.classList.remove('hidden');
    if(r.room.state==='countdown'&&r.room.countdownEnds)runLocalCountdown(r.room.countdownEnds);
  })
};
function runLocalCountdown(ends){clearInterval(window._joinCountdown);const tick=()=>{const n=Math.max(0,Math.ceil((ends-Date.now())/1000));overlayEl.classList.remove('hidden');overlayEl.textContent=n>0?n:'開始！';if(n<=0){clearInterval(window._joinCountdown);setTimeout(()=>overlayEl.classList.add('hidden'),500)}};tick();window._joinCountdown=setInterval(tick,250)}

s.on('connect',()=>{
  if(!joinedOnce||!code||!me)return;
  s.emit('join',{code,name:me},r=>{
    if(!r?.ok)return;
    cfg=r.room.settings;
    if(r.room.state==='playing'&&r.resume){waitPanel.classList.add('hidden');startGame(r.resume.gameSeed,r.resume.gameId,r.resume.started,r.resume.gameEnds,true)}
    else if(r.room.state==='countdown'&&r.room.countdownEnds){waitPanel.classList.remove('hidden');runLocalCountdown(r.room.countdownEnds)}
  });
});
s.on('countdownTick',n=>{overlayEl.classList.remove('hidden');overlayEl.textContent=n>0?n:'開始！';if(n<=0)setTimeout(()=>overlayEl.classList.add('hidden'),500)});
s.on('go',x=>{cfg=x.settings;waitPanel.classList.add('hidden');gamePanel.classList.remove('hidden');topBar.classList.remove('hidden');overlayEl.classList.add('hidden');startGame(x.gameSeed,x.gameId,x.started,x.gameEnds,false)});
s.on('gameTime',ms=>{if(!gamePanel.classList.contains('hidden')||completed)timerEl.textContent=ms==null?'∞':fmt(ms)});
s.on('ranking',rs=>{latestRanking=rs;if(completed)renderCompleted(false)});
s.on('completed',x=>{latestRanking=x.ranking||latestRanking;completed=true;clearInterval(ticker);lock=true;renderCompleted(false,x.mine)});
s.on('finished',x=>{latestRanking=x.ranking||latestRanking;completed=true;clearInterval(ticker);lock=true;renderCompleted(true,null,x.reason)});
function startGame(seed,gameId,started,gameEnds,resume){
  cfg=cfg||{};currentGameSeed=seed||1;currentGameId=gameId||`${code}-${started||Date.now()}`;completed=false;resultEl.classList.add('hidden');gamePanel.classList.remove('hidden');topBar.classList.remove('hidden');
  const stored=loadState();
  if(stored&&stored.gameId===currentGameId){score=stored.score||0;startAt=stored.startAt||started||Date.now();cards=stored.cards||[];renderBoard(stored.matched||[]);if((stored.matched||[]).length===cards.length&&cards.length){completed=true;lock=true;setTimeout(()=>s.emit('progress',{score,time:Date.now()-startAt,done:true},x=>{if(x?.ok){latestRanking=x.ranking||[];renderCompleted(false,x.mine)}}),50)}}else{score=0;startAt=started||Date.now();build(personalSeed(seed));saveState([])}
  scoreEl();clearInterval(ticker);
  if(gameEnds){ticker=setInterval(()=>{timerEl.textContent=fmt(Math.max(0,gameEnds-Date.now()))},250);timerEl.textContent=fmt(Math.max(0,gameEnds-Date.now()))}else timerEl.textContent='∞';
}
function dims(){const v=String(cfg.boardSize||'4x5');const m=v.match(/(\d+)x(\d+)/);if(m)return [+m[1],+m[2]];const n=Number(cfg.cards)||20;const map={12:[3,4],16:[4,4],20:[4,5],24:[4,6],30:[5,6],36:[6,6],42:[6,7],48:[6,8],56:[7,8],64:[8,8]};return map[n]||[4,5]}
function build(seed){
  const [cols,rows]=dims(),pairs=cols*rows/2;let src=[];
  if(cfg.type==='farm'){for(let i=1;i<=144;i++)src.push([`assets/farm/farm-${String(i).padStart(3,'0')}.png`,`assets/farm/farm-${String(i).padStart(3,'0')}.png`])}
  else src=(cfg.type==='idiom'?idioms:poems).map(x=>x.split('|'));
  shuffle(src,seed);src=src.slice(0,pairs);cards=[];
  src.forEach((p,i)=>{cards.push({key:i,v:p[0],img:cfg.type==='farm'});cards.push({key:i,v:p[1],img:cfg.type==='farm'})});
  shuffle(cards,seed+17);renderBoard([])
}
function renderBoard(matched){const [cols]=dims();boardEl.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;boardEl.innerHTML=cards.map((c,i)=>`<div class="card${matched.includes(i)?' open matched':''}" data-i="${i}">${matched.includes(i)?cardInner(c):'<span>✦</span>'}</div>`).join('');[...boardEl.children].forEach(el=>el.onclick=()=>flip(el))}
function flip(el){if(lock||completed||el.classList.contains('open')||el.classList.contains('matched'))return;open(el);if(!first){first=el;return}lock=true;let a=cards[+first.dataset.i],b=cards[+el.dataset.i];if(a.key===b.key){setTimeout(()=>{first.classList.add('matched');el.classList.add('matched');const matchedEls=[...document.querySelectorAll('.card.matched')].map(x=>+x.dataset.i);first=null;lock=false;score+=10;scoreEl();saveState(matchedEls);let done=matchedEls.length===cards.length;s.emit('progress',{score,time:Date.now()-startAt,done},()=>{});},280)}else setTimeout(()=>{close(first);close(el);first=null;lock=false},650)}
function cardInner(c){return c.img?`<img src="${c.v}">`:`<span class="txt">${c.v}</span>`}
function open(el){let c=cards[+el.dataset.i];el.classList.add('open');el.innerHTML=cardInner(c)}
function close(el){if(!el)return;el.classList.remove('open');el.innerHTML='<span>✦</span>'}
function renderCompleted(final=false,mineOverride=null,reason=''){
  gamePanel.classList.add('hidden');resultEl.classList.remove('hidden');const mine=mineOverride||latestRanking.find(x=>x.name===me);const tm=mine?.time==null?'—':fmt(mine.time);const sec=mine?.time==null?'':`（${Math.floor(mine.time/1000)}秒）`;
  resultEl.innerHTML=`<h2>${final?'🏁 本局結束':'🎉 配對完成！'}</h2><div class="myresult"><b>${mine?`第 ${mine.rank} 名`:'已完成'}</b><span>⭐ ${mine?.score??score} 分</span><span>⏱ 完成時間 ${tm}${sec}</span></div>${!final?'<p class="status">已完成，等待其他玩家完成…</p>':`<p class="status">${reason||'遊戲結束'}</p>`}<h3>🏆 ${final?'最終':'目前'}排行榜</h3><table class="ranking"><thead><tr><th>排名</th><th>玩家</th><th>分數</th><th>完成時間</th></tr></thead><tbody>${latestRanking.map(p=>`<tr><td>${p.rank}</td><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.time==null?'—':fmt(p.time)}</td></tr>`).join('')}</tbody></table>`
}
function storageKey(){return `mk:${code}:game:${currentGameId}:${me}`}
function saveState(matched){if(!currentGameId||!me)return;localStorage.setItem(storageKey(),JSON.stringify({gameId:currentGameId,startAt,score,cards,matched}))}
function loadState(){if(!currentGameId||!me)return null;try{return JSON.parse(localStorage.getItem(storageKey())||'null')}catch{return null}}
function personalSeed(base){return ((Number(base)||1)^hash(code+'|'+me))>>>0}
function hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function shuffle(a,seed){let x=seed||1;for(let i=a.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;let j=x%(i+1);[a[i],a[j]]=[a[j],a[i]]}}
function fmt(ms){let x=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`}
function label(x){return {farm:'🌱 種菜素材',idiom:'🀄 成語',poem:'📜 唐詩'}[x]}
function ruleText(c){const gm=String(c.gameMinutes)==='unlimited'?'無限制':`${c.gameMinutes}分鐘`;return `${label(c.type)}｜${c.difficulty}｜${c.boardSize||c.cards+'張'}｜${gm}`}
function scoreEl(){$('score').textContent=score}
function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
