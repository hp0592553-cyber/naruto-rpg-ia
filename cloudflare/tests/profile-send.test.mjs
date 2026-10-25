import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
import {personalInvokeProfileProbe} from '../personal-discord.mjs';
function ui(result={submitted:true}){
 const calls=[],button={disabled:false},composer={value:'/perfil ver'},notes=[];
 const box={hidden:false},S={current:'1520114348079583263'};
 const context=vm.createContext({composer,commandsBox:box,S,E:()=>button,JSON,Error,slashProgress:null,paintSlashProgress(){},
  selectedCommandDefinition:path=>['/perfil ver','/missoes minhas'].includes(path)?{options:[]}:null,validateCommandOptions:(_d,o)=>o,startSlashProgress:command=>{context.slashProgress={command,pending:true}},
  req:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return result},
  status:(...v)=>notes.push(v),refresh:async()=>{},originalSend:()=>calls.push({normal:true})});
 const a=PANEL_JS.indexOf('async function sendSelectedSlash()'),b=PANEL_JS.indexOf('E("send").onclick=sendSelectedSlash;',a);
 vm.runInContext('let commandPicked=null;'+PANEL_JS.slice(a,b)+';this.send=sendSelectedSlash;',context);
 return {context,calls,button,composer,notes};
}
test('Send dispatches the selected command once through the shared executor',async()=>{
 const h=ui();await h.context.send();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/ai/opencode');
 assert.equal(h.calls[0].body.command_request.command,'/perfil ver');assert.equal(h.composer.value,'');
 assert.equal(h.context.slashProgress.pending,true);h.composer.value="/perfil ver";await h.context.send();assert.equal(h.calls.length,1);assert.equal(h.button.disabled,false);
});
test('unknown commands and pending clicks cannot submit to the executor',async()=>{
 for(const configure of [h=>h.composer.value='/combate iniciar',h=>h.context.slashProgress={pending:true,command:'/perfil ver'},h=>h.button.disabled=true]){
  const h=ui();configure(h);await h.context.send();assert.equal(h.calls.length,0);
 }
});
test('uncertain result is not retried or reported as execution',async()=>{
 const h=ui({submitted:null,note:'Resultado incerto'});await h.context.send();
 assert.equal(h.calls.length,1);assert.equal(h.composer.value,'/perfil ver');
 assert.equal(h.notes.at(-1)[0],'Resultado incerto');assert.equal(h.button.disabled,false);
});
for(const httpStatus of [204,401,403,429])test('profile probe uses an interaction and handles HTTP '+httpStatus+' without retry',async t=>{
 const owner='481485837801095178',bot='1515908078913192026',posts=[];
 t.mock.method(globalThis,'fetch',async(u,o)=>{
  if(o.method==='POST'){posts.push({u,payload:JSON.parse(o.body)});return new Response(null,{status:httpStatus})}
  return Response.json(u.endsWith('/users/@me')?{id:owner}:u.includes('/channels/')?{guild_id:'1515877468299595919'}:
   u.includes('application-command-index')?{application_commands:[{id:'1515911478203519006',version:'1556289431923589140',application_id:bot,type:1,name:'perfil',options:[{name:'ver',type:1}]}]}:[]);
 });
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-placeholder-never-a-real-key-123456789',
  DB:{prepare(){return {bind(){return this},async run(){return {meta:{changes:1}}}}}}};
 const r=await personalInvokeProfileProbe(env,{me:{id:owner,membership:{member:true}}});
 assert.equal(posts.length,1);assert.equal(posts[0].u,'https://discord.com/api/v9/interactions');
 assert.equal(posts[0].payload.application_id,bot);assert.equal(posts[0].payload.data.name,'perfil');
 assert.equal(posts[0].payload.data.options[0].name,'ver');
 assert.equal(r.submitted,httpStatus===204);assert.equal(r.confirmed,false);assert.equal(r.executed,false);
});
test('catalog rejection preserves the real provider error and never attempts an interaction',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:429})});
 const r=await personalInvokeProfileProbe({BUSHIN_OWNER_DISCORD_ID:'481485837801095178',DISCORD_USER_TOKEN:'synthetic-placeholder-never-a-real-key-123456789'},{me:{id:'481485837801095178',membership:{member:true}}});
 assert.equal(calls,1);assert.equal(r.submitted,false);assert.equal(r.discord_status,429);assert.equal(r.stage,'command_catalog');assert.match(r.reason,/429/);
 assert.ok(!PANEL_JS.includes('confirm("Enviar para o Discord como Henrique?'));
});
