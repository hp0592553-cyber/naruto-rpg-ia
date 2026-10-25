# Bushin — estado de implementação

Atualizado em 25/10/2026. Branch canônica do RPG: `Projeto`.

## Corrigido e verificável em código

- Fontes do painel e da IA reunidas com o executor e as correções anteriores.
- Catálogo real, parâmetros tipados e seleção de pessoas por `@`.
- Recepção de respostas privadas e públicas por identidade OIDC do workflow, com validação do repositório, branch, workflow, pedido, execução e canal.
- Cliente de entrega identificado como `Bushin-Discord2-Relay/1.0`: a requisição anterior recebia HTTP 403; o diagnóstico com esse identificador passou com `stage: ready`.
- Conteúdo guardado criptografado no D1, separado do histórico público. Somente a sessão do dono pode consultá-lo.
- Projeção de texto, embeds, componentes, anexos, flags e identificação da interação; imagens e controles mantidos na resposta.
- A caixa recebida é confirmada antes de o painel apresentar a entrega como concluída. Conclusão do Actions sem caixa entregue não é sucesso completo.
- Diagnóstico da entrega sem executar comandos ou jogadas.
- Pausas 429, respeito ao tempo informado e ausência de repetição automática de comandos incertos.
- Estado persistido do agente com revisão para impedir sobrescrita concorrente e controles Iniciar/Pausar/Continuar/Parar.
- Planejamento pela IA existente, sem despacho automático pelo novo controlador.
- Histórico de controles e respostas confirmadas. Aceitação da ação pelo jogo permanece desconhecida até interpretação comprovada.
- Ficha baseada somente em campos explícitos de perfil/nível associados ao Henrique. Perfis de terceiros e recompensas propostas não atualizam atributos do dono.
- Painel de nível, XP, vida, chakra e missão; campos sem evidência aparecem como não confirmados.
- Testes de catálogo, parâmetros, envio, pausa, histórico, privacidade e estado atualizados para a implementação corrente.

## Verificação técnica realizada

- Diagnóstico real do GitHub ao Worker: identidade e criptografia aceitas; nenhuma ação enviada ao Discord.
- Testes automatizados executam exemplos sintéticos. Eles não representam missões concluídas ou XP ganho.
- Perfil pelo painel e menção `@Henrique` já foram confirmados em testes anteriores.

## Bloqueio externo para jogar oficialmente

O controlador está em modo de integração oficial e não inicia jogadas sem uma API autorizada pelo Naruto Project para agir pelo personagem. Não há esse acesso configurado. OAuth de identidade não fornece essa capacidade; instalar um bot próprio não o autoriza a comandar outro aplicativo pelo Henrique.

O executor pessoal existente continua identificado como legado/manual. O novo controlador não o aciona automaticamente. Sua presença não comprova integração oficial, autorização do jogo ou serviço autônomo persistente.

Para habilitar execução oficial são necessários documentação e acesso concedidos pelo responsável do Naruto Project, incluindo identidade do personagem, consulta de estado, operações permitidas, limites e confirmação dos resultados. Não há contrato de API de jogo implementado por suposição.

## Ainda não concluído

- Teste de resposta real privada de ponta a ponta com o novo envio, separado do diagnóstico técnico.
- Aceitar/concluir missão, viajar, interagir com NPC, atacar, defender, usar jutsu/item e recuperar recursos por integração oficial.
- Executar botões, menus e modais do Naruto Bot dentro do painel; atualmente sua apresentação não constitui clique executado.
- Extração comprovada de atributos que só existem numa imagem; não há OCR ou leitura visual automática desses atributos.
- Serviço de execução contínua em segundo plano, recuperação de uma jogada em andamento e várias decisões executadas consecutivamente.
- Integração autorizada com o portal para distribuição de pontos.
- Missão inteira, aumento real de XP/nível e evolução até nível 20 demonstrados.
- Listagem completa de membros para `@`: as sugestões usam pessoas presentes nas mensagens carregadas.
- Desempenho instantâneo: iniciar um job Actions por comando continua tendo espera.

Esses itens não devem ser marcados como concluídos por existir um botão, plano da IA ou workflow com conclusão `success`.
