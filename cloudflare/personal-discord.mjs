/*
 * Bushin Naruto RPG - Personal Discord session transport
 * Activated only when the owner explicitly creates DISCORD_USER_TOKEN
 * as a Cloudflare Worker secret. No token is returned, logged or stored in D1.
 * Discord does not authorize self-bots; user-token APIs may stop working.
 */
import {normalizeMessage} from "./message-normalizer.mjs";
import {observeNaruto} from "./naruto-observer.mjs";
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
   description:"Usa a Secret configurada pelo dono para ler no máximo 12 mensagens de um canal validado do Naruto Project.",
   inputSchema:{type:"object",properties:{channel_id:{type:"string",pattern:"^[0-9]{15,22}$"},limit:{type:"integer",minimum:1,maximum:12},before:{type:"string",pattern:"^[0-9]{15,22}$"}},required:["channel_id"],additionalProperties:false},annotations:readOnly},
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
async function request(token,path,method="GET",body=null){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
   const options={method,headers:{Authorization:token,Accept:"application/json"},signal:controller.signal};
   if(body!==null){options.headers["Content-Type"]="application/json";options.body=JSON.stringify(body);}
   const res=await fetch(API+path,options);
   if(res.status===401)return {state:"unavailable",reason:"Token pessoal recusado (401).",code:401};
   if(res.status===403)return {state:"unavailable",reason:"Acesso negado pelo Discord (403); nenhum contorno de bloqueio será tentado.",code:403};
   if(res.status===429)return {state:"unavailable",reason:"Limite de requisições do Discord (429); tente mais tarde.",code:429};
   if(!res.ok)return {state:"unavailable",reason:"Discord retornou HTTP "+res.status,code:res.status};
   const data=await res.json();
   return {state:"completed",data};
 }catch(e){return {state:"unavailable",reason:"Discord indisponível ou conexão expirou."};}
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
   const limit=Number.isInteger(args.limit)?Math.max(1,Math.min(12,args.limit)):8;
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
 if(typeof message!=="string"||message!==message.trim()||message.length<1||message.length>500||/[\r\n\x00]/.test(message)||/@(?:everyone|here)\b/i.test(message))
   return {state:"unavailable",reason:"Mensagem inválida (1 a 500 caracteres, sem menções globais ou quebras de linha).",sent:false};
 const key="naruto_personal_last_message";
 const record=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?").bind(ctx.me.id,key).first();
 const last=record?JSON.parse(record.value_json):null;
 const stamp=Date.now();
 if(last&&stamp-last.at<20000)return {state:"unavailable",reason:"Envio recente; aguarde 20 segundos para evitar duplicação.",sent:false};
 const result=await request(token,"/channels/"+args.channel_id+"/messages","POST",{content:message,allowed_mentions:{parse:[]}});
 if(result.state!=="completed")return {...result,sent:false};
 const mid=result.data?.id;
 if(!id(mid)||String(result.data?.author?.id||"")!==ctx.me.id)
   return {state:"unknown",sent:null,reason:"Discord não confirmou autor e ID; não repetir automaticamente."};
 await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
   .bind(ctx.me.id,key,JSON.stringify({at:stamp,id:mid}),stamp).run();
 return {state:"completed",sent:true,message_id:mid,channel_id:args.channel_id,author_id:ctx.me.id};
}

/** Read-only guild channel metadata; each message read still checks access. */
export async function personalListChannels(env,ctx={}){
 owner(env,ctx);
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {...auth,listed:false};
 const r=await request(auth.token,"/guilds/"+GUILD+"/channels");
 if(r.state!=="completed")return {...r,listed:false};
 if(!Array.isArray(r.data))return {state:"unavailable",listed:false,reason:"Resposta de canais inválida."};
 return {state:"completed",mode:"personal_user_token",listed:true,guild_id:GUILD,
  channels:r.data.slice(0,500).filter(c=>id(c.id)&&[0,4,5,15,16].includes(c.type)).map(c=>({id:c.id,name:String(c.name||"").slice(0,100),type:c.type,parent_id:c.parent_id||null,topic:String(c.topic||"").slice(0,2000),message_read_access:"not_verified"})),
  truncated:r.data.length>500,note:"Metadados retornados pelo Discord. A leitura de cada canal continua sujeita às permissões reais; não lê DMs."};
}

// Read-only index lookup matching discord.py-self 2.1.0. Never submits interactions.
export async function personalInspectCommand(env,args={},ctx={}){
 owner(env,ctx);
 if(typeof args.command!=="string"||!/^\/[a-z0-9_-]{1,32}( [a-z0-9_-]{1,32}){0,2}$/.test(args.command))throw Error("Informe o caminho do comando, sem valores de parâmetros.");
 const auth=await authorize(env,ctx);
 if(auth.state!=="completed")return {...auth,catalog_verified:false,executed:false,sent:false};
 const channel=await checkChannel(auth.token,"1520114348079583263");
 if(channel.state!=="completed")return {...channel,catalog_verified:false,executed:false,sent:false};
 const result=await request(auth.token,"/guilds/"+GUILD+"/application-command-index");
 if(result.state!=="completed")return {...result,catalog_verified:false,executed:false,sent:false};
 if(!Array.isArray(result.data?.application_commands))return {state:"unavailable",catalog_verified:false,executed:false,sent:false,reason:"Formato do catálogo não reconhecido."};
 const option=(o,depth=0)=>({name:String(o.name||"").slice(0,100),type:o.type,description:String(o.description||"").slice(0,500),required:o.required===true,
  ...(depth<2&&Array.isArray(o.options)?{options:o.options.slice(0,25).map(x=>option(x,depth+1))}:{}),
  ...(Array.isArray(o.choices)?{choices:o.choices.slice(0,25).map(c=>({name:String(c.name||"").slice(0,100),value:c.value}))}:{})});
 const commands=result.data.application_commands.filter(c=>String(c.application_id)==="1515908078913192026"&&c.type===1).slice(0,100).map(c=>({id:c.id,version:c.version,...option(c)}));
 const parts=args.command.slice(1).split(" ");let matched=commands.find(c=>c.name===parts[0]);
 for(const name of parts.slice(1))matched=matched?.options?.find(o=>[1,2].includes(o.type)&&o.name===name);
 return {state:matched?"command_found":"command_not_found",mode:"personal_user_token",catalog_verified:true,
  requested_command:args.command,command_found:!!matched,matched:matched||null,commands,
  executor_status:"not_connected",executed:false,sent:false,
  note:"Catálogo real consultado; nenhuma interação enviada. O executor de ações ainda não está conectado."};
}
