# Bushin: componentes antigos, novos e resultados — 24/10/2026

Este inventário descreve a branch Projeto e os testes desta conversa. Não afirma que toda ferramenta anunciada funciona em produção.

| Parte | Origem / função | Estado verificado |
|---|---|---|
| discord_py_self_mcp/ | Base Python antiga: mensagens, canais, interações, permissões, membros, cargos, DMs, threads, relações, pastas, reações e presença | Testes simulados; não equivale a validação de todas essas operações na conta |
| index.js, setup-wizard.js, scripts/dcli.py, daemon.py | Wrapper npm, configuração e execução CLI antigos | Sintaxe e testes; pacote Python construído e npm pack simulado |
| scripts/naruto_guarded_mcp.py | MCP direto do Naruto: status, leitura, descoberta e consulta de missões | initialize/list/call passaram sem token local; não houve jogada |
| scripts/naruto_opencode_config.py | Seleção do backend para OpenCode | Backend direto carregado; OpenCode 1.19.4 mostrou naruto connected |
| .github/workflows/opencode-projeto.yml | Fluxo principal restaurado ao OpenCode direto | Início manual; diagnóstico padrão; execução completa no Actions não validada |
| RECONEXAO_RPG.md, HISTORICO_*, SISTEMAS_*, FICHA_RETSUDEN.md | Documentação e memória antigas | Não são prova do estado atual de Henrique |
| cloudflare/worker.mjs | Worker existente: OAuth, MCP e portal móvel | Identidade e participação confirmadas; catálogo anuncia 68 ferramentas |
| cloudflare/personal-discord.mjs | Transporte pessoal existente, usado no Oi | Entrega anterior: 1563541599189733508, autor 481485837801095178; teste atual sem publicação chegou a awaiting_confirmation |
| cloudflare/message-normalizer.mjs | Correção nova de Components V2, embeds, anexos e metadados | 12 mensagens lidas; 10 textuais e 2 com imagens; anexos não passam por OCR |
| Paginação before | Adição recente ao histórico | Teste local passou; catálogo desta sessão rejeitou o parâmetro; não foi lido todo o histórico |
| cloudflare/naruto-observer.mjs | Observador novo de evidências | Não atribui perfis alheios a Henrique nem inventa nível/combate |
| cloudflare/naruto-rpg.mjs | Planejamento, estado e catálogo do Naruto | Não é agente autônomo validado |
| cloudflare/message-image.mjs, BUSHIN_RENDERER | Nova imagem de mensagens reais pela API | Funcionou; não é captura da interface Discord |
| cloudflare/browser-bridge.mjs, visual-bridge.mjs | Pontes visuais GitHub/D1/OIDC | Leitura real e listagem de abas funcionaram; screenshot falhou por timeout |
| scripts/naruto_browser_mcp.py, naruto_desktop.py, naruto_desktop_proxy.py | Desktop Linux e backend de navegador acrescentados | Preservados; não são dependência do workflow direto restaurado |
| cloudflare/repo-suite.mjs | Ponte GitHub legada | Ainda aponta a educacaomggovbr00-web/shinobi-ai-agent/main; usada pela sessão visual; não redirecionada para não quebrá-la |
| cloudflare/state-suite.mjs e D1 | Estado, tarefas, eventos e auditoria | D1 respondeu a SELECT; ferramenta load_state retornou erro; tarefas não executam agente em segundo plano |
| cloudflare/advanced-suite.mjs, discord-suite.mjs, bot-permissions.mjs | Catálogo, adaptadores e bot opcional | Ter nome no catálogo não comprova execução; bot não substitui Henrique |
| plugin-bushin/ e skills do plugin | Instruções do plugin | Catálogo do host pode diferir do Worker; não houve nova publicação do plugin nesta etapa |

## Correção desta etapa

Após o Discord confirmar ID e autor, uma falha ao registrar o envio no D1 não deve apagar a evidência de entrega. O retorno mantém sent:true e os identificadores, informa tracking_saved:false e orienta não repetir. O transporte, as credenciais e o conteúdo enviado não foram trocados. Esta alteração foi testada com rede e banco simulados; foi publicada no Worker existente (deployment 6bdfc408cbf54a268e645fa7bc210597), preservando os outros 12 módulos e bindings. Após a publicação, leitura e rota de envio sem publicação foram novamente consultadas.

## Testes

- 23 testes Worker passaram após a correção, incluindo confirmação falsa sem POST, entrega simulada e falha simulada do D1 após entrega.
- Na etapa anterior: 183 testes Python passaram e 1 foi pulado por falta do Chromium exigido; esperas globais do limitador desativadas só na suíte simulada, mantendo testes específicos dele.
- OpenCode descobriu as quatro ferramentas; probe stdio real passou. Nenhum token pessoal foi transferido ao ambiente local.
- Nenhum novo Oi foi publicado. Nenhum combate foi iniciado ou encerrado; nenhuma sessão foi reiniciada.

## Pendências

Investigar erros intermitentes OAuth nas ferramentas simplificadas, timeout de screenshot e sincronização do catálogo; validar slash commands e lógica de jogo ponta a ponta. Leitura, conexão MCP ou um envio de texto não comprovam jogo autônomo nem nível 20.
