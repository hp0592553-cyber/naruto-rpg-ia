/** Short-lived GitHub integration-test session; never exports the Discord Secret. */
const REPO='hp0592553-cyber/naruto-rpg-ia';
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function validSessionClaims(c,audience,now=Math.floor(Date.now()/1000)){
 return c.iss==='https://token.actions.githubusercontent.com'&&c.aud===audience&&c.repository===REPO&&String(c.repository_id)==='1429981222'&&String(c.repository_owner_id)==='259182200'&&c.ref==='refs/heads/Projeto'&&c.event_name==='workflow_dispatch'&&c.workflow_ref===REPO+'/.github/workflows/opencode-projeto.yml@refs/heads/Projeto'&&c.runner_environment==='github-hosted'&&/^[0-9]{8,20}$/.test(String(c.run_id))&&Number.isInteger(c.exp)&&c.exp>now&&Number.isInteger(c.iat)&&c.iat>=now-600&&c.iat<=now+30&&(c.nbf===undefined||c.nbf<=now+30);
}
export async function verifySessionJwt(jwt,env,audience){
 try{
  if(jwt.length>16000)return false;const p=jwt.split('.');if(p.length!==3)return false;
  const parse=s=>JSON.parse(new TextDecoder().decode(decode(s))),h=parse(p[0]),c=parse(p[1]);
  if(h.alg!=='RS256'||!validSessionClaims(c,audience))return false;
  const opts={redirect:'manual',signal:AbortSignal.timeout(10000)};
  const keys=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',opts);if(!keys.ok)return false;
  const jwk=(await keys.json()).keys?.find(k=>k.kid===h.kid&&k.kty==='RSA');if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(p[2]),new TextEncoder().encode(p[0]+'.'+p[1])))return false;
  const r=await fetch('https://api.github.com/repos/'+REPO+'/actions/runs/'+c.run_id,{...opts,headers:{Authorization:'Bearer '+env.BUSHIN_GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'Bushin-Session'}});
  if(!r.ok)return false;const run=await r.json();
  if(run.status!=='in_progress'||run.head_branch!=='Projeto'||run.display_title!=='Bushin command session'||run.path!=='.github/workflows/opencode-projeto.yml')return false;
  return {run_id:String(c.run_id)};
 }catch{return false}
}
