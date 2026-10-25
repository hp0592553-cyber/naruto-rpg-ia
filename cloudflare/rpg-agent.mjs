/** Persistent owner-only control and evidence. No Discord actions are emitted here. */
import {normalizeMessage} from './message-normalizer.mjs';
const STATE='discord2_agent_v1',SNAPSHOT='discord2_character_v1';
const initial=()=>({phase:'stopped',goal_level:20,revision:0,pending_action:null,reason:'Agente parado.'});
const integration=()=>({ready:false,mode:'official',reason:'Falta uma API de jogo autorizada pelo Naruto Project para agir pelo Henrique. OAuth de identidade e um bot próprio não executam os comandos do Naruto Bot.'});
async function get(env,owner,key){const r=await env.DB.prepare('SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?').bind(owner,key).first();return r?JSON.parse(r.value_json):null}
async function put(env,owner,key,value){await env.DB.prepare('INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(owner,key,JSON.stringify(value),Date.now()).run()}
export function responseSnapshot(request,message,owner){
 if(String(request.options?.usuario||owner)!==owner||message.author_id!=='1515908078913192026')return null;
 const fields=(message.embeds||[]).flatMap(e=>e.fields||[]),stats={};
 const names={'nível':'level','nivel':'level','xp':'xp','vida':'hp','chakra':'chakra','energia':'energy'};
 for(const f of (/^\/?(?:perfil ver|nivel)$/.test(request.command)?fields:[])){const key=names[String(f.name||'').normalize('NFKC').trim().toLowerCase()];if(!key)continue;
  const match=String(f.value||'').trim().match(/^(\d{1,9})(?:\s*\/\s*(\d{1,9}))?$/);if(match)stats[key]={value:Number(match[1]),max:match[2]?Number(match[2]):null,message_id:message.id};
 }
 const text=String(message.normalized_text||'');
 const mission=/^\/?missoes\s/.test(request.command)&&/você não tem missões ativas/i.test(text)?{state:'none',message_id:message.id}:null;
 return {owner_id:owner,stats,mission,evidence:{message_id:message.id,request_id:request.request_id,command:request.command,channel_id:message.channel_id,ephemeral:message.ephemeral},updated_at:Date.now()};
}
export async function recordCommandEvidence(env,owner,request,raw){
 const message=normalizeMessage({...raw,id:raw.message_id,author:{id:raw.author_id,username:'Naruto Bot',bot:true},flags:raw.flags??(raw.ephemeral?64:0)});
 const snapshot=responseSnapshot(request,message,owner);
 if(snapshot){const previous=await get(env,owner,SNAPSHOT)||{};await put(env,owner,SNAPSHOT,{...snapshot,stats:{...(previous.stats||{}),...snapshot.stats},mission:snapshot.mission||previous.mission||null})}
 const at=Date.now();await put(env,owner,'rpg-audit:'+request.request_id,{id:request.request_id,at,type:'command_response',command:request.command,message_id:message.id,channel_id:message.channel_id,ephemeral:message.ephemeral,accepted_by_game:null});
 return message;
}
export async function agentRoute(req,env,ctx,{reply,baseUrl,plan}){
 const owner=String(ctx.me?.id||''),headers={'cache-control':'no-store'};
 if(owner!==String(env.BUSHIN_OWNER_DISCORD_ID)||ctx.me?.membership?.member!==true)return reply({error:'Conta do Henrique necessária.'},403,headers);
 if(req.method==='GET'){
  const state=await get(env,owner,STATE)||initial(),snapshot=await get(env,owner,SNAPSHOT);
  const rows=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key LIKE 'rpg-audit:%' ORDER BY updated_at DESC LIMIT 30").bind(owner).all();
  return reply({state,snapshot,integration:integration(),history:(rows.results||[]).map(r=>JSON.parse(r.value_json)),background_execution:false},200,headers);
 }
 if(req.method!=='POST')return reply({error:'Método inválido.'},405,headers);
 if(req.headers.get('origin')!==baseUrl||!req.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Origem ou formato inválido.'},403,headers);
 let data;try{const raw=await req.text();if(raw.length>2000)throw Error();data=JSON.parse(raw)}catch{return reply({error:'Pedido inválido.'},400,headers)}
 if(!['start','pause','resume','stop','plan'].includes(data.action))return reply({error:'Ação inválida.'},400,headers);
 const state=await get(env,owner,STATE)||initial();
 if(!Number.isInteger(data.revision)||data.revision!==state.revision)return reply({error:'O estado mudou; atualize o painel.',code:'state_conflict'},409,headers);
 let next={...state,revision:state.revision+1,updated_at:Date.now()},result=null;
 if(['start','resume'].includes(data.action))next={...next,phase:'blocked',reason:integration().reason};
 if(data.action==='pause')next={...next,phase:'paused',reason:'Pausado pelo usuário.'};
 if(data.action==='stop')next={...next,phase:'stopped',pending_action:null,reason:'Parado pelo usuário. Nenhuma nova ação será solicitada.'};
 if(data.action==='plan'){
  if(!/^\d{15,22}$/.test(String(data.channel_id||'')))return reply({error:'Canal inválido.'},400,headers);
  // A plan uses the read-only model path. It never dispatches a command.
  result=await plan(data.channel_id);
  if(!result.ok)return reply({error:result.error||'Não foi possível planejar.'},503,headers);
  next={...next,phase:'planned',reason:'Plano disponível. Nenhuma ação foi executada.',plan:result.plan,pending_action:null};
 }
 const old=JSON.stringify(state),json=JSON.stringify(next),time=Date.now();
 await env.DB.prepare('INSERT OR IGNORE INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?)').bind(owner,STATE,old,time).run();
 const saved=await env.DB.prepare('UPDATE bushin_project_state SET value_json=?,updated_at=? WHERE owner_id=? AND key=? AND value_json=?').bind(json,time,owner,STATE,old).run();
 if(Number(saved.meta?.changes)!==1)return reply({error:'Outro pedido alterou o estado.',code:'state_conflict'},409,headers);
 await put(env,owner,'rpg-audit:'+crypto.randomUUID(),{at:time,type:'agent_control',action:data.action,phase:next.phase,executed:false});
 return reply({state:next,integration:integration(),executed:false,background_execution:false},200,headers);
}
