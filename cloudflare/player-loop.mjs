/** Owner-started player session using the verified command service. */
import {changeAutoplay,readAutoplay,recordAutoplay} from './autoplay-store.mjs';
import {commandServiceHealth,commandServiceMobile,startCommandSession} from './command-service.mjs';
import {personalInspectCommand,personalListChannels,personalCall} from './personal-discord.mjs';
import {chatContext,replyTarget,replyText} from './player-context.mjs';
import {learnStep} from './player-learning.mjs';
import {responseSnapshot} from './rpg-agent.mjs';
const CHANNEL='1520114348079583263',MODEL='@cf/meta/llama-3.1-8b-instruct-fp8';
const kinds=/^\/(perfil ver|nivel|mapa|missoes (minhas|ativas|diarias)|viajar|acao coletar|interagir npc)$/;
// Catalog traversal uses a slash joined directly to the root.
export function playerCommands(catalog){const walk=(n,p)=>{const path=p?n.name?p+' '+n.name:p:'/'+n.name;const sub=(n.options||[]).filter(x=>[1,2].includes(x.type));return sub.length?sub.flatMap(x=>walk(x,path)):kinds.test(path)?[{command:path,description:n.description||'',options:n.options||[]}]:[]};return (catalog||[]).filter(x=>String(x.application_id)==='1515908078913192026').flatMap(x=>walk(x,''))}
export function forestControl(controls){const key=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();for(const c of controls||[]){if(c.disabled||c.url)continue;if(c.type===2&&key(c.label).includes('floresta'))return {control:c,values:[]};if(c.type===3){const option=c.options?.find(o=>key(o.label).includes('floresta'));if(option)return {control:c,values:[option.value]};}}return null;}
export function ownComponentOptions(options,last){const result={...options};const controls=(last?.controls||[]).filter(c=>!c.disabled&&!c.url&&[2,3].includes(c.type));if(!result.custom_id&&controls.length===1)result.custom_id=controls[0].custom_id;const target=controls.find(c=>c.custom_id===result.custom_id);if(!target)throw Error('A IA não escolheu uma opção da última caixa.');if(result.message_id&&result.message_id!==last.message_id)throw Error('Caixa desatualizada.');result.message_id=last.message_id;if(!Object.hasOwn(result,'values')&&target.type===2)result.values='[]';return result;}
export function travelArrival(text){if(!/Viagem iniciada|Chegada automática/i.test(text||''))return null;const stamp=String(text).match(/<t:(\d{10}):[FRf]> /)||String(text).match(/<t:(\d{10}):[FRf]>/);return stamp?Number(stamp[1])*1000:null;}
export async function playerRoute(req,env,ctx,{reply,baseUrl,seal,unseal,readChat=personalCall,sendChat=personalCall,listChannels=personalListChannels,learn=learnStep}){
 const owner=String(ctx.me?.id||'');const HEAD={'cache-control':'no-store'};
 if(owner!==String(env.BUSHIN_OWNER_DISCORD_ID)||ctx.me?.membership?.member!==true)return reply({error:'Conta não autorizada'},403,HEAD);
 const view=state=>({state,integration:{configured:true,missing:[]},note:'Ativo enquanto esta página estiver aberta e o executor estiver conectado.'});
 if(req.method==='GET')return reply(view((await readAutoplay(env,owner)).state),200,HEAD);
 if(req.method!=='POST'||req.headers.get('origin')!==baseUrl||!req.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Origem inválida'},403,HEAD);
 let data;try{const text=await req.text();if(text.length>1500)throw Error();data=JSON.parse(text)}catch{return reply({error:'Pedido inválido'},400,HEAD)}
 const saved=await readAutoplay(env,owner);if(data.revision!==saved.state.revision&&!['stop','pause'].includes(data.action))return reply({error:'Estado mudou. Atualize antes de continuar.'},409,HEAD);
 const action=data.action;if(!['start','stop','tick','pause','resume','review'].includes(action))return reply({error:'Ação inválida'},400,HEAD);
 const update=fn=>changeAutoplay(env,owner,fn);
 const request=(path,body)=>new Request(baseUrl+'/mobile/discord2/api/ai/'+path,{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(body)});
 const service=async body=>{const r=await commandServiceMobile(request('opencode',body),env,ctx,{unseal,baseUrl});const v=await r.json();if(!r.ok)throw Error(v.error||'Executor indisponível');return v};
 const lookup=async id=>(await commandServiceMobile(new Request(baseUrl+'/mobile/discord2/api/ai/opencode'+(id?'?request_id='+encodeURIComponent(id):'')),env,ctx,{unseal,baseUrl})).json();
 if(action==='stop'||action==='pause'){
  const next=await update(d=>{d.phase='stopped';d.code=null;d.reason='Parado. Uma ação já recebida pelo jogo pode terminar.';d.run_id=null;d.lease=null;return d});
  try{await service({action:'stop'})}catch{}
  return reply(view(next.state),200,HEAD);
 }
 if(action==='start'||action==='resume'){
  if(['running','waiting','confirming'].includes(saved.state.phase)&&saved.state.run_id)return reply(view(saved.state),200,HEAD);
  if(data.channel_id!==undefined&&!/^[0-9]{15,22}$/.test(data.channel_id))return reply({error:'Canal inválido'},400,HEAD);
  let startRevision=saved.state.revision;
  if(saved.state.pending){
   const p=saved.state.pending,old=await lookup(p.id);
   if(old.request_id!==p.id||!['finished','stopped','uncertain','unknown'].includes(old.state))return reply({error:'Ainda há uma ação pendente. Nenhum reenvio foi feito.'},409,HEAD);
   const reconciled=await update(d=>{if(d.pending?.id!==p.id||d.revision!==saved.state.revision)return null;d.pending=null;d.refresh_observation=!old.confirmed;if(old.state!=='stopped')d.completed_keys.push(p.action.command);d.player_observations=(d.player_observations||[]).concat([{command:p.action.command,channel_id:p.action.channel_id||CHANNEL,text:old.confirmed?(old.response?.normalized_text||'Resposta recebida'):'Resultado incerto. Não repetir esta ação.'}]).slice(-30);if(!old.confirmed&&old.state!=='stopped')d.uncertain_actions=(d.uncertain_actions||[]).concat(p.action).slice(-100);if(old.confirmed&&old.response)d.last_result={operation_id:p.id,at:Date.now(),response:old.response};return d});
   if(!reconciled.changed)return reply(view(reconciled.state),200,HEAD);startRevision=reconciled.state.revision;
  }
  const refreshPlanner=/opencode_timeout/.test(saved.state.reason||'');
  const online=!refreshPlanner&&(await commandServiceHealth(env)).brain_ready;
  if(!online){const r=await startCommandSession(request('command-session?brain=opencode'+(refreshPlanner?'&refresh=1':''),{}),env,ctx,baseUrl);if(!r.ok)return r}
  const baseline=(await readAutoplay(env,owner)).state;
  // A stop arriving during session setup must win over this older start.
  if(baseline.revision!==startRevision)return reply(view(baseline),200,HEAD);
  const next=await update(d=>{if(d.revision!==baseline.revision)return null;if(refreshPlanner)d.required_planner_revision='server-v5';d.context_channel_id=data.channel_id||d.context_channel_id||CHANNEL;d.chat_started_at=Date.now();d.plan_pending=null;d.plan_decision=null;d.lease=null;d.phase=online?'running':'waiting';d.reason=online?'Lendo sua ficha e o estado do jogo.':'Conectando o executor. Nenhuma ação enviada ainda.';d.code=null;d.run_id=crypto.randomUUID();d.steps=0;if(!d.player_observations?.length){d.completed_keys=[];d.player_observations=[];}d.next_tick_at=Date.now()+1000;return d});return reply(view(next.state),200,HEAD);
 }
 if(!['running','waiting','confirming'].includes(saved.state.phase))return reply(view(saved.state),200,HEAD);
 if(saved.state.lease&&saved.state.lease.until>Date.now())return reply(view(saved.state),200,HEAD);
 const lock=crypto.randomUUID(),run=saved.state.run_id;
 const claimed=await update(d=>{if(d.run_id!==run||!['running','waiting','confirming'].includes(d.phase)||d.lease?.until>Date.now())return null;d.lease={id:lock,until:Date.now()+60000};return d});
 if(!claimed.changed)return reply(view(claimed.state),200,HEAD);
 const commit=fn=>update(d=>{if(d.run_id!==run||d.lease?.id!==lock)return null;fn(d);d.lease=null;return d});
 try{
  if(saved.state.plan_pending){
   const result=await lookup(saved.state.plan_pending);
   if(['queued','in_progress'].includes(result.state)){const next=await commit(d=>{d.reason='OpenCode está decidindo a próxima ação.';d.next_tick_at=Date.now()+2000});return reply(view(next.state),200,HEAD)}
   if(!result.brain?.plan)throw Error('OpenCode não retornou um plano: '+(result.brain?.error||result.state));
   const next=await commit(d=>{d.plan_decision=result.brain.plan;d.plan_pending=null;d.brain={provider:'opencode',model:result.brain.model};d.reason='Plano recebido do OpenCode. Conferindo comandos e contexto.';d.next_tick_at=Date.now()+1000});return reply(view(next.state),200,HEAD);
  }
  if(saved.state.pending){
   const result=await lookup(saved.state.pending.id);
   const pending=saved.state.pending;
   if(result.request_id!==pending.id||result.command!==pending.action.command)throw Error('A resposta não corresponde ao comando pendente.');
   if(['uncertain','unknown','stopped'].includes(result.state))throw Error('A ação terminou sem resultado confirmado. Não vou repeti-la.');
   if(result.state!=='finished'){const next=await commit(d=>{d.reason='Aguardando a resposta de '+pending.action.command;d.next_tick_at=Date.now()+2000});return reply(view(next.state),200,HEAD)}
   if(!result.confirmed||!result.response)throw Error('O jogo não confirmou o resultado. Não vou repetir o comando.');
   const snapshot=responseSnapshot({command:pending.action.command,request_id:pending.id},result.response,owner);
   const next=await commit(d=>{d.steps++;d.completed_keys.push(pending.action.command);d.player_observations=(d.player_observations||[]).concat([{at:Date.now(),command:pending.action.command,channel_id:result.response.channel_id,text:result.response.normalized_text||result.response.content||'',controls:result.response.controls||[]}]).slice(-30);d.last_result={operation_id:pending.id,at:Date.now(),response:result.response};if(pending.action.arrival_check)d.arrival_reviewed=pending.action.arrival_check;if(snapshot&&Object.keys(snapshot.stats).length)d.snapshot={...snapshot,stats:{...(d.snapshot?.stats||{}),...Object.fromEntries(Object.entries(snapshot.stats).map(([k,v])=>[k,['hp','chakra','energy'].includes(k)?{current:v.value,max:v.max}:v.value]))}};d.pending=null;d.phase=d.snapshot?.stats?.level>=d.goal_level?'completed':'running';d.reason=d.phase==='completed'?'Nível alvo confirmado na resposta do jogo.':'Resposta recebida. Escolhendo a próxima ação.';d.next_tick_at=d.phase==='completed'?0:Date.now()+1500;recordAutoplay(d,'confirmed',pending.action.command)});return reply(view(next.state),200,HEAD);
  }
  const learned=await learn(env,{...ctx,context_channel_id:saved.state.context_channel_id||CHANNEL},{read:readChat,list:listChannels});
  if(learned.initial){const next=await commit(d=>{d.reason=learned.note;d.learning_progress=learned.progress;d.phase='waiting';d.next_tick_at=Date.now()+10000});return reply(view(next.state),200,HEAD)}
  const executorHealth=await commandServiceHealth(env);
  if(!executorHealth.online||(saved.state.required_planner_revision&&executorHealth.planner_revision!==saved.state.required_planner_revision)){
   if(Date.now()>=(saved.state.reconnect_at||0)){
    const renewed=await startCommandSession(request('command-session?brain=opencode',{}),env,ctx,baseUrl);const connection=await renewed.json();
    const next=await commit(d=>{d.phase='waiting';d.reason=connection.error||connection.note||'Reconectando o executor. Nenhum comando reenviado.';d.reconnect_at=Date.now()+120000;d.next_tick_at=Date.now()+5000});return reply(view(next.state),200,HEAD);
   }
   const next=await commit(d=>{d.phase='waiting';d.reason='Executor desconectado. Aguardando a sessão solicitada; nenhum comando reenviado.';d.next_tick_at=Date.now()+5000});return reply(view(next.state),200,HEAD);
  }
  const arrival=travelArrival(saved.state.last_result?.response?.normalized_text)||(saved.state.player_observations||[]).map(x=>travelArrival(x.text)).filter(Boolean).at(-1);
  if(arrival&&Date.now()<arrival+5000){const next=await commit(d=>{d.phase='waiting';d.reason='Viagem confirmada. Aguardando a chegada informada pelo jogo.';d.next_tick_at=arrival+5000});return reply(view(next.state),200,HEAD)}
  if(saved.state.steps>=saved.state.max_steps)throw Error('Limite de ações desta sessão atingido sem confirmação do nível alvo.');
  const contextChannel=saved.state.context_channel_id||CHANNEL;
  const history=await readChat(env,'bushin_naruto_personal_read',{channel_id:contextChannel,limit:12},ctx);
  if(!history.read){
   if([403,404].includes(Number(history.code))){
    const listed=await listChannels(env,ctx);
    if(!listed.listed||!listed.visibility_filtered)throw Error('Não foi possível atualizar os canais permitidos após a mudança de acesso.');
    const readable=listed.channels.filter(c=>[0,5].includes(Number(c.type))&&c.id!==contextChannel);
    const route=readable.find(c=>String(c.name).normalize('NFKD').toLowerCase().includes('caminho'))||readable.find(c=>c.id===CHANNEL);
    if(!route)throw Error('O canal anterior ficou indisponível e o jogo ainda não liberou um canal de caminho ou comandos.');
    const next=await commit(d=>{d.context_channel_id=route.id;d.site_action={id:crypto.randomUUID(),type:'channel',channel_id:route.id};d.reason='Acesso mudou. Canal permitido atualizado; vou ler o contexto antes de agir.';d.phase='waiting';d.next_tick_at=Date.now()+3000;recordAutoplay(d,'access_changed',route.id)});
    return reply(view(next.state),200,HEAD);
   }
   throw Error(history.reason||'Não foi possível ler o contexto atual do chat.');
  }
  const conversation=chatContext(history.messages);
  const target=replyTarget(history.messages,owner,saved.state.chat_started_at||Date.now(),saved.state.reserved_reply_ids||[]);
  if(target){
   if(saved.state.plan_decision?.command!=='/reply'){
    const planningContext=JSON.stringify({task:'Responder de forma curta e casual em português, sem inventar fatos ou prometer ações.',conversation,target:{id:target.id,author_id:target.author_id,text:target.normalized_text||target.content},commands:[{command:'/reply',options:[{name:'text',type:3,required:true}]}],channels:[{id:contextChannel}]});
    const queued=await service({action:'start',run_id:run,command_request:{command:'/agent-plan',channel_id:contextChannel,options:{context:planningContext}}});
    const next=await commit(d=>{d.plan_pending=queued.request_id;d.plan_decision=null;d.reply_plan_target=target.id;d.reason='OpenCode está preparando a resposta no contexto do chat.';d.next_tick_at=Date.now()+2000});return reply(view(next.state),200,HEAD);
   }
   if(saved.state.reply_plan_target!==target.id)throw Error('A mensagem a responder mudou. Nenhuma resposta foi enviada.');
   const text=replyText(saved.state.plan_decision.options?.text,target);
   const reservation=await update(d=>{if(d.run_id!==run||d.lease?.id!==lock||d.phase==='stopped'||(d.reserved_reply_ids||[]).includes(target.id))return null;d.reserved_reply_ids=(d.reserved_reply_ids||[]).concat(target.id).slice(-100);return d});
   if(!reservation.changed)return reply(view(reservation.state),200,HEAD);
   const beforeChat=(await readAutoplay(env,owner)).state;
   if(beforeChat.run_id!==run||beforeChat.lease?.id!==lock||beforeChat.phase==='stopped')return reply(view(beforeChat),200,HEAD);
   const sent=await sendChat(env,'bushin_naruto_personal_send',{channel_id:contextChannel,text,mention_ids:[target.author_id],reply_to:target.id,confirmed:true},ctx);
   if(sent.sent!==true)throw Error(sent.reason||'O Discord não confirmou a mensagem. Não vou repetir.');
   const next=await commit(d=>{d.steps++;d.reason='Resposta enviada no chat com marcação do autor.';d.plan_decision=null;d.reply_plan_target=null;d.last_chat_reply={id:sent.message_id,channel_id:contextChannel,text};d.next_tick_at=Date.now()+20000;recordAutoplay(d,'chat_sent','Resposta à mensagem '+target.id)});return reply(view(next.state),200,HEAD);
  }
  const registry=await personalInspectCommand(env,{channel_id:CHANNEL,command:'/perfil ver'},ctx);
  if(!registry.catalog_verified||registry.stale)throw Error('Catálogo de comandos não confirmado.');
  const available=playerCommands(registry.commands).filter(x=>!saved.state.completed_keys.includes(x.command)||['/viajar','/acao coletar','/mapa'].includes(x.command));
  const currentResponse=await (await commandServiceMobile(new Request(baseUrl+'/mobile/discord2/api/ai/opencode'),env,ctx,{unseal,baseUrl})).json();
  const stored=saved.state.last_result;
  const fresh=!!stored&&currentResponse.state==='finished'&&currentResponse.confirmed&&currentResponse.controls_current!==false&&(currentResponse.game_request_id||currentResponse.request_id)===stored.operation_id&&(currentResponse.game_response||currentResponse.response)?.message_id===stored.response?.message_id;
  const staleBox=!!stored?.response?.controls?.length&&!fresh;
  const last=fresh?(currentResponse.game_response||currentResponse.response):null;
  const controls=(last?.controls||[]).filter(c=>!c.disabled&&!c.url&&[2,3].includes(c.type));
  available.push({command:'/navigate',description:'Selecionar e ler outro canal acessível no site, sem enviar mensagem.',options:[]});
  if(controls.length)available.push({command:'/component',description:'Usar somente uma das caixas da última resposta própria',options:[{name:'message_id',type:3,required:true},{name:'custom_id',type:3,required:true},{name:'values',type:3,required:true}]});
  const seed=!saved.state.refresh_observation&&['/perfil ver','/nivel','/missoes minhas','/missoes ativas'].find(x=>!saved.state.completed_keys.includes(x)&&available.some(c=>c.command===x));
  let selected=seed?{command:seed,options:{},channel_id:CHANNEL}:null;
  let channels=[{id:CHANNEL,name:'Comandos'}];
  if(!selected){
   const listed=await listChannels(env,ctx);if(listed.listed&&Array.isArray(listed.channels))channels=listed.channels.filter(x=>[0,5].includes(Number(x.type))).map(x=>({id:String(x.id),name:x.name}));else throw Error(listed.reason||'Não foi possível conferir os canais disponíveis.');
   const context=(saved.state.player_observations||[]).map(x=>({...x,text:x.text.slice(0,2200)}));
   const key=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const gate=channels.find(c=>key(c.name).includes('portao')&&key(c.name).includes('konoha'));
   const refused=context.some(x=>x.command==='/viajar'&&/viagem indisponível|canais permitidos/i.test(x.text));
   const menu=forestControl(controls);
   const npc=controls.length===1&&controls[0].type===2&&String(controls[0].custom_id).startsWith('interagir:')?controls[0]:null;
   if(saved.state.refresh_observation||staleBox){const channel=channels.some(c=>c.id===contextChannel)?contextChannel:CHANNEL;if(!available.some(c=>c.command==='/mapa'))throw Error('Não há consulta de mapa verificada para atualizar o contexto.');selected={command:'/mapa',channel_id:channel,options:{},refresh_read:true};}
   else if(arrival&&saved.state.arrival_reviewed!==arrival&&available.some(c=>c.command==='/mapa')){
    const current=channels.find(c=>c.id===contextChannel),route=channels.find(c=>key(c.name).includes('caminho')),commands=channels.find(c=>c.id===CHANNEL);
    const destination=current||route||commands;
    if(!destination)throw Error('Nenhum canal permitido para consultar o mapa após a chegada.');
    selected={command:'/mapa',options:{},channel_id:destination.id,refresh_read:true,arrival_check:arrival};
   }
   else if(gate&&(saved.state.refresh_menu||refused&&!context.some(x=>x.command==='/viajar'&&x.channel_id===gate.id)))selected={command:'/viajar',options:{},channel_id:gate.id};
   else if(menu){selected={command:'/component',channel_id:last.channel_id,options:{message_id:last.message_id,custom_id:menu.control.custom_id,values:JSON.stringify(menu.values)}};}
   else if(npc)selected={command:'/component',channel_id:last.channel_id,options:{message_id:last.message_id,custom_id:npc.custom_id,values:'[]'}};
   else{
    if(saved.state.plan_decision)selected=saved.state.plan_decision;
    else{
     const planningContext=JSON.stringify({learned_rules:learned.evidence,conversation,context_channel_id:contextChannel,observations:context,commands:available,channels,last_response:last?{message_id:last.message_id,channel_id:last.channel_id,controls}:null});
     if(planningContext.length>50000)throw Error('Contexto grande demais para o OpenCode.');
     const queued=await service({action:'start',run_id:run,command_request:{command:'/agent-plan',channel_id:contextChannel,options:{context:planningContext}}});
     const next=await commit(d=>{d.plan_pending=queued.request_id;d.phase='waiting';d.reason='Enviando contexto ao OpenCode.';d.next_tick_at=Date.now()+2000});return reply(view(next.state),200,HEAD);
    }
    if(!selected.command)throw Error(String(selected.reason||'Não encontrei uma próxima ação verificável.').slice(0,300));
   }
  }
  if(!available.some(x=>x.command===selected.command))throw Error('Ação fora do catálogo permitido.');
  if(selected.options===null||selected.options===''||Array.isArray(selected.options)&&selected.options.length===0)selected.options={};
  if(selected.options&& (typeof selected.options!=='object'||Array.isArray(selected.options)))throw Error('A IA retornou parâmetros inválidos para '+selected.command);
  selected.channel_id=selected.channel_id||CHANNEL;
  if(selected.command==='/component'){selected.channel_id=last.channel_id;selected.options=ownComponentOptions(selected.options||{},last);const key=JSON.stringify([last.message_id,selected.options.custom_id,selected.options.values]);if((saved.state.completed_components||[]).includes(key))throw Error('Esta opção já foi usada nesta mensagem.');selected.component_key=key;}
  if(!channels.some(c=>c.id===selected.channel_id))throw Error('A IA não escolheu um canal acessível.');
  if(!selected.refresh_read&&(saved.state.uncertain_actions||[]).some(x=>x.command===selected.command&&x.channel_id===selected.channel_id))throw Error('Uma tentativa dessa ação ficou incerta nesse canal. Nenhum reenvio foi feito.');
  if(selected.command!=='/component'&&!selected.refresh_read&&!(saved.state.refresh_menu&&selected.command==='/viajar')&&(saved.state.player_observations||[]).some(x=>x.command===selected.command&&(x.channel_id||CHANNEL)===selected.channel_id))throw Error('Esta ação já foi conferida nesse canal; não vou repeti-la.');
  const definition=available.find(x=>x.command===selected.command);
  const fields=definition.options||[],options=selected.options||{};
  for(const name of Object.keys(options))if(!fields.some(x=>x.name===name))throw Error('Parâmetro desconhecido em '+selected.command+': '+name);
  for(const field of fields)if(field.required&&!Object.hasOwn(options,field.name))throw Error('Falta informação para '+selected.command+': '+field.name);
  for(const [name,value] of Object.entries(options))if(!['string','boolean','number'].includes(typeof value))throw Error('Parâmetro não é simples em '+selected.command+': '+name);
  // Recheck the owner stop/revision after inference, immediately before queueing.
  const current=(await readAutoplay(env,owner)).state;if(current.run_id!==run||current.lease?.id!==lock||current.phase==='stopped')return reply(view(current),200,HEAD);
  if(selected.command==='/navigate'){
   if(selected.channel_id===contextChannel)throw Error('Este canal já está selecionado.');
   const next=await commit(d=>{d.plan_decision=null;d.context_channel_id=selected.channel_id;d.site_action={id:crypto.randomUUID(),type:'channel',channel_id:selected.channel_id};d.steps++;d.reason='Canal selecionado. Lendo o contexto antes da próxima ação.';d.next_tick_at=Date.now()+1500;recordAutoplay(d,'channel_selected',selected.channel_id)});return reply(view(next.state),200,HEAD);
  }
  const result=await service({action:'start',run_id:run,command_request:{command:selected.command,channel_id:selected.channel_id,options:selected.options||{}}});
  const next=await commit(d=>{d.plan_decision=null;d.context_channel_id=selected.channel_id;d.site_action={id:result.request_id,type:'channel',channel_id:selected.channel_id};d.refresh_menu=false;d.refresh_observation=false;if(selected.component_key)d.completed_components=(d.completed_components||[]).concat(selected.component_key).slice(-100);d.pending={id:result.request_id,action:{label:selected.command,command:selected.command,channel_id:selected.channel_id,...(selected.arrival_check?{arrival_check:selected.arrival_check}:{})},stages:{requested:true,sent:false}};d.phase='confirming';d.reason='Executando '+selected.command;d.next_tick_at=Date.now()+2000;recordAutoplay(d,'requested',selected.command)});if(!next.changed){try{await service({action:'stop'})}catch{}}return reply(view(next.state),200,HEAD);
 }catch(e){const next=await commit(d=>{d.phase='blocked';d.code='player_paused';d.reason=String(e.message).slice(0,300);d.next_tick_at=0});return reply(view(next.state),200,HEAD)}
}
