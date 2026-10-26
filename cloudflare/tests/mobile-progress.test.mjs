import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
function fixture(saved=null){
 const elements=new Map(),calls=[],storage=new Map(saved?[['bushin-slash-progress',JSON.stringify(saved)]]:[]);let answer={state:'in_progress',command:'/missoes diarias'};
 const c=vm.createContext({E:id=>{if(!elements.has(id))elements.set(id,{hidden:true,classList:{toggle(){}},textContent:'',replaceChildren(){this.textContent=''}});return elements.get(id)},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{visibilityState:'visible',addEventListener(){}},setInterval:()=>1,clearInterval(){},req:async(...args)=>{calls.push(args);if(answer instanceof Error)throw answer;return answer},refresh:async()=>{},Date});
 const a=PANEL_JS.indexOf('const slashProgressKey='),b=PANEL_JS.indexOf('async function sendSelectedSlash(',a);
 vm.runInContext(PANEL_JS.slice(a,b)+';this.api={startSlashProgress,checkSlashProgress,commandPhaseLabel,get:()=>slashProgress}',c);
 return {api:c.api,elements,calls,storage,setAnswer:v=>answer=v};
}
test('progress translates queue states and displays terminal response',async()=>{
 const f=fixture();f.api.startSlashProgress('/missoes diarias',Date.now(),'qa-request');f.setAnswer({state:'in_progress',command:'/missoes diarias',request_id:'qa-request'});await f.api.checkSlashProgress();
 assert.match(f.elements.get('commandProgressTitle').textContent,/Processando comando/);
 assert.equal(f.api.commandPhaseLabel('queued'),'Na fila');
 f.setAnswer({state:'finished',command:'/missoes diarias',request_id:'qa-request',confirmed:true});await f.api.checkSlashProgress();
 assert.equal(f.api.get().pending,false);assert.match(f.elements.get('commandProgressTitle').textContent,/O bot respondeu/);
 assert.ok(f.calls.every(args=>args.length===1&&args[0]==='/ai/opencode?request_id=qa-request'));
});
test('connection failure offers a read-only recheck instead of resending',async()=>{
 const f=fixture();f.api.startSlashProgress('/missoes diarias',Date.now(),'qa-request');f.setAnswer(new Error('offline'));await f.api.checkSlashProgress();
 assert.equal(f.api.get().pending,false);assert.match(f.elements.get('commandProgressTitle').textContent,/Conexão interrompida/);
 f.setAnswer({state:'finished',command:'/missoes diarias',request_id:'qa-request',confirmed:true});await f.api.checkSlashProgress();
 assert.match(f.elements.get('commandProgressTitle').textContent,/O bot respondeu/);assert.ok(f.calls.every(args=>args.length===1));
});
test('reload restores the pending command and consults its state',async()=>{
 const f=fixture({command:'/missoes diarias',started:Date.now(),pending:true});await new Promise(r=>setImmediate(r));
 assert.equal(f.api.get().command,'/missoes diarias');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'/ai/opencode');
});

test('new command clears the previous private response and shows executor queue notes',async()=>{
 const f=fixture();f.api.startSlashProgress('/perfil ver');
 f.elements.get('commandResponse').textContent='old private response';
 f.api.startSlashProgress('/missoes diarias');
 assert.equal(f.elements.get('commandResponse').textContent,'');
 f.setAnswer({state:'queued',command:'/missoes diarias',note:'Executor GitHub na fila.'});
 await f.api.checkSlashProgress();
 assert.match(f.elements.get('commandProgressDetail').textContent,/Executor GitHub na fila/);
});
test('a matching command with a different request ID is never accepted as this result',async()=>{
 const f=fixture();f.api.startSlashProgress('/missoes diarias',Date.now(),'request-a','1520114348079583263');
 f.setAnswer({state:'finished',command:'/missoes diarias',request_id:'request-b',confirmed:true});await f.api.checkSlashProgress();
 assert.match(f.elements.get('commandProgressTitle').textContent,/não correlacionado/);assert.equal(f.api.get().pending,false);
 assert.equal(f.calls[0][0],'/ai/opencode?request_id=request-a');
});
test('old saved commands without request IDs are displayed as insufficient evidence',async()=>{
 const f=fixture();f.api.startSlashProgress('/missoes diarias');f.setAnswer({state:'finished',command:'/missoes diarias',confirmed:true});await f.api.checkSlashProgress();
 assert.match(f.elements.get('commandProgressTitle').textContent,/Confirmação insuficiente/);
});
