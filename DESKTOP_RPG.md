# Naruto RPG pela tela Linux do GitHub Actions

Branch: **Projeto**. Workflow unico de RPG: `.github/workflows/opencode-projeto.yml`.

O workflow agora abre XFCE, Chromium e noVNC. O OpenCode controla somente a interface do canal Naruto Project por um MCP Playwright restrito. **Este modo nao utiliza DISCORD_USER_TOKEN nem chamadas diretas a API do Discord.** Os scripts antigos permanecem no historico/projeto, mas nao sao iniciados pelo workflow de desktop.

## Configuracao

Em **Settings → Secrets and variables → Actions**, configure:

- `DESKTOP_PASSWORD`: senha aleatoria de pelo menos 16 caracteres para a tela. Use uma senha diferente da chave de criptografia.
- `CHATGPT_CACHE_KEY`: chave aleatoria de pelo menos 32 caracteres para persistencia criptografada. O projeto ja usa este secret para o ChatGPT. Agora o perfil Chromium tambem fica dentro do mesmo arquivo criptografado.

Nao coloque nenhuma dessas senhas no codigo, issues, logs ou chat. Nenhuma chave paga e necessaria para o tunel temporario. O uso do modelo segue os limites da sua assinatura ChatGPT.

## Como usar

1. Um push na Projeto inicia o Actions; tambem existe **Run workflow**.
2. Abra o resumo do job e clique em **Abrir desktop**. O link temporario tambem aparece no log de **Abrir desktop Linux protegido e publicar link**.
3. Usuario HTTP: **henrique**. Senha: o valor que voce salvou em `DESKTOP_PASSWORD`. Depois clique em **Abrir tela Linux**.
4. No Chromium da tela, entre pessoalmente no Discord, resolva eventuais verificacoes e abra o canal `1520114348079583263` do servidor `1515877468299595919`.
5. Se o cache do ChatGPT nao puder ser restaurado, autorize tambem o link/codigo do step **Conectar ChatGPT Plus**. Esse login e separado do Discord.
6. Volte a pagina inicial do desktop e clique em **Liberar teste unico /missoes minhas**. Nao digite no editor enquanto o agente estiver executando o teste.
7. O OpenCode le o canal, inspeciona o menu de slash commands e so pode tentar uma consulta `/missoes minhas` do Naruto Bot. Se nao encontrar uma opcao inequivoca ou a interface mudar, ele para.
8. Apos o teste, a tela continua aberta por 30 minutos (configuravel ate 60 no disparo manual). Para encerrar antes, clique em **Encerrar tela e salvar sessao** na pagina inicial. O Chromium fecha antes da criptografia para gravar corretamente seu perfil.

O job inteiro tem limite de 3 horas. Cada etapa tem limite de 31 minutos, exceto a observacao de tela, que pode durar ate 61. A validade de codigos e sessoes depende dos respectivos provedores. Nao ha solver CAPTCHA, autenticacao alternativa ou tentativa de contornar bloqueios.

## O que conta como evidencia

- `desktop.json`: Chromium/CDP local disponivel e acesso HTTP local/publico exige senha.
- `browser.json` e `naruto-audit.jsonl`: descoberta das ferramentas e leitura real da interface.
- `canal-lido.png`: somente o chat autenticado, nunca a tela de login.
- `resultado.json`: distingue tentativa, envio comprovado, resposta correlacionada e estado conferido.
- A resposta so e considerada correlacionada quando uma mensagem nova tem identidade visual/DOM do Naruto Bot e contexto de interacao com Henrique e `/missoes minhas`. Se faltarem esses elementos, o resultado permanece nao confirmado.
- Um Enter de envio e uma tentativa, nao prova de resposta. Texto comum `/missoes minhas` nao e usado como substituto de um slash command.
- O estado so e marcado conferido quando o texto real da resposta permite reconhecer a lista de missoes ou ausencia de missoes ativas. Nenhum XP, nivel ou recompensa e inferido.

Alem de proteger a tela com HTTPS e HTTP Basic, VNC, websockify e CDP ficam no loopback. O proxy nao permite navegar por arquivos do runner nem acessar o CDP remotamente. Todos os caminhos e WebSockets exigem autenticacao; os botoes de liberar/encerrar exigem a mesma origem.

Cookies, perfil Chromium e credenciais ChatGPT nao entram nos artefatos. Somente o arquivo cifrado e colocado no cache. As imagens/textos do chat entram no artefato `naruto-jogada-tentativa`; neste repositorio publico eles podem ser vistos por quem tem acesso aos artefatos. Sessoes podem expirar ou exigir novo login, e o cache pode ser removido pelo GitHub. Use `renew_login` para renovar o ChatGPT se necessario.

## Validacao e limites

Os testes locais usam dados sinteticos: verificam HTTP Basic, bloqueio de arquivos/CDP, origem dos botoes, encaminhamento WebSocket, correlacao de resposta e bloqueio de envio comum/repetido. Eles nao comprovam uma jogada no Discord. O desktop real e verificado no Actions; login e eventual comando precisam de evidencia dessa execucao.

A UI do Discord pode mudar. Seletores nao reconhecidos sao tratados como bloqueio, sem clicar/enviar por tentativa e erro. A primeira execucao deste novo modo ainda exige login manual e confirmacao visual do usuario.

Referencias: [Playwright CDP](https://playwright.dev/python/docs/api/class-browsertype#browser-type-connect-over-cdp), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [noVNC](https://novnc.com/info.html).
