/** Included inside the existing Discord 2 DOM/script, not a separate client or model. */
export const AUTOPLAY_HTML=String.raw`
<section id="autoplayPanel" class="simplePlayer" aria-label="Controle do jogador">
 <div class="simplePlayerButtons">
  <button type="button" id="autoplayStart" class="primary">▶ Jogar por mim</button>
  <button type="button" id="autoplayStop">⏹ Parar</button>
 </div>
 <p id="autoplayStatus" class="hint" role="status" aria-live="polite">Conferindo o jogador…</p>
  <details class="playerEvidence" id="autoplayEvidence">
   <summary>Estado, resultados e bloqueios</summary>
  <textarea id="autoplayGoal">Jogar Naruto Project até o nível 20.</textarea>
  <button id="autoplayPause">Pausar</button><button id="autoplayResume">Continuar</button>
  <button id="autoplayReview">Conferir</button><button id="autoplayRefresh">Atualizar</button>
  <div id="autoplayStats"></div><div id="autoplayAction"></div><div id="autoplayStages"></div>
  <div id="autoplayResult"></div><div id="autoplayPersistence"></div><div id="autoplayHistory"></div>
   <details id="autoplayMissing"><summary>Conexão e requisitos</summary><p id="autoplayIntegration"></p></details>
  </details>
</section>`;
export const AUTOPLAY_JS=String.raw`
let autoplayData=null,autoplayControlBusy=false,autoplayStopBusy=false,autoplayTickBusy=false,autoplayPollingFailed=false,autoplayShownOperation=null,autoplayShownReply=null,autoplaySiteAction=null;
let autoplayChannelRefreshBusy=false,autoplayChannelRetryAt=0;
async function refreshAutoplayChannels(action){
 if(autoplayChannelRefreshBusy||Date.now()<autoplayChannelRetryAt)return;
 autoplayChannelRefreshBusy=true;
 try{
  const listed=await req("/channels");
  if(!listed.listed||!Array.isArray(listed.channels))throw Error("Canais não confirmados");
  S.channels=listed.channels;build();
  const state=autoplayData?.state;
  if(!["running","waiting","confirming"].includes(state?.phase)||state.site_action?.id!==action.id)return;
  if(!S.channels.some(c=>c.id===action.channel_id))throw Error("O novo canal ainda não está disponível");
  await select(action.channel_id);autoplaySiteAction=action.id;
 }catch(e){autoplayChannelRetryAt=Date.now()+5000;status("Não foi possível atualizar o canal: "+e.message,true);}
 finally{autoplayChannelRefreshBusy=false;}
}
function renderAutoplay(data){
 if(!data?.state||autoplayData?.state?.revision>data.state.revision)return;
 autoplayData=data;const s=data.state,labels={stopped:"Parado",blocked:"Bloqueado",running:"Agente ativo",waiting:"Aguardando",confirming:"Conferindo ação",paused:"Pausado",uncertain:"Resultado incerto — execução interrompida",failed:"Parou com erro",completed:"Meta confirmada"};
  const missing=(data.integration?.missing||[]).join("; ");
  E("autoplayStatus").textContent=data.integration?.configured===false?"Execução bloqueada: "+(missing||s.reason||"adaptador autorizado indisponível"):(s.phase==="stopped"?"Parado.":(labels[s.phase]||s.phase)+" · "+(s.reason||""));
  if(data.planner?.local)E("autoplayStatus").textContent+=" · piloto local por regras (IA sem cota)";
  if(s.phase==="blocked"||s.phase==="uncertain"||s.phase==="failed")E("autoplayEvidence").open=true;
 const snapshot=s.snapshot,stats=snapshot?.stats||{},scalar=k=>stats[k]===null||stats[k]===undefined?"não confirmado":String(stats[k]),resource=k=>stats[k]?stats[k].current+" / "+stats[k].max:"não confirmado";
 E("autoplayStats").textContent="Nível: "+scalar("level")+" · XP: "+scalar("xp")+" · Vida: "+resource("hp")+" · Chakra: "+resource("chakra")+" · Energia: "+resource("energy")+"\nMissão: "+(snapshot?.mission?.label||snapshot?.mission?.status||"não confirmada")+" · Local: "+(snapshot?.location||"não confirmado");
 E("autoplayAction").textContent=s.pending?"Ação atual: "+s.pending.action.label+" · Canal "+s.pending.action.channel_id+" · ID "+s.pending.id:"Etapa: "+(s.cycle_stage||s.phase)+" · Ações confirmadas nesta ativação: "+(s.steps||0)+" / "+s.max_steps;
 const operation=s.pending||s.last_operation,st=operation?.stages;
 const yes=v=>v===true?"sim":v===false?"não":"incerto / aguardando";
 E("autoplayStages").textContent=st?"Solicitada: "+yes(st.requested)+" · Tentativa de envio: "+yes(st.send_attempted)+" · Recebida pela integração: "+yes(st.sent)+" · Executada pelo jogo: "+yes(st.executed)+" · Resposta capturada: "+yes(st.response_captured)+" · Estado confirmado: "+yes(st.game_state_confirmed)+" · XP/nível aumentou: "+yes(st.progress_confirmed):"Nenhuma ação enviada nesta sessão do agente.";
 E("autoplayPersistence").textContent=data.note+" Uma ação já recebida pelo jogo pode terminar após Pausar ou Parar; ela será conferida pelo mesmo ID.";
  E("autoplayIntegration").textContent=data.integration?.mode==="personal_user_token"?"Conexão pessoal/self-bot · credencial: "+(data.integration.credential_configured?"configurada, identidade conferida por operação":"ausente")+" · executor: "+(data.integration.executor_online?"online":"offline")+" · planejador: "+(data.planner?.local?"regras locais (modelo indisponível)":data.integration.brain_ready?"OpenCode online":"indisponível")+". Não é uma integração oficial do jogo.":data.integration?.configured?"Adaptador configurado. Autorização e ações válidas serão verificadas com o jogo antes de cada envio.":(data.integration?.missing||[]).join("\n");
 E("autoplayMissing").open=s.phase==="blocked";
 if(document.activeElement!==E("autoplayGoal")&&!E("autoplayGoal").value)E("autoplayGoal").value=s.goal||"";
 const history=E("autoplayHistory");history.replaceChildren();
 for(const event of(s.history||[]).slice(-30).reverse()){const line=document.createElement("div");line.className="agentHistoryEntry";line.textContent=new Date(event.at).toLocaleString("pt-BR")+" · "+event.type+" · "+event.detail;history.append(line)}
 if(!history.childElementCount)history.textContent="Nenhuma ação registrada.";
 const result=E("autoplayResult");result.replaceChildren();
 if(s.last_result){const note=document.createElement("p");note.className="hint";note.textContent="Resultado confirmado da operação "+s.last_result.operation_id+" · "+new Date(s.last_result.at).toLocaleString("pt-BR");result.append(note);const m=s.last_result.response;
  if(m){const privateNote=document.createElement("div");privateNote.className="hint";privateNote.textContent=m.ephemeral?"🔒 Resposta privada da integração":"Resposta da integração";result.append(privateNote);if(m.content){const body=document.createElement("div");body.className="body";renderDiscordFormat(body,m,m.content);result.append(body)}const v2=renderComponentV2(result,m);gameEmbed(result,m);if(!v2){addMediaImages(result,m);gameControls(result,m)}}
 }
 if(s.last_result?.response&&s.last_result.operation_id!==autoplayShownOperation&&!slashProgress?.pending){showCommandResponse(s.last_result.response);paintSlashProgress("Resposta da IA jogadora","Resultado recebido do Naruto Bot.");autoplayShownOperation=s.last_result.operation_id;}
 if(s.phase==="blocked"&&/não confirmou o resultado|não há caixa própria confirmada/i.test(s.reason||"")){E("gameToolbox").hidden=true;E("autoplayStatus").textContent="Pausado · A última interação não teve resposta confirmada. Nenhum clique será repetido.";}
 if(s.last_chat_reply&&s.last_chat_reply.id!==autoplayShownReply){const sent=s.last_chat_reply;autoplayShownReply=sent.id;if(S.current===sent.channel_id&&!S.messages.some(m=>m.id===sent.id)){S.messages.push({id:sent.id,channel_id:sent.channel_id,author_id:s.owner_id,author_name:"Henrique",content:sent.text,timestamp:new Date().toISOString()});render("keep");}}
 const active=["running","waiting","confirming"].includes(s.phase);
 if(active&&s.site_action?.type==="channel"&&s.site_action.id!==autoplaySiteAction&&S.channels.some(c=>c.id===s.site_action.channel_id)){autoplaySiteAction=s.site_action.id;if(S.current!==s.site_action.channel_id)select(s.site_action.channel_id).catch(e=>status("Não foi possível abrir o canal: "+e.message,true));}
 if(active&&s.site_action?.type==="channel"&&s.site_action.id!==autoplaySiteAction&&!S.channels.some(c=>c.id===s.site_action.channel_id))refreshAutoplayChannels(s.site_action);

 E("autoplayStart").disabled=autoplayControlBusy||autoplayStopBusy||active;E("autoplayResume").disabled=autoplayControlBusy||autoplayStopBusy||active||!s.run_id;
 E("autoplayPause").disabled=autoplayControlBusy||["stopped","paused"].includes(s.phase);E("autoplayStop").disabled=autoplayStopBusy||(s.phase==="stopped"&&!autoplayControlBusy);
 E("autoplayReview").disabled=autoplayControlBusy||!s.pending;
}
async function refreshAutoplay(){
 try{const data=await req("/autoplay");renderAutoplay(data);return data;}
 catch(e){E("autoplayStatus").textContent="Não foi possível ler o agente: "+e.message;return null;}
}
async function controlAutoplay(action,goal){
 // Stop has its own lane: never wait for a start, tick, GET or model response.
 if(action==="stop"||action==="pause"){
  if(autoplayStopBusy)return null;autoplayStopBusy=true;let stopError=null;
  if(autoplayData)renderAutoplay(autoplayData);
  E("autoplayStatus").textContent="Parando novas ações…";
  try{const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action,revision:autoplayData?.state?.revision||0})});renderAutoplay(data);autoplayPollingFailed=false;return data;}
  catch(e){autoplayPollingFailed=true;stopError="Parada não confirmada: "+e.message;return null;}
  finally{autoplayStopBusy=false;if(autoplayData)renderAutoplay(autoplayData);if(stopError)E("autoplayStatus").textContent=stopError;}
 }
 if(autoplayControlBusy||autoplayStopBusy)return null;autoplayControlBusy=true;let failedNotice=null,requestedRevision=null;
 if(autoplayData)renderAutoplay(autoplayData);
 try{
  const current=await refreshAutoplay();if(!current)throw Error("Estado indisponível");
  requestedRevision=current.state.revision;
  const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action,revision:current.state.revision,...(action==="start"||action==="resume"?{goal:goal||E("autoplayGoal").value,channel_id:S.current}:{})})});
  renderAutoplay(data);autoplayPollingFailed=false;return data;
 }catch(e){const latest=await refreshAutoplay();if(!(latest?.state?.phase==="stopped"&&requestedRevision!==null&&latest.state.revision>requestedRevision))failedNotice="Pedido não concluído: "+e.message;return null;}
 finally{autoplayControlBusy=false;if(autoplayData)renderAutoplay(autoplayData);if(failedNotice)E("autoplayStatus").textContent=failedNotice;}
}
async function autoplayTick(){
 const s=autoplayData?.state;
 if(autoplayPollingFailed||autoplayTickBusy||autoplayControlBusy||autoplayStopBusy||document.visibilityState!=="visible"||!autoplayData?.integration?.configured||!["running","waiting","confirming"].includes(s?.phase)||s.next_tick_at>Date.now())return;
 autoplayTickBusy=true;
 try{const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action:"tick",revision:s.revision})});renderAutoplay(data);}
 catch(e){await refreshAutoplay();autoplayPollingFailed=true;E("autoplayStatus").textContent="Acompanhamento interrompido: "+e.message;}
 finally{autoplayTickBusy=false;}
}
for(const [id,action] of [["autoplayStart","start"],["autoplayPause","pause"],["autoplayResume","resume"],["autoplayStop","stop"],["autoplayReview","review"]])E(id).onclick=async()=>{const data=await controlAutoplay(action);if(data&&["start","resume"].includes(action))await autoplayTick();};
E("autoplayRefresh").onclick=async()=>{autoplayPollingFailed=false;await refreshAutoplay()};
setInterval(autoplayTick,1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshAutoplay()});
refreshAutoplay();
`;
export const AUTOPLAY_INTENT_JS=String.raw`
 const autoControl=/^(?:bushin[, ]*)?(?:pausa|pause|pausar)(?:\s+(?:a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"pause":
  /^(?:bushin[, ]*)?(?:para|pare|parar)(?:\s+(?:a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"stop":
  /^(?:bushin[, ]*)?(?:continua|continue|continuar|retome)(?:\s+(?:por mim|a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"resume":
  /^(?:bushin[, ]*)?(?:joga|jogue|jogar|responde|responda|entra|entre|abre|abra|mexe|mexa)\b/i.test(question)?"start":null;
 if(autoControl){
  codexChatBusy=true;E("codexSend").disabled=true;
  try{
   E("gameRoom").hidden=false;E("gameRoom").open=true;
   const result=await controlAutoplay(autoControl,autoControl==="start"?question:undefined);
   E("codexMessage").value="";
   E("codexChatNotice").textContent=result?"🍥 "+result.state.reason+(result.state.code?" ["+result.state.code+"]":""):"O pedido não pôde ser iniciado. Confira o estado do agente.";
   if(result&&["start","resume"].includes(autoControl))await autoplayTick();
   E("gameRoom").scrollIntoView({block:"nearest",behavior:"smooth"});
  }finally{codexChatBusy=false;E("codexSend").disabled=false;}
  return;
 }
`;
