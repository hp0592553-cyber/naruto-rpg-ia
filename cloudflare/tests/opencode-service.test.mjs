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
test('OpenCode decision is returned as a plan and never counted as Discord execution',async()=>{
 const {env,rows}=fixture();rows.set('discord2_autoplay_v1',JSON.stringify({version:1,owner_id:owner,revision:0,history:[],phase:'running',run_id:'active'}));
 const heartbeat=()=>commandServiceRunner(req('/bridge/commands/poll',{owner_id:owner,ready:true,version:4,instance_id:'executor'}),env,helpers);await heartbeat();
 const start=await commandServiceMobile(req('/api',{action:'start',run_id:'active',command_request:{command:'/agent-plan',channel_id:channel,options:{context:'{"commands":[]}'}}}),env,ctx,helpers);assert.equal(start.status,200);
 const {job}=await (await heartbeat()).json();assert.equal(job.command,'/agent-plan');
 const result=await commandServiceRunner(req('/bridge/commands/result',{request_id:job.request_id,brain:{provider:'opencode',model:'test-model',plan:{command:'/mapa',options:{},channel_id:channel}}}),env,helpers);assert.equal(result.status,200);
 const seen=await (await commandServiceMobile(new Request('https://example.test/api'),env,ctx,helpers)).json();assert.equal(seen.executed,false);assert.equal(seen.response,undefined);assert.equal(seen.brain.plan.command,'/mapa');
});
