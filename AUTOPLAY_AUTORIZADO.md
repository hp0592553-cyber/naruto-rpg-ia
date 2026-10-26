# Controlador jogador — 26/10/2026

Implementado: observar → escolher uma ação permitida → registrar ID → enviar uma vez → consultar resultado exato → atualizar ficha → continuar. Controles em `/mobile/discord2/api/autoplay`, botão Jogar por mim e ordens naturais de jogar/pausar/continuar/parar no chat. O planejamento manual anterior permanece separado.

**O jogo real continua não conectado.** Este documento especifica um contrato novo para um adaptador do operador, não uma API descoberta do Naruto Project. Não foi instalado um adaptador fictício, não se transferiu sessão do PTB, não se usou token pessoal e não se comprovou XP ou nível 20 reais.

## Instalação pelo operador do jogo

1. Implementar um Worker adaptador autorizado pelo Naruto Project, com acesso real ao backend do jogo. Somente o operador pode fornecer esse acesso; autorização do usuário ao Bushin não substitui isso.
2. Vinculá-lo ao Worker Bushin como service binding `BUSHIN_GAME`. Definir `BUSHIN_GAME_APPROVAL` com a referência da autorização do operador. Não configurar uma URL arbitrária vinda do navegador e não reutilizar tokens Discord/ChatGPT.
3. O serviço recebe `x-bushin-owner-id` e implementa os endpoints abaixo. Deve conferir identidade, escopo, revisão, expiração e idempotência no próprio backend. Pode rejeitar qualquer ação.

Envelope JSON: `protocol: "bushin-game-v1"`, `owner_id` (Discord do Henrique) e `character_id` estável. Respostas limitadas a 96 KiB, sem redirecionamentos. O contrato é validado em `cloudflare/game-adapter.mjs`.

- `GET /v1/authorization`: envelope mais `game:"naruto-project"`, `authorized:true`, `approval_reference` igual à configuração, `grant_id`, `expires_at` em ms, `idempotency:true`, `result_lookup:true`, `channel_ids` e `allowed_kinds`. Tipos: query, channel, travel, mission, npc, combat, reply, recover, item.
- `GET /v1/observation`: envelope, `revision`, `observed_at` recente, `channel_id`, `stats` (level/xp numéricos, hp/chakra/energy como current/max), mission/location/rules/rules_revision, combat (active/own_turn/enemy_known/rules_known), inventory (id/quantity), últimas mensagens e `available_actions` materializadas pelo jogo.
- Cada ação disponível contém id, semantic_key estável, kind, label, owner_id, channel_id, state_revision, expires_at, safe:true, risk:"low", cost de chakra/energy explicitamente numérico para ações de jogo, item_costs e not_before quando aplicável. Respostas de texto exigem reply_to (ID da mensagem), reply_max_chars; o adaptador resolve o alvo pelo ID da ação, nunca pelo texto da IA.
- `POST /v1/actions`: o Bushin manda operation_id UUID único, available_action_id, expected_revision, identidade e grant_id; somente em reply envia reply_text. O adaptador grava idempotência ANTES de executar e retorna o envelope, operation_id e accepted:true. Isso confirma recebimento pela integração, não execução pelo jogo.
- `GET /v1/actions/{operation_id}`: envelope, operation_id, status pending/completed/rejected/unknown. completed exige action_id exato, game_confirmed:true, snapshot posterior validável e response opcional no formato da mensagem Discord. Snapshot histórico confirmado é memória, não autorização para agir: a próxima decisão sempre observa estado fresco.
- HTTP 429 usa Retry-After em segundos ou data HTTP. Um POST incerto nunca é repetido: só se consulta o ID anterior. 404/unknown não provam que a ação não ocorreu; o agente para. rejected precisa ser uma rejeição autoritativa do jogo.

## Persistência e limites

D1 usa `discord2_autoplay_v1` por dono na tabela existente, CAS de JSON, lease de 90s, uma ação pendente, histórico limitado e fingerprints de ações por revisão. Pausar/Parar têm prioridade mesmo se a versão da tela estiver antiga. Se o envio já começou, o resultado pode terminar depois; o ID é preservado. Continuar confirma esse ID antes de decidir qualquer outra ação. Não executa duas ações no mesmo tick.

O motor é Llama 3.1 do binding existente; não é ChatGPT/Codex CLI e não usa créditos da OpenAI API. Não chama modelo nem jogo quando o adaptador está ausente. Máximo inicial 25 ações confirmadas por ativação, com pausa no limite; cada continuação libera um lote adicional limitado. A meta de nível 20 só termina quando a integração fornece esse nível confirmado. Combate exige turno, inimigo, regras e recursos conhecidos; ações inseguras não entram na lista da IA.

## Página e segundo plano

A página solicita um tick a cada 5s enquanto visível, com uma solicitação por vez. O estado sobrevive ao fechamento, mas **não continua executando com a página fechada na configuração atual**.

O handler Scheduled está preparado e inerte. Para segundo plano, depois de acesso ao jogo e revisão de custos, configurar `BUSHIN_AUTOPLAY_CRON=enabled` e um Cron Trigger. Nenhum trigger/plano pago foi ativado nesta sessão. Um cron por minuto representa até 1.440 invocações/dia; confirmar + agir usam ticks separados, portanto não significa 1.440 ações. Antes de habilitar: verificar plano/franquias de Workers, D1, Workers AI e custos do adaptador, apresentar teto e obter autorização para gasto novo. Não é necessário Codespaces para Llama + adaptador + Cron.

## Verificação

Os testes de contrato usam serviço de jogo simulado e SQLite real para exercitar o SQL/CAS; não são jogadas Naruto reais. Cobrem concorrência, pausa durante decisão/envio, retomada, timeout, 429, dono incorreto, estado expirado, ação inventada, correlação do resultado, reply seguro, limite e parada no nível confirmado. O bloqueio real esperado no Worker atual é `game_integration_missing`.
