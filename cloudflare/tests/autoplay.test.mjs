import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {autoplayRoute,advanceAutoplay,permittedActions,scheduledAutoplay} from '../autoplay.mjs';
import {readAutoplay,changeAutoplay} from '../autoplay-store.mjs';
import {GAME_PROTOCOL,createGameAdapter,validateObservation,validateGrant,boundedJson,retryAt} from '../game-adapter.mjs';
const owner='481485837801095178',channel='1520114348079583263',baseUrl='https://bushin.example.test';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE bushin_project_state (owner_id TEXT NOT NULL,key TEXT NOT NULL,value_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_id,key))');
 return {sql,prepare(query){
  return {bind(...args){
   return {
    async first(){return sql.prepare(query).get(...args)||null;},
    async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}
   };
  }};
 }};
}
function fixture(){
 let time=1793021000000,version=0,postCount=0,lookupCount=0,observeCount=0,modelCount=0;const operations=new Map();
 const stamp=()=>time;const envelope={protocol:GAME_PROTOCOL,owner_id:owner,character_id:'henrique'};
 const grant=()=>({...envelope,game:'naruto-project',authorized:true,approval_reference:'naruto-operator-approved',grant_id:'grant-1',expires_at:time+3600000,idempotency:true,result_lookup:true,channel_ids:[channel],allowed_kinds:['query','channel','travel','mission','npc','combat','reply','recover','item']});
 const action=(overrides={})=>({id:'profile-'+version,semantic_key:'query:profile',kind:'query',label:'Consultar perfil',channel_id:channel,owner_id:owner,state_revision:'state-'+version,expires_at:time+60000,safe:true,risk:'low',cost:{chakra:0,energy:0},...overrides});
 const observation=(overrides={})=>({...envelope,revision:'state-'+version,observed_at:time,channel_id:channel,stats:{level:version>=2?20:11,xp:10+version,hp:{current:80,max:100},chakra:{current:50,max:100},energy:{current:60,max:100}},rules_revision:'rules-1',rules:'Teste de contrato, sem execução em jogo real.',combat:{active:false},available_actions:[action()],...overrides});
 const hooks={};
 const env={BUSHIN_OWNER_DISCORD_ID:owner,BUSHIN_GAME_APPROVAL:'naruto-operator-approved',DB:database(),BUSHIN_AI:{async run(model,input){modelCount++;if(hooks.model)return hooks.model(model,input);const data=JSON.parse(input.messages[1].content);return {response:JSON.stringify({action_id:data.allowed_actions[0].id,reason:'Consulta disponível.'})};}},BUSHIN_GAME:{async fetch(url,init){
  const path=new URL(url).pathname;
  if(path==='/v1/authorization')return Response.json(hooks.grant?hooks.grant():grant());
  if(path==='/v1/observation'){observeCount++;if(hooks.observe)return hooks.observe();return Response.json(observation());}
  if(path==='/v1/actions'&&init.method==='POST'){
   postCount++;const request=JSON.parse(init.body);if(hooks.execute)return hooks.execute(request);
   operations.set(request.operation_id,{...envelope,operation_id:request.operation_id,status:'completed',game_confirmed:true,action_id:request.available_action_id,
    snapshot:(()=>{version++;return observation()})(),response:{id:'1564255220412711052',channel_id:channel,author:{id:'1515908078913192026',username:'Naruto Bot',bot:true},content:'Resposta de teste do contrato.',flags:64}});
   return Response.json({...envelope,operation_id:request.operation_id,accepted:true});
  }
  if(path.startsWith('/v1/actions/')){lookupCount++;const id=decodeURIComponent(path.split('/').at(-1));if(hooks.result)return hooks.result(id);return operations.has(id)?Response.json(operations.get(id)):new Response('',{status:404});}
  throw Error('unexpected request '+path);
 }}};
 Object.defineProperty(env,'DISCORD_USER_TOKEN',{get(){throw Error('Personal-account token must never be read');}});
 const reply=(data,status=200,headers)=>Response.json(data,{status,headers});const ctx={me:{id:owner,membership:{member:true}}};
 const request=(action,revision,extra={})=>new Request(baseUrl+'/mobile/discord2/api/autoplay',{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({action,revision,...extra})});
 const control=async(action,extra={})=>{const state=(await readAutoplay(env,owner)).state;const res=await autoplayRoute(request(action,state.revision,extra),env,ctx,{reply,baseUrl,now:stamp});return {res,data:await res.json()};};
 const tick=()=>advanceAutoplay(env,owner,{now:stamp});
 return {env,ctx,reply,request,control,tick,now:stamp,step:(ms=6000)=>time+=ms,hooks,grant,action,observation,envelope,operations,
  counts:()=>({postCount,lookupCount,observeCount,modelCount}),read:async()=>(await readAutoplay(env,owner)).state};
}
test('missing operator integration blocks start and never falls back to Discord user token',async()=>{
 const f=fixture();delete f.env.BUSHIN_GAME;
 const {res,data}=await f.control('start');assert.equal(res.status,200);assert.equal(data.state.phase,'blocked');assert.equal(data.state.code,'game_integration_missing');assert.equal(data.state.steps,0);assert.match(data.integration.missing.join(' '),/BUSHIN_GAME/);assert.equal(data.background_execution,false);await f.tick();assert.equal(f.counts().postCount,0);assert.equal(f.counts().modelCount,0);
});
test('start, dispatch, confirm, continue and reach target only from correlated game results',async()=>{
 const f=fixture();await f.control('start');
 let state=await f.tick();assert.equal(state.phase,'confirming');assert.equal(state.pending.stages.sent,true);assert.equal(state.pending.stages.executed,null);assert.equal(state.steps,0);assert.equal(f.counts().postCount,1);
 f.step();state=await f.tick();assert.equal(state.phase,'running');assert.equal(state.steps,1);assert.equal(state.last_operation.stages.game_state_confirmed,true);assert.equal(state.last_operation.stages.response_captured,true);assert.equal(state.last_result.response.ephemeral,true);assert.equal(state.last_result.progress.xp_delta,1);assert.equal(f.counts().postCount,1);
 f.step();await f.tick();f.step();state=await f.tick();assert.equal(state.phase,'completed');assert.equal(state.snapshot.stats.level,20);assert.equal(state.steps,2);assert.equal(f.counts().postCount,2);await f.tick();assert.equal(f.counts().postCount,2);
});
test('concurrent ticks share an actual SQLite CAS lock and dispatch once',async()=>{
 const f=fixture();await f.control('start');await Promise.all([f.tick(),f.tick(),f.tick()]);assert.equal(f.counts().postCount,1);assert.equal((await f.read()).phase,'confirming');
});
test('pause while the model decides prevents dispatch; resume starts a fresh decision',async()=>{
 const f=fixture();await f.control('start');let release,entered;const started=new Promise(r=>entered=r);const decision=new Promise(r=>release=r);
 f.hooks.model=async(_model,input)=>{entered();await decision;return {response:JSON.stringify({action_id:JSON.parse(input.messages[1].content).allowed_actions[0].id})};};
 const job=f.tick();await started;await f.control('pause');release();await job;assert.equal(f.counts().postCount,0);assert.equal((await f.read()).phase,'paused');assert.equal((await f.read()).pending,null);
 delete f.hooks.model;await f.control('resume');await f.tick();assert.equal(f.counts().postCount,1);
});
test('stop during dispatch preserves operation ID; review confirms without starting another action',async()=>{
 const f=fixture();let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);await f.control('start');
 f.hooks.execute=async req=>{f.operations.set(req.operation_id,{...f.envelope,operation_id:req.operation_id,status:'completed',action_id:req.available_action_id,game_confirmed:true,snapshot:f.observation()});entered();await wait;return Response.json({...f.envelope,operation_id:req.operation_id,accepted:true});};
 const job=f.tick();await started;const before=(await f.read()).pending.id;await f.control('stop');release();await job;assert.equal((await f.read()).phase,'stopped');assert.equal((await f.read()).pending.id,before);
 f.step();const {data}=await f.control('review');assert.equal(data.state.phase,'stopped');assert.equal(data.state.steps,1);assert.equal(data.state.pending,null);assert.equal(f.counts().postCount,1);
});
test('uncertain transport is never retried, including after restart/resume',async()=>{
 const f=fixture();await f.control('start');f.hooks.execute=()=>{throw Error('timeout secret must not escape')};
 let state=await f.tick();assert.equal(state.phase,'uncertain');const id=state.pending.id;assert.equal(state.pending.stages.send_attempted,true);assert.equal(state.pending.stages.sent,null);assert.doesNotMatch(JSON.stringify(state),/timeout secret/);
 await f.control('resume');state=await f.tick();assert.equal(state.pending.id,id);assert.equal(state.phase,'uncertain');assert.equal(f.counts().postCount,1);assert.equal(f.counts().lookupCount,1);
});
test('429 on observation honors Retry-After without busy-polling or actions',async()=>{
 const f=fixture();await f.control('start');f.hooks.observe=()=>new Response('',{status:429,headers:{'retry-after':'120'}});
 const state=await f.tick();assert.equal(state.phase,'waiting');assert.equal(state.next_tick_at,f.now()+120000);await f.tick();f.step(119999);await f.tick();assert.equal(f.counts().observeCount,1);assert.equal(f.counts().postCount,0);
 f.step(2);delete f.hooks.observe;await f.tick();assert.equal(f.counts().postCount,1);
});
test('429 on dispatch retains the operation and only result lookup is allowed next',async()=>{
 const f=fixture();await f.control('start');f.hooks.execute=()=>new Response('',{status:429,headers:{'retry-after':'60'}});
 let state=await f.tick();const id=state.pending.id;assert.equal(state.phase,'confirming');assert.equal(state.next_tick_at,f.now()+60000);assert.equal(f.counts().postCount,1);
 f.step(60001);f.hooks.result=key=>Response.json({...f.envelope,operation_id:key,status:'unknown',reason:'Recebimento incerto.'});state=await f.tick();assert.equal(state.phase,'uncertain');assert.equal(state.pending.id,id);assert.equal(f.counts().postCount,1);
});
test('wrong character/grant, stale state and hallucinated actions cannot execute',async()=>{
 for(const kind of ['grant','character','stale','model']){
  const f=fixture();await f.control('start');
  if(kind==='grant')f.hooks.grant=()=>({...f.grant(),approval_reference:'unrelated'});
  if(kind==='character')f.hooks.observe=()=>Response.json(f.observation({owner_id:'697125041363615844'}));
  if(kind==='stale')f.hooks.observe=()=>Response.json(f.observation({observed_at:f.now()-70000}));
  if(kind==='model')f.hooks.model=()=>({response:JSON.stringify({action_id:'admin:level20'})});
  await f.tick();assert.equal(f.counts().postCount,0,kind);assert.ok(['blocked','failed'].includes((await f.read()).phase),kind);
 }
});
test('a result for a different action or owner cannot increase level',async()=>{
 for(const wrong of ['action','owner']){
  const f=fixture();await f.control('start');await f.tick();f.step();
  f.hooks.result=id=>Response.json({...f.operations.get(id),...(wrong==='action'?{action_id:'not-the-requested-action'}:{owner_id:'697125041363615844'}),snapshot:f.observation({stats:{level:20,xp:99999}})});
  const state=await f.tick();assert.equal(state.phase,'uncertain');assert.equal(state.steps,0);assert.equal(state.snapshot.stats.level,11);assert.equal(state.last_result,null);
 }
});
test('the same semantic action at the same state revision is not repeated',async()=>{
 const f=fixture();await f.control('start');await f.tick();
 const state=await f.read();const op=f.operations.get(state.pending.id);op.snapshot=f.observation({revision:'state-0'});
 f.step();await f.tick();f.step();f.hooks.observe=()=>Response.json(f.observation({revision:'state-0',available_actions:[f.action({id:'new-id',state_revision:'state-0'})]}));
 const final=await f.tick();assert.equal(final.phase,'failed');assert.equal(final.code,'no_safe_action');assert.equal(f.counts().postCount,1);
});
test('combat requires known turn/enemy/rules/resources; unsafe actions never reach the model',()=>{
 const f=fixture(),grant=validateGrant(f.grant(),f.env,owner,f.now());
 const raw=f.observation({combat:{active:true,own_turn:true,enemy_known:true,rules_known:true},available_actions:[f.action({kind:'combat',semantic_key:'combat:defend'})]});
 const obs=validateObservation(raw,grant,f.now());assert.equal(permittedActions(obs,grant,[],f.now()).length,1);
 for(const partial of [{own_turn:false},{enemy_known:false},{rules_known:false}])assert.equal(permittedActions({...obs,combat:{...obs.combat,...partial}},grant,[],f.now()).length,0);
 assert.equal(permittedActions({...obs,stats:{...obs.stats,hp:{current:10,max:100}}},grant,[],f.now()).length,0);
 assert.equal(permittedActions({...obs,available_actions:[{...obs.available_actions[0],cost:{chakra:999,energy:0}}]},grant,[],f.now()).length,0);
 const admin=validateObservation(f.observation({available_actions:[f.action({kind:'admin'})]}),grant,f.now());assert.equal(admin.available_actions.length,0);
});
test('authoritative historical result can be recovered, but next decision still observes fresh state',async()=>{
 const f=fixture();await f.control('start');await f.tick();f.step(120000);const state=await f.tick();assert.equal(state.steps,1);assert.equal(state.phase,'running');assert.equal(f.counts().observeCount,1);
 f.step();await f.tick();assert.equal(f.counts().observeCount,2);
});
test('reply actions require a specific message and reject mentions, links and slash text',async()=>{
 for(const reply of ['@everyone oi','https://example.com','/combate iniciar']){
  const f=fixture();await f.control('start');f.hooks.observe=()=>Response.json(f.observation({available_actions:[f.action({kind:'reply',reply_to:'1564255220412711052'})]}));f.hooks.model=()=>({response:JSON.stringify({action_id:f.action().id,reply_text:reply})});
  const state=await f.tick();assert.equal(state.code,'invalid_reply');assert.equal(f.counts().postCount,0);
 }
 const f=fixture();await f.control('start');f.hooks.observe=()=>Response.json(f.observation({available_actions:[f.action({kind:'reply',reply_to:'1564255220412711052'})]}));f.hooks.model=()=>({response:JSON.stringify({action_id:f.action().id,reply_text:'Bora conferir a missão, mano.'})});let body;
 f.hooks.execute=req=>{body=req;return Response.json({...f.envelope,operation_id:req.operation_id,accepted:true});};await f.tick();assert.equal(body.reply_text,'Bora conferir a missão, mano.');assert.equal(body.available_action_id,f.action().id);
});
test('owner/origin, body size and stale revision checks protect controls',async()=>{
 const f=fixture();let res=await autoplayRoute(f.request('start',0),f.env,{me:{id:'697125041363615844',membership:{member:true}}},{reply:f.reply,baseUrl});assert.equal(res.status,403);
 res=await autoplayRoute(new Request(baseUrl+'/mobile/discord2/api/autoplay',{method:'POST',headers:{origin:'https://other.example','content-type':'application/json'},body:'{}'}),f.env,f.ctx,{reply:f.reply,baseUrl});assert.equal(res.status,403);
 await f.control('start');res=await autoplayRoute(f.request('start',0),f.env,f.ctx,{reply:f.reply,baseUrl});assert.equal(res.status,409);assert.equal((await f.read()).phase,'running');
 res=await autoplayRoute(f.request('start',1,{goal:'a'.repeat(3000)}),f.env,f.ctx,{reply:f.reply,baseUrl});assert.equal(res.status,400);
});
test('bounded JSON and Retry-After dates fail closed without leaking response bodies',async()=>{
 await assert.rejects(()=>boundedJson(new Response('x'.repeat(999)),100),/limite/);
 await assert.rejects(()=>boundedJson(new Response('<html>not json</html>')),/JSON válido/);
 const now=Date.parse('2026-10-26T10:00:00Z');assert.equal(retryAt('Mon, 26 Oct 2026 10:02:00 GMT',now),now+120000);assert.equal(retryAt('30',now),now+30000);
});
test('scheduler is inert until explicitly configured; memory survives a fresh controller read',async()=>{
 const f=fixture();await f.control('start');await scheduledAutoplay(f.env);assert.equal(f.counts().postCount,0);await f.tick();const pending=(await f.read()).pending.id;
 const newEnv={...f.env};assert.equal((await readAutoplay(newEnv,owner)).state.pending.id,pending);
});
test('activation action cap pauses after confirmed actions rather than paying for an unbounded loop',async()=>{
 const f=fixture();await f.control('start');await changeAutoplay(f.env,owner,d=>{d.max_steps=1;return d;},{now:f.now});await f.tick();f.step();const state=await f.tick();assert.equal(state.phase,'paused');assert.equal(state.steps,1);await f.tick();assert.equal(f.counts().postCount,1);
});


test('review never dispatches a new action; stale pause still takes priority',async()=>{
 const f=fixture();await f.control('start');await f.control('review');assert.equal(f.counts().postCount,0);
 const res=await autoplayRoute(f.request('pause',0),f.env,f.ctx,{reply:f.reply,baseUrl,now:f.now});assert.equal(res.status,200);assert.equal((await f.read()).phase,'paused');
});
