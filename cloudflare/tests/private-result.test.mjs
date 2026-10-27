import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto as crypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeMessage} from '../message-normalizer.mjs';
const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('async function receivePrivateCommandResult('),source.indexOf('export default {'));
const origin='https://bushin-discord-direct.henrique-silva081106.workers.dev',rid='12345678-1234-1234-1234-123456789abc';
async function fixture(patch={},title='Discord 2 '+rid){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test';let writes=0;
 const claims={iss:'https://token.actions.githubusercontent.com',aud:origin+'/internal/discord2-result',repository:'hp0592553-cyber/naruto-rpg-ia',repository_id:'1429981222',repository_owner_id:'259182200',ref:'refs/heads/Projeto',event_name:'workflow_dispatch',workflow_ref:'hp0592553-cyber/naruto-rpg-ia/.github/workflows/bushin-cloudflare-ci.yml@refs/heads/Projeto',exp:Date.now()/1000+300,iat:Date.now()/1000,run_id:'1',...patch};
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),data=b64({alg:'RS256',kid:'test'})+'.'+b64(claims);
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));
 const token=data+'.'+Buffer.from(sig).toString('base64url');
 const env={BUSHIN_OWNER_DISCORD_ID:'481485837801095178',BUSHIN_GITHUB_TOKEN:'synthetic',DB:{prepare(){return{bind(){return this},first:async()=>({value_json:JSON.stringify({request_id:rid,at:Date.now(),channel_id:'1520114348079583263'})}),run:async()=>{writes++}}}}};
 const c=vm.createContext({crypto,normalizeMessage,recordCommandEvidence:async()=>{},enc:new TextEncoder(),dec:new TextDecoder(),Date,AbortSignal,bytesFrom64:s=>Buffer.from(s,'base64url'),base:()=>origin,reply:(body,status)=>({body,status}),fetch:async u=>({ok:true,json:async()=>u.includes('jwks')?{keys:[jwk]}:{display_title:title,head_branch:'Projeto',event:'workflow_dispatch'}}),seal:async()=> 'encrypted-only'});
 vm.runInContext(helper+';this.receive=receivePrivateCommandResult',c);
 const response={author_id:'1515908078913192026',message_id:'1563965884932956301',channel_id:'1520114348079583263',embeds:[{title:'Suas missões'}],components:[],ephemeral:true};
 return{run:()=>c.receive(new Request(origin+'/internal/discord2-result',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({request_id:rid,response})}),env),writes:()=>writes};
}
test('verified workflow can store the private response encrypted',async()=>{const f=await fixture();assert.equal((await f.run()).status,200);assert.equal(f.writes(),1)});
test('wrong repository and expired identity cannot write',async()=>{for(const patch of [{repository_id:'999'},{exp:1}]){const f=await fixture(patch);assert.equal((await f.run()).status,401);assert.equal(f.writes(),0)}});
test('a different workflow run cannot attach a response to this request',async()=>{const f=await fixture({},'Discord 2 different');assert.equal((await f.run()).status,403);assert.equal(f.writes(),0)});
