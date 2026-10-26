/** Render the actual panel with synthetic API responses. Never contacts Discord.
 * node scripts/qa_mobile_fixture.mjs /tmp/bushin-mobile-qa.html
 * This exercises layout/client behavior, not authenticated gameplay or Android's keyboard.
 */
import {writeFileSync} from 'node:fs';
import {PANEL_HTML,PANEL_JS} from '../cloudflare/discord2-ui.mjs';
const mock=String.raw`
window.qaRequests=[];window.qaSlowStart=false;
let state={version:1,owner_id:'481485837801095178',revision:0,phase:'stopped',reason:'QA sintético — sem conexão com Discord',history:[],steps:0,max_steps:25,goal_level:20};
const channel='1520114348079583263';
window.fetch=async(input,options={})=>{
 const path=String(input).replace('/mobile/discord2/api','').split('?')[0];
 const body=options.body?JSON.parse(options.body):null;
 window.qaRequests.push({path,body});let value={state:{phase:'stopped',revision:0},history:[],enabled:false,missing:[],integration:{configured:true,missing:[]},chat_history:[]};
 if(path==='/channels')value={listed:true,channels:[{id:channel,name:'Comandos · QA sintético',type:0},{id:'999999999999999999',name:'Canal de teste',type:0}]};
 else if(path.includes('/messages'))value={read:true,messages:Array.from({length:20},(_,i)=>({id:String(900000000000000000n+BigInt(i)),channel_id:channel,author_id:'481485837801095178',author_name:'Henrique · fixture',content:'Mensagem sintética para verificar rolagem e controles no celular. '+i,timestamp:new Date().toISOString()}))};
 else if(path==='/autoplay'){
  if(body?.action==='stop'){state={...state,phase:'stopped',run_id:null,reason:'Parado.',revision:state.revision+1};}
  else if(body?.action==='start'){
   if(window.qaSlowStart)await new Promise(resolve=>{window.qaReleaseStart=resolve});
   if(body.revision!==state.revision)return Response.json({error:'Estado mudou. Atualize antes de continuar.'},{status:409});
   state={...state,phase:'running',run_id:'qa-only',reason:'Lendo contexto sintético.',revision:state.revision+1,next_tick_at:Date.now()+1000};
  }else if(body?.action==='tick'&&state.phase!=='stopped'){
   state={...state,phase:'waiting',steps:state.steps+1,reason:'Resposta sintética recebida. Sem jogada real.',revision:state.revision+1,next_tick_at:Date.now()+60000,last_result:{operation_id:'qa-operation',at:Date.now(),response:{id:'999999999999999998',message_id:'999999999999999998',channel_id:channel,author_id:'1515908078913192026',author_name:'Naruto Bot · fixture',normalized_text:'QA sintético: botão na conversa normal.',content:'QA sintético: botão na conversa normal.',embeds:[],components:[],controls:[{type:2,custom_id:'qa-only',label:'Interação sintética'}]}}};
  }
  value={state:structuredClone(state),integration:{configured:true,missing:[]},note:'QA sintético; não é resultado do jogo.'};
 }else if(path==='/ai/opencode')value=body?{submitted:true,request_id:'qa-component',confirmed:false}:{state:'idle',confirmed:false};
 return Response.json(value);
};
`;
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const html=PANEL_HTML.replace('<script defer src="/mobile/discord2/app.js"></script>','')
 .replace('</body>','<script>'+escapeScript(mock)+'</script><script>'+escapeScript(PANEL_JS)+'</script></body>');
writeFileSync(process.argv[2]||'/tmp/bushin-mobile-qa.html',html);
console.log('Synthetic panel written; all fetches are mocked.');
