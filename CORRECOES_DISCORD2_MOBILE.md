# Discord 2 mobile — correções e evidências (26/10/2026)

Base de trabalho: `/workspaces/bushin-projeto`, branch `trabalho-opencode`, baseada em `origin/Projeto` (`3dae541`).

## Correções

### Jogador e Worker

- Após a orientação final do proprietário (“meu self-bot, nada de bot oficial”), `/mobile/discord2/api/autoplay` preserva `playerRoute` e o executor pessoal existente. Não foi adicionado transporte por bot oficial.
- `configured:true` fixo foi substituído pela presença real da credencial pessoal. `credential_configured`, `identity_verified`, `executor_online` e `brain_ready` são informações distintas. Não se declara autorização oficial do jogo nem identidade confirmada apenas pela presença do segredo.
- O controlador alternativo de adaptador foi preservado em `/api/autoplay/authorized`, com a chave D1 isolada `discord2_authorized_autoplay_v1`. O histórico pessoal em `discord2_autoplay_v1` não é apagado nem migrado. Não é necessário configurar esse adaptador para continuar usando o executor pessoal.
- Pausar é distinguido de Parar. Conferir consulta a ação pendente pelo mesmo ID mesmo depois de uma parada; uma resposta tardia pode ser registrada sem iniciar nova ação.
- As etapas e resultados do jogador pessoal são gravados com correlação de pedido, comando, canal, bot e conta. Resposta recebida, estado interpretado e aumento de XP/nível são indicadores separados. Valores apenas em imagens não são inventados.
- Controles pessoais usam também `game_response` quando o último trabalho é um plano. As respostas do adaptador opcional mantêm sua identificação separada e não fazem fallback de transporte.

### Contexto da IA

- `/ai/next` inclui a conversa limitada do canal selecionado, com autores e indicação separada de evidência do personagem. Mensagens explicitamente pertencentes a outro canal são descartadas.
- Analisar uma conversa não exige ter ficha confirmada. O modelo continua sem poder tratar a ficha alheia como sendo do Henrique. A seleção automática de consulta ainda distingue a ausência de ficha.
- O contexto do chat privado preserva IDs de mensagem, autor e resposta, priorizando mensagens recentes dentro do orçamento de 2400 caracteres. O backend deixa de cortar esse contexto em 1100 caracteres.

### Painel mobile

- Trocar canal durante uma leitura lenta começa a leitura do canal novo; sucesso ou erro atrasado do canal antigo não substitui o conteúdo atual nem libera o lock da leitura nova.
- O mesmo isolamento foi aplicado à paginação e à leitura de fóruns.
- Envio captura o canal, as menções e a resposta antes de aguardar a rede. Uma confirmação atrasada não apaga outro rascunho nem o rascunho de outro canal.
- Implementado seletor de até três imagens PNG/JPEG/GIF/WebP, envio multipart e validação do conteúdo: até 5 MiB por arquivo e pedido limitado a 8 MiB. Arquivo disfarçado de imagem é rejeitado.
- Implementados recibos por `request_id` no D1, reserva atômica e nonce estável. Repetir a mesma solicitação não publica outra mensagem. O botão “Conferir entrega” faz apenas leitura; timeout após POST é resultado incerto, não falha definitiva nem sucesso.
- Texto com quebras de linha, menções com IDs e resposta à mensagem original são preservados. A entrega exige autor, canal e ID retornados pelo Discord.
- Comandos também preservam o canal original durante a conexão do executor e não apagam um novo rascunho.
- O acompanhamento de comandos guarda e consulta `request_id`, preserva-o após recarregar e rejeita resultados com outro ID/canal. Um pedido antigo sem ID não é apresentado como sucesso confirmado.
- Motivos exatos de integração ausente, etapas, resultados e histórico ficam acessíveis em “Estado, resultados e bloqueios”. Os controles Pausar, Continuar, Conferir e Atualizar foram preservados e ficaram acessíveis.
- Ajustados alvos de toque, área segura inferior, campo de texto e anúncio acessível de status.
- As correções do painel serializado estão em `cloudflare/mobile-panel-fixes.mjs`, com verificação de correspondência dos trechos; uma mudança incompatível no painel falha explicitamente em vez de omitir a correção silenciosamente.

## Verificações reproduzíveis

```bash
node --test cloudflare/tests/*.test.mjs
.venv/bin/python -m pytest -q
BUSHIN_QA_BROWSER=/usr/bin/google-chrome node scripts/qa_mobile_regression.mjs
git diff --check
```

Resultado local: **173 testes JavaScript e 202 testes Python passaram**, nenhum falhou; o roteiro Playwright passou sem erro JavaScript nem requisição externa. Em 390×844, largura do documento de 390 px e botão Enviar de 62 px; em 390×480, campo terminando em 452 px, dentro da viewport. Screenshot: `/tmp/opencode/discord2-mobile-corrections.png` (fixture sintética, não produção).

O teste de navegador usa o HTML e JavaScript reais do painel, mas **todas as APIs são sintéticas e toda a rede externa é bloqueada**. Exercita troca de canal com resposta atrasada, envio no canal original, preservação de rascunho, entrega não confirmada, consulta de recibo, imagem sem texto em FormData e bloqueio exato informado pela API. Verifica 390×844 e 390×480, alvos de toque e overflow.

Os testes do Worker incluem a rota opcional do adaptador com sessão móvel sintética e SQLite real; sem adaptador, ela não faz chamadas externas. Outros testes cobrem o transporte pessoal com rede simulada, concorrência de recibos, parada, resposta tardia e correlação. Isso não comprova envio real de anexo nem ganho de nível.

## Consulta e painel reais — Worker já publicado, antes deste PR

- Consulta única `/perfil ver` pelo executor pessoal existente, sem bot oficial novo.
- HTTP 200, `state:finished`, `executed:true`, `confirmed:true`, `transport:persistent_service`.
- Pedido: `1a535579-2985-4f87-b8ef-be0d04694da7`.
- Resposta: `1564401895601348709`; canal `1520114348079583263`; autor Naruto Bot `1515908078913192026`; usuário da interação `481485837801095178`.
- Horário da resposta: `2026-10-26T22:14:37.093000+00:00`.
- Conteúdo: “Perfil de Henrique Uchiha”; idade 13, gênero Masculino, Ryō 3365. Não foi inferido XP nem ganho de nível.
- No painel publicado, viewport 390 px, canal Comandos² selecionado, 12 mensagens reais renderizadas, largura do documento 390 px. Screenshot: `/tmp/opencode/discord2-published-mobile.png`.
- O painel publicado ainda tinha zero seletores de arquivo; portanto o upload novo não estava publicado nem foi validado em produção nessa consulta.

## Bloqueios e pendências

- Sem `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` ou login Wrangler neste ambiente. A API de secrets do GitHub respondeu 403. Não foram extraídas credenciais do navegador nem alterados bindings/secrets para contornar essa ausência de acesso.
- O jogador publicado estava `blocked`, com razão histórica `OpenCode não retornou um plano: opencode_timeout`. A consulta real de perfil funcionou, mas não comprova que a decisão autônoma do modelo funciona. O timeout, isoladamente, não comprova falta de chave.
- Anexos e recibos novos precisam de publicação e verificação real de entrega. A versão antiga do Worker não contém essas rotas.
- O adaptador opcional ainda exige `BUSHIN_GAME` e `BUSHIN_GAME_APPROVAL`; a configuração de referência não tem esse binding. Ele não substitui a conexão pessoal escolhida pelo proprietário.
- Llama/API/Codex dependem de seus provedores. Os testes usam respostas sintéticas; não comprovam disponibilidade nem configuração das credenciais em produção.
- Altura reduzida verifica layout, não teclado Android nativo. Progresso de personagem e autonomia até nível 20 não foram declarados como testados.

Nenhum serviço pago foi ativado. Plugin-X e configurações de credenciais foram preservados. As modificações preexistentes em `DESKTOP_RPG.md`, `scripts/naruto_browser_mcp.py` e `tests/test_naruto_browser_live.py` não fazem parte do commit desta correção. O status de commit/PR/merge será informado na entrega; sem credencial Cloudflare, merge não significa deploy.
