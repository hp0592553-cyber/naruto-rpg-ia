import test from 'node:test';
import assert from 'node:assert/strict';
import {messageImageHtml,apiMessageImage} from '../message-image.mjs';
const OWNER='481485837801095178';
const env={BUSHIN_OWNER_DISCORD_ID:OWNER,DISCORD_USER_TOKEN:'test-placeholder-credential-never-real-123456'};
const ctx={me:{id:OWNER,membership:{member:true}}};
test('HTML escapes untrusted messages and labels API image honestly',()=>{
 const html=messageImageHtml([{id:'123',author_name:'<img src=x>',normalized_text:'<script>alert(1)</script>',token:'secret-never-show'}],'2026');
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('secret-never-show'));
 assert.match(html,/Não é uma captura/);assert.match(html,/&lt;script&gt;/);
});
test('API image uses private credential only for Discord, never the renderer',async t=>{
 t.mock.method(globalThis,'fetch',async u=>Response.json(u.endsWith('/users/@me')?{id:OWNER}:u.includes('/messages?')?[{id:'1563541599189733508',author:{id:OWNER,username:'Henrique'},content:'Oi'}]:{guild_id:'1515877468299595919'}));
 let renderBody;
 const r=await apiMessageImage({...env,BUSHIN_RENDERER:{async quickAction(action,body){
  assert.equal(action,'snapshot');renderBody=body;
  return Response.json({success:true,result:{screenshot:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII='}});
 }}},ctx);
 assert.equal(r.rendered,true);assert.equal(r.discord_screen_capture,false);assert.equal(r.image.mimeType,'image/png');
 assert.equal(renderBody.setJavaScriptEnabled,false);assert.ok(!JSON.stringify(renderBody).includes(env.DISCORD_USER_TOKEN));
 assert.match(renderBody.html,/Oi/);assert.deepEqual(r.message_ids,['1563541599189733508']);
});
test('missing renderer returns unavailable without requesting Discord',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected request');});
 assert.equal((await apiMessageImage(env,ctx)).state,'unavailable');
});
