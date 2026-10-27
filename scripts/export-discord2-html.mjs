/**
 * Export the existing Discord 2 HTML and JavaScript from the Cloudflare modules.
 * The static preview requires the existing Cloudflare API for live Discord features.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PANEL_HTML, PANEL_JS } from '../cloudflare/discord2-ui.mjs';

const out = resolve(process.argv[2] || 'dist/discord2');
if (!PANEL_HTML.startsWith('<!doctype html>')) throw new Error('HTML inválido: DOCTYPE ausente');
if (!PANEL_HTML.includes('id="discordComposer"')) throw new Error('Compositor do Discord 2 ausente');
if (!PANEL_HTML.includes('id="gamePanel"')) throw new Error('Painel do jogo ausente');
if (!PANEL_JS.includes('function') || PANEL_JS.length < 1000) throw new Error('JavaScript do painel vazio');
const html = PANEL_HTML.replace(
  /<script\s+defer\s+src="\/mobile\/discord2\/app\.js"><\/script>/,
  '<script defer src="./app.js"></script>'
);
if (!html.includes('<script defer src="./app.js"></script>')) throw new Error('Script externo não encontrado');
await mkdir(out, { recursive: true });
await Promise.all([
  writeFile(resolve(out, 'index.html'), html, 'utf8'),
  writeFile(resolve(out, 'app.js'), PANEL_JS, 'utf8'),
]);
console.log(JSON.stringify({
  result: 'exported',
  files: ['index.html', 'app.js'],
  html_bytes: Buffer.byteLength(html),
  js_bytes: Buffer.byteLength(PANEL_JS),
  note: 'Frontend exportado. Recursos Discord exigem backend Cloudflare autenticado.',
}, null, 2));
