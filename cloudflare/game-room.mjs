/** Naruto Project game HUD: genuine read-only plans, explicit evidence, no autonomous Discord commands. */
const KEY="discord2_game_room_v1",SNAP="discord2_character_v1",GAME_CHANNEL="1520114348079583263";
const HEAD={"cache-control":"no-store","x-content-type-options":"nosniff"};
const ACTION_COMMANDS=new Set(["/perfil ver","/missoes minhas","/nivel","/missoes diarias","/mapa"]);
const initial=()=>({phase:"stopped",revision:0,goal_level:20,channel_id:GAME_CHANNEL,mode:"assisted",started_at:0,updated_at:0,
 proposal:null,reason:"Modo jogo desligado.",completed_verified:0,actions_executed:0});

async function load(env,owner,key){
 const r=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?").bind(owner,key).first();
 if(!r)return null;
 try{return {raw:r.value_json,data:JSON.parse(r.value_json)}}catch{return null}
}
async function updateState(env,owner,old,next){
 const now=Date.now();const value=JSON.stringify(next);
 if(old){
  const r=await env.DB.prepare("UPDATE bushin_project_state SET value_json=?,updated_at=? WHERE owner_id=? AND key=? AND value_json=?").bind(value,now,owner,KEY,old.raw).run();
  return Number(r?.meta?.changes||0)===1;
 }
 const r=await env.DB.prepare("INSERT OR IGNORE INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?)").bind(owner,KEY,value,now).run();
 return Number(r?.meta?.changes||0)===1;
}
const cleaned=(s,n)=>typeof s==="string"?s.trim().slice(0,n):"";
async function evidence(env,owner){
 const snapshot=await load(env,owner,SNAP);
 const snap=snapshot?.data?.owner_id===owner?snapshot.data:null;
 const rows=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key LIKE 'rpg-audit:%' ORDER BY updated_at DESC LIMIT 8").bind(owner).all();
 const events=(rows?.results||[]).flatMap(row=>{try{
  const e=JSON.parse(row.value_json);
  return e.type==="command_response"&&typeof e.message_id==="string"?[{
   command:cleaned(e.command,90),message_id:cleaned(e.message_id,24),at:Number(e.at||0),type:"command_response"
  }]:[];
 }catch{return []}});
 return {snapshot:snap?{stats:snap.stats||{},mission:snap.mission||null,evidence:snap.evidence||null,updated_at:snap.updated_at}:null,
   events,verified_record_count:events.length};
}
function publicState(state){
 return {...state,execution_authorized:false,autonomous_execution:false,
  execution_note:"Sem integração autorizada de execução para o Naruto Project. A IA escolhe e explica as jogadas, mas não executa comandos de terceiros.",  
  verified_actions:state.completed_verified||0, executed_actions:state.actions_executed||0};
}
export async function gameRoomRoute(req,env,ctx,{reply,baseUrl,plan}){
 const owner=String(ctx.me?.id||"");
 if(owner!==String(env.BUSHIN_OWNER_DISCORD_ID||"")||ctx.me?.membership?.member!==true)
  return reply({error:"Apenas o proprietário do personagem pode controlar este painel."},403,HEAD);
 if(req.method==="GET"){
  const [stored,ev]=await Promise.all([load(env,owner,KEY),evidence(env,owner)]);
  return reply({state:publicState(stored?.data||initial()),...ev},200,HEAD);
 }
 if(req.method!=="POST")return reply({error:"Método não permitido."},405,HEAD);
 if(req.headers.get("origin")!==baseUrl||!req.headers.get("content-type")?.startsWith("application/json"))
  return reply({error:"Origem ou formato inválido."},403,HEAD);
 let data;
 try{const raw=await req.text();if(raw.length>1100)throw Error();data=JSON.parse(raw)}catch{
  return reply({error:"Pedido inválido."},400,HEAD);
 }
 if(!["start","pause","resume","stop","plan","review"].includes(data?.action))
  return reply({error:"Ação inválida."},400,HEAD);
 const stored=await load(env,owner,KEY),state=stored?.data||initial();
 if(!Number.isInteger(data.revision)||data.revision!==state.revision)
  return reply({error:"O estado foi alterado. Atualize antes de continuar.",code:"state_conflict"},409,HEAD);
 const now=Date.now();
 let next={...state,revision:state.revision+1,updated_at:now},summary=null;
 if(data.action==="start"||data.action==="resume"){
  next={...next,phase:"ready",started_at:state.started_at||now,
   reason:"Copiloto de RPG ativo no HTML. Planeje uma jogada e confira o resultado no jogo. Sem execução automática."};
 }
 if(data.action==="stop"){
  next={...next,phase:"stopped",proposal:null,reason:"Modo Jogo encerrado pelo usuário. Nenhum comando enviado."};
 }
 if(data.action==="pause"){
  next={...next,phase:"paused",reason:"Modo Jogo pausado. Nenhum comando será solicitado."};
 }
 if(data.action==="plan"){
  if(!["ready","proposed","needs_info","reviewed"].includes(state.phase))
   return reply({error:"Inicie o Modo Jogo antes de planejar.",code:"not_started"},409,HEAD);
  if(state.proposal?.at&&now-state.proposal.at<12000)
   return reply({error:"Aguarde 12 segundos antes de solicitar outra jogada.",code:"cooldown"},429,HEAD);
  const outcome=await plan(GAME_CHANNEL);
  if(!outcome?.ok)return reply({error:outcome?.error||"Não foi possível analisar o RPG.",code:"plan_failed"},503,HEAD);
  const p=outcome.result||{};
  const action=p.next_action;
  const allowed=action?.type==="slash"&&action.catalog_verified===true&&action.channel_id===GAME_CHANNEL&&ACTION_COMMANDS.has(action.command);
  const proposal={
   at:now,command:allowed?action.command:null,channel_id:GAME_CHANNEL,
   analysis:cleaned(p.analysis,1100),next_step:cleaned(p.next_step,800),
   reason:cleaned(p.action_reason||"",400),catalog_verified:!!allowed,
   execution_state:"not_executed",verified_result:false
  };
  next={...next,phase:allowed?"proposed":"needs_info",proposal,reason:allowed?
   "A IA selecionou uma consulta validada. Abra o Discord para executá-la; o Bushin ainda não tem autorização para executá-la automaticamente.":
   "A IA preparou a orientação, mas não encontrou um comando verificável. Confira as evidências."};
  summary={planned:true,verified_command:allowed,executed:false};
 }
 if(data.action==="review"){
  if(!["proposed","needs_info","reviewed","ready"].includes(state.phase))
   return reply({error:"Inicie o Modo Jogo para conferir o resultado.",code:"not_started"},409,HEAD);
  next={...next,phase:"reviewed",reason:"Conferência atualizada. Nenhuma jogada é considerada concluída sem resposta registrada pelo Naruto Bot."};
 }
 const saved=await updateState(env,owner,stored,next);
 if(!saved)return reply({error:"Outra solicitação atualizou o Modo Jogo. Atualize a tela.",code:"state_conflict"},409,HEAD);
 const ev=await evidence(env,owner);
 const latest=ev.events.find(x=>next.proposal?.command&&x.command===next.proposal.command&&x.at>=next.proposal.at);
 // An event recorded by the trusted relay proves response capture, NOT XP increase or mission completion.
 return reply({state:publicState(next),...ev,latest_correlated_response:latest?{...latest,meaning:"Uma resposta foi registrada, mas não comprova aumento de XP ou missão concluída."}:null,...summary},200,HEAD);
}
