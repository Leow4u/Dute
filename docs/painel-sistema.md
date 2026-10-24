# Painel do sistema (Configuração > Sistema, só owner)

O painel mostra a saúde do sistema, sem nada da operação (estoque, pedidos).

- **Agent Dute** (`getSystemDashboard`): custo estimado pelo consumo de tokens,
  projeção do mês, orçamento, uso por perfil, rotinas de todo mundo e falhas
  de 24 h. Preços e orçamento ficam em `system_settings/agent_costs`.
- **Infraestrutura** (`getSystemInfra`): erros do servidor em 24 h, functions
  publicadas e com acesso público, custo real do Google Cloud. A tabela do
  faturamento fica em `system_settings/infra`.

O painel só lê. Ele não corrige permissão nem publica function: mostra o
comando para rodar no terminal.

## De onde vem cada quadro da infraestrutura

| Quadro | Fonte | Detalhe |
|---|---|---|
| Erros do servidor | Cloud Logging, 24 h | `severity>=ERROR` dos serviços do Cloud Run (functions e site), agrupados por function e primeira linha da mensagem. Também conta as requisições recusadas com **403** antes de o código rodar (falta de `allUsers`/`roles/run.invoker`, o incidente de 03/09/2026). Logs de requisição com 5xx ficam de fora porque repetem o erro do código. |
| Functions publicadas | Cloud Functions v2 + Cloud Run | As functions de todas as codebases, cada uma com a dela (`wms` é a `default`). No WMS, compara as functions exportadas no `index.ts` com as publicadas; nas outras, confere as publicadas, pelos rótulos que o `firebase deploy` põe em cada function (`firebase-functions-codebase` e `deployment-callable`). Mesmo critério do `tools/check_functions_invoker.ps1`: não existe ou estado diferente de `ACTIVE` é **não publicada**, com o `firebase deploy` da codebase; callable sem invoker público é **sem acesso**. Fora do WMS, a function que nunca subiu só aparece na conferência da publicação. |
| Custo real | BigQuery (exportação do faturamento) | Soma de `cost` + créditos do mês da fatura, por serviço, só do projeto `dute-btg`. Compara o Vertex AI da fatura com a estimativa do Agent Dute. |

As consultas levam alguns segundos. A tela guarda o resultado por 5 minutos
e tem o botão "Verificar agora". Se uma API negar acesso, só aquele quadro
mostra o erro; os outros continuam.

## Configuração no Google Cloud (uma vez)

### 1. Exportação do faturamento para o BigQuery

Precisa de quem administra a conta de faturamento.

1. Crie o dataset (pode ser pelo terminal):
   ```powershell
   bq --location=southamerica-east1 mk --dataset dute-btg:billing_export
   ```
2. No Console: **Faturamento › Exportação de faturamento › BigQuery export ›
   Custo de uso padrão › Editar configurações**. Projeto `dute-btg`, dataset
   `billing_export`. Salve.
3. Algumas horas depois aparece a tabela
   `gcp_billing_export_v1_<ID_DA_CONTA>` dentro do dataset. Copie o nome
   completo (`dute-btg.billing_export.gcp_billing_export_v1_...`) e cole no
   painel, em **Custo real do Google Cloud › Informar a tabela do faturamento**.

Os dados chegam com algumas horas a um dia de atraso.

### 2. Permissões da conta de serviço das functions

As functions de 2ª geração rodam com a conta de serviço padrão do Compute
(`<número do projeto>-compute@developer.gserviceaccount.com`). Se ela for
**Editor** do projeto, que é o padrão, não precisa fazer nada. Para conferir:

```powershell
$sa = "$(gcloud projects describe dute-btg --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud projects get-iam-policy dute-btg --flatten="bindings[].members" --filter="bindings.members:serviceAccount:$sa" --format="value(bindings.role)"
```

Se não aparecer `roles/editor`, dê só o que o painel lê:

```powershell
foreach ($role in "roles/logging.viewer","roles/cloudfunctions.viewer","roles/run.viewer","roles/bigquery.dataViewer","roles/bigquery.jobUser") {
  gcloud projects add-iam-policy-binding dute-btg --member="serviceAccount:$sa" --role=$role --condition=None
}
```

O painel mostra "Sem permissão para …" no quadro afetado quando falta alguma.
