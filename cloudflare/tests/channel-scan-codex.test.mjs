import test from 'node:test';
import assert from 'node:assert/strict';
import {scanRpgChannels} from '../discord2-research.mjs';

const owner='481485837801095178';
const channels=['1520114348079583263','1532489544161562857'];
function database(){
 const rows=new Map();
 return {rows,prepare(sql){return {bind(...args){return {
  async first(){if(!sql.startsWith('SELECT'))throw Error('Unexpected SELECT: '+sql);const val=rows.get(args[0]+':'+args[1]);return val?{value_json:val}:null},
  async run(){if(!sql.startsWith('INSERT'))throw Error('Unexpected INSERT');rows.set(args[0]+':'+args[1],args[2]);return {meta:{changes:1}}}
 }}}}};
}
const reply=(data,status=200)=>Response.json(data,{status});
test('RPG scanner stores separate source-specific notes for each channel',async()=>{
 const DB=database(),seen=[];
 const env={DB,BUSHIN_AI:{async run(_model,payload){
  const data=JSON.parse(payload.messages[1].content);
  seen.push(data.channel_id);
  return {response:'Resumo exclusivo do canal '+data.channel_id};
 }}};
 const req=new Request('https://bushin.test/mobile/discord2/api/ai/scan',{
  method:'POST',headers:{origin:'https://bushin.test','content-type':'application/json'},
  body:JSON.stringify({channel_ids:channels})
 });
 const r=await scanRpgChannels(req,env,{me:{id:owner}},{
  reply,baseUrl:'https://bushin.test',
  personalCall:async(_env,_name,{channel_id})=>({read:true,messages:[{
   author_id:'1515908078913192026',author_name:'Naruto Bot',normalized_text:'Regra do canal '+channel_id
  }]})
 });
 assert.equal(r.status,200);
 const payload=await r.json();
 assert.deepEqual(payload.analyzed_channels,channels);
 assert.deepEqual(seen,channels);
 const record=JSON.parse(DB.rows.get(owner+':discord2_rpg_scan'));
 assert.equal(record.notes[channels[0]].summary,'Resumo exclusivo do canal '+channels[0]);
 assert.equal(record.notes[channels[1]].summary,'Resumo exclusivo do canal '+channels[1]);
 assert.equal(record.notes[channels[0]].scope,'single_channel');
 assert.equal(record.notes[channels[1]].scope,'single_channel');
 assert.notEqual(record.notes[channels[0]].summary,record.notes[channels[1]].summary);
});
