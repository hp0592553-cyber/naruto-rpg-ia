# Bushin: execução real e bloqueios — 25/10/2026

## Escopo e evidências

Repositório existente: hp0592553-cyber/naruto-rpg-ia, branch Projeto, base d3a4dba.
Foram inventariados os 132 arquivos versionados, examinados os fluxos de entrada e execução,
as duas bibliotecas de transporte, os workflows, os testes e a configuração Cloudflare.
O Worker publicado foi lido pela API Cloudflare. Foram preservados os 17 módulos de
aplicação publicados antes das correções; dois módulos auxiliares de checagem de sintaxe
também existem no upload remoto e não fazem parte do grafo de imports.
Não foram extraídos valores de Secrets.

Quatro arquivos publicados não existiam na branch: discord2-ui.mjs, discord2-ai.mjs,
discord2-autorp.mjs e discord2-research.mjs. Outros módulos também divergiam.
Esta branch de correção recupera o código publicado para que uma futura publicação
do repositório não elimine o painel e a IA. O wrangler.jsonc também não descreve
todos os bindings publicados; preservar os bindings existentes em qualquer deploy.

## Caminhos existentes

| Entrada | O que executa | Limite confirmado no código |
|---|---|---|
| Painel → IA jogar | POST /ai/opencode → workflow_dispatch, Projeto, mode jogar | Uma consulta /missoes minhas; não é sessão autônoma |
| Pensar próxima jogada | /ai/next → Workers AI | JSON de análise e texto sugerido; não chama executor |
| Caixas Naruto | Renderiza componentes e links Discord | Não envia botões ou menus |
| Catálogo | Consulta índice e comandos de aplicativo | Retorna executor_status not_connected; não invoca comando |
| /ai/profile-probe | Tentativa experimental /perfil ver via API pessoal | session_id gerado localmente; aceitação HTTP não prova resposta |
| /ai/autorp | Lê novidades e gera/enviaria RP textual | Ignora bots, combate e canal de comandos; tick depende da página |
| /ai/scan | Até 3 canais, 8 mensagens por canal | Resumos limitados, sem paginação e sem aprendizado completo |
| Busca minhas mensagens | Até 4 canais, 12 mensagens por canal | Não é busca de todo o histórico |
| bushin_tasks e project_state | Registro D1 de planos, estado e eventos | Não há consumidor autônomo das tarefas |
| naruto-observer | Preserva evidências e correlações | Estatísticas permanecem desconhecidas |
| MCP Python direto | Status, leitura, catálogo e uma consulta | Não oferece ações de viagem, ataque, menu ou recuperação neste adaptador |
| Biblioteca Python original | Funções genéricas de mensagens/interações | Não está conectada ao ciclo da IA do Worker |
| MCP de navegador | Consulta única e correlacionada | Usa Chromium local; não é usado pelo workflow direto atual |

## Bloqueios para jogar até nível 20

1. Não existe ciclo persistente observar → decidir → executar → verificar → continuar.
2. O modelo não devolve uma ação estruturada validável com tipo, alvo e parâmetros.
   O contexto do modelo perde custom_id, IDs das opções e metadados de correlação.
3. Não há executor de jogo conectado ao modelo: botões, menus e slash não são mensagens.
4. O adaptador direto conserva rpg_state_verified=false mesmo após capturar uma resposta;
   o workflow exige true no final. Logo o critério de sucesso é inalcançável nesse caminho.
5. O painel consulta o status do workflow e devolve executed=false/confirmed=false:
   não lê automaticamente o resultado.json do artefato, nem o entrega à IA.
6. O estado de nível, XP, vida, recursos, localização e combate não tem parser
   validado com respostas reais correlacionadas a Henrique.
7. A coleta de regras é parcial: um mesmo resumo combinado de lote é atribuído
   a cada canal; não preserva proveniência por mensagem e cobertura histórica.
8. Pausar/cancelar um plano D1 não interrompe uma ação externa em andamento.
9. A ponte visual usa outro repositório legado; os workflows dessa ponte não
   estão neste repositório. Isso precisa ser inventariado no repositório real.
10. A autorização Discord do plugin respondeu "Discord authorization expired".
    Acesso administrativo Cloudflare/GitHub não equivale a sessão Discord válida.

## Correções realizadas

- Catálogo: outro aplicativo com /perfil ver não pode satisfazer uma busca do Naruto.
  Raízes ambíguas do próprio Naruto também não são escolhidas por ordem.
- MCP: recusa 401 do OAuth Discord é devolvida como HTTP 401 + WWW-Authenticate,
  permitindo ao cliente reconhecer a necessidade de reautorização. Não renova
  credencial revogada nem altera Secrets; 403/503 não são tratados como login expirado.
- Teste da fila visual: aceita o formato anunciado pelo schema efetivamente publicado.
  Continua exigindo queued, exatamente um INSERT e ausência de imagem concluída.
- Recuperação dos módulos publicados ausentes e atualização do código divergente.

## Testes e resultado real

- Branch original: 23/23 testes Worker passaram.
- Código publicado recuperado: 22/23 passaram; o teste antigo de ID visual estava
  desatualizado em relação ao produtor/consumidor e ao schema publicados.
- Após correções: 27/27 testes Worker passaram, com rede e D1 simulados.
- PANEL_JS analisado pelo parser JavaScript; fontes Python compiladas.
- Suíte Python não executada: pytest não está instalado neste ambiente.
- Actions run 40101209665: failure em "Conferir senha da tela remota sem exibir valores";
  os passos de instalação, login Discord e comando foram skipped.
- Não foi enviada mensagem, missão, ataque ou interação ao Discord nesta análise.
  Não há evidência de ganho de nível nem da primeira etapa ponta a ponta.

## Integração compatível

A leitura de código não prova autorização de automação pelo Discord ou pelo jogo.
O transporte pessoal é identificado como não oficial no próprio projeto.
Uma integração oficial de bot não passa a invocar automaticamente comandos de outro
aplicativo nem a controlar o personagem pessoal Henrique. A implementação de jogo
precisa de um executor aceito pelo Discord e pelo Naruto Project, com identidade,
escopo e retorno de ação verificáveis. Nenhuma API de jogo oficialmente autorizada
foi identificada nos arquivos inspecionados; isso não prova que ela não exista.
O site público é usado apenas como texto HTML, sem login e sem ficha pessoal.

Próximo critério verificável: executor autorizado disponível e sessão válida →
consulta real da ficha → resposta nova do Naruto Bot ligada a Henrique e à ação →
parser de estado validado. Até isso ocorrer, status de workflow, análise da IA,
HTTP aceito e testes simulados não contam como jogada concluída.

## Continuação após reconexão

OAuth voltou a connected e a leitura retornou 12 mensagens reais. As duas respostas
de nível do Naruto Bot nesse lote pertencem a terceiros; nenhuma ficha de Henrique
foi confirmada. O catálogo confirmou /perfil ver do Naruto Bot, mas a chamada
retornou executor_status=not_connected, executed=false e sent=false.

A IA agora recebe os identificadores dos controles, opções e valores de seleção,
metadados da interação e indicação de mídia sem texto extraído. O observador
informa quais mensagens estão correlacionadas ao dono. Não há execução automática
nessa mudança. Os 28 testes locais passaram, incluindo a passagem desses dados
pelo endpoint de IA; rede, modelo e D1 desse teste são simulados.

## Autorização de comandos no Discord 2

A página de consentimento deixou de afirmar um erro de aplicativo desconhecido
sem evidência. GET /mobile/discord2/api/command-auth verifica a sessão, o usuário
e o aplicativo via OAuth2 @me. O início do consentimento também valida essa
identidade antes de redirecionar. Instalação e executor Naruto permanecem
explicitamente não confirmados. Não há novo escopo que conceda execução dos
comandos de outro aplicativo. 32 testes locais passaram com provedores simulados.

## Sincronização do catálogo por canal

Consulta real retornou mode=personal_user_token, catalog_verified=true e
/perfil ver encontrado. Também foram encontrados os comandos reais mapa, combate,
missoes, jutsu, viajar e nivel com IDs e versões. Nenhuma interação foi enviada.

O painel passou a usar channel_id na consulta, validar acesso à guild antes de
consultar o registro, invalidar cache ao trocar de canal e descartar respostas
atrasadas. Falhas não são substituídas por exemplos de guias. Cache válido dura
até 60 segundos; o botão atualizar invalida o cache. Consultas simultâneas do
mesmo canal são agrupadas. O catálogo é do registro da guild, não uma garantia de
permissão para executar cada comando no canal. 35 testes locais passaram.

## Enviar /perfil ver pela rota experimental existente

Uma leitura real encontrou a resposta 1563891987076358225 do Naruto Bot, às
12:28:25 UTC, interaction.id=1563891980252086352, command=perfil ver e
user_id=481485837801095178. O texto identifica Henrique Uchiha, 13 anos, Masculino,
3365 Ryō. Não há evidência nesta leitura de qual cliente iniciou essa interação.

O botão Enviar passou a chamar a rota existente /ai/profile-probe somente para
/perfil ver sem parâmetros no canal 1520114348079583263. Outros slash commands
continuam sem executor no botão. O transporte é pessoal e não oficial, não um
novo privilégio OAuth. A interface exige submitted=true e não converte HTTP
aceito em execução/resposta confirmada. Não faz repetição após resultado incerto.
42 testes locais passaram, com rede e banco simulados. Nenhuma nova interação
foi enviada por esta alteração; o acionamento depende do clique do usuário.
