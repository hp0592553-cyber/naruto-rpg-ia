/** Optional always-on command transport. No credential is returned to the browser. */
import {verifySessionJwt} from './command-session.mjs';
import {readAutoplay} from './autoplay-store.mjs';
const JOB='discord2_service_job_v1', HEART='discord2_service_heartbeat_v1';
const archiveKey=requestId=>'discord2_service_result_v1:'+requestId;
const id=v=>typeof v==='string'&&/^[0-9]{15,22}$/.test(v);
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function read(env,key){const r=await env.DB.prepare('SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?').bind(env.BUSHIN_OWNER_DISCORD_ID,key).first();return r?{raw:r.value_json,data:JSON.parse(r.value_json)}:null}
async function put(env,key,data){await env.DB.prepare('INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(env.BUSHIN_OWNER_DISCORD_ID,key,JSON.stringify(data),Date.now()).run()}
async function cas(env,old,next,key=JOB){const r=old?await env.DB.prepare('UPDATE bushin_project_state SET value_json=?,updated_at=? WHERE owner_id=? AND key=? AND value_json=?').bind(JSON.stringify(next),Date.now(),env.BUSHIN_OWNER_DISCORD_ID,key,old.raw).run():await env.DB.prepare('INSERT OR IGNORE INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?)').bind(env.BUSHIN_OWNER_DISCORD_ID,key,JSON.stringify(next),Date.now()).run();return Number(r.meta?.changes)===1}
export const commandServiceConfigured=env=>typeof env.BUSHIN_EXECUTOR_TOKEN==='string'&&env.BUSHIN_EXECUTOR_TOKEN.length>=43;
export async function commandServiceSelected(env){return commandServiceConfigured(env)||(await read(env,HEART))?.data.mode==='github_session'}
export async function commandServiceHealth(env){const beat=await read(env,HEART);return {online:!!beat&&Date.now()-beat.data.at<30000&&Number(beat.data.version||0)>=2,planner_revision:beat?.data.planner_revision||null,brain_ready:!!beat&&Date.now()-beat.data.at<30000&&Number(beat.data.version||0)>=4,version:Number(beat?.data.version||0),expires_at:beat?.data.expires_at||null}}
async function archive(env,job){
 if(!job||!['finished','stopped','expired','uncertain'].includes(job.phase))return;
 // A delayed writer must not replace a confirmed historical result with uncertainty.
 await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE json_extract(bushin_project_state.value_json,'$.phase') != 'finished'")
  .bind(env.BUSHIN_OWNER_DISCORD_ID,archiveKey(job.request_id),JSON.stringify(job),Date.now()).run();
}
async function reconcileJob(env,row){
 if(!row)return row;
 const job=row.data,now=Date.now();let phase=null;
 if(job.phase==='queued'&&now-job.at>120000)phase='expired';
 if(['claimed','sending'].includes(job.phase)&&now-(job.claimed_at||job.at)>120000&&!(await commandServiceHealth(env)).online)phase=job.phase==='claimed'&&job.protocol>=3?'stopped':'uncertain';
 if(!phase)return row;
 const next={...job,phase,reconciled_at:now};
 if(await cas(env,row,next)){await archive(env,next);return {raw:JSON.stringify(next),data:next}}
 return read(env,JOB);
}
export async function startCommandSession(req,env,ctx,baseUrl){
 if(req.method!=='POST'||req.headers.get('origin')!==baseUrl||ctx.me?.id!==String(env.BUSHIN_OWNER_DISCORD_ID)||ctx.me?.membership?.member!==true)return json({error:'Origem ou conta inválida'},403);
 const beat=await read(env,HEART);if(new URL(req.url).searchParams.get('refresh')!=='1'&&beat&&Date.now()-beat.data.at<30000&&Number(beat.data.version||0)>=(new URL(req.url).searchParams.get('brain')==='opencode'?4:2))return json({state:'connected',note:'Cliente já conectado.'});
 const pending=await reconcileJob(env,await read(env,JOB));if(pending&&['queued','claimed','sending'].includes(pending.data.phase))return json({error:'Existe uma ação pendente. Confira antes de renovar a sessão.'},409);
 const t=Date.now();const lock=await env.DB.prepare('INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE bushin_project_state.updated_at < ?').bind(env.BUSHIN_OWNER_DISCORD_ID,'discord2_session_dispatch',JSON.stringify({at:t}),t,t-120000).run();
 if(Number(lock.meta?.changes)!==1)return json({state:'queued',note:'Sessão já solicitada. Aguarde o início do GitHub.'});
 try{const r=await fetch('https://api.github.com/repos/hp0592553-cyber/naruto-rpg-ia/actions/workflows/bushin-cloudflare-ci.yml/dispatches',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+env.BUSHIN_GITHUB_TOKEN,'Content-Type':'application/json',Accept:'application/vnd.github+json','User-Agent':'Bushin-Session'},body:JSON.stringify({ref:'Projeto',inputs:{mode:'servico'}})});return json(r.ok?{state:'queued',note:'Sessão temporária do GitHub solicitada. O executor atual encerra após 60 segundos conectado; não é um serviço contínuo nem confirma envio de comandos.'}:{error:'GitHub não iniciou a sessão (HTTP '+r.status+').'},r.ok?200:503)}catch{return json({error:'Solicitação incerta. Confira no GitHub antes de repetir.'},503)}
}
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function validServiceCommand(c){if(c?.command==='/agent-plan')return id(c.channel_id)&&c.options&&Object.keys(c.options).length===1&&typeof c.options.context==='string'&&c.options.context.length<=50000;return !!c&&typeof c.command==='string'&&/^\/?[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}$/u.test(c.command)&&c.command.length<=100&&id(c.channel_id)&&!!c.options&&typeof c.options==='object'&&!Array.isArray(c.options)&&Object.keys(c.options).length<=25&&Object.entries(c.options).every(([k,v])=>/^[\w-]{1,32}$/.test(k)&&(['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v))&&(typeof v!=='string'||v.length<=2000))}
async function body(req,max=180000){if(Number(req.headers.get('content-length')||0)>max)throw Error();const s=await req.text();if(s.length>max)throw Error();return JSON.parse(s)}
async function authorized(req,env){const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');if(token.length>256||token.length<43)return false;const actual=await digest(token);const session=await read(env,'discord2_service_auth_v1');const expected=commandServiceConfigured(env)?await digest(env.BUSHIN_EXECUTOR_TOKEN):session&&session.data.expires>Date.now()?session.data.hash:null;if(!expected)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0}
export async function commandServiceRunner(req,env,{seal,normalize}){
 if(req.method!=='POST')return json({error:'Método inválido'},405);
 if(new URL(req.url).pathname==='/bridge/commands/enroll'){
  const audience=new URL(req.url).origin+'/bridge/commands/enroll';
  const identity=await verifySessionJwt((req.headers.get('authorization')||'').replace(/^Bearer /,''),env,audience);
  if(!identity?.run_id)return json({error:'Sessão GitHub não autorizada',stage:identity?.stage||'unknown'},401);
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  await put(env,'discord2_service_auth_v1',{hash:await digest(token),expires:Date.now()+30*60000,run_id:identity.run_id});
  return json({token,expires_in:1800});
 }
 if(!await authorized(req,env))return json({error:'Executor não autorizado'},401);
 let data;try{data=await body(req)}catch{return json({error:'Pedido inválido'},400)}
 const path=new URL(req.url).pathname,now=Date.now();
 if(path==='/bridge/commands/poll'||path==='/bridge/commands/heartbeat'){
  if(data.owner_id!==String(env.BUSHIN_OWNER_DISCORD_ID)||data.ready!==true)return json({error:'Identidade ou conexão inválida'},403);
  const beat=await read(env,HEART);if(!beat||now-beat.data.at>10000||beat.data.instance_id!==data.instance_id||(data.planner_revision&&beat.data.planner_revision!==data.planner_revision))await put(env,HEART,{at:now,version:Number(data.version||1),planner_revision:String(data.planner_revision||beat?.data.planner_revision||'').slice(0,40),instance_id:String(data.instance_id||''),expires_at:Number(data.expires_at)||beat?.data.expires_at||null,mode:commandServiceConfigured(env)?'host':'github_session'});
  if(path==='/bridge/commands/heartbeat')return json({saved:true});
  const job=await read(env,JOB);
  if(!job||job.data.phase!=='queued')return json({job:null});
  if(now-job.data.at>120000){await cas(env,job,{...job.data,phase:'expired'});return json({job:null})}
  // An older runner cannot execute a job requiring the stop-before-send fence.
  if(job.data.run_id&&Number(data.version||1)<3)return json({job:null});
  if(job.data.run_id){const state=(await readAutoplay(env,String(env.BUSHIN_OWNER_DISCORD_ID))).state;if(state.run_id!==job.data.run_id||!['running','waiting','confirming'].includes(state.phase)){await cas(env,job,{...job.data,phase:'stopped'});return json({job:null})}}
  const next={...job.data,phase:'claimed',claimed_at:now,protocol:Number(data.version||1),executor_id:String(data.instance_id||'')};
  if(!await cas(env,job,next))return json({job:null});
  return json({job:{request_id:next.request_id,...next.request}});
 }
 if(path==='/bridge/commands/authorize'){
  const row=await read(env,JOB),job=row?.data;
  if(!job||job.request_id!==data.request_id||job.phase!=='claimed')return json({authorized:false});
  if(job.run_id){const state=(await readAutoplay(env,String(env.BUSHIN_OWNER_DISCORD_ID))).state;if(state.run_id!==job.run_id||!['running','waiting','confirming'].includes(state.phase)){await cas(env,row,{...job,phase:'stopped'});return json({authorized:false})}}
  // CAS competes with Stop. This grant is one-shot and is never retried.
  return json({authorized:await cas(env,row,{...job,phase:'sending',send_authorized_at:now})});
 }
 if(path==='/bridge/commands/result'){
  let row=await read(env,JOB),key=JOB;
  if(row?.data.request_id!==data.request_id&&/^[a-f0-9-]{36}$/.test(data.request_id||'')){key=archiveKey(data.request_id);row=await read(env,key)}
  const job=row?.data;if(!job||data.request_id!==job.request_id)return json({error:'Pedido divergente'},409);
  if(['finished','stopped','expired'].includes(job.phase))return json({saved:true});
  if(!['claimed','sending','uncertain'].includes(job.phase))return json({error:'Pedido não reservado'},409);
  const m=data.response;let result=null;
  if(job.request.command==='/agent-plan'){const brain=data.brain;if(!brain||typeof brain!=='object'||JSON.stringify(brain).length>15000)return json({error:'Plano inválido'},400);result=await seal({brain},env);}
  if(m){if(m.author_id!=='1515908078913192026'||m.channel_id!==job.request.channel_id||!id(m.message_id)||!Array.isArray(m.components)||!Array.isArray(m.embeds)||!(m.content||m.components.length||m.embeds.length||m.attachments?.length))return json({error:'Resposta inválida'},400);
   if(m.interaction_metadata?.user_id&&m.interaction_metadata.user_id!==String(env.BUSHIN_OWNER_DISCORD_ID))return json({error:'Resposta de outra conta'},400);
   const message=normalize({...m,id:m.message_id,author:{id:m.author_id,username:'Naruto Bot',bot:true},flags:m.flags??(m.ephemeral?64:0)});
   result=await seal({response:{...message,message_id:message.id}},env);
  }
  const next={...job,phase:'finished',confirmed:!!result,sealed:result,finished_at:now};
  if(!await cas(env,row,next,key))return json({error:'Estado mudou'},409);
  await archive(env,next);
  return json({saved:true});
 }
 return json({error:'Rota desconhecida'},404);
}
export async function commandServiceMobile(req,env,ctx,{unseal,baseUrl}){
 if(ctx.me?.id!==String(env.BUSHIN_OWNER_DISCORD_ID)||ctx.me?.membership?.member!==true)return json({error:'Conta não autorizada'},403);
 const row=await reconcileJob(env,await read(env,JOB));let job=row?.data;
 if(req.method==='GET'){
  const requested=new URL(req.url).searchParams.get('request_id');
  if(requested&&job?.request_id!==requested){job=(await read(env,archiveKey(requested)))?.data;if(!job)return json({state:'unknown',request_id:requested,confirmed:false,note:'Resultado histórico indisponível. Nenhum reenvio permitido.'})}
  if(!job)return json({state:'idle',confirmed:false,transport:'persistent_service'});
  if(job.phase==='finished'){const result=job.sealed?await unseal(job.sealed,env):{},beat=await read(env,HEART);const controlsCurrent=!!job.executor_id&&job.executor_id===beat?.data.instance_id&&Date.now()-(beat?.data.at||0)<30000;const game=job.game_context;const gameResponse=game?.sealed?(await unseal(game.sealed,env)).response:null;return json({...(gameResponse?{game_response:gameResponse,game_request_id:game.request_id,controls_current:game.executor_id===beat?.data.instance_id}:{}),state:'finished',request_id:job.request_id,command:job.request.command,confirmed:job.confirmed,executed:job.request.command!=='/agent-plan'&&job.confirmed,controls_current:job.request.command==='/agent-plan'?!!game&&game.executor_id===beat?.data.instance_id&&Date.now()-(beat?.data.at||0)<30000:controlsCurrent,...result,transport:'persistent_service'})}
  if(['stopped','expired'].includes(job.phase))return json({state:'stopped',request_id:job.request_id,confirmed:false,command:job.request.command,note:'Pedido não enviado.'});
  if(job.phase==='uncertain')return json({state:'uncertain',request_id:job.request_id,command:job.request.command,confirmed:false,note:'Executor desconectou após reservar a ação. Não repetir.'});
  return json({state:['claimed','sending'].includes(job.phase)?'in_progress':'queued',request_id:job.request_id,command:job.request.command,confirmed:false,note:['claimed','sending'].includes(job.phase)?'Cliente conectado aguardando resposta do Naruto Bot.':'Aguardando o cliente permanente; sem iniciar GitHub Actions.'});
 }
 if(req.method!=='POST'||req.headers.get('origin')!==baseUrl||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Origem ou formato inválido'},403);
 let data;try{data=await body(req,100000)}catch{return json({error:'Pedido inválido'},400)}
 if(data.action==='stop'){
  if(job?.phase==='sending'||job?.phase==='claimed'&&job.protocol<3)return json({state:'in_progress',stopped:false,note:'Ação já recebida pelo cliente; aguarde o resultado.'});
  if(['queued','claimed'].includes(job?.phase)){const next={...job,phase:'stopped'};if(!await cas(env,row,next))return json({state:'in_progress',stopped:false,note:'Estado mudou; confira o mesmo pedido.'});await archive(env,next)}
  return json({state:'stopped',stopped:true});
 }
 if(data.action!=='start'||!validServiceCommand(data.command_request))return json({error:'Comando inválido'},400);
 const heartbeat=await read(env,HEART);if(!heartbeat||Date.now()-heartbeat.data.at>30000)return json({error:'Executor permanente offline. Nenhum comando enviado.'},503);
 if(job&&['queued','claimed','sending'].includes(job.phase))return json({error:'Há uma ação pendente; consulte antes de repetir.'},409);
 if(data.run_id){const state=(await readAutoplay(env,String(env.BUSHIN_OWNER_DISCORD_ID))).state;if(state.run_id!==data.run_id||!['running','waiting','confirming'].includes(state.phase))return json({error:'Jogador parado ou execução substituída'},409);if(Number(heartbeat.data.version||0)<3)return json({error:'Executor antigo. Reconecte a sessão para usar Jogar com parada antes do envio.'},503)}
 if(data.command_request.command==='/agent-plan'&&(!data.run_id||Number(heartbeat.data.version||0)<4))return json({error:'Reconecte o executor para ativar o OpenCode (versão 4).'},409);
 if(data.command_request.command==='/component'){
  const game=job?.request.command==='/agent-plan'?job.game_context:job;
  const input=data.command_request.options;
  if(!game?.confirmed||!game.sealed)return json({error:'Não há caixa própria confirmada nesta sessão.'},409);
  if(!game.executor_id||game.executor_id!==heartbeat.data.instance_id)return json({error:'A caixa pertence ao executor anterior. Atualize com uma consulta do jogo.'},409);
  const previous=(await unseal(game.sealed,env)).response;
  const control=(previous.controls||[]).find(c=>c.custom_id===input.custom_id&&!c.disabled&&!c.url&&[2,3].includes(c.type));
  let values;try{values=JSON.parse(input.values||'[]')}catch{return json({error:'Seleção inválida'},400)}
  if(previous.message_id!==input.message_id||previous.channel_id!==data.command_request.channel_id||!control||!Array.isArray(values)||values.length>25||new Set(values).size!==values.length)return json({error:'Esta caixa está desatualizada ou não pertence à sua última resposta.'},409);
  if(control.type===2&&values.length||control.type===3&&(values.length<(control.min_values??1)||values.length>(control.max_values??1)||values.some(v=>!control.options?.some(o=>o.value===v))))return json({error:'Opção não oferecida pelo jogo.'},400);
 }
 await archive(env,job);
 const next={phase:'queued',at:Date.now(),request_id:crypto.randomUUID(),request:data.command_request,...(data.command_request.command==='/agent-plan'&&job?{game_context:job.request.command==='/agent-plan'?job.game_context:job}:{}),...(data.run_id?{run_id:data.run_id}:{})};
 if(!await cas(env,row,next))return json({error:'Outra ação foi reservada'},409);
 return json({state:'queued',submitted:true,executed:false,confirmed:false,command:next.request.command,request_id:next.request_id,transport:'persistent_service'});
}
