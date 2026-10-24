/**
 * Discord features use official OAuth2 identity and optional official Bot API.
 * OAuth2 identify/guilds does not grant message read/write or DMs as user.
 */
import {botReady,botCall} from "./bot-permissions.mjs";
const API="https://discord.com/api/v10";
const GUILD="1515877468299595919";
const id=s=>typeof s==="string"&&/^\d{15,22}$/.test(s);
const blocked=(feature,why)=>({state:"unavailable",tool:feature,reason:why,implemented:false});
async function get(api,path,token){
 const res=await fetch(API+path,{headers:{authorization:api+" "+token,accept:"application/json"},signal:AbortSignal.timeout(10000)});
 if(res.status===403||res.status===401)throw Error("Discord recusou autorização para esta operação.");
 if(!res.ok)throw Error("Discord não forneceu estes dados (HTTP "+res.status+").");
 return res.json();
}
export function officialBotDmReady(env){
 return typeof env.DISCORD_BOT_TOKEN==="string"&&env.DISCORD_BOT_TOKEN.length>30;
}
// Read-only validation for the bot used by the Android test-DM panel.
// Never returns credentials, HTTP headers, or the raw Discord response.
export async function officialBotIdentity(env){
 if(!officialBotDmReady(env))return {configured:false,verified:false};
 const response=await fetch(API+"/users/@me",{
   headers:{authorization:"Bot "+env.DISCORD_BOT_TOKEN,accept:"application/json"},
   signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)return {configured:true,verified:false,reason:response.status===401?"Bot Token inválido ou revogado.":"Não foi possível confirmar o bot na API do Discord."};
 const profile=await response.json();
 if(profile?.bot!==true||!id(profile.id))
   return {configured:true,verified:false,reason:"O Discord não confirmou uma identidade de bot."};
 return {configured:true,verified:true,id:profile.id,username:String(profile.username||"Bushin").slice(0,80)};
}
function allowed(env,recipient,owner){
 if(!officialBotDmReady(env)||!id(recipient))return false;
 // A DM to the current verified OAuth owner is explicitly eligible without
 // requiring the bot's unrelated guild channel configuration.
 if(recipient===owner)return true;
 const list=String(env.BUSHIN_BOT_DM_USER_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
 return list.length>0&&list.length<=10&&list.every(id)&&list.includes(recipient);
}
async function dmRequest(env,recipient,content=null){
 const open=await fetch(API+"/users/@me/channels",{
   method:"POST",headers:{authorization:"Bot "+env.DISCORD_BOT_TOKEN,"content-type":"application/json"},
   body:JSON.stringify({recipient_id:recipient}),signal:AbortSignal.timeout(10000)
 });
 if(!open.ok)throw Error("O bot não conseguiu iniciar a conversa autorizada.");
 const channel=await open.json();
 if(!id(channel.id)||channel.type!==1)throw Error("Discord não retornou um canal de DM de bot.");
 if(content===null)return {state:"completed",channel_id:channel.id,recipient_id:recipient,mode:"official_bot_dm"};
 const sent=await fetch(API+"/channels/"+channel.id+"/messages",{
   method:"POST",headers:{authorization:"Bot "+env.DISCORD_BOT_TOKEN,"content-type":"application/json"},
   body:JSON.stringify({content,allowed_mentions:{parse:[]}}),
   signal:AbortSignal.timeout(10000)
 });
 if(!sent.ok)throw Error("O Discord não aceitou a DM do bot.");
 const body=await sent.json();
 return {state:"completed",sent:true,mode:"official_bot_dm",message_id:body.id||null,recipient_id:recipient};
}
export async function discordCall(env,name,args={},ctx={}){
 const me=ctx?.me;
 if(!id(me?.id))throw Error("Identidade Discord não autenticada.");
 if(name==="discord_whoami")return {state:"completed",id:me.id,username:me.username,display_name:me.display_name||null};
 if(name==="discord_get_membership")return {state:"completed",guild_id:GUILD,username:me.username,...me.membership};
 if(name==="discord_list_servers"){
   if(typeof ctx?.creds?.access!=="string")return blocked(name,"Token OAuth de usuário não disponível neste cliente.");
   const guilds=await get("Bearer","/users/@me/guilds",ctx.creds.access);
   if(!Array.isArray(guilds))throw Error("Resposta de guilds inválida.");
   return {state:"completed",servers:guilds.slice(0,50).map(g=>({id:g.id,name:String(g.name||"").slice(0,110),owner:!!g.owner})),truncated:guilds.length>50};
 }
 if(name==="discord_list_channels"){
   if(!botReady(env))return blocked(name,"É necessário instalar um bot oficial num servidor autorizado e configurar canais permitidos.");
   const ids=String(env.BUSHIN_BOT_CHANNEL_IDS).split(",").map(x=>x.trim());
   const matches=[];
   for(const channelId of ids.slice(0,20)){
     const c=await get("Bot","/channels/"+channelId,env.DISCORD_BOT_TOKEN);
     if(c.guild_id===env.BUSHIN_BOT_GUILD_ID)
       matches.push({id:c.id,name:String(c.name||"").slice(0,110),guild_id:c.guild_id});
   }
   return {state:"completed",mode:"official_bot",channels:matches};
 }
 if(name==="discord_read_messages"){
   if(!botReady(env))return blocked(name,"Leitura depende de bot oficial autorizado no canal. OAuth de usuário não dá acesso ao histórico.");
   return {state:"completed",...(await botCall(env,"bushin_bot_read_channel",{channel_id:args.channel_id,limit:Math.min(20,Math.max(1,args.limit||10))}))};
 }
 if(name==="discord_send_message"){
   if(!botReady(env))return blocked(name,"Envio via API requer bot oficialmente autorizado no canal. Não é envio pela sua conta pessoal.");
   return {state:"completed",...(await botCall(env,"bushin_bot_send_message",{channel_id:args.channel_id,content:args.content,confirmed:args.confirmed}))};
 }
 if(name==="discord_dm_status")return {
   state:"completed",bot_token_configured:officialBotDmReady(env),
   recipient_policy:"o proprietário verificado é permitido; outras pessoas exigem lista explícita",
   requires_guild_admin:false,
   delivery_guaranteed:false,
   note:"O Discord pode bloquear DMs de bots mesmo com token válido. Nenhuma mensagem é enviada por esta consulta."
 };
 if(name==="discord_create_dm"||name==="discord_send_dm"){
   if(!allowed(env,args.recipient_id,me.id))return blocked(name,
     officialBotDmReady(env)?"Destinatário não autorizado: use sua conta verificada ou inclua o ID na lista do bot.":"Falta DISCORD_BOT_TOKEN no Worker. Envio de DM como bot não depende da lista de canais da guild.");
   if(args.confirmed!==true)throw Error("Confirme o destinatário antes de criar ou enviar DM.");
   if(name==="discord_create_dm")return dmRequest(env,args.recipient_id);
   if(typeof args.content!=="string"||!args.content.trim()||args.content.length>900)throw Error("DM deve ter entre 1 e 900 caracteres.");
   return dmRequest(env,args.recipient_id,args.content);
 }
 if(name==="discord_execute_command"){
   const cmd=String(args.command||"");
   if(!/^\/[a-z0-9_-]{1,32}( [a-z0-9 _-]{1,100})?$/i.test(cmd))
     throw Error("Comando slash inválido.");
   return {state:"requires_discord_client",command:cmd,executed:false,sent:false,
     guild_id:GUILD,channel_id:"1520114348079583263",
     command_discovery:{source:"caller_input",registered_command_verified:false},
     execution_mode:"human_in_discord_client",
     next_step:"Selecione o comando no cliente oficial do Discord; enviar o texto como mensagem não executa uma interação slash.",
     reason:"applications.commands permite usar comandos registrados no cliente do Discord; não é uma permissão para executá-los pela API REST como seu usuário."};
 }
 if(name==="discord_upload_attachment")
   return blocked(name,"Envio de anexos precisa de um bot autorizado e uma ponte de arquivos com upload autenticado; ainda não está integrada.");
 throw Error("Ferramenta de Discord desconhecida.");
}
