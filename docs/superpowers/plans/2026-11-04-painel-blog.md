# Painel editorial do Blog Dutelog — implementação

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development to execute the tasks with focused tests and independent review.

**Goal:** Permitir gerenciar artigos em português, com editor visual, imagens, rascunhos e prévia, sem editar arquivos do projeto.

**Architecture:** Painel em `/admin/blog/` e API privada no próprio serviço institucional. Identidade Firebase existente, sessão httpOnly e autorização owner/admin ativa por requisição. Firestore e Storage com prefixos exclusivos do Blog; nenhuma mudança no aplicativo operacional.

**Tech Stack:** React/Vite, Tiptap, Node/Express, Firebase Admin, Firestore, Cloud Storage e Sharp.

**Spec:** Pedido do usuário neste chat em 04/11/2026 e correção posterior: não implementar publicação automática.

## Escopo e decisões

- Salvamento de rascunho nunca altera o artigo público. Prévia privada com o mesmo componente visual dos artigos.
- Painel, mensagens e controles em português, responsivo, usando a marca oficial.
- Reaproveitar login por e-mail/senha; não criar senha padrão, nova função de acesso ou cadastro aberto.
- Editor: parágrafos, títulos, negrito/itálico, listas, citações, links, desfazer/refazer e imagens com texto alternativo.
- Campos: título, endereço amigável, resumo, categoria, capa e solução relacionada. Lista com busca/estado, criar/editar, salvar e pré-visualizar.
- Imagens JPEG/PNG/WebP até 10 MiB, decodificadas e reprocessadas no servidor; armazenar sem metadados. Imagens inéditas e rascunhos privados.
- Conflito entre duas abas deve recusar sobrescrita, preservando o conteúdo local.
- Sem agendamento, publicação ao salvar ou pipeline de deploy acionado pelo editor.
- Usuário confirmou **Botão Publicar no painel**. Publicar/Atualizar promove explicitamente a versão salva; Retirar do ar remove a versão pública, preservando o rascunho. Não há publicação ao salvar ou agendada.
- Manter os seis artigos atuais; migração explícita e idempotente, nunca sobrescrever conteúdo já editado.

## Contratos entre as partes

`src/blog/model.ts` fornece `RichNode`, `BlogDraft`, `BlogRecord`, `BlogMedia`, `BlogActor`, `parseDraft`, `legacyToDraft`, `slugify`, `mediaIds`, `readTime`.

`BlogDraft = {title,slug,excerpt,category,service,cover:{src,alt},body:RichNode}`.

`BlogRecord = {id,revision,draft,createdAt,updatedAt,updatedBy,publishedAt:string|null,publishedSlug:string|null}`. Datas ISO. IDs UUID. `BlogMedia = {id,src,alt,name,width,height,createdAt}`. `BlogActor = {uid,email,name,role}`.

API JSON em `/api/blog`: `GET /session` -> `{user: BlogActor|null, firebaseConfig}`, `POST /session {idToken}`, `DELETE /session`; `GET /drafts` -> `{items:BlogRecord[]}`, `POST /drafts {draft}` -> `{item}`, `GET /drafts/:id`, `PUT /drafts/:id {draft,revision}` -> `{item}`; `GET /media` -> `{items}`, `POST /media` com bytes da imagem e headers Content-Type, X-File-Name, X-Image-Alt -> `{item}`; `GET /media/:id` serve bytes apenas quando autorizado. Erros `{error:{code,message}}`, 409 conflito, 401 sessão, 403 acesso, 422 conteúdo inválido.

Prévia é parte do painel: estado do editor renderizado com `ArticlePage`/renderizador seguro, carregando imagens pela sessão, sem URL pública compartilhável. Endpoint privado de rascunho e resposta do painel sem cache/noindex. API aceita mutações somente com Origin configurada e Content-Type esperado; sessão com cookie HttpOnly/SameSite e Secure em HTTPS.

Publicação manual: `POST /drafts/:id/publish {revision}` e `POST /drafts/:id/unpublish {revision}` retornam `{item}`. CAS, slug único e estável após primeira publicação. `site_blog_posts/{slug}` contém apenas snapshot publicado; `site_blog_slugs/{slug}` reserva o endereço. `getCatalog()` retorna `{initialized,posts:PublishedBlogPost[]}`; `PublishedBlogPost={id,content:BlogDraft,publishedAt,updatedAt}`. Até importar/primeira publicação, o catálogo existente dos seis artigos é mantido; primeira publicação manual pode importar esses artigos atomically. Após inicializar, somente snapshots publicados entram nas páginas, home e sitemap. Erros do banco nunca ressuscitam artigos retirados do ar. Imagens novas ficam privadas até uma publicação que as referencie; referências compartilhadas impedem retirar imagem usada por outro artigo.

## Tarefas

- [x] 1. Modelo e validação: testes de conteúdo malicioso, URLs, profundidade/tamanho, imagens e slug; conversão dos artigos existentes. Implementar contrato puro compartilhado.
- [x] 2. Backend privado: testes HTTP de autorização, CSRF, rascunhos, conflitos, upload e privacidade; repositório Firestore com transações e armazenamento restrito. Não alterar regras ou módulos operacionais.
- [x] 3. Painel/editor: login, lista/busca, estados vazios/erros, edição, imagens e salvamento com feedback; saída com alterações não salvas e conflito sem perda; editor carregado apenas no painel.
- [x] 4. Prévia e integração: reutilizar o layout público, renderizar rich text seguro e capa variável; manter o build estático e rotas públicas existentes. Runtime site-only e empacotamento com lista explícita.
- [x] 5. Decisão de publicação manual: registrar resposta do usuário e implementar somente o fluxo confirmado.
- [x] 6. Verificação: typecheck, testes do site/backend, build, HTTP integrado e navegador desktop/celular; revisão independente de isolamento de dados e acesso. Documentar acesso/uso e limites de publicação.

### Evidência de implementação

- 44 testes do site/API/renderização, 3 testes do build e 7 testes com transações reais no emulador Firestore passaram. Auth, Storage e Firestore locais usados no fluxo de navegador de criação, envio de imagem, prévia, publicação, atualização e retirada; nenhum artigo de teste criado em produção.
- Desktop em 1280 pixels e celular em 390 × 844 conferidos no navegador; rascunho privado e versão publicada independentes verificados também por HTTP anônimo. Nova sessão real do emulador conferida após atualizar Firebase Admin para 14.5.
- 48 testes de preservação/zeragem e 16 de índices passaram. As cinco coleções editoriais foram incluídas na preservação obrigatória das ferramentas de manutenção. A suíte Python completa teve 11 falhas locais relacionadas à resolução do Bash/WSL no Windows; a validação Linux fica no CI.
- Login com credenciais administrativas reais de produção não foi executado. A conta de serviço e a configuração pública foram inspecionadas sem ampliar permissões; o primeiro acesso real é feito pelo administrador com sua senha existente.

## Review Focus

- Rascunho ou imagem inédita nunca vaza para visitante anônimo, cache ou sitemap.
- Perfil removido perde acesso mesmo com cookie ainda válido; papel não administrativo é negado.
- Conteúdo colado, links e uploads não executam scripts nem acessam URLs/arquivos arbitrários no servidor.
- Salvar edição de um artigo público não altera sua versão publicada.
- Dois editores/abas não sobrescrevem silenciosamente alterações; erro de rede não apaga trabalho.

## Entrega e infraestrutura

A versão de desenvolvimento e a homologação devem usar emuladores ou ambiente separado. Nenhum teste cria artigo público real. O runtime novo exige substituir o Nginx puro por Node no serviço do site; o pacote de deploy deverá conter exclusivamente o build público, o servidor compilado e suas dependências, nunca a árvore inteira do repositório. Produção segue a regra de main limpa e CI verde e deve ser tratada separadamente da edição/publicação editorial.
