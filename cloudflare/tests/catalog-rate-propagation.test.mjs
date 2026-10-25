import test from 'node:test';
import assert from 'node:assert/strict';
const owner='481485837801095178',bot='1515908078913192026';
const ctx={me:{id:owner,membership:{member:true}}};
function fixture(saved=null){
 const writes=[];return {writes,env:{BUSHIN_OWNER_DISCORD_ID:owner,DISCORD_USER_TOKEN:'synthetic-placeholder-never-real-token-123456789',DB:{prepare(){let args;return {bind(...a){args=a;return this},async first(){return saved?{value_json:JSON.stringify(saved)}:null},async run(){saved=JSON.parse(args[2]);writes.push(saved);return {meta:{changes:1}}}}}}}};
}
test('catalog 429 preserves retry delay in D1 and next call sends no network requests',async t=>{
 const {personalInspectCommand}=await import('../personal-discord.mjs?rate-persist');
 let requests=0;
 t.mock.method(globalThis,'fetch',async u=>{requests++;return u.endsWith('/users/@me')?Response.json({id:owner}):u.includes('/channels/')?Response.json({guild_id:'1515877468299595919'}):Response.json({retry_after:74},{status:429})});
 const f=fixture(),args={command:'/perfil ver'};
 const first=await personalInspectCommand(f.env,args,ctx);
 assert.equal(first.code,429);assert.equal(first.retry_after_seconds,74);assert.equal(first.catalog_verified,false);
 assert.equal(requests,3);assert.equal(f.writes.length,1);assert.ok(f.writes[0].pauseUntil>Date.now()+70000);
 const second=await personalInspectCommand(f.env,args,ctx);
 assert.equal(second.code,429);assert.equal(requests,3);
});
test('active pause overrides fresh cache and prevents profile submission',async t=>{
 const {personalInvokeProfileProbe}=await import('../personal-discord.mjs?cache-pause');
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not call provider')});
 const f=fixture({at:Date.now(),pauseUntil:Date.now()+65000,commands:[{id:'1515911478203519006',version:'1556289431923589140',application_id:bot,name:'perfil',options:[{type:1,name:'ver'}]}]});
 const r=await personalInvokeProfileProbe(f.env,ctx);
 assert.equal(r.submitted,false);assert.equal(r.discord_status,429);assert.ok(r.retry_after_seconds>0);
 assert.match(r.reason,/429/);assert.equal(requests,0);
});
for(const status of [401,403,503])test('catalog HTTP '+status+' remains diagnosable and cannot submit',async t=>{
 const {personalInspectCommand}=await import('../personal-discord.mjs?error-'+status);
 t.mock.method(globalThis,'fetch',async u=>u.endsWith('/users/@me')?Response.json({id:owner}):u.includes('/channels/')?Response.json({guild_id:'1515877468299595919'}):new Response(null,{status}));
 const f=fixture(),r=await personalInspectCommand(f.env,{command:'/perfil ver'},ctx);
 assert.equal(r.code,status);assert.equal(r.catalog_verified,false);assert.equal(r.executed,false);
});
