# Fase 14 - Governanca da base de conhecimento do Agent Dute

## Objetivo

Impedir que documentos sensiveis ou conteudo extraido por OCR visual sejam usados pelo Agent Dute sem validacao humana.

## O que mudou

- A extracao de documentos continua criando `ai_agent_knowledge` e `ai_agent_knowledge_chunks`.
- Contratos, propostas, faturas, LPU, imagens e OCR visual entram como `pending_approval`.
- O Agent Dute continua consultando somente conhecimento com `status == active`.
- A tela de Documentos mostra pendencias e permite aprovar ou rejeitar a knowledge.
- Aprovar libera o documento para consulta pelo Agent Dute.
- Rejeitar bloqueia o uso pelo Agent Dute, preservando auditoria e arquivo.

## Funcoes

- `extractOperationalDocumentContent`
  - Extrai texto, parser ou OCR.
  - Classifica se exige aprovacao humana.
  - Grava chunks como `active` ou `pending_approval`.

- `approveDocumentKnowledge`
  - Acao `approve`: muda knowledge e chunks para `active`.
  - Acao `reject`: muda knowledge e chunks para `rejected`.
  - Atualiza documento, projecao do portal, evento operacional e operacao idempotente.

## Regras de aprovacao

Exigem aprovacao:

- `document_type`: contrato, proposta, fatura, financeiro, billing, LPU.
- OCR visual.
- Arquivos de imagem.
- Titulo/nome do arquivo contendo contrato, proposta, fatura ou LPU.

## Validacao

Executado em 2026-07-11:

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

Observacao: o build frontend manteve avisos antigos de sourcemap e chunk grande, sem falha.

## Resultado esperado

Documentos sensiveis deixam de virar verdade operacional automaticamente. A base do Agent Dute passa a ter etapa explicita de governanca, reduzindo risco de OCR errado, valor contratual incorreto ou documento financeiro ainda nao conferido.
