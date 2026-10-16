# Novo go-live: zeragem total do Firestore

Roteiro para apagar **todos os dados** de produção (`dute-btg`) e começar do
zero, recadastrando produtos pelo inventário de abertura. É diferente da
zeragem de 30/07/2026 (`tools/reset_btg_inventory.py`), que apagou só
catálogo, saldo e fluxos físicos e preservou faturamento, eventos e agente.

A ferramenta é `tools/full_reset_btg.py`. Ela **descobre as coleções no banco**
(`listCollectionIds`) em vez de usar uma lista fixa: a zeragem de julho deixou
para trás `request_counters` (numeração PED-/ENV-) e `ops_aggregates` (totais
do painel) porque essas coleções nasceram depois do script.

## O que é apagado e o que fica

| Grupo | Coleções | Padrão |
|---|---|---|
| Acesso e configuração do sistema | `users`, `invites`, `customer_accounts`, `system_settings` | **Nunca apagadas.** Sem elas ninguém entra: o login é por convite e o papel vem de `users`. |
| Estrutura | `customers`, `locations`, `warehouse_positions`, `billing_price_list`, `billing_config` | Preservadas. Com `--include-setup` são apagadas também. |
| Tudo o mais | catálogo, saldos, movimentações, inventários, recebimentos, putaway, solicitações, pedidos, reservas, picking, packing, envios, devoluções, exceções, **faturamento** (competências, faturas, manual, snapshots), **eventos**, caixa, notificações, conversas e conhecimento do Agent Dute, documentos, contadores PED-/ENV-, agregados do painel, recibos de idempotência e qualquer coleção nova | Apagadas. `--keep <coleção>` (repetível) preserva uma coleção específica depois de revisar o dry-run. |

`system_controls/inventory` é reescrito por inteiro ao final: estoque não
inicializado, inventário de abertura obrigatório, movimentações liberadas. Em
`events` fica um único evento `system.full_reset_completed` com contagens,
hash do backup e caminho do export: é o primeiro registro da nova auditoria.

Fora do alcance da ferramenta:

- **Firebase Authentication** (contas de login): preservado por desenho.
- **Cloud Storage** (`dute-btg.firebasestorage.app`: fotos de produto, anexos
  de envio, documentos): não é tocado. Limpeza manual opcional no fim deste
  roteiro.
- Código, Cloud Functions, índices do Firestore e regras: nada muda.

## Antes de rodar

1. **Operação parada.** Pedidos, envios, recebimentos e solicitações em
   aberto são apagados junto; conclua ou aceite como perdidos.
2. **Financeiro guardou as faturas.** `client_invoices` e `billing_periods`
   somem do sistema. Exporte ou imprima faturas e relatórios de cada
   competência emitida para a guarda contábil antes de prosseguir.
3. **Decida `--include-setup`.** Sem a flag, cliente, endereços, lista de
   preços e configuração de cobrança continuam. Com ela, tudo isso precisa ser
   recadastrado, e o cliente deve voltar com **o mesmo `customer_code`**
   (`BTG Pactual`) dos perfis em `users`, senão os usuários do portal perdem o
   vínculo.
4. **Bucket do export existe**, no projeto `dute-btg`, na mesma localização do
   banco (o export recusa bucket em outra). Confira a localização e crie:

   ```powershell
   gcloud firestore databases describe --database="(default)" --project dute-btg --format="value(locationId)"
   gcloud storage buckets create gs://dute-btg-firestore-backups --project dute-btg --location southamerica-east1 --uniform-bucket-level-access
   ```

   Sem o bucket, o `--apply` para no export com "nada foi apagado" e o
   controle de estoque volta ao normal; basta criar o bucket e repetir.

5. `gcloud` autenticado como `leonardo@dutelog.com.br`, projeto `dute-btg`,
   `main` limpa e atualizada, Python 3 disponível.

## Passo a passo

### 1. Dry-run

```powershell
python tools\full_reset_btg.py
```

Imprime o plano em JSON: cada coleção com contagem, separada em `delete` e
`preserve`, o estado atual de `system_controls/inventory` e a frase de
confirmação. Nada é alterado. Revise a lista `delete`: se algo precisa ficar,
repita com `--keep <coleção>`; se quer apagar a estrutura, acrescente
`--include-setup`.

### 2. Aplicar

```powershell
python tools\full_reset_btg.py --apply --export-to gs://dute-btg-firestore-backups/full-reset --confirm "APAGAR TUDO dute-btg/(default)"
```

Com `--include-setup` e/ou `--keep` iguais aos do dry-run. O script, nesta
ordem:

1. Congela movimentações em `system_controls/inventory`
   (`reconciliation_status: full_reset_running`).
2. Lê tudo o que vai apagar e grava backup local em
   `.backups/full-reset-<timestamp>.json` com `.sha256` (pasta ignorada pelo
   git; contém dado de produção, não sai da máquina).
3. Roda o **export gerenciado** `gcloud firestore export` para
   `<--export-to>/full-reset-<timestamp>` e espera concluir. Se falhar
   (bucket inexistente, permissão), **nada é apagado** e o controle volta ao
   estado anterior.
4. Apaga os documentos em lotes de 400.
5. Verifica com leituras fortes que só sobrou o preservado (inclusive
   coleções que tenham surgido durante a execução). Se sobrar algo, para com
   o estoque congelado; rodar de novo conclui.
6. Reescreve `system_controls/inventory` e grava o evento de go-live.

A saída final tem `ok: true`, contagens por coleção, caminho do backup, hash e
URI do export. Guarde essa saída.

## Depois

1. Se usou `--include-setup`: recadastrar cliente (mesmo `customer_code`),
   endereços do armazém, lista de preços e configuração de cobrança no app.
2. **Inventário de abertura** em Estoque › Contagem, aba "Inventário de
   abertura" (Estoque › Itens mostra o aviso com o atalho enquanto a
   abertura estiver pendente): iniciar sessão, contar cada produto (código
   do cliente, SKU, nome, categoria, custo, quantidade, endereço, fotos) e
   concluir. É uma sessão por cliente: concluída, não abre de novo. Até
   concluir, o portal mostra "Inventário inicial em andamento" sem saldos e
   pedidos de saída são recusados. Não existe carga em massa; o importador
   da planilha segue congelado de propósito. A aba saiu do app em 08/10/2026
   (PR 68) e voltou em 16/10, depois da zeragem.
3. Financeiro abre a competência corrente. A numeração PED-/ENV- recomeça em
   0001.
4. Cloud Storage, opcional. Liste antes, apague depois:

   ```powershell
   gcloud storage ls gs://dute-btg.firebasestorage.app/
   gcloud storage rm -r "gs://dute-btg.firebasestorage.app/<prefixo>"
   ```

5. Atualizar a data de go-live no `CLAUDE.md` e nesta pasta.

## Rollback

O export gerenciado é a cópia restaurável:

```powershell
gcloud firestore import gs://dute-btg-firestore-backups/full-reset/full-reset-<timestamp> --project dute-btg
```

O import recria os documentos do export sobrescrevendo pelo mesmo id e não
apaga o que foi criado depois (o `system_controls/inventory` reescrito e o
evento de go-live). Depois do import, confira `system_controls/inventory` e
remova o evento `evt_full-reset-<timestamp>` se não fizer sentido mantê-lo.

O backup JSON local é uma segunda cópia, legível com Python; não há
restauração automática para ele (`tools/restore_btg_inventory.py` reconhece
só o formato da zeragem de estoque e recusa este).

## Se parar no meio

| Momento | Estado | O que fazer |
|---|---|---|
| Antes do export | nada apagado, controle congelado | Rodar de novo; o script aceita o próprio congelamento (`full_reset_running`). |
| Export falhou | nada apagado, controle restaurado | Corrigir bucket/permissão e rodar de novo. |
| Durante ou após o delete | parcialmente apagado, controle congelado | Rodar de novo para concluir, ou `gcloud firestore import` do export para voltar. |

## Histórico de execuções

| Data | Resultado | Export | Backup local (SHA-256) |
|---|---|---|---|
| 16/10/2026 11:54 UTC | Parou no export: bucket inexistente. Nada apagado, controle restaurado. | — | `full-reset-20261016T115443Z.json` |
| 16/10/2026 11:57 UTC | **Concluída.** Preservadas as 8 coleções padrão (acesso e estrutura; sem `--include-setup`). Apagadas, entre outras: 373 produtos, 373 SKUs, 616 saldos, 620 movimentações, 727 eventos, 112 reservas, contadores PED/ENV, playbooks e conhecimento do Agent Dute. | `gs://dute-btg-firestore-backups/full-reset/full-reset-20261016T115746Z` | `full-reset-20261016T115746Z.json` (`1bf95b12…56f7`) |

Depois da execução de 16/10: inventário de abertura pendente no app (Estoque ›
Contagem); playbooks do
Agent Dute precisam ser semeados de novo (Agent Dute > Playbooks); modelos de
pedido do portal e memória do agente recomeçam vazios.
