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
| 70 s | A saída: "Tentar de novo" na leitura, "Conferir" na escrita (180 s no chat) |

`useEspera(ativa)` devolve a fase pronta (visível, calmo, movimento) e
`useAnuncio()` fala na região de status do `Anunciador`, uma por tela, no
máximo um anúncio a cada 2 s.

**As peças:**

| Peça | Onde | Regra |
| --- | --- | --- |
| `Spinner` (`components/ui/spinner.tsx`) | Todo indicador | A caixa chanfrada (o canto de 45° do "D" da marca), em tinta (`currentColor`). Tamanhos 16 (texto e botão), 20 (botão do celular e Agent Dute), 24 (linha de estado) e 40 (módulo sem esqueleto). `calmo` depois de 10 s, `progresso` de 0 a 1 para o determinado. Sem `aria-label` fica fora da árvore; com ele, vira `role="status"` |
| `Esqueleto` e `CartaoComBrilho` (`components/ui/esqueleto.tsx`) | Primeira leitura de tela com desenho conhecido | Blocos neutros (`--carregando-esqueleto`, nunca a cor da marca), sempre `aria-hidden`. O brilho faz dois ciclos e para. O `Skeleton` antigo já usa o mesmo bloco |
| `BotaoDeAcao` (`components/ui/botao-de-acao.tsx`) | Ação com espera | Mantém a largura. Repouso, em andamento, sucesso (a caixa fecha em check), erro (crítico suave) e "Conferir". Durante a ação, `aria-busy` e `aria-disabled`, nunca `disabled` nem só 50% de opacidade |
| Toast | Retorno da ação | Continua o retorno padrão. No celular, embaixo, perto do polegar, com o fechar no toque |

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
"Sem conexão", uma vez, é o `Anunciador`.

## O que vem depois (plano da auditoria)

As sete PRs da auditoria de 09/10/2026 estão em `main`. O relatório completo
está no artefato "Auditoria de UI Dute". Pendências de produto que ficaram
fora: "faltou" na separação com decisão do coordenador (depende de regra de
negócio) e endereço sugerido na guarda (depende do saldo por endereço).
