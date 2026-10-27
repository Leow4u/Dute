# Cadastro de LPU no contrato

O Comercial precisa cadastrar a tabela de preço do contrato e usar seus itens no orçamento, sem copiar código e preço para linhas avulsas. Referência operacional: contrato Itaú 4900030161; códigos DTL com variantes D/T/M.

## Abordagem

Reaproveitar `price_tables`, `lpu_items`, a seleção por contrato/variante/data e a precificação do orçamento. Um cadastro paralelo ou preços embutidos no contrato duplicariam regras e não atenderiam às medições e ao faturamento existentes. Estas decisões de implementação seguem o pedido e os padrões do repositório.

O card de tabelas ganha **Adicionar tabela**, com nome, código opcional, variante (Comercial por padrão), vigência opcional e editor de código, descrição, unidade e preço. O início ausente herda o início do contrato; o fim ausente fica aberto. A entrada desta versão é a edição manual de itens; importação direta de XLSX fica fora da entrega.

A callable `saveContractPriceTable` e `POST /api/v1/comercial/contratos/{id}/tabelas` compartilham validação e transação, eventos e recibos idempotentes. `GET` aninhado lista apenas o contrato autorizado. O REST usa Bearer, `Idempotency-Key` e `comercial:contratos:gravar`; leitura usa `comercial:ler`.

As tabelas continuam imutáveis: mudanças de preços entram por nova vigência, encerrando a anterior conforme a regra existente. PATCH de preços e DELETE ficam fora desta versão para conservar referências históricas. Os códigos D/T/M devem produzir itens distintos mesmo com descrição e unidade iguais. Os preços continuam em texto decimal exato (até quatro casas), com no máximo 480 itens.

O orçamento usa os itens vinculados à LPU, herdando código e preço pelo backend sem motivo de linha avulsa. Um rascunho sem tabela poderá buscar a tabela cadastrada depois, sem recalcular propostas enviadas ou aprovadas silenciosamente.

## Validação

Testes de validação, permissões e isolamento por cliente/contrato, idempotência, concorrência, vigências, precisão monetária, cadastro REST seguido de orçamento, formulário e acessibilidade. Rodar typecheck, testes frontend/Comercial e build. A publicação segue o fluxo oficial do projeto e exige conferência de homologação; nenhuma escrita de dados reais é necessária para desenvolver ou testar.
