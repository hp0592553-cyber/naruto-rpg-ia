import test from 'node:test';
import assert from 'node:assert/strict';
import {bushinAiNext} from '../discord2-ai.mjs';
import {normalizeMessage} from '../message-normalizer.mjs';
test('AI receives menu identifiers, values, owner correlation and unreadable-media flag without sending',async t=>{
 const owner='481485837801095178',bot='1515908078913192026',channel='1520114348079583263';
 const message=normalizeMessage({id:'1563883377600233727',channel_id:channel,author:{id:bot,bot:true},
  interaction_metadata:{id:'1563883375306088559',user:{id:'1516285846490189864'}},
  attachments:[{filename:'nivel.png'}],components:[{type:3,custom_id:'choose-action',min_values:1,max_values:1,
   options:[{label:'Defender',value:'defend'}]}]});
 let prompt='',calls=0,reads=0;
 t.mock.method(globalThis,'fetch',async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}));
 const env={DB:{prepare(){return {bind(){return this},async first(){return null},async run(){}}}},
  BUSHIN_AI:{async run(model,input){calls++;prompt=input.messages[1].content;return {response:'{"analise":"Falta ficha","proximo_passo":"Consultar ficha","mensagem":""}'}}}};
 const response=await bushinAiNext(new Request('https://example.test/mobile/discord2/api/ai/next',{
  method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({channel_id:channel})}),
  env,{me:{id:owner}},{baseUrl:'https://example.test',reply:(b,s)=>Response.json(b,{status:s}),
   personalCall:async(e,name)=>{reads++;assert.equal(name,'bushin_naruto_personal_read');return {read:true,messages:[message]}}});
 const result=await response.json();assert.equal(calls,1);assert.equal(reads,3);
 for(const value of ['"custom_id":"choose-action"','"value":"defend"','"min_values":1','"max_values":1',
   '"media_without_text":true','"owner_correlated_message_ids":[]'])assert.ok(prompt.includes(value),value);
 assert.equal(result.sent,false);assert.equal(result.executed_command,false);
});
