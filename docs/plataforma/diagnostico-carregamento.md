# Diagnóstico: indicadores de carregamento (spinner, skeleton e botão em ação)

Levantamento de 06/11/2026 sobre o app (`artifacts/app`), no código da `main`
em `901ec75`. Responde a uma pergunta só: **onde o app precisa dizer que está
carregando ou que uma ação está em andamento, e o que ele faz hoje em cada
lugar.** Não muda código; a ordem dos PRs fica na seção 6 e as decisões que
esperam o Leonardo, na seção 7.

## 1. Resumo

O app tem três jeitos de carregar dados (react-query no WMS e no portal,
`onSnapshot` nos módulos novos, `fetch` no agente) e quatro jeitos de mostrar
isso (skeleton, texto "Carregando", ícone girando em dois desenhos, e nada).
Não existe regra escrita: nem `docs/mockups/README.md` nem
`docs/sistema-visual.md` falam de carregamento, e nenhum mockup da v3 desenha
esse estado. Cada módulo decidiu sozinho, e o resultado é desigual.

O que a pessoa sente, do mais frequente ao mais raro:

1. **Abertura do app em branco.** Até o perfil chegar do Firestore,
   `HomeRedirect`, `ProtectedRoute` e `RoleGate` devolvem `null`, e o
   `index.html` não tem nada atrás do `#root`. Sem rede, o app espera até
   30 s nessa tela branca. Acontece em toda abertura, para todo papel.
2. **Ação em andamento sem sinal nos módulos novos.** Comercial (fora dos
   diálogos), Operação, Financeiro, RH e Campo só apagam o botão
   (`disabled`, opacidade 50%): sem ícone, sem "Salvando…". No WMS e no
   portal o botão gira um ícone e muda o rótulo.
3. **"Carregando" sem spinner e sem padrão.** Quatro grafias em 61 lugares
   (`Carregando...`, `Carregando…`, `Carregando` seco e `Carregando <coisa>...`).
   Nos módulos novos o texto vai dentro do componente de vazio, que existe
   em cinco cópias.
4. **Spinner improvisado.** `components/ui/spinner.tsx` existe e ninguém
   importa. As telas giram o `RefreshCw` (36 vezes) ou o `Loader2` (25), sem
   `role="status"`, quase sempre sem `aria-hidden`, e nada respeita
   `prefers-reduced-motion`, que a regra 1.2 do plano de implantação pede.
5. **Operação longa sem progresso.** Fotos da OS, foto de catálogo (até
   180 s), exportação do RH, relatórios e a carga em massa mostram no máximo
   "Enviando". Não há barra, contagem nem aviso de demora, e a callable só
   desiste em 70 s.
6. **Falso vazio** na Tabela de preços (`pages/price-list.tsx`): "Nenhum
   serviço na tabela" enquanto a lista ainda não chegou. Foi a única tela
   que caiu na varredura; as outras tratam o carregando antes do vazio.

## 2. Como o app carrega hoje

### 2.1 Entrada e troca de tela

- `AuthProvider` (`lib/auth.tsx`): `isLoaded` só vira `true` depois do
  `onAuthStateChanged` **e** do `getDoc` do perfil em `users/{uid}`. Sem
  rede e sem perfil guardado no aparelho, `esperarRede()` segura até 30 s.
  Nesse tempo `HomeRedirect`, `ProtectedRoute` e `RoleGate` (`App.tsx`)
  devolvem `null`: tela branca, sem logo, sem spinner. Para o cliente,
  `RoleGate` repete a espera até `useOperationProfile` responder.
- O `index.html` não tem splash: o `#root` fica vazio até o bundle rodar.
- Toda tela é `lazy()`. O `Suspense` dentro do layout mostra o texto
  "Carregando..." numa caixa de 40% da altura; o da raiz, o mesmo texto em
  tela cheia. Nenhum dos dois tem ícone. O `ChunkErrorBoundary` cobre o
  chunk que sumiu depois de um deploy (isso está bem).
- Entre uma tela e outra não há barra de navegação: a tela nova aparece
  quando o chunk e a primeira leitura chegam.

### 2.2 Dados

| Camada | Como lê | Como diz que está carregando |
| --- | --- | --- |
| WMS (`pages/*.tsx`, `features/warehouse-ops`) | react-query: 91 `useQuery` e os hooks gerados `useList*`/`useGet*` de `lib/api-client-react`; `retry: false`; `realtime-sync.tsx` invalida ao vivo | `isLoading` na primeira leitura e `isFetching` na atualização. `Skeleton` no Início, em Receber › Operações e nas telas de Posições, Mapa e Etiquetas; texto "Carregando pedidos..." em Pedidos, Estoque e Receber; `RefreshCw` girando no botão Atualizar enquanto `isFetching` |
| Comercial, Operação, Financeiro, RH, Campo | `useLeitura`/`useDocumento` (`onSnapshot`) em `lib/<modulo>/leitura.ts`: `itens === null` ou `item === undefined` é carregando; a tela deriva `estado: "carregando" \| "erro" \| "pronto"` | Comercial, Financeiro e RH: `<Vazio>Carregando...</Vazio>`; Operação e Campo: `<p>Carregando</p>` seco; os Inícios: `Skeleton` |
| Portal do cliente | `ClientDataBoundary` (`pages/client/shared.tsx`) em volta de cada módulo | `ClientModuleLoading`, um skeleton da tela inteira; erro com "Tentar de novo" girando |
| Agent Dute | `fetch` e `useMutation`; o chat é um stream de até 180 s | `Loader2` no botão de enviar e "Carregando a conversa…" |

- O Firestore roda com `getFirestore` padrão (cache só em memória): nenhuma
  tela abre de cache, toda leitura inicial espera o servidor. O estado
  "carregando" aparece sempre, em toda troca de tela, e por isso precisa
  ser bonito e igual.
- Sem rede, `onSnapshot` não devolve erro: as telas dos módulos novos ficam
  em "Carregando" até a rede voltar, sem dizer que é falta de sinal. Só o
  Campo diz "Sem sinal" (2.4).
- Quando a chave de `useLeitura` muda (outro documento, outro filtro), o
  hook devolve `itens: null` de novo: a lista some e volta "Carregando", em
  vez de ficar apagada até a nova chegar.

### 2.3 Ações

- WMS, portal e agente: 57 `useMutation`, e o botão usa `isPending` (213
  usos): fica `disabled`, muda o rótulo para o gerúndio em 48 botões
  ("Salvando...") e gira um ícone em 65 (`RefreshCw` com
  `data-icon="inline-start"` no WMS, `Loader2` no portal e no agente).
- Módulos novos: 34 flags à mão (`ocupado` em 21 arquivos, mais `pending`,
  `busy`, `enviando`, `submitting`). Nas telas, `ocupado` só desabilita
  (`pages/operacao/cadastro-view.tsx`, `components/operacao/escala.tsx`,
  `components/comercial/acoes-depois-do-envio.tsx`, `pages/operacao/os.tsx`);
  nos diálogos do Comercial o rótulo muda ("Salvando...", "Criando...").
  Nenhuma tela desses módulos põe ícone no botão.
- Retorno depois da ação: o WMS e o portal avisam por toast (`use-toast`,
  53 arquivos, um toast por vez); o Financeiro tem dois toasts; Operação,
  RH e Campo não têm nenhum. Lá o retorno é a lista ao vivo mudar e, no
  erro, uma linha `role="alert"` (60 nos módulos novos). `role="status"`
  aparece 9 vezes, `aria-live` nenhuma, `aria-busy` uma.
- Diálogos: dos 68 `Dialog`/`Sheet`/`AlertDialog` com `open`, 22 travam o
  fechar enquanto a ação roda (`!open && !ocupado`); os outros fecham com
  Esc ou clique fora com a chamada em andamento, e o retorno dela se perde.
- As callables esperam 70 s (180 s para a foto de catálogo e o chat do
  agente) sem nenhum aviso de demora na tela.

### 2.4 O que já está bem resolvido (copiar, não reinventar)

- Início de cada módulo (`components/inicio/inicio-do-modulo.tsx`): skeleton
  de três linhas no "Precisa de você" e um bloco na lateral; a entrada por
  cards não inventa zero enquanto carrega (`pages/entrada.tsx`).
- Receber › Operações (`WarehouseOpsLoading`, `pages/warehouse-ops.tsx`):
  skeleton que desenha a tela inteira.
- Portal: `ClientDataBoundary` com `ClientModuleLoading` e
  `ClientModuleError`.
- Campo: aviso no topo "Enviando · 2 registros guardados" ou "Sem sinal"
  (`components/layout/campo-layout.tsx`, `avisoDaFila` em
  `lib/campo/fila.ts`), fila no IndexedDB e `useToqueUnico` contra o toque
  duplo.
- WMS: `RefreshCw` girando no botão Atualizar enquanto `isFetching`
  (Pedidos, Receber, Operações, painel de infra).
- `ChunkErrorBoundary` e o botão Recarregar.

## 3. Inventário de peças

| Peça | Onde | Situação |
| --- | --- | --- |
| `Spinner` | `components/ui/spinner.tsx` | 0 importações. Tem `role="status"`, mas o `aria-label` é "Loading", em inglês |
| `Skeleton` | `components/ui/skeleton.tsx` | 17 arquivos |
| `SidebarMenuSkeleton` | `components/ui/sidebar.tsx` | 0 usos |
| `Progress` | `components/ui/progress.tsx` | 4 usos (volume da prateleira, abertura do estoque); nenhum em upload ou exportação |
| Ícone girando | 65 lugares | `RefreshCw` 36, `Loader2` 25; 5 com `aria-hidden` |
| Texto "Carregando" | 61 lugares | `Carregando...` 30, `Carregando` seco 14, `Carregando <coisa>...` 12, `Carregando…` 5 |
| `Vazio` | 5 cópias (`comercial/*-view.tsx` ×4, `rh/pecas.tsx`) | o "carregando" dos módulos novos passa por ele |
| Toast | `hooks/use-toast.ts` | um por vez; `sonner` instalado e usado em 1 arquivo |
| Reduced motion | `index.css` | nenhuma regra; `motion-safe`/`motion-reduce` em 3 classes |
| Testes | 30 arquivos `.test.tsx` | travam o texto "Carregando" na lista de textos da tela |

## 4. Mapa por área: onde falta sinal

**Entrada e login.** Abertura em branco até o perfil (2.1). O botão Entrar
vira "Entrando..." sem ícone. O convite (`pages/convite.tsx`) muda o rótulo
com `ocupado`, também sem ícone.

**WMS na v3** (Início, Pedidos, Estoque, Receber, Estoque › Alertas). O
Início tem skeleton. Pedidos, Receber e Estoque mostram "Carregando
pedidos...", "Carregando chegadas..." e "Carregando estoque..." só em texto;
Alertas, "Carregando alertas...". O Atualizar gira. As ações usam
`isPending` com rótulo e ícone, mas o ícone é o `RefreshCw`.

**WMS fora da v3** (as outras telas da raiz de `pages/` e
`features/warehouse-ops`). Receber › Operações tem skeleton inteiro; as
bancadas (`inventory.tsx`, `receiving.tsx`, `task-detail.tsx`) giram o ícone
nos botões. Tabela de preços afirma vazio antes de ler. Faturamento
(`billing.tsx`, `billing-invoice.tsx`) espera o cliente ativo e carrega só
em texto. Cadastros (`users`, `settings-*`, `products`, `skus`) mudam o
rótulo, quase sempre sem ícone. O estúdio de foto do produto
(`product-photo-studio.tsx`) fica `busy` por até 180 s sem progresso nem
aviso.

**Comercial** (10 telas). Carregando: `<Vazio>Carregando...</Vazio>` em
todas as listas; o orçamento e o documento, em texto (`EstadoDoOrcamento`).
Ação: nos diálogos o rótulo muda; nas telas (Aprovar, Autorizações,
Medições, Orçamentos, `acoes-depois-do-envio`), o botão só apaga, inclusive
no envio do orçamento (`enviando`). Em Medições o botão fica desabilitado
enquanto o catálogo carrega (`catalogo === "carregando"`) sem dizer por quê.

**Operação** (15 telas). Carregando: `<p>Carregando</p>` seco em Hoje,
Demandas, Agenda, Colaboradores, Veículos, OS, Planejar, Revisão, Demanda e
na impressão da OS. Ação: `ocupado` só apaga (Colaboradores, Veículos,
Demanda nova, OS, Planejar, Revisão e a escala do Hoje); nenhuma tela
mostra "Salvando". Sem toast de sucesso: o retorno é a lista mudar. Fotos da OS:
"Enviando" no rótulo, sem contagem nem progresso, mesmo com várias fotos.

**Financeiro** (8 telas). Como o Comercial: `<Vazio>Carregando...</Vazio>`
nas listas; NF e Relatórios juntam várias leituras (`isPending` das fontes)
e acabam em "Carregando..." só em texto; A faturar e Faturas têm os dois
únicos toasts dos módulos novos; `ocupado` só apaga.

**RH** (5 telas). `<Vazio>Carregando...</Vazio>`; na exportação, gerar a
competência e baixar o arquivo usam o mesmo `ocupado`, que só apaga o botão.

**Campo** (4 telas). Texto seco em Hoje, OS e Concluir; a fila do aparelho
avisa no topo (bom); os botões de etapa têm toque único. O que falta é só
o padrão do "Carregando" e o sinal no botão.

**Portal do cliente** (15 telas). O skeleton do `ClientDataBoundary` cobre
Início, Estoque, Faturas, Documentos e Serviços; Eventos usa o mesmo com
título. Os botões giram o `Loader2` (cancelar pedido, baixar relatório,
envios). É a área mais completa.

**Agent Dute.** `Loader2` no envio e na conversa. Está bem, falta só trocar
pelo `Spinner`.

## 5. Necessidades, em ordem de dor

| # | Onde | O que falta | Quem sente |
| --- | --- | --- | --- |
| 1 | Abertura do app (`index.html`, `HomeRedirect`, `ProtectedRoute`, `RoleGate`) | A marca e um spinner no lugar do branco; "Sem sinal" quando a rede não vem | Todos, toda vez |
| 2 | Botões da Operação, Campo, Financeiro, RH e telas do Comercial | Spinner no botão e rótulo no gerúndio enquanto `ocupado`; `aria-busy` | Operação é a tela de todo dia |
| 3 | "Carregando" de todas as listas e fichas | Um componente só (spinner + rótulo), uma grafia, no lugar do texto seco, do `Vazio` e dos dois fallbacks do `Suspense` | Todos, em toda troca de tela |
| 4 | Fotos da OS, foto de catálogo, exportação do RH, relatórios, carga em massa | Contagem ("2 de 5"), progresso quando o canal der, aviso de demora depois de 10 s e o que fazer no timeout de 70 s | Campo e coordenação |
| 5 | Módulos novos sem rede | Trocar "Carregando" por "Sem sinal", como o Campo faz | Quem abre no celular |
| 6 | Tabela de preços | Esperar a leitura antes de afirmar vazio | Financeiro |
| 7 | 46 diálogos que não travam o fechar | Segurar o diálogo aberto enquanto `ocupado`/`isPending` | Quem usa teclado ou clica fora |
| 8 | Todos os spinners | `role="status"` ou `aria-hidden`, `aria-label` em pt-BR, `prefers-reduced-motion` | Leitor de tela e regra 1.2 |
| 9 | Consistência | Um ícone, uma grafia, um `Vazio`, o `Spinner` em uso | Quem mantém o código |

## 6. Proposta de implantação (um problema por PR)

1. **Regra escrita.** Acrescentar em `docs/mockups/README.md` ("Regras da
   v3") e na seção 1.2 do `plano-de-implantacao.md` o estado de
   carregamento: (a) tela ou lista: skeleton onde a tela tem desenho fixo
   (Início, Operações), senão spinner com o rótulo "Carregando…";
   (b) ação: botão com spinner no lugar do ícone, rótulo no gerúndio,
   `aria-busy`, largura mantida; (c) operação longa: contagem ou
   progresso e aviso de demora depois de 10 s; (d) sem rede: "Sem sinal";
   (e) nunca afirmar vazio antes da primeira leitura; (f) reticência "…"
   única; (g) `prefers-reduced-motion`.
2. **Peças.** `Spinner` com `aria-label="Carregando"` e `motion-reduce`;
   `Carregando` (bloco: spinner + rótulo, o mesmo nas listas, nas fichas e
   nos dois `Suspense`); `Button` com a prop `carregando` (spinner,
   `disabled`, `aria-busy`, mantém a largura); `Vazio` único em
   `components/ui`. A trava de textos (`src/test/textos.ts`) continua
   valendo: o rótulo "Carregando…" entra na lista da tela, o `aria-label`
   não é texto.
3. **Abertura.** Marca e spinner em CSS puro no `index.html`, que o React
   substitui; `<Carregando />` no lugar do `null` em `HomeRedirect`,
   `ProtectedRoute` e `RoleGate`; "Sem sinal" depois de 3 s sem rede.
4. **Operação e Campo.** `<p>Carregando</p>` vira `<Carregando />`;
   botões com `carregando={ocupado}`; 15 + 4 telas; os testes atualizam a
   lista de textos.
5. **Comercial, Financeiro e RH.** `<Vazio>Carregando...</Vazio>` vira
   `<Carregando />`; botões idem; `Vazio` único.
6. **WMS.** Tabela de preços sem falso vazio; Pedidos, Estoque, Receber e
   Alertas com `<Carregando />`; os 65 `RefreshCw`/`Loader2` girando viram
   `Spinner` (troca mecânica, sem mudar comportamento).
7. **Operações longas.** Fotos da OS e do catálogo com contagem e
   progresso; exportação do RH, relatórios e carga em massa com spinner no
   botão e aviso de demora; mensagem própria para o timeout.
8. **Diálogos.** `onOpenChange` travado enquanto a ação roda nos 46 que
   faltam.
9. **Sem rede nos módulos novos.** O detector do Campo
   (`navigator.onLine` em `fila-do-campo.tsx`) sobe para o shell e o
   `<Carregando />` vira "Sem sinal" quando não há rede.

Os PRs 1 e 2 vêm antes dos outros; 3 a 9 não dependem entre si.

## 7. Perguntas para o Leonardo

1. Nas listas, skeleton ou spinner? A proposta é skeleton só onde a tela
   tem desenho fixo (Início e Operações) e spinner com rótulo no resto.
2. Toast de sucesso nos módulos novos (a Operação não tem nenhum) ou a
   lista ao vivo mudar basta?
3. Splash com a marca na abertura, ou só o spinner?
4. Tempo mínimo do spinner para não piscar (300 ms) e aviso de demora
   (10 s): valem esses números?
5. Um ícone só: o `Loader2` do `Spinner` ou o `RefreshCw` que o WMS usa?

## 8. Números do levantamento

| Medida | Valor |
| --- | --- |
| Arquivos `.tsx` de tela e componente (sem teste) | 294, 78 mil linhas |
| Telas por módulo | WMS 38, Operação 15, portal 15, Comercial 10, Financeiro 8, RH 5, Campo 4, TV 1 |
| `useQuery` / `useMutation` / `onSnapshot` | 91 / 57 / 8 |
| `isPending` / `isLoading` / `isFetching` | 213 / 84 / 40 |
| Flags à mão (`ocupado`, `pending`, `busy`, `enviando`…) | 34 |
| Botões | 606; 431 `disabled` com pendência; 48 mudam o rótulo; 65 giram ícone |
| Ícone girando | `RefreshCw` 36, `Loader2` 25; `Spinner` 0 |
| Texto "Carregando" | 61, em 4 grafias |
| `Skeleton` | 17 arquivos |
| Diálogos com `open` | 68; 22 travam o fechar em ação |
| `role="alert"` / `role="status"` / `aria-live` / `aria-busy` | 60 / 9 / 0 / 1 (módulos novos) |
| Timeout das callables | 70 s; 180 s na foto de catálogo e no chat |
| Testes que travam "Carregando" | 30 arquivos |
