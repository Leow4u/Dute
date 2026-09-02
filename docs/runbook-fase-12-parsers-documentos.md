# Fase 12 - Parsers de documentos para Knowledge

## Objetivo

Avancar a fase 11 para ler conteudo real de anexos operacionais, reduzindo a dependencia de metadados antes de alimentar o Agent Dute.

## Formatos suportados nesta fase

- TXT, CSV, JSON, XML e Markdown.
- PDF com camada de texto.
- XLS, XLSX e XLSM.
- DOCX.

## Formatos que continuam pendentes

- Imagens e fotos.
- PDF escaneado sem camada de texto.
- Formatos binarios sem parser especifico.

Esses casos recebem `content_extraction_status = pending_visual_ocr` e nao sao tratados como conteudo lido.

## Fluxo operacional

1. Usuario interno anexa ou registra documento em Documentos.
2. Usuario clica em `Conhecimento`.
3. A Cloud Function `extractOperationalDocumentContent` baixa o arquivo do Storage.
4. O parser tenta extrair texto de forma deterministica.
5. Se houver texto, a Function grava:
   - `documents.content_extraction_status = extracted_text`
   - `documents.content_source`
   - `documents.content_excerpt`
   - `ai_agent_knowledge`
   - `ai_agent_knowledge_chunks`
   - evento `document.content_extracted`
6. Se depender de OCR visual, a Function grava:
   - `documents.content_extraction_status = pending_visual_ocr`
   - evento `document.content_extraction_pending`

## Limites

- Arquivos acima de 25 MB nao sao processados pelo parser server-side.
- Planilhas processam ate 12 abas e ate 1.500 linhas por aba.
- Chunks enviados ao Knowledge sao limitados para evitar excesso de custo e leitura ruidosa.

## Proxima evolucao

Criar a fase de OCR visual com Google Document AI, Cloud Vision ou Gemini multimodal. Essa decisao deve considerar custo, permissao de dados e necessidade de processadores por tipo de documento.

## Validacao esperada

- Build das Functions sem erro.
- Typecheck e build do frontend sem erro.
- Testes unitarios das Functions sem regressao.
- Deploy da Function `extractOperationalDocumentContent`.
- Deploy do Cloud Run.
- `https://app.dutelog.com.br/documentos` retornando HTTP 200.
