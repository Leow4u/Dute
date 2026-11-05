# Recebimento manual — telas aprovadas

Leonardo aprovou estas cinco telas em 04/11/2026 e autorizou sua implementação nesta conversa. A rotina é selecionar o produto da NF e informar o total físico contado naquela caixa.

1. [Fila e cancelamento](01-fila-e-cancelamento.png): motivo, original e observação; retirada da fila com histórico.
2. [Conferência manual](02-conferencia-manual.png): selecionar produto, digitar quantidade e confirmar. O exemplo tem 66 unidades salvas e 10 ainda digitadas.
3. [Fechar caixa](03-fechar-caixa.png): revisar conteúdo e informar medidas/peso. Volume do exemplo: 0,084 m³.
4. [Definir destino](04-definir-destino.png): sugestão e confirmação de prateleira, com continuidade sem prateleira quando necessário.
5. [Revisar entrada](05-revisar-entrada.png): quantidades, caixas e destino antes de concluir. Depois ainda há guarda física.

As imagens são referências conceituais, não screenshots de produção. Na implementação, os componentes, tokens, tipografia e ícones do app mantêm a consistência entre as etapas. A conferência deve continuar permitindo múltiplas caixas, falta/sobra com justificativa, consulta por suporte e histórico sem ações de escrita. Quantidade digitada vazia não remove produto, e selecionar produto já incluído abre a edição do total, sem incremento implícito.

Plano e contratos: [recebimento manual e cancelamento](../../superpowers/plans/2026-11-04-recebimento-manual-e-cancelamento.md).

Implementação: [verificação visual e funcional](design-qa.md), com screenshots do navegador em desktop e celular.
