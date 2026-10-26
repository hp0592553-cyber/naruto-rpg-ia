/** Contract for an operator-approved game service. No Discord user token or browser session is used. */
export const GAME_PROTOCOL='bushin-game-v1';
export const GAME_KINDS=Object.freeze(['query','channel','travel','mission','npc','combat','reply','recover','item']);
const ID=/^[0-9]{15,22}$/;
const key=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v);
const text=(v,n=300)=>typeof v==='string'?v.slice(0,n):'';
export class GameIntegrationError extends Error{
 constructor(code,message,{retryAt=0}={}){super(message);this.code=code;this.retryAt=retryAt;}
}
export function gameConfiguration(env){
 const missing=[];
 if(!env.BUSHIN_GAME?.fetch)missing.push('BUSHIN_GAME: service binding para o adaptador autorizado pelo jogo');
 if(!key(env.BUSHIN_GAME_APPROVAL))missing.push('BUSHIN_GAME_APPROVAL: referência da autorização do operador');
 return {configured:missing.length===0,code:missing.length?'game_integration_missing':null,missing,
  protocol:GAME_PROTOCOL,transport:'service_binding',personal_account_automation:false,
  scheduler_enabled:env.BUSHIN_AUTOPLAY_CRON==='enabled'};
}
export async function boundedJson(source,maxBytes=98304){
 const reader=source.body?.getReader();if(!reader)throw new GameIntegrationError('invalid_json','Resposta JSON ausente.');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new GameIntegrationError('payload_too_large','Resposta maior que o limite.');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new GameIntegrationError('invalid_json','A integração não retornou JSON válido.');}
}
export function retryAt(header,now=Date.now()){
 if(header!==null&&header!==undefined&&String(header).trim()!==''){
  const value=Number(header);if(Number.isFinite(value)&&value>=0)return now+Math.ceil(value*1000);
  const at=Date.parse(header);if(Number.isFinite(at))return Math.max(now,at);
 }
 return now+30000;
}
function assertEnvelope(data,grant){
 if(data?.protocol!==GAME_PROTOCOL||data.owner_id!==grant.owner_id||data.character_id!==grant.character_id)
  throw new GameIntegrationError('wrong_character','Resposta não pertence ao personagem autorizado.');
}
const validTime=(at,now)=>Number.isSafeInteger(at)&&at>now-60000&&at<=now+5000;
export function validateGrant(data,env,owner,now=Date.now()){
 if(data?.protocol!==GAME_PROTOCOL||data.game!=='naruto-project'||data.authorized!==true||data.owner_id!==owner||
  !key(data.character_id)||data.approval_reference!==env.BUSHIN_GAME_APPROVAL||!key(data.grant_id)||
  !Number.isSafeInteger(data.expires_at)||data.expires_at<=now||data.idempotency!==true||data.result_lookup!==true||
  !Array.isArray(data.channel_ids)||!data.channel_ids.length||data.channel_ids.length>100||data.channel_ids.some(x=>!ID.test(x))||
  !Array.isArray(data.allowed_kinds)||data.allowed_kinds.some(x=>!GAME_KINDS.includes(x)))
  throw new GameIntegrationError('game_authorization_invalid','A integração não comprovou autorização, personagem, escopos e consulta de resultados.');
 return {protocol:GAME_PROTOCOL,owner_id:owner,character_id:data.character_id,grant_id:data.grant_id,
  approval_reference:data.approval_reference,expires_at:data.expires_at,channel_ids:[...new Set(data.channel_ids)],allowed_kinds:[...new Set(data.allowed_kinds)]};
}
function number(v,{min=0,max=1e12}={}){return Number.isSafeInteger(v)&&v>=min&&v<=max?v:null;}
function resource(v){return v&&number(v.current)!==null&&number(v.max,{min:1})!==null&&v.current<=v.max?{current:v.current,max:v.max}:null;}
export function validateObservation(data,grant,now=Date.now()){
 assertEnvelope(data,grant);
 if(!key(data.revision)||!validTime(data.observed_at,now)||!grant.channel_ids.includes(data.channel_id))
  throw new GameIntegrationError('stale_observation','Estado do jogo expirado, sem revisão ou fora dos canais autorizados.');
 const stats=data.stats||{};
 const out={protocol:GAME_PROTOCOL,owner_id:grant.owner_id,character_id:grant.character_id,revision:data.revision,
  observed_at:data.observed_at,channel_id:data.channel_id,
  stats:{level:number(stats.level,{min:1,max:100000}),xp:number(stats.xp),hp:resource(stats.hp),chakra:resource(stats.chakra),energy:resource(stats.energy)},
  mission:data.mission?{id:text(data.mission.id,120),label:text(data.mission.label,200),status:text(data.mission.status,30)}:null,
  location:text(data.location,200),cooldown_until:Number.isSafeInteger(data.cooldown_until)?data.cooldown_until:0,inventory:(Array.isArray(data.inventory)?data.inventory:[]).slice(0,80).filter(i=>key(i.id)&&number(i.quantity)!==null).map(i=>({id:i.id,quantity:i.quantity})),rules_revision:text(data.rules_revision,120),rules:text(data.rules,5000),
  combat:{active:data.combat?.active===true,own_turn:data.combat?.own_turn===true,enemy_known:data.combat?.enemy_known===true,rules_known:data.combat?.rules_known===true},
  messages:(Array.isArray(data.messages)?data.messages:[]).slice(-8).map(m=>({id:ID.test(String(m.id))?m.id:null,author_id:ID.test(String(m.author_id))?m.author_id:null,content:text(m.content,1200),ephemeral:m.ephemeral===true})),
  available_actions:[]};
 const ids=new Set();for(const a of(Array.isArray(data.available_actions)?data.available_actions:[]).slice(0,40)){
  if(!key(a.id)||ids.has(a.id)||!key(a.semantic_key)||!GAME_KINDS.includes(a.kind)||!grant.allowed_kinds.includes(a.kind)||
    a.state_revision!==out.revision||!grant.channel_ids.includes(a.channel_id)||a.safe!==true||a.risk!=='low'||
    !Number.isSafeInteger(a.expires_at)||a.expires_at<=now||a.owner_id!==grant.owner_id)continue;
  ids.add(a.id);const cost={chakra:number(a.cost?.chakra),energy:number(a.cost?.energy)};
  // Missing cost information is not treated as zero for game-changing actions.
  out.available_actions.push({id:a.id,semantic_key:a.semantic_key,kind:a.kind,label:text(a.label,200),
   channel_id:a.channel_id,state_revision:a.state_revision,expires_at:a.expires_at,safe:true,risk:'low',cost,
   reply_to:ID.test(String(a.reply_to))?a.reply_to:null,reply_max_chars:Math.min(1200,number(a.reply_max_chars,{min:1,max:1200})||500),
   item_costs:(Array.isArray(a.item_costs)?a.item_costs:[]).slice(0,10).map(i=>({id:key(i.id)?i.id:'',quantity:number(i.quantity,{min:1})})),not_before:Number.isSafeInteger(a.not_before)?a.not_before:0});
 }
 return out;
}
export function validateResult(data,grant,operationId,now=Date.now()){
 assertEnvelope(data,grant);
 if(data.operation_id!==operationId||!['pending','completed','rejected','unknown'].includes(data.status))
  throw new GameIntegrationError('result_uncorrelated','Resultado sem o identificador exato da ação.');
 const result={operation_id:operationId,status:data.status,reason:text(data.reason,400)};
 if(data.status==='completed'){
  if(data.game_confirmed!==true||typeof data.action_id!=='string')throw new GameIntegrationError('result_unconfirmed','O jogo ainda não confirmou a execução.');
  if(!Number.isSafeInteger(data.snapshot?.observed_at)||data.snapshot.observed_at<=0||data.snapshot.observed_at>now+5000)throw new GameIntegrationError('result_unconfirmed','Estado de resultado inválido.');
  result.action_id=data.action_id;result.game_confirmed=true;result.snapshot=validateObservation(data.snapshot,grant,data.snapshot.observed_at);
  // The controller normalizes media/components separately and does not expose raw fields from the adapter.
  result.response=data.response&&typeof data.response==='object'?data.response:null;
 }
 return result;
}
export function createGameAdapter(env,owner,{now=()=>Date.now()}={}){
 const config=gameConfiguration(env);
 async function request(path,{method='GET',body}={}){
  if(!config.configured)throw new GameIntegrationError('game_integration_missing','Falta configurar o adaptador autorizado pelo Naruto Project.');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
  try{
   const res=await env.BUSHIN_GAME.fetch('https://bushin-game.internal/v1'+path,{method,signal:ctrl.signal,redirect:'manual',headers:{accept:'application/json','x-bushin-owner-id':owner,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(res.status===429)throw new GameIntegrationError('game_rate_limited','A integração limitou as consultas. Aguardando Retry-After.',{retryAt:retryAt(res.headers.get('retry-after'),now())});
   if(!res.ok)throw new GameIntegrationError(res.status===404?'operation_not_found':'game_http_error','A integração retornou HTTP '+res.status+'.');
   return await boundedJson(res);
  }catch(e){if(e instanceof GameIntegrationError)throw e;throw new GameIntegrationError('game_transport_uncertain','Não foi possível confirmar a resposta da integração.');}
  finally{clearTimeout(timer);}
 }
 return {configuration:config,
  async authorize(){return validateGrant(await request('/authorization'),env,owner,now());},
  async observe(grant){return validateObservation(await request('/observation'),grant,now());},
  async execute(grant,operation,action,replyText){
   const data=await request('/actions',{method:'POST',body:{protocol:GAME_PROTOCOL,owner_id:owner,character_id:grant.character_id,grant_id:grant.grant_id,
    operation_id:operation.id,available_action_id:action.id,expected_revision:action.state_revision,...(action.kind==='reply'?{reply_text:replyText}:{})}});
   assertEnvelope(data,grant);if(data.operation_id!==operation.id||data.accepted!==true)throw new GameIntegrationError('dispatch_uncertain','Pedido enviado, mas sem confirmação de recebimento pelo jogo.');
   return {accepted:true};
  },
  async result(grant,id){return validateResult(await request('/actions/'+encodeURIComponent(id)),grant,id,now());}
 };
}
