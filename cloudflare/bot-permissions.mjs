/**
 * Optional official Discord BOT access for Bushin Browser.
 * A bot is distinct from the owner's personal Discord account.
 * Never use an end-user token, browser cookies, self-bot or unofficial API.
 *
 * Setup requires a Discord server administrator to install the bot with
 * VIEW_CHANNEL, READ_MESSAGE_HISTORY, SEND_MESSAGES on approved channels.
 * Cloudflare secrets: DISCORD_BOT_TOKEN, BUSHIN_BOT_GUILD_ID,
 * BUSHIN_BOT_CHANNEL_IDS (comma-separated explicit allowlist).
 * No permissions are conferred merely by deploying this module.
 */
import {normalizeMessage} from "./message-normalizer.mjs";
const DISCORD_API = "https://discord.com/api/v10";
const snowflake = s => typeof s === "string" && /^\d{15,22}$/.test(s);
const channels = env => String(env.BUSHIN_BOT_CHANNEL_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
export function botReady(env) {
  const ids = channels(env);
  return typeof env.DISCORD_BOT_TOKEN === "string" && env.DISCORD_BOT_TOKEN.length > 30 &&
    snowflake(env.BUSHIN_BOT_GUILD_ID) && ids.length > 0 &&
    ids.length <= 20 && ids.every(snowflake) && new Set(ids).size === ids.length;
}
export const BOT_TOOLS = [
  { name: "bushin_bot_read_channel", title: "Ler canal pelo bot oficial",
    description: "Lê até 20 mensagens num canal explicitamente permitido, usando um bot instalado e autorizado no servidor. Nunca lê DMs ou age como conta pessoal.",
    inputSchema: {type:"object",properties:{
      channel_id:{type:"string",description:"ID de um canal permitido"},
      limit:{type:"integer",minimum:1,maximum:20,default:10}
    },required:["channel_id"],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  { name: "bushin_bot_send_message", title: "Enviar mensagem como bot",
    description: "Publica UMA mensagem como o bot oficial, nunca como o usuário. Exige confirmação explícita; canal precisa estar na allowlist e pertencer ao servidor autorizado.",
    inputSchema: {type:"object",properties:{
      channel_id:{type:"string",description:"ID de um canal permitido"},
      content:{type:"string",minLength:1,maxLength:1500},
      confirmed:{type:"boolean",description:"True somente depois de o usuário aprovar a mensagem e o canal."}
    },required:["channel_id","content","confirmed"],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}}
];
async function discordBotRequest(env,path,method="GET",body=null){
  const resp=await fetch(DISCORD_API+path,{
    method,
    headers:{authorization:"Bot "+env.DISCORD_BOT_TOKEN,accept:"application/json",
      ...(body?{"content-type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(10000)
  });
  // Avoid echoing Discord response headers or sensitive upstream data.
  if(resp.status===401)throw new Error("Token do bot inválido ou revogado.");
  if(resp.status===403)throw new Error("Bot sem autorização neste canal ou servidor.");
  if(resp.status===404)throw new Error("Canal não encontrado para este bot.");
  if(resp.status===429)throw new Error("Limite de requisições do Discord. Tente depois.");
  if(!resp.ok)throw new Error("Discord recusou a operação do bot (HTTP "+resp.status+").");
  return resp.json();
}
async function approvedChannel(env,id){
  if(!snowflake(id)||!channels(env).includes(id))throw new Error("Canal não autorizado na lista do Bushin.");
  const info=await discordBotRequest(env,"/channels/"+id);
  if(info.guild_id!==env.BUSHIN_BOT_GUILD_ID)
    throw new Error("Este canal não pertence ao servidor autorizado.");
  if(![0,5,15].includes(info.type))
    throw new Error("Tipo de canal não aceito para mensagens do Bushin.");
}
export async function botCall(env,name,args={}){
  if(!botReady(env))throw new Error("Bot ainda não configurado. Instale-o num servidor autorizado e configure os segredos e a lista de canais na Cloudflare.");
  const id=args.channel_id;
  await approvedChannel(env,id);
  if(name==="bushin_bot_read_channel"){
    const limit=args.limit===undefined?10:args.limit;
    if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error("Limite inválido.");
    const msgs=await discordBotRequest(env,"/channels/"+id+"/messages?limit="+limit);
    if(!Array.isArray(msgs))throw new Error("Resposta inválida do Discord.");
    return {mode:"official_bot",guild_id:env.BUSHIN_BOT_GUILD_ID,channel_id:id,
      messages:msgs.map(m=>({...normalizeMessage(m,{channelId:id}),
        author:m.author?.username||"desconhecido",bot:!!m.author?.bot}))};
  }
  if(name==="bushin_bot_send_message"){
    const content=args.content;
    if(args.confirmed!==true)throw new Error("Confirme primeiro com o usuário a mensagem e o canal.");
    if(typeof content!=="string"||!content.trim()||content.length>1500)
      throw new Error("Mensagem vazia ou muito longa.");
    const msg=await discordBotRequest(env,"/channels/"+id+"/messages","POST",
      {content,allowed_mentions:{parse:[]}});
    return {sent:true,mode:"official_bot",guild_id:env.BUSHIN_BOT_GUILD_ID,
      channel_id:id,message_id:msg.id||null,author:"bot"};
  }
  throw new Error("Ferramenta de bot desconhecida.");
}
