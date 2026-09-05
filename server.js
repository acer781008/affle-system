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
function pub(r){return {id:r.id,title:r.title,mode:r.mode,count:r.count,note:r.note,limitOnePerPlayer:r.limitOnePerPlayer!==false,balloonShape:r.balloonShape,balloonFloat:r.balloonFloat,eggStyle:r.eggStyle,prizes:r.prizes.map(p=>({name:p.name,qty:p.qty,left:p.left,isLose:!!p.isLose})),results:r.results.map(x=>({slot:x.slot,prize:x.prize,isLose:!!x.isLose,player:x.player,time:x.time})),status:r.status};}
function emit(r){io.to(r.id).emit('room:update',pub(r));}
function authRoom(req,res){const r=rooms.get(req.params.id.toUpperCase());if(!r||req.body.adminToken!==r.adminToken){res.status(403).json({ok:false,message:'主控驗證失敗'});return null;}return r;}
function pickPrize(r){
  const pool=r.prizes.filter(p=>p.left>0); if(!pool.length)return null;
  const total=pool.reduce((a,p)=>a+p.left,0); let n=Math.floor(Math.random()*total);
  for(const p of pool){if(n<p.left){p.left--;return {name:p.name,isLose:!!p.isLose};}n-=p.left;}
  return null;
}

function adminReveal(r,slot){
  slot=parseInt(slot);
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(!slot||slot<1||slot>r.count)return {ok:false,message:'格子錯誤'};
  if(r.results.some(x=>x.slot===slot))return {ok:false,message:'這格已經開過了'};
  const picked=pickPrize(r); if(!picked)return {ok:false,message:'獎品已抽完'};
  const result={slot,prize:picked.name,isLose:picked.isLose,player:'',deviceId:'',source:'admin-clear',time:new Date().toISOString()};
  r.results.push(result); emit(r); return {ok:true,result,room:pub(r)};
}

function claim(r,player,slot,deviceId=''){
  player=String(player||'').trim().slice(0,30);
  deviceId=String(deviceId||'').trim().slice(0,120);
  slot=parseInt(slot);
  if(r.status!=='open')return {ok:false,message:'抽獎已結束'};
  if(!player)return {ok:false,message:'請輸入遊戲名'};
  if(r.limitOnePerPlayer!==false){
    if(r.results.some(x=>x.player===player))return {ok:false,message:'這個遊戲名已經抽過囉'};
    if(deviceId&&r.results.some(x=>x.deviceId&&x.deviceId===deviceId))return {ok:false,message:'這台裝置已經抽過囉，每位玩家只能抽一次'};
  }
  if(!slot||slot<1||slot>r.count)return {ok:false,message:'格子錯誤'};
  if(r.results.some(x=>x.slot===slot))return {ok:false,message:'這格已被其他玩家抽走，請選別格'};
  const picked=pickPrize(r); if(!picked)return {ok:false,message:'獎品已抽完'};
  const result={slot,prize:picked.name,isLose:picked.isLose,player,deviceId,time:new Date().toISOString()};
  r.results.push(result); emit(r); return {ok:true,result,room:pub(r)};
}

app.get('/api/version',(req,res)=>res.json({ok:true,version:'1.1.1'}));
app.post('/api/login',(req,res)=>res.json({ok:req.body.password===ADMIN_PASSWORD}));
app.post('/api/rooms',(req,res)=>{
  let id=code();while(rooms.has(id))id=code();
  const r={id,adminToken:token(),title:'歡樂抽獎活動',mode:'balloon',count:20,note:'',limitOnePerPlayer:true,balloonShape:'round',balloonFloat:true,eggStyle:'color',prizes:[],results:[],status:'open',controller:null};
  rooms.set(id,r);res.json({ok:true,id,adminToken:r.adminToken});
});
app.get('/api/rooms/:id',(req,res)=>{const r=rooms.get(req.params.id.toUpperCase());if(!r)return res.status(404).json({ok:false});res.json({ok:true,room:pub(r)});});
app.post('/api/rooms/:id/save',(req,res)=>{
  const r=authRoom(req,res);if(!r)return;
  const newCount=Math.max(1,Math.min(500,parseInt(req.body.count)||1));
  const previous=r.results||[];
  const maxUsed=previous.reduce((m,x)=>Math.max(m,parseInt(x.slot)||0),0);
  if(maxUsed>newCount)return res.status(400).json({ok:false,message:`目前已開到第 ${maxUsed} 格，總格數不能改成 ${newCount} 格`});

  const merged=new Map();
  for(const x of (req.body.prizes||[])){
    const name=String(x?.name||'').trim().slice(0,80),qty=Math.max(0,parseInt(x?.qty)||0);
    if(!name||qty<=0)continue;
    merged.set(name,(merged.get(name)||0)+qty);
  }
  const winPrizes=[...merged.entries()].map(([name,qty])=>({name,qty}));
  const totalWin=winPrizes.reduce((a,p)=>a+p.qty,0);
  if(totalWin>newCount)return res.status(400).json({ok:false,message:`有獎數量 ${totalWin} 個，已超過總格數 ${newCount} 格`});

  const drawnWins=new Map();
  let drawnLose=0;
  for(const x of previous){
    if(x.isLose)drawnLose++;
    else drawnWins.set(x.prize,(drawnWins.get(x.prize)||0)+1);
  }
  for(const [name,already] of drawnWins){
    const cfg=merged.get(name)||0;
    if(cfg<already)return res.status(400).json({ok:false,message:`「${name}」已經抽出 ${already} 個，設定數量不能少於已抽出的數量`});
  }
  const autoLoseQty=newCount-totalWin;
  if(autoLoseQty<drawnLose)return res.status(400).json({ok:false,message:`目前已經出現 ${drawnLose} 個「再接再厲」，請增加總格數或減少有獎數量`});

  r.title=String(req.body.title||'歡樂抽獎活動').slice(0,60);
  r.mode=req.body.mode==='egg'?'egg':'balloon';
  r.count=newCount;
  r.note=String(req.body.note||'').slice(0,1000);
  r.limitOnePerPlayer=req.body.limitOnePerPlayer!==false;
  const shapes=['round','heart','star','flower','cloud','rainbow'];
  r.balloonShape=shapes.includes(req.body.balloonShape)?req.body.balloonShape:'round';
  r.balloonFloat=req.body.balloonFloat!==false;
  r.eggStyle=req.body.eggStyle==='gold'?'gold':'color';

  r.prizes=winPrizes.map(({name,qty})=>{
    const already=drawnWins.get(name)||0;
    return {name,qty,isLose:false,left:Math.max(0,qty-already)};
  });
  if(autoLoseQty>0)r.prizes.push({name:'再接再厲',qty:autoLoseQty,isLose:true,left:Math.max(0,autoLoseQty-drawnLose)});

  emit(r);res.json({ok:true,room:pub(r),summary:{count:newCount,win:totalWin,lose:autoLoseQty}});
});
app.post('/api/rooms/:id/end',(req,res)=>{const r=authRoom(req,res);if(!r)return;r.status='ended';emit(r);res.json({ok:true});});
app.delete('/api/rooms/:id',(req,res)=>{const r=authRoom(req,res);if(!r)return;rooms.delete(r.id);io.to(r.id).emit('room:deleted');res.json({ok:true});});
app.post('/api/rooms/:id/join',(req,res)=>{
  const r=rooms.get(req.params.id.toUpperCase());if(!r||r.status!=='open')return res.status(404).json({ok:false,message:'抽獎不存在或已結束'});
  const name=String(req.body.name||'').trim().slice(0,30),deviceId=String(req.body.deviceId||'').trim().slice(0,120);if(!name)return res.json({ok:false,message:'請輸入遊戲名'});
  if(r.limitOnePerPlayer!==false){
    if(r.results.some(x=>x.player===name))return res.json({ok:false,message:'這個遊戲名已經抽過囉'});
    if(deviceId&&r.results.some(x=>x.deviceId&&x.deviceId===deviceId))return res.json({ok:false,message:'這台裝置已經抽過囉，每位玩家只能抽一次'});
  }
  res.json({ok:true,room:pub(r)});
});
app.post('/api/rooms/:id/draw',(req,res)=>{const r=rooms.get(req.params.id.toUpperCase());if(!r)return res.status(404).json({ok:false,message:'找不到抽獎'});res.json(claim(r,req.body.player,req.body.slot,req.body.deviceId));});
app.post('/api/rooms/:id/admin-reveal',(req,res)=>{const r=authRoom(req,res);if(!r)return;res.json(adminReveal(r,req.body.slot));});

io.on('connection',s=>{
  s.on('room:join',id=>s.join(String(id||'').toUpperCase()));
  s.on('admin:claim',({id,adminToken})=>{const r=rooms.get(String(id||'').toUpperCase());if(!r||r.adminToken!==adminToken)return;if(!r.controller){r.controller=s.id;s.emit('admin:control',{mode:'control'});}else if(r.controller===s.id)s.emit('admin:control',{mode:'control'});else s.emit('admin:control',{mode:'readonly'});});
  s.on('admin:takeover',({id,adminToken})=>{const r=rooms.get(String(id||'').toUpperCase());if(!r||r.adminToken!==adminToken)return;r.controller=s.id;s.emit('admin:control',{mode:'control'});});
  s.on('disconnect',()=>{for(const r of rooms.values())if(r.controller===s.id)r.controller=null;});
});
server.listen(process.env.PORT||3000,()=>console.log('Raffle system running on port '+(process.env.PORT||3000)));
