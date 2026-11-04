# Site institucional Dutelog

Implementação do protótipo aprovado em 04/11/2026. React/Vite com 24 páginas pré-renderizadas e uma página 404. O build entrega arquivos estáticos compatíveis com `deploy/cloud-run/Dockerfile.site` e Nginx; não exige um servidor React em produção.

## Desenvolvimento e validação

Na raiz do repositório:

```powershell
cd C:\DEV\Dute
corepack pnpm --filter @workspace/dutelog-site run dev
corepack pnpm --filter @workspace/dutelog-site run typecheck
corepack pnpm --filter @workspace/dutelog-site run test
corepack pnpm --filter @workspace/dutelog-site run build
corepack pnpm --filter @workspace/dutelog-site run test:build
corepack pnpm --filter @workspace/dutelog-site run preview --host 127.0.0.1
```

Porta padrão: 4174. O desenvolvimento usa renderização no cliente. A prévia serve o build em `dist/public`; as páginas possuem conteúdo e metadados próprios antes de carregar o JavaScript. O Nginx entrega uma resposta 404 real para caminhos desconhecidos.

O CI verifica tipos, testes de conteúdo/contato, geração do site e integridade dos links, ativos, âncoras e metadados. A revisão de layout e interações deve incluir desktop e celular.

## Conteúdo

- `src/content/services.json`: sete especialidades de Logística Corporativa e duas modalidades de Transporte de Cargas.
- `src/content/articles.json`: artigos, categorias, imagens, seções e serviço relacionado. Para criar artigo, adicione um objeto com slug único, título, resumo, categoria, imagem, tempo de leitura, serviço e seções. A listagem, rota, metadados e sitemap passam a incluí-lo no próximo build.
- `src/pages/Services.tsx`: páginas das três frentes e Armazenagem.
- `src/pages/Home.tsx` e `About.tsx`: conteúdo institucional.
- `src/routes.ts`: caminhos e metadados das páginas.
- `src/content.ts`: canais de contato e área do cliente.

O Blog é mantido em arquivos versionados. Não há CMS ou painel editorial nesta entrega. Os artigos atuais são conteúdo introdutório, sem dados de clientes ou alegações operacionais não verificadas.

## Contato

O site anterior usa `comercial@dutelog.com.br` e `(11) 5039-0681`. Não existe um endpoint público de captação neste projeto. O formulário valida e prepara uma mensagem, permite revisão/edição e abre o aplicativo de e-mail do visitante. O visitante envia a mensagem nesse aplicativo; o site não declara entrega. Também oferece cópia da mensagem e os canais diretos.

Os campos não são salvos em cookies, localStorage, analytics ou banco. Nenhuma API da plataforma operacional é chamada. O endereço da área do cliente permanece `https://app.dutelog.com.br`.

## Identidade e imagens

Logos oficiais preservados byte a byte; ícone existente mantido. As quatro imagens ilustrativas do protótipo aprovado estão em `public/images`, comprimidas em WebP sem alterar composição ou inserir marca. Não são registros de instalações, equipes ou operações reais. A indicação de imagens ilustrativas permanece no rodapé.

Manrope é servida localmente; a licença original acompanha os arquivos em `public/fonts/OFL.txt`. Não há dependência de Google Fonts no carregamento da página.

## Publicação

Saída: `artifacts/dutelog-site/dist/public`. O script gera o HTML por rota, `sitemap.xml` e `404.html`; não editar arquivos gerados. O build SSR intermediário fica em `dist/server` e não vai para o Nginx.

Esta implementação não altera DNS, não publica serviços e não modifica o app operacional. A publicação do site deve seguir as regras do repositório, a partir de uma revisão aprovada, com verificação do domínio após o deploy.

Referências técnicas: [pré-renderização com Vite](https://vite.dev/guide/ssr.html) e [hidratação React](https://react.dev/reference/react-dom/client/hydrateRoot).
