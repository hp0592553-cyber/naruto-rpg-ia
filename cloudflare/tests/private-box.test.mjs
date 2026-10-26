import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
test('private command response renders its embed and privacy label outside public history',()=>{
 const host={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}},rendered=[];
 const c=vm.createContext({renderGameToolbox(){},E:id=>id==="commandProgress"?{}:host,document:{createElement:()=>({})},addMediaImages(){},gameControls(){},renderDiscordFormat(){},renderComponentV2:()=>false,gameEmbed:(_host,message)=>rendered.push(message)});
 const a=PANEL_JS.indexOf('function showCommandResponse('),b=PANEL_JS.indexOf('const slashProgressKey=',a);
 vm.runInContext(PANEL_JS.slice(a,b)+';this.show=showCommandResponse',c);
 c.show({message_id:'1563965884932956301',ephemeral:true,embeds:[{title:'Suas missões',description:'Você não tem missões ativas.'}],components:[]});
 assert.equal(host.hidden,false);assert.match(host.children[0].textContent,/Só você/);assert.equal(rendered[0].embeds[0].title,'Suas missões');
});

test('private responses stay in the right channel and replace their public duplicate',()=>{
 const a=PANEL_JS.indexOf('function conversationMessages'),b=PANEL_JS.indexOf('function render(mode=',a);const c=vm.createContext({});vm.runInContext(PANEL_JS.slice(a,b)+';this.merge=conversationMessages;',c);
 const rows=c.merge([{id:'123',channel_id:'here',content:'old'}],[{id:'123',channel_id:'here',content:'new',own_response:true},{id:'124',channel_id:'elsewhere',ephemeral:true}], 'here');
 assert.equal(rows.length,1);assert.equal(rows[0].content,'new');assert.equal(rows[0].own_response,true);
});
