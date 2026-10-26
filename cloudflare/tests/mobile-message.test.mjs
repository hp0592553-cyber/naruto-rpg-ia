import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseMobileMessage,deliverMobileMessage,mobileDeliveryReceipt} from '../mobile-message.mjs';
import {personalCall} from '../personal-discord.mjs';
const owner='481485837801095178',channel='1520114348079583263',request='11111111-2222-4333-8444-555555555555';
const ctx={me:{id:owner,membership:{member:true}}};
function environment(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE bushin_project_state (owner_id TEXT,key TEXT,value_json TEXT,updated_at INTEGER,PRIMARY KEY(owner_id,key))');
 return {BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-personal-test-credential-not-a-real-secret',DB:{prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})};}}}}};
}
const payload=()=>({data:{request_id:request,content:'Oi\nsegunda linha',confirmed:true,mention_ids:[]},images:[]});
const png=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],'perfil.png',{type:'image/png'});
test('mobile multipart accepts bounded image data and rejects disguised image uploads',async()=>{
 const form=new FormData();form.set('payload_json',JSON.stringify({...payload().data,content:''}));form.append('files',png());
 const parsed=await parseMobileMessage(new Request('https://fixture.test/send',{method:'POST',body:form}));assert.equal(parsed.images.length,1);assert.equal(parsed.images[0].name,'perfil.png');
 const bad=new FormData();bad.set('payload_json',JSON.stringify(payload().data));bad.append('files',new File(['<script>no</script>'],'fake.png',{type:'image/png'}));
 await assert.rejects(()=>parseMobileMessage(new Request('https://fixture.test/send',{method:'POST',body:bad})),/Formato\/conteúdo inválido/);
 const oversized=new Request('https://fixture.test/send',{method:'POST',headers:{'content-type':'application/json','content-length':String(9*1024*1024)},body:'{}'});
 await assert.rejects(()=>parseMobileMessage(oversized),/8 MiB/);
});
test('concurrent requests with the same message ID send once and receipts never resend',async t=>{
 const env=environment(t);let sends=0,release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const send=async()=>{sends++;entered();await gate;return {sent:true,state:'completed',message_id:'1564380277411680326',author_id:owner};};
 const first=deliverMobileMessage(env,ctx,channel,payload(),{send});await started;
 const second=await deliverMobileMessage(env,ctx,channel,payload(),{send});assert.equal(second.sent,null);assert.equal(sends,1);
 release();const done=await first;assert.equal(done.sent,true);
 const repeat=await deliverMobileMessage(env,ctx,channel,payload(),{send});assert.equal(repeat.message_id,done.message_id);assert.equal(sends,1);
 assert.equal((await mobileDeliveryReceipt(env,ctx,channel,request)).sent,true);
 await assert.rejects(()=>deliverMobileMessage(env,ctx,channel,{...payload(),data:{...payload().data,content:'Outra mensagem'}},{send}),/outra mensagem/);
 await assert.rejects(()=>mobileDeliveryReceipt(env,ctx,'999999999999999999',request),/outro canal/);
});
test('an uncertain transport result is preserved and never retried',async t=>{
 const env=environment(t);let calls=0;const send=async()=>{calls++;throw Error('network timeout');};
 assert.equal((await deliverMobileMessage(env,ctx,channel,payload(),{send})).sent,null);
 assert.equal((await deliverMobileMessage(env,ctx,channel,payload(),{send})).sent,null);assert.equal(calls,1);
});
test('personal transport sends multipart, reply and exact mentions, confirming the owner and channel',async t=>{
 const env=environment(t);let posted;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/users/@me'))return Response.json({id:owner,bot:false});
  if(options.method==='GET')return Response.json({guild_id:'1515877468299595919'});
  posted=options;return Response.json({id:'1564380277411680326',channel_id:channel,author:{id:owner}});
 });
 const result=await personalCall(env,'bushin_naruto_personal_send',{channel_id:channel,text:'<@111111111111111111>\nOi',confirmed:true,mention_ids:['111111111111111111'],reply_to:'1564380277411680300',files:[png()],nonce:'1234567890'},ctx);
 assert.equal(result.sent,true);assert.ok(posted.body instanceof FormData);assert.equal(posted.headers['Content-Type'],undefined);
 const body=JSON.parse(posted.body.get('payload_json'));assert.equal(body.message_reference.message_id,'1564380277411680300');assert.deepEqual(body.allowed_mentions.users,['111111111111111111']);assert.equal(body.enforce_nonce,true);assert.equal(body.attachments[0].filename,'perfil.png');assert.ok(!JSON.stringify(result).includes(env.DISCORD_USER_TOKEN));
});
test('personal transport reports timeout after POST as uncertain and does not claim delivery in another channel',async t=>{
 for(const mode of ['timeout','wrong_channel']){
  const env=environment(t);let posts=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(url.endsWith('/users/@me'))return Response.json({id:owner});if(options.method==='GET')return Response.json({guild_id:'1515877468299595919'});posts++;if(mode==='timeout')throw Error('secret must not be exposed');return Response.json({id:'1564380277411680326',channel_id:'999999999999999999',author:{id:owner}});});
  const result=await personalCall(env,'bushin_naruto_personal_send',{channel_id:channel,text:'Oi',confirmed:true},ctx);assert.equal(result.sent,null);assert.equal(result.state,'unknown');assert.equal(posts,1);assert.doesNotMatch(JSON.stringify(result),/secret must not/);
  t.mock.restoreAll();
 }
});
