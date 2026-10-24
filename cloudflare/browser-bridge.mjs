/**
 * Bushin Browser — optional GitHub Actions visual-session bridge.
 * Discord OAuth authenticates ONLY the named Bushin owner before these MCP
 * functions are dispatched. This transport never receives Discord cookies.
 *
 * The Linux listener validates destinations/actions independently.
 * No personal-message sending, DMs, terminal, passwords, or arbitrary URLs.
 */
const REPO = "educacaomggovbr00-web/shinobi-ai-agent";
const GUILD = "1515877468299595919";
const BASE = "https://api.github.com/repos/" + REPO;
const GITHUB_HEADERS = token => ({
  authorization: "Bearer " + token,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "Bushin-Browser-Cloudflare"
});

const D1_READ_ACTIONS=new Set(["status","read_page_text","rpg_view","rpg_scout","open_url","inspect_ui","scroll","screenshot"]);
async function d1VisualSession(env){
  if(!env.DB?.prepare)return null;
  const now=Date.now();
  return env.DB.prepare("SELECT run_id,last_seen FROM bushin_visual_sessions WHERE owner_id=? AND expires_at>? AND last_seen>? ORDER BY created_at DESC LIMIT 1")
    .bind(env.BUSHIN_OWNER_DISCORD_ID,now,now-60000).first();
}
async function d1VisualStatus(env){
  if(!env.DB?.prepare)return {configured:false,connected:false,reason:"Banco D1 indisponivel."};
  const session=await d1VisualSession(env);
  return {configured:true,connected:!!session,transport:"cloudflare_d1_oidc",session:session?{id:session.run_id,last_seen:session.last_seen}:null,
    browser_login_verified:false,note:session?"Runner ativo na ponte D1; o login do Discord ainda precisa ser confirmado por leitura real.":"A ponte Cloudflare D1 esta pronta, mas nenhum runner OIDC ativo esta recebendo a fila. O workflow GitHub ainda precisa instalar o listener Cloudflare."};
}
async function d1ReadCommand(env,args){
  if(!env.DB?.prepare)return {state:"unavailable",reason:"Banco D1 indisponivel."};
  const request=validate(args.action,args);
  if(!D1_READ_ACTIONS.has(request.action))return {state:"unavailable",reason:"Acao nao habilitada no listener D1; somente leitura e navegacao segura."};
  const session=await d1VisualSession(env);
  if(!session)return {state:"unavailable",reason:"Nao ha navegador conectado ao D1 pelo listener GitHub Actions OIDC. Nenhuma leitura realizada."};
  const now=Date.now();
  const busy=await env.DB.prepare("SELECT COUNT(*) AS n FROM bushin_visual_commands WHERE run_id=? AND owner_id=? AND state IN ('queued','in_progress')")
    .bind(session.run_id,env.BUSHIN_OWNER_DISCORD_ID).first();
  if(Number(busy?.n||0)>=3)return {state:"unavailable",reason:"Fila visual cheia. Nao foi solicitada nova leitura."};
  const rand=new Uint8Array(16);crypto.getRandomValues(rand);
  const id="visual_"+Array.from(rand,x=>x.toString(16).padStart(2,"0")).join("");
  const stored=await env.DB.prepare("INSERT INTO bushin_visual_commands(id,run_id,owner_id,action,args_json,state,created_at,updated_at) SELECT ?,run_id,owner_id,?,?,'queued',?,? FROM bushin_visual_sessions WHERE run_id=? AND owner_id=? AND expires_at>? AND last_seen>?")
    .bind(id,request.action,JSON.stringify(request),now,now,session.run_id,env.BUSHIN_OWNER_DISCORD_ID,now,now-60000).run();
  if(Number(stored.meta?.changes||0)!==1)return {state:"unavailable",reason:"Sessao visual expirou antes de enfileirar."};
  return {state:"queued",command_id:id,session_id:session.run_id,action:request.action,note:"Aguardando execucao real do navegador. Consulte bushin_browser_result antes de afirmar que a ação ou captura foi concluída."};
}
async function d1ReadResult(env,args){
  if(!env.DB?.prepare)return {state:"unavailable",reason:"Banco D1 indisponivel."};
  if(!/^visual_[a-f0-9]{32}$/.test(args.command_id||"")||! /^[0-9]{8,20}$/.test(args.session_id||""))throw Error("Identificador invalido.");
  const row=await env.DB.prepare("SELECT action,state,result_json,updated_at FROM bushin_visual_commands WHERE id=? AND run_id=? AND owner_id=?")
    .bind(args.command_id,args.session_id,env.BUSHIN_OWNER_DISCORD_ID).first();
  if(!row)return {state:"not_found",command_id:args.command_id};
  let data=null;try{if(row.result_json)data=JSON.parse(row.result_json)}catch{data=null}
  return {state:row.state,action:row.action,command_id:args.command_id,...(row.state==="completed"?{data}:row.state==="failed"?{error:data}:{note:"Aguardando o runner processar o comando."}),updated_at:row.updated_at};
}

const initialized = env => typeof env.BUSHIN_GITHUB_TOKEN === "string" && env.BUSHIN_GITHUB_TOKEN.length >= 20;
async function github(env, route, init={}) {
  if (!initialized(env)) throw Error("Ponte do navegador não configurada: falta BUSHIN_GITHUB_TOKEN na Cloudflare.");
  const res = await fetch(BASE + route, {
    ...init,
    headers: {...GITHUB_HEADERS(env.BUSHIN_GITHUB_TOKEN), ...(init.body ? {"content-type":"application/json"}:{})},
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw Error("GitHub não autorizou a ponte ou a sessão não está disponível (HTTP " + res.status + ").");
  return res.json();
}
function decodeBase64(str) {
  return new TextDecoder().decode(Uint8Array.from(atob(str.replace(/\s/g,"")), c => c.charCodeAt(0)));
}
function encodeBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
async function liveRun(env) {
  const runs = await github(env, "/actions/workflows/bushin-discord-live.yml/runs?status=in_progress&per_page=10");
  const active = (runs.workflow_runs || []).find(r => r.status === "in_progress" && r.head_branch === "main");
  if (!active) return null;
  return {id: String(active.id), started_at: active.run_started_at || active.created_at};
}
const COMMAND = "/contents/browser_actions/live_command.json?ref=main";
const RESULT = "/contents/browser_actions/live_result.json?ref=main";
async function readJson(env, path) {
  const v = await github(env,path);
  return {sha:v.sha, json:JSON.parse(decodeBase64(v.content))};
}
function channelUrl(value) {
  if (typeof value!=="string" || value.length>180) throw Error("URL inválida.");
  const url=new URL(value);
  if (url.protocol!=="https:" || url.hostname!=="discord.com" || url.search || url.hash ||
      !new RegExp("^/channels/"+GUILD+"/[0-9]{15,22}$").test(url.pathname))
      throw Error("Só canais autorizados do Naruto Project RP são permitidos.");
  return url.origin+url.pathname;
}
function validate(action, args) {
  const c={action};
  if (["status","read_page_text","rpg_view","inspect_ui","screenshot"].includes(action)) return c;
  if (action==="tabs") {
    if (args.tab_index!==undefined && (!Number.isInteger(args.tab_index)||args.tab_index<0||args.tab_index>20))
      throw Error("Índice da aba inválido.");
    if (args.tab_index!==undefined)c.tab_index=args.tab_index;
    return c;
  }
  if (action==="compose_message") {
    c.channel_url=channelUrl(args.channel_url);
    if(typeof args.text!=="string"||!args.text.trim()||args.text.length>500||/[\r\n]/.test(args.text)||/@(?:everyone|here)\b/i.test(args.text))
      throw Error("Mensagem de rascunho inválida.");
    c.text=args.text;
    return c;
  }
  if (action==="capture_gallery") {
    if(!Array.isArray(args.urls)||args.urls.length<2||args.urls.length>4)
      throw Error("Galeria exige de 2 a 4 canais.");
    c.urls=args.urls.map(channelUrl);
    if(new Set(c.urls).size!==c.urls.length)throw Error("Canais duplicados.");
    return c;
  }
  if (action==="open_url") {c.url=channelUrl(args.url);return c;}
  if (action==="rpg_scout") {
    if (!Array.isArray(args.urls) || args.urls.length<1 || args.urls.length>4) throw Error("Informe de 1 a 4 canais.");
    c.urls=args.urls.map(channelUrl);
    if (new Set(c.urls).size!==c.urls.length) throw Error("Canais duplicados.");
    return c;
  }
  if (action==="scroll") {
    if (!["up","down"].includes(args.direction)) throw Error("Direção inválida.");
    if (!Number.isInteger(args.amount)||args.amount<1||args.amount>8) throw Error("Rolagem deve ser 1 a 8.");
    c.direction=args.direction;c.amount=args.amount;return c;
  }
  if (action==="click") {
    if (!Number.isInteger(args.x)||args.x<0||args.x>=1365||!Number.isInteger(args.y)||args.y<0||args.y>=768) throw Error("Clique fora da tela.");
    c.x=args.x;c.y=args.y;return c;
  }
  if (action==="press") {
    if (!["Escape","Enter","Tab","Shift+Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown","Home","End"].includes(args.key))
      throw Error("Tecla não permitida.");
    c.key=args.key;return c;
  }
  if (action==="type_search") {
    if (typeof args.text!=="string" || args.text.length<1 || args.text.length>100 || /[\r\n]/.test(args.text))
      throw Error("Texto de busca inválido.");
    c.text=args.text;return c;
  }
  throw Error("Ação não autorizada neste navegador.");
}
async function currentResult(env, id, runId) {
  const r=(await readJson(env,RESULT)).json;
  if (r.id !== id || String(r.session_id)!==runId)
    return {state:"queued",command_id:id,session_id:runId};
  return {state:r.ok?"completed":"failed",command_id:id,session_id:runId,
    action:r.action,ok:!!r.ok,...(r.ok?{data:r.data}:{error:String(r.error||"Falhou").slice(0,300)})};
}
export const BROWSER_TOOLS = [
 {name:"bushin_browser_status",title:"Status do navegador Bushin",
  description:"Verifica a ponte e a sessão visual Linux autorizada sem abrir ou alterar a conta Discord.",
  inputSchema:{type:"object",properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"bushin_browser_action",title:"Navegar no Discord com Bushin",
  description:"Comanda leitura, navegação, abas, capturas e preparação de rascunhos na sessão autorizada do Naruto RP. Nunca envia mensagens por esta ferramenta; confirme o resultado com bushin_browser_result.",
  inputSchema:{type:"object",properties:{
   action:{type:"string",enum:["status","read_page_text","rpg_view","rpg_scout","inspect_ui","open_url","scroll","click","press","type_search","screenshot","tabs","capture_gallery","compose_message"]},
   url:{type:"string"},urls:{type:"array",items:{type:"string"},minItems:1,maxItems:4},
   direction:{type:"string",enum:["up","down"]},amount:{type:"integer",minimum:1,maximum:8},
   x:{type:"integer",minimum:0,maximum:1364},y:{type:"integer",minimum:0,maximum:767},
   key:{type:"string"},text:{type:"string"},channel_url:{type:"string"},
   tab_index:{type:"integer",minimum:0,maximum:20}
  },required:["action"],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:"bushin_browser_result",title:"Resultado de ação do Bushin",
  description:"Confere o resultado real de um comando anteriormente enfileirado; não afirma sucesso sem resposta da sessão.",
  inputSchema:{type:"object",properties:{
   command_id:{type:"string",pattern:"^(bushin-[a-f0-9-]{36}|visual_[a-f0-9]{32})$"},
   session_id:{type:"string",pattern:"^[0-9]{8,20}$"}
  },required:["command_id","session_id"],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false}}
];
export async function browserCall(env,name,args={}) {
  if(name==="bushin_browser_status")return d1VisualStatus(env);
  if(name==="bushin_browser_result"&&/^visual_[a-f0-9]{32}$/.test(args.command_id||""))return d1ReadResult(env,args);
  if(name==="bushin_browser_action"&&D1_READ_ACTIONS.has(args.action))return d1ReadCommand(env,args);
  if (!initialized(env)) return {configured:false,connected:false,
    reason:"BUSHIN_GITHUB_TOKEN ainda não foi configurado na área Secrets do Worker Cloudflare. Nenhum token deve ser enviado ao chat."};
  if(name==="bushin_browser_status") {
    const active=await liveRun(env);
    return {configured:true,connected:!!active,session:active,
      note:active?"Sessão detectada; estar ativo não comprova login no Discord.":"Nenhuma sessão Linux ativa foi detectada."};
  }
  if(name==="bushin_browser_result") {
    if (!/^bushin-[a-f0-9-]{36}$/.test(args.command_id||"") || !/^[0-9]{8,20}$/.test(args.session_id||""))
      throw Error("Identificador inválido.");
    return currentResult(env,args.command_id,args.session_id);
  }
  if(name!=="bushin_browser_action") throw Error("Ferramenta inexistente.");
  const c=validate(args.action,args);
  const active=await liveRun(env);
  if(!active) return {state:"unavailable",reason:"Nenhuma sessão visual Linux ativa. Uma sessão precisa ser iniciada e autenticada manualmente."};
  const id="bushin-"+crypto.randomUUID();
  const old=await readJson(env,COMMAND);
  await github(env,"/contents/browser_actions/live_command.json",{
    method:"PUT",
    body:JSON.stringify({message:"Bushin visual: "+c.action+" "+id,sha:old.sha,branch:"main",
      content:encodeBase64(JSON.stringify({id,session_id:active.id,...c})+"\n")})
  });
  for(let i=0;i<4;i++){
    await new Promise(resolve=>setTimeout(resolve,750));
    const state=await currentResult(env,id,active.id);
    if(state.state!=="queued") return state;
  }
  return {state:"queued",command_id:id,session_id:active.id,
    note:"Comando enviado, mas não confirmado. Use bushin_browser_result antes de declarar sucesso."};
}
