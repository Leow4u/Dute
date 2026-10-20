# Correção de caixa no inventário de abertura

Use **Corrigir caixa** em **Contagem → Inventário de abertura → Linhas conferidas** quando os produtos estão em caixas físicas diferentes, mas foram lançados na mesma caixa por engano.

1. Confira as etiquetas das caixas físicas.
2. Cadastre a caixa de destino na mesma sessão, caso ainda não exista.
3. Filtre os lançamentos pela caixa incorreta.
4. Na linha, escolha **Corrigir caixa**, selecione a caixa física de destino e informe o motivo.
5. Confira origem, destino e quantidade e confirme.
6. Repita para as demais linhas e confira o conteúdo das caixas.

A operação move a linha inteira. SKU, cadastro, fotos, custo e quantidade global são preservados. Se as caixas estiverem em prateleiras diferentes, os saldos por posição são realocados na mesma transação, com movimentos compensados que não entram na cobrança. Toda correção registra ator e motivo. Repetir a mesma requisição não repete a movimentação.

Nesta primeira entrega, o destino precisa ser uma caixa guardada do mesmo cliente e sessão e não pode ter outro lançamento do mesmo SKU. Tamanhos com SKUs diferentes podem compartilhar a caixa. Dividir parte de uma linha ou fundir contagens do mesmo SKU exige outra operação; não use estorno para simular uma simples troca de caixa.

A ação **Remover para corrigir** continua destinada ao estorno de uma contagem errada: pode remover um cadastro criado na abertura quando não resta estoque. Para erro apenas na caixa, use **Corrigir caixa**.

Cada novo lançamento exige conferir explicitamente a etiqueta da caixa selecionada. A confirmação é limpa ao salvar ou trocar de caixa.

## Validação

- Integração Firestore: mesma posição, posições diferentes, idempotência, isolamento de cliente/sessão, destino inválido e preservação de saldo/catálogo.
- Frontend: roteamento da callable e seleção dos destinos compatíveis.
- Nenhuma correção de dados reais é executada pelo deploy; a equipe escolhe as caixas físicas na interface.
