/*
 * Bushin Naruto RPG - Personal Discord session transport
 * Activated only when the owner explicitly creates DISCORD_USER_TOKEN
 * as a Cloudflare Worker secret. No token is returned, logged or stored in D1.
 * Discord does not authorize self-bots; user-token APIs may stop working.
 */
import {normalizeMessage} from "./message-normalizer.mjs";
import {observeNaruto} from "./naruto-observer.mjs";
import {validateMobileImages} from "./mobile-message.mjs";
const API="https://discord.com/api/v10";
const GUILD="1515877468299595919";
const OWNER=/^\d{15,22}$/;
const id=v=>typeof v==="string"&&OWNER.test(v);
const readOnly={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
export const PERSONAL_TOOLS=[
  {name:"bushin_naruto_personal_status",title:"🍥 Estado do cliente Naruto pessoal",
   description:"Verifica se a Secret DISCORD_USER_TOKEN foi configurada; não revela nem usa o token neste teste.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:readOnly},
  {name:"bushin_naruto_personal_read",title:"🍥 Ler canal Naruto com sessão pessoal",
   description:"Usa a Secret configurada pelo dono para ler até 50 mensagens por página de um canal validado do Naruto Project.",
   inputSchema:{type:"object",properties:{channel_id:{type:"string",pattern:"^[0-9]{15,22}$"},limit:{type:"integer",minimum:1,maximum:50},before:{type:"string",pattern:"^[0-9]{15,22}$"}},required:["channel_id"],additionalProperties:false},annotations:readOnly},
  {name:"bushin_naruto_personal_send",title:"🍥 Enviar mensagem Naruto com sessão pessoal",
   description:"Envia somente mensagem aprovada, em canal validado do Naruto Project, usando a Secret pessoal. Discord não permite self-bots.",
   inputSchema:{type:"object",properties:{channel_id:{type:"string",pattern:"^[0-9]{15,22}$"},text:{type:"string",minLength:1,maxLength:500},confirmed:{type:"boolean"}},required:["channel_id","text","confirmed"],additionalProperties:false},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}}
];
export const PERSONAL_NAMES=new Set(PERSONAL_TOOLS.map(x=>x.name));
function owner(env,ctx){
 const me=String(ctx?.me?.id||"");
 if(!id(me)||me!==env.BUSHIN_OWNER_DISCORD_ID||ctx.me?.membership?.member!==true)
   throw Error("A conta OAuth do dono, membro do Naruto Project, é necessária.");
 return me;
}
function secret(env){
 const value=env.DISCORD_USER_TOKEN;
 if(typeof value!=="string"||value.trim().length<35)return null;
 return value.trim();
}
// Per-credential 429 cooldown; never automatically replay blocked requests.
const upstreamPauseByFingerprint=new Map();
function tokenFingerprint(token){let hash=2166136261;for(let i=0;i<token.length;i++)hash=Math.imul(hash^token.charCodeAt(i),16777619);return hash>>>0;}
async function request(token,path,method="GET",body=null){
 const fingerprint=tokenFingerprint(token),upstreamPauseUntil=upstreamPauseByFingerprint.get(fingerprint)||0;
 if(Date.now()<upstreamPauseUntil){const remaining=Math.max(1,Math.ceil((upstreamPauseUntil-Date.now())/1000));return {state:"unavailable",code:429,retry_after_seconds:remaining,reason:"Discord em pausa por 429: "+remaining+" segundos restantes. Nenhuma requisição enviada."};}
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
   const options={method,headers:{Authorization:token,Accept:"application/json"},signal:controller.signal};
    if(body!==null){if(body instanceof FormData)options.body=body;else{options.headers["Content-Type"]="application/json";options.body=JSON.stringify(body);}}
   const res=await fetch(API+path,options);
   if(res.status===401)return {state:"unavailable",reason:"Token pessoal recusado (401).",code:401};
   if(res.status===403)return {state:"unavailable",reason:"Acesso negado pelo Discord (403); nenhum contorno de bloqueio será tentado.",code:403};
   if(res.status===429){let body=null;try{body=await res.json()}catch{} const h=Number.parseFloat(res.headers.get("retry-after")||res.headers.get("x-ratelimit-reset-after")||"");const j=Number(body?.retry_after);const raw=Number.isFinite(h)&&h>0?h:Number.isFinite(j)&&j>0?j:30;const seconds=Math.min(900,Math.max(1,Math.ceil(raw)));upstreamPauseByFingerprint.set(fingerprint,Math.max(upstreamPauseUntil,Date.now()+seconds*1000));if(upstreamPauseByFingerprint.size>16){for(const [k,until] of upstreamPauseByFingerprint)if(until<=Date.now())upstreamPauseByFingerprint.delete(k)}return {state:"unavailable",code:429,retry_after_seconds:seconds,reason:"Discord limitou requisições (429). Aguarde "+seconds+" segundos sem repetir."}}
    if(!res.ok)return {state:method!=="GET"&&res.status>=500?"unknown":"unavailable",reason:"Discord retornou HTTP "+res.status,code:res.status};
   const data=await res.json();
   return {state:"completed",data};
  }catch(e){return {state:method!=="GET"?"unknown":"unavailable",reason:method!=="GET"?"Entrega incerta: Discord não respondeu. Consulte o recibo; não repita o envio.":"Discord indisponível ou conexão expirou."};}
 finally{clearTimeout(timeout);}
}
async function authorize(env,ctx){
 const token=secret(env);
 if(!token)return {state:"not_configured",reason:"Configure DISCORD_USER_TOKEN como Secret no Worker Cloudflare. Nunca envie a Key no chat."};
 const result=await request(token,"/users/@me");
 if(result.state!=="completed")return result;
 if(String(result.data?.id||"")!==String(ctx.me.id)||result.data?.bot===true)
   return {state:"unavailable",reason:"A Key não pertence à mesma conta pessoal Henrique autorizada pelo OAuth."};
 return {state:"completed",token};
}
async function checkChannel(token,channelId){
 if(!id(channelId))return {state:"unavailable",reason:"ID de canal inválido."};
 const r=await request(token,"/channels/"+channelId);
 if(r.state!=="completed")return r;
 if(String(r.data?.guild_id||"")!==GUILD)return {state:"unavailable",reason:"Canal fora do Naruto Project não autorizado."};
 return {state:"completed",channel_id:channelId};
}
export async function personalIdentityCheck(env,ctx={}){
  owner(env,ctx);
  const identity=await authorize(env,ctx);
  const base={state:identity.state,secret_configured:!!secret(env),
    discord_identity_verified:identity.state==="completed",
    discord_owner_id:identity.state==="completed"?String(ctx.me.id):null,
    reason:identity.state==="completed"?"A Key corresponde à conta OAuth do dono.":identity.reason||"Identidade indisponível.",
    ...(Number.isInteger(identity.code)?{http_status:identity.code}:{})};
  if(identity.state!=="completed")return {...base,channel_verified:false,read_verified:false};
  const channelId="1520114348079583263";
  const ch=await checkChannel(identity.token,channelId);
  if(ch.state!=="completed")return {...base,channel_verified:false,read_verified:false,read_reason:ch.reason||"Canal indisponível.",
    ...(Number.isInteger(ch.code)?{read_http_status:ch.code}:{})};
  const messages=await request(identity.token,"/channels/"+channelId+"/messages?limit=1");
  if(messages.state!=="completed")return {...base,channel_verified:true,read_verified:false,read_reason:messages.reason||"Histórico indisponível.",
    ...(Number.isInteger(messages.code)?{read_http_status:messages.code}:{})};
  return {...base,channel_verified:true,read_verified:Array.isArray(messages.data),
    channel_id:channelId,read_items:Array.isArray(messages.data)?messages.data.length:0,
    note:"O conteúdo das mensagens foi descartado; nenhuma mensagem enviada."};
}
export async function personalCall(env,name,args={},ctx={}){
 if(!PERSONAL_NAMES.has(name))throw Error("Ferramenta desconhecida.");
 owner(env,ctx);
 if(name==="bushin_naruto_personal_status")
   return {state:secret(env)?"configured_unverified":"not_configured",secret_configured:!!secret(env),
     oauth_id:ctx.me.id,guild_id:GUILD,
     note:"Secret presente não confirma que o Discord aceite a conexão. Sem Key, nada é enviado."};
 if(args.before!==undefined&&(!id(args.before)||name!=="bushin_naruto_personal_read"))throw Error("Cursor de histórico inválido.");
 const identity=await authorize(env,ctx);
 if(identity.state!=="completed")return {...identity,read:false,sent:false};
 const token=identity.token;
 const access=await checkChannel(token,args.channel_id);
 if(access.state!=="completed")return {...access,read:false,sent:false};
 if(name==="bushin_naruto_personal_read"){
   const limit=Number.isInteger(args.limit)?Math.max(1,Math.min(50,args.limit)):12;
   const r=await request(token,"/channels/"+args.channel_id+"/messages?limit="+limit+(args.before?"&before="+encodeURIComponent(args.before):""));
   if(r.state!=="completed")return {...r,read:false};
   if(!Array.isArray(r.data))return {state:"unavailable",reason:"Resposta inesperada do Discord.",read:false};
   const messages=r.data.map(m=>normalizeMessage(m,{channelId:args.channel_id}));
   return {state:"completed",read:true,guild_id:GUILD,channel_id:args.channel_id,
     messages,pagination:{requested_before:args.before||null,page_size:limit,returned:messages.length,
       next_before:messages.length===limit&&messages.every(m=>id(m.id)&&(!args.before||BigInt(m.id)<BigInt(args.before)))?messages.reduce((old,m)=>BigInt(m.id)<BigInt(old)?m.id:old,messages[0].id):null,
       scope:"accessible_channel_history",note:"A full page may have older results; follow next_before until null. Deleted and ephemeral messages are not included."},
     rpg_observation:observeNaruto(messages,ctx.me.id)};
 }
 if(args.confirmed!==true)return {state:"awaiting_confirmation",sent:false,reason:"Confirmação exata exigida."};
  const message=args.text;
  let images;try{images=await validateMobileImages(args.files||[]);}catch(e){return {state:"unavailable",reason:e.message,sent:false};}
  if(typeof message!=="string"||message!==message.trim()||!message.length&&!images.length||message.length>500||/\x00/.test(message)||/@(?:everyone|here)\b/i.test(message))
    return {state:"unavailable",reason:"Mensagem inválida (até 500 caracteres ou imagem, sem menções globais).",sent:false};
 const key="naruto_personal_last_message";
 const record=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?").bind(ctx.me.id,key).first();
 const last=record?JSON.parse(record.value_json):null;
 const stamp=Date.now();
 if(last&&stamp-last.at<20000)return {state:"cooldown",retry_after_seconds:Math.ceil((20000-(stamp-last.at))/1000),reason:"Pausa preventiva entre mensagens: aguarde "+Math.ceil((20000-(stamp-last.at))/1000)+" segundos; nada foi reenviado.",sent:false};
 const mentions=Array.isArray(args.mention_ids)?[...new Set(args.mention_ids.map(String))]:[];
 if(mentions.length>5||!mentions.every(v=>id(v)&&message.includes("<@"+v+">")))return {state:"unavailable",reason:"IDs de marcação inválidos.",sent:false};
 const replyId=args.reply_to===undefined?null:String(args.reply_to);
 if(replyId!==null&&!id(replyId))return {state:"unavailable",reason:"ID da mensagem original inválido.",sent:false};
  const payload={content:message,allowed_mentions:{parse:[],users:mentions,replied_user:false},...(replyId?{message_reference:{type:0,message_id:replyId,channel_id:args.channel_id,guild_id:GUILD,fail_if_not_exists:true}}:{})};
  if(args.nonce!==undefined){if(!/^\d{1,25}$/.test(String(args.nonce)))return {state:"unavailable",sent:false,reason:"Nonce inválido."};payload.nonce=String(args.nonce);payload.enforce_nonce=true;}
  let outgoing=payload;
  if(images.length){const form=new FormData();payload.attachments=images.map((f,i)=>({id:i,filename:f.name}));form.append('payload_json',JSON.stringify(payload));images.forEach((f,i)=>form.append('files['+i+']',f.file,f.name));outgoing=form;}
  const result=await request(token,"/channels/"+args.channel_id+"/messages","POST",outgoing);
  if(result.state!=="completed")return {...result,sent:result.state==="unknown"?null:false};
 const mid=result.data?.id;
  if(!id(mid)||String(result.data?.author?.id||"")!==ctx.me.id||String(result.data?.channel_id||"")!==args.channel_id)
    return {state:"unknown",sent:null,reason:"Discord não confirmou autor, canal e ID; não repetir automaticamente."};
 let tracking_saved=true;
 try{await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
   .bind(ctx.me.id,key,JSON.stringify({at:stamp,id:mid}),stamp).run();
 }catch{tracking_saved=false;}
 return {state:"completed",sent:true,message_id:mid,channel_id:args.channel_id,author_id:ctx.me.id,tracking_saved,
   ...(!tracking_saved?{note:"Entrega confirmada pelo Discord; registro local falhou. Não repetir a mensagem."}:{})};
}

function channelVisibleForMember(channel,filter,parent){
 if(!filter||!Array.isArray(filter.roles)||!/^[0-9]+$/.test(String(filter.basePermissions||""))||!/^[0-9]{15,22}$/.test(String(filter.memberId||"")))return false;
 let permissions=BigInt(filter.basePermissions);
 const view=1n<<10n,history=1n<<16n,admin=1n<<3n;
 if((permissions&admin)!==0n)return true;
 const roles=new Set(filter.roles.map(String));
 const own=Array.isArray(channel.permission_overwrites)?channel.permission_overwrites:[];
 const inherited=Array.isArray(parent?.permission_overwrites)?parent.permission_overwrites:[];
 const all=own.length?own:inherited;
 const bits=v=>{try{return BigInt(String(v??"0"))}catch{return 0n}};
 const apply=(deny,allow)=>{permissions=(permissions&~deny)|allow};
 const everyone=all.find(x=>Number(x.type)===0&&String(x.id)===GUILD);
 if(everyone)apply(bits(everyone.deny),bits(everyone.allow));
 let deny=0n,allow=0n;
 for(const x of all)if(Number(x.type)===0&&roles.has(String(x.id))){deny|=bits(x.deny);allow|=bits(x.allow)}
 apply(deny,allow);
 const person=all.find(x=>Number(x.type)===1&&String(x.id)===String(filter.memberId));
 if(person)apply(bits(person.deny),bits(person.allow));
 return (permissions&view)!==0n&&(permissions&history)!==0n;
}
/** Read-only guild channel metadata; each message read still checks access. */
export async function personalForumThreads(env,forumId,ctx={},before=null){
 owner(env,ctx);
 if(!id(forumId)||before&&(!/^[0-9TZ:.-]{10,40}$/.test(before)))return {state:"unavailable",reason:"ID de fórum ou cursor inválido.",listed:false};
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {...auth,listed:false};
 const checked=await request(auth.token,"/channels/"+forumId);
 if(checked.state!=="completed")return {...checked,listed:false};
 if(String(checked.data?.guild_id||"")!==GUILD||![15,16].includes(Number(checked.data?.type)))return {state:"unavailable",reason:"Este canal não é um fórum do Naruto Project.",listed:false};
 const calls=before?[request(auth.token,"/channels/"+forumId+"/threads/archived/public?limit=30&before="+encodeURIComponent(before))]:[
   request(auth.token,"/guilds/"+GUILD+"/threads/active"),
   request(auth.token,"/channels/"+forumId+"/threads/archived/public?limit=30")
 ];
 const results=await Promise.all(calls);
 const active=before?null:results[0],archive=before?results[0]:results[1];
 if(active?.state!=="completed"&&archive.state!=="completed")return {state:"unavailable",reason:"Discord não liberou a listagem de publicações deste fórum.",listed:false};
 const a=Array.isArray(active?.data?.threads)?active.data.threads:[];
 const b=Array.isArray(archive.data?.threads)?archive.data.threads:[];
 const all=new Map();
 for(const t of a.concat(b)){if(id(t?.id)&&String(t.parent_id||"")===forumId&&(Number(t.type)===11||Number(t.type)===12))all.set(t.id,t)}
 const rows=[...all.values()].sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1).slice(0,45);
 return {state:"completed",listed:true,forum_id:forumId,posts:rows.map(t=>({id:t.id,title:String(t.name||"Publicação").slice(0,120),parent_id:forumId,owner_id:id(t.owner_id)?t.owner_id:null,archived:t.thread_metadata?.archived===true,created_at:String(t.thread_metadata?.create_timestamp||t.thread_metadata?.archive_timestamp||""),message_count:Number(t.message_count||0),last_message_id:id(t.last_message_id)?t.last_message_id:null,applied_tags:Array.isArray(t.applied_tags)?t.applied_tags.slice(0,8):[]})),has_more:archive?.data?.has_more===true,next_before:archive?.data?.has_more&&b.length?String(b[b.length-1].thread_metadata?.archive_timestamp||""):null,partial:active?.state!=="completed"||archive.state!=="completed"};
}

export async function personalListChannels(env,ctx={}){
 owner(env,ctx);
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {...auth,listed:false};
 const r=await request(auth.token,"/guilds/"+GUILD+"/channels");
 if(r.state!=="completed")return {...r,listed:false};
 if(!Array.isArray(r.data))return {state:"unavailable",listed:false,reason:"Resposta de canais inválida."};
 const all=r.data.slice(0,500).filter(c=>id(c.id)&&[0,4,5,15,16].includes(c.type));
 const filter=ctx.channelVisibility;
 let selected=all;
 if(filter){
   const categories=new Map(all.filter(c=>c.type===4).map(c=>[c.id,c]));
   const permitted=all.filter(c=>c.type!==4&&channelVisibleForMember(c,filter,categories.get(c.parent_id)));
   const activeParents=new Set(permitted.map(c=>c.parent_id).filter(Boolean));
   selected=all.filter(c=>c.type===4?activeParents.has(c.id):permitted.includes(c));
 }

 return {state:"completed",mode:"personal_user_token",listed:true,guild_id:GUILD,
  channels:selected.map(c=>({id:c.id,name:String(c.name||"").slice(0,100),type:c.type,parent_id:c.parent_id||null,topic:String(c.topic||"").slice(0,2000),message_read_access:filter?"permissions_filtered":"not_verified"})),
  visibility_filtered:!!filter,truncated:r.data.length>500,note:filter?"Canais filtrados por cargos e permissões; acesso ao histórico confirmado ao abrir cada canal.":"Metadados retornados pelo Discord. A leitura de cada canal continua sujeita às permissões reais; não lê DMs."};
}

// Read-only index lookup matching discord.py-self 2.1.0. Never submits interactions.
async function personalInspectCommandRaw(env,args={},ctx={}){
 owner(env,ctx);
 if(typeof args.command!=="string"||!/^\/[a-z0-9_-]{1,32}( [a-z0-9_-]{1,32}){0,2}$/.test(args.command))throw Error("Informe o caminho do comando, sem valores de parâmetros.");
 const channelId=args.channel_id===undefined?"1520114348079583263":args.channel_id;
 if(!id(channelId))throw Error("ID de canal inválido.");
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {...auth,catalog_verified:false,executed:false,sent:false};
 const channel=await checkChannel(auth.token,channelId);
 if(channel.state!=="completed")return {...channel,catalog_verified:false,executed:false,sent:false};
 const result=await request(auth.token,"/guilds/"+GUILD+"/application-command-index");
 const direct=result.code===429?{state:"unavailable",code:429}:Array.isArray(result.data?.application_commands)&&result.data.application_commands.some(c=>String(c.application_id)==="1515908078913192026")?{state:"completed",data:[]}:await request(auth.token,"/applications/1515908078913192026/commands");
 const index=Array.isArray(result.data?.application_commands)?result.data.application_commands:[];
 const directCommands=Array.isArray(direct.data)?direct.data.filter(c=>Number(c.type)===1):[];
 if(result.state!=="completed"&&!directCommands.length)return {state:"unavailable",catalog_verified:false,executed:false,sent:false,reason:result.reason||"Catálogo indisponível.",...(Number.isInteger(result.code)?{code:result.code}:{}),...(result.retry_after_seconds?{retry_after_seconds:result.retry_after_seconds}:{})};
 if(!index.length&&!directCommands.length)return {state:"unavailable",catalog_verified:false,executed:false,sent:false,reason:"Nenhum comando verificado foi encontrado."};
 const option=(o,depth=0)=>({name:String(o.name||"").slice(0,100),type:o.type,description:String(o.description||"").slice(0,500),required:o.required===true,
  ...(depth<2&&Array.isArray(o.options)?{options:o.options.slice(0,25).map(x=>option(x,depth+1))}:{}),
  ...(Array.isArray(o.choices)?{choices:o.choices.slice(0,25).map(c=>({name:String(c.name||"").slice(0,100),value:c.value}))}:{})});
 const apps=new Map((Array.isArray(result.data?.applications)?result.data.applications:[]).filter(a=>/^\d{15,22}$/.test(String(a?.id||""))).map(a=>[String(a.id),a]));
 if(directCommands.length)apps.set("1515908078913192026",{id:"1515908078913192026",name:"Naruto Bot"});
 const joined=new Map(index.filter(c=>c.type===1&&/^\d{15,22}$/.test(String(c.application_id||""))).map(c=>[String(c.application_id)+":"+String(c.id),c]));
 for(const c of directCommands)if(/^\d{15,22}$/.test(String(c.id||"")))joined.set("1515908078913192026:"+String(c.id),{...c,application_id:"1515908078913192026"});
 const commands=[...joined.values()].sort((a,b)=>{const isNaruto=c=>/naruto/i.test(String(apps.get(String(c.application_id))?.name||c.application?.name||""))||String(c.application_id)==="1515908078913192026";return Number(isNaruto(b))-Number(isNaruto(a))}).slice(0,450).map(c=>{
 const appId=String(c.application_id),app=apps.get(appId),icon=String(app?.icon||c.application?.icon||"");
 const image=/^[A-Za-z0-9_]{10,128}$/.test(icon)?"https://cdn.discordapp.com/app-icons/"+appId+"/"+icon+".png?size=128":null;
 return {id:c.id,version:c.version,application_id:appId,bot_name:String(app?.name||c.application?.name||"Bot "+appId).slice(0,80),bot_icon_url:image,...option(c)};
 });
 // Command names are scoped to their application. Another bot's /perfil
 // must never satisfy a Naruto Project lookup.
 const parts=args.command.slice(1).split(" ");
 const roots=commands.filter(c=>c.application_id==="1515908078913192026"&&c.name===parts[0]);
 let matched=roots.length===1?roots[0]:null;
 for(const name of parts.slice(1))matched=matched?.options?.find(o=>[1,2].includes(o.type)&&o.name===name);
 return {state:matched?"command_found":"command_not_found",mode:"personal_user_token",catalog_verified:true,
  channel_id:channelId,guild_id:GUILD,catalog_scope:"guild_registry",synced_at:Date.now(),
  channel_execution_permissions_verified:false,
  requested_command:args.command,command_found:!!matched,matched:matched||null,commands,
  executor_status:"not_connected",executed:false,sent:false,
  note:"Catálogo real consultado; nenhuma interação enviada. O executor de ações ainda não está conectado."};
}



export async function personalInspectCommand(env,args={},ctx={}){
 owner(env,ctx);
 const channelId=String(args.channel_id||"1520114348079583263"),who=String(ctx.me.id),cacheKey="discord2_catalog_cache_v7",now=Date.now();
 if(!id(channelId))throw Error("ID de canal inválido.");
 if(typeof args.command!=="string"||!/^\/[a-z0-9_-]{1,32}( [a-z0-9_-]{1,32}){0,2}$/.test(args.command))throw Error("Solicitação de comando inválida.");
 let saved=null;try{const row=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?").bind(who,cacheKey).first();if(row)saved=JSON.parse(row.value_json)}catch{}
 const persist=async d=>{try{await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(who,cacheKey,JSON.stringify(d),Date.now()).run()}catch{}};
 const hasCache=Array.isArray(saved?.commands)&&saved.commands.length>0;
 const showCache=stale=>{
  const segments=args.command.slice(1).split(" "),roots=saved.commands.filter(c=>String(c.application_id)==="1515908078913192026"&&c.name===segments[0]);
  let match=roots.length===1?roots[0]:null;for(const name of segments.slice(1))match=match?.options?.find(o=>[1,2].includes(Number(o.type))&&o.name===name);
  return {state:match?"command_found":"command_not_found",catalog_verified:true,commands:saved.commands,channel_id:channelId,guild_id:GUILD,cached:true,stale,synced_at:saved.at,requested_command:args.command,matched:match||null,command_found:!!match,channel_execution_permissions_verified:false,executor_status:"not_connected",executed:false,sent:false,note:stale?"Catálogo antigo: limite 429 ativo. Apenas visualização; não executa comandos.":"Comandos verificados anteriormente, cache de 10 minutos. Não executa comandos."};
 };
 if(Number(saved?.pauseUntil||0)>now){
  if(hasCache)return {...showCache(true),code:429,retry_after_seconds:Math.ceil((saved.pauseUntil-now)/1000)};
  return {state:"unavailable",catalog_verified:false,code:429,retry_after_seconds:Math.ceil((saved.pauseUntil-now)/1000),reason:"Discord limitou consultas (429). Aguarde a pausa antes de atualizar.",executed:false,sent:false};
 }
 if(hasCache&&now-Number(saved.at||0)<600000)return showCache(false);
 const result=await personalInspectCommandRaw(env,args,ctx);
 if(result?.code===429){
  const v=Number(result.retry_after_seconds),seconds=Number.isFinite(v)&&v>0?Math.min(900,Math.ceil(v)):30;
  await persist({...saved,pauseUntil:Date.now()+seconds*1000});
  if(hasCache)return {...showCache(true),code:429,retry_after_seconds:seconds};
 }else if(result?.catalog_verified===true&&Array.isArray(result.commands)&&result.commands.length)await persist({at:Date.now(),commands:result.commands,pauseUntil:0});
 return result;
}

export async function personalInvokeProfileProbe(env,ctx={}) {
 const uid=owner(env,ctx),channelId="1520114348079583263",appId="1515908078913192026";
 const registry=await personalInspectCommand(env,{command:"/perfil ver",channel_id:channelId},ctx);
 if(registry.catalog_verified!==true||registry.stale===true||registry.code===429)return {state:"unavailable",submitted:false,confirmed:false,
  reason:registry.reason||(registry.code===429?"Discord limitou consultas (429). Aguarde "+registry.retry_after_seconds+" segundos; nenhuma interação foi enviada.":"Discord não retornou um catálogo verificável; nenhuma interação foi enviada."),
  ...(registry.retry_after_seconds?{retry_after_seconds:registry.retry_after_seconds}:{}),
  ...(registry.code?{discord_status:registry.code}:{}),stage:"command_catalog"};
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {state:"unavailable",submitted:false,confirmed:false,reason:auth.reason||"Identidade pessoal indisponível.",stage:"identity"};
 const root=(registry.commands||[]).find(c=>String(c.application_id)===appId&&c.name==="perfil");
 const sub=root?.options?.find(o=>o.name==="ver"&&Number(o.type)===1);
 if(!root?.id||!root?.version||!sub)return {state:"unavailable",submitted:false,confirmed:false,reason:"/perfil ver não encontrado no catálogo real do Naruto Bot."};
 if((sub.options||[]).some(o=>o.required===true))return {state:"unavailable",submitted:false,confirmed:false,reason:"O comando exige parâmetros ainda não configurados; nenhuma interação enviada."};
 const stamp=Date.now(),key="bushin_profile_probe_last";
 const value=JSON.stringify({at:stamp,command:"/perfil ver",state:"attempted"});
 try {
  const lock=await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE bushin_project_state.updated_at < ?")
   .bind(uid,key,value,stamp,stamp-60000).run();
  if(Number(lock.meta?.changes||0)!==1)return {state:"cooldown",submitted:false,confirmed:false,reason:"Teste já solicitado recentemente; aguarde um minuto."};
 }catch{return {state:"unavailable",submitted:false,confirmed:false,reason:"Não consegui reservar o teste no banco de dados."}}
 const seed=new Uint32Array(1);crypto.getRandomValues(seed);
 const nonce=((BigInt(Math.max(0,stamp-1420070400000))<<22n)|BigInt(seed[0]&4194303)).toString();
 const payload={type:2,application_id:appId,guild_id:GUILD,channel_id:channelId,session_id:crypto.randomUUID().replace(/-/g,""),nonce,
  data:{id:String(root.id),version:String(root.version),name:"perfil",type:1,options:[{type:1,name:"ver"}]}};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try {
  const response=await fetch("https://discord.com/api/v9/interactions",{
   method:"POST",headers:{Authorization:auth.token,Accept:"application/json","Content-Type":"application/json",Origin:"https://discord.com"},
   body:JSON.stringify(payload),redirect:"manual",signal:controller.signal
  });
  const accepted=response.status===204||response.status===200;
  return {state:accepted?"submitted":"unavailable",submitted:accepted,confirmed:false,channel_id:channelId,
   command:"/perfil ver",discord_status:response.status,executed:false,
   reason:accepted?"Discord recebeu a solicitação de interação. Verifique a resposta do Naruto Bot; ainda não há confirmação da execução.":response.status===401?"Token pessoal recusado pelo Discord (401).":response.status===403?"Discord bloqueou a interação (403); não vou contornar.":response.status===429?"Discord aplicou limite de requisições (429); não repetir.":"Discord não aceitou a interação (HTTP "+response.status+")."};
 }catch{return {state:"unknown",submitted:null,confirmed:false,command:"/perfil ver",reason:"Resultado da interação incerto; não repetir automaticamente."}}
 finally{clearTimeout(timer)}
}
