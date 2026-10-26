import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
import {AUTOPLAY_JS} from '../autoplay-ui.mjs';
test('inline own button submits the real message and component once',async()=>{
 const requests=[],nodes=[];const c=vm.createContext({document:{createElement:()=>({append(){},setAttribute(){}})},slashProgress:null,req:async(p,r)=>{requests.push(JSON.parse(r.body));return {submitted:true}},startSlashProgress(){},status(){}});
 const a=PANEL_JS.indexOf('function appendOwnGameControl'),b=PANEL_JS.indexOf('function renderGameToolbox',a);vm.runInContext(PANEL_JS.slice(a,b)+';this.add=appendOwnGameControl;',c);
 c.add({append:n=>nodes.push(n)},{message_id:'123',channel_id:'456'},{type:2,custom_id:'actual-button',label:'Continuar'});
 await nodes[0].onclick();await nodes[0].onclick();assert.equal(requests.length,1);assert.equal(requests[0].command_request.channel_id,'456');assert.equal(requests[0].command_request.options.message_id,'123');assert.equal(requests[0].command_request.options.custom_id,'actual-button');assert.equal(nodes[0].disabled,true);
});
test('site navigation follows a new allowed action once and never moves while stopped',()=>{
 const calls=[],s={phase:'running',site_action:{id:'operation',type:'channel',channel_id:'forest'}};const c=vm.createContext({s,S:{current:'commands',channels:[{id:'forest'}]},autoplaySiteAction:null,select:id=>{calls.push(id);return Promise.resolve()},status(){}});
 const a=AUTOPLAY_JS.indexOf(' const active='),b=AUTOPLAY_JS.indexOf(' E("autoplayStart")',a),code='{'+AUTOPLAY_JS.slice(a,b)+'}';vm.runInContext(code,c);vm.runInContext(code,c);assert.deepEqual(calls,['forest']);s.phase='stopped';s.site_action.id='next';vm.runInContext(code,c);assert.equal(calls.length,1);
});
