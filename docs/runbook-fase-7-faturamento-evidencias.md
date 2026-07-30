# Runbook Fase 7 - Faturamento com evidencias

Este runbook define como revisar cobrancas mensais com base em eventos,
movimentacoes, documentos e snapshots imutaveis.

## Objetivo

- Amarrar cada competencia a evidencias operacionais reais.
- Evitar fatura baseada apenas em preenchimento manual.
- Mostrar ao financeiro o que precisa ser validado antes da emissao.
- Dar ao cliente uma leitura clara da composicao da cobranca.
- Manter a emissao como snapshot imutavel.

## Onde operar

| Acao | Tela | Perfil |
| --- | --- | --- |
| Revisar competencia | Faturamento | owner/admin/financeiro |
| Ver evidencias | Faturamento > Evidencias da competencia | owner/admin/financeiro |
| Salvar quantidades manuais | Faturamento | owner/admin/financeiro |
| Emitir fatura | Faturamento | owner/admin/financeiro |
| Marcar como paga | Faturamento | owner/admin/financeiro |
| Ver composicao publicada | Portal > Faturas | cliente |
| Anexar nota/comprovante | Documentos ou modulo financeiro futuro | interno/financeiro |

## Evidencias consideradas

- `movements`: entradas, saidas e quantidade de movimentos da competencia.
- `inbound_receipts`: recebimentos fisicos registrados no periodo.
- `orders`: pedidos operacionais criados ou entregues no periodo.
- `shipments`: expedicoes registradas no periodo.
- `documents`: documentos vinculados a fatura ou competencia.
- `events`: eventos do ledger, incluindo eventos de faturamento.
- `billing_manual`: quantidades manuais revisadas pelo financeiro.
- `billing_periods`: status, emissao, pagamento e snapshot.

## Rotina de fechamento mensal

1. Abrir `Faturamento`.
2. Selecionar a competencia.
3. Conferir o bloco `Evidencias da competencia`.
4. Resolver alertas de evidencias antes de emitir.
5. Salvar quantidades manuais quando a LPU exigir lancamento manual.
6. Abrir a previa PDF.
7. Emitir a fatura apenas depois da conferencia.
8. Validar no portal do cliente se a composicao foi publicada.

## Regras de seguranca

- Fatura emitida nao deve ser recalculada silenciosamente.
- Eventos, movimentos e documentos servem como trilha de auditoria.
- Itens manuais precisam de observacao quando a origem nao estiver obvia.
- Divergencia operacional deve ser resolvida no modulo dono do processo, nao
  diretamente na fatura.
- O cliente ve a composicao dos servicos, mas nao detalhes internos de galpao
  que nao fazem parte da prestacao de contas.

## Smoke test apos deploy

- `https://app.dutelog.com.br/faturamento` abre para perfil financeiro.
- O bloco `Evidencias da competencia` aparece e carrega metricas.
- `/api/billing/periods/YYYY-MM/evidence` retorna JSON.
- `Portal > Faturas` mostra a composicao quando a fatura possui linhas/grupos.
- Emissao e pagamento continuam passando por Cloud Functions.
