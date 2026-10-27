/** Readable patches for the existing serialized mobile panel; keep the original UI/features. */
function replaceOnce(source,from,to){
 if(!source.includes(from))throw Error('Mobile panel patch no longer matches: '+from.slice(0,80));
 return source.replace(from,to);
}
function replaceSection(source,start,end,transform){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 if(a<0||b<0)throw Error('Mobile panel section missing: '+start);
 return source.slice(0,a)+transform(source.slice(a,b))+source.slice(b);
}
export function fixMobileHtml(html){
 html=replaceOnce(html,'<div class="hint" id="status">','<div class="hint" id="status" role="status" aria-live="polite">');
 html=replaceOnce(html,'<div id="discordComposer">',String.raw`<div id="discordComposer"><div class="composerTools"><label for="messageFiles" class="fileButton">📎 Imagens</label><input id="messageFiles" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden><button id="clearMessageFiles" type="button" hidden>Limpar imagens</button><button id="sendReceipt" type="button">Conferir entrega</button></div><div id="messageFileStatus" class="hint" aria-live="polite"></div>`);
 return replaceOnce(html,'</style>',String.raw`
/* Touch targets and evidence remain usable with the Android keyboard open. */
#send,#menu,#showAi,#closeAi,.chan,.simplePlayer button{min-height:44px}
.composerTools{display:flex;gap:6px;flex-wrap:wrap}.composerTools button,.fileButton{min-height:44px;padding:10px;border-radius:8px;background:#394155;cursor:pointer}.fileButton{display:inline-flex;align-items:center}
.playerEvidence{max-height:32dvh;overflow:auto;overflow-wrap:anywhere}
.playerEvidence summary{min-height:44px;display:list-item;padding:12px 4px;cursor:pointer}
.playerEvidence button{margin:4px 4px 4px 0}
.playerEvidence [id^="autoplay"]{white-space:pre-wrap}
 /* The original CSS hid #gamePanel even when opened. */
.bushinAiChoices{margin:12px 0;padding:12px;border:1px solid #526596;border-radius:12px;background:#252d42;max-width:100%;white-space:normal!important}
.bushinAiChoices .gameAskAi{display:block;width:100%;min-height:44px;margin:0 0 8px;background:#4857bd;color:#fff;border-radius:10px;cursor:pointer}
.bushinAiChoices .gameAskAi:disabled{opacity:.7;cursor:wait}
.bushinAiChoices .aiChoicesResult{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;font-size:14px;color:#edf2ff}
.bushinAiChoices .aiChoicesResult:empty{display:none}
.bushinAiChoices strong{display:block;margin:8px 0 3px}
.bushinAiChoices ol{padding-left:20px;margin:6px 0}
.bushinAiChoices li{margin:6px 0}
.bushinAiChoices .aiChoicesCaution{display:block;margin-top:8px;color:#b5c5e5;font-size:12px}
 #gamePanel:not([hidden]){display:block!important;max-height:43dvh;overflow:auto;overscroll-behavior:contain}
 #gameToolbox:not([hidden]),#commandResponse:not([hidden]){display:block!important}
 #gamePanel .gameAction,.msg .gameAction{min-height:44px;touch-action:manipulation;cursor:pointer}
 #gamePanel select,.msg select{min-height:44px;max-width:100%;touch-action:manipulation}
@media(max-width:1200px){.inputArea{padding-bottom:max(8px,env(safe-area-inset-bottom))}#message{font-size:16px;min-width:0}.playerEvidence{max-height:28dvh}}
</style>`);
}
export function fixMobileJs(js){
 js=replaceOnce(js,'...(opt?.body?{"content-type":"application/json"}:{})','...(opt?.body&&!(opt.body instanceof FormData)?{"content-type":"application/json"}:{})');
 js=replaceOnce(js,'if(d.state==="cooldown")e.cooldown=true;throw e','e.sent=d.sent;if(d.state==="cooldown")e.cooldown=true;throw e');
 js=replaceOnce(js,'e.rateLimited=true;e.retryAfter=seconds;throw e','e.rateLimited=true;e.retryAfter=seconds;e.sent=d.sent;throw e');
 // Add a direct on-demand AI reply to an actual, confirmed chat message.
 js=replaceOnce(js,'line.append(rep);part.append(line);',String.raw`line.append(rep);
  if(!m.ephemeral&&String(m.author_id||m.author?.id||"")!=="481485837801095178"&&/^\d{15,22}$/.test(String(m.id||""))){
   const ai=document.createElement("button");ai.type="button";ai.className="replyMessageBtn";ai.textContent="✨ IA responder";
   ai.title="Gerar resposta com Llama e enviar uma vez ao tocar";
   ai.onclick=()=>sendAiReplyForMessage(m,ai);line.append(ai);
  }
  part.append(line);`);
 // Keep existing messages and expose bounded batches of older pages.
 js=replaceOnce(js,'if(S.before){const btn=document.createElement("button");btn.className="older";btn.textContent="↑ Carregar mensagens mais antigas";btn.onclick=older;root.append(btn)}',String.raw`if(S.before){const btn=document.createElement("button");btn.className="older";btn.textContent="↑ Carregar mensagens mais antigas";btn.onclick=older;root.append(btn);
  const batch=document.createElement("button");batch.className="older";batch.textContent="↑ Carregar até 500 anteriores";batch.disabled=historyBatchRunning;batch.onclick=loadHistoryBatch;root.append(batch)}`);
 // A channel switch owns a new request even if the old channel is still loading.
 js=replaceOnce(js,'S.before=null;S.seq++;let c=','S.before=null;S.seq++;S.busy=false;forumBusy=false;let c=');
 js=replaceSection(js,'async function refresh(','async function older(){',part=>{
  part=replaceOnce(part,'?limit=12','?limit=50');
  part=replaceOnce(part,'const recent=(d.messages||[]).slice().reverse();','if(d.read!==true||!Array.isArray(d.messages))throw Error(d.reason||"A API não confirmou a leitura deste canal.");\n  const recent=d.messages.slice().reverse();');
  part=replaceOnce(part,'const updates=new Map(recent.map(m=>[String(m.id),m]));',String.raw`const updates=new Map(recent.map(m=>[String(m.id),m]));
   const previous=new Map(S.messages.map(m=>[String(m.id),m]));
   const changed=recent.some(m=>{const old=previous.get(String(m.id));return !!old&&(old.edited_timestamp!==m.edited_timestamp||String(old.normalized_text||old.content||"")!==String(m.normalized_text||m.content||"")||JSON.stringify(old.components||[])!==JSON.stringify(m.components||[]));});`);
  part=replaceOnce(part,'if(newOnes.length)followIncoming();\n   render(nearBottom?"bottom":"keep");','if(newOnes.length)followIncoming();\n   if(newOnes.length||changed)render(nearBottom?"bottom":"keep");');
  part=replaceOnce(part,'autocompleteMention();','liveReadFailures=0;autocompleteMention();');
  part=replaceOnce(part,'}catch(e){if(!quiet&&!e.rateLimited)', '}catch(e){if(seq!==S.seq||channel!==S.current)return;if(!quiet&&!e.rateLimited)');
  part=replaceOnce(part,'}catch(e){if(seq!==S.seq||channel!==S.current)return;if(!quiet&&!e.rateLimited)', '}catch(e){if(seq!==S.seq||channel!==S.current)return;liveReadFailures=Math.min(5,liveReadFailures+1);if(!quiet&&!e.rateLimited)');
  return replaceOnce(part,'finally{S.busy=false}', 'finally{if(seq===S.seq&&channel===S.current)S.busy=false}');
 });
 // Increase history pages from 12 to 50; retain the cursor and prevent out-of-order channel mixing.
 js=replaceSection(js,'async function older(){','async function send(){',part=>{
  part=replaceOnce(part,'?limit=12&before=','?limit=50&before=');
  part=replaceOnce(part,'S.busy=true;const id=S.current,feed=','S.busy=true;const seq=++S.seq,id=S.current,feed=');
  part=replaceOnce(part,'if(id!==S.current)return;','if(id!==S.current||seq!==S.seq)return;\n  if(d.read!==true||!Array.isArray(d.messages))throw Error(d.reason||"Histórico não confirmado.");');
  part=replaceOnce(part,'}catch(e){status(','}catch(e){if(id!==S.current||seq!==S.seq)return;status(');
  return replaceOnce(part,'finally{S.busy=false}','finally{if(id===S.current&&seq===S.seq)S.busy=false}');
 });
 js=replaceSection(js,'async function loadForumPosts(','async function select(',part=>{
  part=replaceOnce(part,'forumBusy=true;', 'forumBusy=true;const seq=++S.seq;');
  part=replaceOnce(part,'if(id!==S.current)return;', 'if(id!==S.current||seq!==S.seq)return;');
  part=replaceOnce(part,'}catch(e){if(!quiet)', '}catch(e){if(id!==S.current||seq!==S.seq)return;if(!quiet)');
  return replaceOnce(part,'finally{forumBusy=false}', 'finally{if(id===S.current&&seq===S.seq)forumBusy=false}');
 });
 js=replaceOnce(js,'async function send(){',String.raw`let historyBatchRunning=false;
async function loadHistoryBatch(){
 if(historyBatchRunning||S.busy||!S.before||!S.current)return;
 const channel=S.current;historyBatchRunning=true;let pages=0;
 try{
  while(channel===S.current&&S.before&&pages<10){
   const previous=S.before;
   await older();
   if(channel!==S.current||S.before===previous)break;
   pages++;
   if(S.before&&pages<10)await new Promise(resolve=>setTimeout(resolve,450));
  }
  if(channel===S.current&&pages)status("Histórico: "+S.messages.length+" mensagens deste canal carregadas."+(S.before?" Toque novamente para mais antigas.":" Chegou ao início do histórico acessível."));
 }finally{historyBatchRunning=false;if(channel===S.current)render("keep");}
}
async function sendAiReplyForMessage(m,button){
 const channel=S.current,mid=String(m.id||""),editor=E("message");
 if(editor.value.trim()||mobileFiles().length){status("Limpe o rascunho e os anexos antes de pedir à IA para responder.",true);return;}
 const initial=editor.value,initialReply=replyTarget;
 button.disabled=true;status("Llama preparando resposta para a mensagem selecionada...");
 try{
  const result=await req("/ai/chat-draft",{method:"POST",body:JSON.stringify({channel_id:channel,message_id:mid,channel_name:String(S.channels.find(c=>c.id===channel)?.name||"").slice(0,80)})});
  if(S.current!==channel||editor.value!==initial||replyTarget!==initialReply){status("Canal ou rascunho mudou; não enviei nada.",true);return;}
  if(result.channel_id!==channel||result.message_id!==mid||result.state!=="completed"||typeof result.text!=="string"||!result.text.trim())throw Error("Resposta da IA não corresponde à mensagem.");
  setReplyTarget(m);editor.value=result.text.trim();
  await send();
 }catch(e){if(S.current===channel)status("IA não enviou: "+e.message,true);}
 finally{button.disabled=false;}
}
async function send(){`);
 js=replaceSection(js,'async function send(){','async function copy(){',()=>String.raw`function mobileFiles(){return Array.from(E("messageFiles").files||[]);}
function mobileFileKey(files){return JSON.stringify(files.map(f=>[f.name,f.size,f.lastModified]));}
function clearMobileFiles(){E("messageFiles").value="";E("messageFileStatus").textContent="";E("clearMessageFiles").hidden=true;}
E("clearMessageFiles").onclick=clearMobileFiles;
E("messageFiles").onchange=()=>{const files=mobileFiles();if(files.length>3||files.some(f=>f.size<1||f.size>5*1024*1024||!["image/png","image/jpeg","image/gif","image/webp"].includes(f.type))||files.reduce((n,f)=>n+f.size,0)>8*1024*1024-16384){clearMobileFiles();status("Use até 3 imagens PNG, JPEG, GIF ou WebP; até 5 MiB por arquivo e 8 MiB no total.",true);return;}E("messageFileStatus").textContent=files.map(f=>f.name).join(" · ");E("clearMessageFiles").hidden=!files.length;};
function mobileRequestId(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);}
E("sendReceipt").onclick=async()=>{const channel=S.current;let pending;try{pending=JSON.parse(sessionStorage.getItem("bushin-message:"+channel)||"null");}catch{}if(!pending){status("Nenhum envio pendente para conferir neste canal.");return;}try{const d=await req("/channels/"+channel+"/messages/receipt?request_id="+encodeURIComponent(pending.id));status(d.sent===true?"Entrega confirmada, ID: "+d.message_id:(d.reason||"Entrega ainda não confirmada. Nenhum envio foi repetido."),d.sent!==true);}catch(e){status("Não foi possível conferir o recibo: "+e.message,true);}};
async function send(){
 const editor=E("message"),draft=editor.value,t=draft.trim(),channel=S.current,originalReply=replyTarget;
 const files=mobileFiles(),fileKey=mobileFileKey(files);
 if(!t&&!files.length||!channel||S.sending)return;
 if(t.startsWith("/")){status("Selecione um comando do catálogo deste canal; comandos / não são mensagens comuns.",true);return;}
 if(isForumChannel()){status("Abra uma publicação para responder no fórum.",true);return;}
 const mentionDraft=packMentionDraft(t),replyId=originalReply?.id;
 const storageKey="bushin-message:"+channel;
 let pending;try{pending=JSON.parse(sessionStorage.getItem(storageKey)||"null");}catch{}
 if(!pending||pending.draft!==draft||pending.reply!==replyId||pending.files!==fileKey)pending={id:mobileRequestId(),draft,reply:replyId,files:fileKey};
 try{sessionStorage.setItem(storageKey,JSON.stringify(pending));}catch{status("Não foi possível guardar o ID de envio nesta sessão. Nenhuma mensagem enviada.",true);return;}
 const payload={request_id:pending.id,content:mentionDraft.content,mention_ids:mentionDraft.ids,confirmed:true,...(replyId?{reply_to:replyId}:{})};
 let outgoing=JSON.stringify(payload);if(files.length){const form=new FormData();form.set("payload_json",JSON.stringify(payload));for(const file of files)form.append("files",file,file.name);outgoing=form;}
 S.sending=true;E("send").disabled=true;
 try{
  const d=await req("/channels/"+channel+"/messages",{method:"POST",body:outgoing});
  if(d.sent!==true||!/^\d{15,22}$/.test(String(d.message_id||""))||d.channel_id&&d.channel_id!==channel)throw Error(d.reason||"Discord não confirmou a entrega; não reenvie automaticamente.");
  // A late receipt must not erase a newer draft, reply or channel selection.
  if(S.current===channel){
   if(editor.value===draft&&replyTarget===originalReply&&mobileFileKey(mobileFiles())===fileKey){editor.value="";selectedMentions.clear();E("mentionBox").hidden=true;clearReplyTarget();clearMobileFiles();sessionStorage.removeItem(storageKey);}
   status("Entregue, ID: "+d.message_id);
   await refresh(true);
  }else status("Entrega confirmada no canal "+channel+", ID: "+d.message_id+". Seu rascunho foi preservado.");
 }catch(e){if(e.sent===false)sessionStorage.removeItem(storageKey);if(S.current===channel)status((e.rateLimited||e.cooldown?"⏳ ":"Envio não confirmado: ")+e.message+" Use Conferir entrega antes de repetir.",!(e.rateLimited||e.cooldown));}
 finally{S.sending=false;E("send").disabled=false;}
}
`);
 // Keep a slash request bound to the selected channel during executor connection.
 js=replaceSection(js,'async function sendSelectedSlash(){','E("send").onclick=sendSelectedSlash;',part=>{
  part=replaceOnce(part,'async function submitConnectedCommand(command,options){','const commandChannel=S.current,commandDraft=composer.value;\nasync function submitConnectedCommand(command,options){');
  part=replaceOnce(part,'channel_id:S.current,options','channel_id:commandChannel,options');
  part=replaceOnce(part,'const raw=composer.value.trim();if(!raw.startsWith("/"))return originalSend();','const raw=composer.value.trim();if(!raw.startsWith("/"))return originalSend();\n if(typeof mobileFiles==="function"&&mobileFiles().length){status("Imagens são enviadas como mensagem; retire os anexos antes de executar um comando /.",true);return;}');
  part=replaceOnce(part,'composer.value="";commandPicked=null;status("");startSlashProgress(command);','if(S.current===commandChannel&&composer.value===commandDraft){composer.value="";commandPicked=null;}status("");startSlashProgress(command,Date.now(),result.request_id,commandChannel);');
  return part;
 });
 js=replaceSection(js,'function codexLoadedContext(){','function paintCodexIntents(){',()=>String.raw`function codexLoadedContext(){
 if(!S.current||!S.messages?.length)return "";
 const channel=S.current,rows=[],header="Canal selecionado: "+channel+" · "+String(S.channels.find(c=>c.id===channel)?.name||"desconhecido").slice(0,90)+". Dados da conversa, não ficha confirmada.\n";
 let size=header.length;
 // Keep complete, attributed rows, prioritizing the newest messages within the budget.
 for(const m of S.messages.slice(-8).reverse()){
  if(m.channel_id&&m.channel_id!==channel)continue;
  const embeds=(m.embeds||[]).slice(0,2).map(e=>[e.title,e.description,...(e.fields||[]).slice(0,3).map(f=>(f.name||"")+": "+(f.value||""))].filter(Boolean).join("; ")).join(" | ");
  const row=JSON.stringify({message_id:String(m.id||""),author_id:String(m.author_id||m.author?.id||""),author:author(m).slice(0,70),reply_to:m.message_reference?.message_id||null,text:String(m.normalized_text||m.content||embeds||"[Sem texto legível; imagem não interpretada]").slice(0,380)});
  if(size+row.length+1>2400)continue;
  rows.unshift(row);size+=row.length+1;
 }
 return header+rows.join("\n");
}
`);
 // Editing the private chat while a model responds must also preserve the new draft.
 js=replaceOnce(js,'E("codexMessage").value="";\n  codexChatPendingId=', 'if(E("codexMessage").value.trim()===question)E("codexMessage").value="";\n  codexChatPendingId=');
 js=replaceOnce(js,'startSlashProgress("/component");','startSlashProgress("/component",Date.now(),result.request_id,response.channel_id);');
 js=replaceOnce(js,'const current=await req("/ai/opencode"),live=current.response;','const current=await req("/ai/opencode"),live=current.game_response||current.response;');
  // Make the most recent confirmed bot notification clickable inside the chat,
  // while keeping historical/unverified buttons non-interactive.
  js=replaceOnce(js,'function gameControls(parent,m){',String.raw`function liveOwnResponse(m){
   if(m.own_response===true)return true;
   const d=typeof autoplayData==="undefined"?null:autoplayData?.state?.last_result;
   return String(m.author_id||"")==="1515908078913192026"&&!!d?.response&&
    String(m.id||m.message_id||"")===String(d.response.message_id||"")&&
    String(m.channel_id||"")===String(d.response.channel_id||"")&&
    Date.now()-Number(d.at||0)<600000;
  }
  function gameControls(parent,m){`);
  js=replaceOnce(js,'if(m.own_response){for(const c of m.controls||[])appendOwnGameControl(parent,m,c);return;}',
   'if(liveOwnResponse(m)){for(const c of m.controls||[])appendOwnGameControl(parent,m,c);return;}');
  js=replaceOnce(js,'if(m.own_response&&Number(c.style)!==5){appendOwnGameControl(parent,m,c);drawn++;return;}',
   'if(liveOwnResponse(m)&&Number(c.style)!==5){appendOwnGameControl(parent,m,c);drawn++;return;}');
  js=replaceOnce(js,'note.textContent=m.own_response?"Toque nas opções desta caixa para agir no jogo."',
   'note.textContent=liveOwnResponse(m)?"Toque nas opções desta caixa para agir no jogo."');
 // Add real inline AI option cards instead of a generic question that loses message IDs.
 js=replaceSection(js,'const ask=document.createElement("button");ask.className="gameAskAi";','const note=document.createElement("div");',()=> 'appendAiOptionCard(parent,m);\n ');
 js=replaceOnce(js,'if(liveOwnResponse(m)){for(const c of m.controls||[])appendOwnGameControl(parent,m,c);return;}',
   'if(liveOwnResponse(m)){for(const c of m.controls||[])appendOwnGameControl(parent,m,c);appendAiOptionCard(parent,m);return;}');
 js=replaceOnce(js,'root.append(note);host.append(root);return true;',
   'root.append(note);host.append(root);appendAiOptionCard(host,m);return true;');
 js=replaceOnce(js,'if(!controls.length)return;',
   'if(!controls.length){appendAiOptionCard(host,response);host.hidden=false;return;}');
 js=replaceOnce(js,'for(const c of controls)appendOwnGameControl(group,response,c);\n host.hidden=false;',
   'for(const c of controls)appendOwnGameControl(group,response,c);\n appendAiOptionCard(host,response);\n host.hidden=false;');


 js=replaceSection(js,'const slashProgressKey=','async function sendSelectedSlash(',part=>{
  part=replaceOnce(part,'const r=await req("/ai/opencode");','const r=await req("/ai/opencode"+(current.request_id?"?request_id="+encodeURIComponent(current.request_id):""));');
  part=replaceOnce(part,'if(r.command&&r.command!==current.command){',String.raw`if(current.request_id&&r.request_id!==current.request_id){
   stopSlashProgress();paintSlashProgress("Resultado não correlacionado","O ID da resposta não corresponde ao pedido. Nenhum reenvio foi feito.",true);return;
  }
  if(r.command&&r.command!==current.command){`);
  part=replaceOnce(part,'if(r.confirmed){',String.raw`if(!current.request_id){paintSlashProgress("Confirmação insuficiente","Este pedido antigo não tem ID de correlação. Não é possível atribuir uma resposta a ele; não reenvie automaticamente.",true);return;}
   if(r.response?.channel_id&&current.channel_id&&r.response.channel_id!==current.channel_id){paintSlashProgress("Resultado de outro canal","A resposta não pertence ao canal do pedido. Nenhum reenvio foi feito.",true);return;}
   if(r.confirmed){`);
  part=replaceOnce(part,'function startSlashProgress(command,started=Date.now()){','function startSlashProgress(command,started=Date.now(),requestId=null,channelId=null){');
  part=replaceOnce(part,'["idle","stopped","failed","unavailable"].includes(r.state)','["idle","stopped","failed","unavailable","unknown","uncertain"].includes(r.state)');
  part=replaceOnce(part,'slashProgress={command,started,pending:true};','slashProgress={command,started,pending:true,request_id:requestId||null,channel_id:channelId||null};');
  return replaceOnce(part,'startSlashProgress(saved.command,saved.started);','startSlashProgress(saved.command,saved.started,saved.request_id,saved.channel_id);');
 });
 // Poll a recent timing-sensitive game box faster, but never exceed Discord's 429 pause.
 js=replaceOnce(js,'setInterval(()=>{if(document.visibilityState==="visible")refresh(true)},30000);',String.raw`let liveReadFailures=0,lastLiveRead=Date.now();
function timedCollectionIsFresh(){
 const game=autoplayData?.state?.last_result?.response;
 const recent=S.messages.slice(-5).concat(game&&game.channel_id===S.current?[game]:[]);
 return recent.some(m=>{
  const ts=Date.parse(m.timestamp||"");if(!Number.isFinite(ts))return false;
  const age=Date.now()-ts;if(age<0||age>26000)return false;
  return /(?:coleta:\s*como funciona|minijogo|quatro palavras|sequ[eê]ncia usando os bot[oõ]es)/i.test(String(m.normalized_text||m.content||""));
 });
}
setInterval(()=>{
 if(document.visibilityState!=="visible"||!S.current||S.busy||isForumChannel()||Date.now()<discordPauseUntil)return;
 const now=Date.now(),interval=timedCollectionIsFresh()?2000:7000;
 const backoff=liveReadFailures?Math.min(60000,10000*Math.pow(2,liveReadFailures)):0;
 if(now-lastLiveRead<Math.max(interval,backoff))return;
 lastLiveRead=now;
 void refresh(true);
},1000);`);
 // Authorized adapter controls must never fall back to the personal /component executor.
 js=replaceOnce(js,'if(![2,3].includes(Number(c.type))||!c.custom_id||c.url)return;',String.raw`if(![2,3].includes(Number(c.type))||!c.custom_id||c.url)return;
 if(response.authorized_game===true){const note=document.createElement("p");note.className="hint";note.textContent=(c.label||c.placeholder||"Opção do jogo")+": execução somente pelas ações autorizadas do adaptador; este controle não usa o executor pessoal.";parent.append(note);return;}`);
 return js;
}
