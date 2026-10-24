---
name: bushin-personal-discord-bridge
description: Transporte Naruto Project por Secret pessoal na Cloudflare, com leitura Components V2 e envio somente confirmado.
---

# Bushin Naruto RPG — estado verificado e transporte

Usar o Worker original `bushin-discord-direct`, a conta OAuth Henrique ID `481485837801095178`, guild Naruto Project ID `1515877468299595919` e canal de comandos `1520114348079583263`. Não criar outro app. O token da conta pessoal está guardado exclusivamente na Secret `DISCORD_USER_TOKEN` do Worker; jamais solicitar, exibir, copiar, transmitir, registrar em D1/código/logs ou usar fora do escopo. Se o token tiver sido exposto, deve ser revogado e substituído. OAuth identifica o titular, mas não autoriza mensagens por si só.

## Capacidades testadas em 2026-10-24

- `bushin_session_status({})` verifica a identidade OAuth; `bushin_permissions_check({})` inclui verificação da identidade da Key e uma prova de leitura de canal, sem devolver o token.
- `bushin_discord_read_messages({channel_id,limit})` usa a sessão pessoal quando a Secret existe e limita a leitura aos canais da guild verificada. Resposta `mode:"personal_user_token"`, `messages` com `normalized_text`, `components`, `diagnostics`, `controls`, `interaction_metadata` e `rpg_observation` quando presentes. O Naruto Bot usa **Discord Components V2**, muitas vezes com `content:""` e `embeds:[]`: usar `normalized_text` para ler o texto real, sem inventar campos. Verificado ao vivo em 2026-10-24.
- O código Worker publicado roteia também `bushin_discord_send_message({channel_id,content,confirmed})` para o transporte pessoal **quando a Secret existe**; caso contrário, o caminho antigo de bot oficial continua separado. Sempre exigir aprovação EXPLÍCITA do texto e canal exatos antes de chamar com `confirmed:true`. O código limita o texto e valida dono/canal/autoria da resposta. `confirmed:false` não deve enviar. O envio anterior de “Oi” foi confirmado com ID `1563541599189733508` e autor `481485837801095178`. Isso não comprova um novo envio em outro turno. Não repetir um resultado incerto.
- O Worker também registra `bushin_naruto_personal_status`, `bushin_naruto_personal_read`, `bushin_naruto_personal_send`, além das ferramentas de planejamento; o ChatGPT pode continuar com catálogo antigo até reconectar/atualizar. A ferramenta que já aparece no catálogo para leitura é `bushin_discord_read_messages`.

## Limites e meta

O projeto busca evoluir o personagem até nível 20. Não inferir nível, XP, saúde, chakra, energia ou batalha usando perfis de outros jogadores. O observador do Worker registra evidências; só confirmar atributos explicitamente ligados ao usuário Henrique. `/missoes minhas` e outros comandos de aplicativo precisam de um cliente Discord autorizado: tentar `bushin_discord_execute_command` pode retornar `requires_discord_client` sem executar. Não forçar REST não suportado nem alegar comando executado. Não encerrar batalhas sem instrução.

O uso de token pessoal como self-bot é não oficial e pode levar à suspensão pelo Discord. Não contornar rate limits, desafios, CAPTCHA ou bloqueios. Se retornar `Discord temporarily unavailable`, evitar rajadas de novas chamadas e relatar a instabilidade. Não confundir ferramenta registrada com operação comprovadamente concluída.

## Paginação e prints

O backend aceita `before` em `bushin_discord_read_messages` e `bushin_naruto_personal_read`, devolvendo `pagination.next_before`. Esse parâmetro depende de catálogo atualizado no host. Siga o fluxo de histórico e prints em `../bushin-rpg-channel-read/SKILL.md`. Não tratar 12 mensagens recentes como histórico completo, nem prometer prints sem sessão visual real.

## Atualização 1.0.10 — 24/10/2026

A correção de confirmação de entrega está publicada no Worker existente: deployment `6bdfc408cbf54a268e645fa7bc210597`. Uma entrega com sent:true, ID e autor confirmados permanece confirmada mesmo se tracking_saved:false: só o registro D1 falhou. Não reenviar nesse caso. Testes sem publicação retornaram mode:personal_user_token, awaiting_confirmation e sent:false; leitura real voltou a funcionar. Os 23 testes Worker passaram; esses testes simulados não representam 23 ações reais no Discord.

A leitura visual foi confirmada por bushin_browser_action({action:"read_page_text"}) e consulta de resultado; a listagem de abas também funcionou. Se um alias simplificado falhar, isso não comprova que toda a ponte visual parou. Captura real da tela falhou por timeout; imagem de mensagens pela API funcionou. Não reiniciar a sessão para atualizar estas instruções. Não tratar conexão MCP como prova de jogo autônomo.
