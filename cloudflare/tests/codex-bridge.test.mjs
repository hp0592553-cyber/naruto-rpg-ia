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
