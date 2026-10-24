import {personalCall} from './personal-discord.mjs';
const CHANNEL='1520114348079583263';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function messageImageHtml(messages,generatedAt){
 const cards=messages.slice(0,3).reverse().map(m=>{
  const full=m.normalized_text||m.content||'[Sem texto disponível; anexos não foram renderizados]';
  const text=full.slice(0,1400)+(full.length>1400?'\n[Texto abreviado nesta imagem]':'');
  return `<article><header>${esc(m.author_name)} <small>${esc(m.timestamp)}</small></header><pre>${esc(text)}</pre><footer>Mensagem ${esc(m.id)} · autor ${esc(m.author_id)}${m.attachments?.length?' · Anexos: '+m.attachments.length:''}</footer></article>`;
 }).join('');
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><style>*{box-sizing:border-box}body{margin:0;background:#171b25;color:#eef1fa;font:17px system-ui,sans-serif}main{padding:28px;width:760px}h1{font-size:25px;margin:0 0 8px}.notice{color:#f6cb7a;font-size:14px;line-height:1.5}article{background:#252c3d;border:1px solid #414d67;border-radius:14px;padding:18px;margin:18px 0}header{font-weight:700;color:#aebfff}small{display:block;color:#aeb7c8;font-size:12px;margin-top:4px}pre{font:16px/1.55 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:11px;color:#aeb7c8;overflow-wrap:anywhere}</style><main id="capture"><h1>Bushin · Naruto Project</h1><div class="notice">Visualização de mensagens obtidas pela API.<br>Não é uma captura da tela do aplicativo Discord.</div><small>Canal ${CHANNEL} · ${esc(generatedAt)}</small>${cards||'<article>Nenhuma mensagem disponível.</article>'}</main></html>`;
}
export async function apiMessageImage(env,ctx){
 if(typeof env.BUSHIN_RENDERER?.quickAction!=='function')return {state:'unavailable',kind:'api_message_render',reason:'Renderizador Cloudflare não configurado.',captured:false};
 const read=await personalCall(env,'bushin_naruto_personal_read',{channel_id:CHANNEL,limit:3},ctx);
 if(read.read!==true)return {...read,kind:'api_message_render',captured:false};
 const generated_at=new Date().toISOString();
 try{
  const response=await env.BUSHIN_RENDERER.quickAction('snapshot',{
   html:messageImageHtml(read.messages,generated_at),setJavaScriptEnabled:false,
   viewport:{width:760,height:900},screenshotOptions:{type:'png',fullPage:true},
   gotoOptions:{waitUntil:'domcontentloaded',timeout:15000}
  });
  if(!response.ok){const error=await response.json().catch(()=>({}));return {state:'unavailable',kind:'api_message_render',captured:false,reason:'Renderização recusada (HTTP '+response.status+').',renderer_errors:Array.isArray(error.errors)?error.errors.slice(0,2).map(e=>({code:e.code,message:String(e.message||'').slice(0,240)})):[]};}
  const result=await response.json();
  const data=result.result?.screenshot||result.screenshot;
  if(typeof data!=='string'||data.length>1800000||!/^iVBORw0KGgo[A-Za-z0-9+/=\r\n]+$/.test(data))return {state:'unavailable',kind:'api_message_render',captured:false,reason:'O renderizador não retornou um PNG válido dentro do limite.'};
  return {state:'completed',kind:'api_message_render',rendered:true,discord_screen_capture:false,
   channel_id:CHANNEL,message_ids:read.messages.map(m=>m.id),generated_at,
   note:'Imagem das mensagens reais obtidas pela API; não é captura da interface Discord.',
   image:{mimeType:'image/png',data}};
 }catch{return {state:'unavailable',kind:'api_message_render',captured:false,reason:'Falha ao renderizar mensagens; nenhuma imagem confirmada.'};}
}
