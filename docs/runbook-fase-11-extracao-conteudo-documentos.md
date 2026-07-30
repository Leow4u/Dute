# Fase 11 - Extracao de conteudo para Knowledge do Agent Dute

## Objetivo

Ligar documentos operacionais anexados no modulo Documentos a base de conhecimento consultada pelo Agent Dute, sem inventar conteudo de anexos.

## O que foi implementado

- Nova Cloud Function `extractOperationalDocumentContent`.
- Leitura segura de arquivos textuais no Storage.
- Quebra do conteudo em chunks na colecao `ai_agent_knowledge_chunks`.
- Criacao de registro ativo em `ai_agent_knowledge` para o Agent Dute consultar.
- Desativacao da versao anterior de conhecimento quando o mesmo documento for reprocessado.
- Evento operacional imutavel:
  - `document.content_extracted` quando houve texto extraido.
  - `document.content_extraction_pending` quando o arquivo exige OCR/parser.
- Tela de Documentos com botao `Conhecimento` e badges:
  - `Conteudo extraido`
  - `Aguardando OCR`
  - `Sem conteudo`

## Regra de seguranca operacional

A Function nao tenta interpretar PDF, imagem, DOCX ou XLSX como texto. Nesses casos, ela registra `pending_ocr` e nao mascara a falta de leitura integral do arquivo.

Se o documento ja foi revisado pelo Agent Dute e possui `ai_summary`, a Function pode publicar esse resumo como conhecimento de metadados, sinalizando que o conteudo integral ainda depende de OCR/parser.

## Colecoes afetadas

- `documents`
- `client_documents`, quando o documento esta visivel ao cliente.
- `ai_agent_knowledge`
- `ai_agent_knowledge_chunks`
- `events`
- `managed_operations`

## Proxima evolucao recomendada

1. Adicionar parser/OCR para PDF e imagem usando Document AI ou Vertex AI.
2. Adicionar parser especifico para XLSX/DOCX quando anexos operacionais chegarem nesses formatos.
3. Criar tela de auditoria da base de conhecimento com status por documento.
4. Permitir aprovar manualmente a publicacao de chunks sensiveis antes de o Agent Dute consultar.

## Validacao esperada

- Build das Functions sem erro.
- Typecheck e build do frontend sem erro.
- Testes unitarios das Functions sem regressao.
- Deploy da Function `extractOperationalDocumentContent`.
- A pagina `https://app.dutelog.com.br/documentos` deve abrir normalmente.
