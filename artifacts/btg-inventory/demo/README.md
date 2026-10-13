# Demonstração do sistema

O app de verdade (`src/App`) com login próprio, dados fictícios e Agent Dute
roteirizado, num único arquivo HTML. Serve para apresentar o sistema a um
cliente em prospecção sem tocar na produção: não usa Firebase, não chama a
API e não sai do navegador.

```powershell
corepack pnpm --filter "@workspace/btg-inventory" run build:demo
# -> artifacts/btg-inventory/dist/demo/dutelog-demo.html
```

Abra o arquivo no Chrome ou no Edge, com dois cliques. Funciona sem internet.

## Acessos

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Portal do cliente (TikTok) | `tiktok@demo.dutelog.com.br` | `demo` |
| Operação Dutelog | `equipe@demo.dutelog.com.br` | `demo` |

Os dois cartões da tela de entrada também entram direto.

## O que funciona

- Navegar por todas as telas do portal e da operação.
- Montar um pedido no Estoque e enviar: ele aparece em Pedidos.
- Entrar como Operação Dutelog e aprovar ou recusar o pedido.
- Perguntar ao Agent Dute sobre estoque, pedidos, envios, faturas e kits.
- Protótipo de envio de kits para creators:
  - **Kits**: composições salvas ("Kit lançamento TikTok Shop"), com quantos
    kits o estoque de hoje monta. "Usar no pedido" carrega o kit no Estoque.
  - **Destinatários**: agenda de creators, agências, eventos e escritórios,
    com endereço, contato e tamanho de roupa.
  - **Pedido com vários destinos**: no Estoque, "Adicionar destino" e
    "Escolher da agenda". Cada destino vira um pedido próprio, e a roupa do
    kit segue o tamanho de cada destinatário. "Salvar como kit" guarda a
    composição do pedido.
  - **Mensagem no cartão**: uma mensagem padrão no pedido, com `{nome}`
    trocado pelo nome de cada destinatário, e "Personalizar" para escrever
    uma mensagem só daquele destino. "Ver e imprimir cartões" abre os
    cartões prontos para ir na caixa. O kit modelo guarda a mensagem padrão.
- "Restaurar os dados da demonstração", na tela de entrada, desfaz tudo.

Anexar arquivos (nota fiscal, fotos) não funciona na demonstração.

## Fotos

Cada item tem uma foto real em `photos/`, com o número do item (`01.jpg` é
o item 1 de `data.ts`). São fotos do Unsplash, de uso livre inclusive
comercial; a origem de cada uma está em `photos/CREDITS.md`. O build embute
as fotos no HTML.

## Onde ficam os dados

- `data.ts`: catálogo, pedidos, envios, faturas, documentos e as rotas `/api`.
- `functions-api.ts`: respostas do Agent Dute.
- `session.ts` e `login.tsx`: perfis e tela de entrada.

Para outro cliente, troque `CUSTOMER`, o catálogo e os pedidos em `data.ts`.

## O que é cópia do app

- `portal/estoque.tsx` é uma cópia de `src/pages/client/estoque.tsx` com o
  pedido para vários destinos. O build da demo troca o original por ela.
- `not-found.tsx` substitui o 404 para servir as telas Kits e Destinatários,
  que não existem nas rotas do app; `menu.ts` põe as duas no menu.
- Mudou o Estoque do app? Refaça a cópia antes de gerar a demo de novo.

## CSS de produção

`src/index.css` limita a varredura do Tailwind à pasta `src`
(`@import 'tailwindcss' source(".")`). As classes usadas só aqui entram no
CSS da demo e nunca no de produção.

```powershell
corepack pnpm --filter "@workspace/btg-inventory" exec tsc -p demo/tsconfig.json --noEmit
```
