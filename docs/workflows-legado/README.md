# Workflows antigos do Bushin (arquivo, não executável)

Esta pasta preserva o conteúdo original dos antigos arquivos do GitHub Actions como `.txt`.
Na branch `Projeto`, o único workflow **ativo do Bushin** é `.github/workflows/bushin-cloudflare-ci.yml`.
Os workflows genéricos `release.yml` e `test.yml` foram preservados para `main`.

Funções preservadas no principal:
- `cloudflare-tests.yml`: `validate` (testes Node/Python e executor).
- `discord2-html.yml`: `validate` (exportação HTML/JS e artefatos).
- `discord2-login-check.yml`: modo `login`.
- `discord2-relay-check.yml`: modo `relay` e OIDC limitado ao principal.
- `opencode-projeto.yml`: modos `servico`, `comando`, `diagnostico` e `jogar`.
- `verify-collection-speed.yml`: `fast-collection.test.mjs` em `validate`.
- `verify-discord2-api500.yml`: `player-channel.test.mjs` em `validate`.
- `verify-pending-rp-reply.yml`: `player-pending-rp.test.mjs` e `history-ai-draft.test.mjs` em `validate`.
- `verify-player-channel.yml`: `player-channel.test.mjs` em `validate`.

**Publicação controlada:** modo `ci` + `publish=PUBLICAR` com `workflow_dispatch` só publica com validação verde. Secrets não são copiados. Nenhum teste simulado prova execução real do RPG no Discord.
