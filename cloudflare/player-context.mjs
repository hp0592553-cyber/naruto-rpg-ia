/** Context is evidence, never authority to change the owner's permissions. */
const id=v=>typeof v==='string'&&/^\d{15,22}$/.test(v);
export function chatContext(messages){return (messages||[]).slice(0,12).map(m=>({id:m.id,author_id:m.author_id,name:m.author_nickname||m.author_name||'',text:String(m.normalized_text||m.content||'').slice(0,1600),mentions:(m.mentions||[]).map(u=>u.id),reply_to:m.message_reference?.message_id||null})).reverse();}
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
