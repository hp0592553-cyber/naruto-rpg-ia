/** Included inside the existing Discord 2 DOM/script, not a separate client or model. */
export const AUTOPLAY_HTML=String.raw`
<section id="autoplayPanel" class="simplePlayer" aria-label="Controle do jogador">
 <div class="simplePlayerButtons">
  <button type="button" id="autoplayStart" class="primary">▶ Jogar por mim</button>
  <button type="button" id="autoplayStop">⏹ Parar</button>
 </div>
 <p id="autoplayStatus" class="hint" role="status" aria-live="polite">Conferindo o jogador…</p>
 <p id="autoplayCooldown" class="hint" role="status" aria-live="polite"></p>
 <div id="autoplayCollectNotice" class="hint" aria-live="off" hidden></div>
  <details class="playerEvidence" id="autoplayEvidence">
   <summary>Estado, resultados e bloqueios</summary>
  <textarea id="autoplayGoal">Jogar Naruto Project até o nível 20.</textarea>
  <button type="button" id="autoplayInstruct">🎯 Enviar pedido à IA</button>
  <button id="autoplayPause">Pausar</button><button id="autoplayResume">Continuar</button>
  <button id="autoplayReview">Conferir</button><button id="autoplayChannelCheck" type="button">📍 Conferir canal</button><button id="autoplayRefresh">Atualizar</button>
   <div id="autoplayChannelStatus" class="hint" role="status" aria-live="polite">Canal ainda não verificado.</div>
  <div id="autoplayStats"></div><div id="autoplayAction"></div><div id="autoplayStages"></div>
  <div id="autoplayResult"></div><div id="autoplayPersistence"></div><div id="autoplayHistory"></div>
   <details id="autoplayLogs"><summary>🧾 Logs de erros e diagnóstico</summary>
    <p class="hint">Erros do painel e eventos do jogador, sem credenciais. Não inclui logs internos da Cloudflare.</p>
    <button type="button" id="autoplayCopyLogs">Copiar logs</button>
    <button type="button" id="autoplayClearLogs">Limpar erros deste navegador</button>
    <pre id="autoplayLogText" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:330px;overflow-y:auto;font-size:12px"></pre>
   </details>
   <details id="autoplayMissing"><summary>Conexão e requisitos</summary><p id="autoplayIntegration"></p></details>
  </details>
</section>`;
export const AUTOPLAY_JS=String.raw`
let autoplayData=null,autoplayControlBusy=false,autoplayStopBusy=false,autoplayTickBusy=false,autoplayPollingFailed=false,autoplayShownOperation=null,autoplayShownReply=null,autoplaySiteAction=null;
let autoplayChannelRefreshBusy=false,autoplayChannelRetryAt=0,autoplayTransientRetryAt=0;
const autoplayLogKey="bushin_autoplay_errors_v2";
let autoplayClientErrors=[];
try{const previous=JSON.parse(sessionStorage.getItem(autoplayLogKey)||"[]");if(Array.isArray(previous))autoplayClientErrors=previous.slice(-120)}catch{}
function autoplaySafeLog(s){
 return String(s||"").replace(/Bearer\s+\S+/gi,"Bearer [oculto]").replace(/(?:mfa\.[\w-]{30,}|[\w-]{18,}\.[\w-]{5,}\.[\w-]{18,})/g,"[credencial oculta]").replace(/(token|secret|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,"$1=[oculto]").slice(0,480);
}
function autoplayRetryMs(error){
 const s=String(error?.message||"");
 const match=s.match(/Aguarde\s+(\d+)\s+segundos/i);
 const seconds=Number(error?.retryAfter)||Number(match?.[1])||0;
 return Math.min(900000,Math.max(30000,seconds*1000));
}
function autoplayLogError(source,error){
 const item={at:Date.now(),source:String(source).slice(0,40),http:Number(error?.httpStatus)||null,code:autoplaySafeLog(error?.code||error?.errorCode||""),message:autoplaySafeLog(error?.message||error)};
 autoplayClientErrors.push(item);autoplayClientErrors=autoplayClientErrors.slice(-120);
 try{sessionStorage.setItem(autoplayLogKey,JSON.stringify(autoplayClientErrors))}catch{}
 autoplayRenderLogs();
}
function autoplayRenderLogs(){
 const el=E("autoplayLogText");if(!el)return;
 const s=autoplayData?.state||{},events=(s.history||[]).filter(x=>/error|failed|unconfirmed|blocked|not_sent|planner|rate|access/i.test(String(x.type)+" "+String(x.detail))).slice(-60);
 const rows=["Estado: "+(s.phase||"desconhecido")+" · "+autoplaySafeLog(s.code||"sem código"),
 "Motivo: "+autoplaySafeLog(s.reason||"sem mensagem"),"Modelo: "+autoplaySafeLog(autoplayData?.planner?.mode||"auto")+" · "+autoplaySafeLog(autoplayData?.planner?.error||"sem erro"),
 "Executor: "+(autoplayData?.integration?.executor_online?"online":"offline"),"Próxima consulta: "+(s.next_tick_at?new Date(s.next_tick_at).toLocaleString("pt-BR"):"não agendada"),
 "","— Erros vistos neste navegador ("+autoplayClientErrors.length+") —"];
 for(const e of autoplayClientErrors.slice().reverse())rows.push(new Date(e.at).toLocaleString("pt-BR")+" | "+e.source+" | HTTP "+(e.http||"—")+" | "+e.code+" | "+e.message);
 rows.push("","— Falhas e bloqueios registrados no servidor ("+events.length+" dos últimos 60 eventos) —");
 for(const e of events.slice().reverse())rows.push(new Date(e.at).toLocaleString("pt-BR")+" | "+autoplaySafeLog(e.type)+" | "+autoplaySafeLog(e.detail));
 el.textContent=rows.join("\n");
}
E("autoplayCopyLogs").onclick=async()=>{try{await navigator.clipboard.writeText(E("autoplayLogText").textContent);status("Logs copiados.",false)}catch(e){status("Não foi possível copiar os logs.",true)}};
E("autoplayClearLogs").onclick=()=>{autoplayClientErrors=[];try{sessionStorage.removeItem(autoplayLogKey)}catch{}autoplayRenderLogs()};
function updateAutoplayCountdown(){
 const host=E("autoplayCooldown"),s=autoplayData?.state;
 if(!host)return;
 const limited=s?.code==="discord_rate_limited"||/HTTP 429|Discord em pausa por 429|Discord em espera OAuth/i.test(String(s?.reason||""));
 if(!limited||!Number.isFinite(Number(s?.next_tick_at))||s.next_tick_at<=Date.now()){host.textContent="";return;}
 const seconds=Math.max(1,Math.ceil((s.next_tick_at-Date.now())/1000));
 host.textContent="⏳ Discord limitou consultas (429). Aguardando "+seconds+" segundos para a próxima leitura. Não repita o botão.";
 autoplayTransientRetryAt=Math.max(autoplayTransientRetryAt,Number(s.next_tick_at));
}
function updateCollectionStatus(){
 const host=E("autoplayCollectNotice"),box=autoplayData?.state?.last_result?.response;
 if(!host||!box||String(box.channel_id||"")!==String(S.current||"")||!/coleta:\s*como funciona/i.test(String(box.normalized_text||box.content||""))){if(host)host.hidden=true;return;}
 const tick=Date.parse(box.timestamp||""),age=Number.isFinite(tick)?(Date.now()-tick)/1000:Infinity;
 const activeControls=(box.controls||[]).filter(c=>c.custom_id&&!c.disabled);
 let message;
 if(activeControls.length)message="🎮 Caixa de coleta: "+activeControls.length+" controle(s) confirmado(s) pelo jogo.";
 else if(age>=0&&age<5)message="⏱ A coleta começa em aproximadamente "+Math.max(0,Math.ceil(5-age))+" s. O jogo ainda não retornou botões nesta resposta.";
 else if(age>=5&&age<13)message="⏱ Sequência de palavras em andamento (2 s por palavra, segundo o Naruto Bot). Atualizando o chat mais rápido; botões ainda não capturados.";
 else message="⚠️ A instrução da coleta foi recebida, mas a resposta privada não contém botões confirmados. Não consigo clicar nesta caixa; atualizações privadas não aparecem necessariamente no histórico do canal.";
 if(host.textContent!==message)host.textContent=message;
 host.hidden=false;
}
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
 autoplayData=data;updateCollectionStatus();autoplayRenderLogs();updateAutoplayCountdown();const s=data.state,labels={stopped:"Parado",blocked:"Bloqueado",running:"Agente ativo",waiting:"Aguardando",confirming:"Conferindo ação",paused:"Pausado",uncertain:"Resultado incerto — execução interrompida",failed:"Parou com erro",completed:"Meta confirmada"};
  const missing=(data.integration?.missing||[]).join("; ");
  E("autoplayStatus").textContent=data.integration?.configured===false?"Execução bloqueada: "+(missing||s.reason||"adaptador autorizado indisponível"):(s.phase==="stopped"?"Parado.":(labels[s.phase]||s.phase)+" · "+(s.reason||""));
  if(data.planner?.mode==="opencode-pending")E("autoplayStatus").textContent+=" · OpenCode preparando plano (nenhuma ação confirmada ainda)";
  else if(data.planner?.mode==="opencode")E("autoplayStatus").textContent+=" · IA OpenCode (plano recebido)";
  else if(data.planner?.local&&!/Discord ou executor indisponível|Discord temporarily unavailable|temporariamente indisponível/i.test(s.reason||""))E("autoplayStatus").textContent+=" · piloto local por regras (nenhum plano de IA confirmado)";
  else if(data.planner?.ai)E("autoplayStatus").textContent+=" · motor Llama no Worker (fallback da IA)";
  if(s.phase==="blocked"||s.phase==="uncertain"||s.phase==="failed"||s.code==="discord_rate_limited")E("autoplayEvidence").open=true;
 const snapshot=s.snapshot,stats=snapshot?.stats||{},scalar=k=>stats[k]===null||stats[k]===undefined?"não confirmado":String(stats[k]),resource=k=>stats[k]?stats[k].current+" / "+stats[k].max:"não confirmado";
 const channel=s.channel_check,activeName=S.channels.find(c=>c.id===s.context_channel_id)?.name||(channel?.channel_id===s.context_channel_id?channel.channel_name:null)||s.context_channel_id||'desconhecido';
 E("autoplayChannelStatus").textContent=channel?.read_verified?
  '📍 Canal verificado: '+channel.channel_name+' ('+channel.channel_id+'). '+channel.reason+' Comandos: '+(channel.command_channel_name||channel.command_channel_id||'não confirmado')+'. Mensagens lidas: '+(channel.read_messages??'?')+'.'
  :'📍 Canal selecionado: '+activeName+'. Ainda sem verificação de leitura nesta sessão. Toque em Conferir canal.';
 E("autoplayStats").textContent="Nível: "+scalar("level")+" · XP: "+scalar("xp")+" · Vida: "+resource("hp")+" · Chakra: "+resource("chakra")+" · Energia: "+resource("energy")+"\nMissão: "+(snapshot?.mission?.label||snapshot?.mission?.status||"não confirmada")+" · Local: "+(snapshot?.location||"não confirmado");
 E("autoplayAction").textContent=s.pending?"⏳ Ação anterior pendente: "+s.pending.action.label+" · Canal "+s.pending.action.channel_id+" · ID "+s.pending.id+". Use Conferir antes de começar outra.":"Etapa: "+(s.cycle_stage||s.phase)+" · Ações confirmadas nesta ativação: "+(s.steps||0)+" / "+s.max_steps;
 const operation=s.pending||s.last_operation,st=operation?.stages;
 const yes=v=>v===true?"sim":v===false?"não":"incerto / aguardando";
 E("autoplayStages").textContent=st?"Solicitada: "+yes(st.requested)+" · Tentativa de envio: "+yes(st.send_attempted)+" · Recebida pela integração: "+yes(st.sent)+" · Executada pelo jogo: "+yes(st.executed)+" · Resposta capturada: "+yes(st.response_captured)+" · Estado confirmado: "+yes(st.game_state_confirmed)+" · XP/nível aumentou: "+yes(st.progress_confirmed):"Nenhuma ação enviada nesta sessão do agente.";
 E("autoplayPersistence").textContent=data.note+" Uma ação já recebida pelo jogo pode terminar após Pausar ou Parar; ela será conferida pelo mesmo ID.";
  E("autoplayIntegration").textContent=data.integration?.mode==="personal_user_token"?"Conexão pessoal/self-bot · credencial: "+(data.integration.credential_configured?"configurada, identidade conferida por operação":"ausente")+" · executor: "+(data.integration.executor_online?"online":"offline")+" · planejador: "+(data.planner?.local?"regras locais (sem plano confirmado)":data.planner?.ai?"Llama no Worker (fallback)":data.integration.brain_ready?"OpenCode online":"indisponível")+". Não é uma integração oficial do jogo.":data.integration?.configured?"Adaptador configurado. Autorização e ações válidas serão verificadas com o jogo antes de cada envio.":(data.integration?.missing||[]).join("\n");
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
 if(false&&active&&s.site_action?.type==="channel"&&s.site_action.id!==autoplaySiteAction&&S.channels.some(c=>c.id===s.site_action.channel_id)){autoplaySiteAction=s.site_action.id;if(S.current!==s.site_action.channel_id)select(s.site_action.channel_id).catch(e=>status("Não foi possível abrir o canal: "+e.message,true));}
 if(false&&active&&s.site_action?.type==="channel"&&s.site_action.id!==autoplaySiteAction&&!S.channels.some(c=>c.id===s.site_action.channel_id))refreshAutoplayChannels(s.site_action);

 E("autoplayInstruct").disabled=autoplayControlBusy||autoplayStopBusy;
 E("autoplayStart").disabled=autoplayControlBusy||autoplayStopBusy||active;E("autoplayResume").disabled=autoplayControlBusy||autoplayStopBusy||active||!s.run_id;
 E("autoplayPause").disabled=autoplayControlBusy||["stopped","paused"].includes(s.phase);E("autoplayStop").disabled=autoplayStopBusy||(s.phase==="stopped"&&!autoplayControlBusy);
 E("autoplayReview").disabled=autoplayControlBusy||!s.pending;
 E("autoplayChannelCheck").disabled=autoplayControlBusy||autoplayStopBusy||!!s.lease?.until&&s.lease.until>Date.now()||Date.now()<autoplayTransientRetryAt;
}
async function refreshAutoplay(){
 try{const data=await req("/autoplay");renderAutoplay(data);return data;}
 catch(e){autoplayLogError("GET /autoplay",e);E("autoplayStatus").textContent="Não foi possível ler o agente: "+e.message;return null;}
}
async function controlAutoplay(action,goal){
 // Stop has its own lane: never wait for a start, tick, GET or model response.
 if(action==="stop"||action==="pause"){
  if(autoplayStopBusy)return null;autoplayStopBusy=true;let stopError=null;
  if(autoplayData)renderAutoplay(autoplayData);
  E("autoplayStatus").textContent="Parando novas ações…";
  try{const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action,revision:autoplayData?.state?.revision||0})});renderAutoplay(data);autoplayPollingFailed=false;return data;}
  catch(e){autoplayLogError(action+" /autoplay",e);autoplayPollingFailed=true;stopError="Parada não confirmada: "+e.message;return null;}
  finally{autoplayStopBusy=false;if(autoplayData)renderAutoplay(autoplayData);if(stopError)E("autoplayStatus").textContent=stopError;}
 }
 if(autoplayControlBusy||autoplayStopBusy)return null;
 if(action==="check_channel"&&autoplayData?.state?.lease?.until>Date.now()){E("autoplayStatus").textContent="Conferência aguardará a operação atual. Nenhuma mensagem repetida.";return null}
 if(["start","resume","check_channel"].includes(action)&&Date.now()<autoplayTransientRetryAt){const left=Math.ceil((autoplayTransientRetryAt-Date.now())/1000);E("autoplayStatus").textContent="Discord em espera: "+left+" segundos restantes. Nenhum comando repetido.";return null}
 autoplayControlBusy=true;let failedNotice=null,requestedRevision=null;
 if(autoplayData)renderAutoplay(autoplayData);
 try{
  let current=await refreshAutoplay();if(!current)throw Error("Estado indisponível");
  if(["start","resume"].includes(action)){
   if(!S.current)throw Error("Selecione primeiro um canal do Naruto Project.");
   // A previous operation is reconciled before selecting a new channel or action.
   if(current.state.pending){
    E("autoplayStatus").textContent="Conferindo operação anterior pelo ID, sem repetir o comando…";
    current=await req("/autoplay",{method:"POST",body:JSON.stringify({action:"review",revision:current.state.revision})});
    renderAutoplay(current);
    if(current.state.pending)throw Error("A operação anterior "+(current.state.pending.action?.label||"do RPG")+" ainda aguarda confirmação. Toque em Conferir; nenhum comando novo foi enviado.");
   }
   const checked=current.state.channel_check;
   if(checked?.read_verified!==true||checked.requested_id!==S.current||Date.now()-Number(checked.checked_at||0)>120000){
    current=await req("/autoplay",{method:"POST",body:JSON.stringify({action:"check_channel",revision:current.state.revision,channel_id:S.current})});
    renderAutoplay(current);
   }
   if(current.state.channel_check?.read_verified!==true)throw Error("Não consegui verificar o canal acessível. Nada foi enviado.");
  }
  requestedRevision=current.state.revision;
  const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action,revision:current.state.revision,...(action==="start"||action==="resume"?{goal:goal||E("autoplayGoal").value,channel_id:S.current}:action==="instruct"?{goal:goal||E("autoplayGoal").value}:action==="check_channel"?{channel_id:S.current}:{})})});
  renderAutoplay(data);autoplayPollingFailed=false;return data;
 }catch(e){autoplayLogError(action+" /autoplay",e);
  if(e.rateLimited||/429|Aguarde\s+\d+\s+segundos/i.test(String(e.message||"")))autoplayTransientRetryAt=Date.now()+autoplayRetryMs(e);
  const latest=await refreshAutoplay();if(!(latest?.state?.phase==="stopped"&&requestedRevision!==null&&latest.state.revision>requestedRevision))failedNotice="Pedido não concluído: "+e.message;E("autoplayLogs").open=true;return null;}
 finally{autoplayControlBusy=false;if(autoplayData)renderAutoplay(autoplayData);if(failedNotice)E("autoplayStatus").textContent=failedNotice;}
}
async function autoplayTick(){
 const s=autoplayData?.state;
 if(autoplayPollingFailed||autoplayTickBusy||autoplayControlBusy||autoplayStopBusy||document.visibilityState!=="visible"||Date.now()<autoplayTransientRetryAt||!autoplayData?.integration?.configured||!["running","waiting","confirming"].includes(s?.phase)||s.next_tick_at>Date.now())return;
 autoplayTickBusy=true;
 try{const data=await req("/autoplay",{method:"POST",body:JSON.stringify({action:"tick",revision:s.revision})});renderAutoplay(data);}
 catch(e){
  autoplayLogError("tick /autoplay",e);
  await refreshAutoplay();
  const temporary=e.rateLimited||e.httpStatus>=500||/temporarily unavailable|temporariamente indispon[ií]vel|timeout|HTTP 5\d\d|Discord indispon[ií]vel/i.test(String(e.message||""));
  if(temporary){
   E("autoplayLogs").open=true;
   const delay=e.rateLimited||/429|Aguarde\s+\d+\s+segundos/i.test(String(e.message||""))?autoplayRetryMs(e):15000;
   autoplayTransientRetryAt=Date.now()+delay;autoplayPollingFailed=false;
   E("autoplayStatus").textContent="Conexão temporariamente indisponível. Aguardando nova consulta, sem repetir comandos: "+e.message;
  }else{autoplayPollingFailed=true;E("autoplayStatus").textContent="Acompanhamento interrompido: "+e.message;}
 }
 finally{autoplayTickBusy=false;}
}
for(const [id,action] of [["autoplayStart","start"],["autoplayPause","pause"],["autoplayResume","resume"],["autoplayStop","stop"],["autoplayReview","review"]])E(id).onclick=async()=>{const data=await controlAutoplay(action);if(data&&["start","resume"].includes(action))await autoplayTick();};
E("autoplayInstruct").onclick=async()=>{const active=["running","waiting","confirming"].includes(autoplayData?.state?.phase);const data=await controlAutoplay(active?"instruct":"start",E("autoplayGoal").value);if(data&&active)E("autoplayEvidence").open=true;if(data&&!active)await autoplayTick()};
E("autoplayChannelCheck").onclick=async()=>{await controlAutoplay("check_channel")};
E("autoplayRefresh").onclick=async()=>{autoplayPollingFailed=false;await refreshAutoplay()};
setInterval(autoplayTick,1000);
setInterval(updateCollectionStatus,1000);
setInterval(updateAutoplayCountdown,1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshAutoplay()});
refreshAutoplay();
`;
export const AUTOPLAY_INTENT_JS=String.raw`
 const autoControl=/^(?:bushin[, ]*)?(?:pausa|pause|pausar)(?:\s+(?:a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"pause":
  /^(?:bushin[, ]*)?(?:para|pare|parar)(?:\s+(?:a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"stop":
  /^(?:bushin[, ]*)?(?:continua|continue|continuar|retome)(?:\s+(?:por mim|a ia|o agente|o jogo|o rpg))?[!. ]*$/i.test(question)?"resume":
  /^(?:bushin[, ]*)?(?:joga|jogue|jogar|responde|responda|entra|entre|abre|abra|mexe|mexa|vai|vá|use|usa|usar|ataca|atacar|faz|faça|executa|execute|consulta|consultar)\b/i.test(question)?"start":null;
 if(autoControl){
  codexChatBusy=true;E("codexSend").disabled=true;
  try{
   E("gameRoom").hidden=false;E("gameRoom").open=true;
   const effectiveAction=autoControl==="start"&&["running","waiting","confirming"].includes(autoplayData?.state?.phase)?"instruct":autoControl;
   const result=await controlAutoplay(effectiveAction,autoControl==="start"?question:undefined);
   E("codexMessage").value="";
   E("codexChatNotice").textContent=result?"🍥 "+result.state.reason+(result.state.code?" ["+result.state.code+"]":""):"O pedido não pôde ser iniciado. Confira o estado do agente.";
   if(result&&["start","resume"].includes(autoControl))await autoplayTick();
   E("gameRoom").scrollIntoView({block:"nearest",behavior:"smooth"});
  }finally{codexChatBusy=false;E("codexSend").disabled=false;}
  return;
 }
`;
