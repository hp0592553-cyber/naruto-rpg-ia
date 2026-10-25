import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCommandAuthorization,personalCommandsConsentUrl} from '../worker.mjs';
const owner='481485837801095178',app='1561589128108314636';
async function fixture(expired=false){
 const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const creds={access:'synthetic-access-not-a-real-token',expires:Date.now()+(expired?-1:600000)};
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(creds)));
 return {env:{BUSHIN_OWNER_DISCORD_ID:owner,ENCRYPTION_KEY_BASE64:Buffer.from(raw).toString('base64url')},
  row:{user_id:owner,creds_encrypted:Buffer.from(iv).toString('base64url')+'.'+Buffer.from(encrypted).toString('base64url')}};
}
test('consent is scoped to installation of Bushin commands without bot/admin privileges',()=>{
 const u=new URL(personalCommandsConsentUrl());assert.equal(u.origin,'https://discord.com');
 assert.equal(u.searchParams.get('client_id'),app);assert.equal(u.searchParams.get('integration_type'),'1');
 assert.equal(u.searchParams.get('scope'),'applications.commands');assert.equal(u.searchParams.has('permissions'),false);
});
test('verified identity enables consent but never claims installation or Naruto execution',async t=>{
 const {env,row}=await fixture();let calls=0;
 t.mock.method(globalThis,'fetch',async(u,o)=>{calls++;assert.equal(u,'https://discord.com/api/v10/oauth2/@me');
  assert.equal(o.method,undefined);return Response.json({user:{id:owner},application:{id:app}})});
 const result=await inspectCommandAuthorization(env,row);assert.equal(calls,1);
 assert.equal(result.application_matches,true);assert.equal(result.consent_url,personalCommandsConsentUrl());
 assert.equal(result.installation_verified,false);assert.equal(result.naruto_executor_authorized,false);
 assert.ok(!JSON.stringify(result).includes('synthetic-access'));
});
test('wrong user and local expiry block provider requests and consent',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('must not call provider')});
 const {env,row}=await fixture(true);
 assert.equal((await inspectCommandAuthorization(env,row)).state,'expired');
 assert.equal((await inspectCommandAuthorization(env,{...row,user_id:'111111111111111111'})).state,'unauthorized');
});
test('revocation and application mismatch do not enable installation redirect',async t=>{
 const {env,row}=await fixture();
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:401}));
 let result=await inspectCommandAuthorization(env,row);assert.equal(result.state,'expired');assert.equal(result.consent_url,null);
 t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>Response.json({user:{id:owner},application:{id:'111111111111111111'}}));
 result=await inspectCommandAuthorization(env,row);assert.equal(result.state,'identity_mismatch');assert.equal(result.consent_url,null);
});
