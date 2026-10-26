import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_HTML,PANEL_JS} from '../discord2-ui.mjs';
import {bushinAiNext} from '../discord2-ai.mjs';

test('Codex picker remains optional and defaults to existing Llama',()=>{
 assert.match(PANEL_HTML,/id="aiProvider"/);
 assert.match(PANEL_HTML,/value="llama"/);
 assert.match(PANEL_HTML,/value="codex"/);
 assert.match(PANEL_JS,/provider:providerSelect.value/);
 assert.doesNotThrow(()=>new Function(PANEL_JS));
 assert.match(PANEL_HTML,/https:\/\/auth\.openai\.com\/api\/accounts\/deviceauth\/usercode/);
 assert.match(PANEL_HTML,/codex login --device-auth/);
 assert.match(PANEL_HTML,/id="codexLoginNotice"/);
 assert.match(PANEL_JS,/copyCodexLogin/);
 assert.ok(!PANEL_HTML.includes('sk-'));
});

test('Codex without secret stops before Discord read, model call or command',async()=>{
 const user='481485837801095178';
 const response=await bushinAiNext(new Request('https://example.test/mobile/discord2/api/ai/next',{
  method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},
  body:JSON.stringify({channel_id:'1520114348079583263',provider:'codex'})
 }),{DB:{prepare(){throw Error('no DB read allowed')}},BUSHIN_AI:{run(){throw Error('no Llama call allowed')}}},
 {me:{id:user}},{baseUrl:'https://example.test',reply:(body,status)=>Response.json(body,{status}),
  personalCall:()=>{throw Error('no Discord read allowed')}});
 assert.equal(response.status,503);
 const json=await response.json();
 assert.match(json.error,/OPENAI_API_KEY/);
 assert.equal(json.configured,false);
});

test('codex provider uses only a fixed model and no browser key fields',()=>{
 assert.ok(!PANEL_HTML.includes('type="password"'));
 assert.ok(!PANEL_JS.includes('OPENAI_API_KEY:'));
});
