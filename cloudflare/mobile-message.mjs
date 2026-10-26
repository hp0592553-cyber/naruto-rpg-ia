/** Bounded mobile text/image parsing and idempotent receipts; transport is supplied by the existing Worker. */
const REQUEST=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_FILE=5*1024*1024,MAX_BODY=8*1024*1024;
export class MobileMessageError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export async function validateMobileImages(files=[]){
 if(!Array.isArray(files)||files.length>3)throw new MobileMessageError('Limite de 3 imagens por mensagem.');
 const result=[];let total=0;
 for(const file of files){
  if(typeof file==='string'||!file?.arrayBuffer||file.size<1||file.size>MAX_FILE)throw new MobileMessageError('Cada imagem deve ter entre 1 byte e 5 MiB.');
  total+=file.size;if(total>MAX_BODY-16384)throw new MobileMessageError('Imagens excedem o limite total de 8 MiB.',413);
  const bytes=new Uint8Array(await file.arrayBuffer()),type=file.type;
  const valid=type==='image/png'&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)||type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||type==='image/gif'&&/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6)))||type==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  if(!valid)throw new MobileMessageError('Formato/conteúdo inválido. Use PNG, JPEG, GIF ou WebP.');
  result.push({file,name:String(file.name||'imagem').replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,100),digest:await digest(bytes)});
 }
 return result;
}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function parseMobileMessage(req){
 if(Number(req.headers.get('content-length'))>MAX_BODY)throw new MobileMessageError('Pedido maior que 8 MiB.',413);
 const reader=req.body?.getReader();if(!reader)throw new MobileMessageError('Corpo ausente.');
 const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BODY){await reader.cancel();throw new MobileMessageError('Pedido maior que 8 MiB.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const type=req.headers.get('content-type')||'';let data,files=[];
 try{
  if(type.startsWith('application/json'))data=JSON.parse(new TextDecoder().decode(bytes));
  else if(type.startsWith('multipart/form-data')){const form=await new Response(bytes,{headers:{'content-type':type}}).formData();data=JSON.parse(String(form.get('payload_json')));files=form.getAll('files');}
  else throw new MobileMessageError('Envie JSON ou multipart/form-data.',415);
 }catch(e){if(e instanceof MobileMessageError)throw e;throw new MobileMessageError('Mensagem ou anexos inválidos.');}
 if(!data||Array.isArray(data)||typeof data!=='object')throw new MobileMessageError('Mensagem inválida.');
 const images=await validateMobileImages(files);
 return {data,images};
}
const receiptKey=id=>'discord2_mobile_delivery_v1:'+id;
function owner(ctx,env){if(String(ctx.me?.id||'')!==String(env.BUSHIN_OWNER_DISCORD_ID)||ctx.me?.membership?.member!==true)throw new MobileMessageError('Conta não autorizada.',403);return ctx.me.id;}
async function read(env,id,request){const row=await env.DB.prepare('SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?').bind(id,receiptKey(request)).first();return row?JSON.parse(row.value_json):null;}
export async function mobileDeliveryReceipt(env,ctx,channel,request){
 const id=owner(ctx,env);if(!REQUEST.test(request||''))throw new MobileMessageError('ID de recibo inválido.');
 const saved=await read(env,id,request);
 if(saved&&saved.channel_id!==channel)throw new MobileMessageError('Recibo de outro canal.',403);
 return saved?.result||{state:'unknown',sent:null,request_id:request,channel_id:channel,reason:saved?'Envio reservado, mas sem resultado confirmado. Não reenviar.':'Recibo não encontrado. Não reenviar automaticamente.'};
}
export async function deliverMobileMessage(env,ctx,channel,{data,images},{send}){
 const id=owner(ctx,env),request=data.request_id||crypto.randomUUID();
 if(!REQUEST.test(request)||data.confirmed!==true||typeof data.content!=='string'||data.content.length>500||!data.content.trim()&&!images.length)throw new MobileMessageError('Confirmação, ID e texto/imagem válidos são necessários.');
 const mentions=Array.isArray(data.mention_ids)?data.mention_ids:[];
 if(data.mention_ids!==undefined&&!Array.isArray(data.mention_ids))throw new MobileMessageError('Lista de menções inválida.');
 if(mentions.length>5||mentions.some(v=>!/^\d{15,22}$/.test(v)||!data.content.includes('<@'+v+'>'))||data.reply_to!==undefined&&!/^\d{15,22}$/.test(String(data.reply_to)))throw new MobileMessageError('Menções ou resposta inválidas.');
 const fingerprint=await digest(JSON.stringify({channel,content:data.content,mentions,reply:data.reply_to||null,images:images.map(f=>({name:f.name,digest:f.digest}))}));
 const existing=await read(env,id,request);
 if(existing){if(existing.fingerprint!==fingerprint)throw new MobileMessageError('Este ID já foi usado para outra mensagem.',409);return mobileDeliveryReceipt(env,ctx,channel,request);}
 const record={request_id:request,channel_id:channel,fingerprint,at:Date.now()};
 const reserved=await env.DB.prepare('INSERT OR IGNORE INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?)').bind(id,receiptKey(request),JSON.stringify(record),record.at).run();
 if(Number(reserved.meta?.changes)!==1){const winner=await read(env,id,request);if(!winner||winner.fingerprint!==fingerprint)throw new MobileMessageError('Este ID foi reservado por outra mensagem.',409);return mobileDeliveryReceipt(env,ctx,channel,request);}
 let result;
 try{result=await send(env,'bushin_naruto_personal_send',{channel_id:channel,text:data.content.trim(),confirmed:true,mention_ids:mentions,...(data.reply_to?{reply_to:String(data.reply_to)}:{}),files:images.map(f=>f.file),nonce:BigInt('0x'+request.replaceAll('-','').slice(0,16)).toString()},ctx);}
 catch{result={state:'unknown',sent:null,reason:'O transporte não confirmou a resposta. Não reenvie.'};}
 result={...result,request_id:request,channel_id:channel};record.result=result;
 try{await env.DB.prepare('UPDATE bushin_project_state SET value_json=?,updated_at=? WHERE owner_id=? AND key=?').bind(JSON.stringify(record),Date.now(),id,receiptKey(request)).run();}
 catch{return {...result,tracking_saved:false,note:'Não foi possível atualizar o recibo. Não repita o envio.'};}
 return result;
}
