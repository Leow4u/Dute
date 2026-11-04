# Aviso de produtos disponíveis em estoque

## Objetivo e decisão

Implementar o aviso aprovado na conversa: após um recebimento chegar às prateleiras,
o cliente recebe um aviso no sino; os contatos inscritos recebem e-mail pela fila
existente do Resend. Modelo `estoque_disponivel`, rótulo **Produtos disponíveis em
estoque**, módulo contratado `wms`, link `/portal/estoque`.

O disparo é por recebimento inteiramente guardado, incluindo reposição de um produto
existente. Não é por cadastro de SKU, caixa intermediária, entrada manual ou inventário
de abertura. O texto informa a quantidade recebida e guardada e convida a consultar o
saldo atual, que pode mudar depois da guarda.

## Estrutura

- Reutilizar `inventory.arrival_stored` da última caixa. Produzir o mesmo evento ao
  encerrar a guarda por linha, inclusive quando a entrada vai diretamente à prateleira.
- Evento, conclusão e marcador de deduplicação pertencem à mesma transação. Guardas
  concorrentes precisam disputar a chegada para produzir somente um evento final.
- Só eventos novos com `payload.notification_model = estoque_disponivel` entram
  no modelo: um cursor antigo não transforma o histórico de caixas em avisos retroativos.
- A Operação aceita apenas fontes WMS conhecidas e confere a chegada em
  `inbound_receipts`: cliente explícito e igual ao evento, recebida e guarda concluída.
- Resumo inclui somente códigos de produto e quantidades positivas, sem posição,
  código de caixa, valor ou notas operacionais.
- Reutilizar `client_notifications`, `email_outbox`, cursor e retentativas atuais.
  Acesso do cliente, módulo, contatos ativos e preferências são conferidos pelo fluxo
  existente. IDs derivados do evento impedem duplicação em uma reexecução.
- Expor a nova opção em Comercial → Clientes → contato → Avisos por e-mail. Nenhum
  contato existente ou novo adere automaticamente. Todos os papéis de contato podem
  aderir, porque o aviso não leva valores.

## Limite conhecido da guarda parcial por linha

A guarda parcial encerra a tarefa por decisão já existente. Uma guarda avulsa aberta
posteriormente pela coordenação não guarda vínculo com o recebimento. Não inferir que
esse recebimento terminou apenas porque zerou o saldo da área: uma saída ou ajuste
poderia fazer o mesmo. O aviso só sai com cobertura integral comprovada das quantidades
por tarefas vinculadas ou entradas diretas em prateleira. Encerramento por guarda
avulsa sem vínculo fica fora deste disparo automático.

## Operação e validação

Sem nova rotina, segredo ou coleção; sem habilitar contatos em massa, enviar mensagens
reais ou publicar durante o desenvolvimento. A primeira execução/cursor continua sem
retroativo; habilitar um contato depois do evento não reenvia o aviso anterior.

Validar guarda parcial/completa/direta/concorrente, isolamento, opt-in, repetição de
processamento, retry, rótulos, acessibilidade, contratos de listas/API e regressões de
estoque/faturamento. CI verde precede merge; publicação em produção segue o processo
manual existente.

## Conferência na homologação

1. Em Comercial → Clientes → contato, marcar **Produtos disponíveis em estoque**
   em um contato de teste `@dutelog.com.br`; manter outro contato sem a marcação.
2. Conferir um recebimento novo por caixa e guardar somente a primeira de duas
   caixas. O novo aviso ainda não deve aparecer. Guardar a última caixa.
3. Após a rodada da rotina, conferir um aviso no sino abrindo o Estoque e o e-mail
   somente para o contato inscrito. Confirmar códigos/quantidades, ausência de
   valores/posições e nenhum segundo aviso na rodada seguinte.
4. Repetir por linha com guarda integral. Verificar também que guardar parcialmente
   não anuncia a conclusão. Os testes automatizados cobrem a concorrência e o replay.

O envio externo continua bloqueado na homologação para destinatários de outros
domínios. A entrega real depende da configuração do Resend no ambiente e deve ser
conferida nessa etapa; os testes locais usam emuladores e transportes de teste.
