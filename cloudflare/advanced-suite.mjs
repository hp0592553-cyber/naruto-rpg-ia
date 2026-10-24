/**
 * Bushin advanced tool catalogue. Each name has a concrete implementation or
 * returns an explicit, truthful unavailable state. Tools do not add OAuth scopes.
 * Every MCP call is authenticated by the upstream Discord-owner check.
 */
import {browserCall} from "./browser-bridge.mjs";
import {botReady,botCall} from "./bot-permissions.mjs";
import {repoCall} from "./repo-suite.mjs";
import {stateCall} from "./state-suite.mjs";
import {discordCall} from "./discord-suite.mjs";
import {personalCall} from "./personal-discord.mjs";

const RPG_GUILD = "1515877468299595919";
function rpgValidatedChannel(value){
  if(typeof value!=="string"||value.length>180)throw Error("Informe a URL exata do canal do Naruto Project RP.");
  let u;try{u=new URL(value)}catch{throw Error("URL do Discord invalida.")}
  if(u.origin!=="https://discord.com"||u.search||u.hash||
    !(new RegExp("^/channels/"+RPG_GUILD+"/[0-9]{15,22}$")).test(u.pathname))
    throw Error("Somente canais do servidor Naruto Project RP sao aceitos.");
  return u.origin+u.pathname;
}
function rpgOwner(env,ctx){
  const owner=ctx?.me?.id;
  if(!owner||owner!==env.BUSHIN_OWNER_DISCORD_ID)throw Error("OAuth do proprietario Bushin necessario.");
  if(!env.DB?.prepare)throw Error("Ponte visual nao configurada.");
  return owner;
}
async function rpgSendVisual(env,args={},ctx={}){
  const owner=rpgOwner(env,ctx);
  const channel_url=rpgValidatedChannel(args.channel_url);
  const message=args.text;
  if(args.confirmed!==true)throw Error("Confirme explicitamente o texto e o canal antes do envio.");
  if(typeof message!=="string"||message.length<1||message.length>500||message!==message.trim()||/[\r\n\x00]/.test(message)||/@(?:everyone|here)\b/i.test(message))
    throw Error("Mensagem invalida: use ate 500 caracteres, uma linha e sem mencoes em massa.");
  const now=Date.now();
  const session=await env.DB.prepare("SELECT run_id FROM bushin_visual_sessions WHERE owner_id=? AND expires_at>? AND last_seen>? ORDER BY created_at DESC LIMIT 1")
    .bind(owner,now,now-60000).first();
  if(!session)return {state:"unavailable",reason:"Nenhuma sessao de navegador Bushin ativa e conectada a ponte; nenhuma mensagem enviada.",sent:false};
  const busy=await env.DB.prepare("SELECT COUNT(*) AS n FROM bushin_visual_commands WHERE run_id=? AND owner_id=? AND (state IN ('queued','in_progress') OR (action IN ('send_message','send_command') AND created_at>?))")
    .bind(session.run_id,owner,now-20000).first();
  if(Number(busy?.n||0)>0)return {state:"unavailable",reason:"Existe comando pendente ou envio recente: nao enviar novamente para evitar duplicatas.",sent:false};
  const b=new Uint8Array(16);crypto.getRandomValues(b);
  const id="visual_"+Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
  const payload=JSON.stringify({channel_url,text:message,confirm:true});
  const insert=await env.DB.prepare("INSERT INTO bushin_visual_commands(id,run_id,owner_id,action,args_json,state,created_at,updated_at) SELECT ?,s.run_id,s.owner_id,'send_message',?,'queued',?,? FROM bushin_visual_sessions s WHERE s.run_id=? AND s.owner_id=? AND s.expires_at>? AND s.last_seen>? AND NOT EXISTS(SELECT 1 FROM bushin_visual_commands c WHERE c.run_id=s.run_id AND c.owner_id=s.owner_id AND (c.state IN ('queued','in_progress') OR (c.action IN ('send_message','send_command') AND c.created_at>?)))")
    .bind(id,payload,now,now,session.run_id,owner,now,now-60000,now-20000).run();
  if(Number(insert.meta?.changes||0)!==1)return {state:"unavailable",reason:"Sessao indisponivel ou fila ocupada; nenhuma mensagem enfileirada.",sent:false};
  return {state:"queued",command_id:id,channel_url,session_id:session.run_id,sent:false,note:"Enfileirado. Consulte bushin_rpg_message_result e so declare envio depois de resultado verificavel."};
}
async function rpgMessageResult(env,args={},ctx={}){
  const owner=rpgOwner(env,ctx);
  const id=args.command_id;
  if(typeof id!=="string"||!/^visual_[a-f0-9]{32}$/.test(id))throw Error("ID do envio invalido.");
  const row=await env.DB.prepare("SELECT action,state,result_json,updated_at FROM bushin_visual_commands WHERE id=? AND owner_id=?").bind(id,owner).first();
  if(!row||row.action!=="send_message")return {state:"not_found",sent:false};
  let result=null;if(row.result_json){try{result=JSON.parse(row.result_json)}catch{result="Resultado indisponivel"}}
  return {state:row.state,command_id:id,updated_at:row.updated_at,result,sent:row.state==="completed"&&result?.sent===true,note:row.state==="completed"?"Acao concluida no navegador; confirme a mensagem no canal se resultado nao comprovar entrega.":"Nao declare mensagem enviada antes de resposta final."};
}


const specs=[
 ["rpg_send_message","Enviar mensagem confirmada pelo navegador Naruto RP",["channel_url","text","confirmed"]],
 ["rpg_message_result","Verificar resultado do envio Naruto RP",["command_id"]],
 ["browser_start","Iniciar navegador temporário",["confirmed"]],
 ["browser_status","Estado da sessão visual",[]],
 ["browser_open_url","Abrir canal autorizado",["url"]],
 ["browser_screenshot","Capturar tela autorizada",[]],
 ["browser_click","Clicar em elemento seguro",["x","y"]],
 ["browser_type","Digitar em busca ou preparar mensagem",["text"]],
 ["browser_scroll","Rolar página",["direction","amount"]],
 ["browser_press_key","Pressionar tecla de navegação",["key"]],
 ["browser_read_page","Ler texto visível no canal",[]],
 ["browser_inspect_ui","Inspecionar elementos",[]],
 ["browser_tabs","Listar e alternar abas do navegador",[]],
 ["browser_upload_file","Enviar arquivo no navegador",["file_id"]],
 ["browser_download_file","Baixar arquivo do navegador",["url"]],
 ["browser_live_view","Inspecionar acesso ao visualizador",[]],
 ["browser_takeover","Assumir controle via acesso seguro",[]],
 ["discord_whoami","Identidade Discord OAuth",[]],
 ["discord_list_servers","Servidores autorizados via OAuth",[]],
 ["discord_list_channels","Canais permitidos ao bot",[]],
 ["discord_read_messages","Ler mensagens Naruto e componentes com diagnóstico do transporte",["channel_id"]],
 ["discord_send_message","Enviar mensagem confirmada no canal Naruto (transporte pessoal se configurado, senão bot autorizado)",["channel_id","content","confirmed"]],
 ["discord_create_dm","Preparar DM autorizada de bot",["recipient_id","confirmed"]],
 ["discord_send_dm","Enviar DM de bot autorizada",["recipient_id","content","confirmed"]],
 ["discord_execute_command","Orientar comando de aplicativo",["command"]],
 ["discord_get_membership","Participação no Naruto RP",[]],
 ["discord_dm_status","Status das DMs autorizadas do bot",[]],
 ["discord_upload_attachment","Enviar arquivo pelo bot",["channel_id","file_id","confirmed"]],
 ["task_start","Criar tarefa de múltiplas etapas",["title"]],
 ["task_status","Consultar tarefa",["task_id"]],
 ["task_logs","Histórico de uma tarefa",["task_id"]],
 ["task_pause","Pausar tarefa",["task_id"]],
 ["task_resume","Retomar tarefa",["task_id"]],
 ["task_cancel","Cancelar tarefa",["task_id"]],
 ["task_request_approval","Registrar solicitação de aprovação",["task_id","summary"]],
 ["session_reconnect","Verificar recuperação de sessão",[]],
 ["files_list","Listar arquivos da área privada",[]],
 ["files_read","Ler arquivo da área privada",["path"]],
 ["files_upload","Salvar arquivo texto na área privada",["path","content","confirmed"]],
 ["files_download","Baixar conteúdo de arquivo privado",["path"]],
 ["github_read_repo","Consultar projeto Bushin no GitHub",[]],
 ["github_edit_file","Editar arquivo permitido no GitHub",["path","content","confirmed"]],
 ["github_run_tests","Iniciar testes do Bushin no GitHub",["confirmed"]],
 ["bushin_save_state","Salvar progresso estruturado",["key","value","confirmed"]],
 ["bushin_load_state","Consultar progresso estruturado",["key"]],
 ["auth_status","Verificar conexão e permissões",[]],
 ["auth_connect","Obter URL segura de login",[]],
 ["auth_disconnect","Abrir instruções de desconexão",[]],
 ["permissions_check","Diagnóstico de acesso efetivo",[]],
 ["audit_log","Consultar auditoria de operações",[]],
 ["ui_screenshot_gallery","Capturas de canais autorizados",["urls"]],
 ["ui_live_panel","Estado do painel visual",[]]
];
const property={
 before:{type:"string",pattern:"^[0-9]{15,22}$",description:"Cursor next_before da página anterior; histórico anterior a este ID."},
 channel_url:{type:"string",minLength:48,maxLength:180,description:"URL completa https://discord.com/channels/1515877468299595919/ID"},
 command_id:{type:"string",pattern:"^visual_[a-f0-9]{32}$"},
 limit:{type:"integer",minimum:1,maximum:30},confirmed:{type:"boolean"},x:{type:"integer",minimum:0,maximum:1364},
 y:{type:"integer",minimum:0,maximum:767},
 amount:{type:"integer",minimum:1,maximum:8},direction:{type:"string",enum:["up","down"]},
 urls:{type:"array",items:{type:"string"},minItems:1,maxItems:4},
 value:{description:"Objeto ou texto JSON de progresso"},
 title:{type:"string",maxLength:150},summary:{type:"string",maxLength:240},
 content:{type:"string",maxLength:12000},
 ...Object.fromEntries(["url","file_id","path","text","key","task_id","channel_id","recipient_id","command"].map(k=>[k,{type:"string",maxLength:1200}]))
};
const readonly=new Set([
 "rpg_message_result",
 "browser_status","browser_screenshot","browser_read_page","browser_inspect_ui","browser_tabs",
 "browser_live_view","browser_takeover","discord_whoami","discord_list_servers",
 "discord_list_channels","discord_read_messages","discord_get_membership","discord_dm_status",
 "task_status","task_logs","session_reconnect","files_list","files_read","files_download",
 "github_read_repo","bushin_load_state","auth_status","auth_connect","auth_disconnect",
 "permissions_check","audit_log","ui_live_panel"
]);
export const ADVANCED_TOOLS=specs.filter(([name])=> !["browser_status","discord_whoami"].includes(name)).map(([name,title,keys])=>({
 name:name.startsWith("bushin_")?name:"bushin_"+name,title:"🍥 "+title,
 description:title+". Resultado mostra se há sessão e autorização reais; não confunda ferramenta registrada com acesso ativo.",
 inputSchema:{type:"object",properties:Object.fromEntries([...new Set([...keys,
 ...(["browser_tabs","github_read_repo","files_list"].includes(name)?["path"]:[]),
 ...(["browser_type"].includes(name)?["channel_url"]:[]),
 ...(["browser_tabs"].includes(name)?["tab_index"]:[]),
 ...(["task_start"].includes(name)?["description","steps"]:[]),
 ...(["task_resume"].includes(name)?["confirmed"]:[]),
 ...(["discord_read_messages","audit_log"].includes(name)?["limit"]:[]),
 ...(name==="discord_read_messages"?["before"]:[]),
 ...(["task_status","task_logs"].includes(name)?[]:[])
 ])].map(k=>[k, property[k]|| (k==="tab_index"?{type:"integer",minimum:0,maximum:20}:k==="steps"?{type:"array",maxItems:12,items:{type:"string",maxLength:120}}:{type:"string",maxLength:1200})])),
 required:keys,additionalProperties:false},
 annotations:{readOnlyHint:readonly.has(name),destructiveHint:false,openWorldHint:false}
}));
export const ADVANCED_NAMES=new Set(ADVANCED_TOOLS.map(x=>x.name));
const blocked=(name,reason)=>({state:"unavailable",tool:name,reason,implemented:false});
export async function advancedCall(env,name,args={},ctx={}){
 if(!ADVANCED_NAMES.has(name))throw Error("Ferramenta Bushin desconhecida.");
 const simple=["bushin_save_state","bushin_load_state"].includes(name)?name:name.slice(7);
 if(simple==="rpg_send_message")return rpgSendVisual(env,args,ctx);
 if(simple==="rpg_message_result")return rpgMessageResult(env,args,ctx);
 if(simple.startsWith("browser_")||["ui_screenshot_gallery","ui_live_panel","session_reconnect"].includes(simple)){
   if(simple==="browser_start")return repoCall(env,"browser_start",args,ctx);
   if(["browser_upload_file","browser_download_file"].includes(simple))
     return blocked(simple,"O navegador remoto ainda não possui transferência segura de arquivos. files_upload/files_download operam na área privada do GitHub.");
   if(simple==="browser_type"){
     if(args.channel_url)return browserCall(env,"bushin_browser_action",{action:"compose_message",channel_url:args.channel_url,text:args.text});
     return browserCall(env,"bushin_browser_action",{action:"type_search",text:args.text});
   }
   if(simple==="browser_tabs")return browserCall(env,"bushin_browser_action",{action:"tabs",...(Number.isInteger(args.tab_index)?{tab_index:args.tab_index}:{})});
   if(simple==="ui_screenshot_gallery")return browserCall(env,"bushin_browser_action",{action:"capture_gallery",urls:args.urls});
   if(["browser_live_view","browser_takeover","ui_live_panel"].includes(simple))
     return {...(await browserCall(env,"bushin_browser_status")),note:"Visualizador seguro noVNC externo, NÃO incorporado ao chat Android. O link privado para entrar é mostrado somente no GitHub Actions da sessão."};
   if(simple==="session_reconnect")return { ...(await browserCall(env,"bushin_browser_status")),reconnect_requires_auth:"Sessões encerradas não herdam cookies e não podem ser restauradas automaticamente." };
   const actions={
     browser_status:null,browser_open_url:"open_url",browser_screenshot:"screenshot",
     browser_click:"click",browser_scroll:"scroll",browser_press_key:"press",
     browser_read_page:"read_page_text",browser_inspect_ui:"inspect_ui"
   };
   if(simple==="browser_status")return browserCall(env,"bushin_browser_status");
   const action=actions[simple];
   if(!action)return blocked(simple,"Ação de navegador não implementada.");
   return browserCall(env,"bushin_browser_action",{action,...args});
 }
 if(simple==="discord_read_messages"&&typeof env.DISCORD_USER_TOKEN==="string"&&env.DISCORD_USER_TOKEN.trim().length>=35)
    return {mode:"personal_user_token",...(await personalCall(env,"bushin_naruto_personal_read",args,ctx))};
 if(simple==="discord_send_message"&&typeof env.DISCORD_USER_TOKEN==="string"&&env.DISCORD_USER_TOKEN.trim().length>=35)
    return {mode:"personal_user_token",...(await personalCall(env,"bushin_naruto_personal_send",{channel_id:args.channel_id,text:args.content,confirmed:args.confirmed},ctx))};
  if(simple.startsWith("discord_"))return discordCall(env,simple,args,ctx);
 if(simple.startsWith("task_")||simple.startsWith("bushin_")||["permissions_check","audit_log","auth_status","auth_connect","auth_disconnect"].includes(simple))
   return stateCall(env,simple,args,ctx);
 if(simple.startsWith("files_")||simple.startsWith("github_"))return repoCall(env,simple,args,ctx);
 return blocked(simple,"Não há implementação disponível.");
}
