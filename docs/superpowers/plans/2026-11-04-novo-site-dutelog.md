# Novo site Dutelog — plano de implementação

**Goal:** implementar no site institucional a experiência HTML aprovada em 04/11/2026.
**Architecture:** React/Vite existente, componentes compartilhados e conteúdo estruturado. Pré-renderização no build gera HTML e metadados próprios para cada rota, compatíveis com o Nginx atual e seu 404 real. Interações são hidratadas no navegador.
**Tech Stack:** React 19, TypeScript, Vite 7, CSS e testes nativos Node.
**Spec:** protótipo aprovado em `C:/Users/leona/.codex/visualizations/2026/11/04/01a1a465-fd54-7e10-ac56-d2b17b28416c/dutelog-prototipo-html` (HTML, CSS, conteúdo e capturas).

## Restrições

- Prioridades: Logística Corporativa, Transporte de Cargas, Armazenagem.
- Preservar as sete especialidades corporativas, duas modalidades de transporte, institucional, Blog e contato.
- Preservar composição, tipografia, fotos e comportamento do protótipo aprovado; logos oficiais sem redesenho.
- Não inventar números, clientes, certificações, cobertura ou resultados.
- Preservar `https://app.dutelog.com.br`, `comercial@dutelog.com.br` e telefone `(11) 5039-0681` do site existente.
- Não criar falso envio: sem backend público existente, o contato prepara mensagem para o aplicativo de e-mail e oferece cópia e telefone.
- Não modificar app operacional, dados, autenticação, DNS ou publicar neste trabalho.

## Tarefas

- [x] Base: conteúdo tipado, rotas canônicas, componentes de apresentação, identidade e ativos locais.
- [x] Páginas: transportar Home, hubs, nove serviços, Armazenagem, institucional, Blog e seis artigos para React.
- [x] Interações: menus acessíveis, rolagem das etapas, busca/filtros, FAQs, leitura e contato com revisão.
- [x] Entrega estática: HTML por rota, metadados, sitemap, robots, 404, build no container existente.
- [x] Validação: testes de entrada/busca/contato, integridade do build, typecheck e QA visual/interativa desktop e celular.

## Interfaces

- `src/content.ts`: `services`, `articles`, tipos `Service`, `Article`, `ImageName`; `serviceHref(slug)`, `articleHref(slug)`, `contactHref(service?)`.
- `src/components/ui.tsx`: `Arrow`, `Photo`, `Button`, `TextLink`, `Breadcrumbs`, `ClosingCta`, `ArticleCard`, `Journal`, `ServiceRows`, `Faq`.
- Páginas recebem dados tipados. `App({pathname})` resolve a rota, fornece o layout comum e a página 404 para caminho desconhecido.
- `src/entry-server.tsx`: `render(pathname)` retorna HTML e metadados; script de build grava os arquivos reais.

## Foco de revisão

1. Acesso direto/refresh de serviços e artigos deve funcionar sem fallback genérico para a home.
2. Busca sem acentos, categorias desconhecidas e zero resultados devem produzir estados coerentes.
3. Formulário vazio, retorno para edição e caracteres especiais não podem perder dados ou fingir entrega.
4. Menus por teclado, mobile, movimento reduzido e conteúdo sem JS devem continuar utilizáveis.
5. HTML, canonical, sitemap e links internos devem concordar; logo e área do cliente devem permanecer corretos.

## Decisões

- Execução autorizada pelo usuário após aprovação do protótipo; prosseguir sem nova aprovação de design.
- Usar checkout atual em `codex/novo-site-dutelog`; nenhuma mudança pré-existente no início.
- Conteúdo editorial em arquivos versionados, sem criar CMS ou dependência remota não solicitada.
- Dividir arquivos entre agentes para evitar edições concorrentes; revisar integração e build em conjunto.

## Verificação concluída

- Typecheck, 11 testes de conteúdo/contato e 3 testes de integridade do build passaram. CI inclui essas verificações.
- Revisão independente de código sem achados críticos ou importantes.
- Navegador real: desktop 1280×720 e celular 390×844; menu, FAQ, contato com revisão/edição/cópia, filtros e busca com recarregamento, artigos e rolagem horizontal verificados.
- 23 rotas de conteúdo e mapa do site abertos no celular, sem largura excedente nem imagem com falha; console sem erros nas interações observadas.
- Comparação direta entre as capturas aprovadas e a implementação: composição da home preservada. Diferenças intencionais: fotos WebP, canais reais/área do cliente, retirada das notas de protótipo e contato por e-mail em vez de simulação.
- Não executados deploy, testes em dispositivos físicos, auditoria formal de acessibilidade ou teste do container Nginx.
