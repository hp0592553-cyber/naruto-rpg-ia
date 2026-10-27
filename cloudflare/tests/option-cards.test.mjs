import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {analyzeDiscordOptions,listMessageOptions} from '../discord2-options.mjs';
import {PANEL_JS,PANEL_HTML} from '../discord2-ui.mjs';

const owner='481485837801095178',channel='1520114348079583263',bot='1515908078913192026',id='1564380277411680326';
const privateReply={message_id:id,channel_id:channel,author_id:bot,ephemeral:true,
  controls:[{type:2,label:'Ver missão',custom_id:'mission-1',disabled:false},{type:2,label:'Apagar conta',custom_id:'danger',disabled:true}],
  embeds:[{title:'Minha ficha',fields:[{name:'Local',value:'Konoha'}]}]};
function fixture(saved=privateReply){
 const state={version:1,owner_id:owner,revision:1,history:[],last_result:saved?{operation_id:'op-1',response:saved}:null};
 let requests=0,models=0,prompt='';
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(){return{bind(){return this},first:async()=>({value_json:JSON.stringify(state)})}}},
   BUSHIN_AI:{async run(_model,data){models++;prompt=data.messages[1].content;return {response:JSON.stringify({analise:'Missão disponível.',opcao:'Ver missão',motivo:'Consulta textual.',passos:['Ler a missão.','Conferir a resposta do jogo.','Analisar a próxima caixa.']})}}}};
 const ctx={me:{id:owner,membership:{member:true}}};
 const helpers={baseUrl:'https://example.test',reply:(v,s)=>Response.json(v,{status:s}),readChat:async()=>{requests++;return {read:true,messages:[]}}};
 const call=async(payload={channel_id:channel,message_id:id})=>{
  const req=new Request('https://example.test/mobile/discord2/api/ai/options',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(payload)});
  const r=await analyzeDiscordOptions(req,env,ctx,helpers);return {status:r.status,body:await r.json()};
 };
 return {env,ctx,helpers,call,get requests(){return requests},get models(){return models},get prompt(){return prompt}};
}
test('inline UI contains actual option cards in Discord 2 and parses as JavaScript',()=>{
 assert.match(PANEL_JS,/function appendAiOptionCard\(/);
 assert.match(PANEL_JS,/req\("\/ai\/options"/);
 assert.match(PANEL_JS,/appendAiOptionCard\(host,m\)/);
 assert.match(PANEL_HTML,/bushinAiChoices/);
 new vm.Script(PANEL_JS);
});
test('real V2 controls include menu choices but never invent options',()=>{
 const options=listMessageOptions({components:[{type:17,components:[{type:9,accessory:{type:3,label:'Destino',custom_id:'destination',options:[{label:'Vila',value:'vila'},{label:'Floresta',value:'floresta'}]}}]}]});
 assert.equal(options.length,1);assert.deepEqual(options[0].choices,['Vila','Floresta']);
});
test('the owner current private box sends verified labels to Llama, not commands',async()=>{
 const f=fixture(),res=await f.call();
 assert.equal(res.status,200);
 assert.equal(f.requests,0,'private response is read from saved correlated result, not re-polled');
 assert.equal(f.models,1);
 assert.equal(res.body.option,'Ver missão');
 assert.equal(res.body.option_verified,true);
 assert.equal(res.body.steps.length,3);
 assert.equal(res.body.sent,false);
 assert.equal(res.body.executed,false);
 assert.match(f.prompt,/Ver missão/);
 assert.match(f.prompt,/Apagar conta/);
});
test('an option that is disabled cannot be recommended even if model picks it',async()=>{
 const f=fixture();
 f.env.BUSHIN_AI.run=async()=>({response:JSON.stringify({analise:'Sem ação.',opcao:'Apagar conta',motivo:'Proposta inválida',passos:[]})});
 const r=await f.call();
 assert.equal(r.body.option,'');
 assert.equal(r.body.option_verified,false);
 assert.equal(r.body.sent,false);
});
test('image-only private response explains missing text and does not invoke model',async()=>{
 const reply={message_id:id,channel_id:channel,author_id:bot,ephemeral:true,controls:[],attachments:[{filename:'atributos.png'}]};
 const f=fixture(reply),r=await f.call();
 assert.equal(r.body.state,'no_options');
 assert.match(r.body.analysis,/imagem ou mídia/);
 assert.equal(f.models,0);
 assert.equal(r.body.sent,false);
});
test('external bot panel is not mistaken for Naruto Bot',async()=>{
 const f=fixture(null);f.helpers.readChat=async()=>({read:true,messages:[{id,channel_id:channel,author_id:'888888888888888888',controls:[{type:2,label:'Conhecer o DISBOARD Pro'}]}]});
 const r=await f.call();
 assert.equal(r.body.state,'other_bot');
 assert.equal(r.body.model_invoked,false);
 assert.equal(f.models,0);
});
test('unlinked Naruto interaction does not inherit another player identity',async()=>{
 const f=fixture(null);f.helpers.readChat=async()=>({read:true,messages:[{id,channel_id:channel,author_id:bot,interaction_metadata:{user_id:'111111111111111111'},controls:[{type:2,label:'Atacar'}]}]});
 const r=await f.call();
 assert.equal(r.body.state,'not_yours');
 assert.equal(f.models,0);
});
test('owner authentication is mandatory and does not call the model',async()=>{
 const f=fixture();f.ctx.me.id='111111111111111111';
 const r=await f.call();
 assert.equal(r.status,403);
 assert.equal(f.models,0);
});
