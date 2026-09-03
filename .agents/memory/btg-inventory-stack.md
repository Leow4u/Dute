---
name: BTG Inventory Stack (OBSOLETO)
description: OBSOLETO — descreve o stack Clerk/Express/Drizzle/PostgreSQL removido em julho de 2026
---

> **⚠️ OBSOLETO — NÃO USE.**
>
> Este documento descreve o stack anterior (Clerk, Express, Drizzle, PostgreSQL,
> Orval), removido na migração para Firebase/Google Cloud em julho de 2026.
> Nada aqui reflete o sistema atual: autenticação é Firebase Auth, dados são
> Firestore, backend são Cloud Functions e não existe mais `artifacts/api-server`.
>
> Fonte de verdade atual: `CLAUDE.md` e `docs/`. Mantido apenas como registro
> histórico.

## Stack
- Frontend: React + Vite (artifacts/btg-inventory), @clerk/react, wouter routing, recharts, shadcn/ui
- Backend: Express (artifacts/api-server), @clerk/express, Drizzle ORM + PostgreSQL
- Codegen: Orval v8 from lib/api-spec/openapi.yaml → lib/api-client-react + lib/api-zod

## Critical: Zod + Orval
- Zod workspace version is ^3.25.76 (v3, NOT v4)
- Orval v8.20+ generates zod.looseObject({}) for bare `type: object` items — looseObject is Zod v4 only
- Fix: use `additionalProperties: true` with a named schema (AnyRecord) → generates zod.record(zod.string(), zod.unknown())
- zod/v4 subpath import IS valid in Zod v3.24+ (backwards-compat layer)

## DB Build
- lib/db has composite: true — must run `pnpm --filter @workspace/db exec tsc --build` before api-server typecheck
- Tables: productsTable, skusTable, movementsTable, ordersTable

## Data Imported
- 600 products, 932 SKUs, 1261 movements, 242 orders from Excel spreadsheet

## CORS
- Production: set CORS_ALLOWED_ORIGINS env var (comma-separated)
- Development: any origin containing 'replit' is allowed automatically
