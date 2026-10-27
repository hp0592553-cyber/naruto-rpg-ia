/** Deterministic channel routing for Naruto Project. IDs and permissions come from the current filtered list, never from the model. */
export const COMMANDS_CHANNEL='1520114348079583263';
const CHANNEL_ID=/^\d{15,22}$/;
export const channelText=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase();
export function channelKind(channel){
 const n=channelText(channel?.name);
 if(/\bcomandos?\b/.test(n))return 'commands';
 if(/\b(regras?|guias?|sistemas?|tutorial|avisos?|anuncios?|leaks?|update|logs?|suporte|fichas resultado|jornal|parcerias?|formulario|loja paga)\b/.test(n))return 'reference';
 if(/\b(chat geral|chamar rp|duvidas|midias|perolas|sorteios|boosts|bump)\b/.test(n))return 'social';
 if(/\b(campo|floresta|rio|caminho|portao|praca|academia|hospital|konoha|beco|ichiraku|mansao|arena|deserto|rota|vila|treino|casa|luta)\b/.test(n))return 'scene';
 return 'unknown';
}
export function readableChannels(channels){
 const ids=new Set();
 return (Array.isArray(channels)?channels:[]).filter(c=>{
  const id=String(c?.id||'');
  if(!CHANNEL_ID.test(id)||ids.has(id)||![0,5].includes(Number(c.type)))return false;
  ids.add(id);return true;
 }).map(c=>({id:String(c.id),name:String(c.name||'').slice(0,120),type:Number(c.type)}));
}
export function commandChannel(channels){
 const list=readableChannels(channels);
 return list.find(c=>c.id===COMMANDS_CHANNEL)||list.find(c=>channelKind(c)==='commands')||null;
}
function matchLocation(channels,location){
 const text=channelText(location),tokens=text.split(' ').filter(t=>t.length>=3&&!['konoha','local','campo','vila','area'].includes(t));
 if(text.length<4||tokens.length===0)return null;
 const scenes=channels.filter(c=>channelKind(c)==='scene');
 return scenes.find(c=>{const n=channelText(c.name);return n===text||n.includes(text)||tokens.every(t=>n.includes(t));})||null;
}
/** Game location beats panel selection only if the game explicitly provided a location and a matching accessible channel exists. */
export function choosePlayerChannel({channels=[],selectedId=null,previousId=null,location=null}={}){
 const available=readableChannels(channels),command=commandChannel(available);
 const match=matchLocation(available,location);
 const selected=available.find(c=>c.id===String(selectedId));
 const previous=available.find(c=>c.id===String(previousId));
 const preferred=c=>c&&channelKind(c)!=='reference'&&channelKind(c)!=='social'?c:null;
 const chosen=match||preferred(selected)||preferred(previous)||command;
 if(!chosen)return {channel_id:null,channel_name:null,command_channel_id:command?.id||null,source:'none',location_confirmed:false,reason:'Nenhum canal de jogo acessível foi confirmado.'};
 const source=match?'game_location':chosen===selected?'selected':chosen===previous?'previous':'commands';
 return {channel_id:chosen.id,channel_name:chosen.name,command_channel_id:command?.id||null,command_channel_name:command?.name||null,source,location_confirmed:!!match,
  reason:match?'Local do personagem confirmado na ficha e canal correspondente acessível.':source==='selected'?'Canal aberto no painel e listado como acessível; a localização no jogo ainda não foi confirmada.':source==='previous'?'Canal anterior ainda acessível; a localização no jogo não foi confirmada.':'Canal de comandos acessível. Ainda não há evidência suficiente para escolher um cenário.'};
}
/** Never put guide/admin channels into the model's candidate list. */
export function planningChannels(channels,current,location,limit=12){
 const available=readableChannels(channels).filter(c=>!['reference','social'].includes(channelKind(c)));
 const chosen=choosePlayerChannel({channels:available,selectedId:current,location});
 const preferred=[chosen.channel_id,chosen.command_channel_id,current];
 const rank=c=>preferred.includes(c.id)?preferred.indexOf(c.id):channelKind(c)==='scene'?4:6;
 return available.sort((a,b)=>rank(a)-rank(b)).slice(0,limit);
}
/** Commands for character stats and missions belong on the verified commands channel, not arbitrary chatrooms. */
export function expectedActionChannel(command,{channels=[],current=null,gate=null}={}){
 const list=readableChannels(channels),commands=commandChannel(list);
 if(command==='/navigate')return null;
 if(command==='/component')return current;
 if(command==='/viajar'&&gate&&list.some(c=>c.id===gate.id))return gate.id;
 if(command==='/interagir npc'||command==='/acao coletar'){
  const scene=list.find(c=>c.id===current);
  return scene&&channelKind(scene)==='scene'?scene.id:commands?.id||null;
 }
 return commands?.id||null;
}
