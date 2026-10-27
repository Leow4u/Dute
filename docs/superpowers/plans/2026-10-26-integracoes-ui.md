# Integrações UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Gerar e revogar chaves de integração pela Configuração do owner/admin.

**Architecture:** Preservar o shell existente. Cliente REST usa o ID token Firebase humano, nunca cacheia a chave, e consome a API de Operação. Acrescentar GET de metadados com paginação no servidor.

**Tech Stack:** React, TypeScript, TanStack Query, Firebase Functions/Firestore, Vitest e node:test.

**Spec:** docs/superpowers/specs/2026-10-26-integracoes-ui-design.md

## Global Constraints

- Identidade do Dute e componentes existentes, sem dependências novas.
- Somente owner/admin, quatro permissões da Operação, 1 a 90 dias.
- Token apenas em estado transitório: sem storage, URL, logs ou cache de query/mutation.
- Não publicar em produção nem gerar credenciais reais durante testes.

## Review Focus

- Listagem não revela token/hash e inclui expiradas/revogadas.
- Credenciais humanas obrigatórias até para listagem; paginação limitada e validada.
- Cancelamento, duplo envio e falha de rede não criam chaves involuntariamente.
- Falha no clipboard preserva a chave para cópia manual; concluir descarta o segredo.
- Perfil sem permissão não vê a página; layout funciona no celular.

### Task 1: Gestão pelo navegador

Files: functions/operacao/src/api/{auth,handler,openapi,api.integration.test,api.test}.ts; functions/operacao/src/index.ts.

Interfaces: GET /api/v1/integrations → {data: metadados[], next_cursor}; nunca token_hash, rate counters ou token. CORS por projeto, sem abrir outros ambientes.

- [x] Adicionar testes de listagem/paginação/autorização e CORS, executar e observar falha.
- [x] Implementar projeção limitada e documentar GET no OpenAPI.
- [x] Rodar unitários e integração da API no emulador.

### Task 2: Cliente e acesso à página

Files: artifacts/app/src/lib/integracoes/{api,model}.ts e testes; lib/{settings-nav,modules}.ts e testes; App.tsx.

Interfaces: listarIntegracoes(cursor?), criarIntegracao(input), revogarIntegracao(id), com token humano obtido por chamada. Modelo valida nome/clientes/escopos/validade.

- [x] Testar token humano, URL por ambiente, erro, sem repetição automática e validação do formulário.
- [x] Implementar cliente e navegação/rotas somente owner/admin.
- [x] Rodar testes focados.

### Task 3: Fluxo aprovado

Files: artifacts/app/src/pages/settings-integrations.tsx e componentes/testes próximos; docs/api.md.

Interfaces: lista com carregar mais e revogação; formulário em página; sucesso com token efêmero e copiar.

- [x] Testar criação, impedir duplo envio, falhas, cópia e descarte do token, revogação confirmada e acessibilidade.
- [x] Implementar formulário seguindo a primeira imagem, mantendo shell Dute.
- [x] Rodar testes do frontend, typecheck, build e conferir renderização desktop/celular com dados fictícios.
- [x] Rever diff completo e registrar validação e limitações.

## Registro de execução

- Base atualizada por fast-forward para `origin/main` (`39c39ca`), sem substituir mudanças locais. Trabalho preservado na branch `work`.
- Formulário em página aprovado; preservados o shell Dute e as permissões reais. Identidade v3 aplicada apenas nesta seção.
- RED: testes de cliente/modelo/tela falharam antes dos módulos existirem; teste CORS falhou antes de `browser.ts`; navegação falhou sem a seção.
- GREEN: suíte frontend completa (248 arquivos, 2839 testes), teste adicional de falha de rede (5 testes do cliente), 220 unitários da Operação e 14 testes da API no emulador. Typecheck e build passaram.
- Chromium: desktop 1440 × 1024, celular 390 × 844; criar/copy/concluir/revogar com dados fictícios; sem overflow horizontal ou exceções JavaScript. Recurso externo de fontes bloqueado pela rede local, com fallback legível.
- Revisão independente: sem achados de correção ou segurança. QA visual registrado em `design-qa.md`.
- Nenhuma credencial real foi criada. Alterações locais, sem push, merge ou publicação em produção.
