# Diagnostico Naruto Project — 2026-10-23

Branch: `Projeto`. Workflow unico de RPG: `.github/workflows/opencode-projeto.yml`.

## Execucao 39961824818, commit 904fc3e3

Logs do job 120441450625: OpenCode 1.19.4; ausencia de auditoria aceita com `SystemExit(0)`.
Artefato 12505147174, `naruto-jogada-tentativa`: somente `relatorio-naruto.md`, contendo:

> Não consigo executar: as ferramentas MCP `naruto_*` não estão disponíveis nesta sessão (só tenho glob, grep, read, skill, task e todowrite). Nenhuma chamada foi feita, nenhuma resposta foi lida e nada foi inventado.

Nao ha evidencia de login, leitura, envio ou resposta. O artefato nao contem auditoria.
A ausencia de auditoria sozinha nao prova que o processo nunca iniciou: o codigo antigo so auditava chamadas de ferramentas. Os logs antigos nao preservaram o erro de inicializacao. Portanto a causa exata daquela inicializacao nao pode ser afirmada.

## Correcao

- Configuracao carregada explicitamente por `OPENCODE_CONFIG`, executavel e script com caminhos absolutos.
- OpenCode fixado em 1.19.4 para reproduzir a versao observada.
- Probe independente verifica protocolo stdio real: initialize, tools/list, tools/call.
- `opencode mcp list` deve causar `list_tools` na fase de descoberta. Um texto de resposta do modelo nao basta.
- Nome MCP: `status_rpg`; nome exposto ao modelo: `naruto_status_rpg`.
- Auditoria separa processo, descoberta e chamada pelo modelo. Erros stderr e eventos JSON sao preservados.
- Sem imports de self-bot, CAPTCHA ou fallback de token pessoal. Este workflow instala somente MCP e HTTPX.
- `DISCORD_USER_TOKEN` permanece intocado no GitHub, mas nao e mais disponibilizado ao processo.
- Diagnostico de bot oficial usa exclusivamente secret `DISCORD_BOT_TOKEN`, Authorization Bot e verifica identidade bot, servidor e canal exatos. Nao envia mensagens nem comandos.
- Ausencia de resposta comprovada nunca gera sucesso de jogada. O job termina bloqueado/vermelho enquanto nao houver integracao autorizada.

## Testes locais

Probe stdio passou; OpenCode carregou a configuracao explicita e mostrou `naruto connected`; auditoria confirmou tools/list pelo OpenCode.
A chamada ao modelo big-pickle local retornou HTTP 403 FreeTierError (restricao do provedor). Nao houve tentativa de contornar. O workflow permite verificar separadamente o comportamento no GitHub Actions.

## Impedimento e alternativa autorizada

Discord proibe automacao de contas pessoais. Token de bot nao assume identidade de Henrique e enviar texto `/missoes minhas` nao executa um slash command.
Necessario obter do responsavel pelo Naruto Bot uma API/ponte oficial que autorize consultar e agir pelo personagem Henrique, com identidade vinculada, limites, identificador de acao, resposta e estado verificaveis. A existencia dessa API nao foi comprovada. Alternativa disponivel sem essa API: Henrique executar o slash command manualmente no cliente Discord; um bot oficial instalado e autorizado pode observar respostas publicas, mas isso nao constitui jogo autonomo e nao permite ler respostas efemeras de Henrique.

Nenhuma jogada foi enviada. Nenhuma resposta do Naruto Bot ou estado do RPG foi confirmado.

Referencias oficiais:
- https://opencode.ai/docs/config/
- https://opencode.ai/docs/mcp-servers/
- https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots
- https://docs.discord.com/developers/interactions/overview

## Validacao no GitHub Actions

Execucao 39963215666: rejeitada antes de criar jobs por contexto runner usado em env de job; corrigido definindo caminhos por GITHUB_ENV em um step.

Execucao 39963303788 (f98c537), artefato 12505801160: configuracao carregada, probe stdio e descoberta MCP pelo OpenCode passaram. O artefato resultado.json confirma mcp_started=true e opencode_discovered_tools=true. Modelo big-pickle retornou HTTP 403 FreeTierError tambem no Actions; nenhuma chamada do modelo ao status. O secret DISCORD_BOT_TOKEN chegou vazio. Nenhuma autenticacao Discord foi tentada.

O workflow agora faz um probe oficial separado antes do modelo e inclui model_errors e discord_diagnostic no resultado, para preservar ambos os bloqueios. A chave de um provedor de IA e o token Discord sao credenciais distintas. O provedor precisa permitir o modelo neste ambiente; nao houve troca de identidade ou tentativa de contornar o 403.

## Instrucao posterior: conta pessoal autorizada pelo usuario

O usuario substituiu expressamente sua restricao anterior a self-bot e informou ter atualizado DISCORD_USER_TOKEN. O workflow passa a usar esse secret para o teste solicitado; as notas anteriores de bot oficial descrevem a revisao anterior, nao a configuracao atual. Isso nao altera as regras externas do Discord.

O MCP usa somente discord.py-self 2.1.0, sem importar o cliente amplo do repositorio, solver CAPTCHA, navegador ou ferramentas genericas. O processo inicia sem token, e o login e adiado ate a chamada de status. O transporte e a descoberta continuam testaveis independentemente da autenticacao. Sem reconexao automatica ou fallback de autenticacao.

Escopo atual: servidor 1515877468299595919, canal 1520114348079583263, aplicativo 1515908078913192026 e uma tentativa de /missoes minhas. Uma reserva exclusiva em arquivo impede repetir a tentativa entre processos da mesma execucao, inclusive apos timeout. Uma resposta so e marcada concluida se autor, canal, tempo e ID da interacao corresponderem; o conteudo e capturado integralmente com embeds, sem inferir XP ou nivel. O estado do RPG permanece nao verificado ate conferencia desse conteudo.

A credencial OPENCODE_API_KEY, quando configurada no GitHub, e disponibilizada somente ao step do modelo, separada de DISCORD_USER_TOKEN. Nenhuma credencial e escrita na configuracao ou nos commits. Erros sao registrados por tipo e status HTTP sem texto bruto de autenticacao.

Testes locais: initialize/tools-list/tools-call sem token passaram; teste simulado confirmou bloqueio de segunda tentativa apos timeout e reserva persistente entre estados, sem acesso ao Discord. Teste real com token ocorre somente no Actions.

### Resultado real com DISCORD_USER_TOKEN atualizado

Execucao 39965190881, commit c760c8b: MCP iniciou, OpenCode descobriu suas ferramentas, conta conectada ao Discord com apelido Henrique, servidor e canal corretos acessados. O probe independente leu 12 mensagens reais e confirmou mission_command_available=true para /missoes minhas do aplicativo 1515908078913192026 (comando raiz 1515911478203519009). Isso comprova login/leitura/descoberta pelo MCP, nao uma chamada pelo modelo nem estado do personagem no RPG.

O OpenCode recebeu HTTP 403 FreeTierError do provedor antes de chamar ferramentas. command_attempted=false, command_sent=false, command_completed=false. Nenhuma tentativa de jogada foi realizada. Evidencias no artefato naruto-jogada-tentativa da execucao indicada.

Configuracao de IA: secret OPENCODE_API_KEY para OpenCode, ou OPENAI_API_KEY para OpenAI, sem misturar com DISCORD_USER_TOKEN. A variavel de repositorio RPG_MODEL seleciona explicitamente o modelo, mantendo opencode/big-pickle como padrao. Para OpenAI, usar o identificador de modelo OpenAI disponivel na conta no formato openai/<modelo>. Nenhuma chave ou modelo pago foi criado ou selecionado automaticamente. A disponibilidade e autorizacao do modelo precisam ser confirmadas numa execucao real.

Captura de resposta inclui componentes alem de texto/embeds e aceita eventos de edicao; respostas com loading=true nao sao concluidas. Teste simulado validou correlacao por ID, descarte de interacao alheia e resposta em carregamento, captura da edicao e bloqueio de repeticao. Esse teste nao e evidencia de resposta real do Naruto Bot.
