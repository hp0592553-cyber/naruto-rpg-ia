import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedCall} from '../advanced-suite.mjs';
const OWNER='481485837801095178', CHANNEL='1520114348079583263';
const ctx={me:{id:OWNER,membership:{member:true}}};
function environment(fail=false){return {BUSHIN_OWNER_DISCORD_ID:OWNER,DISCORD_USER_TOKEN:'synthetic-test-placeholder-not-a-real-secret',DB:{prepare(){return {bind(){return this},async first(){return null},async run(){if(fail)throw Error('simulated database failure');return {}}}}}};}
function network(t){const calls=[];t.mock.method(globalThis,'fetch',async(u,o)=>{calls.push({url:u,method:o.method});return Response.json(u.endsWith('/users/@me')?{id:OWNER}:o.method==='POST'?{id:'1563541599189733508',channel_id:CHANNEL,author:{id:OWNER}}:{guild_id:'1515877468299595919'});});return calls;}
test('existing send tool selects personal transport without publishing on confirmed:false',async t=>{
 const calls=network(t);const r=await advancedCall(environment(),'bushin_discord_send_message',{channel_id:CHANNEL,content:'Oi',confirmed:false},ctx);
 assert.equal(r.mode,'personal_user_token');assert.equal(r.state,'awaiting_confirmation');assert.equal(r.sent,false);assert.ok(calls.every(c=>c.method==='GET'));
});
for(const fail of [false,true])test('confirmed Discord delivery remains confirmed when tracking '+(fail?'fails':'succeeds'),async t=>{
 const calls=network(t);const r=await advancedCall(environment(fail),'bushin_discord_send_message',{channel_id:CHANNEL,content:'Oi',confirmed:true},ctx);
 assert.equal(r.sent,true);assert.equal(r.author_id,OWNER);assert.equal(r.message_id,'1563541599189733508');assert.equal(r.tracking_saved,!fail);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.ok(!JSON.stringify(r).includes(environment().DISCORD_USER_TOKEN));
});
