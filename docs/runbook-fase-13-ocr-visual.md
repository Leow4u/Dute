# Fase 13 - OCR visual com Gemini multimodal

## Objetivo

Permitir que documentos que nao possuem texto extraivel por parser, como imagens e PDFs escaneados, possam alimentar a base de conhecimento do Agent Dute quando houver texto visivel no anexo.

## Como funciona

1. A Function `extractOperationalDocumentContent` baixa o anexo do Storage.
2. Tenta primeiro os parsers deterministicos:
   - texto
   - PDF com camada textual
   - XLS/XLSX/XLSM
   - DOCX
3. Se o resultado for `pending_visual_ocr` e o arquivo for imagem ou PDF, a Function chama Gemini via Vertex AI com o anexo em base64.
4. O prompt pede apenas transcricao fiel do texto visivel.
5. Se houver texto, o status vira `extracted_text`, `content_source = storage_visual_ocr` e o conteudo entra em:
   - `ai_agent_knowledge`
   - `ai_agent_knowledge_chunks`
6. Se nao houver texto legivel ou a chamada falhar, o documento permanece `pending_visual_ocr`.

## Limites de seguranca

- OCR visual automatico limitado por `DOCUMENT_VISUAL_OCR_MAX_BYTES`.
- Padrao atual: 14 MB (o arquivo vai inline em base64 e a requisicao ao Gemini tem teto de 20 MB). O anexo do aviso de envio aceita ate 15 MB; o portal reduz scans de celular no navegador antes de subir (`lib/attachment-compact.ts`).
- Modelo configuravel por `DOCUMENT_VISUAL_OCR_MODEL`.
- Padrao atual: `gemini-2.5-flash`.
- O prompt nao pede interpretacao, classificacao ou conclusao; pede transcricao.
- A Function nao inventa dados se o OCR nao encontrar texto.

## Estados esperados

- `extracted_text` com `content_source = storage_visual_ocr`: OCR visual bem-sucedido.
- `pending_visual_ocr`: texto ainda nao extraido por OCR visual.
- `unavailable`: sem arquivo, sem conteudo legivel ou formato nao suportado.

## Risco operacional

OCR visual pode errar caracteres, especialmente em fotos ruins, documentos tortos, carimbos e baixa resolucao. Para documentos que impactam faturamento, divergencia ou contrato, a equipe deve revisar o trecho extraido antes de considerar como evidencia definitiva.

## Proxima evolucao recomendada

Criar etapa de aprovacao humana do texto extraido antes de ativar chunks sensiveis na base do Agent Dute, especialmente contrato, proposta comercial, fatura e documentos com valores.

## Validacao esperada

- Build das Functions sem erro.
- Typecheck e build do frontend sem erro.
- Testes unitarios sem regressao.
- Deploy da Function `extractOperationalDocumentContent`.
- Deploy do Cloud Run.
- `https://app.dutelog.com.br/documentos` retornando HTTP 200.
