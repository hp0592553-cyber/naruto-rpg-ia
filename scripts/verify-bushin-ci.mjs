/**
 * Non-destructive CI checks. Never use Discord credentials or write to D1.
 * Static validations catch missing modules, bad bindings and broken HTML hooks.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cloud=resolve(root,'cloudflare');
const cfg=JSON.parse(await readFile(resolve(cloud,'wrangler.jsonc'),'utf8'));
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
assert(cfg.name==='bushin-discord-direct','Worker inesperado');
assert(cfg.main==='worker.mjs','Entry point inesperado');
assert(cfg.keep_vars===true,'keep_vars deve preservar configuracoes existentes');
assert(cfg.ai?.binding==='BUSHIN_AI','Binding do Llama/Workers AI ausente');
assert(cfg.browser?.binding==='BUSHIN_RENDERER','Binding do navegador ausente');
assert(cfg.d1_databases?.some(x=>x.binding==='DB'&&x.database_id==='54cf8136-270e-453a-a123-dade96239366'),'D1 nao corresponde ao projeto');
const modules=await readdir(cloud);
const source=await Promise.all(modules.filter(n=>n.endsWith('.mjs')).map(async name=>({name,code:await readFile(resolve(cloud,name),'utf8')})));
const names=new Set(source.map(x=>x.name));
for(const {name,code} of source){
  const imports=[...code.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)];
  for(const match of imports){
    if(match[1].startsWith('./'))assert(names.has(match[1].slice(2)),name+' importa modulo ausente: '+match[1]);
  }
}
const worker=source.find(x=>x.name==='worker.mjs')?.code||'';
assert(worker.includes('./discord2-ui.mjs'),'Worker nao importa o Discord 2');
assert(worker.includes('./player-loop.mjs'),'Worker nao importa o planejador RPG');
const ui=source.find(x=>x.name==='discord2-ui.mjs')?.code||'';
assert(ui.includes('BASE_HTML')&&ui.includes('BASE_JS'),'Fonte HTML/JS do painel ausente');
const loop=source.find(x=>x.name==='player-loop.mjs')?.code||'';
assert(loop.includes('@cf/meta/llama-3.1-8b-instruct-fp8'),'Modelo Llama nao identificado');
console.log('CI OK:',source.length,'modulos, D1, Workers AI, Browser, imports e Discord 2');
