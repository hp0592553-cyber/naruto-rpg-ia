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
