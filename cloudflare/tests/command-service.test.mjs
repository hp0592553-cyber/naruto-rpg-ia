import test from 'node:test';
import assert from 'node:assert/strict';
import {commandServiceMobile,commandServiceRunner} from '../command-service.mjs';
const owner='481485837801095178',channel='1520114348079583263',bot='1515908078913192026';
const token='synthetic-executor-token-for-tests-only-123456789';
const ctx={me:{id:owner,membership:{member:true}}};
const helpers={baseUrl:'https://example.test',seal:async x=>x,unseal:async x=>x,normalize:m=>m};
function fixture(){const rows=new Map();return {rows,env:{BUSHIN_OWNER_DISCORD_ID:owner,BUSHIN_EXECUTOR_TOKEN:token,DB:{prepare(sql){let a;return {bind(...x){a=x;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let changes=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);changes=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);changes=1}return {meta:{changes}}}}}}}}}
const req=(path,data,auth=true)=>new Request('https://example.test'+path,{method:'POST',headers:{origin:'https://example.test','content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
const command={command:'/perfil ver',channel_id:channel,options:{}};
const poll=(env)=>commandServiceRunner(req('/bridge/commands/poll',{owner_id:owner,ready:true}),env,helpers);
test('offline or unauthenticated executors cannot receive jobs',async()=>{
 const {env}=fixture();assert.equal((await commandServiceRunner(req('/bridge/commands/poll',{},false),env,helpers)).status,401);
 assert.equal((await commandServiceMobile(req('/api',{action:'start',command_request:command}),env,ctx,helpers)).status,503);
});
test('concurrent claims execute once; results must match author and channel; replay is idempotent',async()=>{
 const {env}=fixture();await poll(env);
 const mobile=()=>commandServiceMobile(req('/api',{action:'start',command_request:command}),env,ctx,helpers);
 const attempts=await Promise.all([mobile(),mobile()]);assert.equal(attempts.filter(r=>r.status===200).length,1);
 const claims=await Promise.all([poll(env),poll(env)]);const jobs=await Promise.all(claims.map(r=>r.json()));assert.equal(jobs.filter(x=>x.job).length,1);
 const job=jobs.find(x=>x.job).job;
 const response={message_id:'1564274391158751294',author_id:bot,channel_id:channel,components:[{type:10,content:'Private response'}],embeds:[]};
 const send=m=>commandServiceRunner(req('/bridge/commands/result',{request_id:job.request_id,response:m}),env,helpers);
 assert.equal((await send({...response,channel_id:owner})).status,400);
 assert.equal((await send(response)).status,200);assert.equal((await send(response)).status,200);
 const result=await (await commandServiceMobile(new Request('https://example.test/api'),env,ctx,helpers)).json();
 assert.equal(result.confirmed,true);assert.equal(result.response.message_id,response.message_id);
 const stale={command:'/component',channel_id:channel,options:{message_id:'1564274391158751295',custom_id:'missing',values:'[]'}};
 assert.equal((await commandServiceMobile(req('/api',{action:'start',command_request:stale}),env,ctx,helpers)).status,409);
});
test('stopping a queued job prevents claiming it',async()=>{
 const {env}=fixture();await poll(env);
 await commandServiceMobile(req('/api',{action:'start',command_request:command}),env,ctx,helpers);
 await commandServiceMobile(req('/api',{action:'stop'}),env,ctx,helpers);
 assert.equal((await (await poll(env)).json()).job,null);
});
test('Stop cancels a claimed v3 job before authorization; no new send grant is issued',async()=>{
 const {env}=fixture();await poll(env);
 await commandServiceMobile(req('/api',{action:'start',command_request:command}),env,ctx,helpers);
 const claim=await (await commandServiceRunner(req('/bridge/commands/poll',{owner_id:owner,ready:true,version:3,instance_id:'runner-A'}),env,helpers)).json();
 assert.ok(claim.job);
 assert.equal((await (await commandServiceMobile(req('/api',{action:'stop'}),env,ctx,helpers)).json()).stopped,true);
 const granted=await (await commandServiceRunner(req('/bridge/commands/authorize',{request_id:claim.job.request_id}),env,helpers)).json();
 assert.equal(granted.authorized,false);
});
test('authorization is one-shot; Stop preserves in-flight action and archived result survives a newer job',async()=>{
 const {env}=fixture();await poll(env);
 const start=async()=> (await commandServiceMobile(req('/api',{action:'start',command_request:command}),env,ctx,helpers)).json();
 const job=await start();await poll(env);
 const grant=()=>commandServiceRunner(req('/bridge/commands/authorize',{request_id:job.request_id}),env,helpers);
 assert.equal((await (await grant()).json()).authorized,true);
 assert.equal((await (await grant()).json()).authorized,false);
 assert.equal((await (await commandServiceMobile(req('/api',{action:'stop'}),env,ctx,helpers)).json()).stopped,false);
 const response={message_id:'1564274391158751294',author_id:bot,channel_id:channel,components:[{type:10,content:'Confirmed old result'}],embeds:[]};
 await commandServiceRunner(req('/bridge/commands/result',{request_id:job.request_id,response}),env,helpers);
 const newer=await start();assert.notEqual(newer.request_id,job.request_id);
 const old=await (await commandServiceMobile(new Request('https://example.test/api?request_id='+job.request_id),env,ctx,helpers)).json();
 assert.equal(old.request_id,job.request_id);assert.equal(old.confirmed,true);assert.equal(old.response.message_id,response.message_id);
});
test('lost legacy claimed action becomes uncertain, never requeued, and can receive a late result',async()=>{
 const {env,rows}=fixture();
 const request_id=crypto.randomUUID();rows.set('discord2_service_job_v1',JSON.stringify({request_id,request:command,phase:'claimed',at:Date.now()-200000,claimed_at:Date.now()-190000,protocol:2}));
 let result=await (await commandServiceMobile(new Request('https://example.test/api'),env,ctx,helpers)).json();assert.equal(result.state,'uncertain');
 assert.equal(JSON.parse(rows.get('discord2_service_job_v1')).phase,'uncertain');
 await commandServiceRunner(req('/bridge/commands/result',{request_id,response:{message_id:'1564274391158751294',author_id:bot,channel_id:channel,components:[{type:10,content:'Late response'}],embeds:[]}}),env,helpers);
 result=await (await commandServiceMobile(new Request('https://example.test/api?request_id='+request_id),env,ctx,helpers)).json();assert.equal(result.confirmed,true);
});
test('a renewed executor cannot click controls captured by an earlier process',async()=>{
 for(const executor_id of ['runner-A','']){
 const {env,rows}=fixture();await commandServiceRunner(req('/bridge/commands/heartbeat',{owner_id:owner,ready:true,version:3,instance_id:'runner-B'}),env,helpers);
 const response={message_id:'1564274391158751294',channel_id:channel,controls:[{type:2,custom_id:'real-button'}]};
 rows.set('discord2_service_job_v1',JSON.stringify({request_id:crypto.randomUUID(),request:command,phase:'finished',confirmed:true,executor_id,sealed:{response}}));
 const state=await (await commandServiceMobile(new Request('https://example.test/api'),env,ctx,helpers)).json();assert.equal(state.controls_current,false);
 const r=await commandServiceMobile(req('/api',{action:'start',command_request:{command:'/component',channel_id:channel,options:{message_id:response.message_id,custom_id:'real-button',values:'[]'}}}),env,ctx,helpers);
 assert.equal(r.status,409);
 }
});
