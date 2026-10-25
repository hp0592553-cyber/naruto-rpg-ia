import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {PANEL_JS} from '../discord2-ui.mjs';
import {personalInvokeProfileProbe} from '../personal-discord.mjs';
const owner='481485837801095178',bot='1515908078913192026';
const worker=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
const fixture=()=>({BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-placeholder-never-real-token-123456789',DB:{prepare(){return {bind(){return this},async first(){return null},async run(){return {meta:{changes:1}}}}}}});
test('plain channel search matches styled and accented names',()=>{
 const a=PANEL_JS.indexOf('function searchKey('),b=PANEL_JS.indexOf('function build()',a);
 const c=vm.createContext();vm.runInContext(PANEL_JS.slice(a,b)+';this.key=searchKey',c);
 for(const [query,name] of [['Guias','𝐆uias-𝐝a-𝐂omunidade'],['duvidas','𝐃úvidas'],['COMANDOS','𝐂omandos²']])assert.ok(c.key(name).includes(c.key(query)));
});
test('Henrique is available for mentions with empty message history',()=>{
 const a=PANEL_JS.indexOf('const knownPeople='),b=PANEL_JS.indexOf('function safeDisplay',a);
 const c=vm.createContext();vm.runInContext(PANEL_JS.slice(a,b)+';this.person=knownPeople.get("'+owner+'")',c);
 assert.equal(c.person.name,'Henrique');assert.equal(c.person.username,'angel_10706');
});
for(const status of [204,302,403,429])test('profile request reaches provider with Workers-compatible redirects; HTTP '+status,async t=>{
 let posts=0;t.mock.method(globalThis,'fetch',async(u,o)=>{
  if(o.redirect==='error')throw new TypeError('Invalid redirect value');
  if(o.method==='POST'){posts++;assert.equal(o.redirect,'manual');return new Response(null,{status})}
  return Response.json(u.endsWith('/users/@me')?{id:owner}:u.includes('/channels/')?{guild_id:'1515877468299595919'}:u.includes('application-command-index')?{application_commands:[{id:'1515911478203519006',version:'1556289431923589140',application_id:bot,type:1,name:'perfil',options:[{name:'ver',type:1}]}]}:[]);
 });
 const r=await personalInvokeProfileProbe(fixture(),{me:{id:owner,membership:{member:true}}});
 assert.equal(posts,1);assert.equal(r.submitted,status===204);assert.equal(r.confirmed,false);assert.equal(r.discord_status,status);
});
test('GitHub workflow lookup does not use unsupported redirect error or follow Location',async()=>{
 const a=worker.indexOf('const requestGitHub=async'),b=worker.indexOf('const getState=',a);
 let calls=0;const c=vm.createContext({AbortController,setTimeout,clearTimeout,env:{BUSHIN_GITHUB_TOKEN:'synthetic'},REPO:'hp0592553-cyber/naruto-rpg-ia',fetch:async(u,o)=>{calls++;assert.equal(o.redirect,'manual');return new Response(null,{status:302})}});
 vm.runInContext(worker.slice(a,b)+';this.run=requestGitHub',c);const r=await c.run('/actions/workflows/opencode-projeto.yml/runs');
 assert.equal(calls,1);assert.equal(r.ok,false);assert.equal(r.status,302);
});
