const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const crypto=require('crypto');
const path=require('path');
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.json({limit:'300kb'}));
app.use(express.static(path.join(__dirname,'public')));

const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD || '8888';
const rooms=new Map();
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const token=()=>crypto.randomBytes(18).toString('hex');
const cleanName=v=>String(v||'').trim().slice(0,30);
const cleanDevice=v=>String(v||'').trim().slice(0,120);
const defaultRain=()=>({
  subMode:'A',speed:'fast',density:'high',sound:true,maxWins:1,
  A:{duration:30,targetPackets:20,maxPlays:3},
  B:{duration:20,packetLimit:1,maxPlays:1},
  C:{duration:30,targetScore:50,difficulty:'normal',maxPlays:3}
});
function normalizeRain(x,old){
  x=x||{};old=old||defaultRain();
  const d=defaultRain(), oldA=old.A||{},oldB=old.B||{},oldC=old.C||{};
  const inA=x.A||{},inB=x.B||{},inC=x.C||{};
  const allowedPlays=v=>[1,2,3,5,10].includes(+v)?+v:null;
  return {
    subMode:['A','B','C'].includes(x.subMode)?x.subMode:(old.subMode||'A'),
    speed:['normal','fast','turbo'].includes(x.speed)?x.speed:(old.speed||d.speed),
    density:['normal','high','max'].includes(x.density)?x.density:(old.density||d.density),
    sound:x.sound!==undefined?x.sound!==false:(old.sound!==false),
    maxWins:[1,2,3,5].includes(+x.maxWins)?+x.maxWins:(old.maxWins||d.maxWins),
    A:{
      duration:Math.max(10,Math.min(300,parseInt(inA.duration ?? x.duration) || oldA.duration || d.A.duration)),
      targetPackets:Math.max(1,Math.min(200,parseInt(inA.targetPackets ?? x.targetPackets) || oldA.targetPackets || d.A.targetPackets)),
      maxPlays:allowedPlays(inA.maxPlays ?? (x.subMode==='A'?x.maxPlays:null)) || oldA.maxPlays || d.A.maxPlays
    },
    B:{
      duration:Math.max(10,Math.min(300,parseInt(inB.duration ?? x.duration) || oldB.duration || d.B.duration)),
      packetLimit:[1,2,3].includes(+(inB.packetLimit ?? x.packetLimit))?+(inB.packetLimit ?? x.packetLimit):(oldB.packetLimit||d.B.packetLimit),
      maxPlays:allowedPlays(inB.maxPlays ?? (x.subMode==='B'?x.maxPlays:null)) || oldB.maxPlays || d.B.maxPlays
    },
    C:{
      duration:Math.max(10,Math.min(300,parseInt(inC.duration ?? x.duration) || oldC.duration || d.C.duration)),
      targetScore:Math.max(5,Math.min(1000,parseInt(inC.targetScore ?? x.targetScore) || oldC.targetScore || d.C.targetScore)),
      difficulty:['easy','normal','hard'].includes(inC.difficulty ?? x.difficulty)?(inC.difficulty ?? x.difficulty):(oldC.difficulty||d.C.difficulty),
      maxPlays:allowedPlays(inC.maxPlays ?? (x.subMode==='C'?x.maxPlays:null)) || oldC.maxPlays || d.C.maxPlays
    }
  };
}
function rainModeCfg(rain,subMode){
  const cfg=normalizeRain(rain),m=['A','B','C'].includes(subMode)?subMode:cfg.subMode;
  return cfg[m];
}
function pub(r){
  return {
    id:r.id,title:r.title,mode:r.mode,count:r.count,note:r.note,
    limitOnePerPlayer:r.limitOnePerPlayer!==false,
    balloonShape:r.balloonShape,balloonFloat:r.balloonFloat,eggStyle:r.eggStyle,
    boardCols:[5,7,8].includes(+r.boardCols)?+r.boardCols:5,
    useScheduledStart:!!r.useScheduledStart,
    startAt:r.useScheduledStart&&r.startAt?r.startAt:null,
    serverNow:new Date().toISOString(),
    rain:normalizeRain(r.rain),
    prizes:r.prizes.map(p=>({name:p.name,qty:p.qty,left:p.left,isLose:!!p.isLose})),
    results:r.results.map(x=>({slot:x.slot,prize:x.prize,isLose:!!x.isLose,player:x.player,time:x.time,source:x.source||''})),
    status:r.status
  };
}
function isBeforeScheduledStart(r){
  if(!r.useScheduledStart||!r.startAt)return false;
  const t=Date.parse(r.startAt);return Number.isFinite(t)&&Date.now()<t;
}
function emit(r){io.to(r.id).emit('room:update',pub(r));}
function authRoom(req,res){
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r||req.body.adminToken!==r.adminToken){
    res.status(403).json({ok:false,message:'主控驗證失敗'});return null;
  }
  return r;
}

/* A/B/C 與原本氣球/金蛋全部共用這個抽獎函式與同一份庫存 */
function pickPrize(r){
  const pool=r.prizes.filter(p=>p.left>0);
  if(!pool.length)return null;
  const total=pool.reduce((a,p)=>a+p.left,0);
  let n=Math.floor(Math.random()*total);
  for(const p of pool){
    if(n<p.left){p.left--;return {name:p.name,isLose:!!p.isLose};}
    n-=p.left;
  }
  return null;
}
function nextResultSlot(r){
  return r.results.reduce((m,x)=>Math.max(m,parseInt(x.slot)||0),0)+1;
}
function alreadyFinalDrawn(r,name,deviceId){
  return r.results.some(x=>(name&&x.player===name)||(deviceId&&x.deviceId&&x.deviceId===deviceId));
}
function adminReveal(r,slot){
  slot=parseInt(slot);
  if(r.mode==='rain')return {ok:false,message:'紅包雨沒有固定格子，不使用主控清格'};
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(isBeforeScheduledStart(r))return {ok:false,message:'尚未開放抽獎，請等倒數結束'};
  if(!slot||slot<1||slot>r.count)return {ok:false,message:'格子錯誤'};
  if(r.results.some(x=>x.slot===slot))return {ok:false,message:'這格已經開過了'};
  const picked=pickPrize(r);if(!picked)return {ok:false,message:'獎品已抽完'};
  const result={slot,prize:picked.name,isLose:picked.isLose,player:'',deviceId:'',source:'admin-clear',time:new Date().toISOString()};
  r.results.push(result);emit(r);return {ok:true,result,room:pub(r)};
}
function claim(r,player,slot,deviceId=''){
  player=cleanName(player);deviceId=cleanDevice(deviceId);slot=parseInt(slot);
  if(r.mode==='rain')return {ok:false,message:'紅包雨請使用紅包雨開獎流程'};
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(isBeforeScheduledStart(r))return {ok:false,message:'尚未開放抽獎，請等倒數結束'};
  if(!player)return {ok:false,message:'請輸入遊戲名'};
  if(r.limitOnePerPlayer!==false){
    if(r.results.some(x=>x.player===player))return {ok:false,message:'這個遊戲名已經抽過囉'};
    if(deviceId&&r.results.some(x=>x.deviceId&&x.deviceId===deviceId))return {ok:false,message:'這台裝置已經抽過囉，每位玩家只能抽一次'};
  }
  if(!slot||slot<1||slot>r.count)return {ok:false,message:'格子錯誤'};
  if(r.results.some(x=>x.slot===slot))return {ok:false,message:'這格已被其他玩家抽走，請選別格'};
  const picked=pickPrize(r);if(!picked)return {ok:false,message:'獎品已抽完'};
  const result={slot,prize:picked.name,isLose:picked.isLose,player,deviceId,source:r.mode,time:new Date().toISOString()};
  r.results.push(result);emit(r);return {ok:true,result,room:pub(r)};
}

function rainKey(name){return cleanName(name).toLocaleLowerCase('zh-TW');}
function findRainPlayerByDevice(r,deviceId){
  if(!deviceId)return null;
  return Object.values(r.rainPlayers||{}).find(p=>p.deviceId===deviceId)||null;
}
function ensureRainPlayer(r,name,deviceId){
  name=cleanName(name);deviceId=cleanDevice(deviceId);
  if(!name)return {ok:false,message:'請輸入遊戲名'};
  r.rainPlayers=r.rainPlayers||{};
  const key=rainKey(name),byName=r.rainPlayers[key],byDevice=findRainPlayerByDevice(r,deviceId);
  if(byDevice&&rainKey(byDevice.name)!==key)return {ok:false,message:'這台裝置已使用其他遊戲名參加'};
  if(byName&&byName.deviceId&&deviceId&&byName.deviceId!==deviceId)return {ok:false,message:'這個遊戲名已有人使用'};
  if(!byName){
    r.rainPlayers[key]={name,deviceId,plays:0,wins:0,active:null};
  }else if(!byName.deviceId&&deviceId)byName.deviceId=deviceId;
  return {ok:true,player:r.rainPlayers[key]};
}
function rainPlayerPub(p){
  return {name:p.name,plays:p.plays||0,wins:p.wins||0,active:p.active?{playId:p.active.playId,subMode:p.active.subMode,startedAt:p.active.startedAt,finished:!!p.active.finished,drawCount:p.active.drawCount||0}:null};
}
function effectiveRainPacketLimit(r){
  return r.limitOnePerPlayer!==false?1:normalizeRain(r.rain).B.packetLimit;
}
function rainStart(r,name,deviceId){
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(isBeforeScheduledStart(r))return {ok:false,message:'尚未開放抽獎，請等倒數結束'};
  const got=ensureRainPlayer(r,name,deviceId);if(!got.ok)return got;
  const p=got.player,cfg=normalizeRain(r.rain),mc=rainModeCfg(cfg,cfg.subMode);
  if(r.limitOnePerPlayer!==false&&alreadyFinalDrawn(r,p.name,p.deviceId))return {ok:false,message:'你已經完成過這場抽獎'};
  if((p.plays||0)>=mc.maxPlays)return {ok:false,message:`你已達此玩法可玩上限 ${mc.maxPlays} 次`};
  const maxWins=r.limitOnePerPlayer!==false?1:cfg.maxWins;
  if((p.wins||0)>=maxWins)return {ok:false,message:`你已達獲獎上限 ${maxWins} 個`};
  if(p.active&&!p.active.finished)p.active.finished=true;
  p.plays=(p.plays||0)+1;
  p.active={playId:token(),subMode:cfg.subMode,startedAt:Date.now(),finished:false,drawCount:0};
  return {ok:true,playId:p.active.playId,subMode:cfg.subMode,player:rainPlayerPub(p),room:pub(r),packetLimit:effectiveRainPacketLimit(r)};
}
function rainFinish(r,name,deviceId,playId){
  const got=ensureRainPlayer(r,name,deviceId);if(!got.ok)return got;
  const p=got.player;
  if(p.active&&p.active.playId===playId)p.active.finished=true;
  return {ok:true,player:rainPlayerPub(p),room:pub(r)};
}
function rainDraw(r,body){
  const name=cleanName(body.player),deviceId=cleanDevice(body.deviceId),playId=String(body.playId||''),drawKey=String(body.drawKey||'main').slice(0,100);
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(isBeforeScheduledStart(r))return {ok:false,message:'尚未開放抽獎，請等倒數結束'};
  const got=ensureRainPlayer(r,name,deviceId);if(!got.ok)return got;
  const p=got.player,cfg=normalizeRain(r.rain),a=p.active;
  if(!a||a.playId!==playId)return {ok:false,message:'找不到這一局，請重新開始'};
  const cacheKey=`${rainKey(name)}:${playId}:${drawKey}`;
  r.rainDrawCache=r.rainDrawCache||new Map();
  if(r.rainDrawCache.has(cacheKey)){
    const cached=r.rainDrawCache.get(cacheKey);
    return {ok:true,result:cached.result,finished:cached.finished,player:rainPlayerPub(p),room:pub(r)};
  }
  if(a.finished)return {ok:false,message:'這一局已經結束'};
  if(r.limitOnePerPlayer!==false&&alreadyFinalDrawn(r,p.name,p.deviceId))return {ok:false,message:'你已經完成過這場抽獎'};
  const maxWins=r.limitOnePerPlayer!==false?1:cfg.maxWins;
  if((p.wins||0)>=maxWins)return {ok:false,message:`你已達獲獎上限 ${maxWins} 個`};

  const mc=rainModeCfg(cfg,a.subMode);
  const graceEnd=a.startedAt+(mc.duration+15)*1000;
  if(Date.now()>graceEnd){a.finished=true;return {ok:false,message:'這一局已超過遊戲時間，請重新挑戰'};}

  if(a.subMode==='A'){
    if(Number(body.hits||0)<mc.targetPackets)return {ok:false,message:'尚未搶滿目標紅包數'};
    if(a.drawCount>=1)return {ok:false,message:'本局已經開獎'};
  }else if(a.subMode==='C'){
    if(Number(body.score||0)<mc.targetScore)return {ok:false,message:'尚未達到目標分數'};
    if(a.drawCount>=1)return {ok:false,message:'本局已經開獎'};
  }else{
    const limit=effectiveRainPacketLimit(r);
    if(a.drawCount>=limit)return {ok:false,message:'本局可搶紅包數已用完'};
  }

  const picked=pickPrize(r);if(!picked)return {ok:false,message:'抽獎份數已全部抽完'};
  a.drawCount=(a.drawCount||0)+1;
  if(!picked.isLose)p.wins=(p.wins||0)+1;
  let finished=a.subMode!=='B'||a.drawCount>=effectiveRainPacketLimit(r)||(p.wins||0)>=maxWins;
  if(r.limitOnePerPlayer!==false)finished=true;
  a.finished=finished;
  const result={
    slot:nextResultSlot(r),prize:picked.name,isLose:picked.isLose,
    player:p.name,deviceId:p.deviceId||deviceId,source:`rain-${a.subMode}`,time:new Date().toISOString()
  };
  r.results.push(result);
  r.rainDrawCache.set(cacheKey,{result,finished});
  emit(r);
  return {ok:true,result,finished,player:rainPlayerPub(p),room:pub(r)};
}

app.get('/api/version',(req,res)=>res.json({ok:true,version:'1.2.0'}));
app.post('/api/login',(req,res)=>res.json({ok:req.body.password===ADMIN_PASSWORD}));
app.post('/api/rooms',(req,res)=>{
  let id=code();while(rooms.has(id))id=code();
  const r={
    id,adminToken:token(),title:'歡樂抽獎活動',mode:'balloon',count:20,note:'',
    limitOnePerPlayer:true,balloonShape:'round',balloonFloat:true,eggStyle:'color',
    boardCols:5,useScheduledStart:false,startAt:null,prizes:[],results:[],status:'open',controller:null,
    rain:defaultRain(),rainPlayers:{},rainDrawCache:new Map()
  };
  rooms.set(id,r);res.json({ok:true,id,adminToken:r.adminToken});
});
app.get('/api/rooms/:id',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r)return res.status(404).json({ok:false});
  res.json({ok:true,room:pub(r)});
});
app.post('/api/rooms/:id/save',(req,res)=>{
  const r=authRoom(req,res);if(!r)return;
  const newCount=Math.max(1,Math.min(500,parseInt(req.body.count)||1));
  const previous=r.results||[];
  const maxUsed=previous.reduce((m,x)=>Math.max(m,parseInt(x.slot)||0),0);
  if(maxUsed>newCount)return res.status(400).json({ok:false,message:`目前已開獎 ${maxUsed} 次，抽獎池總份數不能改成 ${newCount}`});

  const merged=new Map();
  for(const x of (req.body.prizes||[])){
    const name=String(x?.name||'').trim().slice(0,80),qty=Math.max(0,parseInt(x?.qty)||0);
    if(!name||qty<=0)continue;
    merged.set(name,(merged.get(name)||0)+qty);
  }
  const winPrizes=[...merged.entries()].map(([name,qty])=>({name,qty}));
  const totalWin=winPrizes.reduce((a,p)=>a+p.qty,0);
  if(totalWin>newCount)return res.status(400).json({ok:false,message:`有獎數量 ${totalWin} 個，已超過抽獎池總份數 ${newCount}`});

  const drawnWins=new Map();let drawnLose=0;
  for(const x of previous){
    if(x.isLose)drawnLose++;
    else drawnWins.set(x.prize,(drawnWins.get(x.prize)||0)+1);
  }
  for(const [name,already] of drawnWins){
    const configured=merged.get(name)||0;
    if(configured<already)return res.status(400).json({ok:false,message:`「${name}」已經抽出 ${already} 個，設定數量不能少於已抽出的數量`});
  }
  const autoLoseQty=newCount-totalWin;
  if(autoLoseQty<drawnLose)return res.status(400).json({ok:false,message:`目前已經出現 ${drawnLose} 個「再接再厲」，請增加總份數或減少有獎數量`});

  r.title=String(req.body.title||'歡樂抽獎活動').slice(0,60);
  r.mode=['balloon','egg','rain'].includes(req.body.mode)?req.body.mode:'balloon';
  r.count=newCount;
  r.note=String(req.body.note||'').slice(0,1000);
  r.limitOnePerPlayer=req.body.limitOnePerPlayer!==false;
  const shapes=['round','heart','star','flower','cloud','rainbow'];
  r.balloonShape=shapes.includes(req.body.balloonShape)?req.body.balloonShape:'round';
  r.balloonFloat=req.body.balloonFloat!==false;
  r.eggStyle=req.body.eggStyle==='gold'?'gold':'color';
  r.boardCols=[5,7,8].includes(+req.body.boardCols)?+req.body.boardCols:5;
  r.rain=normalizeRain(req.body.rain,r.rain);
  r.useScheduledStart=req.body.useScheduledStart===true;
  if(r.useScheduledStart){
    const startMs=Date.parse(String(req.body.startAt||''));
    if(!Number.isFinite(startMs))return res.status(400).json({ok:false,message:'請完整設定開賽日期與時間'});
    r.startAt=new Date(startMs).toISOString();
  }else r.startAt=null;

  r.prizes=winPrizes.map(({name,qty})=>{
    const already=drawnWins.get(name)||0;
    return {name,qty,isLose:false,left:Math.max(0,qty-already)};
  });
  if(autoLoseQty>0)r.prizes.push({name:'再接再厲',qty:autoLoseQty,isLose:true,left:Math.max(0,autoLoseQty-drawnLose)});

  emit(r);res.json({ok:true,room:pub(r),summary:{count:newCount,win:totalWin,lose:autoLoseQty}});
});
app.post('/api/rooms/:id/end',(req,res)=>{
  const r=authRoom(req,res);if(!r)return;r.status='ended';emit(r);res.json({ok:true});
});
app.delete('/api/rooms/:id',(req,res)=>{
  const r=authRoom(req,res);if(!r)return;rooms.delete(r.id);io.to(r.id).emit('room:deleted');res.json({ok:true});
});
app.post('/api/rooms/:id/join',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r||r.status!=='open')return res.status(404).json({ok:false,message:'抽獎不存在或已結束'});
  const name=cleanName(req.body.name),deviceId=cleanDevice(req.body.deviceId);
  if(!name)return res.json({ok:false,message:'請輸入遊戲名'});
  if(r.limitOnePerPlayer!==false&&alreadyFinalDrawn(r,name,deviceId)){
    if(r.results.some(x=>x.player===name))return res.json({ok:false,message:'這個遊戲名已經抽過囉'});
    return res.json({ok:false,message:'這台裝置已經抽過囉，每位玩家只能抽一次'});
  }
  let rainPlayer=null;
  if(r.mode==='rain'){
    const got=ensureRainPlayer(r,name,deviceId);
    if(!got.ok)return res.json(got);
    rainPlayer=rainPlayerPub(got.player);
  }
  res.json({ok:true,room:pub(r),rainPlayer});
});
app.post('/api/rooms/:id/draw',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r)return res.status(404).json({ok:false,message:'找不到抽獎'});
  res.json(claim(r,req.body.player,req.body.slot,req.body.deviceId));
});
app.post('/api/rooms/:id/rain/start',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r||r.mode!=='rain')return res.status(404).json({ok:false,message:'找不到紅包雨活動'});
  res.json(rainStart(r,req.body.player,req.body.deviceId));
});
app.post('/api/rooms/:id/rain/draw',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r||r.mode!=='rain')return res.status(404).json({ok:false,message:'找不到紅包雨活動'});
  res.json(rainDraw(r,req.body||{}));
});
app.post('/api/rooms/:id/rain/finish',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());
  if(!r||r.mode!=='rain')return res.status(404).json({ok:false,message:'找不到紅包雨活動'});
  res.json(rainFinish(r,req.body.player,req.body.deviceId,req.body.playId));
});
app.post('/api/rooms/:id/admin-reveal',(req,res)=>{
  const r=authRoom(req,res);if(!r)return;res.json(adminReveal(r,req.body.slot));
});

io.on('connection',s=>{
  s.on('room:join',id=>s.join(String(id||'').toUpperCase()));
  s.on('admin:claim',({id,adminToken})=>{
    const r=rooms.get(String(id||'').toUpperCase());if(!r||r.adminToken!==adminToken)return;
    if(!r.controller){r.controller=s.id;s.emit('admin:control',{mode:'control'});}
    else if(r.controller===s.id)s.emit('admin:control',{mode:'control'});
    else s.emit('admin:control',{mode:'readonly'});
  });
  s.on('admin:takeover',({id,adminToken})=>{
    const r=rooms.get(String(id||'').toUpperCase());if(!r||r.adminToken!==adminToken)return;
    r.controller=s.id;s.emit('admin:control',{mode:'control'});
  });
  s.on('disconnect',()=>{for(const r of rooms.values())if(r.controller===s.id)r.controller=null;});
});
server.listen(process.env.PORT||3000,()=>console.log('Raffle system V1.2.0 running on port '+(process.env.PORT||3000)));
