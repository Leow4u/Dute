---
name: BTG Billing Module (PARCIALMENTE OBSOLETO)
description: PARCIALMENTE OBSOLETO — decisões de produto seguem válidas, a implementação descrita (Clerk/Drizzle/Express) não existe mais
---

> **⚠️ PARCIALMENTE OBSOLETO.**
>
> As *decisões de produto* seguem válidas: faturamento single-client por desenho,
> papéis fail-closed, emissão de fatura atômica e e-mail não-fatal.
>
> A *implementação* descrita não existe mais — não há Clerk, Drizzle, transação
> `db.transaction` nem `lib/roles.ts`. O faturamento hoje vive em
> `functions/src/billing.ts` e `functions/src/index.ts`, sobre Firestore.
>
> Fonte de verdade atual: `CLAUDE.md` e `docs/`.

# Módulo de Cobrança Mensal

## Single-client by design
The billing module is **single-client**: one `billing_config` row (id=1, cliente_nome "BTG Pactual"),
and billing aggregates the *entire* inventory globally. There is **no per-tenant scoping** and none is
needed — Dutelog bills one client (BTG).
**Why:** a code review flagged "missing tenant isolation" on `/billing/me/*`, but multi-tenant is out of
scope. The `cliente` role isolates the *portal* (clients see only invoices, never inventory ops via
`blockCliente`), not multiple clients from each other.
**How to apply:** don't add tenant/client_id columns unless the user asks to onboard multiple clients —
that would require schema changes anyway.

## Role resolution is fail-closed
`getUserRole` (lib/roles.ts) throws if the Clerk lookup fails; middlewares (`requireInterno`,
`blockCliente`) catch and return 503, never defaulting to `interno`.
**Why:** defaulting to `interno` on a transient Clerk error is privilege escalation — a `cliente` could
gain internal access. A *successful* lookup with no role set still means `interno` (unassigned Dutelog
staff); only lookup *failure* denies.
**How to apply:** keep this fail-closed on any new role-gated route. Frontend mirror: `useRole` treats
missing role as `interno`.

## Invoice emission atomicity
Emit claims the period via a conditional `UPDATE ... WHERE id=? AND status='aberto' RETURNING id` inside a
`db.transaction`, and freezes items in the same tx (`freezeInvoiceItems` accepts an optional executor).
Zero rows returned = another request already emitted → 409. PDF/email happen *after* commit and are
non-fatal.
**Why:** prevents concurrent double-emit and keeps frozen items + status transition atomic.

## PDF & email
- PDF via **pdf-lib** (pure JS, bundles cleanly with esbuild; pdfkit's AFM font files break the bundle).
  Helvetica/WinAnsi can't encode emojis — strip them in the PDF, use group labels.
- Email via **Resend connector** (getUncachableResendClient); sender from `RESEND_FROM_EMAIL`. Email
  failure is non-fatal — emission still succeeds, `email_enviado_em` stays null.
