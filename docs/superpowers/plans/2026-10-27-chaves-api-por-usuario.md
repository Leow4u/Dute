# Chaves pessoais de API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for core integration; bounded implementation delegation and independent final review. Track steps with `- [ ]`.

**Goal:** Chaves pessoais por usuário, herdando a autorização atual da conta e mantendo chaves legadas restritas.
**Architecture:** Gestão humana própria em `/api-keys`, principal portátil revalidado em cada chamada e política por rota/registro; serviços de domínio e gateway existentes. UI em diálogo/tabela com permissões retornadas pelo servidor.
**Tech Stack:** TypeScript, React, Firebase Functions/Firestore, node:test, Vitest, Chromium.
**Spec:** docs/superpowers/specs/2026-10-27-chaves-api-por-usuario-design.md

## Global Constraints

- Acesso total é limitado às rotas implementadas e às permissões atuais do usuário.
- Chaves existentes conservam exatamente seu modelo, clientes e política; nenhuma migração amplia acesso.
- Sem chave real, IAM, acesso a dados reais, merge ou deploy nesta implementação. O artefato de entrega é novo PR draft.
- Preservar limite atual 1–90 dias; token mostrado uma única vez, hash no servidor.

## Review Focus

- Usuário tenta gerenciar a chave de outro: lista isolada e get/delete negados, inclusive por API key.
- Papel, bloqueio, cliente ou contrato muda após criar: próxima chamada aplica a nova restrição.
- Escopo agregado cobre ações diferentes: cada rota confere restrições reais (decisão WMS, RH, campo, financeiro).
- Cliente tenta ler documentos internos ou outro tenant: usar projeção/serviço do portal e validar relações antes de efeitos.
- Alteração pessoal afeta legado: ausência de discriminante mantém autorização original e testes antigos.

### Task 1: Principal portátil e política

Files: criar `functions/api-shared/principal.ts`, alterar `core.ts`, `handler.ts`, testes `functions/operacao/src/api/personal.test.ts` e `personal.integration.test.ts`, scripts do pacote.
Interfaces: `PersonalPermission = full|read_only|custom`; `PersonalPrincipal { uid,role,customer_code?,modules? }`; `loadPersonalPrincipal(db,uid)`, `personalCapabilities(principal)`, `authorizePersonalRoute(principal,method,path,body?)`; `ApiIntegration` discrimina pessoal e inclui principal/capacidade de cliente. Nomes definitivos devem ser mantidos consistentes em todas as tarefas.
- [ ] Escrever RED: matriz de papéis, full/read_only/custom, portal desativado/contrato, papel desconhecido, cliente alterado, titular bloqueado, legado inalterado.
- [ ] Implementar resolução e interseção; revalidar a cada chamada, limitar rotas agregadas e atualizar último uso sem salvar segredo.
- [ ] Rodar unitários/integrados focados e confirmar GREEN; registrar comando/resultado e commit.

### Task 2: Gestão pessoal e Operação

Files: `functions/operacao/src/api/{personal-keys.ts,auth.ts,handler.ts,resources.ts,openapi.ts}`, novos testes de gestão.
Contrato: `GET /api-keys/capabilities` → `{data:{scopes:string[],role:string,customer_code?:string,customer_access:'all'|'own'|'none'}}`; POST `/api-keys` `{name,permission,scopes?:string[],expires_in_days?:number}` → mesmo `{data:{id,token,expires_at}}`; GET → `{data:PersonalKeyRow[],next_cursor}` com id/name/token_prefix/permission/scopes/created_at/expires_at/last_used_at/revoked/kind; DELETE `/api-keys/{id}` só titular.
- [ ] Escrever RED gestão por usuário, IDOR, corpo/permissão inválidos, token só na criação, criar com nenhum endpoint disponível, legado listado com identificação original.
- [ ] Implementar sem reutilizar guard owner/admin da gestão legada; escopos reais e identidade do titular conferidos no servidor.
- [ ] Operação aplica autorização por recurso e, quando aplicável, registro/escala/projeção do cliente; consulta pessoal pode omitir cliente mantendo paginação limitada.
- [ ] Rodar GREEN gestão+Operação e suíte existente; atualizar OpenAPI, commit.

### Task 3: Adaptadores por módulo

Files: `functions/{wms,comercial,financeiro,rh,core}/src/api/module.ts`, testes de cada adaptador, contratos/manifests se descrição mudar.
Interfaces: consumir `ApiIntegration` com principal/capacidade de cliente; manter APIs legadas intactas e domínio idempotente.
- [ ] RED para papéis próprios e negados, ações especiais de escopo agregado, trocas de cliente e projeções seguras do portal.
- [ ] Implementar autorização por rota; leituras pessoais paginadas sem seleção de cliente quando a conta abrange todos; cliente só própria projeção e ações já permitidas pelo app.
- [ ] Preservar autoria da integração no Agent Dute e regras de RH; nunca atribuir papel privilegiado para contornar uma recusa.
- [ ] GREEN dos módulos e commit; inventário honesto dos perfis/rotas disponíveis.

### Task 4: Interface Chaves de API

Files: `artifacts/app/src/pages/settings-integrations*`, `components/integracoes/*`, `lib/integracoes/*`, `lib/settings-nav*`, `lib/modules.ts`, documentação de uso.
Interfaces: endpoint pessoal da Task 2; página no caminho existente `/configuracoes/integracoes`, item Chaves de API em Sua conta acessível a todos os papéis ativos. Permissões de criação vindas de capabilities; nunca enviar customers. Lista própria com busca/filtro, token_prefix mascarado, último uso e revogação; segredo só no diálogo temporário.
- [ ] RED UI criar/cancelar/erro/duplicação/full/leitura/custom, ausência de seleção de cliente, conta comum, cache/clipboard, revogação, legado.
- [ ] Implementar tabela desktop/cartões mobile e diálogo curto inspirado na referência Resend dentro do shell Dute. Nome e permissão obrigatórios; validade padrão 90 dias.
- [ ] GREEN Vitest/typecheck/build, conferir no Chromium desktop/mobile com mocks, registrar evidências e commit.

### Task 5: Validação e entrega

Files: documentação `docs/api*.md`, registro de validação e plano/ledger.
- [ ] Atualizar OpenAPI, exemplos e limites do modelo pessoal; manter documentação legada.
- [ ] Executar checks completos: seis suítes unit/integration/typecheck, frontend completo/typecheck/build, Python, índices e empacotamento.
- [ ] Revisão independente do diff, corrigir achados relevantes com testes, registrar resultados exatos.
- [ ] Push de branch própria, PR novo em draft e anexo; acompanhar CI. Sem novo merge/deploy.
