# Fase 10 - Revisao inteligente de documentos

## Objetivo

Transformar documentos operacionais em evidencias consultaveis pelo Agent Dute, com resumo, tags, pontos de atencao e evento auditavel.

## Escopo entregue

- Nova Cloud Function `reviewOperationalDocument`.
- Novo flow Genkit `reviewOperationalDocument`.
- Evento imutavel `document.reviewed`.
- Metadados de Storage preservados em `documents` e `client_documents`.
- Tela interna `Documentos operacionais` com acao `Revisar IA`.
- Busca da biblioteca considerando resumo e tags gerados pelo Agent Dute.

## Comportamento

1. Operador publica ou anexa um documento em `Documentos`.
2. Operador clica em `Revisar IA`.
3. A Function busca o documento, valida permissao interna e chama o flow do Agent Dute.
4. O Agent Dute usa os metadados reais disponiveis. Ele nao inventa conteudo do arquivo.
5. O sistema grava:
   - `ai_summary`
   - `ai_tags`
   - `ai_status`
   - `ai_confidence`
   - `extracted_fields`
   - `review_notes`
   - `reviewed_by`
   - `reviewed_at`
6. Se o documento estiver visivel ao cliente, a projecao em `client_documents` tambem recebe a revisao.
7. O evento `document.reviewed` entra no trilho operacional do Agent Dute.

## Limites conscientes

Nesta fase, a revisao usa metadados e texto informado no cadastro do documento. Leitura direta de PDF, imagem, OCR ou extracao de conteudo do arquivo deve ser tratada em uma fase posterior para nao criar falsa confianca.

## Permissoes

Podem revisar documentos:

- `owner`
- `admin`
- `interno`
- `wms`
- `financeiro`

Cliente nao revisa documento. Cliente consome apenas o que estiver publicado na projecao `client_documents`.

## Evidencias para QA

- Criar documento com arquivo local e confirmar que `storage_path`, `content_type` e `size_bytes` aparecem no Firestore.
- Clicar em `Revisar IA` e confirmar preenchimento de resumo/tags.
- Verificar evento `document.reviewed` em `events`.
- Publicar documento para cliente e confirmar que `client_documents` recebe `ai_summary` e `ai_tags`.

## Proxima evolucao recomendada

Adicionar extracao de conteudo:

- PDF texto: parser server-side.
- Imagem/foto: OCR via Document AI ou Gemini multimodal.
- Planilha: extracao tabular validada.
- Contrato/proposta: indexacao em base de conhecimento do Agent Dute.
