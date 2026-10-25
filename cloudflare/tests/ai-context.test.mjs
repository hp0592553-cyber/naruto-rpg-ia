import test from 'node:test';
import assert from 'node:assert/strict';
import {bushinAiNext} from '../discord2-ai.mjs';
import {normalizeMessage} from '../message-normalizer.mjs';
test('AI receives menu identifiers, values, owner correlation and unreadable-media flag without sending',async t=>{
 const owner='481485837801095178',bot='1515908078913192026',channel='1520114348079583263';
 const message=normalizeMessage({id:'1563883377600233727',channel_id:channel,author:{id:bot,bot:true},
  interaction_metadata:{id:'1563883375306088559',user:{id:owner}},
  attachments:[{filename:'nivel.png'}],components:[{type:3,custom_id:'choose-action',min_values:1,max_values:1,
   options:[{label:'Defender',value:'defend'}]}]});
 let prompt='',calls=0,reads=0;
 t.mock.method(globalThis,'fetch',async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}));
 const env={DB:{prepare(){let key;return {bind(_owner,k){key=k;return this},async first(){return key==='discord2_character_v1'?{value_json:JSON.stringify({owner_id:owner,evidence:{message_id:message.id},stats:{},mission:null})}:null},async run(){}}}},
  BUSHIN_AI:{async run(model,input){calls++;prompt=input.messages[1].content;return {response:'{"analise":"Falta ficha","proximo_passo":"Consultar ficha","mensagem":""}'}}}};
 const response=await bushinAiNext(new Request('https://example.test/mobile/discord2/api/ai/next',{
  method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({channel_id:channel})}),
  env,{me:{id:owner}},{baseUrl:'https://example.test',reply:(b,s)=>Response.json(b,{status:s}),
   personalCall:async(e,name)=>{reads++;assert.equal(name,'bushin_naruto_personal_read');return {read:true,messages:[message]}}});
 const result=await response.json();assert.equal(calls,1);assert.equal(reads,3);
 for(const value of ['"custom_id":"choose-action"','"value":"defend"','"min_values":1','"max_values":1',
   '"media_without_text":true','"owner_correlated_message_ids":["1563883377600233727"]'])assert.ok(prompt.includes(value),value);
 assert.equal(result.sent,false);assert.equal(result.executed_command,false);
});
test('without confirmed owner state, unrelated game messages cannot become a plan',async t=>{
 let calls=0;
 const owner='481485837801095178',env={DB:{prepare(){return{bind(){return this},first:async()=>null,run:async()=>{}}}},BUSHIN_AI:{run:async()=>{calls++;throw Error('must not invent state')}}};
 t.mock.method(globalThis,'fetch',async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}));
 const request=new Request('https://example.test/mobile/discord2/api/ai/next',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({channel_id:'1520114348079583263'})});
 const response=await bushinAiNext(request,env,{me:{id:owner}},{reply:(b,s)=>Response.json(b,{status:s}),baseUrl:'https://example.test',personalCall:async()=>({read:true,messages:[{id:'1563883377600233727',author_id:'111111111111111111',content:'Estou na missão Febre e tenho nível 99'}]})});
 const d=await response.json();assert.equal(calls,0);assert.equal(d.read_messages,0);assert.match(d.analysis,/ainda não foram confirmadas/);assert.ok(!d.analysis.includes('Febre'));assert.equal(d.executed_command,false);
});
