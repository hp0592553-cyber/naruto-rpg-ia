/**
 * Bushin Browser — Discord Direct (Cloudflare Workers Free + D1)
 * Same original ChatGPT plugin. This is an ALTERNATIVE backend, not a new plugin.
 * No GitHub runtime, no Composio, no personal Discord self-bot, no account cookies.
 *
 * OAuth2.1 for ChatGPT: DCR, Authorization Code, PKCE S256, state, resource.
 * Confidential Discord OAuth code exchange happens only inside this Worker.
 * Tokens are stored encrypted with AES-GCM in private D1. ChatGPT receives
 * only opaque Bushin-issued tokens, never raw Discord access/refresh tokens.
 */
import {botReady,BOT_TOOLS,botCall} from "./bot-permissions.mjs";
import {BROWSER_TOOLS,browserCall} from "./browser-bridge.mjs";
import {ADVANCED_TOOLS,ADVANCED_NAMES,advancedCall} from "./advanced-suite.mjs";
import {logToolAction,stateCall} from "./state-suite.mjs";
import {visualRunner,visualMobile,visualTakeover} from "./visual-bridge.mjs";
import {discordCall,officialBotDmReady,officialBotIdentity} from "./discord-suite.mjs";
import {NARUTO_TOOLS,NARUTO_TOOL_NAMES,narutoCall} from "./naruto-rpg.mjs";
import {PERSONAL_TOOLS,PERSONAL_NAMES,personalCall} from "./personal-discord.mjs";
import {personalForumThreads} from "./personal-discord.mjs";
import {personalListChannels} from "./personal-discord.mjs";
import {personalInspectCommand,personalInvokeProfileProbe} from "./personal-discord.mjs";
import {PANEL_HTML,PANEL_JS} from "./discord2-ui.mjs";
import {bushinAiNext} from "./discord2-ai.mjs";
import {bushinAutoRp} from "./discord2-autorp.mjs";
import {searchHenriqueMessages,scanRpgChannels} from "./discord2-research.mjs";
const DISCORD_CLIENT_ID="1561589128108314636";
const NARUTO_GUILD_ID="1515877468299595919";
const SCOPES=["identify","guilds","guilds.members.read"];
// Optional experimental user-consent scope; not a channel-message API permission.
const EXTRA_DISCORD_SCOPES=["messages.read"];
const DISCORD="https://discord.com/api/v10";
const enc=new TextEncoder();
const dec=new TextDecoder();
const now=()=>Date.now();
const minute=60000;
const urlSafeBytes=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const bytesFrom64=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
function rnd(){const b=new Uint8Array(32);crypto.getRandomValues(b);return urlSafeBytes(b);}
async function digest(s){return urlSafeBytes(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s))));}
async function secretKey(env){
  if(!env.ENCRYPTION_KEY_BASE64 || typeof env.ENCRYPTION_KEY_BASE64!=="string")
    throw Error("Encryption secret missing");
  const bytes=bytesFrom64(env.ENCRYPTION_KEY_BASE64);
  if(bytes.length!==32)throw Error("Encryption secret needs exactly 32 bytes");
  return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
}
async function seal(value,env){
  const key=await secretKey(env),iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(JSON.stringify(value))));
  return urlSafeBytes(iv)+"."+urlSafeBytes(ciphertext);
}
async function unseal(value,env){
  const [i,c]=String(value).split(".");
  if(!i||!c)throw Error("Invalid encrypted record");
  const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytesFrom64(i)},await secretKey(env),bytesFrom64(c));
  return JSON.parse(dec.decode(bytes));
}
function oauthError(error,message="Não foi possível concluir a autorização.",status=400){
  return Object.assign(new Error(message),{errorCode:error,status});
}
const clientRedirectRE=/^\/connector\/oauth\/[A-Za-z0-9_-]{6,120}$/;
export function allowedRedirect(raw){
  if(typeof raw!=="string"||raw.length>500)return false;
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname==="chatgpt.com"&&!u.port&&!u.username&&!u.password&&!u.hash&&!u.search&&
      (u.pathname==="/connector_platform_oauth_redirect"||clientRedirectRE.test(u.pathname));
  }catch{return false;}
}
export function validScope(raw){
  if(typeof raw!=="string")return false;
  const scopes=raw.trim().split(/\s+/);
  return scopes.length>=SCOPES.length && scopes.length<=SCOPES.length+EXTRA_DISCORD_SCOPES.length &&
    new Set(scopes).size===scopes.length &&
    SCOPES.every(s=>scopes.includes(s)) &&
    scopes.every(s=>SCOPES.includes(s)||EXTRA_DISCORD_SCOPES.includes(s));
}
const verifierRE=/^[A-Za-z0-9_.~-]{43,128}$/;
const challengeRE=/^[A-Za-z0-9_-]{43,128}$/;
export async function pkceVerify(verifier,challenge){
  return typeof verifier==="string"&&verifierRE.test(verifier)&&typeof challenge==="string"&&challengeRE.test(challenge)&&
    (await digest(verifier))===challenge;
}
function base(env){
  const value=String(env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(value))throw Error("PUBLIC_BASE_URL must be a fixed HTTPS origin");
  return value;
}
function ready(env){
  const b=base(env);
  if(!env.DB?.prepare||!env.DISCORD_CLIENT_SECRET||!env.ENCRYPTION_KEY_BASE64||
     !/^\d{15,22}$/.test(env.BUSHIN_OWNER_DISCORD_ID||""))throw Error("Bushin OAuth hosting not configured");
  return b;
}
function reply(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer",
    ...headers
  }});
}
function redirect(uri){return new Response(null,{status:302,headers:{location:uri,"cache-control":"no-store","referrer-policy":"no-referrer"}});}
function oauthReply(e){return reply({error:e.errorCode||"server_error",error_description:String(e.message||"OAuth failed").slice(0,160)},e.status||500);}
function q(env,sql,...params){return env.DB.prepare(sql).bind(...params);}
async function field(req){
  const max=8192;
  const len=Number(req.headers.get("content-length")||0);
  if(len>max)throw oauthError("invalid_request","Request too large",413);
  const text=await req.text();
  if(text.length>max)throw oauthError("invalid_request","Request too large",413);
  if((req.headers.get("content-type")||"").startsWith("application/json")){
    try{return JSON.parse(text);}catch{throw oauthError("invalid_request","Malformed JSON");}
  }
  if(!(req.headers.get("content-type")||"").startsWith("application/x-www-form-urlencoded"))
    throw oauthError("invalid_request","Use form encoding",415);
  return Object.fromEntries(new URLSearchParams(text));
}
function oauthMetadata(env){
  const b=ready(env);
  return {issuer:b,authorization_endpoint:b+"/oauth/authorize",
    token_endpoint:b+"/oauth/token",registration_endpoint:b+"/oauth/register",
    response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
    token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],
    authorization_response_iss_parameter_supported:true,scopes_supported:SCOPES};
}
async function register(req,env){
  const b=ready(env),p=await field(req);
  if(!Array.isArray(p.redirect_uris)||p.redirect_uris.length!==1||!allowedRedirect(p.redirect_uris[0])||
    p.token_endpoint_auth_method && p.token_endpoint_auth_method!=="none")
    throw oauthError("invalid_client_metadata","Only official ChatGPT OAuth callbacks are accepted.");
  const count=await q(env,"SELECT COUNT(*) AS total FROM oauth_clients").first();
  if(Number(count?.total||0)>75)throw oauthError("temporarily_unavailable","Client registration limit reached.",429);
  const id=rnd(),issued=Math.floor(now()/1000);
  await q(env,"INSERT INTO oauth_clients (id,redirect_uri,created_at) VALUES (?,?,?)",
    id,p.redirect_uris[0],now()).run();
  return reply({client_id:id,client_id_issued_at:issued,redirect_uris:p.redirect_uris,
    token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]},201);
}
async function authorize(request,env){
  const b=ready(env),p=new URL(request.url).searchParams;
  const client=await q(env,"SELECT redirect_uri FROM oauth_clients WHERE id=?",p.get("client_id")||"").first();
  if(!client)throw oauthError("invalid_client","Client not registered",401);
  if(p.get("redirect_uri")!==client.redirect_uri)throw oauthError("invalid_request","Redirect mismatch");
  if(p.get("response_type")!=="code" || p.get("code_challenge_method")!=="S256" ||
    !challengeRE.test(p.get("code_challenge")||""))throw oauthError("invalid_request","PKCE S256 required");
  const state=p.get("state")||"";
  if(state.length<8||state.length>500)throw oauthError("invalid_request","CSRF state required");
  if(p.get("resource")!==b+"/mcp")throw oauthError("invalid_target","Wrong OAuth resource");
  const scope=p.get("scope")||SCOPES.join(" ");
  if(!validScope(scope))throw oauthError("invalid_scope","Only identify/guilds/guilds.members.read supported");
  const dState=rnd(),dv=rnd();
  await q(env,"INSERT INTO oauth_flows (state_hash,client_id,redirect_uri,client_state,pkce_challenge,discord_verifier,scope,expires_at) VALUES (?,?,?,?,?,?,?,?)",
    await digest(dState),p.get("client_id"),client.redirect_uri,state,p.get("code_challenge"),dv,scope,now()+10*minute).run();
  const dst=new URL("https://discord.com/oauth2/authorize");
  for(const [k,v] of Object.entries({
    client_id:DISCORD_CLIENT_ID,redirect_uri:b+"/oauth/discord/callback",
    response_type:"code",scope:[...new Set([...scope.trim().split(/\s+/),...EXTRA_DISCORD_SCOPES])].join(" "),state:dState,
    code_challenge_method:"S256",code_challenge:await digest(dv),prompt:"consent"
  }))dst.searchParams.set(k,v);
  return redirect(dst.toString());
}
export function classifyDiscordTokenFailure(status,code){
  const allowed=new Set(["invalid_client","invalid_grant","invalid_request","invalid_scope","unauthorized_client","unsupported_grant_type"]);
  if(allowed.has(code))return "discord_"+code;
  if(status===401||status===403)return "discord_invalid_client";
  if(status===429)return "discord_rate_limited";
  if(status>=500)return "discord_unavailable";
  return "discord_auth";
}
async function discordToken(env,data){
  // Discord supports form-body client authentication for authorization_code
  // and refresh_token grants. Nothing is logged or sent to the browser.
  // Keep the Client Secret on the Worker, protected by the Cloudflare secret binding.
  const form=new URLSearchParams(data);
  form.set("client_id",DISCORD_CLIENT_ID);
  form.set("client_secret",env.DISCORD_CLIENT_SECRET);
  const response=await fetch(DISCORD+"/oauth2/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},
    body:form,
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    // Only consume the whitelisted error class; never echo provider descriptions,
    // request headers, authorization codes, token values or client secrets.
    let providerCode="";
    try{
      const body=await response.json();
      if(body && typeof body.error==="string")providerCode=body.error;
    }catch{}
    throw oauthError(classifyDiscordTokenFailure(response.status,providerCode),
      "Discord rejected the authorization code exchange.");
  }
  const j=await response.json();
  if(!j.access_token||!j.refresh_token||!Number.isFinite(j.expires_in))
    throw oauthError("access_denied","Invalid Discord token response.");
  if(!validScope(String(j.scope||"")))throw oauthError("invalid_scope","Discord did not grant required permissions.");
  return {access:j.access_token,refresh:j.refresh_token,expires:now()+j.expires_in*1000,scope:j.scope};
}
async function discordFetch(token,path){
  if(!["/users/@me","/users/@me/guilds","/users/@me/guilds/"+NARUTO_GUILD_ID+"/member"].includes(path))
    throw Error("Unapproved Discord API endpoint");
  const res=await fetch(DISCORD+path,{headers:{
    authorization:"Bearer "+token,accept:"application/json"
  },signal:AbortSignal.timeout(10000)});
  if(res.status===401)throw oauthError("invalid_grant","Discord authorization expired.",401);
  if(res.status===404)return null;
  if(res.status===403)throw oauthError("insufficient_scope","Missing Discord permission.",403);
  if(!res.ok)throw oauthError("temporarily_unavailable","Discord temporarily unavailable.",503);
  return res.json();
}
async function verified(env,creds){
  const profile=await discordFetch(creds.access,"/users/@me");
  if(!profile || profile.id!==env.BUSHIN_OWNER_DISCORD_ID)
    throw oauthError("access_denied","This Discord account is not the Bushin owner.",403);
  const membership=await discordFetch(creds.access,"/users/@me/guilds/"+NARUTO_GUILD_ID+"/member");
  if(!membership)throw oauthError("access_denied","Discord account is not in Naruto Project RP.",403);
  return {id:profile.id,username:String(profile.username||""),
    display_name:String(profile.global_name||profile.username||""),
    membership:{guild_id:NARUTO_GUILD_ID,member:true,nickname:membership.nick||null,
      roles_count:Array.isArray(membership.roles)?membership.roles.length:null}};
}
function cbUri(row,env,code,err){
  const uri=new URL(row.redirect_uri);
  uri.searchParams.set("state",row.client_state);
  uri.searchParams.set("iss",base(env));
  if(err)uri.searchParams.set("error",err);
  else uri.searchParams.set("code",code);
  return uri.toString();
}
async function discordCallback(req,env){
  const b=ready(env),p=new URL(req.url).searchParams;
  const state=p.get("state")||"";
  if(!state||state.length>500)throw oauthError("invalid_request","Discord state missing");
  const row=await q(env,"DELETE FROM oauth_flows WHERE state_hash=? AND expires_at>? RETURNING *",
    await digest(state),now()).first();
  if(!row)throw oauthError("invalid_request","Login expired or already consumed");
  if(p.get("error")||!p.get("code")||p.get("iss")&&p.get("iss")!=="https://discord.com")
    return redirect(cbUri(row,env,null,"access_denied"));
  try{
    const credentials=await discordToken(env,{
      grant_type:"authorization_code",code:p.get("code"),
      redirect_uri:b+"/oauth/discord/callback",code_verifier:row.discord_verifier
    });
    const profile=await verified(env,credentials);
    const code=rnd();
    await q(env,"INSERT INTO oauth_codes (code_hash,client_id,redirect_uri,pkce_challenge,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?,?,?)",
      await digest(code),row.client_id,row.redirect_uri,row.pkce_challenge,row.scope,
      profile.id,await seal(credentials,env),now()+5*minute).run();
    return redirect(cbUri(row,env,code,null));
  }catch{
    return redirect(cbUri(row,env,null,"access_denied"));
  }
}
async function saveTokens(env,clientId,scope,userId,creds){
  const access=rnd(),refresh=rnd(),saved=await seal(creds,env);
  const duration=Math.max(60000,Math.min(25*minute,creds.expires-now()-60000));
  const time=now();
  await env.DB.batch([
    q(env,"INSERT INTO oauth_access (token_hash,client_id,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?)",
      await digest(access),clientId,scope,userId,saved,time+duration),
    q(env,"INSERT INTO oauth_refresh (token_hash,client_id,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?)",
      await digest(refresh),clientId,scope,userId,saved,time+30*86400000)
  ]);
  return reply({access_token:access,refresh_token:refresh,token_type:"Bearer",
    expires_in:Math.floor(duration/1000),scope});
}
async function token(req,env){
  const b=ready(env),p=await field(req);
  if(p.resource!==b+"/mcp")throw oauthError("invalid_target","Wrong OAuth resource");
  const client=await q(env,"SELECT redirect_uri FROM oauth_clients WHERE id=?",p.client_id||"").first();
  if(!client)throw oauthError("invalid_client","Unknown client.",401);
  if(p.grant_type==="authorization_code"){
    if(typeof p.code!=="string"||p.code.length>256)throw oauthError("invalid_grant","Invalid OAuth code");
    const code=await q(env,"DELETE FROM oauth_codes WHERE code_hash=? AND expires_at>? RETURNING *",
      await digest(p.code),now()).first();
    if(!code || code.client_id!==p.client_id || code.redirect_uri!==p.redirect_uri ||
       client.redirect_uri!==p.redirect_uri ||
       !await pkceVerify(p.code_verifier,code.pkce_challenge))
      throw oauthError("invalid_grant","Invalid or already used PKCE authorization code.");
    const credentials=await unseal(code.creds_encrypted,env);
    return saveTokens(env,p.client_id,code.scope,code.user_id,credentials);
  }
  if(p.grant_type==="refresh_token"){
    if(typeof p.refresh_token!=="string"||p.refresh_token.length>256)
      throw oauthError("invalid_grant","Refresh token invalid.");
    const row=await q(env,"DELETE FROM oauth_refresh WHERE token_hash=? AND expires_at>? RETURNING *",
      await digest(p.refresh_token),now()).first();
    if(!row||row.client_id!==p.client_id)throw oauthError("invalid_grant","Refresh token invalid or used.");
    let credentials=await unseal(row.creds_encrypted,env);
    if(credentials.expires<now()+3*minute){
      credentials=await discordToken(env,{grant_type:"refresh_token",refresh_token:credentials.refresh});
      const profile=await verified(env,credentials);
      if(profile.id!==row.user_id)throw oauthError("invalid_grant","Discord identity mismatch.");
    }
    return saveTokens(env,row.client_id,row.scope,row.user_id,credentials);
  }
  throw oauthError("unsupported_grant_type","Unsupported OAuth grant");
}
async function session(req,env){
  const header=req.headers.get("authorization")||"";
  const token=header.match(/^Bearer ([A-Za-z0-9._~+\/=-]{20,512})$/)?.[1];
  if(!token)return null;
  const record=await q(env,"SELECT * FROM oauth_access WHERE token_hash=? AND expires_at>?",
    await digest(token),now()).first();
  if(!record||!validScope(record.scope)||record.user_id!==env.BUSHIN_OWNER_DISCORD_ID)return null;
  const creds=await unseal(record.creds_encrypted,env);
  if(creds.expires<now()+30000)return null;
  return {record,creds};
}
function rpc(id,result){return reply({jsonrpc:"2.0",id,result});}
function rpcError(id,code,message){return reply({jsonrpc:"2.0",id,error:{code,message}});}
// OpenAI connected-account identity: selected OAuth credential determines the profile.
// The Discord snowflake is immutable and scoped to the verified owner; never expose tokens.
export function discordProfileData(me){
  const id=String(me?.id||"");
  if(!/^\d{15,22}$/.test(id))throw new Error("Invalid verified Discord profile ID");
  return {id,
    ...(me.display_name?{name:String(me.display_name)}:{}),
    ...(me.username?{nickname:"@"+String(me.username)}:{})
  };
}
const PROFILE_OUTPUT={
 "$schema":"https://json-schema.org/draft/2020-12/schema",
 type:"object",
 properties:{
  id:{type:"string",minLength:1,pattern:"\\S",description:"Stable opaque profile identifier for the authenticated Discord user."},
  name:{type:"string",description:"Display name of the authenticated Discord account."},
  nickname:{type:"string",description:"Discord account username for distinguishing connected accounts."}
 },
 required:["id"],
 additionalProperties:false
};
const TOOLS=[
 {name:"bushin_discord_profile",title:"Conta Discord conectada",
   description:"Retorna a identidade estável e o nome da conta Discord autenticada via OAuth, permitindo que o ChatGPT a reconheça nas Contas conectadas. Não inclui email nem tokens.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   outputSchema:PROFILE_OUTPUT,
   securitySchemes:[{type:"oauth2",scopes:SCOPES}],
   _meta:{"openai/profile":true},
   annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:"bushin_session_status",title:"Status da conexão Bushin",
   description:"Confirma se este cliente MCP autorizou a própria conta Discord, informa permissões realmente disponíveis e distingue conexão MCP de sessão do navegador. Não usa Linux, bot nem envia mensagens.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:"bushin_discord_whoami",title:"Verificar conta Discord",
   description:"Discord OAuth oficial: informa somente a conta autenticada; sem e-mail, DMs ou mensagens.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"bushin_discord_naruto_membership",title:"Verificar Naruto Project RP",
   description:"Confirma vínculo da conta autorizada ao servidor Naruto Project RP.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   annotations:{readOnlyHint:true,destructiveHint:false}}
];
export const CATALOG_REVISION="2026-10-24.2";
// Static catalogue: configuration changes affect availability, not tool discovery.
// No listChanged notification is advertised: this stateless endpoint sends none.
export function mcpTools(){return TOOLS.concat(BROWSER_TOOLS,BOT_TOOLS,ADVANCED_TOOLS,NARUTO_TOOLS,PERSONAL_TOOLS);}
export function catalogDiagnostics(){
 const tools=mcpTools();
 return {revision:CATALOG_REVISION,count:tools.length,tools:tools.map(t=>t.name),
   host_catalog_verified:false,
   refresh:"A client must fetch tools/list again after deployment; this Worker cannot refresh the host catalogue."};
}
async function mcp(req,env){
  ready(env);
  const ct=req.headers.get("content-type")||"";
  if(!ct.startsWith("application/json"))return reply({error:"Expected JSON"},415);
  let body;try{body=await field(req);}catch(e){return oauthReply(e);}
  const id=body.id??null,method=body.method;
  if(method==="initialize")return rpc(id,{
    protocolVersion:["2024-11-05","2025-03-26","2025-06-18","2025-11-25"].includes(body.params?.protocolVersion)?body.params.protocolVersion:"2025-11-25",capabilities:{tools:{listChanged:false}},
    serverInfo:{name:"bushin-browser-discord-direct",version:"1.1.1"},
    instructions:"Bushin Advanced: browser, Discord OAuth, bot oficial opcional, tarefas persistidas no D1, arquivos e GitHub. Ferramentas registradas não garantem sessão ativa; confira os estados retornados. O aplicativo ChatGPT Android skill-only não invoca este MCP. OAuth identifica o dono e não concede envio por si só. O envio existente usa o transporte configurado: pessoal não oficial quando a Secret pessoal existe, ou bot oficial no caminho separado. Consulte mode e evidências de entrega, nunca apenas o nome ou descrição antiga da ferramenta."
  });
  if(method==="notifications/initialized")return new Response(null,{status:202});
  if(method==="ping")return rpc(id,{});
  const activeTools=mcpTools();
  if(method==="tools/list")return body.params?.cursor?rpcError(id,-32602,"This catalogue is not paginated"):rpc(id,{tools:activeTools});
  if(method==="tools/call"){
    const auth=await session(req,env);
    if(!auth)return reply({error:"Discord login necessary"},401,{
      "www-authenticate":'Bearer resource_metadata="'+base(env)+'/.well-known/oauth-protected-resource"'
    });
    const name=body.params?.name;
    if(!activeTools.some(t=>t.name===name))return rpcError(id,-32601,"Unknown tool");
    let me;
    try{
      // Local diagnostics use the already validated, unexpired owner OAuth session.
      // Browser dispatch retains owner-session checks, argument validation and owner-scoped D1 queues.
      me=["bushin_browser_status","bushin_browser_result","bushin_browser_action","bushin_browser_tabs"].includes(name)
        ? {id:auth.record.user_id}
        : await verified(env,auth.creds);
      let data=name==="bushin_discord_profile"?discordProfileData(me):
        name==="bushin_session_status"?{
          state:"connected",mcp_oauth_authenticated:true,
          discord_account:{id:me.id,username:me.username,display_name:me.display_name},
          member_naruto_rp:me.membership?.member===true,
          granted_scopes:auth.record.scope.split(/\s+/).filter(Boolean),
          available:{identity:true,server_list:true,naruto_membership:true,
            channel_messages_as_user:false,send_as_user:false},
          requires_linux_for_identity:false,
          note:"OAuth autentica este cliente MCP. Não confirma instalação do plugin no ChatGPT Android nem dá controle da conta pessoal para enviar mensagens."
        }:
        PERSONAL_NAMES.has(name)?await personalCall(env,name,body.params?.arguments||{},{me,creds:auth.creds}):
        NARUTO_TOOL_NAMES.has(name)?await narutoCall(env,name,body.params?.arguments||{},{me,creds:auth.creds}):
         ADVANCED_NAMES.has(name)?await advancedCall(env,name,body.params?.arguments||{},{me,creds:auth.creds}):
        BROWSER_TOOLS.some(t=>t.name===name)?await browserCall(env,name,body.params?.arguments||{}):
        BOT_TOOLS.some(t=>t.name===name)?await botCall(env,name,body.params?.arguments||{}):
        name==="bushin_discord_whoami"?
        {id:me.id,username:me.username,display_name:me.display_name,verified_account:true}:
        {username:me.username,...me.membership};
      if(name==="bushin_permissions_check")data={...data,mcp_catalog:catalogDiagnostics()};
      if(ADVANCED_NAMES.has(name)&&name!=="bushin_audit_log")
        await logToolAction(env,{me},name,data?.state||"completed").catch(()=>{});
      if(data?.kind==="api_message_render"&&data.image?.mimeType==="image/png"){
        const {image,...metadata}=data;
        return rpc(id,{content:[{type:"text",text:JSON.stringify(metadata)},{type:"image",mimeType:image.mimeType,data:image.data}],structuredContent:metadata});
      }
      return rpc(id,{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data});
    }catch(e){
      // A revoked upstream OAuth grant must trigger client reauthorization,
      // rather than being disguised as an ordinary failed tool invocation.
      if(e.status===401&&e.errorCode==="invalid_grant")return reply({error:"invalid_token",error_description:"Discord authorization expired."},401,{
        "www-authenticate":'Bearer error="invalid_token", resource_metadata="'+base(env)+'/.well-known/oauth-protected-resource"',
        "cache-control":"no-store"
      });
      if(ADVANCED_NAMES.has(name)&&me?.id)await logToolAction(env,{me},name,"failed").catch(()=>{});
      return rpc(id,{isError:true,content:[{type:"text",text:e.message||"Discord check failed"}]});
    }
  }
  return rpcError(id,-32601,"Method not found");
}

/* Mobile-only browser OAuth portal; no MCP client is needed. */
const MOBILE_CSS="body{background:#0b1020;color:#e8f1ff;font:16px system-ui;margin:0;padding:28px 18px}main{max-width:480px;margin:20px auto}.card{border:1px solid #384666;background:#152039;border-radius:20px;padding:24px;margin:28px 0}h1{font-size:32px}p{line-height:1.6;color:#c1d0e9}.button{display:block;background:#5865f2;color:white;text-decoration:none;border:0;border-radius:14px;padding:17px;text-align:center;font-size:17px;font-weight:800;width:100%;box-sizing:border-box;margin-top:20px}.muted{font-size:13px;color:#a5b6d3}.ok{color:#80e5b3}.user{font-size:24px;font-weight:800;overflow-wrap:anywhere}";
const M_FLOW="__Host-bushin_flow",M_SESSION="__Host-bushin_mobile";
function mCookie(req,name){for(const pair of (req.headers.get("cookie")||"").split(";")){const s=pair.trim();if(s.startsWith(name+"="))return s.slice(name.length+1)}return ""}
function mSet(name,value,age){return name+"="+value+"; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age="+age}
function mEsc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function mPage(title,content){
 const html='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bushin — Discord no celular</title><style>'+MOBILE_CSS+'</style><main><div style="font-size:48px">🍥</div><h1>'+title+'</h1><p>Conexão do Discord para Android. Não precisa de Linux.</p><div class="card">'+content+'</div><p class="muted">Login oficial do Discord: identify, guilds, guilds.members.read. Sem leitura de mensagens ou DMs. Esta página não habilita automaticamente as ferramentas MCP no aplicativo ChatGPT.</p></main></html>';
 return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'","referrer-policy":"same-origin","x-content-type-options":"nosniff","x-frame-options":"DENY"}});
}
function mGo(to,cookies=[]){const h=new Headers({"location":to,"cache-control":"no-store","referrer-policy":"no-referrer"});for(const c of cookies)h.append("set-cookie",c);return new Response(null,{status:303,headers:h})}
async function mobileHome(req,env){
 ready(env);
 const err=new URL(req.url).searchParams.get("error");
 if(err){
   const reasons={
     state:"O navegador perdeu a sessão de login. Abra esta página no Chrome e conclua o Discord na mesma janela.",
     denied:"A autorização foi cancelada ou recusada pelo Discord.",
     discord_auth:"O Discord recusou a autorização sem indicar um motivo específico.",
     discord_invalid_client:"O Discord rejeitou as credenciais do aplicativo Bushin. O Client Secret configurado na Cloudflare provavelmente está incorreto ou foi redefinido.",
     discord_invalid_grant:"O código de autorização não foi aceito: pode ter expirado, sido usado anteriormente ou não coincidir com a verificação PKCE e a URL de retorno.",
     discord_invalid_request:"O Discord rejeitou um parâmetro da troca OAuth. Vamos conferir o formato da solicitação.",
     discord_invalid_scope:"O Discord rejeitou alguma das permissões solicitadas.",
     discord_unauthorized_client:"A aplicação do Discord não está autorizada a usar este fluxo OAuth.",
     discord_unsupported_grant_type:"O Discord não aceitou o tipo de concessão configurado.",
     discord_rate_limited:"O Discord está limitando tentativas. Aguarde antes de tentar novamente.",
     discord_unavailable:"O serviço OAuth do Discord está temporariamente indisponível.",
     owner:"A conta do Discord autorizada não corresponde ao ID do proprietário cadastrado no Bushin.",
     guild:"O Discord não confirmou essa conta como membro do Naruto Project RP.",
     scope:"O Discord não concedeu todas as três permissões de identidade solicitadas.",
     expired:"O tempo para autorizar expirou. Inicie uma nova tentativa.",
     service:"O servidor encontrou uma falha temporária. Sua senha não foi exposta."
   };
   const hint=reasons[err]||"A autorização não pôde ser concluída. Não envie códigos ou tokens.";
   return mPage("Login não concluído",'<p>'+mEsc(hint)+'</p><p class="muted">Diagnóstico: '+mEsc(Object.hasOwn(reasons,err)?err:"service")+'</p><a class="button" href="/mobile/start">Tentar novamente</a><a class="button" href="/mobile/start?basic=1">Entrar com permissoes originais</a>');
 }
 const raw=mCookie(req,M_SESSION);
 if(/^[A-Za-z0-9_-]{40,80}$/.test(raw)){
   const row=await q(env,"SELECT * FROM mobile_user_sessions WHERE token_hash=? AND expires_at>?",await digest(raw),now()).first();
   if(row?.user_id===env.BUSHIN_OWNER_DISCORD_ID){
     try{const c=await unseal(row.creds_encrypted,env);if(c.expires>now()+30000){
       const me=await verified(env,c);
       return mPage("Discord conectado",'<p class="ok">✓ Conta verificada</p><div class="user">'+mEsc(me.display_name)+'</div><p>@'+mEsc(me.username)+'</p><p class="ok">✓ Membro do Naruto Project RP</p><a class="button" href="/mobile/dm">DM de teste do Bushin</a><a class="button" href="/mobile/visual">Controle visual do navegador</a><a class="button" href="/mobile/workspace">Tarefas e memória — usar agora</a><a class="button" href="/mobile/discord2">🍥 Abrir Discord 2 — painel conectado</a><a class="button" href="/mobile/servers">Meus servidores Discord</a><a class="button" href="/mobile/features">Ver ferramentas do Bushin</a><a class="button" href="/mobile/commands">Autorizar comandos pessoais do Bushin</a><p class="muted">OAuth applications.commands: instalar o aplicativo na sua conta, sem permissao de administrador do servidor. Nao permite ler mensagens nem enviar como sua conta. O Discord precisa oferecer instalacao por usuario e o Bushin precisa registrar os comandos.</p><form method="post" action="/mobile/logout"><button class="button" type="submit">Desconectar</button></form>');
     }}catch{}
   }
 }
 return mPage("Bushin no celular",'<p>Toque para autorizar a sua conta na página oficial do Discord.</p><a class="button" href="/mobile/start">Conectar com Discord</a><p class="muted">Não informe sua senha nesta página.</p>');
}
export function personalCommandsConsentUrl(){
 // USER_INSTALL OAuth shortcut. No change to the existing identity login,
 // no Discord user token or bot token requested on this separate screen.
 const url=new URL("https://discord.com/oauth2/authorize");
 url.searchParams.set("client_id",DISCORD_CLIENT_ID);
 url.searchParams.set("scope","applications.commands");
 url.searchParams.set("integration_type","1");
 return url.toString();
}
async function mobileFeatures(req,env){
 ready(env);
 const raw=mCookie(req,M_SESSION);
 if(!/^[A-Za-z0-9_-]{40,80}$/.test(raw))return mGo("/mobile");
 const record=await q(env,"SELECT user_id FROM mobile_user_sessions WHERE token_hash=? AND expires_at>?",await digest(raw),now()).first();
 if(!record||record.user_id!==env.BUSHIN_OWNER_DISCORD_ID)return mGo("/mobile");
 const github=typeof env.BUSHIN_GITHUB_TOKEN==="string"&&env.BUSHIN_GITHUB_TOKEN.length>=20;
 const groups=[
   {title:"Navegador visual",starts:["bushin_browser_"],note:github?"Ponte GitHub configurada; ainda precisa de sessão ativa e login no navegador.":"Ponte GitHub não configurada no Worker. Ferramentas não executam até haver sessão."},
   {title:"Discord e Naruto RP",starts:["bushin_discord_"],note:botReady(env)?"Bot oficial configurado: ações limitadas aos canais autorizados.":"OAuth de identidade ativo. Canais e mensagens exigem bot instalado no servidor. DMs com bot usam configuração separada."},
   {title:"Tarefas e estado",starts:["bushin_task_","bushin_save_state","bushin_load_state"],note:"Tarefas, aprovação, progresso e auditoria persistidos no D1. Sem agente executando em segundo plano."},
   {title:"GitHub e arquivos",starts:["bushin_files_","bushin_github_"],note:github?"Ponte GitHub configurada; escritas pedem confirmação.":"GitHub do Worker exige BUSHIN_GITHUB_TOKEN. O plugin GitHub do chat é uma conexão separada."},
   {title:"Autenticação e interface",starts:["bushin_auth_","bushin_permissions_","bushin_audit_","bushin_ui_","bushin_session_"],note:"Este painel mostra ferramentas cadastradas, não disponibiliza MCP nativo no ChatGPT Android."}
 ];
 const cards=groups.map(group=>{
   const names=ADVANCED_TOOLS.filter(t=>group.starts.some(p=>t.name.startsWith(p)));
   return '<details style="border:1px solid #384666;border-radius:12px;padding:13px;margin:12px 0"><summary style="cursor:pointer;font-weight:700">'+mEsc(group.title)+' ('+names.length+')</summary><p class="muted">'+mEsc(group.note)+'</p><ul style="padding-left:22px;line-height:1.9">'+
      names.map(t=>'<li><code>'+mEsc(t.name.slice(7))+'</code></li>').join("")+'</ul></details>';
 }).join("");
 const dmConfigured=officialBotDmReady(env);
 const dmNote='<details style="border:1px solid #384666;border-radius:12px;padding:13px;margin:12px 0"><summary style="cursor:pointer;font-weight:700">Enviar DM como bot oficial — '+(dmConfigured?'token configurado':'falta configuração')+'</summary>'+
 '<p class="muted">'+(dmConfigured?'O token do bot está configurado. A entrega de DM ainda depende das permissões do Discord e de uma confirmação explícita.':'A DM do bot para o proprietário verificado não exige administrar o Naruto RP, mas precisa de um bot próprio e do segredo DISCORD_BOT_TOKEN na Cloudflare.')+'</p>'+
 '<p class="muted">Configure apenas pela interface segura, nunca envie Bot Token no chat.</p>'+
 '<a href="https://discord.com/developers/applications/1561589128108314636/bot">Abrir Bot no Discord Developer Portal</a></details>';
 const note=dmNote+'<p class="muted">OAuth identifica você e libera a solicitação de comandos pessoais. Não permite enviar mensagens como conta de usuário. O modo Android permanece skill-only. As ferramentas MCP continuam indisponíveis no aplicativo ChatGPT Android enquanto o plugin original não estiver instalado/conectado.</p>';
 return mPage("Ferramentas do Bushin",'<p class="ok">✓ Sua sessão móvel continua conectada.</p><p>Catálogo de ferramentas do projeto. Abra uma categoria para conferir.</p>'+cards+note+'<a class="button" href="/mobile/dm">Diagnóstico e DM de teste</a><a class="button" href="/mobile/visual">Controlar navegador</a><a class="button" href="/mobile/workspace">Usar tarefas e memória</a><a class="button" href="/mobile/servers">Listar meus servidores</a><a class="button" href="/mobile">Voltar à conta</a>');
}

async function mobileSessionOwner(req,env){
 ready(env);
 const raw=mCookie(req,M_SESSION);
 if(!/^[A-Za-z0-9_-]{40,80}$/.test(raw))return null;
 const row=await q(env,"SELECT user_id,creds_encrypted FROM mobile_user_sessions WHERE token_hash=? AND expires_at>?",await digest(raw),now()).first();
 if(!row||row.user_id!==env.BUSHIN_OWNER_DISCORD_ID)return null;
 return row;
}
function mobileActionForm(op,id,label){
 return '<form method="post" action="/mobile/workspace" style="display:inline-block;margin:3px 3px 3px 0">'+
  '<input type="hidden" name="op" value="'+mEsc(op)+'">'+
  '<input type="hidden" name="task_id" value="'+mEsc(id)+'">'+
  '<button class="smallbutton" type="submit">'+mEsc(label)+'</button></form>';
}
async function mobileWorkspace(req,env){
 const row=await mobileSessionOwner(req,env);
 if(!row)return mGo("/mobile");
 const owner=row.user_id,context={me:{id:owner}};
 let notice="";
 if(req.method==="POST"){
   if(req.headers.get("origin")!==ready(env))return reply({error:"Wrong form origin"},403);
   if(!(req.headers.get("content-type")||"").startsWith("application/x-www-form-urlencoded"))
     return reply({error:"Expected form"},415);
   const raw=await req.text();
   if(raw.length>8192)return reply({error:"Form too long"},413);
   const p=new URLSearchParams(raw);
   const action=p.get("op")||"";
   try{
     if(action==="create"){
       await stateCall(env,"task_start",{title:p.get("title")||"",description:(p.get("description")||"").slice(0,1000),steps:[]},context);
       notice="Tarefa criada. Ela não roda sozinha.";
     }else if(["task_pause","task_resume","task_cancel"].includes(action)){
       await stateCall(env,action,{task_id:p.get("task_id")||"",confirmed:true},context);
       notice="Estado da tarefa atualizado.";
     }else if(action==="state_save"){
       const rawValue=p.get("value")||"";
       if(rawValue.length>2000||!rawValue.trim())throw Error("Texto do progresso inválido.");
       await stateCall(env,"bushin_save_state",{
         key:p.get("key")||"naruto_progress",
         value:rawValue.trim(),confirmed:true
       },context);
       notice="Progresso salvo no banco privado.";
     }else return reply({error:"Unknown action"},400);
   }catch(err){
     return mPage("Bushin — operação não concluída",'<p>'+mEsc(String(err?.message||"Erro").slice(0,240))+
       '</p><a class="button" href="/mobile/workspace">Voltar ao painel</a>');
   }
 }else if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 const tasks=(await q(env,"SELECT id,title,status,approval_summary,updated_at FROM bushin_tasks WHERE owner_id=? ORDER BY updated_at DESC LIMIT 15",owner).all()).results||[];
 const saved=(await q(env,"SELECT key,value_json,updated_at FROM bushin_project_state WHERE owner_id=? ORDER BY updated_at DESC LIMIT 10",owner).all()).results||[];
 const events=(await q(env,"SELECT action,summary,created_at FROM bushin_events WHERE owner_id=? ORDER BY id DESC LIMIT 12",owner).all()).results||[];
 const rows=tasks.map(t=>{
   const tools=t.status==="cancelled"?"":mobileActionForm("task_pause",t.id,"Pausar")+
     mobileActionForm("task_resume",t.id,"Retomar")+
     mobileActionForm("task_cancel",t.id,"Cancelar");
   return '<li style="padding:10px 0"><strong>'+mEsc(t.title)+'</strong> <span class="muted">('+mEsc(t.status)+')</span><div>'+tools+'</div></li>';
 }).join("");
 const memories=saved.map(x=>{
   let value="";try{value=JSON.parse(x.value_json);}catch{value="(não legível)"}
   return '<li><strong>'+mEsc(x.key)+'</strong>: '+mEsc(typeof value==="string"?value:JSON.stringify(value)).slice(0,350)+'</li>';
 }).join("");
 const history=events.map(x=>'<li>'+mEsc(x.action)+' — '+mEsc(x.summary)+'</li>').join("");
 const formStyle='<style>input[type=text],textarea{display:block;background:#0b1020;color:white;border:1px solid #526483;border-radius:9px;padding:11px;margin:8px 0 14px;box-sizing:border-box;width:100%;font:inherit}.smallbutton{background:#35446f;color:white;border:1px solid #7182af;border-radius:8px;padding:9px;font:inherit}h2{font-size:20px;margin-top:22px}ul{padding-left:20px}form{margin:8px 0}</style>';
 const html=formStyle+'<p class="ok">✓ Painel autenticado</p><p class="muted">As tarefas ficam guardadas no D1. Não há execução automática em segundo plano.</p>'+
   (notice?'<p class="ok">'+mEsc(notice)+'</p>':'')+
   '<h2>Nova tarefa Naruto RP</h2><form method="post" action="/mobile/workspace">'+
   '<input type="hidden" name="op" value="create"><label>Título<input type="text" maxlength="150" name="title" placeholder="Treinar na Academia" required></label>'+
   '<label>Detalhes<textarea name="description" rows="3" maxlength="1000" placeholder="Próximos passos do personagem"></textarea></label>'+
   '<button class="smallbutton" type="submit">Salvar tarefa</button></form>'+
   '<h2>Minhas tarefas</h2>'+(rows?'<ul>'+rows+'</ul>':'<p>Ainda não há tarefas.</p>')+
   '<h2>Salvar progresso</h2><form method="post" action="/mobile/workspace">'+
   '<input type="hidden" name="op" value="state_save"><label>Chave<input type="text" name="key" maxlength="70" value="naruto_progress" required></label>'+
   '<label>Anotações<textarea name="value" rows="4" maxlength="2000" placeholder="Minha graduação, treino, local atual..." required></textarea></label>'+
   '<button class="smallbutton" type="submit">Guardar progresso</button></form>'+
   '<h2>Memória salva</h2>'+(memories?'<ul>'+memories+'</ul>':'<p>Nenhum registro ainda.</p>')+
   '<h2>Histórico</h2>'+(history?'<ul>'+history+'</ul>':'<p>Nenhum evento ainda.</p>')+
   '<a class="button" href="/mobile/features">Ver outras ferramentas</a>';
 return mPage("Bushin — tarefas e progresso",html);
}
async function mobileServers(req,env){
 const row=await mobileSessionOwner(req,env);
 if(!row)return mGo("/mobile");
 if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 try{
   const creds=await unseal(row.creds_encrypted,env);
   if(creds.expires<now()+30000)return mPage("Discord expirou",'<p>Entre novamente pelo portal Discord.</p><a class="button" href="/mobile">Voltar</a>');
   const data=await discordCall(env,"discord_list_servers",{},{
     me:{id:row.user_id},creds
   });
   const servers=(data.servers||[]).map(s=>'<li style="padding:8px 0">'+mEsc(s.name)+
     (s.owner?' <span class="ok">(você administra)</span>':'')+'</li>').join("");
   return mPage("Meus servidores Discord",'<p class="ok">✓ Lista consultada pela API oficial com seu OAuth autorizado.</p>'+
     (servers?'<ul>'+servers+'</ul>':'<p>Nenhum servidor retornado.</p>')+
     '<p class="muted">Esta lista não concede leitura dos canais nem envio de mensagens.</p>'+
     '<a class="button" href="/mobile/workspace">Abrir tarefas</a>');
 }catch(err){
   return mPage("Não foi possível consultar servidores",'<p>A autorização pode ter expirado ou a API está temporariamente indisponível.</p>'+
     '<a class="button" href="/mobile">Voltar</a>');
 }
}

async function mobileDm(req,env){
 const record=await mobileSessionOwner(req,env);
 if(!record)return mGo("/mobile");
 const owner=record.user_id;
 const origin=ready(env);
 const context={me:{id:owner}};
 let status="";
 if(req.method==="POST"){
   if(req.headers.get("origin")!==origin)return reply({error:"Invalid request origin"},403);
   if(!(req.headers.get("content-type")||"").startsWith("application/x-www-form-urlencoded"))
     return reply({error:"Use form encoding"},415);
   const raw=await req.text();
   if(raw.length>2000)return reply({error:"Message too long"},413);
   const p=new URLSearchParams(raw);
   if(p.get("op")!=="send_test"||p.get("confirmed")!=="yes")
     return reply({error:"Explicit DM confirmation required"},400);
   const content=String(p.get("message")||"").trim();
   if(!content||content.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content))
     return reply({error:"Message must contain 1–300 ordinary characters"},400);
   if(!officialBotDmReady(env))return mGo("/mobile/dm?result=not_configured");
   // Rate limit is deliberately persistent across browser reloads and sessions.
   const day=(await q(env,"SELECT COUNT(*) AS n FROM bushin_events WHERE owner_id=? AND action='mobile_dm_attempt' AND created_at>?",owner,now()-86400000).first())?.n||0;
   const minuteCount=(await q(env,"SELECT COUNT(*) AS n FROM bushin_events WHERE owner_id=? AND action='mobile_dm_attempt' AND created_at>?",owner,now()-60000).first())?.n||0;
   if(Number(day)>=5||Number(minuteCount)>=1)return mGo("/mobile/dm?result=rate_limited");
   await q(env,"INSERT INTO bushin_events (owner_id,task_id,action,summary,created_at) VALUES (?,?,?,?,?)",
     owner,null,"mobile_dm_attempt","DM de teste para o proprietário verificado; conteúdo não armazenado",now()).run();
   try{
     const bot=await officialBotIdentity(env);
     if(!bot.verified) return mGo("/mobile/dm?result=bot_invalid");
     const result=await discordCall(env,"discord_send_dm",{recipient_id:owner,content,confirmed:true},context);
     if(result?.sent!==true)return mGo("/mobile/dm?result=not_sent");
     await q(env,"INSERT INTO bushin_events (owner_id,task_id,action,summary,created_at) VALUES (?,?,?,?,?)",
       owner,null,"mobile_dm_sent","Uma DM enviada pelo bot oficial; conteúdo não armazenado",now()).run();
     return mGo("/mobile/dm?result=sent");
   }catch{
     // Do not log or echo Discord upstream responses or the DM text.
     await q(env,"INSERT INTO bushin_events (owner_id,task_id,action,summary,created_at) VALUES (?,?,?,?,?)",
       owner,null,"mobile_dm_failed","Falha no envio de DM pelo bot oficial; sem repetição automática",now()).run();
     return mGo("/mobile/dm?result=failed");
   }
 }
 if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 const bot=await officialBotIdentity(env).catch(()=>({configured:true,verified:false,reason:"Discord indisponível no momento."}));
 const result=new URL(req.url).searchParams.get("result");
 const messages={
   sent:"✓ Discord confirmou o envio de uma DM pelo bot Bushin. Verifique sua caixa de mensagens.",
   failed:"Discord não confirmou o envio. Nenhuma repetição automática será feita.",
   bot_invalid:"O Discord não reconheceu o token do bot. Atualize o segredo somente no painel da Cloudflare.",
   not_configured:"Ainda falta o segredo DISCORD_BOT_TOKEN na Cloudflare.",
   not_sent:"O bot não confirmou o envio.",
   rate_limited:"Por segurança: no máximo uma tentativa por minuto e cinco por dia."
 };
 status=result&&Object.hasOwn(messages,result)?'<p class="muted">'+mEsc(messages[result])+'</p>':"";
 const info=bot.verified?
   '<p class="ok">✓ Bot Discord validado: '+mEsc(bot.username)+'</p>':
   '<p class="muted">'+mEsc(bot.configured?(bot.reason||"Bot não validado."):"Bot oficial ainda não configurado.")+'</p>';
 const form=bot.verified?
   '<form method="post" action="/mobile/dm" style="margin-top:14px">'+
   '<input type="hidden" name="op" value="send_test">'+
   '<label>Mensagem de teste (até 300 caracteres)<textarea name="message" rows="3" maxlength="300" required style="display:block;background:#0b1020;color:white;border:1px solid #526483;border-radius:8px;padding:12px;box-sizing:border-box;width:100%;margin-top:8px" placeholder="Olá! Testando o Bushin."></textarea></label>'+
   '<label style="display:block;margin-top:12px"><input type="checkbox" name="confirmed" value="yes" required> Confirmo o envio de UMA DM para minha própria conta Discord, em nome do bot Bushin.</label>'+
   '<button class="button" type="submit">Enviar uma DM de teste</button></form>':
   '<p>Para habilitar o teste, abra o Discord Developer Portal, selecione o aplicativo Bushin e configure a variável secreta DISCORD_BOT_TOKEN na Cloudflare. Não cole nenhuma chave neste chat.</p>'+
   '<a class="button" href="https://discord.com/developers/applications/1561589128108314636/bot">Configurar meu bot no Discord</a>'+
   '<a class="button" href="https://dash.cloudflare.com/">Abrir Cloudflare — Variables and Secrets</a>';
 return mPage("Bushin — DM de teste",'<p class="ok">✓ Conta pessoal confirmada pelo OAuth.</p>'+
   '<p>O teste usa a API de um bot oficial e envia apenas para a sua própria conta. Não envia como seu usuário e não libera canais do Naruto RP.</p>'+info+status+form+
   '<p class="muted">O Discord pode recusar DMs de bots se eles não compartilharem servidor ou se o usuário bloquear DMs. Nenhum envio é feito ao abrir esta página.</p>'+
   '<a class="button" href="/mobile/features">Voltar às ferramentas</a>');
}
async function mobilePersonalCommands(req,env){
 // Provide a precise, owner-only diagnostic BEFORE redirecting to an
 // installation flow which may say "Unknown Application". This does not
 // authorize new scopes or invalidate the existing mobile login.
 const row=await mobileSessionOwner(req,env);
 if(!row)return mGo("/mobile");
 const portal="https://discord.com/developers/applications/"+DISCORD_CLIENT_ID+"/installation";
 let status="Não foi possível verificar o aplicativo usando esta sessão OAuth.";
 let appMatches=false;
 try{
   const credentials=await unseal(row.creds_encrypted,env);
   if(credentials.expires>now()+30000){
     const result=await fetch(DISCORD+"/oauth2/@me",{
       headers:{authorization:"Bearer "+credentials.access,accept:"application/json"},
       signal:AbortSignal.timeout(10000)
     });
     if(result.ok){
       const info=await result.json();
       const appId=String(info?.application?.id||"");
       if(info?.user?.id===row.user_id&&/^\d{15,22}$/.test(appId)){
         appMatches=appId===DISCORD_CLIENT_ID;
         status=appMatches?
           "O Discord confirmou que seu login pertence ao aplicativo "+String(info.application.name||"Bushin").slice(0,70)+" (ID "+appId+").":
           "ATENÇÃO: o OAuth conectado pertence ao aplicativo "+appId+", mas o link tenta usar "+DISCORD_CLIENT_ID+".";
       }else{
         status="O Discord não confirmou o ID do aplicativo associado a este login.";
       }
     }else if(result.status===401){
       status="Sua autorização OAuth expirou; consulte a página principal antes de tentar novamente.";
     }
   }
 }catch{}
 const guide='<p>'+mEsc(status)+'</p>'+
   '<p>O Discord mostrou <strong>Aplicativo desconhecido</strong>. Antes de tentar novamente, confira:</p>'+
   '<ol style="line-height:1.75;padding-left:22px">'+
   '<li>No Discord Developer Portal → <strong>General Information</strong>, confirme o <strong>Application ID '+mEsc(DISCORD_CLIENT_ID)+'</strong>.</li>'+
   '<li>Em <strong>Installation → Installation Contexts</strong>, habilite <strong>User Install</strong>.</li>'+
   '<li>Em <strong>Default Install Settings → User Install</strong>, adicione o escopo <code>applications.commands</code>, selecione <strong>Discord Provided Link</strong> em Install Link e salve.</li>'+
   '</ol>'+
   '<a class="button" href="'+mEsc(portal)+'">Abrir instalação do aplicativo no Discord</a>'+
   (appMatches?'<a class="button" href="/mobile/commands/start">Já configurei: autorizar comandos</a>':
     '<p class="muted">O botão de autorização fica disponível depois que o Discord confirmar que o Client ID é o mesmo do login.</p>')+
   '<p class="muted">A instalação pessoal concede comandos do aplicativo, não leitura de canais ou envio de mensagens como sua conta. Não é necessário desconectar o login atual para configurar User Install.</p>'+
   '<a class="button" href="/mobile">Voltar à conta conectada</a>';
 return mPage("Configurar comandos pessoais",guide);
}
async function mobilePersonalCommandsStart(req,env){
 const row=await mobileSessionOwner(req,env);
 if(!row)return mGo("/mobile");
 return mGo(personalCommandsConsentUrl());
}
async function mobileStart(req,env){
 const b=ready(env),state="mobile."+rnd(),verifier=rnd()+rnd().slice(0,12);
 await q(env,"DELETE FROM mobile_oauth_flows WHERE expires_at<?",now()).run();
 await q(env,"INSERT INTO mobile_oauth_flows (state_hash,discord_verifier,expires_at) VALUES (?,?,?)",await digest(state),verifier,now()+10*minute).run();
 const u=new URL("https://discord.com/oauth2/authorize");
 for(const [k,v] of Object.entries({client_id:DISCORD_CLIENT_ID,redirect_uri:b+"/oauth/discord/callback",response_type:"code",scope:[...SCOPES,...(new URL(req.url).searchParams.get("basic")==="1"?[]:EXTRA_DISCORD_SCOPES)].join(" "),state,code_challenge_method:"S256",code_challenge:await digest(verifier),prompt:"consent"}))u.searchParams.set(k,v);
 return mGo(u.toString(),[mSet(M_FLOW,state,600)]);
}
async function mobileCallback(req,env){
 const b=ready(env),p=new URL(req.url).searchParams,state=p.get("state")||"";
 if(!/^mobile\.[A-Za-z0-9_-]{40,80}$/.test(state)||mCookie(req,M_FLOW)!==state)return mGo("/mobile?error=state");
 const row=await q(env,"DELETE FROM mobile_oauth_flows WHERE state_hash=? AND expires_at>? RETURNING *",await digest(state),now()).first();
 if(!row)return mGo("/mobile?error=expired",[mSet(M_FLOW,"",0)]);
 if(!p.get("code")||p.get("error")||(p.get("iss")&&p.get("iss")!=="https://discord.com"))return mGo("/mobile?error=denied",[mSet(M_FLOW,"",0)]);
 try{
   const creds=await discordToken(env,{grant_type:"authorization_code",code:p.get("code"),redirect_uri:b+"/oauth/discord/callback",code_verifier:row.discord_verifier});
   const profile=await verified(env,creds),session=rnd()+rnd().slice(0,12),until=Math.min(now()+12*60*minute,creds.expires-30000);
   if(until<=now())throw Error("Expired login");
   await q(env,"INSERT INTO mobile_user_sessions (token_hash,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?)",await digest(session),profile.id,await seal(creds,env),until).run();
   return mGo("/mobile",[mSet(M_FLOW,"",0),mSet(M_SESSION,session,Math.floor((until-now())/1000))]);
 }catch(e){
   const msg=String(e?.message||"");
   const supported=new Set(["discord_auth","discord_invalid_client","discord_invalid_grant","discord_invalid_request","discord_invalid_scope","discord_unauthorized_client","discord_unsupported_grant_type","discord_rate_limited","discord_unavailable"]);
   const kind=msg.includes("not the Bushin owner")?"owner":
     msg.includes("not in Naruto Project RP")?"guild":
     e?.errorCode==="invalid_scope"?"scope":
     supported.has(e?.errorCode)?e.errorCode:"service";
   return mGo("/mobile?error="+kind,[mSet(M_FLOW,"",0)]);
 }
}
async function mobileLogout(req,env){
 // Browser form POSTs can omit Origin. Keep CSRF protection by accepting an
 // exact same-origin Referer only when Origin is absent (never if mismatched).
 const expected=ready(env);
 const origin=req.headers.get("origin");
 const referer=req.headers.get("referer");
 let sameSite=false;
 if(origin===expected)sameSite=true;
 else if(!origin&&referer){
   try{sameSite=new URL(referer).origin===expected}catch{}
 }
 if(!sameSite)return reply({error:"Invalid origin"},403);
 const session=mCookie(req,M_SESSION);
 if(/^[A-Za-z0-9_-]{40,80}$/.test(session))await q(env,"DELETE FROM mobile_user_sessions WHERE token_hash=?",await digest(session)).run();
 return mGo("/mobile",[mSet(M_SESSION,"",0)]);
}

export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    try{
      const b=base(env);
      if(new URL(req.url).origin!==b)return reply({error:"Unrecognized host"},403);
      if(path==="/mobile/discord2"&&req.method==="GET"){
        const row=await mobileSessionOwner(req,env);
        if(!row)return mGo("/mobile");
        return new Response(PANEL_HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net https://media.tenor.com https://c.tenor.com https://*.giphy.com; media-src https://cdn.discordapp.com https://media.discordapp.net https://media.tenor.com https://c.tenor.com https://*.giphy.com; frame-ancestors 'none'; base-uri 'none'","x-content-type-options":"nosniff"}});
      }
      if(path==="/mobile/discord2/app.js"&&req.method==="GET"){
        const row=await mobileSessionOwner(req,env);
        if(!row)return reply({error:"login_required"},401);
        return new Response(PANEL_JS,{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
      }
      if(path.startsWith("/mobile/discord2/api/")){
        const row=await mobileSessionOwner(req,env);
        if(!row)return reply({state:"unauthorized",error:"Faça login no Bushin em /mobile"},401,{"cache-control":"no-store"});
        const ctx={me:{id:row.user_id,membership:{guild_id:NARUTO_GUILD_ID,member:true}}},headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
        if(path==="/mobile/discord2/api/channels"&&req.method==="GET"){
          const auth=await unseal(row.creds_encrypted,env);
          if(auth.expires<=now()+30000)return reply({state:"unauthorized",error:"Login Discord expirado. Entre novamente pelo Bushin."},401,headers);
          const [member,guilds]=await Promise.all([
            discordFetch(auth.access,"/users/@me/guilds/"+NARUTO_GUILD_ID+"/member"),
            discordFetch(auth.access,"/users/@me/guilds")
          ]);
          const guild=Array.isArray(guilds)?guilds.find(g=>String(g.id)===NARUTO_GUILD_ID):null;
          const basePermissions=guild?.permissions??guild?.permissions_new;
          if(!member||!Array.isArray(member.roles)||!/^[0-9]+$/.test(String(basePermissions??"")))
            return reply({state:"unavailable",error:"Não consegui verificar cargos e permissões. Não vou exibir canais sem verificação."},503,headers);
          const r=await personalListChannels(env,{...ctx,channelVisibility:{
            memberId:row.user_id,roles:member.roles,basePermissions:String(basePermissions)
          }});
          return reply(r,r.listed?200:503,headers);
        }
        const forumPostRoute=path.match(/^\/mobile\/discord2\/api\/forum\/([0-9]{15,22})\/posts$/);
        if(forumPostRoute&&req.method==="GET"){
          const cursor=new URL(req.url).searchParams.get("before")||null;
          const result=await personalForumThreads(env,forumPostRoute[1],ctx,cursor);
          return reply(result,result.listed?200:503,headers);
        }
        if(path==="/mobile/discord2/api/commands"&&req.method==="GET"){
          const inspected=await personalInspectCommand(env,{command:"/perfil ver"},ctx);
          return reply(inspected,inspected.catalog_verified===true?200:503,headers);
        }
        if(path==="/mobile/discord2/api/search/mine"&&req.method==="POST")return await searchHenriqueMessages(req,env,ctx,{reply,personalCall,baseUrl:base(env)});
        if(path==="/mobile/discord2/api/ai/scan"&&req.method==="POST")return await scanRpgChannels(req,env,ctx,{reply,personalCall,baseUrl:base(env)});
        if(path==="/mobile/discord2/api/ai/next"&&req.method==="POST")return await bushinAiNext(req,env,ctx,{reply,personalCall,baseUrl:base(env)});
        if(path==="/mobile/discord2/api/ai/autorp")return await bushinAutoRp(req,env,ctx,{reply,personalCall,baseUrl:base(env)});

        if(path==="/mobile/discord2/api/ai/opencode"){
          const HEAD={"cache-control":"no-store","x-content-type-options":"nosniff"};
          const owner=String(ctx.me?.id||"");
          const REPO="hp0592553-cyber/naruto-rpg-ia",KEY="bushin_opencode_runner_v1",WF="opencode-projeto.yml";
          if(owner!==String(env.BUSHIN_OWNER_DISCORD_ID||"")||ctx.me?.membership?.member!==true)return reply({error:"A conta autorizada do Henrique é necessária."},403,HEAD);
          if(typeof env.BUSHIN_GITHUB_TOKEN!=="string"||env.BUSHIN_GITHUB_TOKEN.length<20)return reply({error:"Token GitHub do Worker não configurado."},503,HEAD);
          const requestGitHub=async (route,method="GET",payload=null)=>{
            const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);
            try{
              const response=await fetch("https://api.github.com/repos/"+REPO+route,{method,redirect:"error",signal:ctrl.signal,headers:{
                Authorization:"Bearer "+env.BUSHIN_GITHUB_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Bushin-Naruto-Agent",
                ...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
              if(response.status===204||response.status===202)return {ok:true,status:response.status,data:null};
              if(!response.ok)return {ok:false,error:"GitHub retornou HTTP "+response.status,status:response.status};
              return {ok:true,data:await response.json(),status:response.status};
            }catch{return {ok:false,error:"Não foi possível conectar ao GitHub Actions.",status:503}}finally{clearTimeout(timeout)}
          };
          const getState=async()=>{try{const r=await env.DB.prepare("SELECT value_json FROM bushin_project_state WHERE owner_id=? AND key=?").bind(owner,KEY).first();return r?JSON.parse(r.value_json):null}catch{return null}};
          const save=async(value,minAge=0)=>{
            const now=Date.now(),result=await env.DB.prepare(
              "INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE bushin_project_state.updated_at < ?")
            .bind(owner,KEY,JSON.stringify(value),now,now-minAge).run();return Number(result.meta?.changes||0)===1;
          };
          const getRuns=()=>requestGitHub("/actions/workflows/"+WF+"/runs?branch=Projeto&event=workflow_dispatch&per_page=15");
          const candidate=(runs,st)=>runs.filter(r=>r.head_branch==="Projeto"&&Number(r.run_number||0)>Number(st.baseline||0)&&Date.parse(r.created_at||"")>=Number(st.at||0)-15000).sort((a,b)=>Number(a.run_number)-Number(b.run_number))[0]||null;
          const publicRun=r=>r?{id:String(r.id),url:"https://github.com/"+REPO+"/actions/runs/"+r.id,status:String(r.status||"unknown"),conclusion:String(r.conclusion||""),run_number:Number(r.run_number||0)}:null;
          if(req.method==="GET"){
            const st=await getState();if(!st)return reply({state:"idle",executed:false,confirmed:false},200,HEAD);
            const runs=await getRuns();if(!runs.ok)return reply({state:"unavailable",error:runs.error,requested_at:st.at},503,HEAD);
            const r=candidate(runs.data?.workflow_runs||[],st);
            if(!r)return reply({state:st.phase||"requested",requested_at:st.at,run:null,executed:false,confirmed:false,note:"GitHub pode demorar a listar um workflow recém-solicitado."},200,HEAD);
            return reply({state:r.status==="completed"?"finished":r.status,run:publicRun(r),requested_at:st.at,executed:false,confirmed:false,
              note:r.status==="completed"?"Workflow finalizado. Confira o artefato naruto-jogada-tentativa para confirmar ação e resposta, não somente a conclusão do GitHub.":"Workflow "+String(r.status)+"; nenhuma jogada comprovada ainda."},200,HEAD);
          }
          if(req.method!=="POST")return reply({error:"Método não permitido"},405,HEAD);
          if(req.headers.get("origin")!==base(env))return reply({error:"Origem inválida"},403,HEAD);
          if(!(req.headers.get("content-type")||"").startsWith("application/json"))return reply({error:"Formato inválido"},415,HEAD);
          const raw=await req.text();if(raw.length>250)return reply({error:"Pedido longo demais"},413,HEAD);
          let data;try{data=JSON.parse(raw)}catch{return reply({error:"JSON inválido"},400,HEAD)}
          if(!["start","stop"].includes(data?.action))return reply({error:"Ação inválida"},400,HEAD);
          const st=await getState();
          if(data.action==="start"){
            if(st&&Date.now()-Number(st.at||0)<600000)return reply({state:"cooldown",error:"Já foi solicitada uma tentativa nos últimos 10 minutos. Consulte o estado para não repetir."},409,HEAD);
            const runs=await getRuns();if(!runs.ok)return reply({error:runs.error},503,HEAD);
            const rows=runs.data?.workflow_runs||[];
            if(rows.some(r=>r.head_branch==="Projeto"&&["queued","in_progress","waiting","requested"].includes(r.status)))
              return reply({state:"busy",error:"Já há uma execução OpenCode em andamento. Não vou duplicá-la."},409,HEAD);
            const now=Date.now(),baseline=Math.max(0,...rows.map(r=>Number(r.run_number||0)));
            const reservation={at:now,baseline,phase:"dispatching",stopped:false};
            try{if(!(await save(reservation,600000)))return reply({state:"busy",error:"Outra tentativa já foi reservada."},409,HEAD)}catch{return reply({error:"Falha ao reservar tentativa no banco de dados."},503,HEAD)}
            const sent=await requestGitHub("/actions/workflows/"+WF+"/dispatches","POST",{ref:"Projeto",inputs:{mode:"jogar"}});
            if(!sent.ok){await save({...reservation,phase:"failed",reason:sent.error}).catch(()=>{});return reply({state:"unavailable",error:sent.error,submitted:false},503,HEAD)}
            await save({...reservation,phase:"requested"}).catch(()=>{});
            return reply({state:"requested",submitted:true,executed:false,confirmed:false,command:"/missoes minhas",
             note:"GitHub recebeu a solicitação do executor. O Naruto Bot ainda não confirmou nenhum comando; o workflow tentará uma consulta única de missões."},200,HEAD);
          }
          if(!st)return reply({state:"stopped",reason:"Nenhuma execução anterior."},200,HEAD);
          const runs=await getRuns();if(!runs.ok)return reply({state:"unavailable",error:runs.error},503,HEAD);
          const r=candidate(runs.data?.workflow_runs||[],st);
          if(r&&["queued","in_progress","waiting","requested"].includes(r.status)){
            const cancel=await requestGitHub("/actions/runs/"+r.id+"/cancel","POST");
            await save({...st,stopped:true,phase:cancel.ok?"cancel_requested":"cancel_failed"}).catch(()=>{});
            return reply({state:cancel.ok?"cancel_requested":"unavailable",run:publicRun(r),stopped:cancel.ok,reason:cancel.ok?"GitHub recebeu o pedido de cancelamento.":cancel.error},cancel.ok?200:503,HEAD);
          }
          await save({...st,stopped:true,phase:"stop_requested"}).catch(()=>{});
          return reply({state:"stop_requested",stopped:false,reason:"Nenhum workflow em execução foi identificado para cancelar."},200,HEAD);
        }

        if(path==="/mobile/discord2/api/ai/profile-probe"&&req.method==="POST"){
          if(req.headers.get("origin")!==base(env))return reply({error:"Origem inválida"},403,headers);
          if(!(req.headers.get("content-type")||"").startsWith("application/json"))return reply({error:"JSON inválido"},415,headers);
          const result=await personalInvokeProfileProbe(env,ctx);
          return reply(result,result.submitted===true?200:result.state==="unknown"?202:422,headers);
        }
        const m=path.match(/^\/mobile\/discord2\/api\/channels\/([0-9]{15,22})\/messages$/);
        if(m){
          const channel_id=m[1];
          if(req.method==="GET"){
            const u=new URL(req.url),before=u.searchParams.get("before")||undefined;
            if(before&&!/^[0-9]{15,22}$/.test(before))return reply({error:"Cursor inválido"},400,headers);
            const r=await personalCall(env,"bushin_naruto_personal_read",{channel_id,limit:12,...(before?{before}:{})},ctx);
            return reply(r,r.read?200:503,headers);
          }
          if(req.method==="POST"){
            if(req.headers.get("origin")!==base(env))return reply({error:"Origem inválida"},403,headers);
            if(!(req.headers.get("content-type")||"").startsWith("application/json"))return reply({error:"Tipo inválido"},415,headers);
            const raw=await req.text();
            if(raw.length>1400)return reply({error:"Mensagem grande demais"},413,headers);
            let data;try{data=JSON.parse(raw)}catch{return reply({error:"JSON inválido"},400,headers)}
            if(data?.confirmed!==true||typeof data?.content!=="string")return reply({error:"Confirmação ausente"},400,headers);
            const mentionIds=Array.isArray(data.mention_ids)?data.mention_ids:[];
            if(mentionIds.length>5||!mentionIds.every(id=>/^[0-9]{15,22}$/.test(String(id))&&data.content.includes("<@"+id+">")))return reply({error:"Marcações inválidas"},400,headers);
            const replyId=data.reply_to===undefined?null:String(data.reply_to);
            if(replyId!==null&&!/^[0-9]{15,22}$/.test(replyId))return reply({error:"Resposta inválida"},400,headers);
            const r=await personalCall(env,"bushin_naruto_personal_send",{channel_id,text:data.content,confirmed:true,mention_ids:mentionIds,...(replyId?{reply_to:replyId}:{})},ctx);
            return reply(r,r.sent?200:r.state==="unknown"?202:422,headers);
          }
        }
        return reply({error:"Rota não encontrada"},404,headers);
      }
      if((path==="/"||path==="/mobile")&&req.method==="GET")return await mobileHome(req,env);
      if(path==="/mobile/features"&&req.method==="GET")return await mobileFeatures(req,env);
      if(path==="/mobile/visual/takeover"&&req.method==="GET"){
        const row=await mobileSessionOwner(req,env);
        if(!row)return mGo("/mobile");
        return await visualTakeover(req,env,{ownerId:row.user_id,unseal:v=>unseal(v,env),redirect:mGo});
      }
      if(path==="/mobile/visual"&&["GET","POST"].includes(req.method)){
        const row=await mobileSessionOwner(req,env);
        if(!row)return mGo("/mobile");
        return await visualMobile(req,env,{ownerId:row.user_id,escape:mEsc,page:mPage,redirect:mGo,base:ready(env)});
      }
      if(path.startsWith("/bridge/runner/"))return await visualRunner(req,env,{seal:v=>seal(v,env)});
      if(path==="/mobile/workspace"&&["GET","POST"].includes(req.method))return await mobileWorkspace(req,env);
      if(path==="/mobile/servers"&&req.method==="GET")return await mobileServers(req,env);
      if(path==="/mobile/dm"&&["GET","POST"].includes(req.method))return await mobileDm(req,env);
      if(path==="/mobile/commands"&&req.method==="GET")return await mobilePersonalCommands(req,env);
      if(path==="/mobile/commands/start"&&req.method==="GET")return await mobilePersonalCommandsStart(req,env);
      if(path==="/mobile/start"&&req.method==="GET")return await mobileStart(req,env);
      if(path==="/mobile/logout"&&req.method==="POST")return await mobileLogout(req,env);
      if(path==="/oauth/discord/callback"&&req.method==="GET"&&new URL(req.url).searchParams.get("state")?.startsWith("mobile."))return await mobileCallback(req,env);
      if(path==="/health"&&req.method==="GET")return reply({
        app:"Bushin Browser — Discord Direct (Cloudflare)",client_id:DISCORD_CLIENT_ID,
        catalog_revision:CATALOG_REVISION,tool_count:mcpTools().length,
        connected:false,login_required:true,backend:"cloudflare-workers",
        no_github_dependency:true,configuration_ready:!!(env.DB&&env.DISCORD_CLIENT_SECRET&&
          env.ENCRYPTION_KEY_BASE64&&env.BUSHIN_OWNER_DISCORD_ID)
      });
      if(path==="/.well-known/oauth-protected-resource"||path==="/.well-known/oauth-protected-resource/mcp")
        return reply({resource:b+"/mcp",authorization_servers:[b],scopes_supported:SCOPES});
      if(path==="/.well-known/oauth-authorization-server")return reply(oauthMetadata(env));
      if(path==="/oauth/register"&&req.method==="POST")return await register(req,env);
      if(path==="/oauth/authorize"&&req.method==="GET")return await authorize(req,env);
      if(path==="/oauth/discord/callback"&&req.method==="GET")return await discordCallback(req,env);
      if(path==="/oauth/token"&&req.method==="POST")return await token(req,env);
      if(path==="/mcp"&&req.method==="GET"){
        const accept=req.headers.get("accept")||"";
        // MCP is an authenticated POST API, not a browser page. For human
        // navigation provide an explanation; for machine GETs advertise POST.
        if(accept && !accept.includes("text/html")&&!accept.includes("*/*"))
          return reply({error:"MCP requires POST",method:"POST",login_portal:"/mobile"},405,{"allow":"POST"});
        return mPage("Bushin Browser — conexão ChatGPT",
          '<p>Este endereço <code>/mcp</code> é uma API para clientes MCP, não um site para abrir como login.</p>'+
          '<p><strong>Para chamar as ferramentas dentro do ChatGPT, o plugin Bushin precisa estar instalado e conectado como aplicativo compatível.</strong> Abrir esta página no navegador não faz essa instalação.</p>'+
          '<p>A autorização Discord do painel móvel é separada da conexão MCP no ChatGPT. Você não precisa desconectar sua conta para testar a integração.</p>'+
          '<a class="button" href="/mobile">Abrir o portal móvel do Bushin</a>'+
          '<p class="muted">Ferramentas MCP: use o endpoint HTTPS /mcp com um cliente compatível e autorização OAuth. O navegador comum usa GET, enquanto as chamadas RPC usam POST.</p>');
      }
      if(path==="/mcp"&&req.method==="POST")return await mcp(req,env);
      return reply({error:"Not found"},404);
    }catch(e){return oauthReply(e);}
  }
};
