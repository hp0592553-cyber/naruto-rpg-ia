import test from 'node:test';
import assert from 'node:assert/strict';
import {SAFE_GAME_COMMANDS,validAiGameCommand,bushinAiNext} from '../discord2-ai.mjs';
import {PANEL_JS} from '../discord2-ui.mjs';

const user='481485837801095178',app='1515908078913192026',ch='1520114348079583263';
const fixture=(command='/perfil ver',catalog=true)=>{
 const env={
  BUSHIN_OWNER_DISCORD_ID:user,
  DISCORD_USER_TOKEN:'synthetic-test-discord-token-this-is-not-valid-1234',
  DB:{prepare(){return {bind(){return this},async first(){return null},async run(){return {meta:{changes:1}}}}}},
  BUSHIN_AI:{async run(){return {response:JSON.stringify({analise:'Consultar status antes de agir',proximo_passo:'Ver ficha',mensagem:'',comando:command})}}}
 };
 const ctx={me:{id:user,membership:{member:true}}};
 const helpers={baseUrl:'https://example.test',reply:(body,status)=>Response.json(body,{status}),
  personalCall:async()=>({read:true,messages:[]})};
 const request=new Request('https://example.test/mobile/discord2/api/ai/next',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({channel_id:ch,autoplay:true,avoid_commands:[]})});
 return {env,ctx,helpers,request,catalog};
};

test('safe game commands are finite and exclude travel, fighting, attacks and items',()=>{
 assert.ok(SAFE_GAME_COMMANDS.includes('/perfil ver'));
 assert.ok(SAFE_GAME_COMMANDS.includes('/missoes diarias'));
 for(const name of ['/combate atacar','/viajar','/jutsu usar','/inventario usar','/perfil ver {"usuario":"outro"}']){
  assert.equal(validAiGameCommand(name),false,name);
 }
 assert.equal(validAiGameCommand('/perfil ver',['/perfil ver']),false);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
 assert.match(PANEL_JS,/runAiGameStep/);
 assert.match(PANEL_JS,/aiGameSession\.remaining/);
});

test('AI game step proposes only a real leaf command from matching Naruto bot',async t=>{
 const f=fixture();
 let requests=[];
 t.mock.method(globalThis,'fetch',async(url)=>{
  requests.push(String(url));
  if(String(url).includes('naruto-rp.squareweb.app'))return new Response('<html></html>',{headers:{'content-type':'text/html'}});
  if(String(url).endsWith('/users/@me'))return Response.json({id:user});
  if(String(url).endsWith('/channels/'+ch))return Response.json({guild_id:'1515877468299595919'});
  if(String(url).endsWith('/application-command-index'))return Response.json({application_commands:[{
   id:'123456789012345678',version:'123456789012345679',application_id:app,type:1,name:'perfil',
   options:[{name:'ver',type:1,options:[]}]}]});
  return Response.json([]);
 });
 const response=await bushinAiNext(f.request,f.env,f.ctx,f.helpers);
 const data=await response.json();
 assert.equal(data.state,'completed');assert.equal(data.next_action.command,'/perfil ver');
 assert.equal(data.next_action.catalog_verified,true);
 assert.equal(data.executed_command,false);assert.equal(data.sent,false);
 assert.equal(requests.filter(x=>x.endsWith('/application-command-index')).length,1);
 assert.ok(!requests.some(x=>x.includes('/interactions')));
});

test('AI suggested combat cannot be executed even with an otherwise valid catalogue',async t=>{
 const f=fixture('/combate atacar');
 t.mock.method(globalThis,'fetch',async(url)=>{
  const s=String(url);
  if(s.includes('naruto-rp.squareweb.app'))return new Response('<html></html>',{headers:{'content-type':'text/html'}});
  if(s.endsWith('/users/@me'))return Response.json({id:user});
  if(s.endsWith('/channels/'+ch))return Response.json({guild_id:'1515877468299595919'});
  if(s.endsWith('/application-command-index'))return Response.json({application_commands:[]});
  return Response.json([]);
 });
 const response=await bushinAiNext(f.request,f.env,f.ctx,f.helpers);
 const data=await response.json();
 assert.equal(data.next_action,null);
 assert.equal(data.sent,false);
});

test('AI actually invokes the model in HTML autoplay without an unverified character snapshot',async t=>{
 const f=fixture('/perfil ver');
 const calls=[];
 f.env.BUSHIN_AI.run=async(model,args)=>{
  calls.push({model,args});
  return {response:JSON.stringify({analise:'Falta ficha confirmada; preciso consultar o perfil.',proximo_passo:'Consultar ficha do jogador.',mensagem:'',comando:'/perfil ver'})};
 };
 t.mock.method(globalThis,'fetch',async url=>{
  const s=String(url);
  if(s.includes('naruto-rp.squareweb.app'))return new Response('<html></html>',{headers:{'content-type':'text/html'}});
  if(s.endsWith('/users/@me'))return Response.json({id:user});
  if(s.endsWith('/channels/'+ch))return Response.json({guild_id:'1515877468299595919'});
  if(s.endsWith('/application-command-index'))return Response.json({application_commands:[{
   id:'123456789012345678',version:'123456789012345679',application_id:app,type:1,name:'perfil',
   options:[{name:'ver',type:1,options:[]}]
  }]});
  return Response.json([]);
 });
 const response=await bushinAiNext(f.request,f.env,f.ctx,f.helpers);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(calls.length,1,'the AI model must run instead of returning a fixed suggestion');
 assert.equal(data.model_invoked,true);
 assert.equal(data.character_confirmed,false);
 assert.match(data.analysis,/Falta ficha confirmada/);
 assert.equal(data.next_action.command,'/perfil ver');
 assert.equal(data.executed_command,false);
 assert.equal(data.sent,false);
 assert.match(calls[0].args.messages[0].content,/Nunca atribua perfil/);
 assert.match(PANEL_JS,/Modelo acionado/);
});
