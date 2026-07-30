# Fase 9 - Anexos físicos em Storage

## Objetivo

Permitir que documentos operacionais tenham arquivo real anexado ao sistema, sem depender apenas de links externos.

## Escopo entregue

- Upload local na tela interna `/documentos`.
- Cloud Function `createDocumentUploadTarget` para autorizar upload operacional.
- Caminho padronizado no bucket:
  - `operational-documents/<cliente>/<aaaa-mm>/<timestamp>-<arquivo>`
- Limite de arquivo: 30 MB.
- Tipos aceitos:
  - PDF
  - imagens
  - texto/CSV
  - Excel/planilhas
  - Word/documentos
  - ZIP
- URL de leitura tokenizada gravada no documento.
- Metadados gravados no documento:
  - `file_url`
  - `external_url`
  - `storage_path`
  - `content_type`
  - `size_bytes`
  - `source = storage_upload`
- Regras de Storage liberam `operational-documents/**` apenas para perfis internos.
- CORS aplicado no bucket `dute-btg.firebasestorage.app` para `https://app.dutelog.com.br`.

## Fluxo operacional

1. Acesse `Documentos`.
2. Preencha cliente, tipo, título e vínculo operacional.
3. Em `Arquivo local`, selecione PDF, imagem, planilha ou documento.
4. Clique em `Registrar documento`.
5. O sistema autoriza o upload via Function, envia o arquivo para Storage e registra o documento governado.
6. Se `Liberado no portal` estiver ativo, o documento aparece para o cliente em `/portal/documentos`.

## Segurança

- Cliente não faz upload por este fluxo.
- Upload é autorizado por perfil interno: owner, admin, interno, wms ou financeiro.
- O documento continua sendo criado pela Function de governança `mutateManagedEntity`.
- Arquivamento remove visibilidade no portal sem apagar o arquivo histórico.
- As Functions Gen2 usam a Compute Engine default SA (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) e precisam da role `roles/iam.serviceAccountTokenCreator` **nessa própria SA** para `getSignedUrl` (permissão `iam.serviceAccounts.signBlob`). Sem isso, foto/documento retorna `INTERNAL` / SigningError.
- CORS do bucket `dute-btg.firebasestorage.app` deve permitir origem `https://app.dutelog.com.br` com métodos `PUT`/`OPTIONS` e header `x-goog-meta-firebaseStorageDownloadTokens` (ver `deploy/cloud-storage/cors.json`).

## Smoke test

- Abrir `https://app.dutelog.com.br/documentos`.
- Selecionar um PDF pequeno.
- Registrar com visibilidade no portal.
- Confirmar link `Abrir` na biblioteca interna.
- Confirmar documento no portal do cliente.
- Ocultar ou arquivar e validar que sai do portal.
