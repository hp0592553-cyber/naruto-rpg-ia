/** One D1 row per owner, bounded history, atomic compare-and-swap; no in-memory execution state. */
export const AUTOPLAY_KEY='discord2_autoplay_v1';
export function initialAutoplay(owner){return {version:1,owner_id:owner,revision:0,phase:'stopped',reason:'Agente parado.',code:null,goal:'Jogar Naruto Project até o nível 20.',goal_level:20,
 run_id:null,steps:0,max_steps:25,created_at:0,updated_at:0,next_tick_at:0,lease:null,pending:null,snapshot:null,last_result:null,history:[],completed_keys:[]};}
export async function readAutoplay(env,owner){
 const r=await env.DB.prepare('SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?').bind(owner,AUTOPLAY_KEY).first();
 if(!r)return {raw:null,state:initialAutoplay(owner)};
 const state=JSON.parse(r.value_json);if(state.version!==1||state.owner_id!==owner||!Number.isInteger(state.revision)||!Array.isArray(state.history))throw Error('autoplay_state_invalid');
 return {raw:r.value_json,state};
}
export async function changeAutoplay(env,owner,mutate,{now=()=>Date.now()}={}){
 for(let attempt=0;attempt<5;attempt++){
  const {raw,state}=await readAutoplay(env,owner),draft=structuredClone(state);
  const next=mutate(draft,state);if(!next)return {changed:false,state};
  next.revision=state.revision+1;next.updated_at=now();next.history=(next.history||[]).slice(-60);next.completed_keys=(next.completed_keys||[]).slice(-100);
  const json=JSON.stringify(next);if(json.length>150000)throw Error('autoplay_state_too_large');
  const query=raw===null?env.DB.prepare('INSERT OR IGNORE INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?)').bind(owner,AUTOPLAY_KEY,json,next.updated_at):
   env.DB.prepare('UPDATE bushin_project_state SET value_json=?,updated_at=? WHERE owner_id=? AND key=? AND value_json=?').bind(json,next.updated_at,owner,AUTOPLAY_KEY,raw);
  const saved=await query.run();if(Number(saved?.meta?.changes)===1)return {changed:true,state:next};
 }
 const e=Error('Outra solicitação alterou o agente; atualize a tela.');e.code='state_conflict';throw e;
}
export function recordAutoplay(state,type,detail,at=Date.now()){
 state.history.push({at,type,detail:String(detail||'').slice(0,500),operation_id:state.pending?.id||null});return state;
}
