# Continuidade do jogador — 26/10/2026

Branch: `Projeto`. Worker preservado: `bushin-discord-direct`.

## Evidência observada

- O D1 guardava um pedido pendente no jogador e outro ID no resultado atual do serviço. Esse desencontro explica o bloqueio de retomada. Na consulta posterior ao print, o jogador já estava parado e sem pedido pendente; o clique antigo continua sem resultado conhecido.
- A ponte visual MCP respondeu `connected:false`. Isso é separado do executor de comandos: uma sessão GitHub nova foi iniciada e o heartbeat real passou a `version:3`.
- O navegador sem sessão do painel foi redirecionado para `/mobile`. Não houve acesso ao chat autenticado nem teste de teclado nativo Android nesta sessão.
- O Worker recebeu a primeira atualização às 18:20 UTC, mantendo os 32 módulos e os nove bindings publicados, incluindo os Secrets por herança estrita. Nenhum valor de credencial foi extraído.

## Mudanças

- Parar tem solicitação independente de Jogar/tick e não espera um GET anterior. Um início atrasado não substitui a indicação de parada confirmada.
- O serviço v3 exige uma autorização única imediatamente antes do envio. Pedidos reservados ainda não autorizados podem ser cancelados. Ação já autorizada é tratada como em andamento; não há tentativa de desfazer um envio recebido pelo jogo.
- Resultados são preservados por ID, inclusive respostas atrasadas de pedidos que ficaram incertos. Uma desconexão não recoloca a ação na fila.
- Presença do executor é atualizada em tarefa independente enquanto uma resposta está pendente. Caixa de processo anterior não pode ser executada pelo processo novo.
- Retomada de pedido antigo sem resultado registra a incerteza, impede repetir a ação e atualiza o contexto por consulta de mapa disponível no catálogo.
- Cargos e canais permitidos são relidos após mudança de acesso. A interface recarrega canais quando a IA navega para um canal recém-liberado.
- Controles históricos não mandam mais abrir o Discord. Controles próprios são conferidos novamente antes do envio e ficam desativados se antigos.
- Nível alvo somente pode ser considerado alcançado a partir de campo explícito em resposta correlacionada ao Henrique. Imagens não são interpretadas por esse parser.
- A retomada real posterior mostrou outro bloqueio: viagem antiga exigia um canal chamado Floresta. A correção consulta o mapa no canal permitido retornado pelo jogo, sem repetir viagem nem supor destino; a chegada é marcada como revisada somente após resposta confirmada.

## Testes e limites

- Testes JavaScript incluem SQLite real para concorrência, parada e meta com dados sintéticos; testes Python cobrem presença e cancelamento sem conexão Discord.
- Verificação local: 156 testes JavaScript e dois testes Python. CI também confirmou a revisão anterior; o teste novo cobre a chegada antiga sem canal Floresta.
- A página real do painel foi renderizada em fixture isolada, com **todas** as APIs simuladas: 390×844 e 390×480, campo focado, botões de 44 px, sem overflow horizontal. Jogar, Parar durante início lento e clique inline foram exercitados. O clique inline enviou um único pedido com IDs sintéticos e desativou o botão.
- Altura reduzida simula o espaço ocupado pelo teclado; não comprova teclado Android real. A fixture está em `scripts/qa_mobile_fixture.mjs` e nunca se conecta ao Discord.
- Erros de extensão do navegador em URLs `file://` apareceram no coletor; não eram do JavaScript do painel.
- Não houve nova missão, ataque, viagem ou distribuição de pontos enviada ao jogo nesta sessão. O heartbeat v3 confirma conexão, não jogada concluída.
- Autonomia até nível 20, regras completas, leitura de atributos em imagens e recuperação de toda interação incerta **não estão comprovadas**. O ciclo ainda depende da página visível, limita ações por ativação e o executor GitHub continua temporário. Sem a página, a renovação da sessão não é garantida.
