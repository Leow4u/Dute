# Fase 16 - Recebimento operacional

## Objetivo

Transformar o recebimento em uma etapa operacional confiavel: a Dutelog registra a chegada, confere o fisico, evidencia divergencias e somente depois libera saldo para estoque.

## O que mudou

- A conferencia de recebimento agora calcula e grava diferenca por linha:
  - `expected_qty`
  - `received_qty`
  - `difference_qty`
  - `conference_status`
- O recebimento grava agregados da conferencia:
  - `qty_expected`
  - `qty_received`
  - `qty_difference`
  - `divergence_count`
  - `conference_status`
- O evento `inbound.conference_saved` passa a registrar esperado, fisico, diferenca e quantidade de divergencias.
- A tela de recebimento mostra resumo claro de esperado, fisico lido, diferenca e divergencias.
- Cada linha de conferencia mostra status operacional:
  - OK fisico
  - falta
  - sobra
  - revisar
- O operador pode preencher as linhas com `Usar esperado`, salvar a conferencia e registrar observacoes por linha.
- A chegada avulsa bloqueia linhas invalidas antes de criar a conferencia:
  - codigo repetido no mesmo recebimento;
  - quantidade invalida;
  - produto novo sem nome;
  - produto existente marcado como novo.
- O formulario de chegada avulsa mostra resumo de pecas esperadas, produtos existentes e novos cadastros.

## Fluxo operacional

1. Rafael registra uma chegada avulsa ou abre uma chegada prevista.
2. O sistema cria a tarefa de conferencia sem lancar estoque.
3. Rafael confere quantidade fisica por linha.
4. O sistema sinaliza falta, sobra ou OK.
5. Rafael salva a conferencia.
6. Se houver divergencia, ele registra excecao quando necessario.
7. A entrada so libera saldo ao cliente quando a etapa e concluida no WMS.

## Seguranca

- Produto duplicado continua bloqueado na transacao de criacao do recebimento.
- Estoque nao e atualizado pelo modal de chegada.
- Estoque so e atualizado pela transicao valida do WMS.
- A conferencia e idempotente por `idempotency_key`.
- Divergencias ficam registradas em linha, recebimento e evento operacional.

## Validacao

Executado em 2026-07-11:

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

Observacao: o build frontend manteve avisos antigos de sourcemap e chunk grande, sem falha.
