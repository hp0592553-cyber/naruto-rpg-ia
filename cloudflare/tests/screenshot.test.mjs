import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCall} from '../browser-bridge.mjs';
const owner='481485837801095178';
function environment({session=true,busy=0,changes=1}={}) {
 const queries=[];
 return {queries,env:{BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(sql){
  return {bind(...args){queries.push({sql,args});return this;},async first(){
   return sql.includes('COUNT')?{n:busy}:session?{run_id:'12345678901',last_seen:Date.now()}:null;
  },async run(){return {meta:{changes}};}};
 }}}};
}
test('screenshot uses D1 and reports disconnected without demanding a GitHub Secret',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected network');});
 const {env,queries}=environment({session:false});
 const r=await browserCall(env,'bushin_browser_action',{action:'screenshot'});
 assert.equal(r.state,'unavailable');assert.match(r.reason,/navegador conectado/);
 assert.ok(!r.reason.includes('BUSHIN_GITHUB_TOKEN'));assert.ok(!queries.some(q=>q.sql.startsWith('INSERT')));
});
test('active D1 screenshot is queued once, never described as captured',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected network');});
 const {env,queries}=environment();
 const r=await browserCall(env,'bushin_browser_action',{action:'screenshot'});
 assert.equal(r.state,'queued');assert.equal(r.action,'screenshot');
 const resultSchema=(await import('../browser-bridge.mjs')).BROWSER_TOOLS.find(t=>t.name==='bushin_browser_result').inputSchema;
 assert.match(r.command_id,new RegExp(resultSchema.properties.command_id.pattern));
 assert.equal(r.session_id,'12345678901');assert.equal(r.data,undefined);
 const inserts=queries.filter(q=>q.sql.startsWith('INSERT'));assert.equal(inserts.length,1);
 assert.equal(inserts[0].args[1],'screenshot');assert.equal(inserts[0].args[2],'{"action":"screenshot"}');
});
test('full queue and expired session do not claim a screenshot',async()=>{
 for(const cfg of [{busy:3},{changes:0}]){
  const {env}=environment(cfg);
  const r=await browserCall(env,'bushin_browser_action',{action:'screenshot'});
  assert.equal(r.state,'unavailable');assert.equal(r.command_id,undefined);
 }
});
