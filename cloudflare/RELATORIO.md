# Bushin — resultado em 24/10/2026

Implementado no Worker existente bushin-discord-direct, preservando os dez módulos anteriores e todos os bindings e Secrets.

## Corrigido e comprovado

- O adaptador descartava componentes e quase todos os campos de embeds. O novo normalizador preserva Components V2, campos de embeds, anexos, controles, referências e metadados de interação, com limites de tamanho e profundidade. Não baixa anexos nem inventa OCR.
- Teste real inicial: três mensagens antes vazias passaram a mostrar texto. Flags 32768 e componentes confirmaram Components V2 como causa.
- Teste ampliado: 12 mensagens lidas, 11 respostas do Naruto Bot legíveis. Todas as respostas observadas eram de outros jogadores. Nenhum atributo foi atribuído a Henrique.
- Descoberto o nome `perfil ver` nos metadados de respostas reais. Isso comprova uso histórico, não catálogo atual ou parâmetros completos.
- Catálogo MCP estabilizado independentemente da configuração do bot opcional; versão de protocolo negociada e diagnóstico disponível na ferramenta existente permissions_check.
- Diagnóstico ao vivo: backend anuncia 68 ferramentas; esta sessão do ChatGPT disponibiliza 55. A diferença está comprovada; cache ou sincronização do host é hipótese, não causa definitivamente demonstrada. O Worker não controla a atualização do catálogo do ChatGPT.
- Novo observador reúne evidências e correlação com o dono, sem inferir nível, recursos ou estado de combate. Não é um agente autônomo.

## Testes

`node --test cloudflare/tests/*.test.mjs`: 11 testes aprovados, incluindo Components V2, embeds, referências, controles, limites, identidade divergente, guild externa, 401/403/429 sem repetição e autenticação MCP. Todos os módulos passaram pela verificação sintática Node.

Ao vivo: OAuth Henrique confirmado; Secret presente e identidade correspondente; canal e leitura confirmados; D1 acessível; publicação do Worker retornou HTTP 200. Deployment inicial desta correção: afde315e357145dcbbb298f3f2aac77e.

## Pendências reais

- `/missoes minhas`: teste da ferramenta retornou requires_discord_client, executed:false e sent:false. O código implementa um diagnóstico, não um executor slash. Enviar esse texto como mensagem não executa a interação.
- Envio como Henrique continua sem validação de entrega. Nenhuma mensagem foi enviada nesta intervenção.
- Não há runner visual ativo: browser_status retornou connected:false. O adaptador GitHub legado aponta para educacaomggovbr00-web/shinobi-ai-agent/main e não possui BUSHIN_GITHUB_TOKEN configurado. O conector GitHub do chat é independente. Não alterei essa Secret nem redirecionei uma ponte legada sem alinhar seus consumidores.
- Não foram confirmados ficha de Henrique, regras atuais, missões, combate ou nível. Nível 20 não foi atingido nesta intervenção.

## Execução compatível

OAuth atual fornece identidade e participação, não execução de interações como usuário. Discord proíbe automação de contas pessoais fora da API autorizada. O transporte pessoal existente foi preservado, mas seu funcionamento não demonstra compatibilidade com essas regras.

A arquitetura compatível disponível é observar evidências fornecidas por uma fonte autorizada, propor ações e executá-las pelo titular no cliente oficial. Automação integral precisaria de uma interface autorizada do próprio jogo, fornecida pelos responsáveis, com associação de personagem e confirmação de resultados. Não existe essa interface configurada no projeto. Nenhum contorno de bloqueio, envio automático ou encerramento de combate foi acrescentado.

Referências: https://docs.discord.com/developers/components/reference ; https://docs.discord.com/developers/interactions/application-commands ; https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots ; https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## Atualização — 27/10/2026: IA do HTML e publicação validada

- No Discord 2, a análise da IA mostra se o modelo foi de fato acionado e quantas mensagens foram lidas.
- O modo automático agora consulta o modelo mesmo antes de haver ficha persistida, **somente** quando há evidência ligada ao dono (mensagem dele ou resposta correlacionada). Sem essa evidência, continua pedindo a ficha, sem usar status de outros jogadores.
- Testes com mocks cobrem invocação real do modelo, integridade da resposta e proibição de registrar execução não confirmada.
- CI aprovado na branch `Projeto`: https://github.com/hp0592553-cyber/naruto-rpg-ia/actions/runs/40559143264
- Esta publicação não comprova conexão online com Discord nem execução de comandos do RPG. A última sessão do executor falhou em `Discord connection unavailable; nothing sent`; exige diagnóstico separado, sem repetir envio e sem expor token.
- Deploy controlado pelo único YAML principal, preservando bindings e Secrets existentes.
