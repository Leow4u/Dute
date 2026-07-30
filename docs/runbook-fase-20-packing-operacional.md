# Fase 20 - Packing operacional

## Objetivo

Tornar o fechamento de packing operacional de verdade: a expedição só pode ser criada depois de lacre informado e conferência física linha a linha.

## Entregue

- `advanceWarehouseTask` passou a aceitar `operation.packing_lines`.
- Packing rejeita conclusão sem conferência física das linhas.
- Packing rejeita quantidade embalada diferente da quantidade separada no picking.
- Itens do pedido recebem evidência de packing físico (`packing_physical_status`, `packing_physical_notes`, `packing_confirmed_at`).
- `package_items` e `shipment_items` passam a ser gerados a partir da quantidade fisicamente confirmada.
- A tela WMS envia automaticamente as linhas confirmadas no checklist do operador.
- O teste integrado do fluxo pedido -> picking -> packing foi atualizado para exigir packing físico antes de criar expedição.

## Fluxo Operacional

1. Rafael separa o pedido no Picking.
2. Rafael entra em Packing.
3. Confere cada linha fisicamente.
4. Registra falta ou avaria se houver divergência.
5. Informa volume, quantidade de volumes e lacre.
6. Fecha o Packing.
7. O sistema cria volume, pacote, itens embalados e expedição pronta para despacho.

## Validações

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

## Pendência Técnica

O teste integrado com Firebase Emulator ainda não executa neste ambiente porque o `firebase-tools` exige JDK 21 ou superior.

Comando bloqueado:

```powershell
pnpm --filter @workspace/functions run test:integration
```

Erro:

```text
firebase-tools no longer supports Java version before 21
```

## Critério De Aceite

- Packing não fecha sem lacre.
- Packing não fecha sem linhas físicas confirmadas.
- Packing não fecha com quantidade divergente sem exceção.
- Expedição só nasce depois do fechamento físico do Packing.
