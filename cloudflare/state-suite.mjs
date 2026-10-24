/**
 * Durable Bushin task bookkeeping and project memory (Cloudflare D1).
 * Does NOT imply an autonomous background agent is running.
 * All operations are scoped to the verified Discord owner.
 */
import {botReady} from "./bot-permissions.mjs";
import {personalIdentityCheck} from "./personal-discord.mjs";
const ts=()=>Date.now();
const safeId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
const activeStatuses=["planned","paused","awaiting_approval","cancelled"];
function user(ctx){const id=String(ctx?.me?.id||"");if(!/^\d{15,22}$/.test(id))throw Error("É necessário validar a conta Discord.");return id;}
function db(env,statement,...args){
 if(!env.DB?.prepare)throw Error("O banco seguro do Bushin não está disponível.");
 return env.DB.prepare(statement).bind(...args);
}
async function audit(env,owner,action,summary,taskId=null){
 await db(env,"INSERT INTO bushin_events (owner_id,task_id,action,summary,created_at) VALUES (?,?,?,?,?)",
   owner,taskId,action,String(summary).slice(0,200),ts()).run();
}
function limited(value,max){
 if(typeof value!=="string"||!value.trim()||value.length>max)throw Error("Texto ausente ou acima do limite.");
 return value.trim();
}
async function getTask(env,owner,taskId){
 if(!safeId(taskId))throw Error("Identificador de tarefa inválido.");
 const r=await db(env,"SELECT * FROM bushin_tasks WHERE id=? AND owner_id=?",taskId,owner).first();
 if(!r)throw Error("Tarefa não encontrada.");
 return r;
}
function taskView(r){return {
 id:r.id,title:r.title,status:r.status,description:r.description,
 steps:JSON.parse(r.steps_json),created_at:r.created_at,updated_at:r.updated_at,
 approval_summary:r.approval_summary||null,
 execution:"A fila registra planos. Um navegador/autorização ativa e comando concreto são necessários para executar etapas."
};}
function available(env){return {
 discord_identity:true,discord_membership:true,discord_user_install:"available_if_app_enabled",
 discord_messages_as_user:false,discord_official_bot:botReady(env),
 github_bridge:typeof env.BUSHIN_GITHUB_TOKEN==="string"&&env.BUSHIN_GITHUB_TOKEN.length>=20,
 browser_active:"unknown_until_status_check",native_android_mcp:false,
 files_private_workspace:"requires_github_bridge",
 rpg_state:"d1",background_agent:false
};}
export async function logToolAction(env,ctx,tool,state="completed"){
  // Only a tool identifier + fixed status are retained; never log message
  // text, OAuth data, filenames, recipients or screenshot content.
  if(typeof tool!=="string"||!/^[a-z_]{5,90}$/.test(tool))return;
  const owner=user(ctx);
  const summary=["completed","failed","unavailable","queued","requested","planned",
    "paused","cancelled","awaiting_approval","not_found","already_running",
    "action_required","requires_discord_client"].includes(state)?state:"completed";
  await audit(env,owner,tool.slice(0,85),"Estado: "+summary);
}
export async function stateCall(env,name,args={},ctx={}){
 const owner=user(ctx);
 if(name==="auth_status")return {state:"connected",user_id:owner,oauth_scopes:["identify","guilds","guilds.members.read"],
  login_type:"verified_discord_oauth",capabilities:available(env)};
 if(name==="auth_connect")return {state:"available",url:String(env.PUBLIC_BASE_URL||"").replace(/\/$/,"")+"/mobile/start",
  note:"Abra no navegador. Não envie senhas ou tokens pelo ChatGPT."};
 if(name==="auth_disconnect")return {state:"action_required",url:String(env.PUBLIC_BASE_URL||"").replace(/\/$/,"")+"/mobile",
  note:"Use o botão Desconectar no portal autenticado. Esta ferramenta não revogou a sessão."};
 if(name==="permissions_check")return {state:"completed",capabilities:available(env),
   personal_discord_session:await personalIdentityCheck(env,ctx),
   note:"Diagnóstico somente de leitura: valida identidade, canal e uma mensagem descartada; não envia mensagens. O catálogo do ChatGPT precisa ser comparado ao tools/list."};
 if(name==="audit_log"){
   const limit=Number.isInteger(args.limit)?Math.min(30,Math.max(1,args.limit)):15;
   const result=await db(env,"SELECT id,task_id,action,summary,created_at FROM bushin_events WHERE owner_id=? ORDER BY id DESC LIMIT ?",owner,limit).all();
   return {state:"completed",events:result.results||[]};
 }
 if(name==="bushin_save_state"){
   if(args.confirmed!==true)throw Error("Salvar progresso exige confirmação.");
   const key=limited(args.key,70);
   if(!safeId(key))throw Error("A chave deve conter letras, dígitos, _ ou -.");
   const json=JSON.stringify(args.value);
   if(json===undefined||json.length>6500)throw Error("Estado inválido ou muito grande.");
   await db(env,"INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
     owner,key,json,ts()).run();
   await audit(env,owner,"state_save","Estado salvo: "+key);
   return {state:"completed",saved:true,key,bytes:new TextEncoder().encode(json).length};
 }
 if(name==="bushin_load_state"){
   const key=limited(args.key,70);
   const record=await db(env,"SELECT key,value_json,updated_at FROM bushin_project_state WHERE owner_id=? AND key=?",owner,key).first();
   return record?{state:"completed",key,value:JSON.parse(record.value_json),updated_at:record.updated_at}:{state:"not_found",key};
 }
 if(name==="task_start"){
   const title=limited(args.title,150);
   const description=typeof args.description==="string"?args.description.slice(0,1000):"";
   const steps=Array.isArray(args.steps)?args.steps:[];
   if(steps.length>12||!steps.every(s=>typeof s==="string"&&s.length>0&&s.length<=120))
     throw Error("Limite de 12 etapas curtas por tarefa.");
   const id="task_"+crypto.randomUUID().replace(/-/g,"");
   const stamp=ts();
   await db(env,"INSERT INTO bushin_tasks (id,owner_id,title,description,steps_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
     id,owner,title,description,JSON.stringify(steps),"planned",stamp,stamp).run();
   await audit(env,owner,"task_start","Tarefa planejada: "+title,id);
   return {state:"planned",task_id:id,title,steps,
     note:"Tarefa gravada, não executada em segundo plano. As etapas precisam de execução por ferramentas autorizadas."};
 }
 if(name==="task_logs"){
   await getTask(env,owner,args.task_id);
   const result=await db(env,"SELECT id,action,summary,created_at FROM bushin_events WHERE owner_id=? AND task_id=? ORDER BY id DESC LIMIT 30",owner,args.task_id).all();
   return {state:"completed",task_id:args.task_id,events:result.results||[]};
 }
 if(name==="task_status")return {state:"completed",task:taskView(await getTask(env,owner,args.task_id))};
 if(["task_pause","task_resume","task_cancel","task_request_approval"].includes(name)){
   const task=await getTask(env,owner,args.task_id);
   let next,summary="";
   if(name==="task_cancel"){next="cancelled";summary="Tarefa cancelada";}
   if(name==="task_pause"){if(task.status==="cancelled")throw Error("Tarefa cancelada.");next="paused";summary="Tarefa pausada";}
   if(name==="task_resume"){
     if(task.status==="cancelled")throw Error("Tarefa cancelada não pode ser retomada.");
     if(task.status==="awaiting_approval"&&args.confirmed!==true)
       throw Error("Para retomar tarefa aguardando aprovação, forneça confirmed:true.");
     next="planned";summary="Tarefa marcada para retomada. Nenhuma ação externa executada.";
   }
   if(name==="task_request_approval"){
     if(task.status==="cancelled")throw Error("Tarefa cancelada.");
     next="awaiting_approval";summary=limited(args.summary,200);
   }
   await db(env,"UPDATE bushin_tasks SET status=?,updated_at=?,approval_summary=? WHERE id=? AND owner_id=?",
     next,ts(),next==="awaiting_approval"?summary:null,args.task_id,owner).run();
   await audit(env,owner,name,summary,args.task_id);
   return {state:next,task_id:args.task_id,note:"Atualizou somente o estado persistente. Não iniciou automação externa."};
 }
 throw Error("Ferramenta de tarefas desconhecida.");
}
