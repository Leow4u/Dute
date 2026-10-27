# API de todos os módulos — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Tasks are independent after the shared adapter interface. Track with `- [x]`.

**Goal:** API externa por escopo com leitura/criação/alteração nos seis módulos.
**Architecture:** Gateway público existente; adaptadores HTTP autenticados por chave em cada codebase, usando serviços de domínio locais. Kernel portátil gerado no build de cada pacote; sem importar fonte de outra pasta no artefato de deploy. Cada adaptador valida a chave, delegante, escopo, cliente, política e recibo; o gateway encaminha apenas a destinos fixos do próprio projeto.
**Tech Stack:** TypeScript, Firebase Functions/Firestore, node:test, Vitest, React.
**Spec:** docs/superpowers/specs/2026-10-26-api-todos-modulos-design.md

## Global Constraints

- Novas chaves da UI: `write_policy: scoped`; campo omitido e chaves antigas: `approval_required`; valor desconhecido recusado.
- Não ampliar chaves existentes; não criar perfis administrativos para integrações.
- Sem escrita genérica no banco: usar serviços de domínio e eventos existentes.
- Sem credenciais reais, alterações reais de IAM, merge ou deploy. PR novo em draft.
- Não anunciar recursos sem endpoint funcional. Documentar implementados, fora da primeira versão e bloqueados.

## Review Focus

- Alvos ligados a outro cliente, inclusive IDs de filhos e alterações de customer_code, são recusados antes de qualquer efeito.
- RH usa o banco `dute-rh` e escopos próprios; valores financeiros só aparecem em seus escopos.
- Mesmo Idempotency-Key não duplica efeitos; conteúdo diferente conflita, concorrência tem apenas um executor.
- Recibo ambíguo após falha deve falhar fechado e indicar recuperação, nunca executar cegamente outra vez.
- Aprovação legada é ligada a método/caminho/corpo/chave/alvo; chaves globais não exigem cliente fictício.

### Task 1: Kernel e gateway (root)

Files: `functions/api-shared/{core.ts,permissions.ts}`, `tools/sync_api_shared.mjs`, scripts dos seis pacotes, API existente da Operação, `lib/dominio`.
Interface: `ModuleDefinition`/`ModuleRoute` em `core.ts`; `createModuleHandler(db, project, verify, definition)`, `httpModuleHandler`, `readPage`, `requireCustomer`, `requireScope`. Código gerado em `functions/<pacote>/src/api/shared`, compilado e incluído no deploy; `gcp-build` vazio porque os artefatos já são produzidos pelo predeploy. Manifests de endpoints são JSON por módulo, agregados ao OpenAPI pelo build.

- [x] Testar políticas scoped/legado, delegante removido, permissões, clientes, recibos, concorrência e PATCH/global approvals.
- [x] Implementar kernel, sincronização de build e roteamento fixo sem dupla contagem de rate limit.
- [x] Preservar e testar as rotas e aprovações antigas da Operação.

### Task 2: Comercial

Files: `functions/comercial/src/api/{module.ts,routes.json,*.test.ts}` e entrada HTTP do pacote.
Interface: export `comercialApi: ModuleDefinition`; actor role comercial, tenant por customer_code. Ler clientes/contratos/orçamentos/medições e criar/alterar por funções de cadastro, contratos, quotes e medições.
- [x] Inventariar operações e fechar routes.json com escopos e schemas reais.
- [x] Testes RED → serviços existentes → GREEN; nunca aprovar como owner pela chave.

### Task 3: Armazenagem

Files: `functions/wms/src/api/{module.ts,routes.json,*.test.ts}` e entrada HTTP do pacote.
Interface: export `armazenagemApi: ModuleDefinition`; actor role wms, customer_code exigido por registro. Reutilizar operações transacionais de pedidos, recebimentos e movimentações. Catálogo/posições só terão escrita se houver serviço reutilizável com validação equivalente.
- [x] Leituras projetadas de catálogo/estoque/pedidos/recebimentos/movimentações.
- [x] Criar/alterar pelos serviços, testando saldo, isolamento, repetição e eventos.

### Task 4: Financeiro

Files: `functions/financeiro/src/api/{module.ts,routes.json,*.test.ts}` e entrada HTTP.
Interface: export `financeiroApi: ModuleDefinition`; actor financeiro. Ler a faturar/faturas/pagamentos e criar NF registrada fora do sistema/atualizar cobrança/registrar pagamento com os serviços existentes. Sem emitir NF na Omie nem executar operação bancária externa; estornos/cancelamentos ficam fora desta versão.
- [x] Projeções com campos financeiros explícitos; tenant antes de gravar.
- [x] Testar fatura/pagamento idempotente, edição e rejeição de outro cliente.

### Task 5: RH

Files: `functions/rh/src/api/{module.ts,routes.json,*.test.ts}` e entrada HTTP.
Interface: export `rhApi: ModuleDefinition`; actor técnico rh somente após escopo validado; banco separado. Ler colaboradores/registros/vínculos, gravar registros/vínculos com serviços existentes; dados pessoais/documentos separados por escopo. Upload/exportação só se houver fluxo seguro e testado; caso contrário explicitamente pendente.
- [x] Testar criação/alteração, banco correto e proteção de dados pessoais.

### Task 6: Agent Dute

Files: `functions/core/src/api/{module.ts,routes.json,*.test.ts}` e entrada HTTP.
Interface: export `agenteApi: ModuleDefinition`; identidade api:<id> isolada das conversas/rotinas humanas. Ler e criar/alterar playbooks e rotinas pelos serviços existentes. Conversa/modelos, execução de rotinas e anexos só entram se preservarem isolamento, prazo e custo; registrar bloqueios concretos.
- [x] Testar domínio, autoria, isolamento por integração/cliente e repetição.

### Task 7: Interface, documentação e validação final (root)

Files: `artifacts/app/src/lib/integracoes/*`, componentes/tela/testes, `docs/api.md`, inventário de cobertura.
- [x] Agrupar permissões por módulo; nova chave envia política scoped explicitamente; chave global não exige cliente fictício e código futuro de cliente pode ser autorizado explicitamente.
- [x] OpenAPI consistente com endpoints reais, exemplos por recurso e política legada; nunca só checkboxes.
- [x] Unitários de todos os pacotes, integrações da API no emulador, trilhas existentes aplicáveis de WMS/Financeiro/RH, suíte frontend completa, typecheck/build e revisão independente.
- [x] Criar PR draft com resultados exatos e pendências; não fazer merge/deploy sem autorização específica. PR #517: https://github.com/Leow4u/Dute/pull/517
