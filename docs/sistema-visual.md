# Sistema visual

Decidido na auditoria de UI de 09/10/2026 (PR 1 da fundação). A regra é
curta: superfície sólida com borda fina, um acento, escala de raio pequena,
texto legível de longe. Sem vidro, brilho ou sombra espalhada.

## Onde mora

- **Tokens:** `artifacts/app/src/index.css` (`:root` claro, `.dark`
  escuro, `@theme inline` para o Tailwind).
- **Componentes base:** `artifacts/app/src/components/ui/` —
  `button`, `input`, `textarea`, `select`, `badge`, `card`, `dialog`, `tabs`,
  `chip`, `page-header`.
- **Trava:** `src/lib/theme-colors.test.ts` falha com cor fixa que quebra o
  escuro e com valor fora da escala (`rounded-[…]`, `backdrop-blur`,
  `bg-card/NN`, `shadow-[…]`, `text-[…px]`).

## Escala

| O quê | Valor | Classe |
| --- | --- | --- |
| Raio miúdo (kbd, item de menu) | 4px | `rounded-sm` |
| Botão, campo, chip, badge | 6px | `rounded-md` |
| Card, linha de lista, painel | 10px | `rounded-lg` |
| Diálogo, sheet | 14px | `rounded-xl` |
| Avatar, ponto de status | cheio | `rounded-full` |
| Texto corpo, tabela, botão | 14px | `text-sm` |
| Secundário, meta de linha | 13px | `text-[13px]` não; use `text-sm` com `text-muted-foreground` |
| Mínimo (legenda, cabeçalho de tabela) | 12px | `text-xs` |
| Título de página | 24px | `text-2xl` via `PageHeader` |

Sombra só em overlay (`shadow-lg` em diálogo e menu) e no painel flutuante
(`shadow-md`). Card não tem sombra: tem borda.

## Cor

- `primary` é o único acento: botão primário sólido, link, item ativo.
- `destructive` só para bloqueio e crítico. Saída de estoque não é erro.
- `warning-soft` atenção, `success-soft` concluído, `info-soft` em andamento,
  `muted` para tipo e categoria.
- `primary-texto` é o primário como texto no cartão (o "Ver itens" e o "Ver
  volumes" da fila): o próprio `primary` no claro; no escuro, mais claro
  (6,3:1 no cartão), porque o azul do botão, como texto, dá 4,4:1. O branco
  sobre o botão primário do escuro (4,3:1) está aberto
  (`docs/plataforma/diagnostico-carregamento.md`, 10.5, parte 13h).
- `agent-*` é a identidade do Agent Dute (violeta).
- `gender-fem-*` e `gender-masc-*` só no chip de gênero do Estoque do portal
  (FEM rosa, MASC azul-petróleo; `docs/mockups/PortalEstoqueGenero.dc.html`).
  Não são cor de status.

## Botões

`Button` tem um primário por tela (`default`), `secondary`/`outline` com
borda, `ghost` e `destructive` com borda. Tamanhos `sm` 36, padrão 40, `lg`
44. Não crie `<button>` com classes próprias para o que o `Button` já faz.

**O anel do foco** (WCAG 1.4.11 e 2.4.7; carregamento v2, parte 13h):
`focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco`,
com `ring-offset-2 ring-offset-background` no `Button` e no título dos grupos
da fila. O `--foco` é o `--ring` cheio: 4,2:1 no fundo e 4,6:1 no cartão da
v3; 4,6:1 e 4,4:1 no escuro (a 40%, o anel antigo dava 1,91:1 e 1,65:1). O
`outline-hidden` deixa, nas cores forçadas, o contorno de 2 px que o sistema
pinta: lá a sombra do anel some, e o `outline-none` do Tailwind v4 tirava os
dois. Nunca o `--ring` translúcido nem o `outline-none` junto do anel. Ficam
com outra cor só o anel na barra preta (o branco dela a 80%), o do toast
crítico e o halo claro do campo cujo foco é a borda cheia
(`focus-visible:border-primary`). Trava em `lib/carregando/trava.test.ts`; o
contraste do token, em `lib/carregando/tokens.test.ts`.

**O foco sem anel** também se vê (revisão da parte 13h). O contorno do
navegador só sai de cena com outro sinal no mesmo lugar: o anel, a borda
cheia (`focus-visible:outline-hidden focus-visible:border-primary`; a 40%,
50% ou 60%, ela fica abaixo de 3:1) ou, nos itens dos menus do Radix e do
cmdk, o fundo realçado com `focus:outline-hidden`. Nunca o `outline-none`,
que o tira também das cores forçadas, e nunca o `outline-hidden` sem a
variante do foco, que lá desenha o contorno em todo item. O campo sem
moldura dentro de uma caixa mostra o foco na caixa (`focus-within`), e os
títulos que recebem o foco do código, o anel do título da fila. Na barra de
baixo do celular, o anel vai por dentro (`ring-inset`). No `index.css`,
nenhum `:focus-visible` apaga o contorno: a capa de entrada usa o
transparente (`outline: 2px solid transparent`). A trava lista os que mostram
o foco em outro lugar, com o porquê.

## Celular (abaixo de 768px)

- Navegação pela barra inferior (`MobileTabBar`): até quatro destinos fixos
  (Início, Pedidos, Estoque, Agent Dute, nesta ordem; o papel sem algum deles
  completa com os próximos do menu) e "Mais" com o resto e a Configuração.
  A ordem vem de `getMobileNavigation` em `lib/modules.ts`, com teste.
- Telas do portal no `ClientModuleShell` (Estoque, Eventos): no celular o
  título rola junto com o conteúdo, e o que for `sticky` para no topo da área
  que rola, colado no cabeçalho; no desktop o título fica e só o conteúdo
  rola. As outras telas do portal já rolam a página inteira.
- Não há botão flutuante: o Agent Dute é item da barra; no desktop, do menu.
- Filtros de lista em painel (`FilterPanel` + `FilterGroup`): chips em linha
  no desktop; no celular, botão "Filtros · <o que está ativo>" que abre um
  sheet com os grupos. `StockToolbar` já faz isso para quem passa chips.
- Barra presa no topo da lista cabe numa linha no celular: a busca e o
  `FilterSheet`, botão só com o ícone e a contagem do que está ativo, que abre
  o mesmo sheet com todos os grupos (inclusive formato e ordem). O que está
  ativo aparece em etiquetas acima da lista, que rolam com ela. Exemplo:
  Estoque do portal (`docs/mockups/PortalEstoqueCelular.dc.html`).
- Campo e seletor com texto de 16px no celular (o padrão do `Input`, que só
  cai para 14px a partir de `md`): abaixo disso o Safari aproxima a tela
  quando a pessoa toca no campo. Não passe `text-sm` sem o `md:`.
- Tabela com mais de quatro colunas vira lista de cartões no celular
  (Documentos, Histórico); a tabela fica `hidden md:block` e a lista
  `md:hidden`, com as mesmas ações.
- Gráfico de barras: rótulo curto ("10,8") com a unidade no apoio do cartão;
  acima de 8 meses, sem valor em cima da barra e mês alternado a partir do
  último.

## Listas de fila (Pedidos e Receber)

`QueueGroup` + `QueueRow` (`components/ui/queue-list.tsx`): grupos com
título, apoio e contagem; linhas com ícone em tom suave, título, apoio, nota
e ações. A idade ("há 25 min") vai no tom do apoio (`text-foreground/60`,
4,7:1 no branco da v3), e o "Ver itens" é `text-primary-texto`. A ficha do item abre ao lado no desktop (`useIsDesktop`) e num sheet
no celular. Seções que vivem dentro de um painel estreito usam `@container`
e variantes `@md:`/`@xl:` em vez de `md:`/`xl:`, para seguir a largura do
painel e não a da janela.

## Escuro

- Mesma escala e os mesmos componentes; só os tokens mudam (`.dark` em
  `index.css`). Borda a 21% de luz para botão secundário, campo e card se
  destacarem do fundo; acento azul escuro com texto azul-claro para badge
  padrão, item ativo do menu e destaque de lista.
- Logo: no escuro entra `dutelog-logo-light.png` (a versão vermelha tem o
  "Soluções Logísticas" em preto). As duas imagens ficam na página; o
  `dark:` troca qual aparece.
- Cor fixa (`bg-white`, `text-slate-900`) continua proibida pelo teste de
  tema: é o que quebra o escuro.

## Carregamento

Aprovado pelo Leonardo em 12/11/2026 ("como recomendado"): a espera tem forma
e lugar, e qualquer quadro parado se lê como "carregando". Desenho completo,
os nove momentos e as decisões em
`docs/plataforma/diagnostico-carregamento.md`, seção 10; pranchas em
`docs/mockups/WmsCarregandoV2*.dc.html`.

**O relógio** (`lib/carregando/tempo.ts`, `CARREGANDO`), igual para lista,
botão, linha, abertura e Agent Dute:

| Tempo | O que acontece |
| --- | --- |
| 0 a 100 ms | O toque responde (o botão afunda) e trava o segundo toque |
| 300 ms | Entra o indicador, com o rótulo no gerúndio e o anúncio. Antes disso, nada |
| 500 ms | Mínimo na tela do indicador sozinho e do "em andamento". O dado nunca espera |
| 3 s | O objeto entra na linha ("Aprovando pedido 1042…") |
| 5 s | O movimento decorativo para (brilho, listras, barras). O indicador da região continua |
| 10 s | "Demorando mais que o normal" e a volta calma (2 s por volta) |
| 70 s | A saída: "Tentar de novo" na leitura, "Conferir" na escrita (no chat do Agent Dute, 180 s sem notícia do servidor) |

`useEspera(ativa)` devolve a fase pronta (visível, calmo, movimento) e
`useAnuncio()` fala na região de status do `Anunciador`, uma por tela, no
máximo um anúncio a cada 2 s. O anúncio devolve o "retirar": a espera que
acaba antes da vez dele o tira da fila, e ninguém ouve "Carregando estoque"
com a lista na tela nem "Aprovando pedido 1042" depois do "Aprovado". O mesmo
texto dentro dos 2 s não repete, nem tira da fila o outro que espera a vez.
**Uma espera, um relógio:** a lista que ainda lê quando a tela chega continua
a espera da `CarregandoTela` (`lib/carregando/espera-da-rota.ts`): a linha de
estado e as linhas-fantasma aparecem já na pintura em que a tela entra, a
demora vem aos 10 s do toque, e a entrada ("Abrindo Pedidos") não é anunciada
de novo como "Carregando pedidos". **O cliente ativo é a fronteira também
enquanto lê:** a tela interna não lê nem grava com o cliente padrão antes de
a lista dos clientes chegar, e o "Tentar de novo" da demora lê de novo essa
lista (o `tentar` do `useActiveCustomer`), nunca o dado da tela. Com a lista
que falhou (o `falhou`, também durante a nova tentativa), a tela diz "Não
consegui carregar o cliente ativo." no lugar do dado, com "Tentar de novo",
que lê de novo a lista (`FalhaDoClienteAtivo`), e a ação que grava para o
cliente fica `aria-disabled`.

**As peças:**

| Peça | Onde | Regra |
| --- | --- | --- |
| `Spinner` (`components/ui/spinner.tsx`) | Todo indicador | A caixa chanfrada (o canto de 45° do "D" da marca), em tinta (`currentColor`). Tamanhos 16 (texto e botão), 20 (botão do celular e Agent Dute), 24 (linha de estado) e 40 (módulo sem esqueleto). `calmo` depois de 10 s, `progresso` de 0 a 1 para o determinado. Sem `aria-label` fica fora da árvore; com ele, vira `role="status"` |
| `Esqueleto` e `CartaoComBrilho` (`components/ui/esqueleto.tsx`) | Primeira leitura de tela com desenho conhecido | Blocos neutros (`--carregando-esqueleto`, nunca a cor da marca), sempre `aria-hidden`. O brilho faz dois ciclos e para. O `Skeleton` antigo já usa o mesmo bloco |
| `BotaoDeAcao` (`components/ui/botao-de-acao.tsx`) | Ação com espera | Mantém a largura. Repouso, em andamento, sucesso (a caixa fecha em check), erro (crítico suave) e "Conferir". Durante a ação, `aria-busy` e `aria-disabled`, nunca `disabled` nem só 50% de opacidade |
| Toast | Retorno da ação | Continua o retorno padrão. No celular, embaixo, perto do polegar, com o fechar no toque; com um diálogo aberto, no topo, para não cobrir o rodapé preso dele |
| `LinhaDeEstado` (`components/ui/linha-de-estado.tsx`) | Sob o título de Pedidos, Receber, Estoque, Estoque › Alertas, Produtos, SKUs, Movimentações, Pedidos legado, Relatórios, Documentos, Estoque › Mapa e Estoque › Posições (`PageHeader`, `estado`), numa fila só dela, a 6 px do título no computador e a 2 px no celular, sempre abaixo das ações; no Fechamento, logo abaixo dos meses; na Tabela de preços, sob "Serviços e valores" e sob "Cobrança" (que lê à parte), na largura do cartão, abaixo da fileira do título e do "Novo item"; na aba Histórico do Estoque, logo acima da lista, sem a hora (`semHora`) | 24 px sempre reservados: "Carregando pedidos…" com a caixa de 24 px depois de 300 ms (nas telas que ainda dizem "Carregando..." na tabela, a linha fica vazia até a lista chegar: `primeiraNaLista`); aos 10 s, a mesma caixa na volta calma e a pílula âmbar da demora; "Atualizado às 10:42"; "Atualizando…" quando a barra do topo passa de 5 s (a volta do app e a troca de filtro, mês ou cliente) e, aos 10 s, a demora com "Tentar de novo", dita uma vez; "Reconectando… · lista de 10:42" e "Sem conexão · lista de 10:42" (também com o aparelho sem rede há 3 s, antes de qualquer leitura falhar), e "Não consegui atualizar · lista de 10:42" quando a releitura falha por outro motivo, com a lista lida, todos com "Tentar de novo" (toque de 44 px). O texto troca em sequência: o que sai some em 80 ms (180 ms quando é uma espera) e só então o novo entra, em 150 ms. Nada é região viva, e a releitura automática não fala. Com o foco no "Tentar de novo", a troca leva o foco ao novo ou à própria linha, nunca ao `body`. No celular estreito, o que não cabe passa à linha de baixo, sem rolagem lateral. As ações do cabeçalho ficam por cima do toque estendido e nunca o perdem para ele |
| `BotaoAtualizar` | O Atualizar das listas | 40 px no computador, 44 px no celular. Só mostra a espera quando a pessoa toca nele: o ícone sai em 80 ms e a caixa entra em 150 ms; no fim, a caixa sai em 180 ms e o ícone volta. A releitura automática não o gira nem o desabilita. Travado na primeira leitura, a 0,45, volta a 1 em 150 ms. No fim do toque, "Lista atualizada" no Anunciador, só com a tela ainda aberta. Antes de reler, acorda a conexão de quem lê (`useAtualizarLista`). O Atualizar com rótulo do Conhecimento e da Central da IA (`BotaoDeAcao`, "Atualizando…") segue o mesmo `useAtualizarLista` |
| `CarregandoNaRegiao` (`components/ui/carregando-na-regiao.tsx`) | A parte da tela que ainda lê, sem a forma da lista: a espera em bloco (o painel, os incidentes, Pessoas, as chaves, a ocupação, a fatura, o catálogo que se verifica, a sugestão do destino) | Nada antes de 300 ms; depois, a caixa de 24 px e o gerúndio com o objeto ("Carregando a fatura…"), com o anúncio; aos 10 s, a volta calma e "Demorando mais que o normal". Com `onTentar` (quem lê sabe ler de novo), "Tentar de novo" de 44 px ao lado da demora e, aos 70 s, "Sem resposta do servidor." com "Tentar de novo"; a nova tentativa recomeça o relógio e o foco fica na região. Quem usa relê do zero (`relerDoZero`): o `refetch` da leitura sem dado só se juntaria à que está presa. A primeira leitura da tela continua a espera da rota (`continuaARota`), sem o vão de 300 ms nem o anúncio repetido. O dado que chega com o foco nela leva o foco a `focoAoSair` ou, sem ele, ao título da seção, nunca ao `body`. A altura da linha fica guardada desde 0 ms. A falha é a `FalhaNaLeitura`, no lugar da lista, ou a `FalhaNaSecao` |
| Ação na linha (`useAcaoNaLinha`) | Cada linha que grava: Pedidos, as Devoluções, o "⋯" dos Documentos | A linha tocada espera e as outras seguem livres; o segundo toque não grava de novo. O apoio da linha diz a espera no lugar dele, sem crescer: o gerúndio aos 300 ms, com o objeto aos 3 s, "Demorando mais que o normal · 0:12" aos 10 s, no relógio da ação (a linha que sai da lista e volta não recomeça). O sucesso fica pelo menos 1 s e até a lista relida (no botão, "Aprovado"; no apoio dos Documentos, "Arquivado"), e o motivo da falha fica até a próxima ação. Aos 70 s, "Sem confirmação do servidor" e "Conferir", que relê e diz "Conferindo…", nunca a ação de novo. A chave da tentativa se repete depois do resultado incerto. O menu da linha não abre enquanto ela grava e nunca reabre sozinho. No celular, a ação da linha tem 48 px |
| `BarraDeEspera` (`components/ui/barra-de-espera.tsx`) | A linha em andamento e o topo do cartão que relê na volta do app | Na volta do app (`resultado="fim"`), a barra do topo completa em tinta por `scaleX` em 200 ms e esmaece em 150 ms; a que nunca apareceu sai sem nada |
| `CarregandoTela` (`components/ui/carregando-tela.tsx`) | A tela que ainda abre: o arquivo dela, o perfil, o cliente | Aos 300 ms, a caixa de 40 px e "Abrindo Faturamento…" (o nome da aba; o que não é substantivo vem com "a tela": "Abrindo a tela Separar…"). Aos 10 s, "Demorando mais que o normal" e "Tentar de novo"; aos 70 s, "Sem resposta do servidor."; tentar de novo recarrega. Nunca o branco nem o `fallback={null}`. Nada aparece por baixo da abertura. A lista que ainda lê quando a tela chega continua esta espera, sem vão e sem anunciar de novo |
| `Progresso` (`components/ui/progresso.tsx`) | Operação longa: as fotos que sobem e as etapas | "3 de 4" com a barra em segmentos chanfrados de 8 px e as miniaturas, ou "Etapa 1 de 2" com os marcadores de 28 px. A barra de progresso tem o nome e o `aria-valuetext` ("3 de 4 fotos"), por item, nunca por byte. As fotos sobem compactadas a 2000 px, uma por vez (`useEnvioDeFotos`); a que sobe sem bytes medidos gira em vez de encher, e a que falha tem o próprio "Tentar de novo", de 44 px. No fim, o título diz o que subiu ("3 fotos enviadas") e o bloco não encolhe. As etapas ficam na tela desde o repouso, pendentes, e a de agora anda aos 300 ms, com o anúncio do título; na caixa estreita, o rótulo vai para baixo do marcador |
| `AvisoDeEspera` (`components/ui/aviso-de-espera.tsx`) | A espera longa | Aos 10 s, "Demorando mais que o normal · 0:12" (com "Tentar de novo" só na leitura, e a estimativa quando o total é conhecido); aos 70 s, na escrita, "Sem confirmação do servidor" e "Conferir", que relê e nunca reenvia. O lugar dele fica guardado desde o repouso, para ele entrar sem empurrar o botão tocado. Conferindo, o botão diz "Conferindo…" e o aviso fica. A estimativa só conta para baixo e sai com a foto há 10 s sem um byte novo. O relógio nunca entra em região viva; o anúncio sai pelo Anunciador. Durante a operação, o "Voltar" e o X do diálogo (o `ocupado` do diálogo em ação) ficam `aria-disabled`, com 44 px no rodapé |
| `TrilhaDoAgente` (`components/agent/trilha-do-agente.tsx`) | A resposta do Agent Dute chegando | No lugar do "Pensando…": aos 300 ms, a caixa violeta de 20 px e "Lendo a pergunta…"; uma linha por consulta, "Consultando o estoque…" na da vez e "Estoque" com o check violeta de 16 px nas feitas (o check se chama "Consulta feita"). Até 4 linhas, as antigas em "+N consultas", numa caixa de pelo menos 300 px. Quando o texto começa, recolhe numa linha da mesma altura ("Leu o estoque e o razão de movimentos"), que entra em 150 ms; a resposta gravada mostra a mesma linha, e o bloco não encolhe enquanto chega. Aos 10 s sem texto, "Demorando mais que o normal" e o Parar (44 px), que corta a espera neste aparelho e devolve a pergunta ao campo vazio. Aos 180 s sem notícia do servidor, "Sem resposta do Agent Dute" e "Tentar de novo", que relê a conversa antes de perguntar de novo. A resposta não é região viva: o Anunciador fala a primeira consulta, a demora e "Resposta pronta". No escuro, o texto violeta é o `--agent-strong` |
| `FontesDaResposta` (`components/agent/trilha-do-agente.tsx`) | O fim da resposta do Agent Dute | "De onde tirei:" e um chip por fonte, de `tools_used` (invariante 3); o rascunho, a rotina e a anotação não são fonte. O lugar fica guardado enquanto o texto chega, e os chips entram nele em 150 ms |
| Diálogo em ação (`ocupado` no `Dialog`, `AlertDialog`, `Sheet` ou `DialogContent`; `DialogCancelar`; `components/ui/dialogo-em-acao.ts`; `lib/foco-de-volta.ts`) | O diálogo cuja ação grava | Enquanto grava, nada fecha: o Esc, o toque fora, o X e o Cancelar não fecham, e o `onOpenChange(false)` não chega a quem usa. O Esc e o toque fora esperam também o toque no confirmar, até a ação chegar à tela (no máximo 300 ms). O X e o Cancelar ficam `aria-disabled` desde o toque, com a trava no código, nunca `disabled`, e esmaecem a 0,45 aos 300 ms, junto com o gerúndio do confirmar, por pelo menos 500 ms; a ação que volta antes não os faz piscar. Do X, só o ícone esmaece: o anel do foco é o cheio, com o recuo. O confirmar é o `BotaoDeAcao` (o destrutivo cheio é o `perigo` dele); o `AlertDialogAction` já é ele e nunca fecha sozinho: quem fecha é o sucesso, e na falha o diálogo fica. Aos 10 s, o rodapé diz "Demorando mais que o normal · 0:12", em cima dos botões; aos 70 s, "Sem confirmação do servidor", e o diálogo volta a fechar. O diálogo com o `Progresso`, as fotos ou o próprio `AvisoDeEspera` não repete o aviso e cuida da própria saída. Quem limpa o estado do diálogo no fim mostra o último conteúdo até ele sair, como Pedidos e a `Confirmacao`: o fim não esvazia o cartão. O foco fica no botão tocado e, no fim, volta a quem abriu o diálogo (o item do "⋯" volta ao botão do menu); se ele saiu da tela, vai ao `focoAoFechar`, ao vizinho dele na ordem do Tab (a linha seguinte ou a anterior) ou ao título da página, que vem à vista se estava fora dela; nunca ao `body`. No celular, em pé ou deitado (a variante `celular`: menos de 768 px de largura ou de 500 de altura), o `DialogFooter` fica preso embaixo do diálogo que rola, com os botões de 44 px, o campo que recebe o foco não fica atrás dele, e o X tem 44 px; com um diálogo aberto, o toast vai para o topo |
| `FalhaNaSecao` (`components/ui/falha-na-secao.tsx`) | A falha de uma parte da tela, na própria seção | A frase e "Tentar de novo" (44 px no celular). "Tentando de novo…" só na tentativa que a pessoa pediu, até a promessa da releitura acabar; o intervalo da tela não muda o botão. A frase é alerta sem nada lido; com o que já estava lido na tela (`alerta={false}`), fica escrita, sem falar. Quando a nova tentativa dá certo, o foco vai ao título da seção ou do diálogo, nunca ao `body` (também no `ErroNaLeitura` sem linha de estado). A leitura por trás fica na falha durante a nova tentativa (`useLeituraComFalha`), para o aviso não sair da tela com o foco nele |
| Abertura (`#abertura` no `index.html`, `lib/abertura.ts`) | A entrada no app, até o perfil chegar | Preta nos dois temas, fora do `#root`, com a marca e a palavra embutidas e o trilho chanfrado aos 300 ms, sem texto visível. "Sem conexão" aos 3 s, "Demorando mais que o normal" e "Tentar de novo" aos 10 s, "Sem resposta" aos 70 s, na região de status dela, um aviso a cada 2 s. Na passagem para o app, o `Anunciador` espera os 2 s da última fala dela e não repete o "Sem conexão" que ela já disse. Sai pela `fecharAbertura()`: o trilho completa (200 ms) e tudo esmaece (260 ms). Enquanto ela cobre a tela, o `#root` fica inerte |

**As listas na primeira leitura** (`QueueGroup` com `count={null}` e
`carregando`, momento 2): Pedidos e Receber nascem com a forma final. Desde 0
ms, os títulos reais dos grupos, com o bloco de 16 × 12 px no lugar do número,
e o segmentado "Em aberto · ▪" (na falha, "Em aberto · —"); nunca "0" nem
"Nenhum…" antes de ler. Os
cartões já têm a altura das linhas-fantasma, pela contagem lembrada da lista e
do cliente (`lib/carregando/contagem-lembrada.ts`, de 1 a 5; sem ela, 2), e
elas aparecem aos 300 ms, com o brilho de dois ciclos, um por cartão e nunca
um por bloco (nas tabelas, o corpo das linhas-fantasma). Quando a linha muda
de altura, a contagem lembrada guarda também quantas são mais altas (nos
Documentos, as que têm o selo do Conhecimento). A lista fica
`aria-busy`, descrita pela linha de estado. Na chegada, as linhas reais entram
por opacidade, subindo 4 px, em cascata de 30 ms em até seis, por cima dos
fantasmas, que esmaecem junto; o número entra no lugar do bloco sem mexer o
rótulo, e o Anunciador diz o resumo ("3 para aprovar, 2 para separar, 1 para
entregar") só se disse "Carregando". É só a primeira leitura da tela: a
releitura, a troca de cliente e o que muda depois andam com a lista na tela. A
leitura que falha mostra o aviso no lugar da lista na hora, e a nova tentativa
pedida pela pessoa volta aos fantasmas e fala de novo. A releitura automática
(o intervalo da tela) deixa o aviso na tela, com "Tentando de novo…" no botão
e o foco nele, sem fantasmas e sem fala (`useFalhaNaReleituraAutomatica`).
Nas listas sem a forma final (as do Agent Dute, a troca de filtro), o aviso
fica também na nova tentativa da pessoa, com "Tentando de novo…". No celular,
cada opção do segmentado tem 44 px.

**A troca de filtro e a releitura** (momento 7, casos 3 e 4;
`lib/carregando/use-lista-em-troca.tsx`): nas listas com filtro no servidor
(Produtos, SKUs, Movimentações, Pedidos legado, Relatórios, o Fechamento do mês
e a troca de cliente no Receber), trocar a busca, a página, o tipo, o
período, o mês ou o cliente mantém a lista anterior (`placeholderData`), a 50%
em 150 ms, `inert` e com `aria-busy`, que só vale neste caso, com a
`BarraDaLista` no topo do cartão aos 300 ms, inteira; aos 5 s, a linha de
estado diz "Atualizando…" e, aos 10 s, "Demorando mais que o normal", com
"Tentar de novo". Nada de "Carregando..." no lugar da lista, e a tela não
pula. Enquanto a nova não chega, a lista anterior não se redesenha
(`ConteudoEmTroca`): o toque responde sem refazer a tabela. Na chegada, a
lista nova volta a 1 da opacidade em que a anterior estava, por transição,
subindo 4 px, em 150 ms (só opacidade no reduzido): nunca passa por 0, e a
troca rápida não pisca. Na troca de cliente do Receber, só os avisos do
cliente anterior ficam a 50% e inertes; o que a troca não relê segue com o
toque. O filtro, a busca e a paginação ficam fora do que fica inerte, e a
paginação fica ocupada com `aria-disabled`, sem `disabled`, também nas pontas
(a primeira e a última página, a 50%): o foco fica onde a pessoa tocou. A
página nova que chega com o topo do cartão acima da tela o traz à vista. A
troca que falha mostra o aviso no lugar da lista (`FalhaNaLeitura`, com
"Tentar de novo", que segue no aviso enquanto tenta), nunca o vazio, a lista
do filtro anterior nem um zero ao lado; "Tentando de novo…" só na nova
tentativa que a pessoa pede, no relógio da espera (depois de 300 ms, e pelo
menos 500 ms: a que falha de novo antes não muda o alerta), e, quando ela dá
certo, o foco vai à linha de estado. **A releitura que falha nunca apaga a lista nem a empurra**: a lista
lida fica, e o erro vai para a linha de estado ("Não consegui atualizar ·
lista de 10:42", ou a falta de conexão), sempre reservada. Só a leitura sem
nada lido troca a lista pelo aviso. A releitura automática não fala; quem
tocou em Atualizar ou em "Tentar de novo" e viu falhar de novo ouve "Não
consegui atualizar", só com a tela aberta. O "Avançar" da bancada só volta
depois da releitura e, até lá, fica ocupado, sem `disabled`. No celular, o shell da
Armazenagem não lê o armazém (os contadores só aparecem no menu lateral), e o
"Conferir" da separação lê a fila uma vez.

**Cores com papel fixo:** tinta na espera; vermelho só na ação e na abertura;
verde só no confirmado; `--destructive` só no erro; `#8A4B00` sobre âmbar suave
na demora e na falta de rede; violeta só no Agent Dute.

**Movimento:** em laço, só `transform` e `opacity` (trava em
`lib/carregando/tokens.test.ts`). Com `prefers-reduced-motion`, nada gira nem
desliza: o indicador para e respira com piso de contraste (0,6 em tinta, 0,8 em
branco sobre o vermelho), e o rótulo diz o estado.

**Texto:** gerúndio com o objeto ("Carregando pedidos…", "Aprovando…"), com o
caractere único "…". O texto sozinho, sem o indicador, não é sinal de espera.

**A trava** (`lib/carregando/trava.test.ts`, parte 13h): lê o texto do código
do app (os literais, os modelos e o texto do JSX, pelo parser do TypeScript;
sem os comentários e os testes) e reprova, com a lista do que achou,
`animate-spin` fora do `Spinner`, `animate-pulse` fora do `Esqueleto` e do
`Skeleton`, e "..." de três pontos em qualquer texto; no `index.css`, o
`@apply` e a `animation` com `spin` ou `pulse`. Sem exceções. Reprova também
o anel do foco apagado e o foco sem sinal (ver "Botões"). Botão que grava é o
`BotaoDeAcao`; leitura sem a forma da lista, a `CarregandoNaRegiao`, que
reserva a linha dentro do recuo de quem a usa (`box-content`).

**Na capa de entrada** (`.auth-cover`, sempre escura, nos dois temas), a
tinta e o aviso da espera são os dela: a capa relê o `--carregando-cor` (o
texto dela) e o `--carregando-aviso` (o âmbar do escuro), e o toque dos
botões escuros é o fundo do hover dela. Peça de espera que pinta com cor
própria usa a tinta da espera (`text-carregando-cor`), nunca o
`text-foreground`, que na capa é a tinta do tema claro (1,31:1 no cartão).
Os controles da capa têm 44 px, e o branco do botão principal fica sobre o
`--auth-accent-fundo` (4,95:1).

**Conexão** (`lib/carregando/estado-da-conexao.ts`, momento 8): um estado só
para o app. Com o aparelho conectado e o servidor sem resposta (a leitura que
só achou o cache, o `unavailable`, a callable sem resposta), é
"Reconectando…", em tinta, com os arcos do Wi-Fi, e o app relê sozinho em 2,
4, 8, 16 e 30 s. "Sem conexão", na pílula âmbar, só com o aparelho sem rede há
3 s ou com duas leituras seguidas sem resposta sem rede. Só sai do aviso
depois de uma leitura que deu certo, e cada aviso fica pelo menos 2 s. A ação
sem rede continua recusada na hora. A releitura sozinha é em silêncio: a tela
não muda enquanto ela lê, e o dado que chega espera o dedo. Antes de reler, e
no "Tentar de novo", o app acorda o SDK do Firestore que se deu por offline. A
faixa "Sem conexão" do shell segue o mesmo estado, sem região viva: quem diz
"Sem conexão", uma vez, é o `Anunciador` (antes do app, a região da abertura;
o `Anunciador` não repete o que ela já disse).

## O que vem depois (plano da auditoria)

As sete PRs da auditoria de 09/10/2026 estão em `main`. O relatório completo
está no artefato "Auditoria de UI Dute". Pendências de produto que ficaram
fora: "faltou" na separação com decisão do coordenador (depende de regra de
negócio) e endereço sugerido na guarda (depende do saldo por endereço).
