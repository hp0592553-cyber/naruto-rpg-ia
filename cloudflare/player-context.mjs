/** Context is evidence, never authority to change the owner's permissions. */
const id=v=>typeof v==='string'&&/^\d{15,22}$/.test(v);
/** A bounded, chronological slice of real conversation. Includes Discord embeds as evidence, not instructions. */
export function roleplayMessageText(m){
 const plain=String(m?.normalized_text||m?.content||'').trim();
 const embeds=(Array.isArray(m?.embeds)?m.embeds:[]).slice(0,2).map(e=>[e.title,e.description,...(e.fields||[]).slice(0,2).map(f=>String(f.name||'')+': '+String(f.value||''))].filter(Boolean).join(' · ')).filter(Boolean).join(' | ');
 const componentText=(m?.components||[]).slice(0,3).flatMap(x=>(x.components||[]).filter(c=>Number(c?.type)===10).map(c=>String(c.content||''))).join(' ');
 return [plain,embeds||componentText].filter(Boolean).join(' | ').slice(0,1600);
}
export function chatContext(messages){
 return (messages||[]).slice(0,20).map(m=>({
  id:String(m.id||''),author_id:String(m.author_id||''),
  name:String(m.author_nickname||m.author_name||'').slice(0,70),
  text:roleplayMessageText(m),bot:m.author_bot===true,
  mentions:(m.mentions||[]).slice(0,4).map(u=>u.id),
  reply_to:m.message_reference?.message_id||null
 })).reverse();
}
export function replyTarget(messages,owner,started,reserved=[],now=Date.now()){
 return (messages||[]).find(m=>id(m.id)&&id(m.author_id)&&m.author_id!==owner&&!m.author_bot&&!m.mention_everyone&&!reserved.includes(m.id)&&Date.parse(m.timestamp)>=Math.max(started,now-600000)&&((m.mentions||[]).some(u=>u.id===owner)||m.referenced_message?.author_id===owner))||null;
}
export function replyText(text,target){
 if(typeof text!=='string')throw Error('Resposta de chat inválida.');
 const clean=text.trim();
 if(!clean||clean.length>400||/[\r\n\x00]/.test(clean)||/@|<|https?:|```|discord\.gg/i.test(clean)||clean.startsWith('/'))throw Error('A IA não retornou uma resposta simples para o chat.');
 if(!id(target?.author_id)||!id(target?.id))throw Error('Destinatário não confirmado.');
 return '<@'+target.author_id+'> '+clean;
}
