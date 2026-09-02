# Fase 8 - Documentos operacionais

## Objetivo

Centralizar documentos de operação BTG em um módulo interno governado, com publicação controlada para o portal do cliente.

## Escopo entregue

- Novo módulo interno `/documentos`.
- Cadastro de NF, comprovante, romaneio, fatura, foto de avaria, contrato e outros documentos.
- Vínculo por tipo operacional: recebimento, pedido, expedição, fatura, exceção, produto, SKU ou operacional.
- Controle de visibilidade: `Liberado no portal` ou `Somente Dutelog`.
- Arquivamento lógico sem exclusão física.
- Mutação crítica via Cloud Function `mutateManagedEntity`, recurso `documents`.
- Projeção segura em `client_documents` quando o documento é liberado ao cliente.
- Evento operacional emitido para trilha do Agent Dute:
  - `document.uploaded`
  - `document.updated`
  - `document.archived`

## Operação

1. Acesse `Documentos` no menu interno.
2. Selecione o cliente.
3. Informe tipo, título, nome do arquivo e link do documento.
4. Vincule ao recebimento, pedido, expedição, fatura ou exceção quando houver ID.
5. Escolha se o documento aparece no portal.
6. Registre.

## Regras de segurança

- Cliente não grava documento.
- Cliente lê apenas `client_documents` do próprio cliente.
- Documento interno fica na coleção `documents`.
- Publicar, ocultar e arquivar passam pela Cloud Function.
- Arquivar remove a visibilidade no portal sem apagar histórico.

## Limite conhecido

Nesta fase o sistema registra link/referência do arquivo. Upload binário direto com URL assinada de Storage deve entrar na próxima fase de anexos físicos.

## Smoke test

- Entrar como usuário interno.
- Abrir `/documentos`.
- Registrar um documento com visibilidade para portal.
- Confirmar que aparece em `/portal/documentos`.
- Ocultar o documento.
- Confirmar que deixa de aparecer para cliente.
- Arquivar e validar evento operacional.
