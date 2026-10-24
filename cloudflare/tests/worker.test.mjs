import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {mcpTools,catalogDiagnostics} from '../worker.mjs';
import {normalizeMessage} from '../message-normalizer.mjs';
import {observeNaruto} from '../naruto-observer.mjs';
import {personalCall} from '../personal-discord.mjs';
import {discordCall} from '../discord-suite.mjs';
const OWNER='481485837801095178', CHANNEL='1520114348079583263', BOT='1515908078913192026';
const ctx={me:{id:OWNER,membership:{member:true}}};
const env={BUSHIN_OWNER_DISCORD_ID:OWNER,DISCORD_USER_TOKEN:'test-placeholder-credential-never-real-123456',
  PUBLIC_BASE_URL:'https://example.test',DB:{prepare(){throw Error('unexpected DB access');}},
  DISCORD_CLIENT_SECRET:'test',ENCRYPTION_KEY_BASE64:'test'};
const v2={id:'1563527726369865781',channel_id:CHANNEL,author:{id:BOT,username:'Naruto Bot',bot:true},
  timestamp:'2026-10-24T12:20:58.907000+00:00',content:'',embeds:[],flags:32768,
  components:[{type:17,components:[{type:9,components:[{type:10,content:'Missões disponíveis'}],accessory:{type:2,label:'Ver',custom_id:'missions',disabled:true}},
    {type:1,components:[{type:3,custom_id:'choices',options:[{label:'Missão A',value:'a',description:'Descrição'}]}]},
    {type:12,items:[{media:{url:'https://cdn.discordapp.com/example.png'},description:'Mapa'}]}]}],
  interaction:{id:'1563527726369865780',name:'missoes',user:{id:OWNER}},
  attachments:[{id:'1563527726369865782',filename:'mapa.png',url:'https://cdn.discordapp.com/example.png',content_type:'image/png'}]};
test('Components V2 text, nested controls, media and correlation survive empty content',()=>{
 const m=normalizeMessage(v2);assert.equal(m.normalized_text,'Missões disponíveis');assert.equal(m.components_v2,true);
 assert.equal(m.controls[0].disabled,true);assert.equal(m.components[0].components[1].components[0].options[0].value,'a');
 assert.equal(m.attachments[0].filename,'mapa.png');assert.equal(m.interaction.user_id,OWNER);
 assert.deepEqual(m.diagnostics.text_sources,['components']);assert.equal(m.diagnostics.empty_reason,null);
});
test('embed fields, footer and author survive; attachments are never fetched or OCR-invented',()=>{
 const m=normalizeMessage({embeds:[{title:'Ficha',fields:[{name:'Vida',value:'80'}],footer:{text:'Rodada 1'},author:{name:'Naruto'}}],attachments:[{filename:'ficha.png'}]});
 assert.match(m.normalized_text,/Vida\n80/);assert.match(m.normalized_text,/Rodada 1/);
 const media=normalizeMessage({attachments:[{filename:'ficha.png'}]});assert.equal(media.normalized_text,'');assert.equal(media.diagnostics.empty_reason,'media_without_extracted_text');
});
test('unknown component layouts are retained; bounded recursion, safe URLs, no raw unknown keys',()=>{
 const cycle={type:999,content:'texto',authorization:'must-not-leak',url:'javascript:alert(1)'};cycle.components=[cycle];
 const m=normalizeMessage({components:[cycle],token:'must-not-leak'});
 assert.equal(m.components[0].type,999);assert.equal(m.components[0].url,null);
 assert.equal(m.diagnostics.truncated,true);assert.ok(!JSON.stringify(m).includes('must-not-leak'));
});
test('forwarded or referenced content is separate from current response evidence',()=>{
 const m=normalizeMessage({...v2,message_snapshots:[{message:{content:'Nível 99'}}],referenced_message:{id:'1563527726369865783',content:'outro jogador'}});
 assert.equal(m.message_snapshots[0].normalized_text,'Nível 99');assert.ok(!m.normalized_text.includes('99'));
 assert.equal(m.referenced_message.normalized_text,'outro jogador');
});
test('observer rejects loading/nonbot/ephemeral as final evidence and never infers stats',()=>{
 const m=normalizeMessage(v2);const o=observeNaruto([m,{...m,author_id:OWNER},{...m,loading:true},{...m,ephemeral:true}],OWNER);
 assert.equal(o.message_ids.length,1);assert.equal(o.character.level,null);assert.equal(o.character.verified,false);
 assert.equal(o.execution.sent,false);assert.equal(o.execution.automatic_combat_end,false);
 assert.equal(o.observed_commands[0].currently_registered,null);assert.deepEqual(o.owner_correlated_message_ids,[m.id]);
});
test('personal read verifies identity and guild, normalizes payload and only uses GET',async t=>{
 const requests=[];t.mock.method(globalThis,'fetch',async (u,o)=>{requests.push({u,o});
   const data=u.endsWith('/users/@me')?{id:OWNER}:u.endsWith('/channels/'+CHANNEL)?{guild_id:'1515877468299595919'}:[v2];
   return Response.json(data);
 });
 const r=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL,limit:3},ctx);
 assert.equal(r.read,true);assert.equal(r.messages[0].normalized_text,'Missões disponíveis');assert.equal(r.rpg_observation.readable_messages,1);
 assert.equal(requests.length,3);assert.ok(requests.every(x=>x.o.method==='GET'));assert.ok(!JSON.stringify(r).includes(env.DISCORD_USER_TOKEN));
});
test('identity mismatch and external guild block history without leaking credentials',async t=>{
 let paths=[];t.mock.method(globalThis,'fetch',async u=>{paths.push(u);return Response.json(u.endsWith('/users/@me')?{id:'111111111111111111'}:{});});
 const bad=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL},ctx);
 assert.equal(bad.read,false);assert.equal(paths.length,1);assert.ok(!JSON.stringify(bad).includes(env.DISCORD_USER_TOKEN));
 t.mock.restoreAll();paths=[];
 t.mock.method(globalThis,'fetch',async u=>{paths.push(u);return Response.json(u.endsWith('/users/@me')?{id:OWNER}:{guild_id:'111111111111111111'});});
 const foreign=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL},ctx);
 assert.equal(foreign.read,false);assert.equal(paths.length,2);
});
test('401/403/429 cause a single failure with no retry or mutation',async t=>{
 for(const status of [401,403,429]){
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status});});
  const r=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL},ctx);
  assert.equal(r.state,'unavailable');assert.equal(calls,1);assert.equal(r.sent,false);t.mock.restoreAll();
 }
});
test('slash command diagnostic does not submit plain text or an interaction',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
 const r=await discordCall(env,'discord_execute_command',{command:'/missoes minhas'},ctx);
 assert.equal(r.state,'requires_discord_client');assert.equal(r.executed,false);assert.equal(r.sent,false);
 assert.equal(r.command_discovery.registered_command_verified,false);
});
test('MCP catalogue is static, unique, and tool schemas are objects',()=>{
 const tools=mcpTools();assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);
 assert.ok(tools.some(t=>t.name==='bushin_naruto_observe'));assert.ok(tools.some(t=>t.name==='bushin_naruto_personal_read'));
 for(const t of tools)assert.equal(t.inputSchema.type,'object');
 assert.equal(catalogDiagnostics().count,tools.length);
});
async function rpc(method,params={}){
 return worker.fetch(new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env,{});
}
test('MCP initialize negotiates protocol, tools/list exposes Naruto, call requires OAuth',async()=>{
 const init=await (await rpc('initialize',{protocolVersion:'2025-11-25'})).json();assert.equal(init.result.protocolVersion,'2025-11-25');
 assert.equal(init.result.capabilities.tools.listChanged,false);
 const catalog=await (await rpc('tools/list')).json();assert.ok(catalog.result.tools.some(t=>t.name==='bushin_naruto_observe'));
 const invalid=await (await rpc('tools/list',{cursor:'unknown'})).json();assert.equal(invalid.error.code,-32602);
 assert.equal((await rpc('tools/call',{name:'bushin_naruto_observe'})).status,401);
});
