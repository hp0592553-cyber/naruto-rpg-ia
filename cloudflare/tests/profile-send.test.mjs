import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
import {personalInvokeProfileProbe} from '../personal-discord.mjs';
function ui(result={submitted:true}){
 const calls=[],button={disabled:false},composer={value:'/perfil ver'},notes=[];
 const box={hidden:false},S={current:'1520114348079583263'};
 const context=vm.createContext({composer,commandsBox:box,S,E:()=>button,JSON,Error,
  req:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return result},
  status:(...v)=>notes.push(v),refresh:async()=>{},originalSend:()=>calls.push({normal:true})});
 const a=PANEL_JS.indexOf('async function sendSelectedSlash()'),b=PANEL_JS.indexOf('E("send").onclick=sendSelectedSlash;',a);
 vm.runInContext('let commandPicked=null;'+PANEL_JS.slice(a,b)+';this.send=sendSelectedSlash;',context);
 return {context,calls,button,composer,notes};
}
test('Send invokes the existing profile interaction endpoint once and does not send slash as text',async()=>{
 const h=ui();await h.context.send();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/ai/profile-probe');
 assert.equal(h.calls[0].body.probe,'perfil ver');assert.equal(h.composer.value,'');
 assert.match(h.notes.at(-1)[0],/ainda precisa ser conferida/);assert.equal(h.button.disabled,false);
});
test('unsupported commands, other channels and repeated pending clicks cannot submit this profile probe',async()=>{
 for(const configure of [h=>h.composer.value='/combate iniciar',h=>h.context.S.current='1532489544161562857',h=>h.button.disabled=true]){
  const h=ui();configure(h);await h.context.send();assert.equal(h.calls.length,0);
 }
});
test('uncertain result is not retried or reported as execution',async()=>{
 const h=ui({submitted:null,reason:'Resultado incerto'});await h.context.send();
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
