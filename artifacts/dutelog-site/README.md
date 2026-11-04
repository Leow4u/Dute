# Site institucional e painel do Blog Dutelog

Site em React/Vite com painel editorial em português e servidor Node para o Blog. O servidor entrega as páginas com conteúdo e metadados renderizados, consulta os artigos publicados e atualiza o sitemap. O build também gera uma fotografia estática inicial; o painel e as publicações posteriores exigem o runtime Node.

## Gerenciar artigos sem mexer no código

Quando esta versão estiver publicada, entre em [www.dutelog.com.br/admin/blog/](https://www.dutelog.com.br/admin/blog/) com seu acesso administrativo existente da Dutelog.

1. No primeiro acesso, clique em **Importar artigos do site**. A ação traz os seis artigos existentes para o painel, preserva o conteúdo público e habilita a criação de novos artigos. Repetir a importação não sobrescreve artigos já gerenciados.
2. Clique em **Novo artigo** ou abra um artigo da lista. Preencha título, endereço do artigo, resumo, categoria e serviço relacionado. O endereço pode ser editado antes da primeira publicação; depois fica preservado.
3. Escreva no editor visual. A barra oferece parágrafos, títulos, negrito, itálico, listas, citações, links, imagens e desfazer/refazer.
4. Escolha a capa e as imagens do texto na biblioteca ou envie novos arquivos. Informe uma descrição alternativa que explique cada imagem para quem não consegue vê-la.
5. Clique em **Salvar rascunho**. O painel confirma o salvamento; salvar não altera a versão que está no site.
6. Use **Prévia** para revisar o artigo com o visual do site. A prévia inclui o texto ainda não salvo, é privada e não cria um link público para o rascunho.
7. Quando estiver pronto, salve e clique em **Publicar**, confirmando a ação. Para um artigo já publicado, use **Atualizar publicação** após salvar as alterações.
8. Para remover um artigo do site, use **Retirar do ar** e confirme. O rascunho e seu endereço ficam preservados para uma publicação futura.

**A publicação é sempre manual.** Não há publicação ao salvar, agendamento ou disparo automático por uma esteira de deploy. Publicar um artigo não exige alterar código, fazer build ou publicar uma nova versão do sistema.

Para publicar, o artigo precisa de título, endereço válido, resumo, capa com descrição alternativa e texto. As imagens inseridas no texto também precisam de descrição alternativa. O painel pede que as alterações sejam salvas antes de permitir a publicação.

A lista permite pesquisar e filtrar artigos. O estado do artigo distingue rascunhos, publicações e alterações ainda não publicadas. Em caso de conflito com uma edição feita em outra sessão, o texto aberto é preservado; reabrir a versão salva pede confirmação para descartar alterações locais. Se a sessão expirar, o painel permite entrar novamente sem apagar o texto aberto.

## Acesso e imagens

O painel aceita usuários existentes do Firebase Authentication cujo perfil em `users/{uid}` tenha papel `owner` ou `admin` e não esteja desativado (`access_disabled`). A autorização é conferida no servidor a cada requisição. Não há cadastro aberto, criação de administrador ou senha padrão no painel.

O login gera uma sessão própria na origem do site, em cookie `HttpOnly`, `Secure` e `SameSite=Strict`. A sessão temporária do cliente Firebase é encerrada após a troca; senhas e tokens não são persistidos em `localStorage`. A sessão do painel é independente da sessão do app operacional.

Imagens aceitas: **JPEG, PNG e WebP estáticos, até 10 MiB por arquivo**. O servidor também limita cada lado a 12.000 pixels e a imagem a 40 megapixels, remove metadados e gera WebP com até 2.560 pixels no maior lado, sem ampliar a original. Arquivos da biblioteca permanecem privados enquanto não são usados em um artigo publicado. A mesma imagem pode ser reutilizada, com descrição alternativa adequada a cada uso.

## Desenvolvimento e validação

Use Node 22 e as dependências do workspace. Na raiz do repositório:

```powershell
cd C:\DEV\Dute
corepack pnpm --filter @workspace/dutelog-site run typecheck
corepack pnpm --filter @workspace/dutelog-site run test
corepack pnpm --filter @workspace/dutelog-site run build
corepack pnpm --filter @workspace/dutelog-site run test:build
```

`typecheck` verifica cliente e servidor. Os testes cobrem conteúdo, renderização, regras do Blog e APIs; `test:build` valida a saída gerada. A revisão visual e dos fluxos deve incluir desktop e celular.

Para desenvolvimento da interface, `corepack pnpm --filter @workspace/dutelog-site run dev` abre o Vite na porta 4174. `run preview` serve a saída estática. **Esses dois comandos não iniciam a API do painel.** Para verificar login, imagens, rascunhos e publicação, configure o ambiente abaixo, gere o build e inicie o servidor completo:

```powershell
cd C:\DEV\Dute
corepack pnpm --filter @workspace/dutelog-site run start
```

### Ambiente do runtime

| Variável | Uso |
| --- | --- |
| `BLOG_FIREBASE_CONFIG` | JSON com a configuração pública do aplicativo Web Firebase. `projectId`, `apiKey` e `storageBucket` são obrigatórios; inclua os demais campos oficiais do aplicativo, como `authDomain` e `appId`. |
| `BLOG_ORIGIN` | Origem exata do site, incluindo protocolo e porta quando houver. Padrão: `https://www.dutelog.com.br`. Usada nas verificações de origem, URLs públicas e acesso ao painel. |
| `PORT` | Porta HTTP do servidor; padrão `8080`. |
| `FIREBASE_AUTH_EMULATOR_HOST` | Somente na demonstração local: endereço local do emulador de Authentication, sem protocolo. |
| `FIRESTORE_EMULATOR_HOST` | Somente na demonstração local: endereço local do emulador de Firestore, sem protocolo. |
| `FIREBASE_STORAGE_EMULATOR_HOST` | Somente na demonstração local: endereço local do emulador de Storage, sem protocolo. |

Os projetos reais aceitos são `dute-prod` e `dute-homolog`. O Firebase Admin usa as credenciais do ambiente de execução; não coloque arquivo de conta de serviço na imagem ou no navegador. A conta de serviço do runtime precisa das permissões para validar sessões, consultar os perfis de acesso e operar os dados e imagens do Blog. A configuração pública do Firebase não substitui essas permissões.

Para uma demonstração isolada, use um projeto com prefixo `demo-`, `BLOG_ORIGIN=http://127.0.0.1:<porta>` e os três emuladores locais. Crie usuário e perfil administrativo apenas nos emuladores. O runtime recusa configuração de emuladores em projetos reais e não permite cookies inseguros fora do modo local. Não use usuários, dados ou credenciais de produção para alimentar uma demonstração.

Use `/health` como endpoint de saúde. O painel e as respostas privadas usam `no-store` e não devem ser indexados; caminhos públicos desconhecidos retornam HTTP 404 real.

## Organização do conteúdo e do código

- `src/admin/`: login, lista de artigos, editor visual, biblioteca de imagens e ações editoriais.
- `src/blog/model.ts`: contrato e validação do conteúdo; `Preview.tsx` e o renderizador compartilham a apresentação do artigo público.
- `server/api.ts`, `repository.ts`, `firebase.ts` e `media.ts`: sessões, autorização, persistência, publicação e processamento de imagens.
- `server/site.ts` e `server/html.ts`: servidor do site, renderização, cabeçalhos e metadados; `src/entry-server.tsx` é a entrada React no servidor.
- `src/content/articles.json`: catálogo inicial usado pela importação e como conteúdo público enquanto o painel ainda não foi inicializado. Após a importação, o catálogo publicado no Firestore é a fonte de verdade; editar esse JSON não é o fluxo de atualização do Blog.
- `src/content/services.json`: sete especialidades de Logística Corporativa e duas modalidades de Transporte de Cargas.
- `src/pages/Services.tsx`, `Home.tsx` e `About.tsx`: serviços e conteúdo institucional.
- `src/routes.ts`: caminhos e metadados; `src/content.ts`: canais de contato e área do cliente.

O Blog usa as coleções `site_blog_drafts`, `site_blog_posts`, `site_blog_media`, `site_blog_slugs` e `site_blog_meta`, e o prefixo `site-blog/` no Storage. As APIs não aceitam caminhos arbitrários para acessar coleções ou arquivos do app operacional.

## Build, pacote de runtime e publicação do sistema

O build gera três diretórios necessários:

- `dist/public`: JavaScript, CSS, fontes, imagens e saída estática inicial.
- `dist/server`: renderização React e template HTML para o runtime.
- `dist/runtime`: servidor Node compilado.

Não edite arquivos gerados. A antiga publicação somente de `dist/public` em Nginx não atende o painel nem as atualizações do Blog.

Monte o contexto da imagem em uma **pasta nova, absoluta e fora do repositório**. Substitua `COMMIT` pela identificação da revisão validada:

```powershell
cd C:\DEV\Dute
node artifacts/dutelog-site/scripts/stage-release.mjs C:\DEV\releases\dutelog-site-COMMIT
Push-Location -LiteralPath C:\DEV\releases\dutelog-site-COMMIT
try {
  npm install --package-lock-only --ignore-scripts
} finally {
  Pop-Location
}
```

O script copia apenas `dist` e o `Dockerfile`, e gera o manifesto das dependências de runtime e `.dockerignore`. O comando seguinte gera o `package-lock.json` desse pacote. O `Dockerfile` usa Node 22 e instala apenas dependências de produção. Use essa pasta como contexto de build da imagem; nunca envie a árvore do repositório, `.env`, `.secrets`, `tmp` ou dados de produção.

A publicação do sistema deve seguir o contrato de trabalho em `CLAUDE.md`: `main` limpa e atualizada, verificações exigidas verdes e autorização aplicável. O destino do site institucional é exclusivamente o serviço **`dutelog-site`**, em **`southamerica-east1`**, no projeto **`dute-prod`**. Os workflows de publicação do app operacional não são o destino deste pacote. Preserve o serviço `app.dutelog.com.br`, seus acessos e DNS.

Antes de promover uma revisão, verifique a candidata: páginas públicas, artigo publicado, imagens, sitemap, 404 e fluxos privados em ambiente de teste. Registre commit, digest da imagem e revisão anterior para permitir retorno. A publicação editorial pelo botão do painel promove a versão salva do artigo e não exige esse processo de deploy.

O runtime Node processa imagens em memória: no Cloud Run, use 1 GiB de memória e concorrência 4 por instância. Preserve o limite de cinco instâncias e os acessos existentes. A conta atual permite criação/leitura de imagens; se a gravação dos metadados falhar, a limpeza compensatória pode deixar um objeto privado órfão por não haver permissão de exclusão. Isso não torna o arquivo público.

## Contato, identidade e imagens institucionais

O contato usa `comercial@dutelog.com.br` e `(11) 5039-0681`. O formulário valida e prepara a mensagem, permite revisão e abre o aplicativo de e-mail do visitante; o envio acontece nesse aplicativo. Também oferece cópia da mensagem e canais diretos. Os campos não são salvos em cookies, `localStorage`, analytics ou banco. A área do cliente permanece `https://app.dutelog.com.br`.

Os logos oficiais e o ícone são preservados. As imagens ilustrativas aprovadas em `public/images` não representam registros de instalações, equipes ou operações reais; a indicação permanece no rodapé. Manrope é servida localmente e sua licença acompanha `public/fonts/OFL.txt`.
