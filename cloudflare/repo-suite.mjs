/**
 * Bushin workspace/GitHub adapter. A Cloudflare-scoped GitHub token is optional.
 * No Github token is sent to MCP callers, returned as an error, or added to logs.
 */
const REPO="educacaomggovbr00-web/shinobi-ai-agent";
const API="https://api.github.com/repos/"+REPO;
const ready=env=>typeof env.BUSHIN_GITHUB_TOKEN==="string"&&env.BUSHIN_GITHUB_TOKEN.length>=20;
const blocked=()=>({state:"unavailable",configured:false,reason:"Acesso GitHub do Worker indisponível: configure BUSHIN_GITHUB_TOKEN como Secret na Cloudflare. O plugin GitHub conectado ao chat é independente."});
const ensure=s=>{if(!s)throw Error("GitHub no Worker não configurado.")};
const pathOk=(path,readonly=false)=>{
 if(typeof path!=="string"||path.length>200||path.includes("..")||! /^[A-Za-z0-9_./-]+$/.test(path)||path.startsWith("/")||path.includes("//"))
   throw Error("Caminho inválido.");
 if(!readonly&& !/^bushin_workspace\/[a-zA-Z0-9_./-]{1,150}\.(txt|json|md|csv)$/.test(path))
   throw Error("Escrita de arquivo limitada à pasta bushin_workspace e formatos texto.");
 return path;
};
function safeGitHubPath(path){return path.split("/").map(encodeURIComponent).join("/");}
function toBase64(text){return btoa(String.fromCharCode(...new TextEncoder().encode(text)));}
function fromBase64(raw){return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(raw.replace(/\s/g,"")),c=>c.charCodeAt(0)));}
async function github(env,route,method="GET",payload=null,allowMissing=false){
 ensure(ready(env));
 const response=await fetch(API+route,{
   method,
   headers:{
     authorization:"Bearer "+env.BUSHIN_GITHUB_TOKEN,
     accept:"application/vnd.github+json",
     "x-github-api-version":"2022-11-28",
     "user-agent":"Bushin-Cloudflare-Workspace",
     ...(payload?{"content-type":"application/json"}:{})
   },
   ...(payload?{body:JSON.stringify(payload)}:{}),
   signal:AbortSignal.timeout(12000)
 });
 if(allowMissing&&response.status===404)return null;
 if(!response.ok)throw Error("GitHub negou a operação (HTTP "+response.status+").");
 if(response.status===204)return {ok:true};
 return response.json();
}
const normalizedText=(value)=>{
 if(typeof value!=="string"||!value.length||new TextEncoder().encode(value).length>12000)
   throw Error("Conteúdo texto obrigatório, máximo 12 kB UTF-8.");
 return value;
};
async function file(env,path){
 const result=await github(env,"/contents/"+safeGitHubPath(path)+"?ref=main","GET",null,true);
 if(!result)return null;
 if(result.type!=="file"||!result.content||result.encoding!=="base64")throw Error("O caminho não é um arquivo texto do GitHub.");
 if(result.size>25000)throw Error("Arquivo grande demais para leitura em chat.");
 return {path,sha:result.sha,size:result.size,content:fromBase64(result.content)};
}
async function put(env,path,value,approval=false){
 if(approval!==true)throw Error("A escrita só é aceita depois da confirmação explícita do usuário.");
 const content=normalizedText(value);
 const previous=await file(env,path);
 const payload={message:"🍥 Bushin authorized workspace update: "+path,content:toBase64(content),branch:"main",...(previous?{sha:previous.sha}:{})};
 const data=await github(env,"/contents/"+safeGitHubPath(path),"PUT",payload);
 return {state:"completed",saved:true,path,commit:data.commit?.sha||null,bytes:new TextEncoder().encode(content).length};
}
async function dispatch(env,workflow,ref="main"){
 return github(env,"/actions/workflows/"+encodeURIComponent(workflow)+"/dispatches","POST",{ref});
}
export async function repoCall(env,name,args={},ctx={}){
 if(!ready(env))return blocked();
 if(name==="browser_start"){
   if(args.confirmed!==true)throw Error("Para iniciar o Linux temporário, confirme a ação.");
   const runs=await github(env,"/actions/workflows/bushin-discord-live.yml/runs?status=in_progress&per_page=10");
   const existing=(runs.workflow_runs||[]).find(x=>x.head_branch==="main"&&x.status==="in_progress");
   if(existing)return {state:"already_running",run_id:String(existing.id),url:existing.html_url,login_required:"Confira o estado da sessão visual."};
   await dispatch(env,"bushin-discord-live.yml");
   return {state:"requested",note:"Início solicitado ao GitHub Actions. Aguarde o workflow e faça login só na janela protegida do navegador. Nada foi conectado automaticamente.",url:"https://github.com/"+REPO+"/actions/workflows/bushin-discord-live.yml"};
 }
 if(name==="files_list"){
   const tree=await github(env,"/git/trees/main?recursive=1");
   const prefix=typeof args.path==="string"&&args.path.startsWith("bushin_workspace/")?args.path:"bushin_workspace/";
   return {state:"completed",folder:prefix,files:(tree.tree||[]).filter(x=>x.type==="blob"&&x.path.startsWith(prefix)).slice(0,100).map(x=>({path:x.path,bytes:x.size})),truncated:!!tree.truncated};
 }
 if(name==="files_read"||name==="files_download"){
   const path=pathOk(args.path,true);
   if(!path.startsWith("bushin_workspace/"))throw Error("Arquivos pessoais limitados à pasta bushin_workspace.");
   const item=await file(env,path);
   if(!item)return {state:"not_found",path};
   return {state:"completed",path,size:item.size,content:item.content,delivery:"Conteúdo texto retornado; nenhum arquivo foi baixado no aparelho."};
 }
 if(name==="files_upload"){
   const path=pathOk(args.path);
   return put(env,path,args.content,args.confirmed);
 }
 if(name==="github_read_repo"){
   if(args.path){
     const path=pathOk(args.path,true);
     if(!/^(browser_actions\/rpg_progress\.json|browser_actions\/RPG_PLAYBOOK\.md|bushin_workspace\/|services\/discord-oauth\/cloudflare\/README\.md)/.test(path))
       throw Error("Arquivo fora do escopo de leitura do Bushin.");
     const item=await file(env,path);
     return item?{state:"completed",...item}:{state:"not_found",path};
   }
   const info=await github(env,"");
   return {state:"completed",full_name:info.full_name,private:info.private,default_branch:info.default_branch,html_url:info.html_url};
 }
 if(name==="github_edit_file"){
   const path=pathOk(args.path,true);
   if(path==="browser_actions/rpg_progress.json"){
     if(args.confirmed!==true)throw Error("Confirme a edição da ficha comprovada pelo servidor.");
     const data=JSON.parse(normalizedText(args.content));
     if(data?.servidor!=="Naruto Project RP"||data?.personagem!=="Henrique")
       throw Error("Identidade da ficha inválida.");
     return putInternal(env,path,args.content);
   }
   return put(env,pathOk(path),args.content,args.confirmed);
 }
 if(name==="github_run_tests"){
   if(args.confirmed!==true)throw Error("Confirme a execução de testes no GitHub Actions.");
   await dispatch(env,"bushin-browser-command-tests.yml");
   return {state:"requested",workflow:"bushin-browser-command-tests.yml",note:"Solicitação recebida. Não representa aprovação dos testes até o workflow terminar."};
 }
 throw Error("Operação de repositório desconhecida.");
}
async function putInternal(env,path,content){
 const existing=await file(env,path);
 if(!existing)throw Error("A ficha existente não foi encontrada.");
 const result=await github(env,"/contents/"+safeGitHubPath(path),"PUT",{
   message:"🍥 Bushin: update confirmed Naruto RP progress",branch:"main",sha:existing.sha,content:toBase64(content)
 });
 return {state:"completed",path,commit:result.commit?.sha||null};
}
