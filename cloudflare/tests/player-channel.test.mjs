import test from 'node:test';
import assert from 'node:assert/strict';
import {channelText,channelKind,readableChannels,choosePlayerChannel,planningChannels,expectedActionChannel} from '../player-channel.mjs';
import {playerRoute,rulePlan,workersAiPlan} from '../player-loop.mjs';
import {AUTOPLAY_HTML,AUTOPLAY_JS} from '../autoplay-ui.mjs';

const ID='481485837801095178',COMMANDS='1520114348079583263',FIELD='1522249926845923339',FOREST='1512345678912345678',RULES='1532489544161562857',CHATS='1520114256740352061';
const channels=[
 {id:RULES,name:'│﹒‹⚖️›︰𝐑egras',type:0},
 {id:CHATS,name:'│・💬〃﹕𝐂hat-𝐆eral',type:0},
 {id:COMMANDS,name:'│・🤖〃﹕𝐂omandos',type:0},
 {id:FIELD,name:'│・🔥〃﹕𝐂ampo-𝐀berto',type:0},
 {id:FOREST,name:'│・🌲〃﹕𝐅loresta',type:0}
];
test('normalizes stylized Unicode channel names and excludes non-RPG locations',()=>{
 assert.equal(channelText('│・🔥〃﹕𝐂ampo-𝐀berto'),'campo aberto');
 assert.equal(channelKind(channels[0]),'reference');
 assert.equal(channelKind(channels[1]),'social');
 assert.equal(channelKind(channels[2]),'commands');
 assert.equal(channelKind(channels[3]),'scene');
 assert.deepEqual(readableChannels([{id:ID,name:'test',type:0},{id:ID,name:'duplicate',type:0},{id:'bad',name:'invalid',type:0},{id:FIELD,name:'category',type:4}]).map(x=>x.id),[ID]);
});
test('verified location wins over panel selection; absent location prefers current accessible scene',()=>{
 const game=choosePlayerChannel({channels,selectedId:FIELD,location:'Floresta'});
 assert.equal(game.channel_id,FOREST);assert.equal(game.location_confirmed,true);assert.equal(game.command_channel_id,COMMANDS);
 const current=choosePlayerChannel({channels,selectedId:FIELD});
 assert.equal(current.channel_id,FIELD);assert.equal(current.location_confirmed,false);
 const missing=choosePlayerChannel({channels,selectedId:'1599999999999999999',previousId:'1599999999999999998'});
 assert.equal(missing.channel_id,COMMANDS);assert.equal(missing.source,'commands');
 const info=choosePlayerChannel({channels,selectedId:RULES});
 assert.equal(info.channel_id,COMMANDS);
 const absent=choosePlayerChannel({channels:[channels[0],channels[1]],selectedId:RULES});
 assert.equal(absent.channel_id,null);
});
test('AI candidate list starts with selected scene and commands, not the first twelve rules or social channels',()=>{
 const candidates=planningChannels(channels,FIELD).map(x=>x.id);
 assert.equal(candidates[0],FIELD);assert.equal(candidates[1],COMMANDS);
 assert.ok(candidates.includes(FOREST));
 assert.ok(!candidates.includes(RULES));assert.ok(!candidates.includes(CHATS));
 assert.equal(expectedActionChannel('/perfil ver',{channels,current:FIELD}),COMMANDS);
 assert.equal(expectedActionChannel('/missoes minhas',{channels,current:FIELD}),COMMANDS);
 assert.equal(expectedActionChannel('/interagir npc',{channels,current:FIELD}),FIELD);
});
test('fallback will not send status commands in RP chat and will not wander into unrelated guides',()=>{
 const available=[{command:'/mapa',options:[]},{command:'/navigate',options:[]}];
 const route=rulePlan({available,channels,contextChannel:FIELD,observations:[]});
 assert.equal(route.command,'/mapa');assert.equal(route.channel_id,COMMANDS);
 const after=rulePlan({available,channels,contextChannel:FIELD,observations:[{command:'/mapa',channel_id:COMMANDS,text:''}],visitedChannels:[FOREST]});
 assert.equal(after,null);
});
test('Llama proposal is rejected when it tries /perfil ver inside scene channel',async()=>{
 const env={BUSHIN_AI:{async run(){return {response:JSON.stringify({command:'/perfil ver',channel_id:FIELD,options:{}})}}}};
 const result=await workersAiPlan(env,{available:[{command:'/perfil ver',options:[]}],channels,contextChannel:FIELD});
 assert.equal(result.error,'wrong_command_channel');
});
function fixture({visible=true,read=true}={}){
 const data=new Map(),env={BUSHIN_OWNER_DISCORD_ID:ID,DISCORD_USER_TOKEN:'synthetic-never-real-credential-value-for-test-123456789',DB:{prepare(sql){let bound=[];return {bind(...v){bound=v;return this},async first(){return data.has(bound[1])?{value_json:data.get(bound[1])}:null},async run(){let changed=0;if(sql.startsWith('UPDATE')){if(data.get(bound[3])===bound[4]){data.set(bound[3],bound[0]);changed=1}}else if(!data.has(bound[1])){data.set(bound[1],bound[2]);changed=1}return {meta:{changes:changed}}}}}}};
 const ctx={me:{id:ID,membership:{member:true}}};let reads=0;
 const helpers={reply:(x,status)=>Response.json(x,{status}),baseUrl:'https://example.test',listChannels:async()=>({listed:true,visibility_filtered:visible,channels}),readChat:async(_env,name,args)=>{reads++;assert.equal(name,'bushin_naruto_personal_read');assert.equal(args.limit,6);return read?{read:true,messages:[{id:'1564000000000000000',author_id:ID}]}:{read:false,code:403,reason:'Não autorizado'};}};
 const post=async action=>{const r=await playerRoute(new Request('https://example.test/mobile/discord2/api/autoplay',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({action,revision:0,channel_id:FIELD})}),env,ctx,helpers);return {status:r.status,data:await r.json()}};
 return {post,getReads:()=>reads};
}
test('channel check verifies actual readable selected channel without sending anything',async()=>{
 const f=fixture();const r=await f.post('check_channel');
 assert.equal(r.status,200);assert.equal(r.data.state.channel_check.read_verified,true);
 assert.equal(r.data.state.channel_check.channel_id,FIELD);
 assert.equal(r.data.state.context_channel_id,FIELD);
 assert.equal(r.data.state.channel_check.command_channel_id,COMMANDS);
 assert.equal(f.getReads(),1);
});
test('channel check fails closed on unverified visibility or missing read permissions',async()=>{
 const unfiltered=fixture({visible:false});const a=await unfiltered.post('check_channel');
 assert.equal(a.status,503);assert.equal(unfiltered.getReads(),0);
 const denied=fixture({read:false});const b=await denied.post('check_channel');assert.equal(b.status,503);assert.equal(denied.getReads(),1);
});
test('Android player displays the checked channel and checks before starting',()=>{
 assert.match(AUTOPLAY_HTML,/autoplayChannelCheck/);
 assert.match(AUTOPLAY_JS,/action:"check_channel"/);
 assert.match(AUTOPLAY_JS,/channel\?\.read_verified/);
});
