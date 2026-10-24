/* Naruto Project RPG adapter from OpenCode "Projeto" branch.
 * Source: hp0592553-cyber/naruto-rpg-ia/scripts/naruto_guarded_mcp.py
 * No personal Discord tokens, no direct Discord messages, no background loop.
 */
import {personalCall} from "./personal-discord.mjs";
const GUILD="1515877468299595919", CHANNEL="1520114348079583263", BOT="1515908078913192026";
const KEY="naruto_project_rpg_v1";
const SOURCE="hp0592553-cyber/naruto-rpg-ia:Projeto/scripts/naruto_guarded_mcp.py";
const readonly={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const empty={type:"object",properties:{},additionalProperties:false};
const snapshotProps={
  level:{type:"integer",minimum:1,maximum:999},
  hp:{type:"number",minimum:0,maximum:1000000},
  chakra:{type:"number",minimum:0,maximum:1000000},
  energy:{type:"number",minimum:0,maximum:1000000},
  battle:{type:"string",enum:["active","ended","unknown"]},
  location:{type:"string",maxLength:120},
  mission:{type:"string",maxLength:180},
  notes:{type:"string",maxLength:500}
};
export const NARUTO_TOOLS=[
  {name:"bushin_naruto_observe",title:"🍥 Observar evidências do Naruto Bot",
   description:"Lê até 12 respostas recentes no canal fixo, preserva componentes e correlação. Não executa ações nem infere nível.",
   inputSchema:empty,annotations:readonly},
  {name:"bushin_naruto_status_rpg",title:"🍥 Estado da integração Naruto RPG",
   description:"Confirma OAuth, Naruto Project e recursos migrados do OpenCode; não lê mensagens.",
   inputSchema:empty,annotations:readonly},
  {name:"bushin_naruto_commands_catalog",title:"🍥 Catálogo Naruto Project",
   description:"Distingue comando histórico do OpenCode e nomes observados em respostas recentes; não afirma registro atual.",
   inputSchema:empty,annotations:readonly},
  {name:"bushin_naruto_save_progress",title:"🍥 Registrar progresso do RPG",
   description:"Salva progresso manual informado pelo usuário no banco privado D1.",
   inputSchema:{type:"object",properties:{snapshot:{type:"object",properties:snapshotProps,additionalProperties:false},confirmed:{type:"boolean"}},required:["snapshot","confirmed"],additionalProperties:false},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
  {name:"bushin_naruto_load_progress",title:"🍥 Ler progresso do RPG",
   description:"Lê dados manuais gravados no D1; não afirma estado atual do jogo.",
   inputSchema:empty,annotations:readonly},
  {name:"bushin_naruto_plan_next",title:"🍥 Planejar próxima ação",
   description:"Planejamento seguro de missões, recuperação, viagem ou combate, sem executar ações.",
   inputSchema:{type:"object",properties:{
     objective:{type:"string",enum:["missions","recovery","combat","level20","travel","bijuu"]},
     context:{type:"string",maxLength:350}
   },required:["objective"],additionalProperties:false},annotations:readonly}
];
export const NARUTO_TOOL_NAMES=new Set(NARUTO_TOOLS.map(t=>t.name));
function owner(env,ctx){
  const id=String(ctx?.me?.id||"");
  if(!/^\d{15,22}$/.test(id)||id!==env.BUSHIN_OWNER_DISCORD_ID)throw Error("OAuth do dono Bushin necessário.");
  if(!env.DB?.prepare)throw Error("D1 não configurado.");
  return id;
}
async function saved(env,id){
  const r=await env.DB.prepare("SELECT value_json,updated_at FROM bushin_project_state WHERE owner_id=? AND key=?").bind(id,KEY).first();
  return r?{snapshot:JSON.parse(r.value_json),updated_at:r.updated_at}:null;
}
const plans={
 missions:["Descobrir o comando atual de missões e seus parâmetros nas regras e no catálogo real.","Verificar resposta correlacionada do Naruto Bot.","Anotar requisitos antes de escolher outra missão."],
 recovery:["Conferir vida, chakra e energia reais.","Verificar as regras oficiais de recuperação.","Não encerrar combate ativo para recuperar recursos."],
 combat:["Conferir combate, recursos e última ação adversária.","Verificar opções reais de ataque, defesa ou movimento.","Não encerrar a luta sem instrução explícita."],
 level20:["Conferir nível e XP informados no jogo.","Verificar pré-requisitos das missões.","Planejar progresso sem declarar níveis ganhos sem evidência."],
 travel:["Confirmar local e destino, e se viagem terminou.","Verificar comando e restrições reais de viagem.","Evitar nova viagem antes de concluir a atual."],
 bijuu:["Consultar regras oficiais sobre bijuu.","Conferir pré-requisitos no jogo.","Não inventar chances de encontro ou recompensas."]
};
export async function narutoCall(env,name,args={},ctx={}){
  if(!NARUTO_TOOL_NAMES.has(name))throw Error("Ferramenta Naruto desconhecida.");
  const id=owner(env,ctx);
  if(name==="bushin_naruto_observe")return personalCall(env,"bushin_naruto_personal_read",{channel_id:CHANNEL,limit:12},ctx);
  if(name==="bushin_naruto_status_rpg")return {
    state:"ready_for_planning",integration:"bushin_cloudflare_d1",oauth_verified:true,
    username:ctx.me.username,guild_id:GUILD,channel_id:CHANNEL,naruto_app_id:BOT,
    member_naruto_rp:ctx.me.membership?.member===true,
    features:["fixed_guild_scope","documented_mission_command","manual_progress_d1","action_planning"],
    discord_user_message_read:false,discord_user_message_send:false,background_runner:false,source:SOURCE
  };
  if(name==="bushin_naruto_commands_catalog"){
   const history=await personalCall(env,"bushin_naruto_personal_read",{channel_id:CHANNEL,limit:12},ctx);
   return {
    state:"completed",source:SOURCE,guild_id:GUILD,channel_id:CHANNEL,naruto_app_id:BOT,
    commands:[{name:"/missoes minhas",status:"documented_in_opencode",live_verified:false,
      purpose:"Consultar missões; aguardar uma resposta do Naruto Bot relacionada ao comando."}],
    observed_commands:history.rpg_observation?.observed_commands||[],
    history_state:history.state,registry_verified:false,
    note:"Catálogo histórico e evidências de respostas. A API não oferece ao OAuth atual um catálogo ou executor dos comandos de outro aplicativo."
   };
  }
  if(name==="bushin_naruto_save_progress"){
    if(args.confirmed!==true)throw Error("Confirme os dados antes de salvar.");
    const s=args.snapshot;
    if(!s||typeof s!=="object"||Array.isArray(s)||!Object.keys(s).length)throw Error("Informe ao menos um campo.");
    for(const [key,value] of Object.entries(s)){
      if(!Object.prototype.hasOwnProperty.call(snapshotProps,key))throw Error("Campo de progresso não permitido.");
      const rule=snapshotProps[key];
      if(rule.type==="integer"&&(!Number.isInteger(value)||value<rule.minimum||value>rule.maximum))throw Error("Nível inválido.");
      if(rule.type==="number"&&(!Number.isFinite(value)||value<rule.minimum||value>rule.maximum))throw Error("Valor numérico inválido.");
      if(rule.enum&&!rule.enum.includes(value))throw Error("Estado de combate inválido.");
      if(rule.type==="string"&&(typeof value!=="string"||value.length>rule.maxLength))throw Error("Texto inválido.");
    }
    const previous=await saved(env,id),snapshot={...(previous?.snapshot||{}),...s},updated_at=Date.now();
    await env.DB.prepare("INSERT INTO bushin_project_state (owner_id,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
      .bind(id,KEY,JSON.stringify(snapshot),updated_at).run();
    return {state:"completed",saved:true,source:"user_reported",updated_at,fields:Object.keys(s),
      note:"Salvo no D1; nenhuma ação enviada ao Discord."};
  }
  if(name==="bushin_naruto_load_progress"){
    const r=await saved(env,id);
    return r?{state:"completed",source:"user_reported",...r,
      warning:"Dados manuais, não verificados ao vivo no Discord."}:
      {state:"not_found",source:"manual",note:"Nenhum progresso salvo; não inventar valores."};
  }
  if(name==="bushin_naruto_plan_next"){
    if(!Object.prototype.hasOwnProperty.call(plans,args.objective))throw Error("Objetivo de RPG inválido.");
    if(args.context!==undefined&&(typeof args.context!=="string"||args.context.length>350))throw Error("Contexto inválido.");
    const r=await saved(env,id),steps=[...plans[args.objective]];
    if(r?.snapshot?.battle==="active"&&args.objective!=="combat")steps.unshift("Há registro manual de combate ativo; não cancelar ou encerrar sem autorização.");
    return {state:"planned",objective:args.objective,steps,known_progress:r?.snapshot||null,
      source:"manual_and_opencode",executed:false,sent:false,
      note:"Plano somente; confirmar comandos e mecânicas reais antes de agir."};
  }
}
