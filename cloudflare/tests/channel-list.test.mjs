import test from 'node:test';
import assert from 'node:assert/strict';
import {personalListChannels} from '../personal-discord.mjs';
const owner='481485837801095178';
test('channel discovery verifies owner, uses fixed guild and never exposes credentials',async t=>{
 const paths=[],token='test-placeholder-token-never-real-123456789';
 t.mock.method(globalThis,'fetch',async(u,o)=>{
  paths.push(u);assert.equal(o.method,'GET');
  return Response.json(u.endsWith('/users/@me')?{id:owner}:[{id:'1520114348079583263',name:'regras',type:0,topic:'Regras atuais',secret:token}]);
 });
 const env={BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:token};
 const result=await personalListChannels(env,{me:{id:owner,membership:{member:true}}});
 assert.equal(result.listed,true);assert.equal(result.channels[0].name,'regras');
 assert.equal(result.channels[0].message_read_access,'not_verified');assert.ok(!JSON.stringify(result).includes(token));
 assert.equal(paths[1],'https://discord.com/api/v10/guilds/1515877468299595919/channels');
 await assert.rejects(personalListChannels(env,{me:{id:'111111111111111111',membership:{member:true}}}));
});
