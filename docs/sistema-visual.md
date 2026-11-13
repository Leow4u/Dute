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
- `agent-*` é a identidade do Agent Dute (violeta).
- `gender-fem-*` e `gender-masc-*` só no chip de gênero do Estoque do portal
  (FEM rosa, MASC azul-petróleo; `docs/mockups/PortalEstoqueGenero.dc.html`).
  Não são cor de status.

## Botões

`Button` tem um primário por tela (`default`), `secondary`/`outline` com
borda, `ghost` e `destructive` com borda. Tamanhos `sm` 36, padrão 40, `lg`
44. Não crie `<button>` com classes próprias para o que o `Button` já faz.

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
e ações. A ficha do item abre ao lado no desktop (`useIsDesktop`) e num sheet
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
de novo como "Carregando pedidos".

**As peças:**

| Peça | Onde | Regra |
| --- | --- | --- |
| `Spinner` (`components/ui/spinner.tsx`) | Todo indicador | A caixa chanfrada (o canto de 45° do "D" da marca), em tinta (`currentColor`). Tamanhos 16 (texto e botão), 20 (botão do celular e Agent Dute), 24 (linha de estado) e 40 (módulo sem esqueleto). `calmo` depois de 10 s, `progresso` de 0 a 1 para o determinado. Sem `aria-label` fica fora da árvore; com ele, vira `role="status"` |
| `Esqueleto` e `CartaoComBrilho` (`components/ui/esqueleto.tsx`) | Primeira leitura de tela com desenho conhecido | Blocos neutros (`--carregando-esqueleto`, nunca a cor da marca), sempre `aria-hidden`. O brilho faz dois ciclos e para. O `Skeleton` antigo já usa o mesmo bloco |
| `BotaoDeAcao` (`components/ui/botao-de-acao.tsx`) | Ação com espera | Mantém a largura. Repouso, em andamento, sucesso (a caixa fecha em check), erro (crítico suave) e "Conferir". Durante a ação, `aria-busy` e `aria-disabled`, nunca `disabled` nem só 50% de opacidade |
| Toast | Retorno da ação | Continua o retorno padrão. No celular, embaixo, perto do polegar, com o fechar no toque |
| `LinhaDeEstado` (`components/ui/linha-de-estado.tsx`) | Sob o título de Pedidos, Receber, Estoque, Estoque › Alertas, Produtos, SKUs, Movimentações, Pedidos legado, Relatórios, Estoque › Mapa e Estoque › Posições (`PageHeader`, `estado`), numa fila só dela, a 6 px do título no computador e a 2 px no celular, sempre abaixo das ações; no Fechamento, logo abaixo dos meses; na aba Histórico do Estoque, logo acima da lista, sem a hora (`semHora`) | 24 px sempre reservados: "Carregando pedidos…" com a caixa de 24 px depois de 300 ms (nas telas que ainda dizem "Carregando..." na tabela, a linha fica vazia até a lista chegar: `primeiraNaLista`); aos 10 s, a mesma caixa na volta calma e a pílula âmbar da demora; "Atualizado às 10:42"; "Atualizando…" quando a barra do topo passa de 5 s (a volta do app e a troca de filtro, mês ou cliente) e, aos 10 s, a demora com "Tentar de novo", dita uma vez; "Reconectando… · lista de 10:42" e "Sem conexão · lista de 10:42" (também com o aparelho sem rede há 3 s, antes de qualquer leitura falhar), e "Não consegui atualizar · lista de 10:42" quando a releitura falha por outro motivo, com a lista lida, todos com "Tentar de novo" (toque de 44 px). O texto troca em sequência: o que sai some em 80 ms (180 ms quando é uma espera) e só então o novo entra, em 150 ms. Nada é região viva, e a releitura automática não fala. Com o foco no "Tentar de novo", a troca leva o foco ao novo ou à própria linha, nunca ao `body`. No celular estreito, o que não cabe passa à linha de baixo, sem rolagem lateral. As ações do cabeçalho ficam por cima do toque estendido e nunca o perdem para ele |
| `BotaoAtualizar` | O Atualizar das listas | 40 px no computador, 44 px no celular. Só mostra a espera quando a pessoa toca nele: o ícone sai em 80 ms e a caixa entra em 150 ms; no fim, a caixa sai em 180 ms e o ícone volta. A releitura automática não o gira nem o desabilita. Travado na primeira leitura, a 0,45, volta a 1 em 150 ms. No fim do toque, "Lista atualizada" no Anunciador, só com a tela ainda aberta. Antes de reler, acorda a conexão de quem lê (`useAtualizarLista`). O Atualizar com rótulo do Conhecimento e da Central da IA (`BotaoDeAcao`, "Atualizando…") segue o mesmo `useAtualizarLista` |
| `BarraDeEspera` (`components/ui/barra-de-espera.tsx`) | A linha em andamento e o topo do cartão que relê na volta do app | Na volta do app (`resultado="fim"`), a barra do topo completa em tinta por `scaleX` em 200 ms e esmaece em 150 ms; a que nunca apareceu sai sem nada |
| `CarregandoTela` (`components/ui/carregando-tela.tsx`) | A tela que ainda abre: o arquivo dela, o perfil, o cliente | Aos 300 ms, a caixa de 40 px e "Abrindo Faturamento…" (o nome da aba; o que não é substantivo vem com "a tela": "Abrindo a tela Separar…"). Aos 10 s, "Demorando mais que o normal" e "Tentar de novo"; aos 70 s, "Sem resposta do servidor."; tentar de novo recarrega. Nunca o branco nem o `fallback={null}`. Nada aparece por baixo da abertura. A lista que ainda lê quando a tela chega continua esta espera, sem vão e sem anunciar de novo |
| `Progresso` (`components/ui/progresso.tsx`) | Operação longa: as fotos que sobem e as etapas | "3 de 4" com a barra em segmentos chanfrados de 8 px e as miniaturas, ou "Etapa 1 de 2" com os marcadores de 28 px. A barra de progresso tem o nome e o `aria-valuetext` ("3 de 4 fotos"), por item, nunca por byte. As fotos sobem compactadas a 2000 px, uma por vez (`useEnvioDeFotos`); a que sobe sem bytes medidos gira em vez de encher, e a que falha tem o próprio "Tentar de novo", de 44 px. No fim, o título diz o que subiu ("3 fotos enviadas") e o bloco não encolhe. As etapas ficam na tela desde o repouso, pendentes, e a de agora anda aos 300 ms, com o anúncio do título; na caixa estreita, o rótulo vai para baixo do marcador |
| `AvisoDeEspera` (`components/ui/aviso-de-espera.tsx`) | A espera longa | Aos 10 s, "Demorando mais que o normal · 0:12" (com "Tentar de novo" só na leitura, e a estimativa quando o total é conhecido); aos 70 s, na escrita, "Sem confirmação do servidor" e "Conferir", que relê e nunca reenvia. O lugar dele fica guardado desde o repouso, para ele entrar sem empurrar o botão tocado. Conferindo, o botão diz "Conferindo…" e o aviso fica. A estimativa só conta para baixo e sai com a foto há 10 s sem um byte novo. O relógio nunca entra em região viva; o anúncio sai pelo Anunciador. Durante a operação, o "Voltar" e o X do diálogo (o `ocupado` do diálogo em ação) ficam `aria-disabled`, com 44 px no rodapé |
| `TrilhaDoAgente` (`components/agent/trilha-do-agente.tsx`) | A resposta do Agent Dute chegando | No lugar do "Pensando…": aos 300 ms, a caixa violeta de 20 px e "Lendo a pergunta…"; uma linha por consulta, "Consultando o estoque…" na da vez e "Estoque" com o check violeta de 16 px nas feitas (o check se chama "Consulta feita"). Até 4 linhas, as antigas em "+N consultas", numa caixa de pelo menos 300 px. Quando o texto começa, recolhe numa linha da mesma altura ("Leu o estoque e o razão de movimentos"), que entra em 150 ms; a resposta gravada mostra a mesma linha, e o bloco não encolhe enquanto chega. Aos 10 s sem texto, "Demorando mais que o normal" e o Parar (44 px), que corta a espera neste aparelho e devolve a pergunta ao campo vazio. Aos 180 s sem notícia do servidor, "Sem resposta do Agent Dute" e "Tentar de novo", que relê a conversa antes de perguntar de novo. A resposta não é região viva: o Anunciador fala a primeira consulta, a demora e "Resposta pronta". No escuro, o texto violeta é o `--agent-strong` |
| `FontesDaResposta` (`components/agent/trilha-do-agente.tsx`) | O fim da resposta do Agent Dute | "De onde tirei:" e um chip por fonte, de `tools_used` (invariante 3); o rascunho, a rotina e a anotação não são fonte. O lugar fica guardado enquanto o texto chega, e os chips entram nele em 150 ms |
| Diálogo em ação (`ocupado` no `Dialog`, `AlertDialog`, `Sheet` ou `DialogContent`; `DialogCancelar`; `lib/foco-de-volta.ts`) | O diálogo cuja ação grava | Enquanto grava, nada fecha: o Esc, o toque fora, o X e o Cancelar não fecham, e o `onOpenChange(false)` não chega a quem usa. O X e o Cancelar ficam `aria-disabled` a 0,45, com a trava no código, nunca `disabled`. O confirmar é o `BotaoDeAcao`; o `AlertDialogAction` já é ele e nunca fecha sozinho: quem fecha é o sucesso, e na falha o diálogo fica. O foco fica no botão tocado e, no fim, volta a quem abriu o diálogo (o item do "⋯" volta ao botão do menu); se ele saiu da tela, vai ao `focoAoFechar` ou ao título da página, sem rolar, nunca ao `body`. No celular, o `DialogFooter` fica preso embaixo do diálogo que rola, com os botões de 44 px, e o X tem 44 px |
| Abertura (`#abertura` no `index.html`, `lib/abertura.ts`) | A entrada no app, até o perfil chegar | Preta nos dois temas, fora do `#root`, com a marca e a palavra embutidas e o trilho chanfrado aos 300 ms, sem texto visível. "Sem conexão" aos 3 s, "Demorando mais que o normal" e "Tentar de novo" aos 10 s, "Sem resposta" aos 70 s, na região de status dela, um aviso a cada 2 s. Na passagem para o app, o `Anunciador` espera os 2 s da última fala dela e não repete o "Sem conexão" que ela já disse. Sai pela `fecharAbertura()`: o trilho completa (200 ms) e tudo esmaece (260 ms). Enquanto ela cobre a tela, o `#root` fica inerte |

**As listas na primeira leitura** (`QueueGroup` com `count={null}` e
`carregando`, momento 2): Pedidos e Receber nascem com a forma final. Desde 0
ms, os títulos reais dos grupos, com o bloco de 16 × 12 px no lugar do número,
e o segmentado "Em aberto · ▪"; nunca "0" nem "Nenhum…" antes de ler. Os
cartões já têm a altura das linhas-fantasma, pela contagem lembrada da lista e
do cliente (`lib/carregando/contagem-lembrada.ts`, de 1 a 5; sem ela, 2), e
elas aparecem aos 300 ms, com o brilho de dois ciclos. A lista fica
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
tentativa que a pessoa pede, e, quando ela dá certo, o foco vai à linha de
estado. **A releitura que falha nunca apaga a lista nem a empurra**: a lista
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
