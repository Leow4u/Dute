# Auditoria de Codigo - Dute / BTG Inventory

**Data:** 24/07/2026 | **Branch:** codex/ai-native-foundation

Auditoria multi-agente em 10 dimensoes (seguranca, correcao, performance, arquitetura, dependencias, testes). Todos os achados de severidade critica/alta passaram por verificacao adversarial independente (um segundo agente tentou refutar cada um lendo o codigo); 2 achados foram refutados e removidos. Total: **70 achados confirmados** (1 critico, 16 altos, 39 medios, 14 baixos).

As descricoes detalhadas estao em ingles (saida dos agentes de auditoria); os titulos de secao e o sumario estao em portugues.

## Sumario por severidade

### CRITICO (1)

- **Every list/read endpoint does a full Firestore collection scan; limit/offset applied only in memory** — `artifacts/btg-inventory/src/pages/movements.tsx:671`

### ALTO (16)

- **mutateManagedEntity grants wms/financeiro document powers that firestore.rules deliberately deny, bypassing tenant-isolation invariants via the Admin SDK** — `functions/src/index.ts:3567`
- **Vulnerable xlsx@0.18.5 used to parse user-uploaded spreadsheets in Cloud Functions runtime** — `functions/src/index.ts:1054`
- **Rejecting an outbound customer request never releases the stock it reserved** — `functions/src/domain/operations.ts:3872`
- **Cycle count with zero divergence overwrites the per-SKU client projection with single-location numbers** — `functions/src/domain/operations.ts:1891`
- **skus/products stock aggregates (estoque_atual, estoque_disponivel, estoque_btg, custo_total) permanently diverge from the ledger** — `functions/src/domain/operations.ts:5392`
- **Ad valorem is billed on live inventory value at emission time, not the competencia's inventory** — `functions/src/index.ts:3023`
- **Line checklist renders only first 8/12 rows but the advance gate requires ALL rows confirmed — large tasks can never advance** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:2400`
- **Critical ledger mutations only reach Cloud Functions if a build-time env var is set; the client fallback is denied by Firestore rules** — `artifacts/btg-inventory/src/lib/functions-api.ts:564`
- **Every API read does unbounded full-collection getDocs; limit/offset/search applied in memory after download** — `artifacts/btg-inventory/src/lib/cloud-api.ts:671`
- **RealtimeSyncBridge opens ~38 unfiltered whole-collection listeners and invalidates ALL react-query caches on any change** — `artifacts/btg-inventory/src/lib/realtime-sync.tsx:175`
- **ai-control polls five endpoints every 30s, each doing unbounded full-collection Firestore reads in the browser** — `artifacts/btg-inventory/src/pages/ai-control.tsx:1852`
- **Dashboard and WMS pages poll scan-heavy endpoints every 30s (~30 full collection scans per tick per tab)** — `artifacts/btg-inventory/src/pages/dashboard.tsx:295`
- **RealtimeSyncBridge opens ~40 unbounded onSnapshot listeners and invalidates the ENTIRE react-query cache on any change** — `artifacts/btg-inventory/src/lib/realtime-sync.tsx:175`
- **No code splitting: 8,400-line warehouse-ops and all other pages are statically imported into one entry bundle** — `artifacts/btg-inventory/src/App.tsx:28`
- **Cloud Functions cold start loads mammoth, pdf-parse, xlsx and Genkit/VertexAI for all ~35 callables** — `functions/src/index.ts:17`
- **Cloud Functions deploy ships no lockfile — production dependencies resolved fresh by npm at build time, bypassing the workspace's supply-chain quarantine** — `functions/package.json:18`

### MEDIO (39)

- **Storage rules grant every internal role full read/write/DELETE over all tenants' files (no scoping, over-broad wildcards)** — `storage.rules:33`
- **Archiving/deleting a document does not revoke client access: client_documents read has no visibility gate and retains a permanent download token** — `firestore.rules:850`
- **Prompt injection: attacker-controlled document text auto-activates as agent knowledge and is injected verbatim into the client-facing Agent Dute prompt** — `functions/src/index.ts:4760`
- **Unauthenticated lookupInvite plus predictable Date.now() invite-ID fallback enables invite enumeration/PII disclosure** — `functions/src/index.ts:3530`
- **Partial inbound conference overwrites receipt header totals with subset sums** — `functions/src/domain/operations.ts:3699`
- **Missing customer_code silently falls back to the hardcoded tenant "BTG Pactual"** — `functions/src/domain/operations.ts:4558`
- **advanceWarehouseTask without expected_status can silently execute two transitions on a double-submit** — `functions/src/domain/operations.ts:4519`
- **Movement usage is attributed to competencias by UTC date while the billing domain is defined in America/Sao_Paulo** — `functions/src/index.ts:3030`
- **Unknown or unfed auto_source silently bills quantity 0 — pallet/transporte/etiquetagem lines always emit as R$0** — `functions/src/billing.ts:653`
- **The current (incomplete) month can be emitted at any time, and emission is irreversible by design** — `functions/src/billing.ts:728`
- **Pre-cutover movement classification can count the same movement as both entrada and saida** — `functions/src/index.ts:3052`
- **Invoice emission transaction reads the customer's entire movement history on every call** — `functions/src/index.ts:2978`
- **Manual quantities are silently dropped when the referenced LPU item is archived or missing** — `functions/src/billing.ts:636`
- **lineConfirmations map is never invalidated — stale local marks override fresh server state indefinitely** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:1082`
- **Exception dialog and detail panel silently retarget to a different task when polled data changes** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:8040`
- **Photo-upload race in UnplannedReceiptDialog: async updates target lines by captured index while lines can be removed (list also keyed by index)** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4104`
- **Product catalog (2x 5000-row endpoints) fetched under four separate query keys and scanned O(lines x 10k) on every keystroke** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4208`
- **8,440-line monolith with two divergent advance paths; concrete extraction boundaries** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:1`
- **Client-side ledger fallback is non-transactional and silently clamps stock discrepancies to zero** — `artifacts/btg-inventory/src/lib/cloud-api.ts:3250`
- **onAuthStateChanged race: stale signed-in state and leaked profile onSnapshot listener** — `artifacts/btg-inventory/src/lib/auth.tsx:141`
- **callFunctionsApi flattens every backend error to HTTP 500, discarding HttpsError codes** — `artifacts/btg-inventory/src/lib/functions-api.ts:609`
- **Date.now() used as Firestore document ID for movements, products and generic creates — same-millisecond writes silently overwrite each other** — `artifacts/btg-inventory/src/lib/cloud-api.ts:966`
- **ai-control 'Sincronizar dados reais' action cannot succeed in any configuration; its fallback is an unguarded browser bulk-write of core inventory collections** — `artifacts/btg-inventory/src/pages/ai-control.tsx:1934`
- **Hardcoded 'BTG Pactual' tenant attribution in ai-control writes breaks multi-tenant event integrity** — `artifacts/btg-inventory/src/pages/ai-control.tsx:1904`
- **Estoque 'Arquivar' is client-local state that vanishes on reload, and the generated request is invisible in every portal list** — `artifacts/btg-inventory/src/pages/client/estoque.tsx:137`
- **Pedidos page displays closed/encerrado orders as 'Recebido' — status label map contradicts its own status sets** — `artifacts/btg-inventory/src/pages/client/pedidos.tsx:1233`
- **Every CRUD write is amplified into 4+ sequential reads and up to 5 writes via event/agent-memory bookkeeping** — `artifacts/btg-inventory/src/lib/cloud-api.ts:787`
- **Warehouse receiving/inventory forms download the full SKU + product catalogs (limit=5000) and refetch them on every invalidation** — `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4753`
- **Mutation success handlers call queryClient.invalidateQueries() with no filter, refetching every active scan-backed query** — `artifacts/btg-inventory/src/pages/movements.tsx:376`
- **xlsx@0.18.5 with unpatched prototype-pollution and ReDoS CVEs parses user-uploaded spreadsheets in Cloud Functions** — `functions/package.json:25`
- **nginx serves the production app with no security headers (no HSTS, X-Content-Type-Options, frame-ancestors/CSP, Referrer-Policy)** — `deploy/cloud-run/nginx.conf:26`
- **No gzip/brotli compression configured — SPA bundles served uncompressed from Cloud Run** — `deploy/cloud-run/nginx.conf:8`
- **No CI or quality gate anywhere: existing test suites are never executed automatically** — `firebase.json:5`
- **Entire callable authorization layer (RBAC + Zod boundary) has zero test coverage — integration tests bypass it** — `functions/src/domain/operations.integration.test.ts:25`
- **Rules tests skip the self-service user-creation/invite chain — the highest-risk rules in the file** — `functions/src/firestore.rules.test.ts:233`
- **Billing money flow untested at emulator level — billing.test.ts mocks the transaction, and the callables' Firestore orchestration is uncovered** — `functions/src/index.ts:5892`
- **Ledger-mutating paths with no coverage: putaway stock transfers and customer-request rejection** — `functions/src/domain/operations.ts:5130`
- **Frontend: ~33k lines, zero tests, no test runner, no ESLint — only an unenforced tsc typecheck** — `artifacts/btg-inventory/package.json:6`
- **Client-writable rules surfaces and most cross-tenant projections untested (8 of ~56 collections covered)** — `functions/src/firestore.rules.test.ts:247`

### BAIXO (14)

- **~260 lines of unreferenced, more-permissive rule helpers (incl. customer-authored events and WMS/coordinator write grants) are dead code** — `firestore.rules:311`
- **Invite acceptance and profile creation do not require a verified email; unauthenticated lookupInvite discloses invitee email/role/customer_code** — `firestore.rules:220`
- **No Firebase App Check enforced on any callable (including the unauthenticated lookupInvite)** — `functions/src/index.ts:2737`
- **Outbound webhook bearer token read from plain process.env instead of Secret Manager** — `functions/src/index.ts:1456`
- **Quantities are never validated as integers and money aggregates accumulate float drift** — `functions/src/domain/operations.ts:704`
- **Audit note: core transactional invariants that ARE well-enforced** — `functions/src/domain/operations.ts:498`
- **Key failure branches of billing.ts are untested: competencia mismatch, corrupt snapshot, pago-period emission, ad valorem fallback** — `functions/src/billing.test.ts:1`
- **fetchJson duplicated in 8 pages with divergent error parsing** — `artifacts/btg-inventory/src/pages/customer-requests.tsx:242`
- **Legacy portal redirect routes are gated as internal-only, bouncing clients to '/' instead of redirecting** — `artifacts/btg-inventory/src/lib/modules.ts:793`
- **ai-control silently swallows failures: notifications fetch errors render as 'Nenhuma mensagem pendente' and resolveInsight has no error handler** — `artifacts/btg-inventory/src/pages/ai-control.tsx:1516`
- **agente-operacional.tsx is an unrouted dead page still shipped in the client bundle** — `artifacts/btg-inventory/src/pages/client/agente-operacional.tsx:32`
- **Vite dev server disables host-header protection (allowedHosts: true) while listening on 0.0.0.0** — `artifacts/btg-inventory/vite.config.ts:90`
- **Unignored stray files at repo root and production PII exports in the working tree** — `.gitignore:34`
- **storage.rules has zero tests and the integration harness only starts the Firestore emulator** — `storage.rules:33`

---

## Achados detalhados

### 1. [CRITICO] Every list/read endpoint does a full Firestore collection scan; limit/offset applied only in memory

**Arquivo:** `artifacts/btg-inventory/src/pages/movements.tsx:671` | **Dimensao:** Performance

All GET routes in the client-side API shim (cloud-api.ts) are backed by readAll(), which calls getDocs(collection(...)) with no limit(), no where(), no orderBy(). filterAndPage() then filters, sorts and slices the full result set in browser memory — the ?limit= and ?offset= params only slice AFTER the entire collection was downloaded and billed. This hits the append-only ledgers hardest: the Movements page (movements.tsx line 77 'const limit = 50') downloads the ENTIRE movements collection, sorts it all in JS (cloud-api.ts 4618-4621), and shows 50 rows. Same for getDashboard() (4 full scans including all movements to render 10 recent rows, lines 1079-1084), getClientOverview() (9 full scans for internal users, lines 1264-1272), and /api/reports/export (line 4640). Cost and latency grow linearly and unboundedly with operational history — a movements ledger of 100k docs means 100k billed reads per page view of a 50-row table. Ironically, firestore.indexes.json defines composite indexes (customer_code+created_at on customer_requests, cod_cliente+data_solic on orders, etc.) that this code never uses because it never sends a filtered/ordered query.

**Evidencia:**

```
cloud-api.ts:671-675:
async function readAll(name: string): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const snapshot = await getDocs(collection(firestore, name));
  return snapshot.docs.map(normalizeDoc);
}

cloud-api.ts:4615-4624 (movements list route):
    if (regex.test(pathname) && method === "GET") {
      const rows = await readAll(name);
      const orderedRows =
        name === collectionNames.movements
          ? rows.sort((a, b) => toIso(b.data).localeCompare(toIso(a.data)))
          : rows;
      return json(filterAndPage(orderedRows, searchParams, filters, searchFields));

cloud-api.ts:750-753 (pagination after the scan):
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? total);
  return { items: result.slice(offset, offset + limit), total };
```

**Correcao sugerida:** Push filters/ordering/limits into Firestore queries: query(collection(db, 'movements'), orderBy('data', 'desc'), limit(50), startAfter(cursor)) using the composite indexes already declared in firestore.indexes.json. For dashboard aggregates (counts, sums) use getCountFromServer/getAggregateFromServer or maintain pre-computed aggregate docs updated by the existing transactional Cloud Functions instead of scanning collections client-side.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path end-to-end; every cited line is accurate and no mitigation exists anywhere in the stack.

1) The cited code is verbatim real. readAll (artifacts/btg-inventory/src/lib/cloud-api.ts:671-675) does `getDocs(collection(firestore, name))` with no where/orderBy/limit. filterAndPage (cloud-api.ts:723-754) filters/sorts and slices `result.slice(offset, offset + limit)` only after the full download. The movements GET route (cloud-api.ts:4615-4624, regex `/^\/api\/movements$/` at 4535) calls readAll then sorts the whole array in JS.

2) This is the production data path, not a dev shim. main.tsx:9 unconditionally calls installCloudApi(), which monkey-patches window.fetch (cloud-api.ts:4863-4907) and intercepts every '/api/*' request in the browser. The generated React client (lib/api-client-react/src/generated/api.ts:1011-1034, useListMovements -> '/api/movements') calls customFetch, which calls global `fetch` (lib/api-client-react/src/custom-fetch.ts:363) — i.e., the patched one. movements.tsx:77 sets limit=50 and passes it as a query param, which is only applied in memory after the scan.

3) Cloud Functions do NOT mitigate GET reads. shouldUseFunctionsApi (functions-api.ts:517-579) allows GETs through only when VITE_API_MODE==='functions' (which .env.example sets), but callFunctionsApi -> functionRoute has exactly ONE GET route in the whole file ('/api/warehouse/opening-inventory/session', functions-api.ts:183-189); every other GET returns null (the 501 fallback at line 589 applies only to non-GET), so cloud-api.ts:4892 falls through to route() -> readAll. So even in 'functions' mode, all list GETs full-scan Firestore from the browser.

4) The other cited scans are real: getDashboard (cloud-api.ts:1078-1084, routed at 4308) awaits readAll on products, skus, movements, and orders to render counts plus 10 recent movements; getClientOverview internal branch (cloud-api.ts:1263-1273, routed at 4322) does 9 readAll scans; /api/reports/export (cloud-api.ts:4630-4641) returns readAll of an entire collection.

5) Firestore rules permit the scan in production: firestore.rules:732-735 allows movements reads for canReadOperations() roles (owner/admin/interno/wms/suporte, rules line 73-75) with no query-size constraint, so the unbounded getDocs succeeds for exactly the internal users who use these pages.

6) The unused-index observation is accurate: firestore.indexes.json defines composite indexes including movements (cod_sku+data DESC, tipo_mov+data DESC — lines 86-101) clearly built for this list view, but readAll never issues a filtered/ordered query.

7) It is actually worse than claimed: realtime-sync.tsx subscribes internal users to an UNFILTERED onSnapshot on the entire movements collection (INTERNAL_OPERATION_COLLECTIONS includes 'movements' at line 52; buildRealtimeQuery line 130 returns the bare collection ref when no filters), and any docChange triggers a blanket `queryClient.invalidateQueries()` (line 175) — refetching ALL active queries, each of which re-runs full collection scans. Every movement written by any warehouse operator therefore triggers repeated whole-ledger downloads across all connected internal sessions. Cost/latency grow linearly and unboundedly with the append-only ledger; at ~100k movement docs each page view bills ~100k reads and transfers tens of MB to render 50 rows. Severity 'critical' is warranted for a production SaaS because this both bills unboundedly and makes core pages progressively unusable as operational history accumulates.

</details>

---

### 2. [ALTO] mutateManagedEntity grants wms/financeiro document powers that firestore.rules deliberately deny, bypassing tenant-isolation invariants via the Admin SDK

**Arquivo:** `functions/src/index.ts:3567` | **Dimensao:** Seguranca - Cloud Functions

The `documents` branch of assertManagedAction only gates on role membership (owner/admin/interno/wms/financeiro) with no field-level or scope restrictions. managedWritePayload for documents (index.ts:3788-3853) then copies customer_code, customer_visible and visibility directly from caller input (all present in DOCUMENT_WRITE_FIELDS, index.ts:3210-3263) and projects the result into client_documents visible to that customer_code (index.ts:4221-4259). Because this callable uses the Admin SDK it bypasses Firestore rules. firestore.rules encodes the opposite invariant: canUpdateDocumentInternally forbids wms from touching customer_visible/visibility/published_at (publicationFieldsUntouched) and from changing customer_code (preservesCustomerCode), and restricts financeiro to billing documents with customer_code preserved. The function therefore lets a wms or financeiro user publish an arbitrary document to any customer portal and reassign its customer_code, enabling cross-tenant exposure the rules were written to prevent.

**Evidencia:**

```
index.ts:3567-3577 documents branch returns after only a role check (no preservesCustomerCode/publicationFieldsUntouched/isBillingDocument). managedWritePayload documents branch: customerCode = String(data.customer_code ?? before.customer_code ?? DEFAULT_CUSTOMER); customerVisible derived from data.customer_visible; visibility set from customerVisible. Contrast firestore.rules:543-557 canUpdateDocumentInternally which requires isWms() && preservesCustomerCode() && publicationFieldsUntouched(), and finance limited to isBillingDocument + preservesCustomerCode.
```

**Correcao sugerida:** In assertManagedAction/managedWritePayload, replicate the rule invariants for the Admin-SDK path: block wms from writing customer_visible/visibility/published_at, forbid customer_code changes on update, and restrict financeiro writes to billing documents only.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the concrete path. db is the firebase-admin Firestore instance (index.ts:54 `const db = getFirestore()`), and mutateManagedEntity (index.ts:4113-4120) writes through it, so Firestore rules do not apply to these writes. The documents branch of assertManagedAction (index.ts:3567-3578) gates only on role membership [owner,admin,interno,wms,financeiro] and action [create,update,archive] — no preservesCustomerCode, publicationFieldsUntouched, or isBillingDocument check. managedWritePayload's documents branch (index.ts:3802-3843) sets customerCode = String(data.customer_code ?? before.customer_code ?? DEFAULT_CUSTOMER), letting caller input override the stored customer_code on update; customerVisible is derived from data.customer_visible and drives visibility='customer', status='published'. Both fields are in DOCUMENT_WRITE_FIELDS (index.ts:3211,3219) so allowedFields keeps them. When customer_visible !== false, the write projects into client_documents/<id> via clientDocumentProjection (index.ts:4221-4238, 4019-4110), which carries the victim document's content (content_excerpt, ai_summary, file_url, storage_path, extracted_fields, etc.) from payload.X ?? before.X, stamped with the attacker-chosen customer_code and customer_visible=true. firestore.rules:851 allows client_documents read if isOwnProjection(), which (rules:109-112) matches any customer whose customer_code equals resource.data.customer_code — so the target tenant reads the reassigned/published document. This is exactly the invariant canUpdateDocumentInternally (rules:543-557) encodes: wms only with preservesCustomerCode() && publicationFieldsUntouched(), finance only on billing documents with customer_code preserved. The Admin-SDK callable enforces none of these (and also lets finance touch non-billing docs), so a wms or financeiro user can publish an internal-only document to a customer portal and reassign its customer_code across tenants. No mitigating check exists on the function path: getProfile (index.ts:1119) does not scope internal roles, and the transaction only checks idempotency/existence/inventory-freeze. Failure scenario: a wms user calls mutateManagedEntity({resource:'documents', action:'update', id:'<existing doc of tenant A>', data:{customer_code:'TENANT_B', customer_visible:true}, idempotency_key:'x'}); tenant B's portal user then reads client_documents/<id> containing tenant A's content. Severity high (not critical) because it requires an authenticated internal wms/financeiro account rather than an anonymous attacker, but it defeats a deliberately-encoded tenant-isolation invariant and exposes cross-tenant document content.

</details>

---

### 3. [ALTO] Vulnerable xlsx@0.18.5 used to parse user-uploaded spreadsheets in Cloud Functions runtime

**Arquivo:** `functions/src/index.ts:1054` | **Dimensao:** Seguranca - Cloud Functions

functions/package.json pins xlsx ^0.18.5, the last npm-published SheetJS build, which carries known Prototype Pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) vulnerabilities and is no longer maintained on npm. extractTextFromDocumentBuffer calls XLSX.read(buffer, {type:'buffer'}) on the raw bytes of user-uploaded documents downloaded from Storage (extractOperationalDocumentContent, index.ts:4691-4699). A crafted .xlsx can pollute Object.prototype in the shared, warm Functions instance, corrupting behavior of subsequent requests/tenants handled by that instance, or cause CPU exhaustion (DoS). Internal roles (interno/wms/financeiro) can upload spreadsheet content-types (createDocumentUploadTarget allows spreadsheet/excel/officedocument, index.ts:4418-4425), so an authenticated internal user or a supply-chain/malicious file triggers parsing.

**Evidencia:**

```
functions/package.json:25 "xlsx": "^0.18.5". index.ts:1054-1055 const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true }); operating on bytes from bucket.file(storagePath).download() at index.ts:4692.
```

**Correcao sugerida:** Replace the npm xlsx with the maintained SheetJS CDN build (or a patched fork) that fixes CVE-2023-30533/CVE-2024-22363, and consider parsing untrusted files in an isolated worker with resource limits.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by reading the code. functions/package.json:25 pins "xlsx": "^0.18.5" and pnpm-lock.yaml:285-287/5353 resolve to exactly xlsx@0.18.5 — the last npm-published SheetJS build, which carries CVE-2023-30533 (Prototype Pollution, fixed only in 0.19.3 on the SheetJS CDN, not on npm) and CVE-2024-22363 (ReDoS, fixed only in 0.20.2). index.ts:1055 calls XLSX.read(buffer, { type: "buffer", cellDates: true }) on the raw bytes downloaded from Storage at index.ts:4692 (bucket.file(storagePath).download({ validation: false })), reached via extractOperationalDocumentContent (index.ts:4646). The only guard on the buffer is a 25 MB size cap (index.ts:1013-1022), which does not mitigate prototype pollution or ReDoS; no byte validation, safer parser, or WAF exists. The spreadsheet branch is selected by isSpreadsheetDocument (index.ts:847) on content-type or .xls/.xlsx filename. createDocumentUploadTarget (index.ts:4418-4425) permits spreadsheet/excel/officedocument content-types for owner/admin/interno/wms/financeiro, and extractOperationalDocumentContent is gated to the same roles (index.ts:4648), so an authenticated internal user — or an internal user uploading a malicious spreadsheet handed to them by an external party (a realistic supply-chain vector for a logistics SaaS whose clients send spreadsheets) — triggers the vulnerable parse. Because Functions v2 warm instances persist global state (setGlobalOptions maxInstances: 20, index.ts:49-52), Object.prototype pollution survives across subsequent requests/tenants on the same instance, and the ReDoS path yields CPU-exhaustion DoS. I searched for a mitigating Firestore rule, Cloud Function content check, byte validation, or version override and found none. The one nuance — a plain 'cliente' cannot trigger this (only internal roles / client-receipt PDFs) — is already acknowledged in the claim's own scoping. The concrete failure path is fully traceable, so the finding stands; severity high is appropriate given cross-tenant Object.prototype corruption plus DoS, tempered only by the authenticated-internal-role requirement.

</details>

---

### 4. [ALTO] Rejecting an outbound customer request never releases the stock it reserved

**Arquivo:** `functions/src/domain/operations.ts:3872` | **Dimensao:** Correcao - Dominio de estoque

createCustomerRequestTransaction reserves stock at request-creation time for outbound requests: it increments qty_reserved on every allocated stock_balances row (lines 2977-2985) and creates stock_reservations docs with status 'reserved' (lines 3023-3048), and publishes the reservation into the client_inventory projection. decideCustomerRequestTransaction only touches reservations inside the branch `if (input.action === "approve" && kind.outbound)` (line 3872). The 'reject' branch (and 'close') updates only the request and clientRequestStatus docs (lines 4406-4437) — it never decrements qty_reserved, never marks the stock_reservations docs released, and never refreshes the client projection. I grepped all of functions/src: the only writers to stock_reservations are creation, approve, picking ('picked'), and delivery ('consumed'); there is no release/cancel path anywhere, and no integration test covers rejection. Every rejected withdrawal request therefore permanently strands its quantity as reserved: qty_available shrinks on the physical balance, future allocations fail with 'Saldo insuficiente' even though the goods are on the shelf, and cycle counts get blocked by the countedQty < beforeReserved guard (line 1477). Recovery requires manual DB surgery.

**Evidencia:**

```
if (input.action === "approve" && kind.outbound) {
      preReservedRows = await readRows(... status == "reserved" ...)
...
// reject path (lines 4406-4421) only does:
    transaction.update(
      requestRef,
      compact({
        status: nextStatus,
        decision_reason: input.reason,
        decided_by: actorPayload(actor), ...
```

**Correcao sugerida:** In decideCustomerRequestTransaction, when action === 'reject' (and on any future cancel path) and kind.outbound: load the request's stock_reservations with status 'reserved', decrement qty_reserved / recompute qty_available on each referenced balance row, set the reservation docs to status 'released', and re-publish the client_inventory snapshot — all inside the same transaction.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path in functions/src/domain/operations.ts. Creation reserves stock for outbound requests: lines 2977-2985 increment qty_reserved and recompute qty_available on stock_balances, lines 3023-3048 create stock_reservations with status "reserved", lines 3009-3020 publish reserved qty into the client_inventory projection. In decideCustomerRequestTransaction, the only reservation-handling code is gated by `if (input.action === "approve" && kind.outbound)` (line 3872); reject is reachable for open outbound requests (decisionableStatuses includes "open", lines 3841-3850) and its path (lines 4406-4437) updates only the request doc and client_request_status — no qty_reserved decrement, no reservation status change, no projection refresh. Attempted refutations all failed: grep across functions/src shows stock_reservations status only ever moves reserved→picked (lines 5511-5523)→consumed (line 5868), with no released/cancelled writer; index.ts exposes no cancel/release callable; there are zero scheduled functions (no onSchedule anywhere); agents/subagents.ts:131 is read-only agent metadata; tools/reconcile_btg_operational_data.py never touches reservations. Impact confirmed: allocation math available = qtyOnHand - qtyReserved (lines 2916, 4007) means stranded reservations permanently shrink availability and trigger "Saldo insuficiente" (lines 2942-2947); the cycle-count guard at line 1477 throws when countedQty < beforeReserved and cycle-count writes preserve qty_reserved (lines 1792, 1831, 1946, 1964), so counting cannot repair it; approve of other requests queries reservations only by its own customer_request_id (line 3877), so orphaned rows are never consumed. No integration test covers reject (all decide calls at test lines 166, 176, 400, 514 use approve). Severity adjusted from critical to high: it is a cumulative, in-product-unrecoverable data-integrity leak triggered by a routine action, but it does not corrupt physical on-hand quantities, lose data, or have a security dimension, and is repairable via direct admin Firestore edits.

</details>

---

### 5. [ALTO] Cycle count with zero divergence overwrites the per-SKU client projection with single-location numbers

**Arquivo:** `functions/src/domain/operations.ts:1891` | **Dimensao:** Correcao - Dominio de estoque

client_inventory docs are keyed per customer+SKU with no location component (clientScopedInventoryId, lines 624-633) and every other writer treats them as the aggregate across all locations — e.g. createCustomerRequestTransaction and removeOpeningInventoryLineTransaction sum qty_on_hand/qty_reserved over ALL balance rows of the SKU before snapshotting (lines 3001-3020, 2117-2124). But recordCycleCountTransaction, in the no-adjustment branch (delta === 0), calls setClientInventorySnapshot with the PER-LOCATION values countedQty and beforeReserved (lines 1890-1906). Multi-location SKUs are a normal state in this system (putaway moves stock from RECEBIMENTO to shelf locations, and order allocation iterates multiple balance rows per SKU). So a routine 'no divergence' count of one location of a two-location SKU (say 10 in A, 5 in B; count A = 10) rewrites the customer-facing projection to qty_on_hand 10 / qty_reserved = A's reservations only, silently erasing location B's 5 units and any reservations held at other locations from the portal until some later delta-based write happens to land on the doc.

**Evidencia:**

```
} else {
      setClientInventorySnapshot(transaction, db, {
        customerCode,
        skuCode,
        ...
        qtyOnHand: countedQty,
        qtyReserved: beforeReserved,
      });
    }
```

**Correcao sugerida:** In the no-divergence branch, either skip the projection write entirely (nothing changed) or read all balance rows for the SKU (skuBalancesQuery) and snapshot the summed qty_on_hand/qty_reserved, mirroring what removeOpeningInventoryLineTransaction already does.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path in functions/src/domain/operations.ts. (1) The client_inventory doc id has no location component: clientScopedInventoryId builds cinv_${customerCode}__${skuCode} (lines 624-633). (2) All other writers treat the doc as the all-location aggregate: createCustomerRequestTransaction (3001-3020) and order creation (4080-4100) sum qty_on_hand/qty_reserved over all rows of skuBalancesQuery (593-602, no location filter); removeOpeningInventoryLine writes aggregateOnHand/aggregateReserved summed across all rows (2117-2131, 2212-2226); and the cycle count's own divergence branch uses FieldValue.increment(delta) via updateClientInventory (1876-1889, 696-703) — aggregate semantics. (3) In the no-divergence path, beforeOnHand/beforeReserved come from a single balance row fetched by exactBalanceQuery for the one counted location (1443-1470); delta=0 makes adjustmentQty=0 and movementIdValue=undefined (1646-1647), so the else branch (1891-1905) calls setClientInventorySnapshot with the per-location countedQty/beforeReserved, and that function writes them as ABSOLUTE values — qty_on_hand, qty_available, total_cost, status (746-772) — overwriting the aggregate. (4) Multi-location SKUs are routine: receiving posts to "RECEBIMENTO" (3189) while shelf stock exists, putaway transfers between locations (5130-5172), and allocation iterates multiple balance rows per SKU across locations with per-location reservations (2908-2940). (5) No mitigation: the transaction never recomputes the SKU aggregate, later increment-based writers perpetuate the corrupted base rather than fix it, and tools/reconcile_btg_operational_data.py is a manual script, not a runtime safeguard. Concrete failure: SKU with 10@LOC-A (2 reserved) + 5@LOC-B; a routine zero-divergence count of LOC-B rewrites the portal doc to on_hand 5 / reserved 0 / available 5, erasing LOC-A's stock and reservations from the customer view. Severity stays high (not critical) because the stock_balances ledger remains correct — this corrupts only the customer-facing projection and is repaired by the next full-aggregate snapshot write or manual reconciliation.

</details>

---

### 6. [ALTO] skus/products stock aggregates (estoque_atual, estoque_disponivel, estoque_btg, custo_total) permanently diverge from the ledger

**Arquivo:** `functions/src/domain/operations.ts:5392` | **Dimensao:** Correcao - Dominio de estoque

The catalog aggregates on skus/products docs are only maintained on three paths: opening-inventory counts (lines 1711-1731), opening-line removal (lines 2185-2206), and receiving when product_registration === 'new' (lines 5392-5421, gated by `projected.productRegistration === "new"`). They are never updated on: receiving of EXISTING products (the common case), shipping delivery (lines 5901-5920 update stock_balances and client_inventory only), manual ENTRADA/SAIDA movements, cycle-count adjustments in 'cycle' mode, return dispositions, or reservation changes (estoque_reservado is written once and never again). There is no Firestore trigger or scheduled job in functions/src reconciling them (grep for onDocumentWritten/onSchedule returns nothing). Meanwhile the frontend renders these exact fields as the stock truth: artifacts/btg-inventory/src/pages/skus.tsx line 65 (`Number(sku.estoque_atual ?? 0)`) and cloud-api.ts dashboard aggregations (lines 1096, 1139, 4202). After the first shipment or existing-product receipt, the SKU screen and dashboards show stale quantities that never self-correct — a persistent ledger-vs-aggregate divergence the recent 'transactional ledger' commits did not close.

**Evidencia:**

```
if (
          projected.productRegistration === "new" &&
          projected.clientItemCode
        ) {
          transaction.set(
            db.collection(collections.products).doc(...), {
              estoque_btg: FieldValue.increment(projected.quantity), ...
          transaction.set(
            db.collection(collections.skus).doc(safeDocId(skuCode)), {
              estoque_atual: FieldValue.increment(projected.quantity), ...
```

**Correcao sugerida:** Either maintain the aggregates on every stock mutation (increment/decrement estoque_atual/estoque_disponivel/estoque_reservado/custo_total wherever a movement or reservation is written — the transactions already hold all needed values), or stop the frontend reading them and derive SKU totals from stock_balances, deleting the legacy fields.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing every path. (1) The only writers of skus/products aggregates (estoque_atual, estoque_disponivel, estoque_btg, custo_total) in functions/src are the three claimed paths: opening-inventory counts inside the `mode === "opening"` gate (operations.ts:1649, increments at 1711-1728), opening-line removal (2187-2202), and receiving completion gated by `projected.productRegistration === "new"` (5392-5421, with zero-seeded catalog docs created at receipt creation, 3459-3475). (2) All other stock-mutating flows skip the aggregates: manual ENTRADA/SAIDA via createInventoryMovementTransaction (848-1042) writes only stock_balances/movements/client_inventory; shipping delivery (5901-5920) writes only stock_balances/client_inventory; cycle-mode counts write only balance/cycle_counts/movements/client_inventory (1775-1906); no writer of estoque_reservado exists beyond initial zeros. (3) No mitigation: grep for onDocumentWritten/onSchedule in functions/src returns nothing; tools/reconcile_btg_operational_data.py is an offline audit/report script, not a runtime reconciler; firestore.rules makes skus/products client writes `if false` (lines 677-685), so the legacy client-side aggregate sync in cloud-api.ts (867-1018) can no longer run, and with VITE_API_MODE=functions (.env.example:7) POST /api/movements routes to the Cloud Function (functions-api.ts:161-167) — the exact path that skips aggregates. (4) The frontend renders these fields as stock truth: GET /api/skus serves raw skus docs (cloud-api.ts:4517) with no stock_balances merge; skus.tsx:62-87 builds physical/available/reserved metrics and low/zero-stock filters from estoque_atual; products.tsx and dashboard aggregations (cloud-api.ts:1094-1105, 4198-4209) use estoque_btg/custo_total; all pages routed in App.tsx:764-779. After the first existing-product receipt or shipment, these screens permanently diverge from the ledger with no self-correction. Severity stays high: the drift is cumulative and invisible on the primary internal inventory screens, though the transactional ledger itself (stock_balances/movements/client_inventory, used by warehouse-ops and the client portal) remains correct.

</details>

---

### 7. [ALTO] Ad valorem is billed on live inventory value at emission time, not the competencia's inventory

**Arquivo:** `functions/src/index.ts:3023` | **Dimensao:** Correcao - Faturamento

The ad valorem base (custo_estoque) is computed by summing the CURRENT documents in client_inventory at the moment emitBillingInvoice runs, with no relation to the competencia being invoiced. An invoice for June emitted on July 10 charges ad valorem on July 10's stock value. Since emission always happens after (or during, see separate finding) the billed month, and stock changes daily, the ad valorem line is systematically computed on the wrong period's inventory. The only mitigation is the billing_operational_snapshots doc, but it is only consulted when a snapshot doc exists for that competencia and mode is 'replace' (or 'baseline' during opening inventory) — the default path (no snapshot) uses live inventory. The resulting wrong value is then frozen into the immutable invoice_snapshot with no correction path.

**Evidencia:**

```
const inventoryQuery = db
    .collection(collectionNames.clientInventory)
    .where("customer_code", "==", customerCode);
...
  const inventoryValue = inventorySnapshot.docs.reduce(
    (sum, document) => sum + Number(document.data().total_cost ?? 0),
    0,
  );
...
  const currentUsage = {
    custo_estoque: inventoryValue,  // no competencia filter anywhere
```

**Correcao sugerida:** Persist a month-end inventory valuation per competencia (e.g., a scheduled close job writing billing_operational_snapshots for every month, not just cutover) and require it at emission; refuse to emit when no period-scoped valuation exists instead of silently falling back to live inventory.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path. (1) emitBillingInvoice (functions/src/index.ts:5892) may run any time at/after the competencia month — assertCompetenciaCanBeOpen (billing.ts:489-502) only rejects future competencias. (2) loadBillingCalculation queries client_inventory with only a customer_code filter and sums current total_cost (index.ts:2975-2977, 3023-3026); movements in the same function ARE competencia-filtered (index.ts:3027-3033), proving the inventory base is inconsistently unscoped. (3) client_inventory.total_cost is a live projection incremented on every WMS movement (domain/operations.ts:704-707), so it reflects emission-day stock. (4) Default path: no billing_operational_snapshots doc means snapshotMode "" and usage = currentUsage (index.ts:3084-3107); the snapshot only overrides custo_estoque for mode 'replace' or 'baseline' during opening inventory — exactly as claimed. (5) No production writer of billing_operational_snapshots exists: firestore.rules:604-607 denies all client writes, no Cloud Function or scheduled job writes it (zero onSchedule in functions/src), only the one-off tools/snapshot_btg_billing_before_reset.py cutover script. (6) custo_estoque feeds the ad_valorem line (billing.ts:386-390, 657-663) and is frozen into the immutable invoice_snapshot with idempotent re-emission and SNAPSHOT_ALREADY_EXISTS on overwrite (billing.ts:783-805) — no correction path. The frontend preview (cloud-api.ts:3801+) has the same behavior and does not mitigate. Net effect: the same competencia yields different invoice totals depending on the arbitrary day finance clicks emit — a systematic financial-correctness defect. High severity stands: it silently mis-bills the ad valorem line every month, though it requires no attacker and totals are directionally bounded by real stock, so not critical.

</details>

---

### 8. [ALTO] Line checklist renders only first 8/12 rows but the advance gate requires ALL rows confirmed — large tasks can never advance

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:2400` | **Dimensao:** Frontend - Warehouse Ops

getAdvanceGate (lines 724-769) blocks the advance button while any line resolution is 'pending' (`requiresCleanChecklist && pendingLines`). Resolution counts are computed over ALL rows of the task (`getLineResolutionCounts` over `getPhysicalLineRows(task)`), but the UI only renders interactive resolution controls for the first 8 rows in PhysicalLineChecklist (line 2400) and PackingDetailSection (line 2945) and ExpeditionReadinessSection (line 3175), and the first 12 in PickingDetailSection (line 2702). Rows beyond the slice show only a '+N linha(s) no payload' note with no way to mark them OK/falta/avaria. Any receiving task in 'checking', picking/packing task 'in_progress', or expedition task with more than 8 (or 12) lines whose statuses don't already infer 'confirmed' from the server is permanently stuck: the operator sees 'Confirme as linhas físicas antes de avançar' but cannot reach the pending lines. For a logistics operation handling multi-SKU orders this is a hard functional dead-end, not a cosmetic truncation.

**Evidencia:**

```
// PhysicalLineChecklist
{rows.slice(0, 8).map((row) => (<ExecutionLineRowCard ... />))}
{rows.length > 8 ? (<div ...>+ {formatNumber(rows.length - 8)} linha(s) no payload.</div>) : null}

// getAdvanceGate
const pendingLines = hasLines && counts.pending > 0;
if (requiresCleanChecklist && pendingLines) {
  blockedReason = "Confirme as linhas físicas antes de avançar. Falta marcar OK, falta ou avaria.";
}
```

**Correcao sugerida:** Render all rows (the containers already use ScrollArea elsewhere; add virtualization e.g. @tanstack/react-virtual if lists get long), or compute the gate only over the rows actually presented. Rendering all rows is the correct fix since partial confirmation defeats the physical-check guarantee.

<details><summary>Verificacao adversarial (confirmado)</summary>

CONFIRMED for picking; scope corrections for the other queues. The core mechanism is real and I traced the full dead-end for picking tasks with >12 lines: (1) The advance gate is computed over ALL rows — warehouse-ops.tsx:7460-7469 builds executionRows via getPhysicalLineRows (no slice) and getAdvanceGate blocks whenever counts show pending or shortage/damaged lines while status is in_progress (lines 730-761), and the advance button is hard-disabled on !canSubmitAdvance (line 7764). (2) The UI renders interactive resolution controls only for rows.slice(0,12) in PickingDetailSection (line 2702; slice(0,8) at 2400/2945/3175), and ExecutionLineRowCard (the sole caller of onLineConfirmationChange, verified at lines 2401/2703/2946/3176) is the ONLY writer of lineConfirmations (handleLineConfirmationChange, line 8155) — there is no bulk-confirm or expand control, so rows beyond the slice can never be resolved locally. (3) Server-side data guarantees those hidden rows never infer 'confirmed': pick lines are created with status "open", qty_picked 0 (functions/src/domain/operations.ts:4198-4199), and the ops response maps them with picked_quantity 0 vs expected qty_to_pick (cloud-api.ts:2386-2389), so getPackingCheckRows computes delta≠0 → hasDivergence → inferLineResolution returns "shortage" (warehouse-ops.tsx:1016-1027, 1072-1080) — meaning the block actually fires via the "Há falta ou avaria marcada" branch rather than the claimed "pending" branch, but the dead-end is identical. (4) No bypass exists: even if the client gate were skipped, the Cloud Function rejects completion unless EVERY pick line has a confirmation with status in ["confirmed","ok","picked","completed"] (operations.ts:4738-4767), and buildPickingOperation sends hidden rows with their inferred "shortage"/"pending" status (warehouse-ops.tsx:1147-1165). (5) The suggested remedy (register exception) permanently worsens it: exception_count>0 sets blocked_reason "Há exceção aberta para este picking" (cloud-api.ts:2528-2529), making canAdvanceTask false so the advance button stops rendering entirely. Scope corrections to the original claim: RECEIVING is NOT stuck — ReceivingConferenceSection renders ALL lines unsliced (warehouse-ops.tsx:7090, 7268) and its save endpoint sets each inbound line to status "checked" (operations.ts:3687-3690), which infers "confirmed" and clears the gate after refetch; PACKING and EXPEDITION are currently unaffected because the ops response never populates items for pack/shipment tasks (cloud-api.ts:2540-2583 pass no items; laneTask defaults items to [] at 2223), so hasLines is false and the checklist gate never binds there. The confirmed impact — orders with more than 12 pick lines can never be completed through the UI or the API — is a hard functional dead-end in the central fulfillment flow of a logistics product, so high severity stands.

</details>

---

### 9. [ALTO] Critical ledger mutations only reach Cloud Functions if a build-time env var is set; the client fallback is denied by Firestore rules

**Arquivo:** `artifacts/btg-inventory/src/lib/functions-api.ts:564` | **Dimensao:** Frontend - Camada de dados

shouldUseFunctionsApi() force-routes only a subset of writes to Cloud Functions (client requests, chat, notifications, ai events, cycle counts, opening inventory, photo upload, exceptions, returns, customer/document governance). The most critical ledger routes are NOT in that list even though functionRoute() defines backends for them: POST /api/movements (createInventoryMovement), POST /api/customer-requests/:id/(approve|reject|close) (decideCustomerRequest), POST /api/warehouse/tasks/:id/advance (advanceWarehouseTask), POST /api/warehouse/receipts + /conference, billing periods manual/emit/pay, and products/skus/price-list mutations. They only go to Functions when import.meta.env.VITE_API_MODE === "functions" — which is defined only in the untracked .env.local (and .env.example); the Dockerfile just copies a locally prebuilt artifacts/btg-inventory/dist/public, so nothing in the pipeline guarantees the flag. A build without it silently ships the cloud-api.ts client fallback: createMovement (cloud-api.ts:4856), transitionCustomerRequest (4338), advanceWarehouseTask (4352), billing emit/pay (4695/4726) — all of which write to collections firestore.rules denies (movements, stock_balances, orders, customer_requests, billing_periods all have 'allow create, update, delete: if false'), so approving requests, registering movements, advancing WMS tasks and emitting invoices fail at runtime with permission-denied. Live callers exist (customer-requests.tsx:921, warehouse-ops.tsx:8052). Two hand-maintained route tables (functionRoute vs shouldUseFunctionsApi) have already diverged.

**Evidencia:**

```
functions-api.ts:564-578: return ((isClientRequestWrite || isAgentChatWrite || ... || isDocumentGovernanceWrite || import.meta.env.VITE_API_MODE === "functions") && Boolean(firebaseApp));  — no case for /api/movements, /api/customer-requests/:id/approve, /api/warehouse/tasks/:id/advance, /api/billing/periods/... . cloud-api.ts:4856: if (pathname === "/api/movements" && method === "POST") { return json(await createMovement(await readBody(init)), 201); }  firestore.rules:732-735: match /movements/{movementId} { allow read: if canReadOperations(); allow create, update, delete: if false; }
```

**Correcao sugerida:** Make functionRoute() the single source of truth: route every non-GET /api/* call that has a function route to Functions unconditionally (delete the shouldUseFunctionsApi allowlist and the VITE_API_MODE gate), and delete or hard-disable the client-side mutation fallbacks in cloud-api.ts so a misbuilt bundle fails loudly instead of shipping a divergent write path.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed end-to-end by reading the code. (1) functions-api.ts:517-578: shouldUseFunctionsApi force-routes only an enumerated subset of writes; POST /api/movements, /api/customer-requests/:id/(approve|reject|close), /api/warehouse/tasks/:id/advance, /api/warehouse/receipts(+/conference), billing periods manual/emit/pay, and products/skus/price-list mutations are absent, despite functionRoute() (same file, lines 59-84, 130-167, 385-412, 481-512) defining Cloud Function backends for all of them — the two hand-maintained tables have diverged. These routes reach Functions only when import.meta.env.VITE_API_MODE === "functions". (2) vite.config.ts:19 sets envDir to the repo root; the flag exists only in root .env.local (untracked — .gitignore:35-37 ignores /.env.* except .env.example, and Vite never loads .env.example). There is no CI (.github/workflows empty); tools/deploy_cloud_run.ps1 builds on the invoking machine and the Dockerfile only copies the prebuilt dist/public, so nothing in the pipeline guarantees the flag. (3) cloud-api.ts:4883-4892: when the gate is false the request falls to route(), whose handlers do direct client-SDK Firestore writes — createMovement (4856→935), transitionCustomerRequest (4338→1764), advanceWarehouseTask (4352→2828), products/skus/price-list CRUD (4822-4843). (4) firestore.rules denies all of these: movements 732-735, stock_balances 722-725, customer_requests 697-700, orders 707-710, products 677-680, skus 682-685, billing_periods 584-587, billing_price_list 594-597 all have "allow create, update, delete: if false" — no server-side mitigation exists. (5) Live UI callers confirmed at customer-requests.tsx:921 and warehouse-ops.tsx:8052. Severity adjusted down from critical to high: the currently deployed build was produced on the dev machine where .env.local sets the flag, .env.example also documents VITE_API_MODE=functions so the standard setup path propagates it, and the failure mode is fail-closed permission-denied (operations blocked, app loads and reads fine) rather than silent data corruption. It is a confirmed latent build/config fragility that would break the operational core (movements, approvals, WMS advancement, billing emission) on any build lacking the untracked env file, but not an active outage or integrity breach.

</details>

---

### 10. [ALTO] Every API read does unbounded full-collection getDocs; limit/offset/search applied in memory after download

**Arquivo:** `artifacts/btg-inventory/src/lib/cloud-api.ts:671` | **Dimensao:** Frontend - Camada de dados

readAll() fetches entire collections with no limit(), orderBy() cursor, or field mask, and filterAndPage() applies search/date/limit/offset only after everything is in memory — so '/api/movements?limit=200' still downloads the whole movements ledger (which grows forever) on every call. Aggregate endpoints multiply this: getDashboard reads full products+skus+movements+orders (1079-1084) then keeps 10 movements; getWarehouseOps reads 16 full collections (2251-2268); getAiOverview reads 9 including all events and movements (4185-4195); getBillingPeriod/getBillingEvidence read every movement ever recorded to bill one month (3618-3634, 3834-3848); readOperationalFoundationInput reads 14 collections (3422-3437); notifications/sync reads all events then slices 200 (4403-4407). Several pages also poll these endpoints on refetchInterval: 30000 (customer-requests.tsx:900-911). Firestore bills per document read, so cost and latency grow linearly with history on every page view and every 30s poll.

**Evidencia:**

```
cloud-api.ts:671-675: async function readAll(name: string): Promise<AnyRecord[]> { if (!firestore) return []; const snapshot = await getDocs(collection(firestore, name)); return snapshot.docs.map(normalizeDoc); }  and 750-753: const total = result.length; const offset = Number(params.get("offset") ?? 0); const limit = Number(params.get("limit") ?? total); return { items: result.slice(offset, offset + limit), total };
```

**Correcao sugerida:** Push limit/orderBy/where into the Firestore query (query(collection, orderBy('data','desc'), limit(n)) with cursors), and compute billing/dashboard aggregates server-side (scheduled function or aggregation docs) instead of scanning the full movements ledger on the client.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full request path. readAll (artifacts/btg-inventory/src/lib/cloud-api.ts:671-675) does `getDocs(collection(firestore, name))` with no limit/cursor, and filterAndPage (723-754) applies search/filters/offset/limit only in memory after download — `?limit=200` never reaches Firestore. Crucially, there is no server-side mitigation: shouldUseFunctionsApi (functions-api.ts:517-579) intercepts only specific write routes and functionRoute defines no GET list routes, so callFunctionsApi returns null for GETs and the patched fetch (cloud-api.ts:4877-4890) falls through to the client-side readAll path even in functions mode — this IS the production read path. All cited aggregates verified: getDashboard (1078-1110) downloads full products/skus/movements/orders keeping 10 movements; getWarehouseOps batches 16 readAll calls (2252-2267); getAiOverview 9 collections incl. all events+movements (4186-4194); getBillingPeriod (3619-3624) and getBillingEvidence (3835-3838) read the entire movements ledger to bill one month; readOperationalFoundationInput reads 14 collections (3423-3436). Polling verified: dashboard.tsx:295-309 hits /api/ai/overview, /api/warehouse/ops and /api/customer-requests every 30s; customer-requests.tsx:899-911 polls limit=200/limit=500 queries every 30s; ai-control.tsx has five 30s polls. No cache mitigation — firebase.ts uses plain getFirestore (no persistent cache), so every getDocs is billed per document; Firestore rules allow these list reads with no request.query.limit constraint. Since movements is an append-only ledger (recent commit 'feat: enforce transactional inventory ledger'), read cost and latency grow linearly with history on every page view and every 30s poll. Only nit: the client-side notifications/sync path (4403-4407) is normally served by the syncOperationalNotifications Cloud Function, so that one sub-point rarely executes client-side; it does not change the verdict.

</details>

---

### 11. [ALTO] RealtimeSyncBridge opens ~38 unfiltered whole-collection listeners and invalidates ALL react-query caches on any change

**Arquivo:** `artifacts/btg-inventory/src/lib/realtime-sync.tsx:175` | **Dimensao:** Frontend - Camada de dados

For internal users the bridge subscribes onSnapshot to every collection in INTERNAL_OPERATION_COLLECTIONS (34 entries including movements, events, skus, stock_balances) with no where/limit — each subscription's initial snapshot downloads the entire collection a second time on top of the API reads, and keeps it synced. When any doc changes anywhere, scheduleInvalidation fires queryClient.invalidateQueries() with no filter after 350ms, so ALL active queries refetch — and per the previous finding each refetch is itself a set of full-collection scans (e.g., the warehouse-ops page refetches 16 collections). The changedCollectionsRef set that tracks which collections actually changed is cleared without ever being used to scope the invalidation, so the targeting logic is dead code. Additionally, roles like 'financeiro' subscribe to collections their rules deny (movements, skus, products require canReadOperations which excludes financeiro), producing a permanent stream of permission-denied listener errors that are only console.warn'd.

**Evidencia:**

```
realtime-sync.tsx:168-176: function scheduleInvalidation(collectionName: string) { changedCollectionsRef.current.add(collectionName); if (timerRef.current) return; timerRef.current = window.setTimeout(() => { timerRef.current = null; changedCollectionsRef.current.clear(); void queryClient.invalidateQueries(); }, 350); }  — collectionName collected but invalidateQueries() called unscoped; targets built at 156-166 from INTERNAL_OPERATION_COLLECTIONS with no query constraints (buildRealtimeQuery returns the bare collection ref when no customerField/userField).
```

**Correcao sugerida:** Invalidate only queries keyed to the changed collections (queryClient.invalidateQueries({ queryKey: [collectionName] }) using the collected set), constrain listeners with where/limit (e.g., updated_at > subscription time), and restrict the target list per role to collections the role can actually read.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the actual code. (1) realtime-sync.tsx:154-166 — for any non-'cliente' role, every entry of INTERNAL_OPERATION_COLLECTIONS is mapped to a target with no customerField/userField, and buildRealtimeQuery (line 130) returns the bare collection ref when there are no filters, so onSnapshot listens to whole collections; the constant actually contains 40 collections (35 named + 5 spread from CUSTOMER_AUTHORIZED_COLLECTIONS), so the claim's ~38 understates it. The 'initialized' flag (189-196) only suppresses the first invalidation — the initial snapshot still downloads every readable document, duplicating the API reads. The bridge is mounted globally at App.tsx:833. (2) Lines 168-177 — changedCollectionsRef is added to and cleared but never read; queryClient.invalidateQueries() is called with no filter, so ALL queries in the shared client (queryClient.ts, no staleTime default) are invalidated and every active one refetches 350ms after any doc change anywhere. The collection-targeting logic is dead code exactly as claimed. (3) The refetch cost is real: cloud-api.ts readAll (671-675) does getDocs on the entire collection, and page query functions run Promise.all batches of readAll — e.g. 16 full-collection reads at cloud-api.ts:2252-2267, 14 at 3423-3436 — so one write anywhere triggers multi-collection full scans per active query, on top of the 40 listeners re-syncing. (4) The financeiro sub-claim is confirmed against firestore.rules: canReadOperations() (rules 73-75) is ['owner','admin','interno','wms','suporte'], excluding financeiro, while movements (732), skus (682), products (677), stock_balances (722), orders (707) etc. require it; financeiro takes the internal branch (isCustomer only matches 'cliente') and its listens on those collections are rejected with permission-denied, only console.warn'd (202-207). Same applies to wms on ai_agent_* (rules 639-662) and billing_* collections. One nuance: a denied onSnapshot errors once and detaches, so it is a burst of denied listens per mount rather than a literal permanent error stream — and those roles silently get no realtime coverage for those collections. No mitigating code exists (no scoped invalidation, no limits, no server proxy for listeners). Severity high is appropriate for a Firestore-billed multi-tenant SaaS: per-session double-download of the entire operational dataset plus write-triggered global full-scan refetch storms.

</details>

---

### 12. [ALTO] ai-control polls five endpoints every 30s, each doing unbounded full-collection Firestore reads in the browser

**Arquivo:** `artifacts/btg-inventory/src/pages/ai-control.tsx:1852` | **Dimensao:** Frontend - Portal do cliente

All five queries on the page set refetchInterval: 30000. They resolve client-side in cloud-api.ts: getAiOverview() (line 4174) does readAll() on NINE whole collections including the append-only 'events' ledger and 'movements'; getWarehouseOps() (line 2233) does readAll() on SIXTEEN collections; '/api/customer-requests?limit=200' hits the generic list route (cloud-api.ts:4615-4626) which calls readAll() on the entire customer_requests collection and only then slices to 200 in memory (filterAndPage, line 723); '/api/agent-dute/notifications?limit=20' does the same. readAll() (cloud-api.ts:671-675) is getDocs(collection(...)) with no limit or orderBy. Every open ai-control tab therefore re-downloads ~30 full collections every 30 seconds. Since 'events' and 'movements' grow monotonically (this is the system's event ledger), Firestore read costs and page latency grow linearly and without bound — a real production cost/perf problem, not a style issue.

**Evidencia:**

```
ai-control.tsx:1852-1856 useQuery({ queryKey: ["ai-overview"], queryFn: () => fetchJson<AiOverview>("/api/ai/overview"), refetchInterval: 30000 }); cloud-api.ts:4185-4195 await Promise.all([ readAll(collectionNames.products), readAll(collectionNames.skus), readAll(collectionNames.movements), readAll(collectionNames.orders), readAll(collectionNames.periods), readAll(collectionNames.events), ... ]); cloud-api.ts:671-675 async function readAll(name) { const snapshot = await getDocs(collection(firestore, name)); return snapshot.docs.map(normalizeDoc); }
```

**Correcao sugerida:** Move these aggregations to a Cloud Function (or precomputed snapshot doc), and in the interim add query limits/orderBy('occurred_at','desc').limit(N) to the ledger reads and lengthen or remove refetchInterval.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path in the actual code; no mitigating layer exists. (1) Polling: ai-control.tsx:1852-1890 defines five useQuery hooks — "/api/ai/overview", "/api/operational/foundation", "/api/warehouse/ops", "/api/customer-requests?limit=200", "/api/agent-dute/notifications?limit=20" — each with refetchInterval: 30000, and queryClient.ts sets no staleTime (refetchInterval re-runs queryFn regardless). (2) Routing: main.tsx:9 calls installCloudApi(), which monkey-patches window.fetch (cloud-api.ts:4863-4907). For /api/* it first tries shouldUseFunctionsApi/callFunctionsApi, but functionRoute() in functions-api.ts:44-515 defines exactly ONE GET route (/api/warehouse/opening-inventory/session); for every other GET callFunctionsApi returns null (functions-api.ts:588-599 only 501s non-GET), so even with VITE_API_MODE=functions (.env.example:7) all five GETs fall through to the client-side route() and execute Firestore reads in the browser. (3) Unbounded reads: readAll (cloud-api.ts:671-675) is getDocs(collection(firestore, name)) with no limit/orderBy; firebase.ts:34 uses plain getFirestore() (default memory cache), so every execution re-reads and re-bills every document server-side. getAiOverview (cloud-api.ts:4174-4195) reads 9 whole collections including the append-only events ledger and movements, then uses only events.slice(0, 80); getWarehouseOps (2233-2268) reads 16 whole collections; getOperationalFoundation → readOperationalFoundationInput (3406-3437) reads 14 more; the generic list route (4615-4626) does readAll(customer_requests) and readAll(operational_notifications) and only then slices to limit in filterAndPage (750-753: result.slice(offset, offset + limit)). Events grow monotonically — emitEvent appends an event doc on every entity write (cloud-api.ts ~770-780), consistent with the "transactional inventory ledger" commit. Net: each open ai-control tab re-downloads roughly 39 full collection reads every 30 seconds, with cost and latency growing linearly with ledger size. Dashboard.tsx:297-302 and support.tsx:201-206 poll the same endpoints under different query keys, compounding rather than mitigating. High (not critical) is correct: it is a real production cost/latency/bandwidth problem that worsens without bound, but causes no data corruption or security breach by itself.

</details>

---

### 13. [ALTO] Dashboard and WMS pages poll scan-heavy endpoints every 30s (~30 full collection scans per tick per tab)

**Arquivo:** `artifacts/btg-inventory/src/pages/dashboard.tsx:295` | **Dimensao:** Performance

Dashboard mounts four queries, three with refetchInterval: 30000: /api/ai/overview, /api/warehouse/ops and /api/customer-requests?limit=80, plus useGetDashboard. Behind them: /api/warehouse/ops performs 16 parallel full-collection scans (cloud-api.ts 2251-2268: skus, movements, orders, locations, stock_balances, inbound_receipts, inbound_items, putaway_tasks, quality_exceptions, order_items, stock_reservations, pick_tasks, pick_lines, pack_tasks, shipments, ai_agent_inbox); /api/ai/overview performs 9 full scans including ALL events and ALL movements (cloud-api.ts 4185-4195); /api/customer-requests is another full scan (finding 1); getDashboard is 4 more (including all movements again). That is roughly 29 unbounded collection downloads every 30 seconds, per open browser tab, forever — even when the user is idle (refetchOnWindowFocus is false but intervals fire regardless). warehouse-ops.tsx line 7998-8001 polls the same /api/warehouse/ops endpoint on its own 30s interval. With realistic data volumes this is thousands of billed document reads per minute per user and multi-second refresh latency.

**Evidencia:**

```
dashboard.tsx:295-309:
  const ai = useQuery({ queryKey: ["ai-overview"], queryFn: () => fetchJson<AnyRecord>("/api/ai/overview"), refetchInterval: 30000 });
  const wms = useQuery({ queryKey: ["warehouse-ops"], queryFn: () => fetchJson<AnyRecord>("/api/warehouse/ops"), refetchInterval: 30000 });
  const requests = useQuery({ queryKey: ["customer-requests", "control-tower"], queryFn: () => fetchJson<{ items?: AnyRecord[] }>("/api/customer-requests?limit=80"), refetchInterval: 30000 });

cloud-api.ts:2251-2268 (the /api/warehouse/ops backing):
  ] = (await Promise.all([
    readAll(collectionNames.skus),
    readAll(collectionNames.movements),
    readAll(collectionNames.orders),
    ... 13 more readAll(...) calls ...
  ])) as AnyRecord[][];
```

**Correcao sugerida:** Remove the fixed 30s polling — the app already has a Firestore realtime bridge that invalidates queries on change. Replace the scan-everything endpoints with pre-aggregated snapshot documents (queue counters, dashboard metrics) maintained by the transactional Cloud Functions, so the dashboard reads a handful of docs instead of 16+ collections.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path. dashboard.tsx:295-309 mounts three queries with refetchInterval: 30000 (/api/ai/overview, /api/warehouse/ops, /api/customer-requests?limit=80); warehouse-ops.tsx:7998-8003 polls /api/warehouse/ops on its own 30s interval. installCloudApi (cloud-api.ts:4863-4907) monkey-patches window.fetch, and functions-api.ts's shouldUseFunctionsApi/functionRoute (517-599) has no Cloud Function route for any of these GETs, so they are always served client-side by route(). readAll (cloud-api.ts:671-675) is an unbounded getDocs(collection(...)) with no limit; getWarehouseOps (2233-2268) runs 16 readAll scans, getAiOverview (4174-4195) runs 9 including ALL events and ALL movements, and GET /api/customer-requests goes through the listRoutes loop (4615-4626) which does readAll first and applies limit=80 only in memory. firebase.ts:34 uses plain getFirestore (no persistent cache), and queryClient.ts sets no staleTime, so every poll re-bills every document. Two overstatements in the claim, neither refuting: (1) the recurring per-tick cost is 26 scans, not ~29 — useGetDashboard() has no refetchInterval, so its 4 scans run on mount only; (2) refetchIntervalInBackground defaults to false, so polling pauses in unfocused/background tabs — "forever per open tab" holds only for the focused tab. Because the failure mode is cost/latency degradation scaling with data volume (movements/events are append-only) rather than an outage, data loss, or security breach, and it self-suspends in background tabs, severity is adjusted from critical to high.

</details>

---

### 14. [ALTO] RealtimeSyncBridge opens ~40 unbounded onSnapshot listeners and invalidates the ENTIRE react-query cache on any change

**Arquivo:** `artifacts/btg-inventory/src/lib/realtime-sync.tsx:175` | **Dimensao:** Performance

For internal roles, RealtimeSyncBridge subscribes onSnapshot to every collection in INTERNAL_OPERATION_COLLECTIONS (~40 collections including the unbounded, append-only 'movements' and 'events' ledgers) with no query constraints — buildRealtimeQuery returns the bare collection ref when no customerField/userField is set. Each listener's initial snapshot downloads and bills the FULL collection, duplicating the scans already done by the fetch layer. Worse, on any docChange the debounced handler calls queryClient.invalidateQueries() with NO filter, refetching every active query — each of which is itself a full-collection scan (finding 1). Because every CRUD write also emits an 'events' doc plus up to two 'ai_agent_memory' docs and an 'ai_agent_inbox' doc (cloud-api.ts emitEvent, lines 653-668), all of which are subscribed collections, a single logical mutation reliably triggers a global refetch storm 350ms later. The changedCollectionsRef set is populated and then cleared without ever being used for targeted invalidation.

**Evidencia:**

```
realtime-sync.tsx:168-177:
    function scheduleInvalidation(collectionName: string) {
      changedCollectionsRef.current.add(collectionName);
      if (timerRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        changedCollectionsRef.current.clear();
        void queryClient.invalidateQueries();   // <- no filter: invalidates everything
      }, 350);
    }

realtime-sync.tsx:120-130 (unbounded listener for internal collections):
  const ref = collection(firestore, target.collectionName);
  ...
  return filters.length ? query(ref, ...filters) : ref;   // internal targets have no filters
```

**Correcao sugerida:** Scope invalidation: map each collection to its query keys and call queryClient.invalidateQueries({ queryKey: [...] }) using the changedCollections set that is already being tracked. Constrain listeners to what the UI needs (e.g. query(ref, orderBy('created_at','desc'), limit(1)) as a change signal, or listen only to a lightweight 'events' tail) instead of mirroring 40 full collections into every internal user's browser.

<details><summary>Verificacao adversarial (confirmado)</summary>

CONFIRMED by tracing the full path. (1) realtime-sync.tsx matches the claim exactly: INTERNAL_OPERATION_COLLECTIONS (lines 48-85) lists 40 collections (35 + 5 customer projections, including the append-only 'movements' and 'events' ledgers); for any non-'cliente' role the targets are built with no customerField/userField (lines 156-166), and buildRealtimeQuery line 130 (`return filters.length ? query(ref, ...filters) : ref;`) returns the bare collection ref, so each onSnapshot's initial snapshot downloads the entire collection (the `initialized` flag at 189-196 only suppresses invalidation, not the download). Plus 2 user-scoped and 2 admin collections = up to 44 listeners. (2) scheduleInvalidation (168-177) calls `queryClient.invalidateQueries()` with no filter, and changedCollectionsRef is populated then cleared unused — confirmed verbatim. (3) The bridge is mounted globally for all signed-in users (App.tsx:833) inside QueryClientProvider; queryClient.ts sets no staleTime, so an unfiltered invalidateQueries refetches every active query. (4) The fetch layer really is full-collection scans: cloud-api.ts readAll (line 671-675, bare getDocs) is used in query functions that Promise.all 5-16 full collections each (e.g. lines 1264-1272, 2252-2267, 3423-3436). (5) Firestore rules do NOT mitigate: canReadOperations/canReadObservability (firestore.rules:73-87) grant owner/admin/interno/wms/suporte list access to movements (line 732-735), events (614-617), stock_balances, orders, etc., so the unbounded listeners succeed for internal roles (only financeiro's listeners mostly fail harmlessly via the error handler). (6) The write-amplification trigger holds, with one correction: current firestore.rules deny client creates on events (line 616 `allow create...: if false`) and ai_agent_inbox (line 626), so cloud-api.ts emitEvent's client-side event write would be rules-denied; however ai_agent_memory writes are allowed for owner/admin/interno (line 641), and the Cloud Functions path writes events (functions/src/domain/operations.ts:463 `transaction.create(db.collection(collections.events).doc(id), payload)`) and movements (line 815) via the Admin SDK, bypassing rules — both subscribed collections — so any operation by ANY user still fires listeners on EVERY connected internal client, each triggering an unfiltered global refetch (dozens of full-collection getDocs) 350ms later. Minor precision note: the 350ms debounce coalesces concurrent writes into ONE invalidateQueries call, so the 'storm' is one global refetch wave per debounce window, not repeated invalidations — but that wave refetches all active queries, each a multi-collection full scan, on every connected client. Severity adjusted from critical to high: this is a real, compounding performance/billing problem (O(total docs) per session at listener startup, plus cross-client full refetch on every write against unbounded ledgers), but it is not a security or data-integrity failure.

</details>

---

### 15. [ALTO] No code splitting: 8,400-line warehouse-ops and all other pages are statically imported into one entry bundle

**Arquivo:** `artifacts/btg-inventory/src/App.tsx:28` | **Dimensao:** Performance

App.tsx statically imports every page component — including warehouse-ops.tsx (8,440 lines), ai-control.tsx (2,810 lines), customer-requests.tsx (1,721), documents.tsx (1,259), the whole client portal suite, plus recharts via dashboard.tsx — so the entire application ships in the initial bundle. There is no React.lazy/dynamic import anywhere in the router, and vite.config.ts defines no build.rollupOptions.output.manualChunks. The vite config even raises the PWA precache limit to 3 MB (maximumFileSizeToCacheInBytes: 3 * 1024 * 1024) to accommodate the oversized chunk, and globPatterns precaches every JS file. A 'cliente'-role portal user must download and parse the full internal WMS workbench, AI control panel, and billing screens before the sign-in page becomes interactive; any one-line change anywhere invalidates the single precached mega-chunk for all PWA users.

**Evidencia:**

```
App.tsx:28-58 (static imports, excerpt):
import AppLayout from "./components/layout/app-layout";
import Dashboard from "./pages/dashboard";
...
import AiControl from "./pages/ai-control";
...
import WarehouseOps, {
  type WarehouseOpsModuleKey,
} from "./pages/warehouse-ops";

vite.config.ts:59-66:
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,

(wc -l: warehouse-ops.tsx 8440, ai-control.tsx 2810, customer-requests.tsx 1721 lines; no 'lazy(' occurrences in App.tsx)
```

**Correcao sugerida:** Convert PROTECTED_ROUTES components to React.lazy(() => import(...)) wrapped in a Suspense boundary in ProtectedRoute, at minimum for warehouse-ops, ai-control, dashboard (recharts), client portal, and documents. Add manualChunks (vendor/recharts/firebase) in vite.config.ts and drop the 3 MB precache override once chunks are back under the default.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by direct code reading and by the actual build artifact. App.tsx (C:/DEV/Dute/artifacts/btg-inventory/src/App.tsx:1, 28-58) statically imports every page including WarehouseOps (8,440 lines), AiControl (2,810), CustomerRequests (1,721), Documents (1,259), the full client portal suite, and LandingPage; grep across all of src finds zero occurrences of 'lazy(' or 'import(' — no code splitting mechanism exists anywhere. vite.config.ts has no build.rollupOptions/manualChunks (build section is only outDir/emptyOutDir at lines 82-85). The decisive evidence is the committed build output: dist/public/assets contains a single JS chunk, index-BQyTo2Iu.js, at 2,203,905 bytes — which exceeds Workbox's default 2 MiB (2,097,152-byte) precache limit, directly explaining vite.config.ts:62's maximumFileSizeToCacheInBytes: 3*1024*1024 raise, and globPatterns at line 61 precaches every JS file. recharts is statically bundled via dashboard.tsx and components/ui/chart.tsx. Failure path: a cliente-role user must download/parse the entire 2.2 MB bundle (internal WMS workbench, AI control, billing, recharts) before sign-in is interactive, and any one-line change re-hashes the single chunk, invalidating the precache and forcing all PWA users to re-download 2.2 MB. No mitigation found (single Vite entry, main.tsx renders this one App, no server-side splitting).

</details>

---

### 16. [ALTO] Cloud Functions cold start loads mammoth, pdf-parse, xlsx and Genkit/VertexAI for all ~35 callables

**Arquivo:** `functions/src/index.ts:17` | **Dimensao:** Performance

functions/src/index.ts is a single 6,070-line module exporting ~35 onCall functions (lookupInvite, createInventoryMovement, advanceWarehouseTask, chatWithAgentDute, etc.). At module top level it imports mammoth, pdf-parse and xlsx — heavy document-parsing libraries used ONLY inside extractOperationalDocumentContent (usages at lines 1037, 1055, 1081) — and constructs a genkit + vertexAI client at line 56, used only by the AI functions. In Cloud Functions v2 every exported function becomes its own service, but each one loads and evaluates this entire module on cold start, so latency-sensitive hot paths pay hundreds of ms to multiple seconds of extra require/parse time for parsing libs they never call. lookupInvite is invoked on the public invite-signup page (App.tsx fetchInvite), so new users hit this cold-start penalty directly; every warehouse mutation (createInventoryMovement, advanceWarehouseTask) is behind the same weight.

**Evidencia:**

```
functions/src/index.ts:14-19:
import { genkit, z } from "genkit";
import { vertexAI } from "@genkit-ai/google-genai";
import { createHash, randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

functions/src/index.ts:56-63:
const ai = genkit({
  plugins: [
    vertexAI({ projectId: "dute-btg", location: "global" }),
  ],
});

Only usages of the parsing libs: lines 1037 (new PDFParse), 1055/1058 (XLSX.read / sheet_to_json), 1081 (mammoth.extractRawText) — all inside the document-extraction path.
```

**Correcao sugerida:** Lazy-load the parsers inside extractOperationalDocumentContent with dynamic import (const { default: mammoth } = await import('mammoth'), same for pdf-parse and xlsx), and construct the genkit client lazily on first AI call. Longer term, split the codebase into per-domain entry files (codebase config in firebase.json) so warehouse/billing functions don't carry the AI/document stack at all.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the actual code. functions/src/index.ts:17-19 statically imports mammoth, pdf-parse, and xlsx, and lines 56-63 construct the genkit+vertexAI client at module scope; the file has zero dynamic import() calls. The parsing libraries are used only in the document-extraction helper (lines 1037, 1055/1058, 1081) serving extractOperationalDocumentContent, yet all 32 onCall exports (lookupInvite:2737, advanceWarehouseTask:5504, createInventoryMovement:5535, chatWithAgentDute:6058, etc.) live in the same 6,070-line module compiled with plain tsc (no bundling/tree-shaking; package.json main: lib/index.js, firebase.json single codebase), so every Cloud Functions v2 service evaluates the whole module on cold start. The weight is verified in node_modules: pdf-parse@2.4.5 is 19MB and its ESM entry statically re-exports pdfjs-dist/legacy/build/pdf.mjs (eagerly evaluated), xlsx is 7.3MB, mammoth 2.4MB, and genkit drags in the full @opentelemetry auto-instrumentation suite. No mitigations exist: setGlobalOptions sets only region and maxInstances:20 (no minInstances), and there are no per-function options or lazy loading. The public signup path is confirmed hot: App.tsx:195 calls httpsCallable "lookupInvite" in fetchInvite (used at line 372). Minor inaccuracies only: 32 callables rather than ~35, and vertexAI plugin network init is lazy (the cost is module load/parse, not construction-time RPCs). Severity high is justified: user-visible multi-hundred-ms-to-seconds cold starts on the public invite flow and every warehouse mutation, multiplied across 32 low-traffic services that each cold-start independently.

</details>

---

### 17. [ALTO] Cloud Functions deploy ships no lockfile — production dependencies resolved fresh by npm at build time, bypassing the workspace's supply-chain quarantine

**Arquivo:** `functions/package.json:18` | **Dimensao:** Dependencias e Deploy

The functions directory contains only package.json, src, lib, tsconfig.json and node_modules — no package-lock.json (verified via ls), and pnpm-lock.yaml at the repo root is not uploaded by firebase deploy. The GCF buildpack therefore runs plain `npm install` against the caret ranges (firebase-admin ^13.0.0, firebase-functions ^6.0.0, genkit ^1.0.0, mammoth ^1.12.0, pdf-parse ^2.4.5), so every deploy resolves the newest matching versions. This has two concrete consequences: (1) production runs dependency versions that were never installed or tested locally (local installs go through pnpm-lock.yaml); (2) it completely bypasses the supply-chain protection the workspace deliberately configured — pnpm-workspace.yaml line 1 sets `minimumReleaseAge: 1440`, a 24-hour quarantine against freshly published (potentially hijacked) releases — meaning a malicious release of any transitive dep published minutes before a deploy goes straight into the production backend that holds admin credentials to Firestore and Storage.

**Evidencia:**

```
ls functions/ → firestore-debug.log, lib, node_modules, package.json, src, tsconfig.json (no package-lock.json); pnpm-workspace.yaml:1 "minimumReleaseAge: 1440"; functions/package.json dependencies all use ^ ranges
```

**Correcao sugerida:** Generate and commit a functions/package-lock.json (e.g., `npm install --package-lock-only` inside functions/) so the buildpack runs `npm ci` with pinned versions, or use `firebase deploy` with a prebuilt bundle. Keep it in sync with pnpm-lock.yaml in CI.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by direct inspection. (1) functions/package.json lines 18-26 use caret ranges for every production dependency (firebase-admin ^13.0.0, firebase-functions ^6.0.0, genkit ^1.0.0, mammoth ^1.12.0, pdf-parse ^2.4.5, xlsx ^0.18.5). (2) ls of functions/ shows no package-lock.json or pnpm-lock.yaml — only firestore-debug.log, lib, node_modules, package.json, src, tsconfig.json. (3) firebase.json sets functions.source="functions" with predeploy `pnpm --dir "$RESOURCE_DIR" run build`; the Firebase CLI uploads only the functions/ directory (node_modules excluded by default), so the root pnpm-lock.yaml never reaches the GCF buildpack, which therefore runs plain `npm install` and resolves the newest versions matching the caret ranges on every deploy. (4) No mitigation exists anywhere: no .github/ CI, no lockfile-generation or isolate-package step in tools/ or deploy/ (deploy_cloud_run.ps1 deploys the nginx frontend, not functions), no alternate functions deploy path in docs. (5) Divergence is concrete: functions/node_modules/firebase-admin is a pnpm symlink to .pnpm/firebase-admin@13.10.0 pinned by root pnpm-lock.yaml, so all local builds and emulator integration tests run pinned versions while production resolves fresh ones. (6) pnpm-workspace.yaml line 1 sets minimumReleaseAge: 1440 — a deliberately configured 24-hour supply-chain quarantine that governs only pnpm installs and is fully bypassed by the deploy-time npm install into a runtime holding Admin SDK credentials to Firestore and Storage. Severity stays high: the supply-chain worst case is conditional on a hijacked upstream release landing in a deploy window, but the untested-version drift on a privileged backend enforcing the transactional inventory ledger is guaranteed on every deploy, and the finding defeats a control the team explicitly configured. Fix is trivial (generate a package-lock.json in functions/ or use a deploy isolation step), which does not reduce the current exposure.

</details>

---

### 18. [MEDIO] Storage rules grant every internal role full read/write/DELETE over all tenants' files (no scoping, over-broad wildcards)

**Arquivo:** `storage.rules:33` | **Dimensao:** Seguranca - Regras Firestore/Storage

All three storage prefixes (agent-knowledge, operational-documents, product-photos) are gated only by isInternal(), which returns true for owner, admin, interno, wms, financeiro AND suporte. The match uses a full recursive wildcard {allPaths=**} and grants both read and write. There is no per-customer_code scoping, so any of those six roles can read, overwrite, or delete EVERY tenant's operational documents, product photos, and — critically — the agent-knowledge corpus that the client-facing AI answers from. A single rogue or compromised low-trust account (e.g. suporte) can tamper with or destroy other customers' documents, replace a file's bytes while its Firestore metadata/hash and permanent download URL stay unchanged (repudiation), or poison the AI knowledge base for all clients. This violates least privilege and creates a cross-tenant integrity/availability risk. The Firestore side deliberately restricts most writes to the Admin SDK; storage does not mirror that discipline.

**Evidencia:**

```
function isInternal() {
  return hasProfile() && profileRole() in ['owner','admin','interno','wms','financeiro','suporte'];
}
match /agent-knowledge/{allPaths=**} { allow read, write: if isInternal(); }
match /operational-documents/{allPaths=**} { allow read, write: if isInternal(); }
match /product-photos/{allPaths=**} { allow read, write: if isInternal(); }
```

**Correcao sugerida:** Split read from write and delete; restrict write/delete to the roles that own each asset class (e.g. wms/interno/privileged for warehouse assets, coordinator/privileged for agent-knowledge) and prefer routing writes through Cloud Functions with signed URLs (as the client aviso_recebimento path already does). Scope object paths by customer_code and enforce request.auth against it where feasible instead of one global isInternal() gate.

---

### 19. [MEDIO] Archiving/deleting a document does not revoke client access: client_documents read has no visibility gate and retains a permanent download token

**Arquivo:** `firestore.rules:850` | **Dimensao:** Seguranca - Regras Firestore/Storage

client_documents read is `canReadDocumentInternally() || isOwnProjection()` with NO status/visibility filter, unlike operational_notifications which additionally requires status in ['approved','sent']. The projection carries file_url, a permanent Firebase download-token URL that bypasses Storage rules entirely (firebaseDownloadUrl in index.ts:816). When a document is archived, the callable writes an archived stub with { merge: true } (index.ts:4240-4257) that omits file_url, so the previously-projected file_url/storage_path REMAIN in the doc. When a document is hard-deleted (documents delete is allowed for privileged/finance directly in rules at line 846), client_documents is not touched at all. In both cases the client can still GET the projection (customer_code matches isOwnProjection) and re-download via the retained, non-expiring token. Un-sharing or deleting an operational document therefore fails to revoke the customer's access to it.

**Evidencia:**

```
match /client_documents/{documentId} {
  allow read: if canReadDocumentInternally() || isOwnProjection();
  allow create, update, delete: if false;
}
// index.ts archive branch keeps prior file_url via merge:
transaction.set(clientDocumentRef, { id, document_id, customer_code, status:'archived', archived:true, customer_visible:false, visibility:'internal', updated_at:... }, { merge: true });
```

**Correcao sugerida:** Add a visibility/status gate to the client_documents read rule (e.g. require customer_visible == true && archived != true && visibility != 'internal'), and on archive/delete explicitly overwrite/clear file_url, external_url and storage_path in the projection (or delete the projection). Consider signed, time-limited download URLs instead of permanent tokens so revocation is enforceable.

---

### 20. [MEDIO] Prompt injection: attacker-controlled document text auto-activates as agent knowledge and is injected verbatim into the client-facing Agent Dute prompt

**Arquivo:** `functions/src/index.ts:4760` | **Dimensao:** Seguranca - Cloud Functions

extractOperationalDocumentContent marks extracted document text as knowledge with status 'active' whenever documentKnowledgeRequiresApproval() is false (index.ts:4751-4764) - i.e. any non-sensitive text/csv/docx/text-PDF document skips human approval. loadKnowledgeContext then loads all status=='active' knowledge for the customer (index.ts:1758-1761) and generateAgentDuteReply/queryAgentDuteEngine embed that content verbatim into the LLM prompt as 'Contexto autorizado' (index.ts:2039-2047, 2100-2110) for the BTG client-portal chat and daily briefings. Document text is untrusted (uploaded content), so a crafted document can inject instructions that steer the agent that answers customers. Mitigations reduce impact (client uploads route through OCR which does require approval; the ADK agent's tools are read/prepare-only), hence medium.

**Evidencia:**

```
index.ts:4760 const nextKnowledgeStatus = knowledgeId ? (requiresKnowledgeApproval ? 'pending_approval' : 'active') : extractionStatus; index.ts:1758-1761 .where('status','==','active') load; index.ts:2044 `Contexto autorizado: ${stringifyCompact(context, 14000)}` where context.knowledge includes the extracted chunk text.
```

**Correcao sugerida:** Require human approval before ANY extracted document text becomes agent-queryable knowledge (not only 'sensitive' types), and/or wrap injected knowledge in clearly delimited untrusted-content markers with instructions to never follow directives contained inside it.

---

### 21. [MEDIO] Unauthenticated lookupInvite plus predictable Date.now() invite-ID fallback enables invite enumeration/PII disclosure

**Arquivo:** `functions/src/index.ts:3530` | **Dimensao:** Seguranca - Cloud Functions

lookupInvite is the only unauthenticated callable and returns email, nome, role and customer_code for any invite doc whose ID (the token) is known, with no App Check or rate limiting (index.ts:2737-2757). The token is used directly as the document ID. managedDocumentId falls back to String(Date.now()) when an invite is created without input.data.token (index.ts:3529-3530). Although the current frontend generates a strong 144-bit token, any direct/console call to mutateManagedEntity (resource invites, action create) that omits token produces an invite whose ID is a 13-digit millisecond timestamp - trivially enumerable against the open lookup endpoint, leaking invited users' emails, roles and customer codes. A security-capability identifier must never default to a predictable value.

**Evidencia:**

```
index.ts:2737 export const lookupInvite = onCall(async (request) => { ... returns { email, nome, role, customer_code, status } } with no getProfile/auth. index.ts:3503-3506 invites: token = String(input.data.token ?? '').trim(); if (token) return safeDocId(token); index.ts:3530 return String(Date.now());
```

**Correcao sugerida:** Generate invite tokens server-side with crypto.randomUUID()/randomBytes when none is supplied instead of Date.now(), and add App Check + rate limiting to lookupInvite.

---

### 22. [MEDIO] Partial inbound conference overwrites receipt header totals with subset sums

**Arquivo:** `functions/src/domain/operations.ts:3699` | **Dimensao:** Correcao - Dominio de estoque

updateInboundReceiptConferenceTransaction accepts any subset of lines (the zod schema in index.ts line 274 is `lines: z.array(...).min(1)` and the function only requires one line). expectedTotal/receivedTotal/differenceTotal/divergenceCount are computed over the SUBMITTED lines only (lines 3652-3697), then written as the whole receipt's header state: qty_expected is replaced by the subset's expected sum, qty_received by the subset's counted sum, and conference_status becomes 'ok' if the submitted subset had no divergence — even when other lines were never conferred or were previously conferred divergent. A two-batch conference (save line 1, then line 2) leaves the header describing only the last batch. Stock application later recomputes from item rows (advanceWarehouseTaskTransaction receiving), so balances stay correct, but the receipt document — which operators and the events feed use to decide whether to conclude the entry — misreports expected/received/divergence totals.

**Evidencia:**

```
transaction.update(receiptRef, {
      status: "checking",
      qty_expected: expectedTotal || number(receipt.qty_expected),
      qty_received: receivedTotal,
      qty_difference: differenceTotal,
      divergence_count: divergenceCount,
      conference_status: divergenceCount ? "divergent" : "ok",
```

**Correcao sugerida:** After applying the submitted lines, recompute header totals from ALL inbound_items rows of the receipt (they are already loaded into `rows`), merging just-updated values for the submitted subset, so qty_expected/qty_received/divergence_count always reflect the full receipt.

---

### 23. [MEDIO] Missing customer_code silently falls back to the hardcoded tenant "BTG Pactual"

**Arquivo:** `functions/src/domain/operations.ts:4558` | **Dimensao:** Correcao - Dominio de estoque

Both decideCustomerRequestTransaction (line 3858: `const customerCode = text(request.customer_code) || "BTG Pactual";`) and advanceWarehouseTaskTransaction (line 4558) substitute the literal tenant name 'BTG Pactual' whenever the stored doc lacks customer_code. This customerCode is then used to query and MUTATE stock_balances, create movements, reservations, orders and client_inventory projections. In a multi-tenant system, a task or request doc with a missing/blank customer_code (imported data, manual fix, future tenant) would silently read and write another tenant's physical stock instead of failing. Related hardcoding: clientScopedInventoryId special-cases the literal SKU 'BTG-1043' (line 629), splitting that SKU's projection docs by client_item_code — flows that omit client_item_code (e.g. manual movements) write deltas to a different projection doc than flows that supply it, double-counting that SKU in the portal.

**Evidencia:**

```
const targetStatus = nextStatus(type, currentStatus);
    const customerCode = text(task.customer_code) || "BTG Pactual";
```

**Correcao sugerida:** Throw failed-precondition when the source document has no customer_code instead of defaulting to a specific tenant; remove the 'BTG-1043' special case or apply the client_item_code scoping uniformly across all writers of client_inventory.

---

### 24. [MEDIO] advanceWarehouseTask without expected_status can silently execute two transitions on a double-submit

**Arquivo:** `functions/src/domain/operations.ts:4519` | **Dimensao:** Correcao - Dominio de estoque

expected_status is optional whenever an idempotency_key is supplied (lines 4518-4525), and the target status is derived from whatever the CURRENT status is at read time (`nextStatus(type, currentStatus)`, line 4557). Firestore's runTransaction retries the whole closure on write contention with fresh reads. So two near-simultaneous calls with different idempotency keys (e.g. a double-click where the client generates a fresh key per click) and no expected_status do this: call A commits planned→in_progress; call B's transaction conflicts, retries, re-reads status 'in_progress' and commits in_progress→completed. For putaway that second hop is not a status flip — it executes the physical stock transfer (source/destination balance rewrite plus two ledger movements, lines 5042-5187) using quantities from the task doc, without the operator ever confirming completion. The idempotency-receipt mechanism does not protect here because each call has a distinct operationId. Steps with heavy input requirements (picking/packing completion) would fail their confirmation checks, but putaway completion and receiving created→checking→received (when conference is already saved) can chain.

**Evidencia:**

```
const expectedStatus = text(input.expected_status).toLowerCase() || undefined;
  if (!input.idempotency_key && !expectedStatus) {
    throw new HttpsError(
      "invalid-argument",
      "Informe idempotency_key ou expected_status para avançar a tarefa.",
    );
  }
...
    const targetStatus = nextStatus(type, currentStatus);
```

**Correcao sugerida:** Make expected_status mandatory (require both parameters), so a retried/concurrent call fails with 'Status divergente' instead of computing a new target from the post-commit status.

---

### 25. [MEDIO] Movement usage is attributed to competencias by UTC date while the billing domain is defined in America/Sao_Paulo

**Arquivo:** `functions/src/index.ts:3030` | **Dimensao:** Correcao - Faturamento

billing.ts declares DEFAULT_BILLING_TIME_ZONE = "America/Sao_Paulo" and computes/validates competencias with Intl in that zone (competenciaFromDate, assertCompetenciaCanBeOpen; the test 'usa o fuso de Sao Paulo' pins this). But loadBillingCalculation attributes movements to a competencia via billingDate(), which converts Firestore Timestamps with toDate().toISOString() — UTC — and then does a raw startsWith(competencia). São Paulo is UTC-3, so every movement occurring between 21:00 and 23:59 local time on the last day of a month lands in the NEXT competencia's invoice (entradas_pecas, saidas_pecas and mov_count all shift). The frontend preview (cloud-api.ts sameBillingCompetencia/toIso) has the same UTC behavior, so the error is invisible in the UI. Quantities billed per month are wrong at every month boundary, and the error is frozen into the immutable snapshot.

**Evidencia:**

```
function billingDate(value: unknown) {
  ...
    return (value as { toDate: () => Date }).toDate().toISOString(); // UTC
  ...
}
...
    .filter((movement) =>
      billingDate(movement.occurred_at ?? movement.data).startsWith(
        competencia,
      ),
    );
// vs billing.ts:10  DEFAULT_BILLING_TIME_ZONE = "America/Sao_Paulo"
```

**Correcao sugerida:** Convert movement timestamps to the billing competencia with the same Intl/America-Sao_Paulo logic already exported as competenciaFromDate() in billing.ts (billingDate could return competenciaFromDate(ts.toDate()) for the comparison), and mirror the fix in artifacts/btg-inventory/src/lib/cloud-api.ts.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing the full path. (1) The billing domain is genuinely São Paulo-based: functions/src/billing.ts:10 sets DEFAULT_BILLING_TIME_ZONE = "America/Sao_Paulo"; competenciaFromDate (billing.ts:468-487) uses Intl in that zone; assertCompetenciaCanBeOpen is enforced at period creation (billing.ts:542) and inside invoice emission (billing.ts:728); billing.test.ts:103-113 pins that 2026-08-01T02:30:00Z maps to competencia "2026-07". (2) Attribution is UTC: billingDate (index.ts:2922-2933) returns Timestamps as toDate().toISOString() and strings as-is; movements store occurred_at as new Date().toISOString() (UTC) in operations.ts:457/871/1352/2539 and index.ts flows; the filter at index.ts:3027-3033 does a raw startsWith(competencia). So a movement at 22:00 local on July 31 (occurred_at "2026-08-01T01:00:00.000Z") is excluded from "2026-07" and included in "2026-08", contradicting the domain's own definition. (3) No mitigation: competenciaFromDate is never used for movement attribution (grep confirms only billing.ts/test); the post-cutover filter isBillablePostCutoverMovement (index.ts:2940-2948) filters only by source; emitBillingInvoice (index.ts:5892-5929) freezes loadBillingCalculation output into the immutable invoice snapshot (INVOICE_SNAPSHOT_FIELD / SNAPSHOT_ALREADY_EXISTS guard); the frontend toIso (cloud-api.ts:145-167) and sameBillingCompetencia (cloud-api.ts:3574-3576) replicate the UTC startsWith, making the shift invisible in the UI. Severity lowered to medium: movements are shifted to the adjacent competencia, never lost or double-counted; exposure is only the 21:00-23:59 local window on the last day of each month (3 hours, no DST in Brazil); ad-valorem/custo_estoque is unaffected. Still a real financial-attribution defect frozen into immutable invoices.

</details>

---

### 26. [MEDIO] Unknown or unfed auto_source silently bills quantity 0 — pallet/transporte/etiquetagem lines always emit as R$0

**Arquivo:** `functions/src/billing.ts:653` | **Dimensao:** Correcao - Faturamento

calculateLpuLines defaults a missing metric for an auto line to zero instead of failing: metrics.get(autoSource) ?? { coefficient: 0n, scale: 0 }. The production caller (loadBillingCalculation, index.ts:3074-3107) only ever populates custo_estoque, entradas_pecas, saidas_pecas and movimentacoes — it never supplies pallets, transportes, etiquetas, nor usage.metrics, and aggregateBillingMetrics/BillingMetricEvent are never invoked outside tests. Meanwhile BILLING_AUTO_SOURCES advertises pallet/transporte/etiquetagem as first-class sources and the admin write path accepts auto_source as a free-form string with no whitelist (BILLING_PRICE_WRITE_FIELDS, index.ts:3173-3181; no validation at index.ts:3724-3737). Any LPU item configured with one of those sources — or any typo like 'mov_entrada' — emits an immutable invoice line of qtde 0 / R$0 with no error, a silent permanent undercharge.

**Evidencia:**

```
const quantity = autoSource
      ? (metrics.get(autoSource) ?? { coefficient: 0n, scale: 0 })
      : parseDecimal(manual?.qtde ?? 0, `quantidade do item ${key}`);
// index.ts currentUsage = { custo_estoque, entradas_pecas, saidas_pecas, movimentacoes } — pallets/transportes/etiquetas/metrics never set
```

**Correcao sugerida:** Throw a BillingDomainError (e.g. UNKNOWN_AUTO_SOURCE) when an active LPU item references an auto_source that has no metric entry, and validate auto_source against BILLING_AUTO_SOURCES (plus known custom metrics) in the billing_price_list admin write path.

<details><summary>Verificacao adversarial (confirmado)</summary>

Every element of the claim checks out in the code. billing.ts:652-654 does default an unmatched auto_source to quantity 0 ({ coefficient: 0n, scale: 0 }) with no error, and the auto branch also ignores any manual quantity for that item. loadBillingCalculation (index.ts:3074-3107) only ever populates custo_estoque/entradas_pecas/saidas_pecas/movimentacoes in every mode (currentUsage, snapshot replace, snapshot baseline) — pallets/transportes/etiquetas/usage.metrics are never fed, and aggregateBillingMetrics/BillingMetricEvent appear only in billing.test.ts. The write path (index.ts:3724-3757, shared with the managed-mutation path at 4290-4300 via BILLING_PRICE_WRITE_FIELDS) accepts auto_source as a free-form string; BILLING_AUTO_SOURCES is never used as a whitelist anywhere, despite exporting pallet/transporte/etiquetagem as first-class source names. Once emitted, the snapshot is immutable (prepareInvoiceEmission blocks re-emission via SNAPSHOT_ALREADY_EXISTS), so a zero line is a permanent silent undercharge. The concrete path is traceable end-to-end: set auto_source="pallet" via the callable API (nothing rejects it, and the domain layer itself advertises the value), then emitBillingInvoice bills that line at qty 0/R$0 with auto:true. However, severity is overstated at high: the admin UI Select (price-list.tsx:190-198) only offers the four fed sources, so the misconfiguration cannot happen through the normal UI; and the production backup (.backups/billing-cutover-20260722T055138Z.json) shows all current LPU items have auto_source null or ad_valorem — the "Etiquetagem" item is a manual line. The client preview (cloud-api.ts:3941-3958) mirrors the same 4-source behavior, so nothing currently emits R$0 lines in production. It is a real latent data-integrity defect (silent-zero billing on immutable invoices, invited by the misleading BILLING_AUTO_SOURCES constants and absent validation), not an actively firing bug — medium, not high.

</details>

---

### 27. [MEDIO] The current (incomplete) month can be emitted at any time, and emission is irreversible by design

**Arquivo:** `functions/src/billing.ts:728` | **Dimensao:** Correcao - Faturamento

buildInvoiceSnapshot gates emission only with assertCompetenciaCanBeOpen, which merely forbids FUTURE competencias (competencia > current). Emitting the current month on day 1 is fully allowed, snapshotting partial usage. Once emitted, the design makes it permanent: allowedTransitions has no path out of 'emitido' except 'pago', prepareInvoiceEmission returns the persisted snapshot idempotently for 'emitido' periods, and a lingering snapshot on an open period throws SNAPSHOT_ALREADY_EXISTS. So one accidental click of 'emitir' in the first days of a month permanently freezes that month's invoice at near-zero usage with no reopen/cancel/amend code path anywhere in index.ts.

**Evidencia:**

```
export function buildInvoiceSnapshot(
  input: BillingCalculationInput,
  options: InvoiceEmissionOptions,
): Readonly<InvoiceSnapshot> {
  assertCompetenciaCanBeOpen(input.competencia, options.issuedAt); // only blocks competencia > current
...
const allowedTransitions = {
  aberto: ["emitido"],
  emitido: ["pago"],
  pago: [],
};
```

**Correcao sugerida:** Require competencia < competenciaFromDate(issuedAt) for emission (only closed months can be invoiced), or add an explicit confirmed override flag; alternatively add an audited admin-only 'reopen' transition that voids the snapshot.

---

### 28. [MEDIO] Pre-cutover movement classification can count the same movement as both entrada and saida

**Arquivo:** `functions/src/index.ts:3052` | **Dimensao:** Correcao - Faturamento

When no operational snapshot exists, the incoming filter is `sinal > 0 || tipo_mov === "ENTRADA"` and the outgoing filter is `sinal < 0 || tipo_mov === "SAIDA"`. These predicates are not mutually exclusive: a legacy movement with sinal > 0 but tipo_mov 'SAIDA' (or sinal < 0 with tipo_mov 'ENTRADA') matches BOTH filters, so its quantity is added to entradas_pecas AND saidas_pecas — double billing for exactly the kind of inconsistent legacy rows this fallback branch exists to handle. Additionally movimentacoes counts every movement in the month (movements.length) including rows matching neither predicate (adjustments, sinal 0), inflating the mov_count line.

**Evidencia:**

```
const incomingPieces = movements
    .filter((movement) =>
      operationalSnapshot.exists
        ? isBillablePostCutoverMovement(movement, "incoming")
        : Number(movement.sinal ?? movement.sign ?? 0) > 0 ||
          String(movement.tipo_mov ?? "").toUpperCase() === "ENTRADA",
    )
// outgoing uses: sinal < 0 || tipo_mov === "SAIDA"  — not exclusive with the above
```

**Correcao sugerida:** Classify each movement exactly once: derive a single direction per movement (prefer sinal when present, else tipo_mov, else skip) and count entradas/saidas/movimentacoes from that single classification.

---

### 29. [MEDIO] Invoice emission transaction reads the customer's entire movement history on every call

**Arquivo:** `functions/src/index.ts:2978` | **Dimensao:** Correcao - Faturamento

movementsQuery filters only by customer_code — no competencia/date bound — and is executed inside db.runTransaction via transaction.get, with the month filter applied afterwards in memory (billingDate(...).startsWith). Every emission therefore reads the full, monotonically growing movements collection for the customer inside a serializable transaction. Beyond latency and read cost, any concurrent movement write during emission invalidates the transaction and forces a full re-read retry, and the function will eventually hit transaction size/time limits as history grows — making month-end emission (exactly when movements are being written) increasingly likely to fail.

**Evidencia:**

```
const movementsQuery = db
    .collection(collectionNames.movements)
    .where("customer_code", "==", customerCode);
...
  const movementsSnapshot = transaction
    ? await transaction.get(movementsQuery)
    : await movementsQuery.get();
...
    .filter((movement) =>
      billingDate(movement.occurred_at ?? movement.data).startsWith(competencia))
```

**Correcao sugerida:** Add range conditions to the query (occurred_at >= monthStart && < nextMonthStart in the billing timezone, with a supporting index), or maintain pre-aggregated per-competencia usage counters written transactionally by the movement pipeline so emission reads a single document.

---

### 30. [MEDIO] Manual quantities are silently dropped when the referenced LPU item is archived or missing

**Arquivo:** `functions/src/billing.ts:636` | **Dimensao:** Correcao - Faturamento

calculateLpuLines iterates active price-list items (ativo !== false) and only consumes manualByItem entries for those items; a manual quantity whose price_list_id points to an archived or deleted LPU item is ignored with no error. saveBillingManual (index.ts:5842-5852) writes input.items to billing_manual without validating that each price_list_id exists and is active, so an operator can record billable quantities, someone archives the item, and the emitted immutable invoice silently omits the charge. Relatedly, SaveBillingManualSchema (index.ts:394-405) does not reject duplicate price_list_id entries, so a save succeeds but the later emission fails with DUPLICATE_MANUAL_QUANTITY — validation happens at the wrong stage in both directions.

**Evidencia:**

```
const activeItems = input.priceList.filter((item) => item.ativo !== false);
...
  return [...activeItems].sort(compareLpuItems).map((item) => {
    ...
    const manual = manualByItem.get(key); // manual rows whose item is inactive/absent are never read
```

**Correcao sugerida:** In saveBillingManual, validate each price_list_id against the active price list and reject duplicates at save time; in calculateLpuLines, throw (or at least return a warning) when a manual quantity references no active LPU item instead of silently dropping it.

---

### 31. [MEDIO] lineConfirmations map is never invalidated — stale local marks override fresh server state indefinitely

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:1082` | **Dimensao:** Frontend - Warehouse Ops

getLineResolution gives local `confirmations[key]` precedence over the server-derived status (`inferLineResolution`). The map is only ever written to (handleLineConfirmationChange, lines 8155-8164) and is never cleared — not when a task advances, not when the exception is resolved server-side, not when polled data changes the item's status. Concrete desync: an operator marks a line 'shortage', registers the exception, the exception is resolved in ExceptionWorkspace (or by another user) and the refetched item now carries a confirmed/resolved status — but getAdvanceGate still sees `lineIssue` from the stale local 'shortage' mark and keeps advance blocked ('Há falta ou avaria marcada...') until a full page reload. The inverse also holds: a locally-marked 'confirmed' line keeps reading confirmed even if the server later flags it divergent. The map also grows unboundedly across the session. This is a textbook optimistic-state/Firestore desync: local UI assertions with no reconciliation or TTL against the polled source of truth.

**Evidencia:**

```
function getLineResolution(taskId, row, confirmations) {
  return (
    confirmations[lineConfirmationKey(taskId, row.id)] ?? inferLineResolution(row)
  );
}
// setLineConfirmations is only ever additive:
setLineConfirmations((current) => ({ ...current, [lineConfirmationKey(taskId, rowId)]: resolution }));
```

**Correcao sugerida:** Clear the task's entries from the map on successful advanceTask/registerException (onSuccess), and reconcile on refetch: if inferLineResolution(row) is terminal (confirmed/resolved) drop the local override. Scoping the map per task.id inside TaskDetailPanel (reset on task change) would also bound growth.

---

### 32. [MEDIO] Exception dialog and detail panel silently retarget to a different task when polled data changes

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:8040` | **Dimensao:** Frontend - Warehouse Ops

Both selection resolutions use a fallback chain: `selectedTaskEntry = moduleTaskEntries.find(id === selectedTaskId) ?? moduleDefaultTaskEntry` and `exceptionTaskEntry = taskEntries.find(id === exceptionTaskId) ?? selectedTaskEntry`. queueEntries filters out terminal tasks, and the ops query repolls every 30s. Race: an operator opens the exception dialog for task X and types a note; before submit, a background poll returns X as completed/cancelled (advanced by a colleague or by their own just-finished advance) — X vanishes from taskEntries, exceptionTaskEntry silently becomes selectedTaskEntry (a different task), and handleExceptionSubmit posts the exception, severity, and X's note against the wrong task's `/api/warehouse/tasks/{id}/exception` endpoint. The same fallback makes the sticky TaskDetailPanel swap to moduleDefaultTaskEntry (which prefers blocked/critical tasks) mid-interaction whenever the selected task leaves the module scope, with no notice to the user.

**Evidencia:**

```
const selectedTaskEntry =
  moduleTaskEntries.find(({ task }) => task.id === selectedTaskId) ??
  moduleDefaultTaskEntry;
const exceptionTaskEntry =
  taskEntries.find(({ task }) => task.id === exceptionTaskId) ?? selectedTaskEntry;
...
function handleExceptionSubmit(event) {
  if (!exceptionTaskEntry) return;
  registerException.mutate({ task: exceptionTaskEntry.task, ... });
}
```

**Correcao sugerida:** For the dialog, snapshot the full task entry into state when opening (setExceptionTask(entry)) instead of re-resolving by id each render; if the id can no longer be found on submit, abort with a toast ('tarefa não está mais aberta'). For the detail panel, keep the explicit selection and show an inline 'task no longer in this queue' state rather than silently switching.

---

### 33. [MEDIO] Photo-upload race in UnplannedReceiptDialog: async updates target lines by captured index while lines can be removed (list also keyed by index)

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4104` | **Dimensao:** Frontend - Warehouse Ops

addPhotos captures the numeric `index` at invocation, awaits the uploads (multi-second PUT to signed URLs), then applies results with `lineIndex === index`. If the user deletes any earlier line while an upload is in flight (removeLine, line 4096, filters by index — nothing disables it during upload), all subsequent lines shift down and the resolved photos (and the photoUploading:false reset) are written onto the wrong line — attaching product photos, which are mandatory evidence for creating a new product, to a different SKU's draft. The rendered list also uses `key={index}` (line 4311), so React reconciles rows by position, compounding misattribution of transient UI state on removal. The submit gate only checks `photoUploading` per line, so a mis-assigned upload state can also leave a phantom line stuck 'Enviando...'. Photos uploaded to Storage for a removed line are orphaned with no cleanup.

**Evidencia:**

```
async function addPhotos(index: number, files: FileList | null) {
  ...
  updateLine(index, { photoUploading: true });
  const uploaded = await Promise.all(selected.map((file) => uploadProductPhoto(file, clientItemCode)));
  setLines((current) => current.map((currentLine, lineIndex) => lineIndex === index ? { ...currentLine, photos: [...], photoUploading: false } : currentLine));
}
...
{lines.map((line, index) => (<div key={index} ...>
```

**Correcao sugerida:** Give each ReceiptDraftLine a stable uid (crypto.randomUUID() in emptyReceiptLine), key the list by it, and address async updates by uid instead of index. Disable line removal (or the whole line row) while that line's photoUploading is true.

---

### 34. [MEDIO] Product catalog (2x 5000-row endpoints) fetched under four separate query keys and scanned O(lines x 10k) on every keystroke

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4208` | **Dimensao:** Frontend - Warehouse Ops

Four independent useQuery keys — 'receiving-product-lookup' (line 4063, no limit param), 'opening-inventory-product-lookup' (line 4754), 'cycle-count-product-lookup' (line 5631), 'returns-product-lookup' (line 6400) — each fetch `/api/skus?limit=5000` + `/api/products?limit=5000` and re-run mergeProductLookup over the full set, so the same ~10k records are downloaded and merged up to four times per session with staleTimes of only 30-60s. Worse, in UnplannedReceiptDialog the `lineIssues` array (line 4208) is computed inline on every render — i.e., on every keystroke in any input — and for each draft line calls findExistingProduct (linear filter over all products, lines 3583-3612) plus similarProductNames, which runs normalizeSlug (NFD normalize + 3 regex passes) on every product name (lines 3614-3623). With a 5000-product catalog and a handful of lines, each keystroke performs on the order of 10^5 regex/normalize operations twice (once in submit-validation shape at 4138, once at 4208), producing visible input lag on the warehouse tablets this screen targets. ReturnWorkspace has the same inline pattern (line 6446).

**Evidencia:**

```
const lineIssues = lines.map((line, index) => {
  ...
  const existing = findExistingProduct(line, productLookup);      // O(products) per line per render
  const similar = existing ? [] : similarProductNames(line, productLookup); // normalizeSlug over every product name
  ...
});
// four duplicated queries:
queryKey: ["receiving-product-lookup"] ... fetchJson("/api/skus"), fetchJson("/api/products")
queryKey: ["opening-inventory-product-lookup"] ... "/api/skus?limit=5000", "/api/products?limit=5000"
```

**Correcao sugerida:** Extract a single useProductLookup() hook with one shared query key and a longer staleTime; index the result once in Maps keyed by normalized clientCode/skuCode so findExistingProduct is O(1); precompute normalizeSlug(productName) once per product; wrap lineIssues in useMemo keyed on [lines, lookup] and debounce the similar-name search.

---

### 35. [MEDIO] 8,440-line monolith with two divergent advance paths; concrete extraction boundaries

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:1` | **Dimensao:** Frontend - Warehouse Ops

warehouse-ops.tsx contains ~40 components, 5 mutation flows, and a pure domain layer in one file; client-portal.tsx (4,189 lines) duplicates its formatters, queue aliases, and status maps. The monolith is already causing behavior drift: the receiving module renders ReceivingCommandCenter whose 'Concluir entrada' calls `onAdvance(task.id)` with no operation/note (line 8305: `advanceTask.mutate({ id: taskId })`), bypassing the checklist gate and the mandatory >=12-char divergence justification that TaskDetailPanel enforces for the same transition (getAdvanceGate + requiresReceivingJustification, lines 7489-7545) — the stricter path is effectively dead code for the receiving module, leaving the backend as the only guard. Highest-value extraction boundaries: (1) lines 73-1356 — types, QUEUE_META/aliases, normalizeQueues, deriveMetrics, sortTasks, line-resolution logic (getPackingCheckRows, getLineResolution, buildPicking/PackingOperation, getAdvanceGate) → pure `lib/warehouse-ops/model.ts`, unit-testable, shared with client-portal; (2) lines 3434-4629 + 7044-7337 — receiving: ReceiptDraftLine, uploadProductPhoto, product-lookup helpers, ReceivingCommandCenter, UnplannedReceiptDialog, ReceivingConferenceSection → `features/receiving/` with one shared useProductLookup + useAdvanceTask hook so both advance buttons share gating; (3) lines 4631-5942 — CycleCountWorkspace, OpeningInventoryWorkspace, ExistingCycleCountWorkspace (already an early-return standalone page at line 8177) → `features/inventory/`; (4) lines 5944-7042 — ExceptionWorkspace and ReturnWorkspace (self-contained queries/mutations) → `features/exceptions/` and `features/returns/`; (5) lines 2109-3432 + 7339-7808 — TaskDetailPanel and its five per-queue sections (Putaway/Picking/Packing/Expedition/Checklist) → `features/task-detail/`, receiving the mutations via props/hooks. That leaves the default export (~lines 7976-8440) as a thin orchestrator.

**Evidencia:**

```
// ReceivingCommandCenter path (line 8305) — no operation, no note, no gate:
onAdvance={(taskId) => advanceTask.mutate({ id: taskId })}
// TaskDetailPanel path for the same receiving transition (7541-7545):
: requiresReceivingJustification && receivingAdvanceNote.trim().length < 12
  ? "Justifique a divergência física antes de concluir o recebimento."
```

**Correcao sugerida:** Split along the five boundaries above (each already has zero JSX coupling to the others — they communicate only through the mutations and selection callbacks defined in the root component). Centralize advance gating in a useAdvanceTask hook consumed by both ReceivingTaskDetailCard and TaskDetailPanel so the justification/checklist rules cannot diverge again, and move the duplicated formatters/status maps shared with client-portal.tsx into lib/.

---

### 36. [MEDIO] Client-side ledger fallback is non-transactional and silently clamps stock discrepancies to zero

**Arquivo:** `artifacts/btg-inventory/src/lib/cloud-api.ts:3250` | **Dimensao:** Frontend - Camada de dados

The duplicated client implementations of the inventory ledger (live whenever the app is not built in functions mode, and in emulator/dev) use read-then-writeBatch instead of runTransaction: createMovement reads estoque_atual (line 956) and later commits a batch computed from that stale value — two concurrent movements lose an update; advanceWarehouseTask reads stock balances via readWhereEqual (3222-3229) outside any transaction, then batch-writes new qty_on_hand; syncProductAggregate (867-933) recomputes product totals from a non-transactional SKU scan. Worse, the shipping-delivered branch clamps negatives: Math.max(0, previousOnHand - quantity) and Math.max(0, qty_reserved - quantity), so shipping more than is on hand silently zeroes the balance and writes a movement whose saldo_delta no longer reconciles with the balance change — corrupting the very ledger invariant the recent 'enforce transactional inventory ledger' commit added server-side. This whole reimplementation inevitably drifts from functions/src/domain/operations.ts.

**Evidencia:**

```
cloud-api.ts:3249-3253: const previousOnHand = Number(balance.qty_on_hand ?? 0); const nextOnHand = Math.max(0, previousOnHand - quantity); const nextReserved = Math.max(0, Number(balance.qty_reserved ?? 0) - quantity);  — inside a writeBatch built from readWhereEqual results (3222-3229), not a transaction. createMovement: 956-957 const previousStock = Number(skuData.estoque_atual ?? 0); const nextStock = previousStock + sign * quantity; then batch.commit() at 1018.
```

**Correcao sugerida:** Delete these client fallbacks once routing is fixed (finding 1); if any must remain for local/emulator use, wrap them in runTransaction and surface over-consumption as an error/exception record instead of clamping to zero.

---

### 37. [MEDIO] onAuthStateChanged race: stale signed-in state and leaked profile onSnapshot listener

**Arquivo:** `artifacts/btg-inventory/src/lib/auth.tsx:141` | **Dimensao:** Frontend - Camada de dados

The async auth callback awaits loadProfile() (a network getDoc) before setting state and subscribing the profile listener. If the auth state changes again during that await, the callbacks interleave: (A) sign-in for user X starts and awaits; (B) sign-out fires, unsubscribes nothing (listener not yet created) and sets signed-out state; (A) resumes and overwrites state with user X — the UI shows an authenticated session after sign-out (RealtimeSyncBridge then opens listeners with no auth, producing permission-denied storms) — and registers a users/{uid} onSnapshot for the stale user. In a sign-out→sign-in sequence, the late continuation's `unsubscribeProfile = onSnapshot(...)` assignment overwrites the newer listener's unsubscribe reference, permanently leaking the newer subscription. There is no generation/sequence guard to discard stale continuations.

**Evidencia:**

```
auth.tsx:127-160: const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => { unsubscribeProfile?.(); unsubscribeProfile = undefined; ... const role = await loadProfile(firebaseUser); ... setState({ firebaseUser, user: toAppUser(firebaseUser, role), ... }); unsubscribeProfile = onSnapshot(doc(firestore, "users", firebaseUser.uid), ...); });  — no check that firebaseUser is still auth.currentUser after the await.
```

**Correcao sugerida:** Track a monotonically increasing generation (or compare firebaseUser.uid against auth.currentUser?.uid) after the await and bail out if stale; only assign unsubscribeProfile if the continuation is still current, otherwise immediately unsubscribe the just-created listener.

---

### 38. [MEDIO] callFunctionsApi flattens every backend error to HTTP 500, discarding HttpsError codes

**Arquivo:** `artifacts/btg-inventory/src/lib/functions-api.ts:609` | **Dimensao:** Frontend - Camada de dados

The catch block around httpsCallable converts all failures — including domain errors the backend deliberately raises as HttpsError('failed-precondition' | 'already-exists' | 'permission-denied' | 'not-found'), e.g. insufficient stock or an already-decided request — into a generic 500 with only error.message. Callers can no longer distinguish a business-rule rejection from a real server fault: react-query retries queries on 5xx-style failures (retry: 1 configured in customer-requests.tsx:911), UI code that would branch on 404/409 cannot, and the FirebaseError 'details' payload is dropped entirely. Meanwhile route.status ?? 200 is applied only on success, so the whole 4xx range is unreachable through this adapter even though the cloud-api fallback carefully maps RouteError statuses (400/404/409) — the two paths present the same failure differently to the same page code.

**Evidencia:**

```
functions-api.ts:602-615: try { const callable = httpsCallable(getFunctions(firebaseApp, "southamerica-east1"), route.name); const result = await callable(await route.payload(pathname, init)); return response(result.data, route.status ?? 200); } catch (error) { const message = error instanceof Error ? error.message : "Erro ao chamar Firebase Functions."; return response({ message }, 500); }
```

**Correcao sugerida:** Map FirebaseError.code to HTTP statuses (invalid-argument→400, permission-denied→403, not-found→404, already-exists/aborted/failed-precondition→409, resource-exhausted→429, else 500) and pass through error.details in the JSON body.

---

### 39. [MEDIO] Date.now() used as Firestore document ID for movements, products and generic creates — same-millisecond writes silently overwrite each other

**Arquivo:** `artifacts/btg-inventory/src/lib/cloud-api.ts:966` | **Dimensao:** Frontend - Camada de dados

createMovement uses const movementId = Date.now() and writes with batch.set(doc(movements, String(movementId))) — setDoc semantics mean a second movement created in the same millisecond (two operators, a double-click retry, or a bulk import loop) targets the same document and silently replaces the first ledger entry instead of failing. The same pattern is used for the generic createItem path (line 762: const id = data.id ?? Date.now(), used by POST /api/import in a tight loop at 4767-4771, virtually guaranteeing collisions within a batch import) and for product aggregates (line 927). Because these are ledger records used for billing (movements drive incoming/outgoing piece counts in getBillingPeriod), an overwrite is unrecoverable, unlogged data loss wherever this code path executes (non-functions builds, emulator, or if rules are relaxed).

**Evidencia:**

```
cloud-api.ts:966: const movementId = Date.now(); ... 986-989: batch.set(doc(firestore, collectionNames.movements, String(movementId)), payload);  and 762: const id = data.id ?? Date.now(); ... 769: await setDoc(doc(firestore, name, String(id)), payload);  — /api/import loop at 4767-4771 calls createItem per item with no id.
```

**Correcao sugerida:** Use collision-safe IDs everywhere (the existing newDocId() helper with a random suffix, or doc(collection(...)) auto-IDs), and for ledger writes prefer create-only semantics (transaction with existence check) so a collision fails instead of overwriting.

---

### 40. [MEDIO] ai-control 'Sincronizar dados reais' action cannot succeed in any configuration; its fallback is an unguarded browser bulk-write of core inventory collections

**Arquivo:** `artifacts/btg-inventory/src/pages/ai-control.tsx:1934` | **Dimensao:** Frontend - Portal do cliente

The syncRealFoundation mutation POSTs /api/operational/sync-real-foundation. With the shipped config (.env.example line 7: VITE_API_MODE=functions), shouldUseFunctionsApi() returns true for every /api call, but functions-api.ts functionRoute() has no route for this path, so callFunctionsApi() returns a hard 501 ('FUNCTION_ROUTE_REQUIRED') — the button always fails with the toast 'Erro ao preparar fundação operacional'. In SDK mode the client-side handler cloud-api.ts syncRealOperationalFoundation() (lines 3503-3532) bulk-writes from the BROWSER into customers, customer_accounts, locations, stock_balances, inbound_receipts, order_items, pick_tasks and pack_tasks — every one of which is 'allow create, update, delete: if false' in firestore.rules (e.g. stock_balances at line 722), so it fails with permission-denied too. A primary admin control is dead in production, and the only thing preventing a browser from rewriting the operational stock foundation (no role check exists anywhere in the client handler) is the Firestore rules backstop — if a rule is ever loosened, this path silently becomes a client-side stock-ledger writer.

**Evidencia:**

```
ai-control.tsx:1936 fetchJson<RealFoundationSyncResult>("/api/operational/sync-real-foundation", { method: "POST" }) — functions-api.ts:589-597: if (method !== "GET" && import.meta.env.VITE_API_MODE === "functions") { return response({ message: "Esta alteração exige uma Cloud Function autorizada e não possui rota de backend.", code: "FUNCTION_ROUTE_REQUIRED" }, 501); } — cloud-api.ts:3527 commitOperationalRecords(collectionNames.stockBalances, stockBalances) vs firestore.rules:722-724 match /stock_balances/{balanceId} { allow read: if canReadOperations(); allow create, update, delete: if false; }
```

**Correcao sugerida:** Either implement a syncRealFoundation Cloud Function and register it in functionRoute()/shouldUseFunctionsApi(), or remove the button and the client-side syncRealOperationalFoundation()/commitOperationalRecords() bulk-write path entirely so privileged foundation writes can only ever exist server-side.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed every link in the claimed failure path by reading the code. (1) ai-control.tsx:1934-1938 POSTs /api/operational/sync-real-foundation via fetchJson (defined at ai-control.tsx:315-322, which throws on any non-ok response), and the button is wired at line 2445. (2) The window.fetch shim installed by installCloudApi (cloud-api.ts:4863-4907, called from main.tsx:9) intercepts every /api/* request in the browser — it never falls through to originalFetch for /api paths, so no nginx/Cloud Run backend can serve this route. (3) In the shipped config (.env.example:7 VITE_API_MODE=functions), shouldUseFunctionsApi returns true for all /api calls (functions-api.ts:576-577); I read functionRoute in full (functions-api.ts:44-515) and there is no route for this path, so callFunctionsApi returns the hard 501 FUNCTION_ROUTE_REQUIRED (lines 588-598) — the button always fails. (4) Grep for 'foundation' in functions/src returns zero matches — no Cloud Function implements this under any name. (5) In SDK mode, route() (cloud-api.ts:4315-4320) dispatches to syncRealOperationalFoundation (3503-3532), which uses client-SDK writeBatch (3467-3496) to write into customers, customer_accounts, locations, stock_balances, inbound_receipts, order_items, pick_tasks, pack_tasks — with no role/auth check anywhere in that handler path. (6) firestore.rules denies create/update/delete on all eight collections (e.g. stock_balances at 722-725: 'allow create, update, delete: if false'), and the catch-all at 866-868 is 'allow read, write: if false' with no admin wildcard override — so SDK mode fails with permission-denied. The feature therefore cannot succeed in any configuration, exactly as claimed. Severity adjusted from high to medium: the concrete production impact is a dead admin control that fails loudly (toast), and the dangerous client-side bulk-write path is currently fully blocked by rules — it is a real defense-in-depth hazard (single rules change away from a browser-side stock-ledger writer with no role check), but there is no exploitable data-integrity breach today.

</details>

---

### 41. [MEDIO] Hardcoded 'BTG Pactual' tenant attribution in ai-control writes breaks multi-tenant event integrity

**Arquivo:** `artifacts/btg-inventory/src/pages/ai-control.tsx:1904` | **Dimensao:** Frontend - Portal do cliente

The operator-note mutation stamps every event with customer_code: 'BTG Pactual' regardless of which tenant the note is actually about, and the notification sync mutation (line 1966) hardcodes the same tenant in its request body ({ customer_code: 'BTG Pactual', limit: 250 }). The same literal is used as a display fallback ('item.customer_code || "BTG Pactual"', line 1565) and in the client portal (assistente.tsx:365 firstText(overview.customer?.code, 'BTG Pactual'); agente-operacional.tsx:150). Because these events feed the AI ledger, agent memory (keyed 'cliente_<customer_code>') and the notification pipeline whose drafts carry customer_code and recipients, every operator note and sync is permanently attributed to one customer. For a product positioned as multi-tenant SaaS this poisons per-customer memory/analytics and risks operational notifications being prepared for the wrong tenant.

**Evidencia:**

```
ai-control.tsx:1896-1906 body: JSON.stringify({ type: "operator.note", ... entity_id: "dutelog", customer_code: "BTG Pactual", source: "operator_note" }) and ai-control.tsx:1966 body: JSON.stringify({ customer_code: "BTG Pactual", limit: 250 })
```

**Correcao sugerida:** Derive the tenant from an explicit selector in the UI (or from the entity the note refers to) and pass no default; have the server reject events without a valid customer_code instead of letting the client hardcode one.

---

### 42. [MEDIO] Estoque 'Arquivar' is client-local state that vanishes on reload, and the generated request is invisible in every portal list

**Arquivo:** `artifacts/btg-inventory/src/pages/client/estoque.tsx:137` | **Dimensao:** Frontend - Portal do cliente

requestArchive() sends a type 'suporte' request with items: [] (buildArchiveRequest, lines 2006-2019) and then only adds the product key to the local React state archivedProductKeys (lines 180-188). The toast tells the client 'O produto foi ocultado da vitrine e segue preservado no historico', but the hiding is a useState Set — on page reload the product reappears and the 'Arquivados' filter is empty, inviting duplicate archive requests. Worse, the client can never track the request: solicitacoes.tsx isInboundRequest() only matches 'recebimento/fornecedor/chegada' and pedidos.tsx isOutboundRequest() only matches 'retirada/pedido do estoque/pedido de entrega', so a 'suporte'-type archive request appears in neither Recebimentos nor Pedidos. The client's action effectively disappears from their own portal while state silently diverges between what the UI claims and what persisted.

**Evidencia:**

```
estoque.tsx:137-139 const [archivedProductKeys, setArchivedProductKeys] = useState<Set<string>>(() => new Set()); estoque.tsx:180-188 onSuccess: ({ action, productKey }) => { if (action === "archive") { setArchivedProductKeys((current) => { const next = new Set(current); next.add(productKey); ... } with toast description "O produto foi ocultado da vitrine e segue preservado no historico."; estoque.tsx:2010 type: "suporte", ... items: []
```

**Correcao sugerida:** Persist the archived flag server-side (e.g. a customer-scoped 'hidden_products' projection the overview returns) or at minimum derive the archived set from the customer's own pending 'suporte' archive requests so it survives reload and shows in Solicitações.

---

### 43. [MEDIO] Pedidos page displays closed/encerrado orders as 'Recebido' — status label map contradicts its own status sets

**Arquivo:** `artifacts/btg-inventory/src/pages/client/pedidos.tsx:1233` | **Dimensao:** Frontend - Portal do cliente

statusText() maps a fixed list of statuses and defaults everything else to 'Recebido' (the first stage of the pipeline). 'closed' and 'encerrado' are treated as terminal by CLOSED_STATUSES (lines 166-178) and 'closed' as shipped by SHIPPED_STATUSES (line 163), but neither appears in statusText's 'Entregue' list ('delivered','entregue','completed','complete','concluido','concluida'), so a finished order renders a status badge saying it was just received by Dutelog. The metrics cards and the row badges therefore disagree: the same 'closed' order is excluded from 'Em aberto' and counted under 'Enviados', while its visible badge says 'Recebido'. For the customer-facing tracking page this is actively misleading about delivery state.

**Evidencia:**

```
pedidos.tsx:1233-1252 function statusText(status) { ... if (["delivered", "entregue", "completed", "complete", "concluido", "concluida"].includes(normalized)) { return "Entregue"; } ... return "Recebido"; } vs pedidos.tsx:166-178 const CLOSED_STATUSES = new Set(["closed", "encerrado", "concluido", "completed", "entregue", "delivered", ...]);
```

**Correcao sugerida:** Add 'closed'/'encerrado' (and any other members of CLOSED_STATUSES/SHIPPED_STATUSES) to the appropriate branches of statusText, or derive the label from the same status sets used for the metrics so they cannot diverge.

---

### 44. [MEDIO] Every CRUD write is amplified into 4+ sequential reads and up to 5 writes via event/agent-memory bookkeeping

**Arquivo:** `artifacts/btg-inventory/src/lib/cloud-api.ts:787` | **Dimensao:** Performance

updateItem() performs: findDocRef (a getDoc, plus a fallback where('id','==') query scan on miss), a second getDoc for 'before', the updateDoc, a third getDoc to re-read 'after', then emitEvent — which writes an events doc, conditionally an ai_agent_inbox doc, and updateAgentMemory writes up to 2 ai_agent_memory docs. All of this is sequential awaits, so one field update costs ~4 round-trip reads + up to 5 document writes of latency before the UI unblocks. createItem and deleteItem have the same emitEvent tail. Because events, ai_agent_inbox and ai_agent_memory are all in the realtime bridge's subscribed collection list, each of these bookkeeping writes independently re-triggers the global cache invalidation from finding 3 — write amplification feeding read amplification.

**Evidencia:**

```
cloud-api.ts:787-796:
async function updateItem(name: string, id: string | number, data: AnyRecord) {
  const ref = await findDocRef(name, id);           // getDoc (+ fallback query)
  const beforeSnapshot = await getDoc(ref);          // read #2
  ...
  await updateDoc(ref, { ...data, updated_at: serverTimestamp() });
  const snapshot = await getDoc(ref);                // read #3 (re-read after write)

cloud-api.ts:653-667 (emitEvent tail on every write):
  await setDoc(doc(firestore, collectionNames.events, id), event, ...);
  const insight = agentInsightForEvent(event);
  if (insight) { await setDoc(doc(firestore, collectionNames.agentInbox, insight.id), ...); }
  await updateAgentMemory(event).catch(() => undefined);   // up to 2 more setDocs
```

**Correcao sugerida:** Skip the post-update getDoc (merge 'before' with the patch locally), reuse the beforeSnapshot from findDocRef instead of fetching twice, and batch the event + inbox + memory writes into a single writeBatch fired without awaiting on the critical path (or move audit emission server-side into the existing transactional Cloud Functions).

---

### 45. [MEDIO] Warehouse receiving/inventory forms download the full SKU + product catalogs (limit=5000) and refetch them on every invalidation

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx:4753` | **Dimensao:** Performance

The opening-inventory and receiving flows in warehouse-ops.tsx run a lookupQuery that fetches /api/skus?limit=5000 and /api/products?limit=5000 in parallel (repeated at lines 4062, 5630, 6399 for other modules) purely to do client-side code-matching while the operator types. Per finding 1, those endpoints scan the whole collections regardless of the limit param. staleTime is only 30s, and the realtime bridge's blanket invalidateQueries() (finding 3) marks it stale on every write — but this screen's whole purpose is generating writes: each scanned line creates movement/product/event docs, so during an active receiving session the full catalog is re-downloaded repeatedly while the operator works. The same page also polls /api/warehouse/ops (16 scans) every 30s (line 7998-8001).

**Evidencia:**

```
warehouse-ops.tsx:4753-4765:
  const lookupQuery = useQuery({
    queryKey: ["opening-inventory-product-lookup"],
    staleTime: 30_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      return mergeProductLookup(...);
    },
  });

warehouse-ops.tsx:7998-8001:
  const ops = useQuery({
    ...
    refetchInterval: 30000,
```

**Correcao sugerida:** Replace the catalog preload with a server-side or Firestore-query lookup keyed on the typed code (where('cod_btg','==',code) / where('cod_cliente','==',code) with limit(5)), or at minimum raise staleTime/gcTime substantially and give the lookup a query key excluded from realtime invalidation so scanning sessions don't thrash it.

---

### 46. [MEDIO] Mutation success handlers call queryClient.invalidateQueries() with no filter, refetching every active scan-backed query

**Arquivo:** `artifacts/btg-inventory/src/pages/movements.tsx:376` | **Dimensao:** Performance

MovementModal's onSuccess calls queryClient.invalidateQueries() with no arguments, invalidating and refetching every active query in the cache — not just the movements list. On the Movements page that means the full movements-ledger scan reruns (finding 1), and if the user navigated from Dashboard, the still-cached /api/warehouse/ops (16 scans) and /api/ai/overview (9 scans) queries refetch too. This duplicates work the RealtimeSyncBridge will do again ~350ms later when the write's snapshot events land, so a single registered movement causes at least two global refetch waves. The same unfiltered pattern exists in other mutation handlers across the pages.

**Evidencia:**

```
movements.tsx:372-377:
    createMovement.mutate(
      { data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();   // no queryKey filter
          toast({ title: "Movimentação registrada com sucesso" });
```

**Correcao sugerida:** Invalidate only the affected keys, e.g. queryClient.invalidateQueries({ queryKey: getListMovementsQueryKey() }) plus the SKU/stock-balance keys the movement touches — or rely entirely on the realtime bridge once it performs targeted invalidation (finding 3) and drop the manual call.

---

### 47. [MEDIO] xlsx@0.18.5 with unpatched prototype-pollution and ReDoS CVEs parses user-uploaded spreadsheets in Cloud Functions

**Arquivo:** `functions/package.json:25` | **Dimensao:** Dependencias e Deploy

functions depends on xlsx ^0.18.5 (pnpm-lock.yaml resolves xlsx@0.18.5, the newest version on npm). SheetJS CE 0.18.5 is affected by CVE-2023-30533 (prototype pollution when reading a crafted file, fixed only in 0.19.3+) and CVE-2024-22363 (ReDoS, fixed only in 0.20.2+); the patched releases are published exclusively on cdn.sheetjs.com, so npm-installed xlsx can never receive the fix. The vulnerable path is live: extractOperationalDocumentContent (functions/src/index.ts:4646) downloads a user-uploaded file from Storage and feeds the raw buffer to XLSX.read at functions/src/index.ts:1055. Any authenticated user with role owner/admin/interno/wms/financeiro can upload a crafted .xlsx and trigger it. Because Cloud Functions instances are warm and reused across invocations, a polluted Object.prototype persists and can corrupt behavior of subsequent requests (including other customers' requests) served by the same instance; the ReDoS variant lets a single crafted file peg a function instance for its full timeout.

**Evidencia:**

```
functions/package.json: "xlsx": "^0.18.5"  —  functions/src/index.ts:1055: const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true }); (buffer comes from bucket.file(storagePath).download() of a user-uploaded document at index.ts:4692)
```

**Correcao sugerida:** Replace the npm xlsx package with the patched SheetJS build from https://cdn.sheetjs.com (>=0.20.2, installable via the tarball URL pinned in package.json) or migrate to exceljs. Until then, wrap XLSX.read in a hardened context (e.g., run with Object.freeze(Object.prototype) or in a worker) and keep the existing 25 MB size cap.

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed end-to-end. (1) Dependency: functions/package.json:25 pins "xlsx": "^0.18.5" and pnpm-lock.yaml:5353 resolves xlsx@0.18.5 (integrity sha512-dmg3LCjB...TEtFQ==, the real newest-on-npm 0.18.5). SheetJS publishes patched builds (0.19.3+ for CVE-2023-30533 prototype pollution, 0.20.2+ for CVE-2024-22363 ReDoS) only on cdn.sheetjs.com, so npm cannot deliver the fix — accurate. (2) Reachable path: functions/src/index.ts:1055 calls XLSX.read(buffer, { type: "buffer", cellDates: true }) with no buffer sanitization, in the isSpreadsheetDocument branch (detection at 847-858 keys off attacker-controlled content_type/file_name for .xlsx/.xls/.xlsm). The buffer is the raw user-uploaded file: extractOperationalDocumentContent (4646) downloads it via bucket.file(storagePath).download({validation:false}) at 4692 and passes it straight into extractTextFromDocumentBuffer (4695) → XLSX.read. No magic-byte/schema/content validation exists anywhere between download and parse. (3) Mitigation check: none. The only gate is role-based (callable restricts to owner/admin/interno/wms/financeiro at 4648; storage.rules:37-39 lets those internal roles write operational-documents/**). Warm-instance reuse makes prototype pollution persist across invocations (cross-tenant corruption) and ReDoS can peg an instance for its timeout. The claim is real and the failure path is concrete. One correction to severity: exploitation requires an authenticated internal-privileged account, not any tenant/customer or anonymous caller (the roles owner/admin/interno/wms/financeiro are internal operator roles), so this is an insider / compromised-internal-account vector rather than remote-unauthenticated, which lowers practical severity from high to medium while remaining a legitimate, confirmed finding.

</details>

---

### 48. [MEDIO] nginx serves the production app with no security headers (no HSTS, X-Content-Type-Options, frame-ancestors/CSP, Referrer-Policy)

**Arquivo:** `deploy/cloud-run/nginx.conf:26` | **Dimensao:** Dependencias e Deploy

The entire Cloud Run nginx config for a financial-sector customer portal (BTG Pactual inventory/billing, handles auth sessions and invoices) sets only Cache-Control headers. There is no Strict-Transport-Security (Cloud Run/GCLB does not add it for you — and tools/trocar_registro_a_hostinger.ps1 shows a custom domain is in use), no X-Content-Type-Options: nosniff, no X-Frame-Options or Content-Security-Policy frame-ancestors (the app can be framed for clickjacking of approval/decision flows like decideCustomerRequest), and no Referrer-Policy. The Dockerfile also runs the stock root nginx image with no hardening layer, so nothing else supplies these headers.

**Evidencia:**

```
deploy/cloud-run/nginx.conf lines 26-29:  location / {\n    try_files $uri $uri/ /index.html;\n    add_header Cache-Control "no-cache";\n  }  — no add_header for HSTS/XCTO/XFO/CSP anywhere in the file
```

**Correcao sugerida:** Add at server level: add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always; add_header X-Content-Type-Options nosniff always; add_header X-Frame-Options DENY always (or CSP frame-ancestors 'none'); add_header Referrer-Policy strict-origin-when-cross-origin always. Note nginx's add_header inheritance: headers declared at server level are dropped in any location that has its own add_header, so repeat them (or use a shared include) in the /assets/, /sw.js, manifest and / locations.

---

### 49. [MEDIO] No gzip/brotli compression configured — SPA bundles served uncompressed from Cloud Run

**Arquivo:** `deploy/cloud-run/nginx.conf:8` | **Dimensao:** Dependencias e Deploy

The custom conf.d/default.conf never enables compression, and the official nginx:1.27-alpine base image ships with gzip commented out (`#gzip on;`) in /etc/nginx/nginx.conf, so every JS/CSS asset is served identity-encoded. This SPA bundles Firebase SDK, Recharts, Radix UI, framer-motion, react-hook-form etc. (artifacts/btg-inventory/package.json), which typically yields well over 1 MB of JavaScript; the PWA config even raises maximumFileSizeToCacheInBytes to 3 MB (vite.config.ts:62) confirming large chunks exist. Uncompressed delivery multiplies first-load time roughly 3-4x for users (region southamerica-east1) and inflates Cloud Run egress cost. Cloud Run does not transparently compress responses for you.

**Evidencia:**

```
deploy/cloud-run/nginx.conf contains no gzip/brotli directives (full file is 30 lines: only listen, root, try_files and Cache-Control); Dockerfile: FROM nginx:1.27-alpine / COPY deploy/cloud-run/nginx.conf /etc/nginx/conf.d/default.conf
```

**Correcao sugerida:** Enable `gzip on; gzip_types application/javascript text/css application/json image/svg+xml application/manifest+json; gzip_min_length 1024; gzip_comp_level 5;` in the server block, or precompress at build time and use gzip_static/brotli.

---

### 50. [MEDIO] No CI or quality gate anywhere: existing test suites are never executed automatically

**Arquivo:** `firebase.json:5` | **Dimensao:** Testes e Qualidade

The repo has zero CI configuration (no .github/workflows, no cloudbuild.yaml — confirmed by glob). The only automated hook is firebase.json's functions predeploy, which runs build (tsc) but no tests, so 'firebase deploy --only firestore:rules' ships security-rule changes to production without ever running functions/src/firestore.rules.test.ts. The Cloud Run deploy script tools/deploy_cloud_run.ps1 likewise builds the frontend and deploys with no typecheck/test/lint step (grep for test|typecheck|lint in that script returns nothing). The well-built test:critical suite in functions/package.json (unit + emulator integration) only runs if a developer remembers to invoke it manually. For a system that maintains a transactional inventory ledger and emits invoices, every safety property proven by the 1,738-line integration suite is unenforced at merge/deploy time.

**Evidencia:**

```
firebase.json: "predeploy": ["pnpm --dir \"$RESOURCE_DIR\" run build"]  (build only — no test).  functions/package.json line 16: "test:critical": "pnpm run test:unit && pnpm run test:integration" — referenced by no hook, script, or workflow. Glob '.github/workflows/**' and '**/cloudbuild*.{yaml,yml,json}': No files found.
```

**Correcao sugerida:** Add a GitHub Actions workflow that runs on PR: (a) pnpm typecheck at root (covers frontend tsc), (b) pnpm -C functions test:critical (firebase-tools emulator is already wired via emulators:exec). Add 'pnpm -C functions test:integration' to the firestore predeploy in firebase.json. Ranked top-5 tests by safety-per-hour: 1) rules tests for the invite→user self-creation chain incl. negative cases (privilege escalation surface, ~1h, pure rules tests on existing harness); 2) unit tests for assertManagedAction + requireAccessWrite/requireBillingWrite RBAC matrix in index.ts (~1h, pure functions, guards users.set_role and invites.create); 3) emulator test for the putaway advance and decideCustomerRequest reject paths (~2h, reuses existing integration harness, protects ledger double-entry on transfers); 4) emulator test driving saveBillingManual→emitBillingInvoice→payBillingInvoice against seeded price list (~3h, protects invoice money math end-to-end); 5) cross-tenant rules tests for client_invoices, client_order_tracking, client_request_status, agent_conversations/agent_messages (~2h, extends existing seed with client-b scenarios).

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by direct inspection; refutation failed on every avenue. (1) No CI exists: globs for .github/**, cloudbuild*.{yaml,yml,json}, .gitlab-ci.yml, azure-pipelines.yml, Jenkinsfile, .circleci/**, bitbucket-pipelines.yml, .husky/**, and .pre-commit-config.yaml all return nothing, and no package.json references husky/lint-staged/pre-commit. (2) firebase.json:5 predeploy is exactly "pnpm --dir \"$RESOURCE_DIR\" run build", and functions/package.json:11 defines build as plain tsc — compile only, no tests. The claim even understates it: firebase.json's firestore/storage blocks have NO predeploy, so `firebase deploy --only firestore:rules` runs zero hooks before shipping multi-tenant security rules whose test suite (functions/src/firestore.rules.test.ts) only runs via the manual test:integration emulator script. (3) tools/deploy_cloud_run.ps1 (read in full) runs only `pnpm --filter @workspace/btg-inventory run build` = bare `vite build` (no typecheck — the --filter bypasses the root build script that would typecheck), then `gcloud builds submit` against a Dockerfile that is nginx + COPY of prebuilt dist, so the Cloud Build step contains no tests either. (4) Grep for test:critical|test:integration|test:unit|node --test across all json/md/ps1/py/yaml/Dockerfile/tools/deploy files finds references only inside functions/package.json:13-16 itself — nothing invokes the suite automatically. Severity adjusted from high to medium: the gap is total and the consequence concrete (tenant-isolation or ledger-invariant regressions can deploy unchecked despite an existing suite that would catch them), but this is an absent process control, not a presently exploitable defect in shipped code.

</details>

---

### 51. [MEDIO] Entire callable authorization layer (RBAC + Zod boundary) has zero test coverage — integration tests bypass it

**Arquivo:** `functions/src/domain/operations.integration.test.ts:25` | **Dimensao:** Testes e Qualidade

operations.integration.test.ts imports only the domain *Transaction functions from operations.js and hand-builds the actor object, so the onCall wrappers in functions/src/index.ts are never exercised: getProfile (index.ts:1119, resolves role from the users doc), requireInternal/requireWarehouseWrite/requireBillingWrite/requireAccessWrite (index.ts:1154-1209), and especially assertManagedAction (index.ts:3533), which is the sole guard for mutateManagedEntity — the single endpoint that performs users set_role, invites create, customers, and billing_config mutations (Firestore rules block all direct writes to those collections, so this callable is the only mutation path). A regression here — e.g. a role added to the wrong allowlist, or the assertManagedAction fallthrough to requireAccessWrite being reordered — is a silent privilege-escalation with no failing test. All 32 onCall exports (index.ts:2737-6058), including chatWithAgentDute, applyDocumentOperationalAction and lookupInvite, share this zero-coverage boundary.

**Evidencia:**

```
operations.integration.test.ts:25-31: const actor: OperationalActor = { uid: "operator-1", email: "operacao@dutelog.com.br", name: "Operação Dutelog", role: "wms", customer_code: "BTG Pactual" };  — role is asserted by the test itself, never derived through getProfile. index.ts:3579-3582: requireAccessWrite(profile); if (input.resource === "users" && input.action !== "set_role") { throw ... } — untested.
```

**Correcao sugerida:** Cheapest first: extract assertManagedAction and the require* helpers into a testable module and add a role-matrix unit test (every role x every resource/action). Then add one emulator test that invokes the deployed callable path (firebase-functions-test or emulator hub) proving a 'cliente' profile gets permission-denied on mutateManagedEntity(users, set_role).

<details><summary>Verificacao adversarial (confirmado)</summary>

Confirmed by tracing all cited code. (1) operations.integration.test.ts:7-31 imports only the domain *Transaction functions from ./operations.js and hand-builds the actor (role: "wms" asserted by the test), so getProfile and the RBAC helpers are never exercised. (2) The full test surface per functions/package.json is billing.test.js (imports only ./billing.js), operations.integration.test.js, and firestore.rules.test.js (rules-unit-testing); no test imports index.ts, and there is no firebase-functions-test or httpsCallable harness anywhere in the repo — so all 32 onCall exports (index.ts:2737-6058), getProfile (index.ts:1119-1152), requireInternal/requireWarehouseWrite/requireBillingWrite/requireCatalogWrite/requireAccessWrite (index.ts:1154-1210), and assertManagedAction (index.ts:3533-3604) have zero coverage. (3) The sole-mutation-path premise holds: mutateManagedEntity (index.ts:4113-4116) is the only path performing users set_role, invites create, customers, and billing_config writes, because firestore.rules sets users "allow update, delete: if false" (line 570; create is self-only and role-pinned to the invite doc, lines 562-569), invites "allow create, delete: if false" (580), and customers/billing_config all false (687-690, 609-612). (4) The assertManagedAction fallthrough at index.ts:3579 (requireAccessWrite as the default branch after resource-specific early returns) is exactly as claimed — an allowlist typo or branch reorder there would silently grant access-management mutations to lower roles with no failing test. Severity adjusted from high to medium: the guards as currently written are correct, so this is a latent regression hazard (untested security boundary), not a presently exploitable vulnerability; the Firestore rules layer that backstops direct writes is itself covered by firestore.rules.test.ts.

</details>

---

### 52. [MEDIO] Rules tests skip the self-service user-creation/invite chain — the highest-risk rules in the file

**Arquivo:** `functions/src/firestore.rules.test.ts:233` | **Dimensao:** Testes e Qualidade

firestore.rules contains an intricate self-provisioning chain: users create is allowed when safeUserCreateFields, inviteIsPendingForUser and invitedCustomerScopeIsValid all pass (firestore.rules:562-569, 237-263), and invite acceptance via safeInviteAcceptUpdate (rules:220-231). The test file exercises exactly one happy path (a user flips their own invite to 'used') and nothing else. Untested attack scenarios that these rules are supposed to block: creating a users doc with a role different from the invite's role; a 'cliente' invite creating a profile with a different customer_code (cross-tenant takeover); accepting an invite addressed to another email; accepting a revoked/used invite; setting used_by to another uid. safeUserRoleUpdate (rules:167-181, admin cannot touch owner/admin roles) and safeInviteCreateFields/validInviteRoleForManager (rules:148-151, only owner can invite owner/admin) are also fully untested. Any refactor of these ~120 lines of rules can silently open privilege escalation with the suite still green.

**Evidencia:**

```
firestore.rules.test.ts:233-244 is the only invite/user test: it("mantém somente a aceitação do próprio convite disponível antes do perfil", ...) — a single assertSucceeds on updateDoc(invites/invite-a, {status:'used', ...}). No test ever performs setDoc(users/<uid>, ...) through rules, and no assertFails covers any invite/user negative case.
```

**Correcao sugerida:** Add a describe block seeding pending invites for cliente and interno roles, then assert: create-users succeeds only with matching email+role+customer_code; fails with mismatched role, missing/altered customer_code, foreign email, non-pending invite; safeUserRoleUpdate fails when an admin escalates another admin to owner.

<details><summary>Verificacao adversarial (confirmado)</summary>

CONFIRMED with one correction. Core claim verified by tracing the full path: (1) The self-provisioning chain is live browser-facing code — App.tsx:449-464 writeBatch sets users/{uid} (role, customer_code, invite_id from the invite) and flips invites/{token} to 'used' directly through Firestore rules; no Cloud Function mediates it and functions/src/index.ts contains zero Firestore triggers (grep onDocumentCreated/Written/Updated: no matches), so firestore.rules:562-569 (+ inviteIsPendingForUser:237-243, invitedCustomerScopeIsValid:245-263, safeInviteAcceptUpdate:220-231) is the sole guard for role assignment and tenant scoping at signup. (2) The only rules test file in the repo (functions/src/firestore.rules.test.ts, confirmed via grep for rules-unit-testing/initializeTestEnvironment) exercises exactly one happy-path assertSucceeds on the invite status flip (lines 233-244); no test ever creates users/{uid} through rules, and there are no assertFails for wrong role, cross-tenant customer_code, another user's email, non-pending invite, or used_by mismatch. Correction: the claim overstates by listing safeUserRoleUpdate (167-181), safeInviteCreateFields (183-208), safeInviteAdminUpdate (210-218), and validInviteRoleForManager (148-151) as untested live guards — they are dead code, referenced by no match block; the actual match blocks are 'allow update, delete: if false' (users, line 570) and 'allow create, delete: if false' (invites, line 580), and the suite does assert those denials (test.ts:221-230). Severity lowered to medium: I traced each attack scenario against the current rules and all are blocked today (role must equal invite role at 567, customer_code must equal invite's at 245-252, email must match token at 242/566, status must be pending at 241), so this is a regression-risk/coverage gap on the privilege-escalation-critical boundary, not a presently exploitable vulnerability.

</details>

---

### 53. [MEDIO] Billing money flow untested at emulator level — billing.test.ts mocks the transaction, and the callables' Firestore orchestration is uncovered

**Arquivo:** `functions/src/index.ts:5892` | **Dimensao:** Testes e Qualidade

billing.test.ts covers only pure functions in billing.ts; its one 'transaction' test uses a hand-rolled fake with get/set stubs (billing.test.ts:335-344). The real emitBillingInvoice callable (index.ts:5892) does substantially more inside db.runTransaction: loadBillingCalculation reads the price list, operational snapshots and manual quantities transactionally (the comment at index.ts:5911-5913 explains this exists to prevent races corrupting the immutable invoice snapshot), then writes the customer-facing client_invoices projection (index.ts:5930-5948) plus audit events. saveBillingManual (5777) and payBillingInvoice (5982) similarly manage period lifecycle. None of this runs in test:integration — functions/package.json line 15 runs only operations.integration.test.js and firestore.rules.test.js. A regression in loadBillingCalculation (e.g. reading the wrong competencia's snapshots, or dropping manual quantities) would produce wrong invoice totals for the customer with the suite green, and the snapshot is by design immutable once emitted.

**Evidencia:**

```
functions/package.json:15: "test:integration": "... firebase emulators:exec ... \"node --test --test-concurrency=1 lib/domain/operations.integration.test.js lib/firestore.rules.test.js\"" — no billing file. billing.test.ts:335-344: const transaction = { async get() { return { exists: true, data: () => persisted }; }, set(...) {...} };
```

**Correcao sugerida:** Add billing.integration.test.ts to the emulators:exec list: seed billing_price_list, billing_operational_snapshots and billing_manual in the emulator, call the transaction bodies (or export loadBillingCalculation for direct use), emit, assert period status transitions, client_invoices projection totals, and that re-emission after mutating the price list returns the original snapshot.

---

### 54. [MEDIO] Ledger-mutating paths with no coverage: putaway stock transfers and customer-request rejection

**Arquivo:** `functions/src/domain/operations.ts:5130` | **Dimensao:** Testes e Qualidade

The 1,738-line integration suite covers receiving, picking, packing, shipping, opening inventory, cycle counts, returns and manual movements — but never advances a putaway task, even though advanceWarehouseTaskTransaction has dedicated putaway logic that writes paired ledger movements (putaway_transfer_out at operations.ts:5130-5147 and putaway_transfer_in at 5155-5172) and rebalances two stock_balances docs. A bug there (e.g. the out-leg committing without the in-leg on a validation error path) silently corrupts qty_on_hand — exactly the class of defect this ledger architecture exists to prevent. Likewise decideCustomerRequestTransaction's reject branch (operations.ts:3815, 3843) is never exercised: no test verifies a rejected 'retirada' releases reservations or that a rejected request cannot later be approved. recordWarehouseException/resolveWarehouseException (index.ts:5706-5723) are also untested.

**Evidencia:**

```
grep 'putaway' in operations.integration.test.ts: no matches — all advance() calls use picking:/packing:/shipping:/receiving: prefixes. operations.ts:5008: if (type === "putaway" && targetStatus === "completed") { ... movementId(operationId, "putaway_out") ... movement_kind: "putaway_transfer_out" ... movementId(operationId, "putaway_in") ...
```

**Correcao sugerida:** Extend the existing WMS flow test: after receiving completes, advance the generated putaway task through planned→in_progress→completed and assert two movements exist with matching quantities and that source/destination balances net to zero change in total qty_on_hand. Add a reject test asserting reservation release and terminal status.

---

### 55. [MEDIO] Frontend: ~33k lines, zero tests, no test runner, no ESLint — only an unenforced tsc typecheck

**Arquivo:** `artifacts/btg-inventory/package.json:6` | **Dimensao:** Testes e Qualidade

Confirmed by glob: artifacts/btg-inventory contains no *.test.* or *.spec.* files, and package.json has no test script and no test framework (no vitest/jest/@testing-library/playwright anywhere in its deps — grep returned nothing). There is also no ESLint config in the repo outside node_modules. The only static gate is the typecheck script (tsc -p tsconfig.json --noEmit), and per finding 1 nothing runs it automatically. This frontend is not trivial glue: warehouse-ops.tsx alone is 8,440 lines and pages like billing.tsx and client/estoque.tsx render financial and inventory data; src/lib/cloud-api.ts and realtime-sync.tsx encode Firestore query and callable contracts that can silently drift from the backend (a renamed field returns undefined at runtime, invisible to tsc where data crosses the Firestore boundary as DocumentData).

**Evidencia:**

```
artifacts/btg-inventory/package.json scripts: { "dev": ..., "build": ..., "serve": ..., "typecheck": "tsc -p tsconfig.json --noEmit" } — no "test". Glob '**/*.{test,spec}.{ts,tsx,js,jsx}' under artifacts/btg-inventory: No files found. wc -l: warehouse-ops.tsx = 8440 lines.
```

**Correcao sugerida:** Do not attempt broad UI coverage. Add vitest and target the pure logic in src/lib (request/response mappers in cloud-api.ts/functions-api.ts, module gating in modules.ts). Add eslint with typescript-eslint recommended. Wire both plus typecheck into the CI from finding 1 — the typecheck alone is currently the highest-leverage unenforced gate.

---

### 56. [MEDIO] Client-writable rules surfaces and most cross-tenant projections untested (8 of ~56 collections covered)

**Arquivo:** `functions/src/firestore.rules.test.ts:247` | **Dimensao:** Testes e Qualidade

The 'isolamento entre clientes' block tests tenant isolation for exactly one collection (client_inventory). Untested isOwnProjection surfaces that expose per-customer data: client_invoices (financial data, rules:589-592), client_order_tracking (712-715), client_request_status (702-705), client_documents (850-853), operational_notifications with its status-in-['approved','sent'] visibility condition (629-637). More importantly, the rules allow clients to WRITE in three places, all untested: agent_conversations/agent_messages creation guarded by hasOwnChatCustomerScope + conversationAfter ownership checks (rules:360-451 — a bug here lets client B write messages into client A's conversation), and events creation by 'cliente' limited to two event types via isOwnCustomerCode (rules:319-322). The WMS event-type regex (rules:298-299) and the role-conditional writes on documents/document_links (842-864) are also uncovered. The seed even creates finance-a and never uses it in any assertion, and the 'suporte' role appears in no test.

**Evidencia:**

```
firestore.rules.test.ts:247-278 — the entire cross-tenant describe covers only client_inventory (getDoc inventory-a/inventory-b, one query, one update denial). firestore.rules:449-450: && conversationAfter(request.resource.data.conversation_id).user_id == request.auth.uid && conversationAfter(...).customer_code == request.resource.data.customer_code — never exercised.
```

**Correcao sugerida:** Extend seed() with per-tenant docs for client_invoices, client_order_tracking, client_request_status, client_documents, operational_notifications (one approved, one pending) and a conversation for client-a; assert client-b is denied reads on all of them, denied message-create into client-a's conversation, denied event-create with customer A's customer_code, and that a pending notification is invisible even to its own customer.

---

### 57. [BAIXO] ~260 lines of unreferenced, more-permissive rule helpers (incl. customer-authored events and WMS/coordinator write grants) are dead code

**Arquivo:** `firestore.rules:311` | **Dimensao:** Seguranca - Regras Firestore/Storage

A large block of helper functions is defined but wired into NO match/allow rule (confirmed: each appears only at its own definition). Every warehouse collection is `create,update,delete: if false`, and events is `create: if false`, so canCreateEvent, validEventCreate, isWmsEventType, safeWmsOrderUpdate, safeWmsOrderItemUpdate, safeCoordinatorBalanceUpdate, canCreateWarehouseRecord, canUpdateWarehouseRecord, safeUserRoleUpdate, safeInviteAdminUpdate, and safeInviteCreateFields are all dead. This is a security hazard, not just cleanliness: the dead code encodes a materially MORE permissive policy than what is active — e.g. canCreateEvent explicitly grants a 'cliente' the ability to create events of type portal.request_created / customer.message_sent, and safeWmsOrder*/safeCoordinator* grant direct stock/order/balance field writes to WMS/coordinator roles. A future edit that re-attaches any of these to a match block (believing it is the current policy) would silently grant clients event-injection or grant browser-side stock/order mutation, bypassing the Cloud-Functions-only invariant. It also misleads reviewers about the real authorization surface.

**Evidencia:**

```
function canCreateEvent(eventId) { return validEventCreate(eventId) && ( ... || ( isOwnCustomerCode(request.resource.data.customer_code) && request.resource.data.type in ['portal.request_created','customer.message_sent'] ) ); }
// events match block actually says:
match /events/{eventId} { allow read: if ...; allow create, update, delete: if false; }
```

**Correcao sugerida:** Delete the unused helpers, or if they represent a planned direct-write model, gate them behind explicit tests and only introduce them together with the corresponding match rules. Keeping dormant permissive auth logic in the shipped rules file is a standing footgun.

---

### 58. [BAIXO] Invite acceptance and profile creation do not require a verified email; unauthenticated lookupInvite discloses invitee email/role/customer_code

**Arquivo:** `firestore.rules:220` | **Dimensao:** Seguranca - Regras Firestore/Storage

safeInviteAcceptUpdate and the users create rule authorize based on request.auth.token.email == invite.email, but never check request.auth.token.email_verified. With Firebase email/password sign-up the email claim is attacker-chosen and unverified. The lookupInvite callable (index.ts:2737) is intentionally unauthenticated and returns email, role and customer_code for any known token. So if an invite link leaks (URL sharing, referrer, logs), anyone can register a Firebase account asserting the invited email (provided it isn't already registered), read the invite, create the users/{uid} profile with the invited role, and consume the invite — including an 'interno'/'wms'/'financeiro' role if that was the invited role. The token is the only real secret; there is no second factor tying acceptance to control of the mailbox.

**Evidencia:**

```
function safeInviteAcceptUpdate() {
  return signedIn() && resource.data.status == 'pending'
    && resource.data.email == request.auth.token.email  // no email_verified check
    && ...;
}
allow create: if signedIn() && request.auth.uid == userId && ... && request.resource.data.email == request.auth.token.email && ...;
```

**Correcao sugerida:** Require request.auth.token.email_verified == true in both safeInviteAcceptUpdate and the users create rule (or move profile creation into an authenticated Cloud Function that verifies the email), and treat invite tokens as short-lived, single-use secrets. This closes the gap where an unverified email claim plus a leaked token yields a privileged account.

---

### 59. [BAIXO] No Firebase App Check enforced on any callable (including the unauthenticated lookupInvite)

**Arquivo:** `functions/src/index.ts:2737` | **Dimensao:** Seguranca - Cloud Functions

None of the onCall endpoints set enforceAppCheck and there is no consumeAppCheckToken usage anywhere in functions/src. Every callable is reachable by any client that can obtain a Firebase ID token (and lookupInvite by anyone at all). Role checks via getProfile gate authorization, so this is defense-in-depth rather than a direct authz hole, but the absence leaves the AI/LLM endpoints (chatWithAgentDute, extractOperationalDocumentContent invoking Vertex/Gemini and file parsers) and the open lookupInvite exposed to automated abuse and cost-amplification.

**Evidencia:**

```
grep across functions/src for appcheck/enforceAppCheck/consumeAppCheckToken returns no matches; all endpoints declared as plain onCall(async (request) => {...}), e.g. index.ts:2737 lookupInvite and index.ts:6058 chatWithAgentDute.
```

**Correcao sugerida:** Enable App Check ({ enforceAppCheck: true }) on callables, especially the LLM-backed and unauthenticated ones, and add per-user rate limiting on the AI endpoints.

---

### 60. [BAIXO] Outbound webhook bearer token read from plain process.env instead of Secret Manager

**Arquivo:** `functions/src/index.ts:1456` | **Dimensao:** Seguranca - Cloud Functions

deliverOperationalNotification reads AGENT_DUTE_EMAIL_WEBHOOK_TOKEN from process.env and sends it as an Authorization: Bearer header to an env-configured webhook. Firebase Functions v2 provides defineSecret()/Secret Manager for credentials; storing a bearer token in a plain environment variable makes it visible in the function's runtime config/deploy metadata and to anyone with viewer access, with weaker rotation/audit than Secret Manager. The webhook URL and token are not user-controlled, so there is no injection/SSRF here, but the secret handling is below the project's own standard.

**Evidencia:**

```
index.ts:1456-1459 ...(process.env.AGENT_DUTE_EMAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.AGENT_DUTE_EMAIL_WEBHOOK_TOKEN}` } : {})
```

**Correcao sugerida:** Declare the webhook token (and any other credentials) with defineSecret() and bind it to the function so it is sourced from Secret Manager rather than a plaintext env var.

---

### 61. [BAIXO] Quantities are never validated as integers and money aggregates accumulate float drift

**Arquivo:** `functions/src/domain/operations.ts:704` | **Dimensao:** Correcao - Dominio de estoque

No quantity field is constrained to integers anywhere: requiredPositive only checks > 0, and every zod schema in index.ts uses plain z.number().positive()/nonnegative() (lines 138, 221, 231, 264, 309) with no .int(). A caller can move, count, reserve, pick or ship 0.1 units and all balance math, ledger before/after chains and unit checks (pickedQty !== expectedQty at line 4761) operate on IEEE-754 floats, where accumulated sums can fail exact equality. Money aggregates are maintained as running float increments of qty*unit_cost — client_inventory total_cost (lines 704-707 `FieldValue.increment(onHandDelta * unitCost)`), products/skus custo_total (lines 1711-1728, 5402-5415) — and reversal paths clamp with Math.max(0, ...) (lines 2187-2206), which hides drift rather than detecting it: after enough receive/remove cycles with costs like 0.1, custo_total no longer equals the sum of the ledger.

**Evidencia:**

```
total_cost:
        onHandDelta && unitCost
          ? FieldValue.increment(onHandDelta * unitCost)
          : undefined,
```

**Correcao sugerida:** Add Number.isInteger validation (or .int() in the zod schemas) for all quantity fields; store money in integer cents or recompute total_cost from qty*unit_cost snapshots instead of running float increments, and remove the Math.max clamps so drift surfaces as an error.

---

### 62. [BAIXO] Audit note: core transactional invariants that ARE well-enforced

**Arquivo:** `functions/src/domain/operations.ts:498` | **Dimensao:** Correcao - Dominio de estoque

For fairness, several invariants are solidly implemented and the recent 'transactional ledger' work holds up in these respects: (1) every stock mutation, its ledger movement, projection update, event and idempotency receipt are written in one Firestore transaction, so there is no partial-failure rollback gap; (2) idempotency is robust — each operation doc is keyed by a digest of the caller's nonce, replays return the stored result, and operationResult (lines 498-517) rejects reuse of a key with different input via input_hash; (3) negative stock is consistently prevented: manual SAIDA checks available (lines 904-909), allocation validates qtyOnHand/qtyReserved sanity per row (lines 2917-2922), cycle counts refuse counts below active reservations (line 1477), shipping consumption checks both on-hand and reserved per reservation (lines 5849-5854), and putaway checks source availability (line 5078); (4) ledger qty_before/qty_after chains are correct even when several lines hit the same balance in one transaction, via the mutable balanceStates map (receiving lines 5227-5237, delivery 5841-5858); (5) the status machine is strictly linear with per-step physical-confirmation requirements (picking/packing quantity-exact checks, seal/carrier/driver/proof requirements), and reservation lifecycle transitions (reserved→picked→consumed) are verified at each step (lines 5516-5521, 5829-5833); (6) a movements_frozen/reconciliation gate (assertInventoryOperationsEnabled) blocks mutations during reconciliation. The defects reported above are largely at the seams between this ledger and its denormalized projections, not in the transactional core.

**Evidencia:**

```
if (data.input_hash !== inputHash) {
    throw new HttpsError(
      "already-exists",
      "A chave de idempotência já foi usada com outro conteúdo.",
    );
  }
```

**Correcao sugerida:** No action required; retain these mechanisms when fixing the findings above (all fixes should stay inside the existing single-transaction, receipt-guarded pattern).

---

### 63. [BAIXO] Key failure branches of billing.ts are untested: competencia mismatch, corrupt snapshot, pago-period emission, ad valorem fallback

**Arquivo:** `functions/src/billing.test.ts:1` | **Dimensao:** Correcao - Faturamento

billing.test.ts covers the happy path, rounding, immutability and one idempotent replay, but never exercises: PERIOD_COMPETENCIA_MISMATCH (billing.ts:768-777); INVALID_SNAPSHOT when a period is 'emitido' with a missing or malformed invoice_snapshot (billing.ts:430-452, 783-791) — the branch that guards production idempotency against corrupted Firestore data; emission against a 'pago' period (PERIOD_NOT_OPEN, billing.ts:794-799); the ad valorem fallback to item.valor_unit when adValoremRate is undefined (billing.ts:657-661); calculateBillingTotal (billing.ts:682-695, exported and never called by any test or by index.ts); rejection of negative quantities/prices (assertNonNegative paths); and aggregateBillingMetrics with an invalid event competencia. Regressions in any of these would ship undetected even though they guard double-billing and snapshot-integrity invariants.

**Evidencia:**

```
billing.test.ts contains no assertion for codes "PERIOD_COMPETENCIA_MISMATCH", "INVALID_SNAPSHOT", or "PERIOD_NOT_OPEN" (grep confirms only FUTURE_COMPETENCIA, INVALID_STATUS, INVALID_STATUS_TRANSITION, DUPLICATE_MANUAL_QUANTITY, SNAPSHOT_ALREADY_EXISTS are asserted), and calculateBillingTotal is not imported by the test file.
```

**Correcao sugerida:** Add unit tests for each named branch — especially re-emission with a corrupted/absent snapshot on an 'emitido' period and emission against a 'pago' period, since those two are the production guards against double-billing and snapshot corruption.

---

### 64. [BAIXO] fetchJson duplicated in 8 pages with divergent error parsing

**Arquivo:** `artifacts/btg-inventory/src/pages/customer-requests.tsx:242` | **Dimensao:** Frontend - Camada de dados

Eight page files each define their own async function fetchJson (ai-control.tsx:315, customer-requests.tsx:242, warehouse-ops.tsx, client-portal.tsx:851, support.tsx, client/shared.tsx, dashboard.tsx, client/assistente.tsx) instead of a single shared helper in lib/. The copies already diverge: customer-requests/ai-control throw new Error(rawText) — surfacing raw JSON like {"message":"..."} to the user — while client-portal.tsx parses the payload and extracts .message. Any fix to error handling (e.g., consuming the status-code mapping from finding 6, adding auth headers, or standardized toasts) must be re-applied in 8 places and will inevitably be missed in some, which is how the current inconsistency arose.

**Evidencia:**

```
customer-requests.tsx:242-249: async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(text || `HTTP ${response.status}`); } return response.json() as Promise<T>; }  — near-identical copies confirmed in 8 files, with client-portal.tsx:851-856 using a different JSON-parsing variant.
```

**Correcao sugerida:** Extract one fetchJson into src/lib (typed, parsing {message} bodies and attaching response.status to the thrown error) and import it from all pages.

---

### 65. [BAIXO] Legacy portal redirect routes are gated as internal-only, bouncing clients to '/' instead of redirecting

**Arquivo:** `artifacts/btg-inventory/src/lib/modules.ts:793` | **Dimensao:** Frontend - Portal do cliente

getRouteAppRoles() falls back to ['interno'] (and getRouteProfileRoles() to INTERNAL_ROLES) for any path not registered in APP_MODULES. The legacy client paths '/portal/solicitacoes' (→ ClientRequestsRedirect, App.tsx:794) and '/portal/agente/operacional' (→ ClientAgentRedirect, App.tsx:798) are only defined in PROTECTED_ROUTES, not in APP_MODULES, so their computed appRoles are ['interno']. A cliente user hitting either legacy URL (old bookmark, stale link in an email) fails RoleGate ('!appRoles.includes(role)') and is bounced to '/' instead of being redirected to /portal/recebimentos or /portal/agente — the redirect components can never execute for the only audience they exist for.

**Evidencia:**

```
modules.ts:792-794 export function getRouteAppRoles(path: string): AppRole[] { return ROUTE_APP_ROLES[normalizePath(path)] ?? ["interno"]; } combined with App.tsx:794 protectedRoute("/portal/solicitacoes", ClientRequestsRedirect) and App.tsx:720 if (!role || !appRoles.includes(role)) return <Redirect to="/" />;
```

**Correcao sugerida:** Register '/portal/solicitacoes' and '/portal/agente/operacional' in the ROUTE_APP_ROLES/ROUTE_PROFILE_ROLES seed object with ['cliente'] (as is already done for '/minhas-faturas'), or change the fallback for '/portal/*' paths to the cliente role.

---

### 66. [BAIXO] ai-control silently swallows failures: notifications fetch errors render as 'Nenhuma mensagem pendente' and resolveInsight has no error handler

**Arquivo:** `artifacts/btg-inventory/src/pages/ai-control.tsx:1516` | **Dimensao:** Frontend - Portal do cliente

OperationalNotificationsCard receives only notifications.data?.items ?? [] and isLoading (lines 2659-2663); notifications.error is never checked, so when the query fails (retry: 1) the card shows the empty state 'Nenhuma mensagem pendente' — an operator reviewing outbound client communications is told there is nothing to approve when the list actually failed to load. Similarly the resolveInsight mutation (lines 1920-1932) defines onSuccess but no onError: if the PATCH fails, the alert stays open with no feedback and the operator has no indication the resolution did not persist (every other mutation on the page has an onError toast).

**Evidencia:**

```
ai-control.tsx:2659-2663 <OperationalNotificationsCard notifications={notifications.data?.items ?? []} isLoading={notifications.isLoading} ...> with ai-control.tsx:1516-1521 : visibleNotifications.length === 0 ? ( ... <p className="mt-3 text-sm font-medium text-foreground">Nenhuma mensagem pendente</p>; ai-control.tsx:1920-1932 const resolveInsight = useMutation({ mutationFn: ..., onSuccess: () => { ... } }); — no onError
```

**Correcao sugerida:** Pass notifications.error into the card and render a distinct error state with a retry button; add an onError toast to resolveInsight like the other mutations on the page.

---

### 67. [BAIXO] agente-operacional.tsx is an unrouted dead page still shipped in the client bundle

**Arquivo:** `artifacts/btg-inventory/src/pages/client/agente-operacional.tsx:32` | **Dimensao:** Frontend - Portal do cliente

ClienteAgenteOperacional (210 lines) is exported through the pages/client barrel (index.ts:8) but is not imported by App.tsx and has no route — '/portal/agente/operacional' maps to ClientAgentRedirect instead (App.tsx:761, 798). Because App.tsx imports from the barrel, the dead page is still pulled into the bundle. It also duplicates portal claims that will drift: it hardcodes the 'BTG Pactual' fallback ('overview.customer?.code ?? "BTG Pactual"', line 150), a 'Contexto permitido' scope panel, and its own low-stock heuristic (available <= 10) that differs from estoque.tsx's isLowStock() dynamic threshold — two different definitions of 'low stock' for the same customer.

**Evidencia:**

```
pages/client/index.ts:8 export { ClienteAgenteOperacional } from "./agente-operacional"; while App.tsx:46-54 imports only ClienteAssistente, ClienteDocumentos, ClienteEstoque, ClienteFaturas, ClienteInicio, ClientePedidos, ClienteSolicitacoes and App.tsx:761 const ClientAgentRedirect = () => <Redirect to="/portal/agente" />;
```

**Correcao sugerida:** Delete agente-operacional.tsx and its barrel export, or wire it to a real route; if kept, source the low-stock threshold and customer label from the shared helpers used by estoque.tsx.

---

### 68. [BAIXO] Vite dev server disables host-header protection (allowedHosts: true) while listening on 0.0.0.0

**Arquivo:** `artifacts/btg-inventory/vite.config.ts:90` | **Dimensao:** Dependencias e Deploy

Both server and preview set `allowedHosts: true` combined with `host: "0.0.0.0"`, and the package.json dev/serve scripts add `--host 0.0.0.0`. allowedHosts:true turns off the Host-header check that Vite introduced specifically to block DNS-rebinding attacks, and 0.0.0.0 exposes the server on every interface of the developer machine. A malicious web page visited by the developer can rebind a domain to the dev machine's address and read arbitrary source files (including the repo-root envDir .env.local this config loads) through the dev server. This is dev-tooling only, but it is a deliberate opt-out of a security control on a machine that also holds production data exports (tmp/auth-users-dute-btg.json).

**Evidencia:**

```
vite.config.ts:86-99  server: { port, strictPort: true, host: "0.0.0.0", allowedHosts: true, ... }, preview: { port, host: "0.0.0.0", allowedHosts: true }; artifacts/btg-inventory/package.json:7 "dev": "vite --config vite.config.ts --host 0.0.0.0"
```

**Correcao sugerida:** Replace allowedHosts: true with an explicit list (e.g. ["localhost", ".ngrok-free.app"] or whatever tunnel domain is actually needed) and default host to localhost, opting into 0.0.0.0 only via the CLI flag when LAN testing is required.

---

### 69. [BAIXO] Unignored stray files at repo root and production PII exports in the working tree

**Arquivo:** `.gitignore:34` | **Dimensao:** Dependencias e Deploy

Repo root contains development leftovers that are untracked but NOT gitignored: landing_code.txt (0 bytes), make_landing.js, graphify-out/, IDEA.md — a single `git add -A` (or `git add .`) commits them; graphify-out/cache would go with it. More sensitive: tmp/ holds a production Firebase Auth user export (tmp/auth-users-dute-btg.json, plus auth-users-dute-f7480.json) and the full BTG inventory spreadsheet (Inventario_BTG_Consolidado_latest.xlsx), and .secrets/ holds a DNS snapshot. tmp/ and .secrets/ are covered by .gitignore and .dockerignore, and the Cloud Run deploy stages a clean directory (tools/deploy_cloud_run.ps1 copies only Dockerfile, nginx.conf and dist/public), so nothing currently ships — but customer PII retained unencrypted on a dev machine, guarded only by ignore files, is a data-handling risk for a BTG engagement, and the unignored root files are one bulk-add away from the public history.

**Evidencia:**

```
ls repo root → landing_code.txt, make_landing.js, graphify-out/, IDEA.md (none matched by .gitignore, none in git ls-files); ls tmp → auth-users-dute-btg.json, auth-users-dute-f7480.json, Inventario_BTG_Consolidado_latest.xlsx; ls .secrets → dns-snapshot-dutelog-before-app-20260709-145023.json
```

**Correcao sugerida:** Delete the dead root files (landing_code.txt, make_landing.js, graphify-out/) or add them to .gitignore; purge or encrypt the auth-user exports in tmp/ once the migration/reconciliation work that produced them is done.

---

### 70. [BAIXO] storage.rules has zero tests and the integration harness only starts the Firestore emulator

**Arquivo:** `storage.rules:33` | **Dimensao:** Testes e Qualidade

storage.rules gates agent-knowledge/, operational-documents/ and product-photos/ behind isInternal(), which performs cross-service firestore.get() lookups of the caller's users doc (storage.rules:14-30) — a construct that is easy to break subtly (e.g. path typo in userDoc(), or a role added to Firestore rules but forgotten here). No test exercises it, and none can: functions/package.json's test:integration passes '--only firestore' to emulators:exec, so the Storage emulator never starts. The deny-consequence of a regression is customers gaining read access to internal operational documents or the agent knowledge base, or internal roles losing upload ability with no failing test.

**Evidencia:**

```
functions/package.json:15: firebase emulators:exec --project demo-dute-operations --only firestore "node --test ..." — Storage emulator excluded. storage.rules:21-31: function isInternal() { return hasProfile() && profileRole() in ['owner','admin','interno','wms','financeiro','suporte']; } with firestore.get(userDoc()) cross-service lookup — untested.
```

**Correcao sugerida:** Change the flag to --only firestore,storage and add a small storage.rules.test.ts using @firebase/rules-unit-testing's storage() context: seed a users doc per role in Firestore, assert 'cliente' is denied read/write on all three prefixes and 'wms' can write product-photos; assert the catch-all denies unauthenticated access.

---

## Achados refutados na verificacao (nao sao problemas reais)

### R1. 30s polling wipes the operator's unsaved receiving-conference input

**Arquivo:** `artifacts/btg-inventory/src/pages/warehouse-ops.tsx`

The claimed mechanism does not exist in this codebase. The effect at warehouse-ops.tsx:7069 does depend on [task.id, task.items] and the query polls every 30s, but the claim that "task.items is a NEW array reference every 30 seconds even when content is identical" is false. The app uses @tanstack/react-query 5.101.2 (pnpm-lock.yaml:2833) with default structuralSharing enabled (src/lib/queryClient.ts only overrides refetchOnWindowFocus and retry). On each poll, replaceEqualDeep preserves the old reference for any deep-equal sub-tree: the /api/warehouse/ops response does include volatile top-level generated_at/updated_at (cloud-api.ts:2597-2598), but those are siblings of `queues`, and the entire queues sub-tree (cloud-api.ts:2616-2704) is built deterministically from Firestore data with no per-call timestamps or randomness. So ops.data.queues keeps referential identity across identical polls, and the useMemo at warehouse-ops.tsx:8005-8008 ([ops.data?.queues] dep) prevents normalizeQueues/sortTasks from ever re-running — no new task objects or items arrays are created. Even when queues content changes elsewhere, replaceEqualDeep recursion keeps unchanged task objects and their items arrays by reference, and none of normalizeQueues (801), sortTasks (788), scopeQueueTasks (1248), or queueEntries (1302) clone task objects, so task.items identity is preserved and the effect does not fire. The "window refocus" trigger is also wrong: refetchOnWindowFocus is globally disabled. The effect actually fires only when the conferenced task's own items genuinely change on the server (a real remote update, including right after the operator's own save) or when a real data change reorders entries[0] while no task is selected — a narrow, conditional edge case, not the claimed every-30s input wipe. As an every-30s data-loss bug, the claim is refuted.

### R2. Client portal fuzzy token matching cross-links WMS tasks/shipments/proofs from other requests sharing a SKU

**Arquivo:** `artifacts/btg-inventory/src/pages/client-portal.tsx`

The claimed failure path breaks at two independently verified points. First, request titles never contain SKU codes: client-portal.tsx:3546-3555 sends buildRequestDescription output as `description` (the payload has no `title`), and both backends store the title as the request type string — cloud-api.ts:1717 `title: String(data.title ?? data.type ?? "Solicitação do cliente")` and functions/src/domain/operations.ts:3058 `title: input.title ?? input.type` — so a withdrawal is stored with title "retirada" while the SKU-bearing text stays in description. buildRequestHistoryRow (client-portal.tsx:1447-1450) only falls back to description when the stored title is empty, which never occurs in any creation flow (portal form, client/estoque cart "Pedido do estoque com N item(ns)", client/request-form "Entrega de {supplier}", all set titles without SKU codes). requestReferenceTokens (1642-1666) contains no item sku_code tokens, so the SKU cannot enter matching from the request side; task-to-request linking works through exact customer_request_id/order_id fields written in the approve transaction (cloud-api.ts:1927,1949; operations.ts:3031), and queue task titles are unique order/receipt numbers ("SOL-XXXXXXXX", cloud-api.ts:2513). Second, the component is dead code: ClientPortal (default export, client-portal.tsx:3307) is imported nowhere — App.tsx routes the client experience only through pages/client/index.ts (inicio/estoque/solicitacoes/pedidos/etc.), none of which contain referenceMatches/taskMatchesRequest/buildRequestWmsSnapshot. The customer-facing impact described (seeing another request's picking/expedition/proof records) cannot occur because the code never renders and, even if it did, the SKU-in-title collision the claim depends on does not exist in stored data. The fuzzy ≥6-char bidirectional substring matcher is genuinely loose, but the concrete exploit path as claimed could not be traced.

