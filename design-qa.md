# Pessoas e acessos — QA de design, 28/10/2026

- Fonte aprovada: `/workspace/generated_images/exec-35ec9708-5cc0-4065-8a2c-73ddac835757.png` (primeira imagem apresentada no chat).
- Implementação: `/tmp/dute-people-qa/desktop-menu.png`; tela sem menu em `/tmp/dute-people-qa/desktop.png`.
- Viewport: desktop 1526×876, celular 390×844, deviceScaleFactor 1.
- Densidade: fonte 1656×950, normalizada para 1526×876 com Lanczos; implementação capturada em 1526×876 CSS/pixels. Ambos sem moldura de navegador.
- Estado comparado: tema claro, aba Pessoas, 7 ativos e 1 convite pendente, menu do convite aberto.
- Comparação conjunta: `/tmp/dute-people-qa/comparison.png`.
- Recortes conjuntos: `/tmp/dute-people-qa/comparison-header.png` e `/tmp/dute-people-qa/comparison-rows.png`.
- Evidências adicionais: `resend.png`, `archive.png`, `profiles.png`, `mobile.png`, `mobile-profiles.png`, `dark.png`, em `/tmp/dute-people-qa/`.
- Navegador: ferramentas do Browser não foram expostas nesta sessão; Chromium local por Playwright. URL `http://127.0.0.1:5174/configuracoes/pessoas`. Firebase emulado; callables `.run` reais chamadas pelo adaptador de teste, sem produção.

## Comparação das superfícies

- Tipografia: Plus Jakarta Sans, texto 14px e título 24px pelos tokens existentes. Fonte disponível no fixture local da família já usada pelo app. A escala do produto foi mantida, sem valores arbitrários para imitar o raster.
- Espaçamento: tabela ocupa a área útil, papéis em uma linha no desktop, ações com espaço próprio e sem barra horizontal. A aba de arquivados tira acessos removidos da lista principal. No celular a tabela vira linhas empilhadas, sem cortar identidade ou ações.
- Cores: tokens semânticos nos dois temas, incluindo cabeçalho com contraste corrigido; nenhuma cor fixa nova.
- Assets: ícones da biblioteca e avatares de iniciais são controles do sistema, como no mockup; não há imagens fotográficas/ilustrações a substituir.
- Conteúdo: nomes/e-mails/perfis legíveis, reenvio explícito, cancelamento separado de remoção. As mensagens distinguem agendamento de entrega do e-mail e preservação do histórico.

## Histórico da comparação e correções

1. [P2, corrigido] A largura máxima do layout antigo limitava a tabela: a tela Pessoas agora usa toda a área útil, com margens laterais de 48px no desktop amplo. Evidência posterior: `desktop.png` e `comparison.png`.
2. [P2, corrigido] Cabeçalhos herdavam texto com opacidade insuficiente: alterados para `text-muted-foreground`; axe com contraste passou na captura posterior.
3. Evidências finais capturadas com as animações concluídas. Diálogos permanecem centralizados e legíveis. Não restam achados P0/P1/P2.

## Diferenças intencionais

- Ajuda dos perfis na área de ações do PageHeader, respeitando o componente existente.
- A própria conta não oferece ações de acesso. O papel owner mantém seu rótulo real.
- Menu abre para cima quando há pouco espaço abaixo, conforme prevenção de colisão do Radix.
- Status de envio e data da solicitação permanecem separados para não confundir agendamento com entrega.

## Verificações

- Identidade da página, conteúdo não vazio, ausência de overlay de erro e ausência de erros JavaScript/console: aprovados.
- Busca sem distinção de maiúsculas, filtro de pendentes, ajuda sob demanda, confirmação/reenvio, bloqueio de novo envio agendado, remoção confirmada persistida, abas, celular e tema escuro: aprovados.
- Axe WCAG 2.1 A/AA no conteúdo, incluindo contraste: aprovado. Não se afirma auditoria completa de acessibilidade de todo o app.
- Revisão independente e testes de segurança detalhados no plano da implementação.
- Não houve publicação nem envio real de convites.

final result: passed

---

# Relatório anterior preservado

# Estoque Marketplace: QA de Design

- Fonte visual: `C:\Users\leona\AppData\Local\Temp\codex-clipboard-6aa08852-527a-4d6d-9211-d344e1a84b46.png`
- Implementacao publicada: `C:\Users\leona\AppData\Local\Temp\dute-estoque-marketplace-six-columns.png`
- Comparacao lado a lado: `C:\Users\leona\AppData\Local\Temp\dute-estoque-ux-comparison.png`
- Ambiente: `https://app.dutelog.com.br/portal/estoque`, sessao autenticada, 1920 x 1194, modo Cards.

## Intencao do redesign

A fonte mostra a vitrine anterior. A diferenca visual intencional e a solicitacao do produto: reduzir o espaco de filtro, exibir seis produtos por fileira em desktop amplo e permitir uma selecao de estoque mais rapida, sem esconder categorias ou limitar silenciosamente o catalogo.

## Comparacao

- Tipografia: a familia, pesos moderados, escala do titulo e texto operacional permanecem alinhados ao sistema.
- Espacamento e ritmo: a barra de ferramentas passou de tres faixas de chips para busca, status, categoria, ordenacao e resumo em estrutura compacta; a grade passou de tres para seis colunas no viewport de aceite.
- Cores e tokens: fundo quente, paineis de vidro, bordas claras, azul de acao e sombras suaves foram preservados.
- Imagens e icones: nao ha imagem real por SKU na base atual. O icone de pacote e um fallback neutro do sistema; nenhum produto foi inventado.
- Conteudo: a vitrine continua derivando do estoque real do cliente. A contagem mostra o catalogo filtrado e o carregamento explicita os itens ja revelados.

## Historico de validacao

1. A primeira tentativa de seis colunas usou utilitarios de breakpoint arbitrarios que nao foram emitidos pelo tema atual; a grade permaneceu em quatro colunas.
2. A correção usou os breakpoints nativos `xl` e `2xl` do projeto.
3. Evidencia pos-correcao: em 1920 x 1194, a grade renderizou 48 cards iniciais em seis colunas de aproximadamente 247 px, sem overflow horizontal. O seletor de categoria mostrou 44 opcoes reais.

## Interacoes verificadas

- Categoria `POLO` e ordenacao por menor saldo atualizam a grade imediatamente.
- Adicionar um SKU atualiza o saldo do card e o contador do carrinho para 1 sem abrir o drawer, permitindo continuar comprando.
- Modo Lista abre a tabela e o carrinho volta vazio apos recarregar a tela.
- Em 390 x 844, a grade se reorganiza para uma coluna, com card de aproximadamente 339 px e sem overflow horizontal.

## Observacao de console

O navegador registra avisos de permissoes para listeners de tempo real em colecoes operacionais que este perfil nao pode ler. Eles nao impedem a vitrine, os filtros ou o carrinho, mas devem ser tratados na proxima rodada de blindagem de regras e assinaturas em tempo real.

final result: passed

---

# Integrações na Configuração — 26/10/2026

## Evidências

- Fonte: primeira imagem exibida e aprovada no chat, `/workspace/generated_images/exec-067f5cb5-2313-4a6c-b6e9-7171f53fba4a.png` (1487 × 1058 px).
- Desktop: `/workspace/dute-integracoes-preview/dute-integracoes-desktop.png`, viewport 1440 × 1024 CSS px, deviceScaleFactor 1.
- Celular: `/workspace/dute-integracoes-preview/dute-integracoes-mobile.png` e `/workspace/dute-integracoes-preview/dute-integracoes-chave-mobile.png`, 390 × 844 CSS px, deviceScaleFactor 1.
- Comparação conjunta: `/workspace/dute-integracoes-preview/dute-integracoes-comparison.png`; cada fonte redimensionada proporcionalmente para 1000 px de largura. Estado: Nova integração, nome e cliente fictícios preenchidos, primeira permissão selecionada.
- Implementação: prévia local em `http://127.0.0.1:5173/.preview-tmp/index.html`, com a página, os componentes, o cliente HTTP e o shell reais; somente a sessão e as respostas da API são simuladas. Nenhuma credencial real foi criada.

## Achados e histórico

1. [P2, corrigido] A captura inicial herdava o azul e a tipografia do tema anterior. Aplicada a classe `v3` do sistema ao shell quando a seção ativa é Integrações. A captura posterior mostra as ações e os checkboxes vermelhos, sem alterar as demais seções.
2. A comparação posterior não contém achados P0/P1/P2 pendentes. O formulário em página, a coluna de orientação, a sequência dos campos e a hierarquia correspondem à opção escolhida. O menu preserva o shell Dute existente, conforme o briefing; a marca Acme e as permissões genéricas inventadas pela imagem foram substituídas pelos elementos e pelo contrato reais, como combinado no chat.

## Superfícies conferidas

- Tipografia: tokens e família Manrope da v3, título e pesos próprios do PageHeader existente. Os rótulos permanecem legíveis e os campos usam 16 px no celular. Fontes remotas dependem do carregamento habitual do app.
- Espaçamento: uma coluna de formulário e orientação lateral no desktop, orientação abaixo no celular; conteúdo rola dentro do shell e o botão de gerar permanece alcançável. Sem overflow horizontal nos dois viewports.
- Cores: tokens de superfície, bordas, textos e estados; nenhuma cor fixa introduzida. Botão principal vermelho na identidade v3 clara.
- Imagens: esta tela usa apenas os ícones da biblioteca já instalada. Não há imagens novas a produzir. A marca do mockup não pertence ao Dute e não foi reproduzida.
- Conteúdo: quatro permissões efetivas da Operação, validade de 30 dias com máximo de 90, clientes explícitos e texto de exibição única. Aprovação humana por escrita preservada.
- Região focada: rótulos, permissões, validade e ações também foram inspecionados na captura móvel em tamanho nativo; não dependem da miniatura da comparação geral.

## Interações e limites

- Browser Chromium: selecionar cliente, gerar uma chave fictícia uma única vez, copiar para clipboard, concluir, abrir e cancelar a revogação, confirmar revogação e atualizar o status. Nenhum erro de execução JavaScript.
- Limite da prévia: a rede do ambiente bloqueia o carregamento remoto das fontes (`ERR_TUNNEL_CONNECTION_FAILED`). Foi conferido o fallback legível do próprio sistema; a renderização exata da fonte remota depende do ambiente de uso. Este erro de recurso não ocorreu na API nem nos scripts da tela.
- Vitest: formulário inválido, cancelamento, duplo submit, falha de criação, falha de clipboard, descarte do segredo, ausência de cache de mutations e bloqueio por perfil; axe WCAG 2.1 A/AA e lista dos textos.
- Emulador Firestore: listagem paginada sem credenciais/hashes, autenticação humana, admin ativo, revogadas e expiradas. Não houve validação autenticada em produção.

final result: passed


---

# Integrações nos seis módulos — 27/10/2026

- Tela real e transporte HTTP real com sessão e respostas simuladas no navegador. Nenhuma credencial real emitida.
- 25 permissões em seis grupos, identificação de recursos globais e códigos exatos de clientes. O POST foi verificado com `write_policy: scoped`.
- Chromium em 1440 × 1024 e 390 × 844: criar, copiar, concluir, cancelar revogação e confirmar revogação. Sem exceção JavaScript ou overflow horizontal; rolagem até RH/Agent Dute e botão final alcançáveis.
- Evidências locais: `/workspace/dute-api-todos-modulos-preview/dute-integracoes-desktop.png`, `dute-integracoes-mobile.png`, `dute-integracoes-escopos-mobile.png` e `dute-integracoes-chave-mobile.png`.
- Fontes remotas bloqueadas pela rede (`ERR_TUNNEL_CONNECTION_FAILED`); fallback legível inspecionado. Este limite não valida a fonte remota nem uma sessão autenticada em ambiente publicado.
- Suíte completa do frontend: 248 arquivos, 2.844 testes; typecheck e build Vite/PWA passaram.

Resultado: fluxo e responsividade conferidos com mocks; publicação e validação autenticada em homologação continuam pendentes.

---

# Chaves pessoais de API — 27/10/2026

- Referência: fluxo Resend fornecido no chat, confirmado pelo usuário; lista com criação por nome/permissão em diálogo. Shell e identidade Dute preservados.
- Desktop1440×1024 e mobile390×844, Chromium local com sessão/API simuladas. Fluxo owner full e conta comum read_only, opções custom, revelação/cópia/conclusão e revogação confirmada; nenhuma consulta à lista de clientes, exceção JavaScript ou overflow horizontal.
- [P2 corrigido] Dialog/AlertDialog renderizam em portal fora do shell; receberam `v3` para conservar o vermelho e os tokens do Dute. Conferido visualmente após o ajuste.
- Recursos remotos de fonte bloqueados pela rede; fallback legível. Runtime Browser indisponível nas ferramentas; Playwright local autorizado para esta prévia com mocks. Não foi usada sessão real do usuário.
- Evidências: `/workspace/dute-personal-keys-preview/desktop-lista.png`, `desktop-criar.png`, `desktop-conta-comum.png`, `mobile-criar.png`, `mobile-lista.png`, `mobile-revelacao.png`.
- Suíte frontend completa:2.856 testes; sete testes de página/diálogo/a11y repetidos após ajuste visual, typecheck/build passaram. Nova gestão e autorização validadas separadamente nos emuladores; não se afirma validação autenticada no ambiente publicado.

- Revisão independente: corrigida descrição de full/read_only na lista, que agora acompanha o acesso atual da conta em vez de tratar scopes vazio como ausência de operações. Teste de regressão capturou o caso antes da correção.
