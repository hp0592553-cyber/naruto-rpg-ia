import test from 'node:test';
import assert from 'node:assert/strict';
import {codexBridgeMobile,codexBridgeAgent} from '../codex-bridge.mjs';
import {PANEL_HTML,PANEL_JS} from '../discord2-ui.mjs';

const owner='481485837801095178',baseUrl='https://bushin.example.test';
const reply=(body,status=200,headers={})=>Response.json(body,{status,headers});
const ctx={me:{id:owner}};
function fakeDb(){
 const rows=new Map();
 return {
  rows,
  prepare(sql){
   return {bind(...args){
    return {
     async first(){
      if(!sql.startsWith('SELECT value_json'))throw Error('unexpected first: '+sql);
      const val=rows.get(args[0]+':'+args[1]);
      return val===undefined?null:{value_json:val};
     },
     async run(){
      const key=args[0]+':'+args[1];
      if(sql.startsWith('INSERT INTO bushin_project_state')){
       rows.set(key, args[2]);return {meta:{changes:1}};
      }
      if(sql.startsWith('DELETE FROM bushin_project_state')){
       if(args.length===3&&rows.get(key)!==args[2])return {meta:{changes:0}};
       const deleted=rows.delete(key);return {meta:{changes:deleted?1:0}};
      }
      if(sql.startsWith('UPDATE bushin_project_state')){
       const k=args[2]+':'+args[3];
       if(rows.get(k)!==args[4])return {meta:{changes:0}};
       rows.set(k,args[0]);return {meta:{changes:1}};
      }
      throw Error('unexpected run: '+sql);
     }
    };
   }};
  }
 };
}
function mobile(method='GET',body=null,origin=baseUrl){
 return new Request(baseUrl+'/mobile/discord2/api/ai/codex-bridge',{
  method,headers:{...(origin?{origin}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}
test('private cloud chat keeps recent channel context beyond the old 1100-character truncation',async()=>{
 let prompt='';const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb(),BUSHIN_AI:{async run(_model,input){prompt=input.messages[1].content;return {response:'Contexto recebido; nenhuma ação executada.'};}}};
 const context='Canal 1520114348079583263\n'+'a'.repeat(1800)+'\nÚLTIMA MENSAGEM: encontro às oito.';
 const res=await codexBridgeMobile(mobile('POST',{action:'cloud_chat',provider:'llama',intent:'conversar',question:'Qual o horário?',context,current_channel_id:'1520114348079583263',scan_scope:'none'}),env,ctx,{reply,baseUrl});
 assert.equal(res.status,200);assert.match(prompt,/ÚLTIMA MENSAGEM: encontro às oito/);const data=await res.json();assert.equal(data.sent,false);assert.equal(data.executed_command,false);
});
function internal(path,method='GET',body=null,token=''){
 return new Request(baseUrl+'/internal/codex-bridge/'+path,{
  method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}
test('Codespaces bridge supports one-time pairing and a single harmless Codex echo',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb()};
 const h={reply,baseUrl};
 let res=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.deepEqual((await res.json()).connected,false);
 res=await codexBridgeMobile(mobile('POST',{action:'pair'}),env,ctx,h);
 assert.equal(res.status,200);const {pair_code}=await res.json();
 assert.match(pair_code,/^[0-9a-f]{64}$/);
 res=await codexBridgeAgent(internal('pair','POST',{pair_code}),env,{reply});
 assert.equal(res.status,200);const {agent_token}=await res.json();
 assert.match(agent_token,/^[0-9a-f]{64}$/);
 res=await codexBridgeAgent(internal('pair','POST',{pair_code}),env,{reply});
 assert.equal(res.status,401,'pairing code is one-time');
 res=await codexBridgeAgent(internal('queue','GET',null,agent_token),env,{reply});
 assert.equal(res.status,200);assert.equal((await res.json()).job,null);
 res=await codexBridgeMobile(mobile('POST',{action:'test'}),env,ctx,h);
 assert.equal(res.status,202);const {job_id}=await res.json();
 res=await codexBridgeAgent(internal('queue','GET',null,agent_token),env,{reply});
 assert.equal(res.status,200);const {job}=await res.json();
 assert.equal(job.id,job_id);assert.equal(job.kind,'echo');
 assert.equal(job.prompt,'Responda apenas: BUSHIN_CODEX_OK');
 res=await codexBridgeAgent(internal('queue','GET',null,agent_token),env,{reply});
 assert.equal((await res.json()).job,null,'queue is not delivered twice');
 res=await codexBridgeAgent(internal('result','POST',{id:job_id,success:true,output:'BUSHIN_CODEX_OK'},agent_token),env,{reply});
 assert.equal(res.status,200);assert.equal((await res.json()).success,true);
 res=await codexBridgeMobile(mobile(),env,ctx,h);
 const status=await res.json();assert.equal(status.connected,true);assert.equal(status.job.state,'completed');assert.equal(status.job.result,'BUSHIN_CODEX_OK');
 assert.ok(!JSON.stringify(status).includes(agent_token),'token must never reach UI');
});
test('bridge rejects fake origins, users, credentials and never accepts arbitrary prompts',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb()},h={reply,baseUrl};
 let res=await codexBridgeMobile(mobile('POST',{action:'pair'},'https://attacker.example'),env,ctx,h);
 assert.equal(res.status,403);
 res=await codexBridgeMobile(mobile('POST',{action:'pair'}),env,{me:{id:'000'}},h);
 assert.equal(res.status,403);
 res=await codexBridgeAgent(internal('queue','GET',null,'x'.repeat(64)),env,{reply});
 assert.equal(res.status,401);
 res=await codexBridgeMobile(mobile('POST',{action:'execute',command:'/viajar'}),env,ctx,h);
 assert.equal(res.status,400);
});
test('Discord 2 contains working pairing and status controls without ChatGPT credentials',()=>{
 assert.match(PANEL_HTML,/id="codexBridgePair"/);
 assert.match(PANEL_HTML,/id="codexBridgeTest"/);
 assert.match(PANEL_HTML,/id="codexBridgeCode"/);
 assert.match(PANEL_JS,/ai\/codex-bridge/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});


test('Chat in Discord 2 routes private RPG intent messages to updated Codex CLI only',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb()};
 const h={reply,baseUrl};
 const pair=await codexBridgeMobile(mobile('POST',{action:'pair'}),env,ctx,h);
 const {pair_code}=await pair.json();
 const paired=await codexBridgeAgent(internal('pair','POST',{pair_code}),env,{reply});
 const {agent_token}=await paired.json();
 // The old echo-only Codespaces runner must not accidentally consume chat tasks.
 let status=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.equal((await status.json()).chat_ready,false);
 let unavailable=await codexBridgeMobile(mobile('POST',{action:'chat',intent:'ficha',question:'Qual meu nível?'}),env,ctx,h);
 assert.equal(unavailable.status,409);
 const hb=await codexBridgeAgent(internal('queue?capabilities=chat-v1','GET',null,agent_token),env,{reply});
 assert.equal(hb.status,200);
 status=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.equal((await status.json()).chat_ready,true);
 const invalid=await codexBridgeMobile(mobile('POST',{action:'chat',intent:'hack',question:'faça isso'}),env,ctx,h);
 assert.equal(invalid.status,400);
 const created=await codexBridgeMobile(mobile('POST',{
  action:'chat',intent:'ficha',question:'Qual meu nível de ninja?',
  context:'Canal comandos. Naruto Bot: ficha indisponível.',
 }),env,ctx,h);
 assert.equal(created.status,202);
 const jobId=(await created.json()).job_id;
 let queued=await codexBridgeAgent(internal('queue','GET',null,agent_token),env,{reply});
 assert.equal((await queued.json()).job,null,'legacy runner must not steal a chat task');
 // New runner declares chat capability and can process the bounded read-only prompt.
 queued=await codexBridgeAgent(internal('queue?capabilities=chat-v1','GET',null,agent_token),env,{reply});
 const task=(await queued.json()).job;
 assert.equal(task.id,jobId);assert.equal(task.kind,'chat');
 assert.match(task.prompt,/BUSHIN_CODEX_CHAT_V1/);
 assert.match(task.prompt,/Não faça|não use ferramentas|não execute comandos/i);
 assert.match(task.prompt,/Ficha ainda não confirmada/);
 assert.match(task.prompt,/Qual meu nível de ninja/);
 const response=await codexBridgeAgent(internal('result','POST',{
  id:jobId,success:true,output:'Seu nível ainda não foi confirmado; consulte sua ficha.',
 },agent_token),env,{reply});
 assert.equal(response.status,200);assert.equal((await response.json()).saved,true);
 status=await codexBridgeMobile(mobile(),env,ctx,h);
 const chat=await status.json();
 assert.equal(chat.job.kind,'chat');assert.equal(chat.job.state,'completed');
 assert.equal(chat.chat_history.length,2);assert.equal(chat.chat_history[0].role,'user');
 assert.equal(chat.chat_history[1].role,'assistant');
 assert.ok(!JSON.stringify(chat).includes(agent_token));
 const cleared=await codexBridgeMobile(mobile('POST',{action:'clear_chat'}),env,ctx,h);
 assert.equal(cleared.status,200);
 status=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.equal((await status.json()).chat_history.length,0);
});

test('RPG intent controls are on the main chat, separate from Discord send',()=>{
 assert.match(PANEL_HTML,/id="quickCodex"/);
 assert.match(PANEL_HTML,/id="codexConversation"/);
 assert.match(PANEL_HTML,/id="codexComposer"/);
 assert.match(PANEL_HTML,/data-codex-intent="missoes"/);
 assert.match(PANEL_HTML,/data-codex-intent="combate"/);
 assert.match(PANEL_JS,/action:mode==="cli"\?"chat":"cloud_chat"/);
 assert.match(PANEL_JS,/renderCodexConversation/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});


test('Codex chat can use selected persisted channel scans without mixing other channels',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb()};
 const saved=JSON.stringify({recent:Date.now(),notes:{
  '1520114348079583263':{summary:'Missões e comandos: explicação do Naruto Bot',updated_at:Date.now(),scope:'single_channel'},
  '1532489544161562857':{summary:'Regras gerais do RP e evolução',updated_at:Date.now(),scope:'single_channel'},
  '1543671277846274138':{summary:'Outro canal não selecionado',updated_at:Date.now(),scope:'single_channel'}
 }});
 env.DB.rows.set(owner+':discord2_rpg_scan',saved);
 const h={reply,baseUrl};
 let res=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.equal((await res.json()).scan_available_channels.length,3);
 res=await codexBridgeMobile(mobile('POST',{action:'pair'}),env,ctx,h);
 const {pair_code}=await res.json();
 res=await codexBridgeAgent(internal('pair','POST',{pair_code}),env,{reply});
 const {agent_token}=await res.json();
 await codexBridgeAgent(internal('queue?capabilities=chat-v1','GET',null,agent_token),env,{reply});
 res=await codexBridgeMobile(mobile('POST',{action:'chat',intent:'analisar',
  question:'Analise apenas os canais selecionados.',
  scan_scope:'selected',scan_channel_ids:['1520114348079583263','1532489544161562857'],
  current_channel_id:'1520114348079583263',context:'Mensagem carregada no navegador'}),env,ctx,h);
 assert.equal(res.status,202);
 assert.equal((await res.json()).included_scan_notes,2);
 res=await codexBridgeAgent(internal('queue?capabilities=chat-v1','GET',null,agent_token),env,{reply});
 const data=(await res.json()).job;
 assert.match(data.prompt,/Missões e comandos/);
 assert.match(data.prompt,/Regras gerais/);
 assert.doesNotMatch(data.prompt,/Outro canal não selecionado/);
 assert.match(data.prompt,/Resumos podem misturar|resumos podem misturar/i);
 assert.ok(data.prompt.length<=9500);
});
test('Channel analysis controls are part of the conversational panel',()=>{
 assert.match(PANEL_HTML,/id="openCodexChat"/);
 assert.match(PANEL_HTML,/id="codexScanCurrent"/);
 assert.match(PANEL_HTML,/id="codexScanAll"/);
 assert.match(PANEL_HTML,/id="codexChannelChoices"/);
 assert.match(PANEL_HTML,/id="codexScanScope"/);
 assert.match(PANEL_JS,/beginChatScan/);
 assert.match(PANEL_JS,/scan_channel_ids:codexPickedChannelIds/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});


test('Bushin cloud chat answers without Codespaces, never using a ChatGPT token',async()=>{
 const DB=fakeDb();
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB,BUSHIN_AI:{async run(model,input){
  assert.match(model,/llama-3.1/);
  assert.match(input.messages[0].content,/Bushin Cloud/);
  assert.match(input.messages[1].content,/Qual minha missão/);
  assert.doesNotMatch(input.messages[1].content,/Você é o Codex no chat/);
  return {response:'Missão não confirmada. Abra o perfil ou verifique a missão.'};
 }}};
 const h={reply,baseUrl};
 let r=await codexBridgeMobile(mobile(),env,ctx,h);
 const status=await r.json();
 assert.equal(status.connected,false,'no CLI required');
 assert.equal(status.cloud_ready,true);
 assert.equal(status.cloud_codex_ready,false);
 r=await codexBridgeMobile(mobile('POST',{
  action:'cloud_chat',provider:'llama',intent:'missoes',question:'Qual minha missão?',
  scan_scope:'none',context:'Não há perfil confiável.'
 }),env,ctx,h);
 assert.equal(r.status,200);
 const answer=await r.json();
 assert.equal(answer.provider,'llama');
 assert.match(answer.model,/Llama 3.1/);
 assert.match(answer.answer,/Missão não confirmada/);
 assert.equal(answer.executed_command,false);
 assert.equal(answer.sent,false);
 assert.equal(answer.chat_history.length,2);
 assert.match(answer.chat_history[1].model,/Llama/);
 r=await codexBridgeMobile(mobile(),env,ctx,h);
 assert.equal((await r.json()).chat_history.length,2);
});
test('Cloud Codex API cannot be used without billing secret and no fallback is disguised',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:fakeDb(),BUSHIN_AI:{run(){throw Error('must not fallback to Llama')}}};
 let r=await codexBridgeMobile(mobile('POST',{
  action:'cloud_chat',provider:'codex_api',intent:'conversar',question:'Oi'
 }),env,ctx,{reply,baseUrl});
 assert.equal(r.status,503);
 const body=await r.json();
 assert.equal(body.code,'missing_api_key');
 assert.match(body.error,/OPENAI_API_KEY/);
 r=await codexBridgeMobile(mobile('POST',{
  action:'cloud_chat',provider:'hack',intent:'conversar',question:'Oi'
 }),env,ctx,{reply,baseUrl});
 assert.equal(r.status,400);
});
test('UI distinguishes Codex CLI, Llama Cloud and API Codex models',()=>{
 assert.match(PANEL_HTML,/id="codexRuntime"/);
 assert.match(PANEL_HTML,/value="cli"/);
 assert.match(PANEL_HTML,/value="llama"/);
 assert.match(PANEL_HTML,/value="codex_api"/);
 assert.match(PANEL_HTML,/não joga automaticamente/);
 assert.match(PANEL_JS,/cloud_chat/);
 assert.match(PANEL_JS,/row.model/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});
