import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
test('private command response renders its embed and privacy label outside public history',()=>{
 const host={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}},rendered=[];
 const c=vm.createContext({E:()=>host,document:{createElement:()=>({})},addMediaImages(){},gameControls(){},renderDiscordFormat(){},renderComponentV2:()=>false,gameEmbed:(_host,message)=>rendered.push(message)});
 const a=PANEL_JS.indexOf('function showCommandResponse('),b=PANEL_JS.indexOf('const slashProgressKey=',a);
 vm.runInContext(PANEL_JS.slice(a,b)+';this.show=showCommandResponse',c);
 c.show({message_id:'1563965884932956301',ephemeral:true,embeds:[{title:'Suas missões',description:'Você não tem missões ativas.'}],components:[]});
 assert.equal(host.hidden,false);assert.match(host.children[0].textContent,/Só você/);assert.equal(rendered[0].embeds[0].title,'Suas missões');
});
