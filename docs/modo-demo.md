# Modo demo

Roda o app inteiro com **dados fictícios**, em emuladores locais do Firebase,
para demonstração comercial e capturas de tela. Nada é lido nem escrito no
projeto de produção.

## Como funciona

- `VITE_DEMO_MODE=true` faz o app usar o projeto `demo-dute` e conectar só nos
  emuladores (Auth `9099`, Firestore `8088`, Functions `5001`). A configuração
  `VITE_FIREBASE_*` é ignorada nesse modo, então um `.env` de produção na
  máquina não vaza para a demo (`artifacts/btg-inventory/src/lib/firebase-config.ts`).
- `functions/src/demo/seed-demo.ts` popula o emulador pelas **mesmas transações
  de domínio** de produção: inventário de abertura, solicitações do portal,
  aprovação e etapas do WMS. As projeções do portal (`client_inventory`,
  `client_order_tracking`, `client_request_status`) saem exatamente como em
  produção. Só as faturas (`client_invoices`) são gravadas direto.
- O seed recusa rodar sem `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST`
  ou com projeto que não comece com `demo-`. Ele não entra no build de deploy
  das functions (`functions/tsconfig.json` exclui `src/demo/**`).
- As Functions não são emuladas: telas funcionam para leitura, e ações que
  chamam callables (aprovar, avançar etapa) falham na demo.

Os endereços dos itens são prefixados pela área dona do estoque (`STORE/`,
`MKT/`, `EVT/`). As fotos apontam para `https://demo-assets.dutelog.local`,
um host fictício: o domínio exige URL https, e o script de capturas intercepta
esse host e serve ilustrações. Abrindo a demo manualmente no navegador, as
fotos aparecem quebradas.

## Passo a passo

Pré-requisitos: Java (emulador do Firestore), `firebase-tools`
(`npm i -g firebase-tools`) e, para as capturas, Playwright
(`npm i -g playwright`).

```powershell
# 1. Emuladores (deixe rodando)
firebase emulators:start --project demo-dute --only firestore,auth

# 2. Seed (outro terminal)
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8088"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
npm --prefix functions run demo:seed

# 3. App em modo demo
$env:VITE_DEMO_MODE = "true"
corepack pnpm --filter "@workspace/btg-inventory" run dev

# 4. Capturas (opcional) — saem em tmp/demo-screenshots
$env:NODE_PATH = (npm root -g)
node tools/demo/screenshots.mjs
```

Usuários (senha `demo-dute-2026`):

| Perfil | E-mail |
|---|---|
| Cliente (portal) | `cliente@demo.dutelog.com.br` |
| Interno (owner) | `operacao@demo.dutelog.com.br` |

Rodar o seed de novo apaga o emulador e recria tudo.

## Cuidados

- Nunca publique um build com `VITE_DEMO_MODE=true`: o app tentaria falar com
  emuladores em `127.0.0.1` e não funcionaria.
- Use só dados fictícios no seed. Não copie dado real de cliente para cá.
