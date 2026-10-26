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
