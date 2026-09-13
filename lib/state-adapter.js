const fs=require('fs');
const path=require('path');
function clone(v){return JSON.parse(JSON.stringify(v));}

module.exports=async function createStateAdapter({databaseUrl=process.env.DATABASE_URL||''}={}){
  let pool=null;
  const persistent=!!String(databaseUrl||'').trim();
  if(persistent){
    const {Pool}=require('pg');
    const sslMode=String(process.env.DATABASE_SSL||'').toLowerCase();
    const poolConfig={connectionString:databaseUrl,max:3,idleTimeoutMillis:30000};
    if(sslMode==='disable'||sslMode==='false'||sslMode==='0')poolConfig.ssl=false;
    else if(sslMode==='require'||sslMode==='true'||sslMode==='1')poolConfig.ssl={rejectUnauthorized:false};
    pool=new Pool(poolConfig);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raffle_system_state (
        namespace TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  function readLocal(file,defaults){
    try{
      const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
      return parsed&&typeof parsed==='object'?parsed:clone(defaults);
    }catch{return clone(defaults);}
  }
  function writeLocal(file,data){
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const tmp=file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(data,null,2),'utf8');
    fs.renameSync(tmp,file);
  }
  async function load(namespace,file,defaults){
    const seed=readLocal(file,defaults);
    if(!pool)return seed;
    const r=await pool.query('SELECT data FROM raffle_system_state WHERE namespace=$1',[namespace]);
    if(r.rowCount)return r.rows[0].data;
    await pool.query(
      'INSERT INTO raffle_system_state(namespace,data) VALUES($1,$2::jsonb) ON CONFLICT(namespace) DO NOTHING',
      [namespace,JSON.stringify(seed)]
    );
    const r2=await pool.query('SELECT data FROM raffle_system_state WHERE namespace=$1',[namespace]);
    return r2.rowCount?r2.rows[0].data:seed;
  }
  async function save(namespace,file,data){
    if(!pool){writeLocal(file,data);return clone(data);}
    await pool.query(
      `INSERT INTO raffle_system_state(namespace,data,updated_at)
       VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(namespace) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,
      [namespace,JSON.stringify(data)]
    );
    return clone(data);
  }
  async function close(){if(pool)await pool.end();}
  return {persistent,mode:persistent?'postgres':'local-json',load,save,close};
};
