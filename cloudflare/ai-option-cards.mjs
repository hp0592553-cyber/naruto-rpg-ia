export const OPTION_CARD_JS=String.raw`
/** In-place, read-only AI explanations of real Discord message controls. */
const aiOptionsCache=new Map();
function appendAiOptionCard(parent,m){
 const id=String(m?.message_id||m?.id||"");
 const channel=String(m?.channel_id||S.current||"");
 if(!/^\d{15,22}$/.test(id)||!/^\d{15,22}$/.test(channel))return;
 const cacheKey=channel+":"+id;
 const card=document.createElement("div");card.className="bushinAiChoices";
 const button=document.createElement("button");button.type="button";button.className="gameAskAi";
 button.textContent="🤖 IA: analisar estas opções";
 const result=document.createElement("div");result.className="aiChoicesResult";result.setAttribute("role","status");
 const paint=data=>{
  result.replaceChildren();
  if(!data)return;
  const add=(label,value)=>{
   if(!value)return;
   const title=document.createElement("strong");title.textContent=label;
   const p=document.createElement("div");p.textContent=String(value);
   result.append(title,p);
  };
  add("🧠 Análise",data.analysis||data.error);
  add("🎯 Opção recomendada",data.option_verified?data.option:data.next_step||"Nenhuma opção validada");
  add("💡 Motivo",data.reason);
  if(data.steps?.length){
   const title=document.createElement("strong");title.textContent="📋 Próximos passos condicionais";
   const list=document.createElement("ol");
   for(const step of data.steps){const li=document.createElement("li");li.textContent=step;list.append(li);}
   result.append(title,list);
  }
  const note=document.createElement("small");note.className="aiChoicesCaution";
  note.textContent=data.model_invoked===true?"Llama analisou a caixa verificada. Nenhum botão foi clicado e nenhuma jogada foi enviada.":"Nenhuma jogada foi enviada nem atribuímos ficha de outra pessoa ao jogador.";
  result.append(note);
 };
 paint(aiOptionsCache.get(cacheKey));
 button.onclick=async()=>{
  if(button.disabled)return;
  if(String(m.author_id||m.author?.id||"")!=="1515908078913192026"){
   const data={analysis:"Esta caixa é de outra aplicação do Discord, não do Naruto Bot.",next_step:"Abra uma caixa do Naruto Bot para analisar.",model_invoked:false};
   aiOptionsCache.set(cacheKey,data);paint(data);return;
  }
  button.disabled=true;button.textContent="🧠 Llama analisando caixa real...";
  try{
   const data=await req("/ai/options",{method:"POST",body:JSON.stringify({channel_id:channel,message_id:id})});
   aiOptionsCache.set(cacheKey,data);if(aiOptionsCache.size>40)aiOptionsCache.delete(aiOptionsCache.keys().next().value);
   paint(data);
  }catch(e){paint({error:"Não consegui analisar esta caixa: "+e.message,model_invoked:false});}
  finally{button.disabled=false;button.textContent="🤖 IA: analisar estas opções";}
 };
 card.append(button,result);parent.append(card);
}
`;
