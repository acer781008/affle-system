if(!sessionStorage.mkAdminToken)location='admin-login.html';
const s=io({auth:{adminToken:sessionStorage.mkAdminToken}});let room='';const $=id=>document.getElementById(id);
function settings(){
  const useScheduledStart=$('useScheduledStart').checked;
  const raw=$('scheduledAt').value;
  return {type:$('type').value,difficulty:$('difficulty').value,boardSize:$('boardSize').value,startCountdown:+$('startCountdown').value,gameMinutes:$('gameMinutes').value,finishGoal:$('finishGoal').value,note:$('note').value,useScheduledStart,scheduledAt:useScheduledStart&&raw?new Date(raw).getTime():null};
}
function notice(id,text){$(id).textContent=text;setTimeout(()=>{if($(id).textContent===text)$(id).textContent=''},1800)}
async function copyText(text,id='copyMsg'){try{await navigator.clipboard.writeText(text);notice(id,'✓ 已複製')}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();notice(id,'✓ 已複製')}}
$('useScheduledStart').onchange=()=>{$('scheduledAt').disabled=!$('useScheduledStart').checked};
$('newRoom').onclick=()=>s.emit('createRoom',settings(),x=>{if(!x?.ok){alert(x?.msg||'建立房間失敗');sessionStorage.removeItem('mkAdminToken');location='admin-login.html';return}room=x.code;$('code').textContent=room;$('state').textContent='等待玩家';$('startTimer').textContent='--';$('gameTimer').textContent='--:--'});
$('save').onclick=()=>{if(room)s.emit('saveSettings',{code:room,settings:settings()});notice('saved','✓ 已儲存')};
$('start').onclick=()=>room&&s.emit('start',{code:room});
$('del').onclick=()=>{if(room&&confirm('確定刪除房間？'))s.emit('deleteRoom',{code:room})};
function url(){return location.origin+'/player.html?room='+room}
$('copyUrl').onclick=()=>room?copyText(url()):notice('copyMsg','請先產生房號');
$('copyShare').onclick=()=>{if(!room)return notice('copyMsg','請先產生房號');let a=settings(),t={farm:'種菜素材',idiom:'成語',poem:'唐詩'}[a.type],gm=a.gameMinutes==='unlimited'?'無限制':`${a.gameMinutes}分鐘`,sched=a.useScheduledStart&&a.scheduledAt?new Date(a.scheduledAt).toLocaleString('zh-TW'):'未設定';copyText(`🃏 翻牌記憶王\n房號：${room}\n玩法：${t}｜${a.difficulty}｜${a.boardSize}\n開始倒數：${a.startCountdown}秒\n遊戲時間：${gm}\n完成條件：${a.finishGoal==='all'?'♾ 無限制／全部玩完':a.finishGoal==='1'?'第一位完成':`前${a.finishGoal}位完成`}\n開賽日期時間：${sched}\n備註：${a.note||'無'}\n玩家連結：${url()}`)};
$('copyRank').onclick=()=>{let rows=[...$('rank').children];if(!rows.length)return notice('rankMsg','目前沒有排行榜資料');copyText(['排名｜玩家｜分數｜完成時間',...rows.map(tr=>[...tr.children].map(x=>x.textContent).join('｜'))].join('\n'),'rankMsg')};
s.on('room',r=>{if(room&&r.code!==room)return;$('count').textContent=r.online??r.players.length;$('state').textContent={waiting:'等待玩家加入',countdown:'準備開始・倒數中',playing:'遊戲進行中',finished:'本局已結束'}[r.state]||r.state;if(r.state==='waiting'){$('startTimer').textContent='--';$('gameTimer').textContent='--:--'}});
s.on('countdownTick',n=>{$('state').textContent='準備開始・倒數中';$('startTimer').textContent=n>0?n+' 秒':'開始！'});
s.on('gameTime',ms=>{$('state').textContent='遊戲進行中';$('startTimer').textContent='已開始';$('gameTimer').textContent=ms==null?'∞':fmt(ms)});
s.on('ranking',rs=>$('rank').innerHTML=rs.map(p=>`<tr><td>${p.rank}</td><td>${esc(p.name)}</td><td>${p.score||0}</td><td>${p.time==null?'—':fmt(p.time)}</td></tr>`).join(''));
s.on('finished',()=>{$('state').textContent='本局已結束';$('startTimer').textContent='—';if($('gameTimer').textContent!=='∞')$('gameTimer').textContent='00:00'});
s.on('deleted',()=>{alert('房間已刪除');location.reload()});
function fmt(ms){let x=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`}
function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
