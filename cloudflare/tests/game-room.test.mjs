import test from 'node:test';
import assert from 'node:assert/strict';
import {gameRoomRoute} from '../game-room.mjs';
import {PANEL_HTML,PANEL_JS} from '../discord2-ui.mjs';

const owner='481485837801095178',baseUrl='https://bushin.example.test',GAME='1520114348079583263';
const reply=(obj,status=200,headers={})=>Response.json(obj,{status,headers});
const ctx={me:{id:owner,membership:{member:true}}};
function fakeDb(){
 const rows=new Map();
 return {
  rows,prepare(sql){
   return {bind(...args){
    return {
     async first(){
      const key=args[0]+':'+args[1],json=rows.get(key);
      return json===undefined?null:{value_json:json};
     },
     async all(){
      return {results:[...rows].filter(([key])=>key.startsWith(owner+':rpg-audit:')).map(([,value_json])=>({value_json}))};
     },
     async run(){
      if(sql.startsWith('INSERT OR IGNORE INTO bushin_project_state')){
       const key=args[0]+':'+args[1];
       if(rows.has(key))return {meta:{changes:0}};
       rows.set(key,args[2]);return {meta:{changes:1}};
      }
      if(sql.startsWith('UPDATE bushin_project_state')){
       const key=args[2]+':'+args[3];
       if(rows.get(key)!==args[4])return {meta:{changes:0}};
       rows.set(key,args[0]);return {meta:{changes:1}};
      }
      throw Error('unexpected query '+sql);
     }
    };
   }};
  }
 };
}
const request=(action=null,revision=0,origin=baseUrl)=>new Request(
 baseUrl+'/mobile/discord2/api/game-room',{
  method:action?'POST':'GET',
  headers:{...(action?{'content-type':'application/json',origin}:{})},
  ...(action?{body:JSON.stringify({action,revision})}:{})
 });
test('Game mode cannot pretend to play without game integration',async()=>{
 const env={DB:fakeDb(),BUSHIN_OWNER_DISCORD_ID:owner};const helpers={reply,baseUrl,plan:async()=>({ok:true,result:{}})};
 let res=await gameRoomRoute(request(),env,ctx,helpers);
 let data=await res.json();
 assert.equal(data.state.phase,'stopped');
 assert.equal(data.state.execution_authorized,false);
 assert.equal(data.state.autonomous_execution,false);
 assert.equal(data.state.executed_actions,0);
 assert.equal(data.snapshot,null);
 res=await gameRoomRoute(request('plan',0),env,ctx,helpers);
 assert.equal(res.status,409);
 res=await gameRoomRoute(request('start',0),env,ctx,helpers);
 assert.equal(res.status,200);data=await res.json();
 assert.equal(data.state.phase,'ready');
 assert.equal(data.state.revision,1);
 assert.equal(data.state.actions_executed,0);
 res=await gameRoomRoute(request('start',0),env,ctx,helpers);
 assert.equal(res.status,409,'stale command revision rejected');
 res=await gameRoomRoute(request('pause',1),env,ctx,helpers);
 assert.equal((await res.json()).state.phase,'paused');
 res=await gameRoomRoute(request('plan',2),env,ctx,helpers);
 assert.equal(res.status,409,'cannot plan while paused');
 res=await gameRoomRoute(request('resume',2),env,ctx,helpers);
 assert.equal((await res.json()).state.phase,'ready');
});
test('AI-generated information-only slash suggestion is stored, not executed',async()=>{
 const env={DB:fakeDb(),BUSHIN_OWNER_DISCORD_ID:owner};
 let called=0;
 const helpers={reply,baseUrl,plan:async channel=>{
  called++;
  assert.equal(channel,GAME);
  return {ok:true,result:{
   analysis:'Precisa conferir a missão de Henrique.',next_step:'Use a consulta /missoes minhas.',
   next_action:{type:'slash',command:'/missoes minhas',channel_id:GAME,catalog_verified:true},
   action_reason:'Catálogo válido'
  }};
 }};
 let res=await gameRoomRoute(request('start',0),env,ctx,helpers);
 let state=(await res.json()).state;
 res=await gameRoomRoute(request('plan',state.revision),env,ctx,helpers);
 let data=await res.json();
 assert.equal(res.status,200);
 assert.equal(data.state.phase,'proposed');
 assert.equal(data.state.proposal.command,'/missoes minhas');
 assert.equal(data.state.proposal.execution_state,'not_executed');
 assert.equal(data.state.autonomous_execution,false);
 assert.equal(data.state.actions_executed,0);
 assert.equal(data.executed,false);
 assert.equal(called,1);
 res=await gameRoomRoute(request('review',data.state.revision),env,ctx,helpers);
 data=await res.json();
 assert.equal(data.state.phase,'reviewed');
 assert.equal(data.latest_correlated_response,null);
 assert.equal(data.state.completed_verified,0);
 res=await gameRoomRoute(request('stop',data.state.revision),env,ctx,helpers);
 data=await res.json();
 assert.equal(data.state.phase,'stopped');
 assert.equal(data.state.proposal,null);
});
test('Unknown unsafe commands never become executable suggestions',async()=>{
 const env={DB:fakeDb(),BUSHIN_OWNER_DISCORD_ID:owner};
 const helpers={reply,baseUrl,plan:async()=>({ok:true,result:{
  next_action:{type:'slash',command:'/atacar agora',channel_id:GAME,catalog_verified:true},
  analysis:'Combate perigoso',next_step:'Verifique vida e chakra'
 }})};
 let r=await gameRoomRoute(request('start',0),env,ctx,helpers);
 r=await gameRoomRoute(request('plan',1),env,ctx,helpers);
 const data=await r.json();
 assert.equal(data.state.phase,'needs_info');
 assert.equal(data.state.proposal.command,null);
 assert.equal(data.state.actions_executed,0);
});
test('Game mode preserves owner-only access and origin',async()=>{
 const env={DB:fakeDb(),BUSHIN_OWNER_DISCORD_ID:owner},h={reply,baseUrl,plan:async()=>({ok:true,result:{}})};
 let r=await gameRoomRoute(request(),env,{me:{id:'999',membership:{member:true}}},h);
 assert.equal(r.status,403);
 r=await gameRoomRoute(request('start',0,'https://not-bushin.example'),env,ctx,h);
 assert.equal(r.status,403);
});
test('HTML has live game mode controls, evidence and official Discord handoff',()=>{
 for(const id of ['quickPlay','gameRoom','gameStart','gamePlan','gameReview','gamePause','gameStop','gameCopyCommand','gameOpenDiscord'])
  assert.match(PANEL_HTML,new RegExp('id="'+id+'"'));
 assert.match(PANEL_HTML,/não executa|automátic[ao]/i);
 assert.match(PANEL_JS,/\/game-room/);
 assert.match(PANEL_JS,/execution_state|Executado no jogo/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});


test('Mobile browser in desktop-site viewport still sees a single-panel chat and visible game controls',()=>{
 assert.match(PANEL_HTML,/@media \(max-width:1200px\)/);
 assert.match(PANEL_HTML,/\.root\{display:block;width:100%;height:100dvh/);
 assert.match(PANEL_HTML,/\.side\{position:fixed;z-index:30/);
 assert.match(PANEL_HTML,/\.ai\{position:fixed;z-index:31/);
 assert.match(PANEL_HTML,/#menu,#showAi,#closeAi\{display:inline-block\}/);
 assert.match(PANEL_JS,/if\(codexChatMode&&!wasChatMode\)E\("gameRoom"\)\.open=true/);
 assert.match(PANEL_JS,/IA anterior · modelo não registrado/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});


test('Natural language gameplay controls target the execution controller instead of disguised planning',()=>{
 assert.match(PANEL_JS,/controlAutoplay\(autoControl/);
 assert.match(PANEL_JS,/await autoplayTick\(\)/);
 assert.match(PANEL_JS,/continua\|continue\|continuar\|retome/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
});

test('same command after a proposal is not correlated without the exact request ID',async()=>{
 const DB=fakeDb(),env={DB,BUSHIN_OWNER_DISCORD_ID:owner};
 const helpers={reply,baseUrl,plan:async()=>({ok:true,result:{next_action:{type:'slash',command:'/perfil ver',channel_id:GAME,catalog_verified:true}}})};
 await gameRoomRoute(request('start',0),env,ctx,helpers);
 await gameRoomRoute(request('plan',1),env,ctx,helpers);
 DB.rows.set(owner+':rpg-audit:unrelated',JSON.stringify({id:'unrelated',type:'command_response',command:'/perfil ver',message_id:'1563974378138374218',at:Date.now()+100,response_captured:true}));
 const r=await gameRoomRoute(request('review',2),env,ctx,helpers),d=await r.json();
 assert.equal(d.events.length,1);assert.equal(d.events[0].request_id,'unrelated');
 assert.equal(d.latest_correlated_response,null);assert.equal(d.state.executed_actions,0);
});
