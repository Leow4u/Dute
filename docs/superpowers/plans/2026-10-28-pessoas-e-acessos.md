# Pessoas e acessos Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implementar a tabela e os fluxos aprovados, preservando histórico e permitindo novo convite após acesso removido.

**Architecture:** Reutilizar `mutateManagedEntity` para arquivamento e convites e `setUserAccess` para revogação/restauração. Vincular novos convites ao perfil removido no servidor; habilitar somente o login, restaurando o perfil apenas no aceite verificado. Usar os componentes e tokens existentes na tela React.

**Tech Stack:** React, TanStack Query, Radix, Tailwind, Firebase Functions/Auth/Firestore.

**Spec:** `docs/superpowers/specs/2026-10-28-pessoas-e-acessos-design.md`

## Global Constraints

- Preservar UID e histórico; não excluir contas nem dados operacionais.
- Autorização no servidor, sem escalada de admin sobre owner/admin.
- Não publicar nem enviar convites reais.
- Seguir o mockup 1 e os tokens do sistema, incluindo responsividade e modo escuro.

## Review Focus

- Convite antigo, cancelado ou para outro e-mail não restaura acesso.
- Perfil ativo não pode ser removido da lista nem alterado por convite.
- Reenvio e falha de Auth devem ser retomáveis sem duplicar efeitos.
- Reconvite de owner/admin exige owner, inclusive quando o novo papel é menos privilegiado.
- Busca, abas, vazios, falhas de leitura e menus devem continuar acessíveis no celular.

### Task 1: Remoção e reconvite no servidor

**Files:** `functions/wms/src/domain/user-directory.ts`, `user-directory.integration.test.ts`, `invite-acceptance.ts`, `invite-acceptance.integration.test.ts`, `access.ts`, `index.ts`, `package.json`.

**Interfaces:** `readReinvitedUser(transaction, db, email, actor)` valida o perfil atual; `enableReinvitedLoginFor(db, auth, token)` habilita o login de um convite ainda válido; `userDirectoryArchivePayload(id, before, actor)` valida a remoção e produz os campos privados de ocultação.

- [x] Testar e observar falha: arquivo de perfil inativo, permissões, perfil ativo/protegido, reconvite vinculado, falha e repetição no Auth, aceite do convite atual e recusa de antigos.
- [x] Implementar os auxiliares e integrá-los às transações existentes. Limpar a ocultação/reconvite no aceite/restauração explícita.
- [x] Rodar testes de domínio e callables com emulador e suíte unitária do WMS.

### Task 2: Tela aprovada e integração

**Files:** `artifacts/app/src/pages/users.tsx`, `users-convite.test.tsx`, `artifacts/app/src/lib/functions-api.ts`, `functions-api.test.ts`.

**Interfaces:** POST `/api/billing/users/:id/archive` vai para `mutateManagedEntity`, users/archive; criação e reenvio continuam pelas rotas existentes.

- [x] Testar e observar falha: separação de arquivados, busca/filtro, ajuda, confirmação de reenvio, remoção confirmada, falhas e reconvite preenchido.
- [x] Implementar a tabela ampla, abas Pessoas/Arquivados, ajuda e diálogos; ocultar perfis removidos da lista e mostrar o reenvio direto na linha.
- [x] Rodar a suíte do frontend e o typecheck.

### Task 3: Validação visual e revisão

- [x] Build do app e WMS; validar no Chromium desktop e celular com dados de teste, sem acesso à produção.
- [x] Comparar com o mockup aprovado, testar os fluxos, buscar erros de console, overflow e acessibilidade.
- [x] Revisão independente do diff; corrigir problemas importantes e repetir os testes afetados.


## Verificação em 28/10/2026

- Frontend completo: 252 arquivos, 2.898 testes aprovados. Após o ajuste de largura/contraste: 84 testes relevantes aprovados.
- WMS: 167 testes de integração aprovados (domínio, callables, matriz de papéis, aceite, reconvite e retenção).
- Typecheck do workspace e build de produção do frontend aprovados; build de testes do WMS aprovado.
- Chromium: 1526×876 e 390×844; busca, filtro, ajuda, menus, confirmação/reenvio real pela callable `.run` com emuladores, confirmação/remoção persistida, modo escuro, sem overflow e sem erros de console. Axe WCAG 2.1 A/AA, incluindo contraste, aprovado no conteúdo da tela.
- Revisão independente identificou e corrigiu: autorização do perfil vinculado também no reenvio/cancelamento; recuperação imediata após falha do Auth sem duplicar convite/e-mail. Testes reproduziram as falhas antes das correções.
- Suíte unitária do WMS: 287/288 aprovados. Falha independente no teste `o Genkit do WMS (Agent Dute, leitura de NF e de documento) pede na multirregião us`, em `domain/vertex-location.test.ts`: biblioteca retorna `us-aiplatform.googleapis.com`, teste espera `aiplatform.us.rep.googleapis.com`. Os arquivos desse domínio e os lockfiles não foram alterados.
- Sem publicação, envio real de e-mail ou alteração em contas reais. Os testes usam exclusivamente emuladores e fixtures.
