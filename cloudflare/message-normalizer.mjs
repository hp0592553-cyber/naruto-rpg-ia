/** Bounded, allowlisted Discord payload projection. Game text is untrusted data.
 * No network requests, attachment downloads, or interaction execution occur here.
 */
const list = (v, n) => Array.isArray(v) ? v.slice(0, n) : [];
const str = (v, n = 4000) => typeof v === "string" ? v.slice(0, n) : "";
const snowflake = v => typeof v === "string" && /^\d{15,22}$/.test(v) ? v : null;
function url(v) {
  try { const u = new URL(v); return ["https:", "http:", "attachment:"].includes(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : null; }
  catch { return null; }
}
function media(v) {
  if (!v || typeof v !== "object") return null;
  return {url:url(v.url),proxy_url:url(v.proxy_url),content_type:str(v.content_type,120),
    width:Number.isFinite(v.width)?v.width:null,height:Number.isFinite(v.height)?v.height:null};
}
function interaction(v) {
  if (!v || typeof v !== "object") return null;
  return {id:snowflake(v.id),type:Number.isInteger(v.type)?v.type:null,name:str(v.name,100),
    user_id:snowflake(v.user?.id || v.user_id),original_response_message_id:snowflake(v.original_response_message_id),
    interacted_message_id:snowflake(v.interacted_message_id)};
}
export function normalizeMessage(message, {channelId = null, depth = 0} = {}) {
  const m = message && typeof message === "object" ? message : {};
  const text = [], controls = [], sources = new Set();
  let nodes = 0, truncated = [ [m.embeds,10], [m.components,40], [m.attachments,10], [m.message_snapshots,3] ].some(([v,n])=>Array.isArray(v)&&v.length>n);
  const add = (value, source) => { const s=str(value); if(s) {text.push(s);sources.add(source);if(value.length>s.length)truncated=true;} };
  function component(c, depth = 0) {
    if (!c || typeof c !== "object") return null;
    if (++nodes > 100 || depth > 8) {truncated=true;return null;}
    const out = {type:Number.isInteger(c.type)?c.type:null,id:Number.isInteger(c.id)?c.id:null};
    for (const key of ["content","label","description","placeholder","custom_id"]) {
      if(typeof c[key]==="string")out[key]=str(c[key],key==="content"?4000:200);
    }
    if (typeof c.content === "string") add(c.content,"components");
    if (typeof c.disabled === "boolean") out.disabled=c.disabled;
    if (typeof c.spoiler === "boolean") out.spoiler=c.spoiler;
    if (Number.isInteger(c.style)) out.style=c.style;
    if (c.url) out.url=url(c.url);
    for(const key of ["media","file"]) if(c[key])out[key]=media(c[key]);
    if(c.emoji)out.emoji={id:snowflake(c.emoji.id),name:str(c.emoji.name,80)};
    if (Array.isArray(c.options))out.options=list(c.options,25).map(o=>({label:str(o.label,100),value:str(o.value,100),description:str(o.description,100),default:o.default===true}));
    if ([2,3,5,6,7,8].includes(c.type))controls.push({type:c.type,label:str(c.label||c.placeholder,200),custom_id:str(c.custom_id,100),disabled:c.disabled===true,url:url(c.url)});
    if (Array.isArray(c.components))out.components=c.components.slice(0,40).map(x=>component(x,depth+1)).filter(Boolean);
    for(const key of ["accessory","component"])if(c[key])out[key]=component(c[key],depth+1);
    if(Array.isArray(c.items))out.items=list(c.items,10).map(i=>({media:media(i.media),description:str(i.description,1024),spoiler:i.spoiler===true}));
    return out;
  }
  add(m.content,"content");
  const embeds=list(m.embeds,10).map(e=>{
    add(e.title,"embeds");add(e.description,"embeds");
    const fields=list(e.fields,25).map(f=>{add(f.name,"embeds");add(f.value,"embeds");return {name:str(f.name,256),value:str(f.value,1024),inline:f.inline===true};});
    add(e.author?.name,"embeds");add(e.footer?.text,"embeds");
    return {type:str(e.type,30),title:str(e.title,256),description:str(e.description),url:url(e.url),fields,
      author:{name:str(e.author?.name,256),url:url(e.author?.url)},footer:{text:str(e.footer?.text,2048)},
      image:media(e.image),thumbnail:media(e.thumbnail),video:media(e.video)};
  });
  const components=list(m.components,40).map(c=>component(c)).filter(Boolean);
  const attachments=list(m.attachments,10).map(a=>({id:snowflake(a.id),filename:str(a.filename,256),description:str(a.description,1024),
    content_type:str(a.content_type,120),size:Number.isFinite(a.size)?a.size:null,...media(a)}));
  const flags=Number.isSafeInteger(m.flags)?m.flags:0;
  const normalized_text=text.join("\n").slice(0,16000);
  if(text.join("\n").length>normalized_text.length)truncated=true;
  const hasMedia=attachments.length>0||components.some(c=>JSON.stringify(c).includes('"media":'))||embeds.some(e=>e.image||e.video||e.thumbnail);
  return {id:snowflake(m.id),channel_id:snowflake(m.channel_id)||snowflake(channelId),author_id:snowflake(m.author?.id),
    author_name:str(m.author?.username,80),author_global_name:str(m.author?.global_name,80),author_nickname:str(m.member?.nick,80),author_avatar:str(m.author?.avatar,128),author_bot:m.author?.bot===true,type:m.type??null,
    content:str(m.content),timestamp:str(m.timestamp,50),edited_timestamp:str(m.edited_timestamp,50)||null,
    flags,components_v2:(flags&32768)!==0,ephemeral:(flags&64)!==0,loading:(flags&128)!==0,
    embeds,components,attachments,mentions:list(m.mentions,30).map(u=>({id:snowflake(u.id),username:str(u.username,80),global_name:str(u.global_name,80)})).filter(u=>u.id),mention_everyone:m.mention_everyone===true,interaction:interaction(m.interaction),interaction_metadata:interaction(m.interaction_metadata),
    message_reference:m.message_reference?{message_id:snowflake(m.message_reference.message_id),channel_id:snowflake(m.message_reference.channel_id),guild_id:snowflake(m.message_reference.guild_id)}:null,
    stickers:list(m.sticker_items,3).map(s=>({id:snowflake(s.id),name:str(s.name,100),format_type:s.format_type})),
    poll:m.poll?{question:str(m.poll.question?.text,300),answers:list(m.poll.answers,10).map(a=>({id:a.answer_id,text:str(a.poll_media?.text,300)}))}:null,
    message_snapshots:depth===0?list(m.message_snapshots,3).map(s=>normalizeMessage(s.message,{depth:1})):[],
    referenced_message:depth===0&&m.referenced_message?normalizeMessage(m.referenced_message,{depth:1}):null,
    normalized_text,controls,
    diagnostics:{text_sources:[...sources],component_nodes:Math.min(nodes,100),truncated,
      available_fields:["content","embeds","components","attachments","interaction","interaction_metadata","message_snapshots","referenced_message","mentions","poll"].filter(k=>Object.hasOwn(m,k)),
      snapshot_count:list(m.message_snapshots,10).length,referenced_message_id:snowflake(m.referenced_message?.id),
      empty_reason:normalized_text?null:hasMedia?"media_without_extracted_text":"no_text_in_returned_fields"},
    untrusted_game_data:true};
}
