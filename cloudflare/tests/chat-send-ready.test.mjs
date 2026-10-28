import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
for (const fails of [false,true]) test(`chat send unlocks immediately after ${fails?'failure':'success'}`,async()=>{
 const nodes=new Map(); const E=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='codexMessage'?'Oi':'',disabled:false});return nodes.get(id)};
 const c=vm.createContext({E,codexChatBusy:false,codexChatPendingId:null,chatProvider:{value:'cloud'},codexIntent:'chat',codexLoadedContext:()=>'',codexPickedChannelIds:()=>[],S:{current:'test'},JSON,req:async()=>{if(fails)throw Error('offline');return {model:'Llama',included_scan_notes:0}},codexChatRefresh:async()=>{E('codexSend').disabled=c.codexChatBusy}});
 const a=PANEL_JS.indexOf('E("codexSend").onclick=async()=>{'),b=PANEL_JS.indexOf('E("codexClearChat").onclick',a);
 vm.runInContext(PANEL_JS.slice(a,b),c);
 await E('codexSend').onclick();
 assert.equal(c.codexChatBusy,false);
 assert.equal(E('codexSend').disabled,false);
 assert.equal(E('codexMessage').value,fails?'Oi':'');
});
