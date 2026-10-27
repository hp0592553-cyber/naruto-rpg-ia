import test from 'node:test';
import assert from 'node:assert/strict';
import {playerCommands,playerRoute,forestControl,travelArrival,ownComponentOptions,rulePlan} from '../player-loop.mjs';
const owner='481485837801095178',bot='1515908078913192026',channel='1520114348079583263';
test('personal player reports credential presence separately from executor readiness and official authorization',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(){return {bind(){return this},first:async()=>null}}}};
 const helpers={reply:(v,s)=>Response.json(v,{status:s}),baseUrl:'https://example.test'};
 const read=async()=>(await playerRoute(new Request(helpers.baseUrl+'/mobile/discord2/api/autoplay'),env,{me:{id:owner,membership:{member:true}}},helpers)).json();
 let result=await read();assert.equal(result.integration.configured,false);assert.match(result.integration.missing.join(' '),/DISCORD_USER_TOKEN/);assert.equal(result.integration.official_game_authorization,false);
 env.DISCORD_USER_TOKEN='synthetic-personal-credential-for-tests-only-123456789';
 result=await read();assert.equal(result.integration.configured,true);assert.equal(result.integration.executor_online,false);assert.equal(result.integration.identity_verified,false);assert.equal(result.integration.personal_account_automation,true);
});
test('player catalog excludes admin and foreign applications',()=>{
 const c=playerCommands([{application_id:bot,name:'missoes',options:[{type:1,name:'ativas'}]},{application_id:bot,name:'admin'},{application_id:'123',name:'nivel'}]);
 assert.deepEqual(c.map(x=>x.command),['/missoes ativas']);
});
test('player queues a correlated query, stop prevents further actions, unconfirmed responses are not success',async()=>{
 const rows=new Map(),env={BUSHIN_OWNER_DISCORD_ID:owner,BUSHIN_EXECUTOR_TOKEN:'test-executor-credential-placeholder-123456789012345',DB:{prepare(sql){let a;return {bind(...v){a=v;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let n=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);n=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);n=1}return {meta:{changes:n}}}}}}};
 rows.set('discord2_service_heartbeat_v1',JSON.stringify({at:Date.now(),version:4}));
  rows.set('discord2_catalog_cache_v7',JSON.stringify({at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]}]}));
  env.DISCORD_USER_TOKEN='synthetic-personal-credential-for-tests-only-123456789';
 env.BUSHIN_AI={async run(_model,args){const input=JSON.parse(args.messages[1].content);const next=input.commands.find(x=>x.command==='/perfil ver');return {response:JSON.stringify(next?{command:next.command,channel_id:next.channel_id,options:{}}:{command:'',reason:'Sem comando verificado'})}}};
 const ctx={me:{id:owner,membership:{member:true}}},baseUrl='https://example.test';
 const helpers={reply:(v,s)=>Response.json(v,{status:s}),baseUrl,readChat:async()=>({read:true,messages:[]}),listChannels:async()=>({listed:true,visibility_filtered:true,channels:[{id:channel,name:'Comandos',type:0}]}),seal:async x=>x,unseal:async x=>x};
 const call=async data=>{let req=data?new Request(baseUrl+'/mobile/discord2/api/autoplay',{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}):new Request(baseUrl+'/mobile/discord2/api/autoplay');return (await playerRoute(req,env,ctx,helpers)).json()};
 let r=await call();r=await call({action:'start',revision:r.state.revision});
 r=await call({action:'tick',revision:r.state.revision});assert.equal(r.state.phase,'confirming',JSON.stringify({reason:r.state.reason,brain:r.state.brain,code:r.state.code}));assert.equal(r.state.pending.action.command,'/perfil ver');
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

test('chat pipeline resolves the real author, reserves once and confirms delivery',async()=>{
 const rows=new Map();
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(sql){let a;return {bind(...v){a=v;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let n=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);n=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);n=1}return {meta:{changes:n}}}}}},BUSHIN_AI:{async run(){return {response:JSON.stringify({text:'Já cheguei na Floresta.'})}}}};
 rows.set('discord2_service_heartbeat_v1',JSON.stringify({at:Date.now(),version:4}));
  const author='123456789012345678',mid='234567890123456789',sends=[];
  env.DISCORD_USER_TOKEN='synthetic-personal-credential-for-tests-only-123456789';
 const helpers={reply:(v,s)=>Response.json(v,{status:s}),baseUrl:'https://example.test',unseal:async x=>x,
 readChat:async()=>({read:true,messages:[{id:mid,author_id:author,timestamp:new Date(Date.now()+100).toISOString(),mentions:[{id:owner}],content:'Chegou?'}]}),
 sendChat:async(_e,_n,args)=>{sends.push(args);return {sent:true,message_id:'345678901234567890'}}};
 const ctx={me:{id:owner,membership:{member:true}}};
 const call=async data=>(await playerRoute(new Request(helpers.baseUrl+'/mobile/discord2/api/autoplay',data?{method:'POST',headers:{origin:helpers.baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}:{}),env,ctx,helpers)).json();
 let r=await call();r=await call({action:'start',revision:r.state.revision,channel_id:channel});r=await call({action:'tick',revision:r.state.revision});
 assert.equal(r.state.brain.provider,'workers-ai');assert.equal(rows.has('discord2_service_job_v1'),false);
 assert.equal(sends.length,1);assert.equal(sends[0].reply_to,mid);assert.deepEqual(sends[0].mention_ids,[author]);assert.equal(sends[0].text,'<@'+author+'> Já cheguei na Floresta.');assert.equal(r.state.last_chat_reply.id,'345678901234567890');assert.deepEqual(r.state.reserved_reply_ids,[mid]);
 r=await call({action:'tick',revision:r.state.revision});assert.equal(sends.length,1);
});

test('local rules only choose verified, unseen commands and can navigate',()=>{
 const available=[{command:'/missoes minhas',options:[]},{command:'/mapa',options:[]},{command:'/viajar',options:[]},{command:'/navigate',options:[]}];
 const channels=[{id:channel,name:'Comandos',type:0},{id:'999999999999999999',name:'Caminho · Floresta',type:0}];
 let plan=rulePlan({available,observations:[],contextChannel:channel,channels,gate:{id:channel,name:'Portão de Konoha'}});
 assert.equal(plan.command,'/missoes minhas');
 plan=rulePlan({available,observations:[{command:'/missoes minhas',channel_id:channel,text:''}],contextChannel:channel,channels,gate:{id:channel,name:'Portão de Konoha'}});
 assert.equal(plan.command,'/viajar');
 const nav=rulePlan({available:available.filter(x=>x.command!=='/viajar'),observations:[{command:'/missoes minhas',channel_id:channel,text:''},{command:'/mapa',channel_id:channel,text:''}],contextChannel:channel,channels});
 assert.equal(nav,null); // Sem navegação automática para um canal não verificado.
 assert.equal(rulePlan({available:available.filter(x=>x.command==='/missoes minhas'),observations:[{command:'/missoes minhas',channel_id:channel,text:''}],contextChannel:channel,channels:[channels[0]]}),null);
});
test('Workers AI indisponível não inventa comandos ou cria plano OpenCode',async()=>{
 const rows=new Map();
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-personal-credential-for-tests-only-123456789',DB:{prepare(sql){let a;return {bind(...v){a=v;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let n=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);n=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);n=1}return {meta:{changes:n}}}}}}};
 rows.set('discord2_service_heartbeat_v1',JSON.stringify({at:Date.now(),version:4,instance_id:'test-runner'}));
 rows.set('discord2_catalog_cache_v7',JSON.stringify({at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]},{application_id:bot,name:'mapa'}]}));
 const baseUrl='https://example.test',ctx={me:{id:owner,membership:{member:true}}};
 const helpers={baseUrl,reply:(v,s)=>Response.json(v,{status:s}),seal:async x=>x,unseal:async x=>x,readChat:async()=>({read:true,messages:[]}),learn:async()=>({initial:false,evidence:[]}),listChannels:async()=>({listed:true,visibility_filtered:true,channels:[{id:channel,name:'Comandos',type:0}]})};
 const call=async data=>(await playerRoute(new Request(baseUrl+'/mobile/discord2/api/autoplay',data?{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}:{}),env,ctx,helpers)).json();
 let r=await call();
 // Seed an experienced run so the next decision comes from the planner, not the first-run seed.
 rows.set('discord2_autoplay_v1',JSON.stringify({...r.state,player_observations:[{command:'/perfil ver',channel_id:channel,text:'Nível 10'}],completed_keys:['/perfil ver','/nivel','/missoes minhas','/missoes ativas']}));
 r=await call({action:'start',revision:r.state.revision});
 r=await call({action:'tick',revision:r.state.revision});assert.equal(r.state.phase,'waiting');
 assert.equal(r.state.brain.provider,'workers-ai');assert.ok(r.state.brain.error);assert.equal(rows.has('discord2_service_job_v1'),false);
});
test('Workers AI escolhe comando do catálogo sem solicitar plano OpenCode',async()=>{
 const rows=new Map();
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-personal-credential-for-tests-only-123456789',BUSHIN_AI:{async run(_model,args){const input=JSON.parse(args.messages[1].content);const next=input.commands.find(c=>c.command==='/perfil ver');return {response:JSON.stringify(next?{command:next.command,options:{},channel_id:next.channel_id,reason:'consulta confirmada'}:{command:'',reason:'Sem ação'})}}},DB:{prepare(sql){let a;return {bind(...v){a=v;return this},async first(){return rows.has(a[1])?{value_json:rows.get(a[1])}:null},async run(){let n=0;if(sql.startsWith('UPDATE')){if(rows.get(a[3])===a[4]){rows.set(a[3],a[0]);n=1}}else if(!sql.includes('IGNORE')||!rows.has(a[1])){rows.set(a[1],a[2]);n=1}return {meta:{changes:n}}}}}}};
 rows.set('discord2_service_heartbeat_v1',JSON.stringify({at:Date.now(),version:4,instance_id:'test-runner'}));
 rows.set('discord2_catalog_cache_v7',JSON.stringify({at:Date.now(),commands:[{application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]},{application_id:bot,name:'mapa'}]}));
 const baseUrl='https://example.test',ctx={me:{id:owner,membership:{member:true}}};
 const helpers={baseUrl,reply:(v,s)=>Response.json(v,{status:s}),seal:async x=>x,unseal:async x=>x,readChat:async()=>({read:true,messages:[]}),learn:async()=>({initial:false,evidence:[]}),listChannels:async()=>({listed:true,visibility_filtered:true,channels:[{id:channel,name:'Comandos',type:0}]})};
 const call=async data=>(await playerRoute(new Request(baseUrl+'/mobile/discord2/api/autoplay',data?{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(data)}:{}),env,ctx,helpers)).json();
 let r=await call();
 rows.set('discord2_autoplay_v1',JSON.stringify({...r.state,player_observations:[{command:'/perfil ver',channel_id:channel,text:'Nível 10'}],completed_keys:['/perfil ver','/nivel','/missoes minhas','/missoes ativas']}));
 r=await call({action:'start',revision:r.state.revision});
 r=await call({action:'tick',revision:r.state.revision});
 assert.equal(r.state.phase,'confirming');assert.equal(r.state.pending.action.command,'/perfil ver');
 assert.equal(r.state.brain.provider,'workers-ai');assert.equal(r.planner.ai,true);assert.equal(r.planner.local,false);
 const job=JSON.parse(rows.get('discord2_service_job_v1'));assert.equal(job.request.command,'/perfil ver');assert.equal(job.request.channel_id,channel);

});
