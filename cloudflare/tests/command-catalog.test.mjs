import test from 'node:test';
import assert from 'node:assert/strict';
import {personalInspectCommand} from '../personal-discord.mjs';
test('discovers only real Naruto command paths without submitting an interaction',async t=>{
 const owner='481485837801095178',token='test-placeholder-token-never-real-123456789';
 t.mock.method(globalThis,'fetch',async(u,o)=>{
  assert.equal(o.method,'GET');
  return Response.json(u.endsWith('/users/@me')?{id:owner}:u.includes('application-command-index')?{application_commands:[{id:'123456789012345678',application_id:'1515908078913192026',type:1,name:'perfil',options:[{name:'ver',type:1,options:[{name:'usuario',type:6,required:false}]}]}]}:{guild_id:'1515877468299595919'});
 });
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:token},ctx={me:{id:owner,membership:{member:true}}};
 const r=await personalInspectCommand(env,{command:'/perfil ver'},ctx);
 assert.equal(r.command_found,true);assert.equal(r.matched.options[0].name,'usuario');
 assert.equal(r.sent,false);assert.equal(r.executed,false);assert.equal(r.executor_status,'not_connected');
 assert.ok(!JSON.stringify(r).includes(token));
 const missing=await personalInspectCommand(env,{command:'/missoes minhas'},ctx);
 assert.equal(missing.command_found,false);assert.equal(missing.state,'command_not_found');
});
