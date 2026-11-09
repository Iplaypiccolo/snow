// 일별 보강 전용. 기존 시간별 수집·완료 판정에는 쓰지 않는다.
// 2026-11-09(84·85): sky:true 이면 하늘 상태(SKY)와 습도(REH, %)도 받음 — 일별 창 오전/오후 날씨, 1시간·3시간 표 습도
import { GRID_URL, NX, NY, kstHour } from '../collect-forecast/core.mjs';
const H=3600000,MAX_BYTES=2097152,BUDGET=85000;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=code=>{throw new Error(code);};
const hour=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&Date.parse(s)%H===0;

export function parseGrid(text,kind,cells){
  if(!['SKY','TMN','TMX','REH'].includes(kind))fail('bad_grid');
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)fail('bad_grid');
  const tokens=text.split(/[\s,]+/).filter(s=>s!=='');
  if(tokens.length!==NX*NY)fail('bad_grid');
  const values=tokens.map(s=>{
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))fail('bad_grid');
    const n=Number(s);if(!Number.isFinite(n))fail('bad_grid');return n;
  });
  // 전국이 한꺼번에0인 파일은 미제공으로 처리한다. 개별0℃는 유효값이다.
  if(values.every(n=>n===0)||values.every(n=>n<=-90))return{empty:true,values:null};
  for(const n of values){
    if(n<=-90)continue;
    if(kind==='SKY'?![0,1,3,4].includes(n):kind==='REH'?(n<0||n>100):n>70)fail('bad_grid');
  }
  return{empty:false,values:cells.map(([nx,ny])=>{
    const n=values[(ny-1)*NX+nx-1];return n<=-90||(kind==='SKY'&&n===0)?null:n;
  })};
}

function validPlan(plan,sky,now){
  if(!plan||typeof plan!=='object'||!Array.isArray(plan.missing)||plan.missing.length>300)return false;
  if(!plan.missing.length)return true;
  if(plan.done||plan.waiting||!hour(plan.tmfc)||Date.parse(plan.tmfc)>now+300000||Date.parse(plan.tmfc)<now-48*H
    ||![2,5,8,11,14,17,20,23].includes(+kstHour(plan.tmfc).slice(8))
    ||!Array.isArray(plan.cells)||!plan.cells.length||plan.cells.length>NX*NY)return false;
  const seen=new Set();
  for(const c of plan.cells){
    if(!Array.isArray(c)||c.length!==2||!Number.isInteger(c[0])||!Number.isInteger(c[1])||c[0]<1||c[0]>NX||c[1]<1||c[1]>NY||seen.has(c.join(',')))return false;
    seen.add(c.join(','));
  }
  const jobs=new Set();
  for(const j of plan.missing){
    if(!Array.isArray(j)||j.length!==2)return false;
    const[v,at]=j;
    if(!['TMN','TMX',...(sky?['SKY','REH']:[])].includes(v)||!hour(at)||Date.parse(at)<=Date.parse(plan.tmfc)||Date.parse(at)>Date.parse(plan.tmfc)+120*H
      ||(v==='TMN'&&kstHour(at).slice(8)!=='06')||(v==='TMX'&&kstHour(at).slice(8)!=='15')||jobs.has(v+'|'+at))return false;
    jobs.add(v+'|'+at);
  }
  return true;
}

export async function handle(req,deps){
  const started=deps.now();
  if(req.method!=='POST')return reply(405,{ok:false,error:'post_required'});
  try{const token=req.headers.get('x-collector-token');if(!token||!await deps.tokenOk(token))return reply(401,{ok:false,error:'unauthorized'});}
  catch{return reply(503,{ok:false,error:'auth_unavailable'});}
  let body;
  try{const raw=await req.text();if(raw.length>1000)fail('bad_request');body=JSON.parse(raw||'{}');}
  catch{return reply(400,{ok:false,error:'bad_request'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='sky')||(body.sky!==undefined&&typeof body.sky!=='boolean'))return reply(400,{ok:false,error:'bad_request'});
  const sky=body.sky??false,usage=new Map();
  const result={ok:true,sky,saved:0,empty:0,done:false,waiting:false};
  let status=200;
  async function fetchGrid(url){
    for(let attempt=0;attempt<2;attempt++){
      if(deps.now()-started>BUDGET-25000)fail('time_budget');
      if(attempt)await deps.sleep(1500);
      const day=new Date(deps.now()+9*H).toISOString().slice(0,10);
      const u=usage.get(day)||{calls:0,bytes:0,retries:0};u.calls++;if(attempt)u.retries++;usage.set(day,u);
      let r;try{r=await deps.fetchText(url);}catch{r={status:0,text:'',bytes:0};}
      u.bytes+=Number.isFinite(r.bytes)&&r.bytes>=0?r.bytes:new TextEncoder().encode(String(r.text||'')).length;
      if(r.status===200){if(r.bytes>MAX_BYTES)fail('bad_grid');return r.text;}
      if(!attempt&&(r.status===0||r.status>=500))continue;
      fail(r.status===401||r.status===403?'upstream_auth':'upstream_unavailable');
    }
  }
  try{
    const plan=await deps.plan(sky);
    if(!validPlan(plan,sky,deps.now()))fail('bad_plan');
    result.issued_at=plan.tmfc??null;result.remaining=plan.missing.length;
    if(!plan.missing.length){result.done=plan.done===true;result.waiting=plan.waiting===true;}
    else{
      const key=String(deps.env('KMA_AUTH_KEY')||'').trim();if(!key)fail('missing_kma_key');
      for(const[kind,at]of plan.missing){
        const url=new URL(GRID_URL);url.searchParams.set('tmfc',kstHour(plan.tmfc));url.searchParams.set('tmef',kstHour(at));url.searchParams.set('vars',kind);url.searchParams.set('authKey',key);
        const parsed=parseGrid(await fetchGrid(url.href),kind,plan.cells);
        if(!await deps.put(plan.tmfc,kind,at,parsed.values,parsed.empty))fail('store_failed');
        result.saved++;if(parsed.empty)result.empty++;result.remaining--;
        await deps.sleep(500);
      }
      const next=await deps.plan(sky);if(!validPlan(next,sky,deps.now()))fail('bad_plan');
      result.done=next.done===true;result.waiting=next.waiting===true;result.remaining=next.missing.length;
    }
  }catch(e){
    const code=['bad_plan','bad_grid','missing_kma_key','upstream_auth','upstream_unavailable','store_failed','time_budget'].includes(e?.message)?e.message:'collection_failed';
    result.ok=code==='time_budget';result.error=code;status=code==='missing_kma_key'?503:code==='time_budget'?200:502;
  }
  let usageSaved=true;
  for(const[day,u]of usage){try{if(!await deps.usage(day,u.calls,u.bytes,u.retries))usageSaved=false;}catch{usageSaved=false;}}
  result.usage=[...usage.values()].reduce((a,u)=>({calls:a.calls+u.calls,bytes:a.bytes+u.bytes,retries:a.retries+u.retries}),{calls:0,bytes:0,retries:0});
  result.usage.saved=usageSaved;
  return reply(status,result);
}
