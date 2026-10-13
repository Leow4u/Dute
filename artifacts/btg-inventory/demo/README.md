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
- Perguntar ao Agent Dute sobre estoque, pedidos, envios e faturas.
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

## Cuidado com classes do Tailwind

O build de produção também varre esta pasta atrás de classes. Use aqui só
classes que o app já usa e ponha o resto em `demo.css`, em CSS comum. Assim o
CSS de produção continua idêntico com ou sem a demo.
