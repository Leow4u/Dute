# Fase 4: financeiro da operação, portal e lançamento

Desenho e registro da Fase 4 do plano de implantação
(`plano-de-implantacao.md`, seção 7). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Faturar a demanda executada e registrar o recebimento.
- Mostrar as OS e as faturas ao cliente no portal.
- Avisar por sino e por e-mail.
- Lançar a Operação com a v3 em todo o app.

## Decisões

Seguem a recomendação do plano até a resposta do Leonardo:

| Pergunta | Recomendação seguida |
|---|---|
| 15 | A NF é emitida fora do sistema, que só a registra. |
| 16 | O pedido do portal vira demanda `portal` em Para planejar. |
| 17 | Os e-mails seguem as preferências do perfil do cliente. |
| 18 | O WMS vai para a v3 começando por Início, Pedidos, Estoque e Receber. |

- **A unidade é a demanda.**
  - Uma NF fecha uma ou mais demandas do mesmo cliente, todas A faturar.
  - Quem fatura é owner, admin ou financeiro (`FINANCEIRO_ROLES`, a mesma lista do Faturamento do WMS).
- **O valor sai do servidor, nunca do pedido.** É o total da RV validada pelo cliente, a mesma que as autorizações citam.
  - O orçamento aprovado com os aditivos ou a RV de execução.
  - Na medição mensal, é a soma das linhas da demanda na medição aprovada. A autorização da medição só guarda o total do mês.
  - A autorização que cita outra RV da demanda recusa.
- **A autorização.**
  - A demanda cujo contrato pede autorização (pedido e aceite, portal ou medição aprovada) só fatura com a autorização registrada, do mesmo cliente.
  - A demanda sem essa exigência fatura sem autorização: a validação do cliente é o registro.
  - A NF marca a autorização como usada (`nf_ids`, reservado desde a parte 15 do Comercial). A partir daí o Comercial não a cancela.
- **A etapa "faturada".**
  - Entra em `ETAPAS_DEMANDA`, e só o Financeiro leva a demanda a ela.
  - Ela não se perde (`ETAPAS_QUE_PERDEM`) nem recebe autorização ou complemento.
  - Sai da fila do Comercial. A Operação a mostra como "Faturada".
- **A armazenagem** continua na fatura do WMS (`billing_periods` e `client_invoices`) até a Fase 7.
- **Omie** continua fora.

## Dados

| Coleção | Dono | O que guarda |
|---|---|---|
| `faturas` | Financeiro | A NF registrada. Guarda as demandas, cada uma com a RV ou a medição, as autorizações citadas e o valor em centavos, e o total. Também a NF (número, série, emissão), `nf_chave` (série e número), o vencimento, a forma de pagamento, a observação, o status (emitida; enviada, paga e cancelada vêm na parte 4.2) e quem registrou. O id sai da série e do número da NF, então a mesma NF não se registra duas vezes. |
| `financeiro_operations` | Financeiro | O recibo de idempotência. Ninguém lê. |
| `demands` | Comercial | O Financeiro escreve `etapa: "faturada"`, `etapa_desde`, o marco em `marcos` e `faturamento`: a fatura, a NF e o vencimento, sem valor. |
| `client_authorizations` | Comercial | O Financeiro escreve só `nf_ids`. |

Preço só em `faturas`, lido por `canReadPrices()`: owner, admin, financeiro e
comercial. A operação, o campo, o suporte, o painel e o cliente não leem. O
cliente dono lê as próprias faturas na parte 4.3. Nada se grava pelo
navegador. A zeragem do WMS nunca apaga `faturas`, `financeiro_operations` nem
os eventos do Financeiro.

## Callables

Ficam em `functions/financeiro` (codebase `financeiro`), cada uma numa linha
e começando por `requireFinanceiroCaller`:

- `registerNf` (parte 4.1a).

## Eventos

O `source` é `functions_financeiro`, a severidade é `info` e o evento é da
fatura (`entity_type: fatura`), com o `customer_code`.

- `nf.registered`: a fatura, as demandas, quantas autorizações, a emissão, o vencimento e a forma.
- O evento não leva o valor nem o número da NF.
- O financeiro lê os `nf.*`, como lê os `billing.*` do WMS.

## Telas

O shell v3 do Financeiro fica em `/financeiro`, para owner, admin e
financeiro (`FINANCE_ROLES`, a mesma lista das callables). O menu tem:

- **Início** (`/financeiro`): o "Precisa de você" e a fila em números.
  - As prontas viram "N demandas a faturar", com os clientes e o total. Ficam críticas depois de 15 dias A faturar (`DIAS_PARA_FATURAR`).
  - As que esperam a autorização e as sem valor viram itens de informação.
  - O mesmo cálculo dá os contadores do menu e o card da entrada.
- **A faturar** (`/financeiro/a-faturar`): as prontas por cliente, as que esperam e o painel de registrar a NF.
- **Armazenagem**: leva ao Faturamento do WMS (`/faturamento`), que continua no shell do WMS até a Fase 7.

O financeiro tem um módulo só e por isso não tem seletor. No menu do WMS, logo
antes do Faturamento, o item "Financeiro" leva de volta. Owner e admin trocam
pelo seletor.

## Liberação

`FINANCEIRO_AMBIENTES_LIBERADOS = ["dute-homolog"]`, no app
(`lib/liberacao.ts`) e nas callables, travada por `platform-lists.test.ts`. O
`dute-prod` entra no lançamento (parte 4.9), com o OK do Leonardo.

Fora da liberação, nada muda: o card do Financeiro e a casa do financeiro
continuam no Faturamento do WMS, e as rotas `/financeiro` não existem
(`soComFinanceiroLiberado`).

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 4.1a | Codebase `functions/financeiro`, `registerNf`, `faturas`, a demanda Faturada, `nf.registered`, regras e zeragem | Sem autorização não fatura; o valor é o da RV validada e autorizada (ou da medição); a operação não lê `faturas` |
| 4.1b | Shell do Financeiro (v3) em `/financeiro`: Início e A faturar, com o painel de registrar a NF | Textos listados; sem legenda; uma ação principal; `axe` |
| 4.2 | A receber, vencidos, pagos, receita por cliente, XLSX, via comercial do PDF | Vencido pelo vencimento; pagamento parcial |
| 4.3 | Portal: OS do cliente e faturas da demanda | Cliente só vê as próprias OS e faturas |
| 4.4 | Solicitação de OS pelo portal | O pedido do portal nunca cria OS sozinho |
| 4.5 | Expedição do WMS com entrega pela Dutelog gera demanda e OS | Retirada pelo cliente não gera OS |
| 4.6 | Notificações por modelo (sino e e-mail) | E-mail só com o canal ligado no perfil |
| 4.7 | WMS na v3, tela a tela | `theme-colors.test.ts`; render e `axe` por tela |
| 4.8 | Relatórios | Sem valor para quem não vê valor |
| 4.9 | Lançamento em produção | Conferência de produção |

## Registro

### Parte 4.1a: o registro da NF no backend

Feita em 23/10/2026. Regras em `functions/financeiro/src/domain/fatura.ts`; a
gravação em `fatura-gravacao.ts`.

- **A codebase.** `functions/financeiro`, no molde da Operação:
  - liberação, papéis, perfil, idempotência e eventos;
  - entra no `firebase.json`, no CI (`financeiro-unit` e `financeiro-integration`) e na publicação.
- **`registerNf`.** Lê a NF (número, série, emissão, que não pode estar no futuro), o vencimento (depois da emissão), a forma de pagamento (boleto, pix, transferência, cartão ou dinheiro) e a observação. Numa transação:
  - confere cada demanda: A faturar, do mesmo cliente, sem medição pendente e ainda não faturada;
  - confere as autorizações que o contrato pede;
  - lê o valor no servidor;
  - grava a fatura emitida, leva as demandas a Faturada, marca as autorizações e grava o evento.
  - Repetir não duplica. A mesma NF com outra chave recusa.
- **Comercial.**
  - "faturada" entra em `ETAPAS_DEMANDA`, com o rótulo.
  - O teste trava que ela não se perde nem recebe autorização.
  - No app, a etapa ganha rótulo e cor no Comercial e na Operação.
- **Regras.** `faturas` só para quem lê preço, e nada se grava pelo navegador. O financeiro lê os eventos `nf.*`. O teste de regras é `functions/wms/src/financeiro-faturas.rules.test.ts`.
- **Zeragem.** `tools/full_reset_btg.py` preserva `faturas`, `financeiro_operations` e os eventos `functions_financeiro`.

### Parte 4.1b: o shell do Financeiro, o Início e A faturar

Feita em 23/10/2026. Regras da fila em `artifacts/app/src/lib/financeiro/a-faturar.ts`;
as leituras em `use-a-faturar.ts`; as telas em `artifacts/app/src/pages/financeiro/`.

- **A fila.** Lê ao vivo as demandas A faturar e Aguardando autorização. Lê pelo id cada autorização que elas citam e lê o valor de cada uma: a RV validada ou a medição aprovada.
- **Pronta para faturar.** A tela confere o mesmo que `registerNf`, na mesma ordem: etapa, medição pendente, autorização registrada do mesmo cliente, RV citada e valor.
  - A que não passa fica em "Esperando", com o motivo.
  - O servidor confere tudo de novo e calcula o valor.
- **O painel da NF.**
  - Uma NF é de um cliente só. Marcada a primeira demanda, só as prontas do mesmo cliente ganham caixa.
  - Os campos são número, série, emissão (até hoje), vencimento, forma de pagamento e observação.
  - O vencimento segue a regra de pagamento do contrato até a pessoa mexer nele.
  - O pedido leva as demandas e a NF, nunca o valor. Leva a chave de idempotência, nova a cada registro.
- **O Início e a entrada.** Os itens saem da mesma fila. O card do Financeiro na entrada conta só onde leva ao shell novo.
- **Navegação.** O card do Financeiro e a casa do financeiro (`getHomePathForProfile`) levam a `/financeiro` com a liberação.
- **Testes.** A regra da fila e do formulário está em `a-faturar.test.ts`, e a navegação em `navegacao.test.ts` e `ambientes.test.ts`. As telas estão em `inicio-view.test.tsx` e `a-faturar-view.test.tsx`: textos listados, sem legenda, uma ação principal e `axe`.
