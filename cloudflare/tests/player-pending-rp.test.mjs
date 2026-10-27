import test from 'node:test';
import assert from 'node:assert/strict';
import {playerRoute,reconcileUnconfirmedPlayerResult} from '../player-loop.mjs';
import {initialAutoplay} from '../autoplay-store.mjs';
import {AUTOPLAY_JS} from '../autoplay-ui.mjs';

const OWNER='481485837801095178',CMD='1520114348079583263',RIO='1515881122179842113',PID='f65747dd-a583-446b-8308-f4e01cc553b5';
const reply=(payload,status=200)=>Response.json(payload,{status});
const ctx={me:{id:OWNER,membership:{member:true}}},origin='https://example.test';
function fixture(jobPhase='finished',confirmed=false){
 const data=new Map();
 const state={...initialAutoplay(OWNER),revision:4,phase:'paused',context_channel_id:CMD,reason:'O resultado ainda não foi confirmado.',pending:{id:PID,action:{label:'/acao coletar',command:'/acao coletar',channel_id:CMD},stages:{requested:true,sent:false}}};
 data.set('discord2_autoplay_v1',JSON.stringify(state));
 data.set('discord2_service_job_v1',JSON.stringify({request_id:PID,request:{command:'/acao coletar',channel_id:CMD},phase:jobPhase,confirmed,at:Date.now()-6000,finished_at:Date.now()-5000}));
 let channelCalls=0,readCalls=0;
 const env={BUSHIN_OWNER_DISCORD_ID:OWNER,DISCORD_USER_TOKEN:'synthetic-test-credential-123456789012345678901234',DB:{prepare(sql){let a;return {bind(...args){a=args;return this},async first(){const val=data.get(a[1]);return val?{value_json:val}:null},async run(){let changes=0;if(sql.startsWith('UPDATE')){if(data.get(a[3])===a[4]){data.set(a[3],a[0]);changes=1}}else if(!data.has(a[1])){data.set(a[1],a[2]);changes=1}return {meta:{changes}}}}}}};
 const helpers={reply,baseUrl:origin,listChannels:async()=>{channelCalls++;return {listed:true,visibility_filtered:true,channels:[{id:CMD,name:'Comandos',type:0},{id:RIO,name:'Rio',type:0}]}},readChat:async()=>{readCalls++;return {read:true,messages:[]}}};
 async function invoke(action,channel=RIO){
  const current=JSON.parse(data.get('discord2_autoplay_v1'));
  const req=new Request(origin+'/mobile/discord2/api/autoplay',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,revision:current.revision,channel_id:channel})});
  const response=await playerRoute(req,env,ctx,helpers);
  return {status:response.status,data:await response.json()};
 }
 return {data,invoke,counters:()=>({channelCalls,readCalls})};
}

test('definitively finished yet unconfirmed operation becomes paused and marked uncertain, without any new command',async()=>{
 const f=fixture('finished',false);
 const response=await f.invoke('review');
 assert.equal(response.status,200);
 const state=response.data.state;
 assert.equal(state.pending,null);
 assert.equal(state.phase,'paused');
 assert.equal(state.run_id,null);
 assert.equal(state.code,'unconfirmed_result');
 assert.equal(state.uncertain_actions.length,1);
 assert.equal(state.uncertain_actions[0].command,'/acao coletar');
 assert.equal(state.last_operation.id,PID);
 assert.equal(state.history.at(-1).operation_id,PID);
 assert.match(state.reason,/não vou repeti-la automaticamente/);
 assert.equal(f.counters().channelCalls,0);
 const twice=await f.invoke('review');
 assert.equal(twice.status,200);
 assert.equal(twice.data.state.uncertain_actions.length,1);
});
test('still-queued operation is not cleared and does not permit duplicate submissions',async()=>{
 const f=fixture('queued');
 const response=await f.invoke('review');
 assert.equal(response.status,200);
 assert.equal(response.data.state.pending.id,PID);
 assert.equal(response.data.state.uncertain_actions,undefined);
});
test('read-only channel inspection can run with a pending game command without switching its context',async()=>{
 const f=fixture('finished',false);
 const result=await f.invoke('check_channel');
 assert.equal(result.status,200);
 assert.equal(result.data.state.context_channel_id,CMD);
 assert.equal(result.data.state.pending.id,PID);
 assert.equal(result.data.state.channel_check.requested_id,RIO);
 assert.equal(result.data.state.channel_check.read_verified,true);
 assert.deepEqual(f.counters(),{channelCalls:1,readCalls:1});
});
test('mismatched operation IDs never clear pending state',()=>{
 const state={...initialAutoplay(OWNER),pending:{id:PID,action:{command:'/acao coletar',channel_id:CMD}}};
 assert.throws(()=>reconcileUnconfirmedPlayerResult(state,state.pending,{state:'finished',request_id:'different',command:'/acao coletar',confirmed:false}),/não corresponde/);
 assert.equal(state.pending.id,PID);
});
test('Android start checks the old result before the channel, and does not auto-resend',()=>{
 const review=AUTOPLAY_JS.indexOf('action:"review",revision:current.state.revision');
 const verify=AUTOPLAY_JS.indexOf('action:"check_channel",revision:current.state.revision');
 assert.ok(review>=0&&verify>review);
 assert.match(AUTOPLAY_JS,/if\(current\.state\.pending\)throw Error\(/);
});
