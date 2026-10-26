# Bushin: execução autorizada e verificação — 26/10/2026

## Resultado da investigação

PRs #7–#13 preservadas na consolidação: provedores, ponte CLI, chat privado, leitura em lotes, Llama sem Codespaces, Modo Jogo e layout Android. A correção já integrada em #14 para impedir evidência de outro jogador também foi preservada e deve acompanhar a publicação.

O agente fica blocked porque integration() retorna ready:false. Não há adaptador de jogo nem credencial de acesso ao Naruto Project configurados. OAuth conectado fornece identify, guilds e guilds.members.read; não concede execução de slash de outro aplicativo. Não trocar ready para true por existir uma chave de IA.

## O que o operador do Naruto Project precisa fornecer

1. Autorização explícita de agente para o personagem Henrique e operações permitidas.
2. Documentação de um endpoint/API do próprio jogo (ou integração implementada pelo operador), identidade estável do personagem e credencial com escopo restrito.
3. Consulta de ficha, inventário, missão, localização, turnos, ações válidas e revisão do estado.
4. Execução com chave de idempotência e revisão/turno esperado; consulta posterior da ação pelo mesmo ID após timeout. Resultado incerto nunca é reenviado.
5. Retorno autenticado contendo action_id, estado accepted/rejected/pending/completed, motivo, cooldown/retry_after e estado posterior verificável. Metadados para correlacionar respostas privadas e componentes sem depender do histórico público.
6. Regras de batalha, custos de recursos, viagens, recuperação, limites e tratamento de HTTP 429.

Este arquivo descreve requisitos, não uma API já existente. Não há endpoint nem credencial inventados. Um bot próprio e seu token não concedem controle do Naruto Bot.

## Arquitetura quando houver essa integração

HTML envia intenção ao Worker; D1 armazena observação, plano e ID da ação. Execução persistente deve usar coordenação por personagem (por exemplo Durable Object/Workflows), com lock e consulta de resultado antes de continuar. Cada etapa: observar, interpretar, decidir, validar, executar uma vez, confirmar, gravar e continuar. Estado incerto para a sessão. Vida, XP e nível só mudam com evidência do personagem. Pausar/Parar impedem próximas ações; não desfazem uma ação já aceita pelo jogo.

Não foi ativado serviço pago ou executor persistente nesta sessão. Antes de provisionar, levantar plano atual, frequência, tokens e duração e apresentar estimativa. Llama usa o binding existente e pode consumir a franquia/cobrança atual. OpenAI API exige chave própria e faturamento separado; Codex CLI com login ChatGPT exige runner Linux ativo. Credenciais ChatGPT não devem sair do runner.

## Evidências reais desta sessão

- Cloudflare: Worker e bindings existentes consultados.
- D1: SELECT de contagem respondeu, 48 registros; nenhum estado de personagem alterado pelo teste.
- Workers AI: Llama 3.1 respondeu BUSHIN_OK.
- OAuth: conta conectada, sem discord_messages_as_user, sem bot oficial e sem background_agent.
- Navegador: /mobile/discord2 redirecionou para /mobile; esta sessão não tem login web. Não foi extraída nem transferida credencial do plugin.
- Inspeção do run 40321155716, já existente (26/10 09:15 BRT): response_relayed:true. Isso comprova entrega registrada naquele run legado, não autorização oficial nem progresso. Nenhuma ação Discord foi disparada nesta sessão.

## Correção nova

Modo Jogo não associa mais uma resposta apenas pelo nome do comando e horário: exige request_id exato e response_captured:true. Uma sugestão não executada não tem request_id. Eventos sem ID permanecem histórico, nunca confirmação da sugestão. Resposta capturada e alteração do personagem são coisas diferentes.

## Ainda falta

Integração do operador; execução do teste de perfil por essa integração; missão e combate completos; OCR de campos apenas em imagem; serviço persistente ativo; ganho de XP e nível 20 demonstrados. O ciclo jogador autônomo NÃO está concluído.

O executor legado agora sai com código 2 quando captura mas não entrega a resposta. Isso não reenvia a ação e não prova progresso. Testado sem conectar ao Discord.
