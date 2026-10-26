import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
function harness(){
 const box={hidden:true,textContent:'',replaceChildren(){}},composer={value:'/'},calls=[];
 const sandbox={Date,encodeURIComponent,S:{current:'1520114348079583263'},
  E:id=>id==='slashBox'?box:composer,status(){},
  autocompleteMention(){},
  req:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};
 const context=vm.createContext(sandbox),start=PANEL_JS.indexOf('let commandCatalog=');
 const end=PANEL_JS.indexOf('composer.addEventListener(',start);
 vm.runInContext(PANEL_JS.slice(start,end)+
  ';presentCommands=()=>{};this.h={load:loadCommands,reset:resetCommandCatalog,state:()=>({loaded:catalogLoaded,channel:catalogChannel,commands:commandCatalog})}',context);
 return {context,h:context.h,calls,box,composer};
}
test('prefetch is silent and typing slash reuses the in-flight catalog',async()=>{
 const {h,calls,box,composer}=harness();composer.value='hello';
 const loading=h.load(false,true);assert.equal(box.hidden,true);
 composer.value='/';await h.load();assert.equal(calls.length,1);
 calls[0].resolve({catalog_verified:true,channel_id:'1520114348079583263',commands:[{name:'perfil'}]});
 await loading;await h.load();assert.equal(calls.length,1);assert.equal(h.state().loaded,true);
});
test('channel changes discard delayed catalogs and request the selected channel',async()=>{
 const {context,h,calls}=harness();
 const first=h.load();await h.load();assert.equal(calls.length,1);context.S.current='1532489544161562857';h.reset();const second=h.load();
 assert.match(calls[1].url,/channel_id=1532489544161562857$/);
 calls[0].resolve({catalog_verified:true,channel_id:'1520114348079583263',commands:[{name:'old'}]});await first;
 assert.equal(h.state().loaded,false);
 calls[1].resolve({catalog_verified:true,channel_id:context.S.current,commands:[{name:'real'},{name:'guide',reference_only:true}]});await second;
 assert.equal(h.state().channel,context.S.current);assert.equal(h.state().commands.length,1);
 assert.equal(h.state().commands[0].name,'real');
 await h.load();assert.equal(calls.length,2);
});
test('failed refresh clears prior catalog instead of presenting guide commands as synchronized',async()=>{
 const {context,h,calls}=harness();const first=h.load();
 calls[0].resolve({catalog_verified:true,channel_id:context.S.current,commands:[{name:'real'}]});await first;
 const refresh=h.load(true);calls[1].reject(Error('provider unavailable'));await refresh;
 assert.equal(h.state().loaded,false);assert.equal(h.state().commands.length,0);
});
