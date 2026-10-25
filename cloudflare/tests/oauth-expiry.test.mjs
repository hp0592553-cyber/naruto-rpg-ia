import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
const owner='481485837801095178';
const b64=v=>Buffer.from(v).toString('base64url');
async function fixture() {
 const bytes=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
 const creds={access:'synthetic-upstream-access',expires:Date.now()+600000};
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(creds)));
 return {PUBLIC_BASE_URL:'https://example.test',DISCORD_CLIENT_SECRET:'synthetic-client',
  BUSHIN_OWNER_DISCORD_ID:owner,ENCRYPTION_KEY_BASE64:b64(bytes),
  DB:{prepare(sql){assert.match(sql,/SELECT \* FROM oauth_access/);
   return {bind(){return this},async first(){return {user_id:owner,scope:'identify guilds guilds.members.read',creds_encrypted:b64(iv)+'.'+b64(ciphertext)}}}}}};
}
for (const status of [401,403,503]) test('upstream '+status+' preserves auth semantics without retry or disclosure',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status})});
 const res=await worker.fetch(new Request('https://example.test/mcp',{method:'POST',headers:{
  'content-type':'application/json',authorization:'Bearer synthetic-bushin-access-token'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bushin_discord_whoami',arguments:{}}})}),await fixture(),{});
 const body=await res.text();assert.equal(calls,1);assert.ok(!body.includes('synthetic-upstream-access'));
 if(status===401){assert.equal(res.status,401);assert.match(res.headers.get('www-authenticate'),/invalid_token/)}
 else {assert.equal(res.status,200);assert.equal(JSON.parse(body).result.isError,true);assert.equal(res.headers.get('www-authenticate'),null)}
});
