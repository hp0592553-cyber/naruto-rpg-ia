import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {playerRoute} from '../player-loop.mjs';
import {commandServiceRunner} from '../command-service.mjs';
import {normalizeMessage} from '../message-normalizer.mjs';
const owner='481485837801095178',channel='1520114348079583263',bot='1515908078913192026';
function fixture(t,readChat=async()=>({read:true,messages:[]}),extra={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE bushin_project_state (owner_id TEXT,key TEXT,value_json TEXT,updated_at INTEGER,PRIMARY KEY(owner_id,key))');
 const token='synthetic-executor-token-for-tests-only-123456789';
 const env={BUSHIN_OWNER_DISCORD_ID:owner,BUSHIN_EXECUTOR_TOKEN:token,DB:{prepare(sql){
  let args;
  return {bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async run(){return {meta:db.prepare(sql).run(...args)}}};
 }}};
 const put=(key,value)=>db.prepare('INSERT OR REPLACE INTO bushin_project_state VALUES (?,?,?,?)').run(owner,key,JSON.stringify(value),Date.now());
 const get=key=>JSON.parse(db.prepare('SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?').get(owner,key)?.value_json||'null');
 put('discord2_service_heartbeat_v1',{at:Date.now(),version:3,instance_id:'test-runner'});
 put('discord2_catalog_cache_v7',{at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]}]});
 const baseUrl='https://example.test',ctx={me:{id:owner,membership:{member:true}}};
 const helpers={baseUrl,reply:(v,s)=>Response.json(v,{status:s}),seal:async x=>x,unseal:async x=>x,normalize:normalizeMessage,readChat,learn:async()=>({initial:false,evidence:[]}),...extra};
 const call=async data=>(await playerRoute(new Request(baseUrl+'/mobile/discord2/api/autoplay',data?{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}:{}),env,ctx,helpers)).json();
 const runner=async(path,data)=>(await commandServiceRunner(new Request(baseUrl+'/bridge/commands/'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)}),env,helpers)).json();
 return {env,call,runner,put,get};
}
test('real SQLite: stop during observation fences a later command decision',async t=>{
 let release,entered;const observing=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
 const f=fixture(t,async()=>{entered();await gate;return {read:true,messages:[]}});
 let r=await f.call();r=await f.call({action:'start',revision:r.state.revision});
 const ticking=f.call({action:'tick',revision:r.state.revision});await observing;
 const stopped=await f.call({action:'stop',revision:0});assert.equal(stopped.state.phase,'stopped');
 release();r=await ticking;assert.equal(r.state.phase,'stopped');assert.equal(f.get('discord2_service_job_v1'),null);
});
test('real SQLite: player command is claimed once, Stop wins before the send grant',async t=>{
 const f=fixture(t);let r=await f.call();r=await f.call({action:'start',revision:r.state.revision});r=await f.call({action:'tick',revision:r.state.revision});
 const id=r.state.pending.id;
 const claim=await f.runner('poll',{owner_id:owner,ready:true,version:3,instance_id:'test-runner'});assert.equal(claim.job.request_id,id);
 await f.call({action:'stop',revision:0});
 assert.equal((await f.runner('authorize',{request_id:id})).authorized,false);
 assert.equal((await f.runner('poll',{owner_id:owner,ready:true,version:3,instance_id:'test-runner'})).job,null);
});
test('real SQLite: level target only completes from a correlated explicit profile field',async t=>{
 const f=fixture(t);let r=await f.call();r=await f.call({action:'start',revision:r.state.revision});r=await f.call({action:'tick',revision:r.state.revision});
 const id=r.state.pending.id;await f.runner('poll',{owner_id:owner,ready:true,version:3,instance_id:'test-runner'});await f.runner('authorize',{request_id:id});
 const response={message_id:'1564274391158751294',author_id:bot,channel_id:channel,components:[],embeds:[{fields:[{name:'Nível',value:'20'}]}],interaction_metadata:{user_id:owner}};
 assert.equal((await f.runner('result',{request_id:id,response})).saved,true);
 r=await f.call({action:'tick',revision:r.state.revision});assert.equal(r.state.phase,'completed');assert.equal(r.state.snapshot.stats.level,20);
 const revision=r.state.revision;r=await f.call({action:'tick',revision});assert.equal(r.state.revision,revision);
});
test('permission loss refreshes membership and navigates to a returned allowed route without sending',async t=>{
 const route='999999999999999999';let lists=0;
 const f=fixture(t,async()=>({read:false,code:403}),{listChannels:async()=>{lists++;return {listed:true,visibility_filtered:true,channels:[{id:route,name:'Caminho · fixture',type:0}]}}});
 let r=await f.call();r=await f.call({action:'start',revision:r.state.revision});r=await f.call({action:'tick',revision:r.state.revision});
 assert.equal(lists,1);assert.equal(r.state.phase,'waiting');assert.equal(r.state.context_channel_id,route);assert.equal(r.state.site_action.channel_id,route);assert.equal(f.get('discord2_service_job_v1'),null);
});
test('an old arrival does not require a forest channel or repeat travel; consults the real available map',async t=>{
 const f=fixture(t,async()=>({read:true,messages:[]}),{listChannels:async()=>({listed:true,visibility_filtered:true,channels:[{id:channel,name:'Comandos',type:0}]})});
 let r=await f.call();r=await f.call({action:'start',revision:r.state.revision});
 const state=f.get('discord2_autoplay_v1');state.completed_keys=['/perfil ver','/nivel','/missoes minhas','/missoes ativas'];state.player_observations=[{command:'/viajar',channel_id:channel,text:'Viagem iniciada. Chegada automática <t:1700000000:F>'}];
 f.put('discord2_autoplay_v1',state);
 f.put('discord2_catalog_cache_v7',{at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]},{application_id:bot,name:'mapa'}]});
 r=await f.call({action:'tick',revision:state.revision});assert.equal(r.state.phase,'confirming');assert.equal(r.state.pending.action.command,'/mapa');assert.equal(r.state.pending.action.channel_id,channel);assert.equal(r.state.pending.action.arrival_check,1700000000000);
 const job=f.get('discord2_service_job_v1');assert.equal(job.request.command,'/mapa');
});
