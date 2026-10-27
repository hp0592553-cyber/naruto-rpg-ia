import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_JS} from '../discord2-ui.mjs';
import {playerChatDraftRoute,workersAiChatReply} from '../player-loop.mjs';
import {roleplayMessageText,chatContext} from '../player-context.mjs';
import {personalCall} from '../personal-discord.mjs';
import {readFileSync} from 'node:fs';

const OWNER='481485837801095178',CHANNEL='1520114348079583263';
const MID='1564401895601348709',AUTHOR='1515908078913192026';
const ctx={me:{id:OWNER,membership:{member:true}}};
const baseUrl='https://example.test';
const reply=(x,status)=>Response.json(x,{status});
function request(data,origin=baseUrl){return new Request(baseUrl+'/mobile/discord2/api/ai/chat-draft',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)})}

test('Discord 2 retains older history pagination and offers batches and on-demand AI chat replies',()=>{
 assert.match(PANEL_JS,/messages\?limit=50/);
 assert.match(PANEL_JS,/Carregar até 500 anteriores/);
 assert.match(PANEL_JS,/async function loadHistoryBatch\(/);
 assert.match(PANEL_JS,/async function sendAiReplyForMessage\(/);
 assert.match(PANEL_JS,/\/ai\/chat-draft/);
 assert.match(PANEL_JS,/await send\(\)/);
 const worker=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
 assert.match(worker,/path==="\/mobile\/discord2\/api\/ai\/chat-draft"/);
 assert.match(worker,/channel_id,limit:50/);
});

test('history reads up to 50 messages, preserving cursor and guild scope',async t=>{
 let lastUrl='';
 t.mock.method(globalThis,'fetch',async (u)=>{
  const url=String(u);lastUrl=url;
  if(url.endsWith('/users/@me'))return Response.json({id:OWNER});
  if(url.endsWith('/channels/'+CHANNEL))return Response.json({guild_id:'1515877468299595919'});
  if(url.includes('/messages?'))return Response.json([{id:MID,channel_id:CHANNEL,author:{id:AUTHOR,bot:true},content:'Treino'}]);
  throw Error('Unexpected fetch '+url);
 });
 const env={DISCORD_USER_TOKEN:'synthetic-user-token-no-real-credentials-123456',BUSHIN_OWNER_DISCORD_ID:OWNER};
 const result=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL,limit:50},ctx);
 assert.equal(result.read,true);
 assert.match(lastUrl,/limit=50/);
 assert.equal(result.pagination.page_size,50);
 assert.equal(result.pagination.next_before,null);
 assert.equal(result.messages.length,1);
});

test('AI reply draft validates a real old NPC message, never sends by itself',async()=>{
 const calls=[];
 const env={BUSHIN_OWNER_DISCORD_ID:OWNER,BUSHIN_AI:{async run(model,args){calls.push({model,args});return {response:JSON.stringify({text:'Bora treinar no campo.'})}}}};
 const cursor=(BigInt(MID)+1n).toString();
 const helpers={reply,baseUrl,readChat:async(_env,name,args)=>{
  assert.equal(name,'bushin_naruto_personal_read');
  assert.deepEqual(args,{channel_id:CHANNEL,limit:24,before:cursor});
  return {read:true,messages:[{id:MID,author_id:AUTHOR,author_bot:true,content:'O que você quer aqui, ninja?',timestamp:new Date().toISOString()}]};
 }};
 const resp=await playerChatDraftRoute(request({channel_id:CHANNEL,message_id:MID}),env,ctx,helpers);
 assert.equal(resp.status,200);
 const data=await resp.json();
 assert.equal(data.text,'Bora treinar no campo.');
 assert.equal(data.message_id,MID);
 assert.equal(data.sent,false);
 assert.equal(calls.length,1);
 assert.match(calls[0].model,/llama-3.1/);
});

test('AI reply draft refuses nonexistent messages, own posts, and cross-origin requests',async()=>{
 const env={BUSHIN_OWNER_DISCORD_ID:OWNER,BUSHIN_AI:{async run(){throw Error('Must not run AI')}}};
 let reads=0;
 const fakeRead=async()=>{reads++;return {read:true,messages:[{id:MID,author_id:OWNER,content:'Eu'}]}};
 const own=await playerChatDraftRoute(request({channel_id:CHANNEL,message_id:MID}),env,ctx,{reply,baseUrl,readChat:fakeRead});
 assert.equal(own.status,404);
 const invalid=await playerChatDraftRoute(request({channel_id:CHANNEL,message_id:'x'}),env,ctx,{reply,baseUrl,readChat:fakeRead});
 assert.equal(invalid.status,400);
 const cross=await playerChatDraftRoute(request({channel_id:CHANNEL,message_id:MID},'https://another.example'),env,ctx,{reply,baseUrl,readChat:fakeRead});
 assert.equal(cross.status,403);
 assert.equal(reads,1);
});

test('roleplay assistant reads the actual conversation and produces narrated *actions* when suitable',async()=>{
 const calls=[];
 const env={BUSHIN_AI:{async run(model,args){calls.push(args);return {response:JSON.stringify({text:'*Henrique observa a margem do rio e se aproxima com cuidado.* O que aconteceu aqui?'})}}}};
 const target={id:MID,author_id:AUTHOR,author_name:'Yuri',content:'chego'};
 const history=[
  {id:MID,author_id:AUTHOR,author_name:'Yuri',content:'chego'},
  {id:'1564401895601348708',author_id:'1515908078913192026',author_name:'Naruto Bot',author_bot:true,embeds:[{title:'Rio',description:'Uma correnteza rápida e pedras molhadas.'}]},
  {id:'1564401895601348707',author_id:OWNER,author_name:'Henrique',content:'Estou perto da água.'}
 ];
 const ctx=chatContext(history);
 assert.equal(ctx[0].name,'Henrique');
 assert.match(ctx[1].text,/correnteza rápida/);
 assert.equal(ctx.at(-1).text,'chego');
 const answer=await workersAiChatReply(env,{conversation:ctx,target,mode:'roleplay',channelName:'Rio'});
 assert.match(answer,/^\<@/);
 assert.match(answer,/\*Henrique observa/);
 assert.equal(calls.length,1);
 assert.match(calls[0].messages[0].content,/ações? (?:são|de)/i);
 const payload=JSON.parse(calls[0].messages[1].content);
 assert.equal(payload.channel,'Rio');
 assert.equal(payload.reply_to.text,'chego');
 assert.equal(payload.conversation.length,3);
});
test('roleplay context includes embed content but does not fabricate bot actions',()=>{
 assert.match(roleplayMessageText({content:'',embeds:[{title:'Coleta',description:'Quatro palavras aparecerão.'}]}),/Quatro palavras/);
});
