---
name: bushin-naruto-cloudflare
description: Planejamento do Naruto Project migrado do OpenCode para Cloudflare D1, com transporte pessoal pelo Secret do Worker.
---

# Naruto Project RPG — OpenCode → Bushin Cloudflare

Projeto origem: `hp0592553-cyber/naruto-rpg-ia` branch `Projeto`, `scripts/naruto_guarded_mcp.py`. Backend: Worker original `bushin-discord-direct`, D1 e identidade OAuth original, sem criar outro aplicativo. Guild `1515877468299595919`; canal documentado e testado `1520114348079583263`.

Ferramentas registradas no MCP Worker: `bushin_naruto_status_rpg`, `bushin_naruto_commands_catalog` (catálogo histórico, `/missoes minhas` não testado como comando ao vivo), `bushin_naruto_save_progress({snapshot,confirmed})`, `bushin_naruto_load_progress`, e `bushin_naruto_plan_next({objective,context?})` para `missions`, `recovery`, `combat`, `level20`, `travel`, `bijuu` (planejamento, não jogadas reais). Elas podem ainda não estar no catálogo de ferramentas do ChatGPT.

**Preferência explícita do proprietário**: para leitura pessoal no Naruto, usar a Key guardada no Secret Cloudflare `DISCORD_USER_TOKEN` e nunca confundir OAuth de identificação com sessão de Discord. A configuração da Key, correspondência com Henrique e leitura do canal foram TESTADAS em 2026-10-24. `bushin_discord_read_messages` já acessa a rota pessoal quando a Secret existe e retorna `mode:"personal_user_token"`. Consulte também a skill `bushin-personal-discord-bridge`. Nenhum valor de token pode aparecer em saídas, arquivos ou logs.

Não inventar XP, batalhas, vida, recompensas ou comandos. Não cancelar combate ativo e não afirmar envio de mensagem sem confirmação verificável. O envio automático como usuário e o motor de batalha ainda NÃO foram testados/ativados neste chat. Credenciais pessoais são sensíveis e não devem ser enviadas no chat; o uso de self-bot pode violar os termos do Discord.
