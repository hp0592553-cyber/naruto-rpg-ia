import test from 'node:test';
import assert from 'node:assert/strict';
import {playerCommands,playerRoute,forestControl,travelArrival,ownComponentOptions} from '../player-loop.mjs';
const owner='481485837801095178',bot='1515908078913192026',channel='1520114348079583263';
test('player catalog excludes admin and foreign applications',()=>{
 const c=playerCommands([{application_id:bot,name:'missoes',options:[{type:1,name:'ativas'}]},{application_id:bot,name:'admin'},{application_id:'123',name:'nivel'}]);
 assert.deepEqual(c.map(x=>x.command),['/missoes ativas']);
});
test('player queues a correlated query, stop prevents further actions, unconfirmed responses are not success',async()=>{
 const rows=new Map(),env={BUSHIN_OWNER_DISCORD_ID:owner,BUSHIN_EXECUTOR_TOKEN:'test-executor-credential-placeholder-123456789012345',DB:{prepare(sql){let a;return {bind(...v){a=v;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let n=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);n=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);n=1}return {meta:{changes:n}}}}}}};
 rows.set('discord2_service_heartbeat_v1',JSON.stringify({at:Date.now(),version:2}));
 rows.set('discord2_catalog_cache_v7',JSON.stringify({at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]}]}));
 const ctx={me:{id:owner,membership:{member:true}}},baseUrl='https://example.test';
 const helpers={reply:(v,s)=>Response.json(v,{status:s}),baseUrl,seal:async x=>x,unseal:async x=>x};
 const call=async data=>{let req=data?new Request(baseUrl+'/mobile/discord2/api/autoplay',{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}):new Request(baseUrl+'/mobile/discord2/api/autoplay');return (await playerRoute(req,env,ctx,helpers)).json()};
 let r=await call();r=await call({action:'start',revision:r.state.revision});
 r=await call({action:'tick',revision:r.state.revision});assert.equal(r.state.phase,'confirming');assert.equal(r.state.pending.action.command,'/perfil ver');
 const job=JSON.parse(rows.get('discord2_service_job_v1'));assert.equal(job.request_id,r.state.pending.id);
 r=await call({action:'stop',revision:r.state.revision});assert.equal(r.state.phase,'stopped');
 const revision=r.state.revision;r=await call({action:'tick',revision});assert.equal(r.state.revision,revision);assert.equal(r.state.steps,0);
});

test('forest destination supports real buttons and selects, excludes disabled and links',()=>{
 assert.deepEqual(forestControl([{type:2,label:'Floresta e Rio · 4 min',custom_id:'real-id'}]),{control:{type:2,label:'Floresta e Rio · 4 min',custom_id:'real-id'},values:[]});
 assert.equal(forestControl([{type:2,label:'Floresta',disabled:true},{type:2,label:'Floresta',url:'https://example.test'}]),null);
 assert.deepEqual(forestControl([{type:3,options:[{label:'Floresta',value:'actual-value'}]}]).values,['actual-value']);
});

test('wait uses only an explicit game arrival timestamp',()=>{
 assert.equal(travelArrival('Viagem iniciada\nChegada automática <t:1793030908:F> • <t:1793030908:R>'),1793030908000);
 assert.equal(travelArrival('Central de Viagem: 4 min'),null);
 assert.equal(travelArrival('Outro evento <t:1793030908:F>'),null);
});

test('component envelope comes from own real response, rejects foreign messages and controls',()=>{
 const last={message_id:'own-message',controls:[{type:2,custom_id:'actual-button'}]};
 assert.deepEqual(ownComponentOptions({},last),{message_id:'own-message',custom_id:'actual-button',values:'[]'});
 assert.throws(()=>ownComponentOptions({custom_id:'invented'},last));
 assert.throws(()=>ownComponentOptions({message_id:'foreign-message'},last));
});
