const express=require('express');
const http=require('http');
const crypto=require('crypto');
const {Server}=require('socket.io');
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.json());
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'1234';
const adminTokens=new Set();
app.post('/api/admin-login',(req,res)=>{
  const pw=String(req.body?.password||'');
  if(pw!==ADMIN_PASSWORD)return res.status(401).json({ok:false,msg:'密碼錯誤'});
  const token=crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ok:true,token});
});
app.use(express.static('public'));
io.use((socket,next)=>{
  const token=String(socket.handshake.auth?.adminToken||'');
  socket.data.isAdmin=adminTokens.has(token);
  next();
});

const rooms=new Map();
const code=()=>String(Math.floor(100000+Math.random()*900000));
function onlineCount(r){return [...r.players.values()].filter(p=>p.online).length}
function clean(r){return {code:r.code,settings:r.settings,state:r.state,online:onlineCount(r),players:[...r.players.values()].map(p=>({name:p.name,score:p.score||0,time:p.time??null,done:!!p.done,online:!!p.online})),countdownEnds:r.countdownEnds||null,started:r.started||null,gameEnds:r.gameEnds||null,gameId:r.gameId||null}}
function rank(r){return [...r.players.values()].sort((a,b)=>(b.score||0)-(a.score||0)||((a.time??1e12)-(b.time??1e12))).map((p,i)=>({name:p.name,score:p.score||0,time:p.time??null,done:!!p.done,rank:i+1}))}
function emit(r){io.to(r.code).emit('room',clean(r));io.to(r.code).emit('ranking',rank(r));}
function clearTimers(r){if(r.timer)clearTimeout(r.timer);if(r.countdownTimer)clearInterval(r.countdownTimer);if(r.gameTicker)clearInterval(r.gameTicker);if(r.scheduleTimer)clearTimeout(r.scheduleTimer);r.timer=r.countdownTimer=r.gameTicker=r.scheduleTimer=null}
function clearPlayTimers(r){if(r.timer)clearTimeout(r.timer);if(r.countdownTimer)clearInterval(r.countdownTimer);if(r.gameTicker)clearInterval(r.gameTicker);r.timer=r.countdownTimer=r.gameTicker=null}
function finish(r,reason){if(!r||r.state==='finished')return;r.state='finished';clearTimers(r);emit(r);io.to(r.code).emit('finished',{reason,ranking:rank(r)});}
function gameMs(settings){if(String(settings.gameMinutes)==='unlimited')return null;const n=Number(settings.gameMinutes);return Number.isFinite(n)&&n>0?n*60000:3*60000}
function beginCountdown(r){
  if(!r||r.state!=='waiting')return;
  if(r.scheduleTimer){clearTimeout(r.scheduleTimer);r.scheduleTimer=null}
  clearPlayTimers(r);
  r.state='countdown';
  for(const p of r.players.values()){p.score=0;p.time=null;p.done=false}
  const seconds=Math.max(1,Number(r.settings.startCountdown)||5);
  r.countdownEnds=Date.now()+seconds*1000;
  emit(r);
  const tick=()=>{
    const left=Math.max(0,Math.ceil((r.countdownEnds-Date.now())/1000));
    io.to(r.code).emit('countdownTick',left);
    if(left<=0){
      clearInterval(r.countdownTimer);r.countdownTimer=null;
      r.state='playing';r.started=Date.now();r.gameId=`${r.code}-${r.started}`;r.gameSeed=Math.floor(Math.random()*0x7fffffff);
      const ms=gameMs(r.settings);
      r.gameEnds=ms? r.started+ms : null;
      emit(r);
      io.to(r.code).emit('go',{settings:r.settings,gameSeed:r.gameSeed,gameEnds:r.gameEnds,started:r.started,gameId:r.gameId});
      if(ms){
        const gameTick=()=>{const remain=Math.max(0,r.gameEnds-Date.now());io.to(r.code).emit('gameTime',remain)};
        gameTick();r.gameTicker=setInterval(gameTick,1000);r.timer=setTimeout(()=>finish(r,'時間到'),ms);
      }else{
        io.to(r.code).emit('gameTime',null);
      }
    }
  };
  tick();r.countdownTimer=setInterval(tick,250);
}
function scheduleIfNeeded(r){
  if(r.scheduleTimer){clearTimeout(r.scheduleTimer);r.scheduleTimer=null}
  if(r.state!=='waiting')return;
  const use=!!r.settings.useScheduledStart;
  const at=Number(r.settings.scheduledAt)||0;
  if(!use||!at)return;
  const wait=at-Date.now();
  if(wait<=0){beginCountdown(r);return}
  r.scheduleTimer=setTimeout(()=>{if((Number(r.settings.scheduledAt)||0)>Date.now())scheduleIfNeeded(r);else beginCountdown(r)},Math.min(wait,2147483647));
}

io.on('connection',s=>{
  s.on('createRoom',(settings,cb)=>{
    if(!s.data.isAdmin)return cb?.({ok:false,msg:'主控驗證失敗，請重新登入'});
    let c;do c=code();while(rooms.has(c));
    let r={code:c,settings,state:'waiting',players:new Map(),timer:null,countdownTimer:null,gameTicker:null,scheduleTimer:null,countdownEnds:null,started:null,gameEnds:null,gameId:null,gameSeed:null};
    rooms.set(c,r);s.join(c);s.data.admin=c;scheduleIfNeeded(r);emit(r);cb?.({ok:true,code:c});
  });
  s.on('saveSettings',({code,settings})=>{
    let r=rooms.get(code);
    if(r&&s.data.admin===code&&r.state==='waiting'){r.settings=settings;scheduleIfNeeded(r);emit(r)}
  });
  s.on('peekRoom',({code},cb)=>{
    const r=rooms.get(String(code||''));
    if(!r)return cb?.({ok:false,msg:'找不到房間'});
    cb?.({ok:true,state:r.state,settings:r.settings,countdownEnds:r.countdownEnds||null,started:r.started||null,gameEnds:r.gameEnds||null,gameId:r.gameId||null});
  });
  s.on('join',({code,name},cb)=>{
    let r=rooms.get(String(code||''));
    if(!r)return cb?.({ok:false,msg:'找不到房間'});
    name=String(name||'').trim().slice(0,20);
    if(!name)return cb?.({ok:false,msg:'請輸入玩家名稱'});
    let key=name.toLowerCase();let p=r.players.get(key);const returning=!!p;
    if(!p){
      if(r.state!=='waiting')return cb?.({ok:false,msg:'比賽已開始，無法加入新玩家'});
      p={name,score:0,time:null,done:false,online:true};r.players.set(key,p);
    }else p.online=true;
    s.join(r.code);s.data.room=r.code;s.data.key=key;emit(r);
    cb?.({ok:true,returning,room:clean(r),resume:r.state==='playing'?{settings:r.settings,gameSeed:r.gameSeed,gameEnds:r.gameEnds,started:r.started,gameId:r.gameId}:null});
  });
  s.on('start',({code})=>{let r=rooms.get(code);if(!r||s.data.admin!==code||r.state!=='waiting')return;beginCountdown(r)});
  s.on('progress',({score,time,done},cb)=>{
    let r=rooms.get(s.data.room),p=r?.players.get(s.data.key);if(!r||!p||r.state!=='playing')return cb?.({ok:false});
    p.score=Math.max(0,Number(score)||0);
    const newlyDone=!!done&&!p.done;
    if(newlyDone){p.time=Math.max(0,Number(time)||0);p.done=true}
    emit(r);
    const rs=rank(r);const mine=rs.find(x=>x.name.toLowerCase()===p.name.toLowerCase());
    if(newlyDone){s.emit('completed',{ranking:rs,mine});}
    cb?.({ok:true,ranking:rs,mine});
    if(newlyDone){
      let n=[...r.players.values()].filter(x=>x.done).length,goal=r.settings.finishGoal;
      if(goal!=='all'){
        let g=Number(goal);if(g&&n>=g)finish(r,g===1?'第一位完成':`前 ${g} 位完成`)
      }else if(r.players.size&&n===r.players.size)finish(r,'全部玩家完成');
    }
  });
  s.on('deleteRoom',({code})=>{let r=rooms.get(code);if(r&&s.data.admin===code){clearTimers(r);io.to(code).emit('deleted');rooms.delete(code)}});
  s.on('disconnect',()=>{let r=rooms.get(s.data.room),p=r?.players.get(s.data.key);if(p){p.online=false;emit(r)}});
});
server.listen(process.env.PORT||3000,()=>console.log('Memory King running on '+(process.env.PORT||3000)));
