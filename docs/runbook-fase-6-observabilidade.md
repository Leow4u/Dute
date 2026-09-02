# Runbook Fase 6 - Observabilidade e suporte

Este runbook define como o suporte acompanha producao sem alterar estoque,
faturamento ou acesso fora das rotinas aprovadas.

## Objetivo

- Centralizar saude do sistema em `Suporte > Observabilidade`.
- Registrar incidentes como eventos auditaveis em `events`.
- Manter o Agent Dute alimentado por ocorrencias reais.
- Separar incidente tecnico de impacto operacional.
- Dar ao suporte uma rotina diaria clara.

## Onde operar

| Acao | Tela | Perfil |
| --- | --- | --- |
| Ver saude do app | Suporte > Observabilidade | owner/admin/suporte |
| Registrar incidente | Suporte > Observabilidade | owner/admin/suporte |
| Ver alertas de IA | Suporte > Observabilidade ou Agent Dute | owner/admin/suporte |
| Ver fila WMS pendente | Suporte > Observabilidade | owner/admin/suporte |
| Resolver causa operacional | Modulo dono do processo | perfil responsavel |
| Alterar estoque/fatura/acesso | Nunca pelo suporte sem aprovacao | dono do processo |

## Rotina diaria

1. Abrir `Suporte > Observabilidade`.
2. Confirmar `API do app = Online`.
3. Revisar alertas criticos e incidentes recentes.
4. Verificar se o ledger de eventos recebeu registros recentes.
5. Conferir WMS pendente e solicitacoes abertas.
6. Confirmar backup/export do dia anterior quando houver rotina configurada.
7. Registrar incidente se houver falha, lentidao, divergencia tecnica ou risco.

## Como registrar incidente

Preencha:

- Severidade: informacao, atencao ou critico.
- Cliente afetado.
- Entidade afetada, quando houver: pedido, SKU, function, rota, fatura.
- Titulo claro.
- Descricao com impacto, horario, responsavel e acao tomada.

O sistema envia o registro para `/api/ai/events`, que deve passar por Cloud
Function e criar evento do tipo `support.incident`.

## Criterios de severidade

| Severidade | Quando usar |
| --- | --- |
| Info | Observacao sem impacto ou acompanhamento preventivo |
| Atencao | Falha parcial, fila parada, risco de SLA ou necessidade de investigacao |
| Critico | Cliente sem acesso, saldo incorreto, pedido bloqueado, fatura errada ou indisponibilidade |

## Regras de seguranca

- Suporte nao altera saldo, faturamento ou papel de usuario para "corrigir"
  incidente.
- Toda correcao operacional deve ocorrer no modulo dono do processo.
- Toda acao relevante precisa deixar evento no ledger.
- Nao apagar incidente; se encerrado, registrar novo evento de resolucao ou
  marcar o alerta correspondente como resolvido.

## Smoke test apos deploy

- `https://app.dutelog.com.br/suporte` responde com a tela.
- `/api/healthz` retorna online.
- Um incidente de teste interno cria evento em `events`.
- O evento aparece no Agent Dute/observabilidade apos atualizar.
- Usuario sem perfil `owner`, `admin` ou `suporte` nao acessa a rota.
