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
- Perguntar ao Agent Dute sobre estoque, pedidos, envios, faturas, kits e eventos.
- Estoque com o que a TikTok leva para eventos: ícones (ícone gigante
  iluminado, mala e cubo infláveis), cenografia de palco e de estande
  (portal, celulares gigantes, pórticos neon, cabine de fotos, backdrop),
  mobiliário e brindes personalizados (garrafa, caneta, caderno, copo, power
  bank, chaveiro). "Mais relevantes" ordena pelo valor guardado.
- **Eventos**: modelos como TikTok Live Fest, TikTok Shop Day e o estande da
  Game XP, com local, data da próxima edição, montagem, transporte e a lista
  do que vai. Mostra o que falta no saldo livre de hoje e o valor das peças
  (base do seguro). "Usar no pedido" abre o pedido com itens, local, entrega
  na véspera às 7h e as instruções; "Salvar como evento" guarda um pedido
  montado no Estoque.
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

## Link para o cliente (só o portal)

`build:demo:cliente` gera `dist/demo-cliente/index.html`: o mesmo arquivo, mas
o login só aceita o portal (`tiktok@demo.dutelog.com.br`, senha `demo`). A
sessão da operação é ignorada e as rotas internas voltam para o portal. É o
que vai por link para a empresa testar sozinha.

Publicação num site próprio do Firebase Hosting, separado da produção
(`app.dutelog.com.br` continua no Cloud Run e não muda):

```powershell
corepack pnpm --filter "@workspace/btg-inventory" run build:demo:cliente
# só na primeira vez; se o nome estiver em uso, troque aqui e em firebase.demo.json
firebase hosting:sites:create dutelog-demo --project dute-btg
firebase deploy --only hosting --project dute-btg --config artifacts/btg-inventory/firebase.demo.json
```

O link fica `https://dutelog-demo.web.app`, sem indexação em buscador
(`X-Robots-Tag`). Cada pessoa vê os próprios pedidos: tudo fica no navegador
dela e nada chega à Dutelog.

## Inglês

Na tela de entrada, o botão **English** troca o idioma (fica guardado no
navegador; **Português** volta). Nada no app de produção muda:

- `i18n/boot.ts` é o primeiro import: troca o locale `pt-BR` por `en-US` em
  `Intl` e `toLocale*String` antes de o app criar seus formatadores, e liga o
  tradutor.
- `i18n/translator.ts` observa o DOM e troca cada texto pelo dicionário
  (`i18n/en-phrases.json`, frase exata) ou pelas regras de `i18n/rules.ts`
  (textos com número, nome ou data). Não mexe em `textarea` nem em
  `[data-no-translate]`.
- Os dados da demo (nomes e cores dos itens, kits, agenda, conversas e
  respostas do Agent Dute) nascem em inglês via `pick(pt, en)`, para a busca e
  o agente funcionarem no idioma. Endereços, pessoas e fornecedores ficam como
  estão; tamanhos seguem P/M/G/GG (a ordenação do app conhece só esses).
- Cada idioma tem o próprio estado salvo (`dute.demo.state.v1` e
  `dute.demo.state.v1.en`).

Texto novo no app que apareça em português na versão em inglês: acrescente a
frase em `en-phrases.json` (ou uma regra, se tiver número ou nome).

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
