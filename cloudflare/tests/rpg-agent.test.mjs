import test from 'node:test';
import assert from 'node:assert/strict';
import {responseSnapshot,agentRoute,recordCommandEvidence} from '../rpg-agent.mjs';
const owner='481485837801095178';
function fixture(){
 const rows=new Map();let plans=0;
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(sql){let args;return{bind(...v){args=v;return this},async first(){const s=rows.get(args[1]);return s?{value_json:s}:null},async all(){return{results:[...rows.entries()].filter(([k])=>k.startsWith('rpg-audit:')).map(([,value_json])=>({value_json}))}},async run(){if(sql.startsWith('UPDATE')){if(rows.get(args[3])!==args[4])return{meta:{changes:0}};rows.set(args[3],args[0])}else if(sql.startsWith('INSERT OR IGNORE')){if(!rows.has(args[1]))rows.set(args[1],args[2])}else rows.set(args[1],args[2]);return{meta:{changes:1}}}}}}};
 const helpers={baseUrl:'https://example.test',reply:(b,status)=>Response.json(b,{status}),plan:async()=>{plans++;return{ok:true,plan:{next_step:'Consultar missão'}}}};
 const ctx={me:{id:owner,membership:{member:true}}};
 const post=data=>agentRoute(new Request('https://example.test/mobile/discord2/api/agent',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(data)}),env,ctx,helpers);
 return{env,ctx,rows,post,helpers,plans:()=>plans};
}
test('official execution remains blocked when no game integration exists',async()=>{
 const f=fixture(),r=await f.post({action:'start',revision:0}),data=await r.json();
 assert.equal(data.state.phase,'blocked');assert.equal(data.executed,false);assert.equal(data.integration.ready,false);assert.equal(f.plans(),0);
 assert.equal((await f.post({action:'resume',revision:0})).status,409);
 const pause=await (await f.post({action:'pause',revision:1})).json();assert.equal(pause.state.phase,'paused');
 const stop=await (await f.post({action:'stop',revision:2})).json();assert.equal(stop.state.phase,'stopped');
});
test('planning saves state and an audit entry without an execution request',async()=>{
 const f=fixture(),r=await f.post({action:'plan',revision:0,channel_id:'1520114348079583263'}),d=await r.json();assert.equal(d.state.phase,'planned');assert.equal(d.executed,false);assert.equal(f.plans(),1);
 const fetched=await agentRoute(new Request('https://example.test/mobile/discord2/api/agent'),f.env,f.ctx,f.helpers);const data=await fetched.json();assert.equal(data.state.plan.next_step,'Consultar missão');assert.equal(data.history.length,1);
});
test('stats require explicit fields and another player cannot overwrite Henrique',()=>{
 const message={id:'1563974378138374218',channel_id:'1520114348079583263',author_id:'1515908078913192026',embeds:[{fields:[{name:'Vida',value:'80 / 100'},{name:'XP',value:'25 / 50'}]}],normalized_text:'Você não tem missões ativas.'};
 const own=responseSnapshot({command:'/perfil ver'},message,owner);assert.equal(own.stats.hp.value,80);const mission=responseSnapshot({command:'/missoes minhas'},message,owner);assert.equal(mission.mission.state,'none');assert.deepEqual(mission.stats,{});assert.equal(own.stats.level,undefined);
 assert.equal(responseSnapshot({command:'/perfil ver',options:{usuario:'906497580182142976'}},message,owner),null);
});
test('confirmed response saves audit, private flag and only explicit evidence',async()=>{
 const f=fixture();await recordCommandEvidence(f.env,owner,{request_id:'test',command:'/missoes minhas'},{message_id:'1563974378138374218',channel_id:'1520114348079583263',author_id:'1515908078913192026',content:'Você não tem missões ativas.',embeds:[],components:[],ephemeral:true});
 assert.equal(JSON.parse(f.rows.get('discord2_character_v1')).mission.state,'none');assert.equal(JSON.parse(f.rows.get('rpg-audit:test')).ephemeral,true);assert.equal(JSON.parse(f.rows.get('rpg-audit:test')).accepted_by_game,null);
});

test('foreign interaction cannot replace Henrique character evidence',async()=>{
 const f=fixture();
 const foreign={message_id:'1564255220412711052',channel_id:'1520114348079583263',
  author_id:'1515908078913192026',content:'',embeds:[{fields:[{name:'Nível',value:'20'}]}],components:[],
  interaction_metadata:{type:2,name:'perfil ver',user_id:'697125041363615844'}};
 await recordCommandEvidence(f.env,owner,{request_id:'foreign',command:'/perfil ver'},foreign);
 assert.equal(f.rows.has('discord2_character_v1'),false);
 const audit=JSON.parse(f.rows.get('rpg-audit:foreign'));
 assert.equal(audit.evidence_status,'foreign_interaction');
 assert.equal(audit.character_confirmed,false);
 assert.equal(audit.game_execution_confirmed,false);
});
test('unparsed bot responses are captured but not a new profile confirmation',async()=>{
 const f=fixture();
 const base={channel_id:'1520114348079583263',author_id:'1515908078913192026',components:[],embeds:[]};
 await recordCommandEvidence(f.env,owner,{request_id:'original',command:'/missoes minhas'},
  {...base,message_id:'1563974378138374218',content:'Você não tem missões ativas.'});
 const original=JSON.parse(f.rows.get('discord2_character_v1'));
 await recordCommandEvidence(f.env,owner,{request_id:'empty',command:'/perfil ver'},
  {...base,message_id:'1564251222687613030',content:''});
 assert.deepEqual(JSON.parse(f.rows.get('discord2_character_v1')),original);
 const audit=JSON.parse(f.rows.get('rpg-audit:empty'));
 assert.equal(audit.evidence_status,'response_only');
 assert.equal(audit.response_captured,true);
 assert.equal(audit.character_confirmed,false);
 assert.equal(audit.accepted_by_game,null);
});
