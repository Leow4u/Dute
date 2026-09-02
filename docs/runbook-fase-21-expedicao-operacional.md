# Fase 21 - Expedição operacional auditável

## Objetivo

Tornar a saída e a entrega rastreáveis para operação Dutelog e para o portal do cliente, evitando baixa de expedição sem evidência mínima.

## Entregue

- `advanceWarehouseTask` agora bloqueia saída sem responsável pela coleta.
- Saída também exige motorista e placa ou identificação do veículo.
- Entrega exige comprovante e observação de entrega.
- O tracking do cliente passa a receber `delivery_notes` junto com protocolo, transportador, motorista, veículo e timeline.
- A tela WMS bloqueia o avanço com mensagens naturais antes de chamar a Function.
- O teste integrado do fluxo pedido -> picking -> packing -> expedição foi atualizado para cobrir as novas travas.

## Fluxo Operacional

1. Packing cria a expedição pronta para despacho.
2. Rafael entra em Expedição.
3. Confere volumes no staging.
4. Informa responsável pela coleta, motorista e veículo.
5. Confirma saída.
6. Após entrega na loja BTG, informa protocolo/canhoto e observação.
7. Sistema consome reserva, baixa estoque, fecha pedido e publica tracking para o cliente.

## Validações

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

## Pendência Técnica

O teste integrado com Firebase Emulator continua bloqueado neste ambiente por falta de JDK 21 ou superior.

Comando bloqueado:

```powershell
pnpm --filter @workspace/functions run test:integration
```

Erro:

```text
firebase-tools no longer supports Java version before 21
```

## Critério De Aceite

- Expedição não confirma saída sem coleta, motorista e veículo.
- Entrega não encerra pedido sem comprovante e observação.
- Tracking do cliente mostra saída e entrega com evidências.
- Estoque só é consumido no fechamento de entrega.
