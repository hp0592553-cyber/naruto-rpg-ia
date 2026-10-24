/**
 * Bushin visual bridge: owner OAuth session -> D1 queue -> GitHub Actions OIDC
 * authenticated runner. No GitHub PAT, Discord user token or cookies in runner
 * commands. Every command is revalidated by browser_actions/live_controller.py.
 */
const REPO="educacaomggovbr00-web/shinobi-ai-agent";
const REF=REPO+"/.github/workflows/bushin-discord-live.yml@refs/heads/main";
const SMOKE_REF=REPO+"/.github/workflows/bushin-oidc-bridge-smoke.yml@refs/heads/main";
const ISS="https://token.actions.githubusercontent.com";
const AUD="bushin-cloudflare-visual-v1";
const GUILD="1515877468299595919";
const OWNER_ID="260082480",REPO_ID="1424794298";
const OIDC_SUBJECTS=new Set([
 "repo:"+REPO+":ref:refs/heads/main",
 "repo:educacaomggovbr00-web@"+OWNER_ID+"/shinobi-ai-agent@"+REPO_ID+":ref:refs/heads/main"
]);
const millis=()=>Date.now();
const enc=new TextEncoder();
const urlSafe=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const fromUrlSafe=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const digest=async str=>urlSafe(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(str))));
const randomSecret=()=>{const b=new Uint8Array(36);crypto.getRandomValues(b);return urlSafe(b)};
const query=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
const fail=(message,status=400)=>json({error:message},status);
function stripJwt(text){
 if(typeof text!=="string"||text.length<150||text.length>9000||! /^[A-Za-z0-9_.-]+$/.test(text))throw Error("OIDC format rejected");
 const parts=text.split(".");
 if(parts.length!==3)return null;
 const head=JSON.parse(new TextDecoder().decode(fromUrlSafe(parts[0])));
 const payload=JSON.parse(new TextDecoder().decode(fromUrlSafe(parts[1])));
 return {parts,head,payload};
}
let jwksMemo=null;
async function jwks(){
 if(jwksMemo&&jwksMemo.expires>millis())return jwksMemo.keys;
 // Fixed GitHub Actions OpenID issuer; no redirect or client-selected host.
 const r=await fetch(ISS+"/.well-known/jwks",{signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error("GitHub OIDC public keys unavailable");
 const v=await r.json();
 if(!Array.isArray(v.keys)||v.keys.length>40)throw Error("Unexpected GitHub JWKS");
 jwksMemo={keys:v.keys,expires:millis()+15*60000};
 return v.keys;
}
export async function verifyGitHubOidc(jwt,{allowSmoke=false}={}){
 const v=stripJwt(jwt);
 if(!v||v.head?.alg!=="RS256"||typeof v.head?.kid!=="string")return null;
 const c=v.payload,t=Math.floor(millis()/1000);
 if(c.iss!==ISS||c.aud!==AUD||c.repository!==REPO||c.ref!=="refs/heads/main"||
    !(c.workflow_ref===REF||(allowSmoke&&c.workflow_ref===SMOKE_REF))||!OIDC_SUBJECTS.has(c.sub)||
    String(c.repository_id)!==REPO_ID||String(c.repository_owner_id)!==OWNER_ID||
    !["workflow_dispatch","push"].includes(c.event_name)||c.runner_environment!=="github-hosted"||
    !/^[0-9]{8,20}$/.test(String(c.run_id||""))||
    !Number.isInteger(c.exp)||c.exp<=t||c.exp>t+600||
    !Number.isInteger(c.iat)||c.iat>t+60||c.iat<t-600||
    (c.nbf!==undefined&&c.nbf>t+30)||
    typeof c.jti!=="string"||c.jti.length<10||c.jti.length>180)return null;
 const candidates=await jwks();
 const key=candidates.find(k=>k.kid===v.head.kid&&k.kty==="RSA"&&(!k.alg||k.alg==="RS256")&&k.use==="sig");
 if(!key)return null;
 const imported=await crypto.subtle.importKey("jwk",key,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 const valid=await crypto.subtle.verify({name:"RSASSA-PKCS1-v1_5"},imported,fromUrlSafe(v.parts[2]),enc.encode(v.parts[0]+"."+v.parts[1]));
 return valid?{runId:String(c.run_id),jti:c.jti}:null;
}
async function readRunner(req,env){
 const runId=new URL(req.url).searchParams.get("run_id")||"";
 const auth=req.headers.get("authorization")||"";
 const token=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!/^[0-9]{8,20}$/.test(runId)||!/^[A-Za-z0-9_-]{45,100}$/.test(token))return null;
 const row=await query(env,"SELECT * FROM bushin_visual_sessions WHERE run_id=? AND token_hash=? AND expires_at>?",
  runId,await digest(token),millis()).first();
 return row||null;
}
const validAction=new Set(["status","read_page_text","rpg_view","rpg_scout","inspect_ui","screenshot","capture_gallery","tabs",
 "scroll","press","click","open_url","compose_message","send_message","send_command","type_search"]);
export function validateMobileAction(form){
 const action=String(form.get("action")||"");
 if(!validAction.has(action))throw Error("Ação não suportada.");
 const args={};
 const exactChannel=text=>{
   if(typeof text!=="string"||text.length>180)throw Error("Canal inválido.");
   const u=new URL(text);
   if(u.origin!=="https://discord.com"||u.search||u.hash||!new RegExp("^/channels/"+GUILD+"/[0-9]{15,22}$").test(u.pathname))
     throw Error("Só canais específicos do Naruto Project RP são permitidos.");
   return u.origin+u.pathname;
 };
 if(["open_url"].includes(action))args.url=exactChannel(String(form.get("url")||""));
 if(["compose_message","send_message","send_command"].includes(action)){
   args.channel_url=exactChannel(String(form.get("url")||""));
   args.text=String(form.get("text")||"");
   if(args.text.length<1||args.text.length>500||args.text!==args.text.trim()||/[\r\n\x00]/.test(args.text)||/@(?:everyone|here)\b/i.test(args.text))
     throw Error("Digite uma única linha, no máximo 500 caracteres e sem menções em massa.");
   if(["send_message","send_command"].includes(action)){
     if(form.get("confirmed")!=="yes")throw Error("Marque a confirmação do envio.");
     args.confirm=true;
   }
 }
 if(["rpg_scout","capture_gallery"].includes(action)){
   args.urls=String(form.get("urls")||"").split(/[\n,]+/).map(x=>x.trim()).filter(Boolean).map(exactChannel);
   if(args.urls.length<(action==="capture_gallery"?2:1)||args.urls.length>4||new Set(args.urls).size!==args.urls.length)
     throw Error("Informe de 1 a 4 canais diferentes (galeria requer ao menos 2).");
 }
 if(action==="tabs"&&form.has("tab_index")&&form.get("tab_index")!==""){
   const ix=Number(form.get("tab_index"));if(!Number.isInteger(ix)||ix<0||ix>20)throw Error("Aba inválida.");args.tab_index=ix;
 }
 if(action==="scroll"){
   args.direction=String(form.get("direction")||"down");
   args.amount=Number(form.get("amount")||3);
   if(!["up","down"].includes(args.direction)||!Number.isInteger(args.amount)||args.amount<1||args.amount>8)
     throw Error("Rolagem inválida.");
 }
 if(action==="click"){
   args.x=Number(form.get("x"));args.y=Number(form.get("y"));
   if(!Number.isInteger(args.x)||args.x<0||args.x>=1365||!Number.isInteger(args.y)||args.y<0||args.y>=768)
     throw Error("Clique fora da tela.");
 }
 if(action==="press"){
   args.key=String(form.get("key")||"");
   if(!["Escape","Tab","Enter","ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(args.key))
     throw Error("Tecla não permitida.");
 }
 if(action==="type_search"){
   args.text=String(form.get("text")||"");
   if(!args.text||args.text.length>100||/[\r\n]/.test(args.text))throw Error("Busca inválida.");
 }
 return {action,args};
}
export async function visualRunner(req,env,{seal=null}={}){
 const path=new URL(req.url).pathname;
 if(path==="/bridge/runner/register"){
   if(req.method!=="POST")return fail("Method not allowed",405);
   const head=req.headers.get("authorization")||"";
   const jwt=head.startsWith("Bearer ")?head.slice(7):"";
   const dryRun=new URL(req.url).searchParams.get("dry_run")==="1";
   let validated;try{validated=await verifyGitHubOidc(jwt,{allowSmoke:dryRun})}catch{return fail("OIDC verification rejected",403);}
   if(!validated)return fail("Unauthorized runner identity",403);
   // Verification-only test: no runner secret or database session is created.
   if(dryRun)return json({verified:true,run_id:validated.runId});
   // Short-lived and one-use OIDC jti prevents replay of a GH id token.
   const before=await query(env,"SELECT jti_hash FROM bushin_visual_jti WHERE jti_hash=?",await digest(validated.jti)).first();
   if(before)return fail("OIDC replay rejected",409);
   const session=randomSecret(),clock=millis();
   await query(env,"INSERT INTO bushin_visual_jti(jti_hash,expires_at) VALUES (?,?)",await digest(validated.jti),clock+15*60000).run();
   await query(env,"INSERT INTO bushin_visual_sessions(run_id,owner_id,token_hash,created_at,expires_at,last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner_id=excluded.owner_id,token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,last_seen=excluded.last_seen",
     validated.runId,env.BUSHIN_OWNER_DISCORD_ID,await digest(session),clock,clock+5*60*60000,clock).run();
   return json({registered:true,run_id:validated.runId,runner_token:session,expires_at:clock+5*60*60000});
 }
 if(!["GET","POST"].includes(req.method))return fail("Method not allowed",405);
 const row=await readRunner(req,env);
 if(!row)return fail("Runner authentication required",401);
 if(path==="/bridge/runner/takeover"&&req.method==="POST"){
   if(typeof seal!=="function")return fail("Takeover encryption unavailable",503);
   if(Number(req.headers.get("content-length")||0)>1200)return fail("Payload too large",413);
   const body=await req.text();if(body.length>1200)return fail("Payload too large",413);
   let url="";
   try{url=JSON.parse(body).url}catch{return fail("Malformed takeover request")}
   if(typeof url!=="string"||!/^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/connect\?key=[A-Za-z0-9_-]{35,90}$/.test(url))
     return fail("Invalid secure takeover link");
   await query(env,"UPDATE bushin_visual_sessions SET takeover_encrypted=? WHERE run_id=? AND owner_id=?",
     await seal(url),row.run_id,row.owner_id).run();
   return json({secured:true});
 }
 if(path==="/bridge/runner/poll"&&req.method==="GET"){
   await query(env,"UPDATE bushin_visual_sessions SET last_seen=? WHERE run_id=?",millis(),row.run_id).run();
   const command=await query(env,"SELECT * FROM bushin_visual_commands WHERE run_id=? AND owner_id=? AND state='queued' ORDER BY created_at ASC LIMIT 1",
     row.run_id,row.owner_id).first();
   if(!command)return json({command:null});
   const changed=await query(env,"UPDATE bushin_visual_commands SET state='in_progress',updated_at=? WHERE id=? AND state='queued'",
     millis(),command.id).run();
   if(changed.meta?.changes===0)return json({command:null});
   return json({command:{id:command.id,session_id:command.run_id,action:command.action,...JSON.parse(command.args_json)}});
 }
 if(path==="/bridge/runner/result"&&req.method==="POST"){
   if(Number(req.headers.get("content-length")||0)>18000)return fail("Result too large",413);
   const raw=await req.text();if(raw.length>18000)return fail("Result too large",413);
   const data=JSON.parse(raw);
   if(typeof data.id!=="string"||! /^visual_[a-f0-9]{32}$/.test(data.id)||typeof data.ok!=="boolean")
     return fail("Invalid command result");
   const res=JSON.stringify(data.ok?data.data:data.error||"Action failed");
   if(res.length>13500)return fail("Result too large",413);
   const saved=await query(env,"UPDATE bushin_visual_commands SET state=?,result_json=?,updated_at=? WHERE id=? AND run_id=? AND state='in_progress'",
     data.ok?"completed":"failed",res,millis(),data.id,row.run_id).run();
   return json({stored:!(saved.meta?.changes===0)});
 }
 return fail("Not found",404);
}
function validMobileFormOrigin(req,base){
 const origin=req.headers.get("origin");
 if(origin)return origin===base;
 const referer=req.headers.get("referer");
 if(!referer)return false;
 try{return new URL(referer).origin===base}catch{return false}
}
export async function visualMobile(req,env,{ownerId,escape,page,redirect,base}){
 const clock=millis();
 const rows=await query(env,"SELECT run_id,expires_at,last_seen,takeover_encrypted FROM bushin_visual_sessions WHERE owner_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1",
   ownerId,clock).all();
 const runner=rows.results?.[0]||null;
 const online=runner&&runner.last_seen>clock-60000;
 if(req.method==="POST"){
   if(!validMobileFormOrigin(req,base))return fail("Invalid form origin",403);
   if(!(req.headers.get("content-type")||"").startsWith("application/x-www-form-urlencoded"))return fail("Invalid form encoding",415);
   if(Number(req.headers.get("content-length")||0)>5000)return fail("Form too large",413);
   const body=await req.text();if(body.length>5000)return fail("Form too large",413);
   if(!online)return redirect("/mobile/visual?error=offline");
   let validated;
   try{validated=validateMobileAction(new URLSearchParams(body));}
   catch{return redirect("/mobile/visual?error=invalid");}
   const outstanding=await query(env,"SELECT COUNT(*) AS total FROM bushin_visual_commands WHERE run_id=? AND owner_id=? AND state IN ('queued','in_progress')",
     runner.run_id,ownerId).first();
   if(Number(outstanding?.total||0)>=4)return redirect("/mobile/visual?error=busy");
   const id="visual_"+Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("");
   await query(env,"INSERT INTO bushin_visual_commands(id,run_id,owner_id,action,args_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
     id,runner.run_id,ownerId,validated.action,JSON.stringify(validated.args),"queued",clock,clock).run();
   return redirect("/mobile/visual?queued=1");
 }
 const recent=runner?await query(env,"SELECT id,action,state,result_json,created_at,updated_at FROM bushin_visual_commands WHERE run_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 12",
   runner.run_id,ownerId).all():{results:[]};
 const url=new URL(req.url),message=url.searchParams.has("queued")?"✓ Comando enfileirado. Atualize a página para ver o resultado.":
   url.searchParams.get("error")==="offline"?"Nenhum navegador autenticado e ativo. Abra uma sessão pelo GitHub Actions.":
   url.searchParams.get("error")==="busy"?"Fila cheia. Aguarde os comandos anteriores.":
   url.searchParams.has("error")?"Comando inválido. Confira canal e confirmação.":"";
 const renderResult=item=>{
   let value="";try{value=item.result_json?JSON.stringify(JSON.parse(item.result_json),null,2):"Aguardando navegador..."}catch{value="Resultado indisponível";}
   return '<details style="border:1px solid #394761;padding:10px;border-radius:10px;margin:8px 0"><summary>'+escape(item.action)+' — '+escape(item.state)+'</summary><pre style="white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere">'+escape(value.slice(0,10000))+'</pre></details>';
 };
 const actions=[
  ["status","Verificar status"],["rpg_view","Ler RPG atual"],["read_page_text","Ler página"],["tabs","Listar abas"],
  ["inspect_ui","Inspecionar botões"],["screenshot","Capturar tela"]
 ].map(([action,title])=>'<form method="post" action="/mobile/visual" style="margin:7px 0"><input type="hidden" name="action" value="'+action+'"><button class="button" style="margin:0" type="submit">'+title+'</button></form>').join("");
 const tools='<h2>Navegação rápida</h2>'+
  '<form method="post" action="/mobile/visual" style="display:inline-block;margin:4px"><input type="hidden" name="action" value="scroll"><input type="hidden" name="direction" value="up"><input type="hidden" name="amount" value="3"><button class="button" style="margin:0">Rolar para cima</button></form>'+
  '<form method="post" action="/mobile/visual" style="display:inline-block;margin:4px"><input type="hidden" name="action" value="scroll"><input type="hidden" name="direction" value="down"><input type="hidden" name="amount" value="3"><button class="button" style="margin:0">Rolar para baixo</button></form>'+
  '<form method="post" action="/mobile/visual"><input type="hidden" name="action" value="press"><input type="hidden" name="key" value="Escape"><button class="button">Voltar/fechar menu</button></form>';
 const form='<h2>Navegar no Naruto RP</h2><form method="post" action="/mobile/visual"><input type="hidden" name="action" value="open_url"><label>URL de canal</label><input style="width:100%;padding:12px" name="url" placeholder="https://discord.com/channels/..."><button class="button">Abrir canal</button></form>'+
 '<h2>Preparar uma mensagem</h2><form method="post" action="/mobile/visual"><input type="hidden" name="action" value="compose_message"><label>URL exata do canal</label><input name="url" style="width:100%;padding:12px" required><label>Texto</label><textarea name="text" maxlength="500" style="width:100%;min-height:100px" required></textarea><button class="button">Digitar sem enviar</button></form>'+
 '<h2>Enviar com confirmação</h2><form method="post" action="/mobile/visual"><input type="hidden" name="action" value="send_message"><label>URL exata do canal</label><input name="url" style="width:100%;padding:12px" required><label>Texto a enviar</label><textarea name="text" maxlength="500" style="width:100%;min-height:100px" required></textarea><label><input type="checkbox" name="confirmed" value="yes" required> Confirmo o envio no canal escolhido</label><button class="button">Enviar mensagem</button></form>';
 const hint=online?'<p class="ok">✓ Navegador temporário conectado à Cloudflare. Isso não confirma login no Discord.</p>':
   '<p>Não há navegador ativo. <a href="https://github.com/'+REPO+'/actions/workflows/bushin-discord-live.yml">Iniciar uma sessão pelo GitHub Actions</a> e faça login na janela segura. O OAuth móvel não transfere sua sessão ao Chromium.</p>';
 const takeover=online&&runner.takeover_encrypted?
   '<a class="button" href="/mobile/visual/takeover">Assumir navegador visual (acesso protegido)</a>':"";
 const html=(message?'<p>'+escape(message)+'</p>':"")+hint+
   takeover+'<h2>Comandos rápidos</h2>'+actions+tools+form+
   '<h2>Resultados recentes</h2>'+(recent.results||[]).map(renderResult).join("")+
   '<a class="button" href="/mobile/visual">Atualizar resultados</a><a class="button" href="/mobile">Voltar ao Bushin</a>';
 return page("Controle visual do Bushin",html);
}

export async function visualTakeover(req,env,{ownerId,unseal,redirect}){
 if(typeof unseal!=="function")return redirect("/mobile/visual");
 const clock=millis();
 const row=await query(env,"SELECT takeover_encrypted FROM bushin_visual_sessions WHERE owner_id=? AND expires_at>? AND last_seen>? AND takeover_encrypted IS NOT NULL ORDER BY created_at DESC LIMIT 1",
   ownerId,clock,clock-60000).first();
 if(!row?.takeover_encrypted)return redirect("/mobile/visual");
 let url="";
 try{url=await unseal(row.takeover_encrypted)}catch{return redirect("/mobile/visual")}
 if(typeof url!=="string"||!/^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/connect\?key=[A-Za-z0-9_-]{35,90}$/.test(url))
   return redirect("/mobile/visual");
 return redirect(url);
}
