# Executor permanente do Discord 2

## Estado

Implementação preparada; não há servidor permanente provisionado nem serviço ativo.
Nenhuma credencial foi extraída ou transferida do Worker. O caminho atual continua
funcionando até a ativação explícita do novo transporte.

O Python mantém o cliente conectado entre comandos. Ele consulta a fila D1 a cada
segundo quando ocioso, reserva uma única ação, captura a resposta correlacionada
e entrega o resultado ao painel. O painel consulta o resultado a cada dois segundos.
Não inicia Actions por comando. Isso elimina a inicialização repetida, mas não é
latência zero: rede, polling, reconexão e tempo do Naruto Bot permanecem.

## Servidor necessário

Linux com Python 3.11+, saída HTTPS/WebSocket e serviço sempre ligado. Este pacote
não cria servidor, assinatura ou cobrança. Antes de contratar hospedagem, escolher
o host e seu custo. O ambiente temporário do ChatGPT não é hospedagem permanente.

Preparação no host escolhido, com código da branch Projeto em /opt/bushin:

```sh
cd /opt/bushin
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/naruto-panel-requirements.txt
```

Criar usuário de serviço `bushin`. Instalar `deploy/bushin-command.service` no
systemd. O serviço usa `/var/lib/bushin-command-service` para marcadores de execução
e uma resposta pendente, com diretório 0700 e arquivos 0600. Preservar esse diretório
em atualizações e reinícios; não iniciar múltiplas cópias com diretórios independentes.

## Configuração de Secrets

No gerenciador de Secrets do host, configurar `DISCORD_USER_TOKEN` com a credencial
da conta existente. Nunca inserir credenciais no repositório, HTML, logs ou chat.
Não buscar nem exportar o valor da Secret do Worker para o host automaticamente.

Gerar uma credencial aleatória exclusiva de pelo menos 32 bytes para
`BUSHIN_EXECUTOR_TOKEN`. Armazená-la no host e na Secret de mesmo nome do Worker.
Ela autoriza apenas a ponte de comandos; não reutilizar o token Discord como token
da ponte. O systemd lê `/etc/bushin/command-service.env`, protegido com permissão
0600 e propriedade root. Esse arquivo contém somente as duas variáveis citadas.

Publicar os módulos `command-service.mjs` e `worker.mjs` antes de ativar a Secret.
Esvaziar ou conferir qualquer execução Actions pendente antes da troca: uma ação
já enviada não é cancelada pela ativação do serviço.

Com a Secret `BUSHIN_EXECUTOR_TOKEN` configurada no Worker, o endpoint já usado
pelo HTML (`/mobile/discord2/api/ai/opencode`) passa a usar o serviço. Se estiver
offline, retorna erro sem disparar Actions como fallback. Remover essa Secret
restaura o transporte legado; conferir ações pendentes antes de alternar.

## Verificação e recuperação

1. Iniciar o serviço systemd e verificar somente a linha `Command service connected`.
2. Pelo painel, consultar `/perfil ver` uma vez; conferir autor, personagem e resposta.
3. Consultar `/missoes minhas`; verificar que respostas privadas também aparecem.
4. Medir o tempo de envio e de retorno. Este pacote não apresenta números de latência
   real antes de um teste em servidor ligado ao Discord.

Pedidos reservados pelo cliente não são devolvidos à fila após timeout ou reinício.
Quando o envio ao jogo fica incerto, conferir manualmente a ação antes de qualquer
nova tentativa. Uma resposta já capturada é mantida em `pending-result.json`; a
recuperação repete somente a entrega dessa resposta, nunca o comando de jogo.
Pausar um pedido ainda na fila impede a reserva; parar um pedido já reservado não
desfaz a ação recebida pelo jogo.

O cliente existente respeita as recusas/limites do Discord; esta implementação não
resolve CAPTCHA nem evita bloqueios. A automação com token pessoal continua sendo
um transporte não oficial; o serviço não torna o cliente uma integração oficial.
