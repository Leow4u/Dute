# Diagnóstico: indicadores de carregamento na Armazenagem

Levantamento de 06/11/2026 sobre o shell da Armazenagem (o WMS), no código
da `main` em `901ec75`. Responde a uma pergunta só: **onde a Armazenagem
precisa dizer que está carregando ou que uma ação está em andamento, e o
que ela faz hoje em cada tela.** Os outros módulos (Comercial, Operação,
Financeiro, RH e Campo) ficam de fora: estão pausados, e a Armazenagem é o
único em uso (Leonardo, 06/11/2026). O Agent Dute desse shell e o portal do
cliente entram porque moram no mesmo shell e estão em produção.

A leitura foi tela a tela, no código de renderização (114 arquivos, 45,6 mil
linhas), e cada alegação de peso foi conferida de novo antes de entrar
aqui. Não muda código; a ordem dos PRs fica na seção 6 e as decisões que
esperam o Leonardo, na seção 7.

## 1. Resumo

A Armazenagem tem quatro jeitos de mostrar que espera (skeleton, texto
"Carregando", ícone girando em dois desenhos, e nada) e nenhuma regra
escrita: `docs/sistema-visual.md` e `docs/mockups/README.md` não falam de
carregamento, e os mockups da v3 não desenham esse estado. O que a pessoa
sente, do mais grave ao mais cosmético:

1. **A tela afirma antes de ler.** Na chegada avulsa, enquanto o catálogo
   carrega, qualquer código digitado vira "produto novo"
   (`features/warehouse-ops/receiving.tsx:530`, `:1011`), e a tela oferece
   "Cadastrar como novo" para um produto que já existe. As Functions recusam
   o código do cliente que já está no cadastro ("Use o produto existente para
   evitar SKU duplicado", `functions/wms/src/domain/operations.ts`), então o
   dano é a pessoa preencher categoria, custo e foto à toa e levar a recusa
   no fim. Corrigido no primeiro PR (decisão 6). O mesmo acontece em Devoluções e na
   Contagem cíclica ("não localizado"). Fora isso, treze lugares mostram
   vazio ou zero antes dos dados chegarem (seção 5, item 3).
2. **Erro vira vazio.** Pedidos não tem estado de erro: se a leitura falha,
   aparecem os três "Nenhum pedido para…" (`pages/pedidos.tsx:494`). Exceções,
   Posições, o histórico do item, Produtos, Movimentações, a conversa do
   agente e o Conhecimento fazem o mesmo; Retornos da Operação some.
3. **Abertura do app em branco.** Até o perfil chegar, `HomeRedirect`,
   `ProtectedRoute` e `RoleGate` devolvem `null` e o `index.html` não tem
   nada atrás do `#root`. Sem rede, até 30 s de tela branca.
4. **Ação em andamento sem sinal.** Em Posições nenhum botão tem spinner
   nem rótulo de espera; em Pedidos, Aprovar e Recusar apagam todas as
   linhas sem dizer qual está em andamento; no Fechamento, Salvar, Emitir e
   Marcar como paga só apagam; Trocar perfil e Cancelar convite em Pessoas
   não dão sinal nenhum.
5. **Diálogos que fecham no meio da ação.** Vinte e dois diálogos do shell
   fecham com Esc ou clique fora enquanto a chamada roda (seção 5, item 6);
   quatro confirmações fecham no clique, antes da resposta (Emitir fatura,
   Remover item da tabela, Remover posição, Apagar rotina). No portal, a
   janela do Evento fecha e perde o toast de sucesso e de erro.
6. **Operação longa sem progresso.** Fotos (`uploadBytes`, até quatro de
   uma vez, as demais descartadas sem aviso), Documentos (20 MB em base64,
   sem tempo limite), Conhecimento (lotes), Separado (quatro chamadas num
   só "Registrando..."), foto por IA (até 180 s, com contagem, mas sem
   tempo nem cancelar) e o diagnóstico de infraestrutura.
7. **"Carregando" sem padrão.** Pedidos, Receber, Estoque, Alertas,
   Relatórios, Documentos, Pessoas e as telas legadas mostram texto seco;
   Início, Operações, Contagem, Mapa, Posições, Etiquetas, Clientes e o
   portal mostram skeleton; Faturamento, Catálogo e o painel antigo do
   agente carregam o chunk com `Suspense fallback={null}` (tela em branco).
   O `Spinner` do design system não é usado; as telas giram o `RefreshCw`
   (36 vezes) ou o `Loader2` (25).
8. **Atualização em segundo plano e troca de filtro.** Início, Estoque,
   Mapa, convites, painel do owner e saldos refazem a leitura sozinhos sem
   sinal; Receber, Estoque e Alertas trocam a lista inteira pela mensagem de
   erro se um refetch automático falha; Relatórios, Fechamento, Produtos,
   SKUs, Movimentações e Pedidos legado voltam a "Carregando" a cada filtro,
   mês ou página (nenhuma tela usa `placeholderData`).
9. **Acessibilidade.** `aria-busy` existe em um formulário; os "Carregando"
   são `<p>` sem `role="status"`; o `Skeleton` não tem ARIA; os ícones
   girando não têm `aria-hidden`; nada respeita `prefers-reduced-motion`
   (a regra 1.2 do plano pede); a validação de saldo usa o ícone de alerta
   como indicador de espera.

O celular tem seção própria (seção 9), com o app de verdade num Pixel 7
simulado. O achado mais grave de lá vale para o computador também: sem rede, a
leitura devolve a lista vazia como se fosse a resposta.

## 2. Como a Armazenagem carrega hoje

- **Entrada.** `AuthProvider` (`lib/auth.tsx`) só libera depois do
  `onAuthStateChanged` e do `getDoc` do perfil; sem rede e sem perfil
  guardado, `esperarRede()` segura até 30 s. Nesse tempo as rotas devolvem
  `null` (`App.tsx`). O `Suspense` de cada tela mostra o texto
  "Carregando..." sem ícone; o `ChunkErrorBoundary` cobre o chunk que sumiu
  depois de um deploy. Não há barra de navegação entre telas.
- **Dados.** react-query (65 `useQuery`, mais os hooks gerados `useList*`
  e `useGet*` de `lib/api-client-react`), `retry: false`, sem refetch ao
  focar; `realtime-sync.tsx` invalida ao vivo. `isLoading` é a primeira
  leitura e `isFetching` a atualização. O Firestore roda sem cache
  persistente: toda tela abre esperando o servidor, então o estado
  "carregando" aparece sempre. Entrega do pedido, Retornos, avisos por
  e-mail e o Sino do portal leem por `onSnapshot` (`itens: null` até o
  primeiro snapshot).
- **Ações.** 55 `useMutation` com `isPending` (209 usos) e flags à mão
  (`pending`, `busy`, `submitting`, `enviando`). O botão fica `disabled` em
  323 lugares; muda o rótulo em 48; gira ícone em 65. As callables esperam
  70 s (180 s na foto de catálogo e no chat), sem aviso de demora.
- **Retorno.** Toast (`hooks/use-toast.ts`, um por vez, 190 chamadas);
  erro inline com `role="alert"` em várias bancadas. `role="status"` em 24
  lugares, `aria-live` em três, `aria-busy` em um.
- **Shell.** O menu preto, o seletor de módulo e o seletor de cliente ativo
  não mostram carregamento; o seletor exibe o cliente legado até
  `client_profiles` chegar (`lib/active-customer-context.tsx:53`, `:111`).
  Sem rede, o shell mostra a faixa "Sem conexão"
  (`components/layout/shell-do-modulo.tsx:215`), mas as listas continuam em
  "Carregando".

## 3. O que já está bem (copiar, não reinventar)

- **Cancelar recebimento** (`features/warehouse-ops/cancelar-recebimento.tsx:83-120`):
  `Loader2` com `aria-hidden`, rótulo "Cancelando…", `aria-busy` no
  formulário, Esc e clique fora bloqueados. É o caso de referência do shell.
- **Receber › Operações** (`pages/warehouse-ops.tsx:341-369`, `:1152`):
  skeleton da tela inteira, "Atualizar" girando com `isFetching`, "Avançando"
  com ícone no painel da tarefa (`task-detail.tsx:1965`).
- **Chegada avulsa** (`receiving.tsx:776`, `:787`): `fieldset disabled` e
  fechamento bloqueado durante a criação.
- **Chegada por caixa** (`chegada-por-caixa-conteudo.tsx:308-315`):
  "Salvando… Aguarde a confirmação." com `role="status"` e `aria-live`.
- **Destino da caixa** (`destino-da-caixa.tsx:136`): "Consultando a
  sugestão…" e "Conferindo o encaixe…" com `role="status"`.
- **Estúdio de fotos** (`product-photo-studio.tsx:396-406`): contagem
  "n/total" em `aria-live`, fechamento bloqueado.
- **Chaves de API** (`pages/settings-integrations.tsx:52-58`,
  `components/integracoes/personal-key-form.tsx`): "Carregando chaves…" com
  `role="status"`, "Criando…", trava por `useRef` contra o clique duplo e
  janela que não fecha durante a ação. Reenviar e Remover convite em
  Pessoas (`pages/users.tsx:979-1048`) seguem o mesmo molde.
- **Início** (`components/inicio/inicio-do-modulo.tsx:109-114`): skeleton
  de três linhas e a frase do topo que não inventa zero.
- **Portal**: `ClientDataBoundary` com `ClientModuleLoading` e
  `ClientModuleError` (`pages/client/shared.tsx:475-610`); Envios com
  "Enviando anexo i de n…" (`pages/client/envios.tsx:367-372`); cartões de
  rascunho do agente com spinner, "Enviando…" e erro em `role="alert"`.
- `ChunkErrorBoundary` e a faixa "Sem conexão" do shell.

## 4. Mapa tela a tela

Colunas: o que aparece na primeira leitura, na atualização, durante a ação,
nas operações longas, e o que está errado. Linhas de arquivo relativas a
`artifacts/app/src`.

### 4.1 Entrada e shell

| Tela | Leitura inicial | Ação em andamento | Problemas |
| --- | --- | --- | --- |
| Abertura (`App.tsx`, `lib/auth.tsx`) | `null` até o perfil chegar; `index.html` vazio | Entrar vira "Entrando..." sem ícone | Tela branca em toda abertura; até 30 s sem rede |
| Troca de tela (`Suspense` em `App.tsx`) | Texto "Carregando..." sem ícone | — | Sem padrão com o resto |
| Shell (`wms-layout.tsx`, `active-customer-switcher.tsx`) | Nada; o seletor mostra o cliente legado até a lista chegar | — | Sem sinal de navegação |

### 4.2 Início

| Tela | Leitura inicial | Atualização | Problemas |
| --- | --- | --- | --- |
| Início (`pages/home.tsx`, `home-view.tsx`) | Skeleton no "Precisa de você" e na lateral | Refetch a cada 60 s e 120 s sem sinal (`lib/use-inicio-do-wms.ts:129-160`) | "SKUs em estoque" mostra 0 enquanto o dashboard carrega ou falha: `useGetDashboard` fica fora de `carregando` e `falhas` (`home.tsx:15-17`) |

### 4.3 Pedidos

| Tela ou bancada | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Lista (`pages/pedidos.tsx`) | Texto "Carregando pedidos..." (`:528`) | `RefreshCw` gira no Atualizar (`:511`) | — | — | Sem estado de erro: `loading` só olha `isLoading` (`:494`) e `ops.error` nunca é lido; a falha vira "Nenhum pedido para…" |
| Para aprovar | "Validando saldo" com `AlertTriangle` (`:579`, `customer-requests.tsx:671-676`) | — | Aprovar e Recusar apagam por um `busy` global (`:467`), sem spinner, sem rótulo, sem dizer qual linha | — | Ícone de alerta como indicador de espera |
| Separado, Entregue, Cancelar, Recusar (diálogo único) | — | — | "Registrando..." e "Cancelando..." (`:772`, `:823`, `:853`); Recusar não muda (`:735`) | Separado encadeia até quatro `advance` e um GET num só rótulo (`:387-430`) | O diálogo fecha com Esc ou clique fora durante o envio (`:703`); "Voltar" segue ativo |
| Entrega (diálogo) | `useLeitura` começa com `itens: null` (`:209`) | Ao vivo | "Salvando..." (`:893`) | POST e depois a callable `openStorageDemand` (`:319-330`) sem dizer que são duas etapas | Antes do snapshot o botão diz "Entrega" em vez de "Alterar entrega" e o formulário abre vazio (`:381`, `:484`); `entregas.erro` nunca é lido |
| Tratar (Sheet com o painel da tarefa) | Dados do `ops` | — | "Avançando" com ícone (`task-detail.tsx:1965-1972`) | — | O botão volta antes do refetch: `invalidate()` não é aguardado (`task-actions.tsx:46-49`, `:66`) |
| Registrar exceção (diálogo) | — | — | `RefreshCw` girando, rótulo fixo; Cancelar desabilitado (`task-actions.tsx:237-252`) | — | Esc fecha: `onOpenChange` só preserva a nota (`:145-151`) |
| Fotos dos itens (`lib/use-item-photos.ts`) | Ícone de "sem foto" enquanto as três leituras chegam (`pedidos.tsx:1063`) | — | — | — | Não distingue carregando de sem foto |

### 4.4 Estoque › Itens e Alertas

| Tela ou bancada | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Itens (`pages/estoque.tsx`) | Texto "Carregando estoque..." só enquanto `skus` carrega (`:312`) | Refetch a cada 120 s e 300 s sem sinal; sem botão Atualizar | — | — | Saldos, produtos, `stock-age` e caixas chegam depois sem sinal e com erro ignorado: "Sem endereço", "Sem foto" e os filtros Parados e Sem giro em 0 até chegarem (`:194-200`); erro do refetch esconde a lista (`:314`) |
| Ficha do item | Últimos movimentos: "Carregando..." (`:855`); as datas de "Onde está" chegam depois sem aviso (`:637-644`) | — | Foto: "Enviando..." com o ícone `Camera` parado (`:773-779`) | `uploadBytes` sem progresso; da quinta foto em diante, descartadas sem aviso (`:658`) | Erro dos movimentos vira "Nenhum movimento registrado." (`movements.isError` nunca é lido) |
| Guardar do RECEBIMENTO (`guardar-da-area.tsx`) | "Carregando..." em texto (`:186`) | — | "Abrir a guarda" só apaga (`:91`); toast | — | O diálogo fecha durante o envio (`:165`); Cancelar segue ativo |
| Gestor e estúdio de fotos (`product-photo-manager.tsx`, `product-photo-studio.tsx`) | — | — | `role="status"` + `Loader2` + "Atualizando fotos…"; estúdio com contagem n/total e `aria-live` | Geração até 180 s por foto, sequencial, sem tempo decorrido nem cancelar | "Remover foto" sem spinner (`manager:212-221`); timeout chega como mensagem crua em inglês |
| Alertas (`pages/estoque-alertas*.tsx`) | Texto "Carregando alertas..." (`view:228`) | Refetch a cada 120 s sem sinal | "Gravando..." no Enviar; Descartar não muda; checkboxes apagam | — | Falha no refetch troca a lista pela mensagem de erro (`estoque-alertas.tsx:101`) |

### 4.5 Receber e Operações

| Tela ou bancada | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Receber, lista (`pages/receber.tsx`) | Texto "Carregando chegadas..." (`:329`); erro com Tentar de novo | `RefreshCw` gira (`:321`) | — | — | Os avisos (`requests`, `:122`) não têm loading nem erro: "Nenhuma chegada para conferir." pode aparecer antes deles (`:367-371`); ao trocar de cliente os avisos somem até a nova leitura |
| Ficha por linha (`receiving.tsx`) | — | — | Concluir entrada e Divergência giram ícone, rótulo fixo (`:360-390`); vincular aviso só apaga as opções (`:393`) | — | Concluir entrada continua clicável enquanto Salvar conferência roda (`:378` e `:1493`) |
| Conferência por linha | — | — | `RefreshCw` girando, rótulo fixo (`:1490-1500`); toast | — | `idempotency_key` nova a cada clique (`:1433`) |
| Chegada avulsa (diálogo) | Catálogo de até 10 mil linhas carrega ao abrir sem nenhum indicador (`:512-530`) | — | Esc e clique fora bloqueados; `fieldset disabled`; ícone girando (`:776`, `:787`, `:1217`) | Foto por linha "Enviando..." sem progresso (`:1091`) | **Falso "produto novo"**: `productLookup = lookupQuery.data ?? []` (`:530`), `isLoading` e `isError` nunca usados; com o catálogo carregando ou com erro, `mustCreate` fica verdadeiro para qualquer código (`:1011`) e a linha diz "Identificação pendente" (`:836`) |
| Chegada por caixa (`chegada-por-caixa*.tsx`) | Dados do `ops` | — | "Salvando… Aguarde a confirmação." com `role="status"`; botões só apagam, sem ícone (`conteudo:433`, `:619`, `:854`) | O ocupado dura até o fim da releitura do `ops` (`chegada-por-caixa.tsx:262-267`) | — |
| Destino da caixa (`destino-da-caixa.tsx`) | "Consultando a sugestão…" e "Conferindo o encaixe…" (`:136`) | — | "Confirmar destino" só apaga (`:171`) | — | Recusa da prateleira fecha durante o envio (`:205`); Cancelar ativo (`:255`) |
| Falta da linha (`falta-da-linha.tsx`) | — | — | Só apaga o envio (`:92`) | — | Fecha durante o envio (`:103`) |
| Guarda da caixa (`guarda-da-caixa.tsx`) | Endereço da prateleira chega depois sem indicador (`:210-215`) | — | "Concluir guarda em X" só apaga (`:162-164`) | — | Erro de guardar sem toast (`:234-241`); o Alert de erro sem `role="alert"` (`:155`) |
| Operações, bancada (`pages/warehouse-ops.tsx`) | Skeleton da tela inteira (`:341-369`, `:1114`); erro com Tentar novamente | Atualizar gira (`:1152`); refetch a cada 60 s gira também | Avançar: ícone + "Avançando" (`task-detail.tsx:1960-1973`); toast | — | Guarda: "Carregando posições." em texto (`task-detail.tsx:516`); Exceções e Devoluções só aparecem depois do `ops` (`:1160-1163`) |
| Exceções (`exceptions.tsx`) | Três skeletons (`:268-273`) | Atualizar próprio gira (`:252-263`) | "Confirmar tratativa": apaga + spinner, rótulo fixo (`:390-409`) | — | Erro de leitura vira "Sem exceções abertas" (`:322-333`); Tratativa mostra "Nada selecionado" durante a carga |
| Devoluções, registrar e disposição (`exceptions.tsx`) | Skeleton só com a lista vazia (`:1078-1082`); catálogo sem indicador | Trocar de cliente volta ao skeleton | Submit apaga + spinner; trava contra duplo envio (`:733`) | — | Com o catálogo carregando, a linha digitada diz "não localizado" e avisa "Não crie SKU duplicado" (`:558`, `:827-898`) |
| Retornos da Operação (`order-returns.tsx`) | `return null` enquanto `itens` é null (`:60`) | Ao vivo | "Recebendo..." sem ícone (`:121`) | — | `erro` nunca é lido: a tela some em vez de avisar; no diálogo, as linhas que falham ficam em "Carregando..." para sempre (`:88`); fecha durante o envio (`:81`) |

### 4.6 Estoque › Contagem

| Tela ou bancada | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Seletor (`inventory.tsx:202`) | Abas e skeleton | — | — | — | — |
| Inventário de abertura | Skeleton em `sessionQuery.isLoading` (`:1086`); erro com Tentar novamente | "Verificando o catálogo" com ícone girando (`:1417-1424`) | Iniciar sessão, iniciar caixa, salvar produto, confirmar guarda: apaga + spinner; o `onSuccess` espera o refetch (`:668-677`); toast | Sugestão de posição com `role="status"` (`:1271`) | Fechar caixa, Reabrir, Voltar à conferência e Remover rascunho sem spinner nem rótulo (`:1154`, `:1177`, `:1915`, `:1925`); durante cada refetch os botões apagam sem explicação (`:1009-1011`, `:446`) |
| Painel "Progresso da abertura" | Nenhum indicador: contadores em 0 (`:1646-1663`) | — | Concluir com spinner (`:1991`) | — | "Nenhuma caixa nesta sessão." enquanto `boxesQuery` carrega (`:1711-1788`) e "Nenhum lançamento neste filtro." durante a carga da sessão (`:1874`) |
| Diálogos | — | — | Remover linha e caixa, corrigir caixa: spinner e fechamento bloqueado | — | Concluir inventário fecha com Esc durante o envio (`:1942`) |
| Resumo da caixa (`opening-conference-summary.tsx`) | — | — | "Retomar guarda" gira sempre que `busy` (`:60`) | — | `busy` inclui `formDirty` (`inventory.tsx:1168`): o ícone gira com o formulário sujo, sem nenhuma operação |
| Prateleira (`shelf-picker.tsx`, `shelf-volume-summary.tsx`) | "Carregando prateleiras…" no gatilho (`:52`) | Apaga em `isFetching` sem rótulo | — | `Progress` mede volume ocupado, não espera (`:50`) | — |
| Contagem cíclica | Catálogo sem indicador (`inventory.tsx:2130-2144`) | — | Submit apaga + spinner; trava contra duplo envio | — | "Produto ainda não localizado" durante a carga do catálogo (`:2285-2295`) |
| Foto do produto | — | — | "Enviando..." com ícone (`:1558-1567`); toast só no erro | `Promise.all` de até quatro `uploadBytes`, sem progresso nem contagem (`:966-973`) | — |

### 4.7 Mapa, Posições e Etiquetas

| Tela | Leitura inicial | Atualização | Ação em andamento | Problemas |
| --- | --- | --- | --- | --- |
| Mapa (`pages/warehouse-map.tsx`) | Skeleton em posições e caixas (`:142`, `:215`); "Verificando inventário…" com `role="status"` (`:201`) | Quatro leituras a cada 120 s sem sinal (`:88-101`) | Só navegação | Saldos e SKUs ficam fora de `loading` e `error` (`:142-143`): a busca pode dizer "Nenhuma prateleira tem o que você buscou." durante a carga |
| Posições (`pages/warehouse-positions.tsx`) | Skeleton (`:407`, `:455`) | Sem sinal | Salvar, cadastrar rua, aplicar zona, carregar mapa e remover só apagam; nenhum spinner ou rótulo (`:467`, `:711`, `:767`, `:805`, `:823`) | Todos os diálogos fecham durante o envio (`:636`, `:719`, `:775`, `:813`); Remover é um `AlertDialogAction` sem `preventDefault` (`:823`); em erro, a tabela vazia aparece junto do alerta (`:409`, `:476`) |
| Etiquetas (`pages/warehouse-labels.tsx`, `label-sheet.tsx`) | Skeleton (`:96`, `:178`) | — | `window.print()` síncrono; botão apaga ao carregar | Sem espera: está bem |

### 4.8 Faturamento

| Tela | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Hub (`pages/billing-hub.tsx`) | `Suspense fallback={null}` (`:62`); a aba Contratos some enquanto o cliente carrega (`:65`) | — | — | — | Tela em branco enquanto o chunk baixa |
| Fechamento do mês (`pages/billing.tsx`) | "Calculando {mês}..." (`:295`); espera o cliente (`:120`) | Trocar de mês troca tudo por "Calculando..." | Salvar, Emitir e Marcar como paga só apagam (`:479`, `:493`, `:517`); toast | — | Cartões de mês nascem `{ status: "aberto", total: 0 }` até a lista de períodos chegar (`:165-179`): mês emitido ou pago aparece "Em aberto"; a confirmação de Emitir fecha no clique, sem "Emitindo…" (`:511`) |
| Fatura (`pages/billing-invoice.tsx`, `invoice-document.tsx`) | "Carregando fatura..." (`:118`); espera o cliente | — | Imprimir é `window.print()` | — | — |
| Tabela de preços (`pages/price-list.tsx`) | **Nenhum**: "Nenhum serviço na tabela…" aparece de cara (`:55`, `:131`, `:156-161`) e também no erro | — | Salvar item só apaga (`:289`); Salvar cobrança "Salvando..." (`:229`); Remover fecha na hora e sem `onError` (`:117`, `:303`) | — | O formulário de Cobrança fica vazio e salvável antes de `config` chegar (`:71-80`, `:228`): um clique grava taxa 0 e campos vazios (deduzido do código, não testado) |

### 4.9 Relatórios e Documentos

| Tela | Leitura inicial | Atualização | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- | --- |
| Relatórios (`pages/reports.tsx`) | "Carregando..." em texto (`:508`); o resumo some (`:489`) | Trocar período ou relatório volta a "Carregando..." | Baixar planilha apaga sem `report` (`:437`) | CSV síncrono no cliente, sem progresso; aviso de 5.000 linhas (`:575`) | Os contadores da lateral só aparecem com os dados (`:412`); "Nenhum relatório disponível para o seu perfil" se o perfil ainda não chegou (`:195-198`, não confirmado no shell) |
| Documentos (`pages/documents.tsx`) | "Carregando documentos..." (`:326`) | Filtro local | Adicionar: "Enviando..." (`:489`); as ações do menu de cada linha (Conhecimento, Aprovar, Recusar, Mostrar, Arquivar) sem sinal nenhum (`:352-355`, `:550-567`) | Até 20 MB em base64, duas requisições, sem progresso nem tempo limite (`:150-204`); OCR só responde no toast final | O diálogo fecha durante o envio (`:384`, `:486`); erro dos avisos ignorado (`:328`); lê `code` sem esperar o cliente ativo (`:114`) |

### 4.10 Configurações

| Tela | Leitura inicial | Atualização | Ação em andamento | Problemas |
| --- | --- | --- | --- | --- |
| Minha conta, Aplicativo (`pages/settings.tsx`) | Sem leitura de rede | — | Sair sem espera (`:92`); Instalar com `role="status"` (`:217`) | — |
| Chaves de API (`settings-integrations.tsx`, `personal-key-form.tsx`) | "Carregando chaves…" com `role="status"` | "Carregar mais" mostra "Carregando…" | "Criando…" e "Revogando…" com trava por ref; a janela não fecha | Referência boa |
| Clientes (`settings-customers.tsx`) | Três skeletons (`:288-293`) | — | "Salvando..." (`:697`); Arquivar com `preventDefault` (`:716-723`) | O diálogo fecha durante o salvamento (`:472`, `:694`); Zona e Pessoas mostram "A definir em Posições" e "Ninguém no portal" antes de `positions` e `users` chegarem (`:176-183`) |
| Avisos por e-mail (`settings-customer-notifications.tsx`) | "Carregando contatos…" com `role="status"` | Ao vivo | "Salvando..." no diálogo; não fecha | Desativar e Reativar sem rótulo (`:173`) |
| Pessoas e acessos (`pages/users.tsx`) | "Carregando pessoas..." (`:647`) | Convites a cada 30 s sem sinal (`:276`) | Convite "Criando..." (`:1177`); Reenviar e Remover não fecham (`:979-1048`); Revogar só apaga (`:1218`) | Trocar perfil sem `disabled` nem sinal (`:890`); Cancelar convite sem confirmação nem espera (`:855`); o diálogo de convite fecha durante a criação (`:1054`, `:1170`) |
| Sistema (`settings-system.tsx`) | Tile "Verificando" (`:208`); incidentes "Carregando..." (`:261`) | `RefreshCw` gira (`:229`) | Registrar "Registrando..."; Numerar só apaga (`:318-327`) | Numeração em massa sem progresso; o diálogo fecha durante a ação (`:332`, `:384`) |
| Painel do owner (`components/system/owner-dashboard.tsx`) | "Carregando o painel…" (`:130`) | A cada 60 s sem sinal | "Salvando…" (`:114`) | O diálogo fecha durante a ação (`:81`, `:105`) |
| Infraestrutura (`components/system/infra-panels.tsx`) | "Consultando o Google Cloud…" (`:377`) | `RefreshCw` com `aria-hidden` (`:372`) | "Salvando…" (`:348`) | Consulta de vários segundos sem aviso de demora nem tempo limite (`:30-32`); tiles "Verificando…" com ponto verde (`lib/system-infra.ts:60`) |

### 4.11 Telas legadas ainda roteadas

Chegam por link ("Ver histórico completo de pedidos", "Ver solicitações",
o Início) ou por URL.

| Tela | Leitura inicial | Atualização | Ação em andamento | Problemas |
| --- | --- | --- | --- | --- |
| Catálogo (`pages/catalog.tsx`) | `Suspense fallback={null}` (`:49`) | — | — | Tela em branco enquanto o chunk baixa |
| Produtos (`pages/products.tsx`) | "Carregando produtos..." numa linha da tabela (`:177`) | Busca (500 ms) e página voltam a "Carregando" | "Salvando..." e "Excluindo..." | Sem erro tratado: tabela vazia (`:181`); o diálogo fecha durante a ação (`:310`, `:406`) |
| SKUs (`pages/skus.tsx`) | "Carregando SKUs..." (`:229`) | Igual | "Salvando..." e "Arquivando..." | "Sem endereço" antes dos saldos chegarem e também no erro (`:284`); o diálogo fecha (`:403`, `:581`) |
| Movimentações (`pages/movements.tsx`) | "Carregando movimentações..." (`:202`) | Igual | "Salvando..." (`:584`) | Sem erro tratado; no celular a falha vira "Nenhuma movimentação encontrada" (`:204`) |
| Pedidos legado (`pages/orders.tsx`) | "Carregando pedidos..." (`:131`) | Igual | O Select de status sem trava nem sinal (`:224`) | Os quatro cartões mostram 0 durante a carga (`:69-91`) |
| Solicitações (`pages/customer-requests.tsx`) | "Carregando solicitações..." (`:1438`) | `RefreshCw` gira (`:1387`); a cada 120 s | "Aprovando...", "Encerrando...", "Recusando..." com `busy` global | O diálogo de recusa fecha durante a ação (`:1514-1528`) |

### 4.12 Agent Dute no shell da Armazenagem

| Tela ou painel | Leitura inicial | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- |
| Conversa (`components/agent/agent-screen.tsx`) | Lista: "Carregando…" (`:469`); mensagens: `Loader2` + "Carregando a conversa…" (`:752`) | Enviar com `Loader2`; "Pensando…" e etiquetas das consultas (`:861-879`); falha com toast e o texto volta ao campo | Anexo com chip "enviando…" (`:561`); stream de até 180 s sem botão de parar | Conversa que falhou ao carregar vira a tela de boas-vindas (`:268`); a lista com erro vira "Suas conversas aparecem aqui." (`:471`); leitura da nota sem etiqueta própria; timeout em inglês |
| Cartões de rascunho (pedido, envio, rotina, anotação) | — | Apaga, `Loader2`, "Enviando…", `fieldset disabled`; erro no cartão com `role="alert"` | — | Sem toast; a troca para "enviado" não é anunciada |
| Rotinas (`routines.tsx`) | "Carregando…" (`:406`) | Janela "Salvando…" que não fecha (`:198`); o "⋯" vira `Loader2` (`:278`) | "Executar agora" só com o spinner do "⋯" | Salvar, pausar e apagar sem toast de sucesso; Apagar fecha a confirmação na hora (`:310`); "Nova rotina" ativa durante a carga (`:354`) |
| Painel do núcleo (`pages/agente-painel*.tsx`) | Três skeletons; números "—" (`view:166`, `:188-193`) | Aprovar e Recusar só apagam, um `isPending` para todas as notas (`:119-134`) | — | "—" igual para carregando e erro; o painel antigo carrega com `fallback={null}` (`agente-painel.tsx:109`) |
| Painel antigo (`pages/ai-control.tsx`) | Divs com `animate-pulse` sem texto (`:1114-1129`) | Sincronizar gira; Aprovar, Enviar, Arquivar, Resolver e Registrar só apagam (`:1393-1421`, `:2192`, `:2239`) | — | "Nenhum risco…" enquanto as leituras carregam (`:1459`, `:2020`); `resolveInsight` sem `onError` (`:1670`) |
| Conhecimento (`pages/agent-knowledge.tsx`) | `Loader2` + "Carregando base de conhecimento..." (`:636`); contadores em 0 (`:601-629`) | Anexar com `Loader2`, rótulo fixo (`:855`); Baixar por item | Upload em lotes no Firestore sem progresso (`:382-492`) | Erro de leitura vira "Sem documentos na base" (`:729-740`) |
| Anotações e Playbooks (`agent-notes.tsx`, `agent-playbooks.tsx`) | `Loader2` + "Carregando…" | Nova anotação e Decidir só apagam, `isPending` compartilhado (`notes:74`, `:131`); janela do playbook "Salvando…" que não fecha | — | "Salvar sem aprovar" não muda (`playbooks:119`) |

### 4.13 Portal do cliente

| Tela | Leitura inicial | Ação em andamento | Operação longa | Problemas |
| --- | --- | --- | --- | --- |
| Todas (`pages/client/shared.tsx`) | `ClientDataBoundary` com skeleton e texto `sr-only` (`:475`, `:551-575`); erro com Tentar novamente | — | — | Sem sinal no refetch; o `sr-only` não está numa região viva |
| Início (`inicio.tsx`) | Boundary | — | — | `RoutineNews` devolve `null` carregando e no erro (`:308`) |
| Estoque (`estoque.tsx`) | Boundary; datas de entrada somem carregando e no erro (`:2250`) | Enviar pedido com `Truck animate-pulse`, rótulo fixo (`:2115`); Salvar evento "Salvando…"; Repor e Arquivar na lista sem `disabled` (`:1526`, `:1807`) | — | O painel lateral fecha durante o envio (`:1583`); com `?evento=` nada aparece enquanto carrega (`:404`) |
| Eventos (`eventos.tsx`) | Boundary e um segundo skeleton (`:87`) | Editar "Salvando…" (`:444`); Excluir só apaga | — | A janela fecha com Esc ou Cancelar enquanto salva (`:346`, `:441`) e os callbacks do `mutate` não rodam depois de desmontar: ninguém sabe se salvou |
| Pedidos (`pedidos.tsx`) | Boundary | Cancelar com `Loader2` e toast (`:228-248`) | — | "Manter" segue ativo |
| Envios (`envios.tsx`) | Boundary | "Enviando anexo i de n…" e "Registrando o aviso…" (`:367-372`) | Leitura da NF "Lendo a nota…" (`:756-769`), sem tempo limite (`:487`) | Enviar e soltar arquivo funcionam durante a leitura da nota (`:527`, `:749`) |
| Faturas (`faturas.tsx`) | Boundary; NFs somem enquanto carregam | — | — | "Nenhuma fatura fechada ainda" enquanto as NFs carregam (`:85-91`); o erro delas é descartado (`:48`) |
| Relatório (`relatorio.tsx`) | Boundary | Baixar com `Loader2`; toast só no erro | Sem tempo limite | — |
| Minhas OS (`servicos*.tsx`) | "Carregando..." em texto (`view:353`) | "Enviando..." (`:342`) | Anexos um a um sem progresso | "Fechar" ativo durante o envio |
| Comprovante (`comprovante*.tsx`) | "Carregando" em texto (`view:31`) | Baixar PDF = imprimir | Fotos e assinatura chegam depois sem marcador | "Baixar PDF" ativo antes das fotos (`:47`); foto que falha some |
| Sino (`components/portal/sino.tsx`) | "Carregando..." (`:70`) | Marcar como lidos sem retorno (`:139`) | — | — |

## 5. Necessidades, em ordem de dor

| # | Onde | O que falta | Quem sente |
| --- | --- | --- | --- |
| 1 | Chegada avulsa, Devoluções, Contagem cíclica | Esperar o catálogo antes de dizer "produto novo" ou "não localizado", como a abertura faz com "Verificando o catálogo" | Quem recebe: preenche um cadastro novo que as Functions recusam no fim |
| 2 | Pedidos, Receber (avisos), Exceções, Posições, histórico do item, Produtos, Movimentações, conversa e Conhecimento do agente, Retornos | Estado de erro próprio: erro nunca vira vazio nem some | Quem opera com a rede ruim |
| 3 | Painel da abertura, Tabela de preços, cartões do Fechamento, Início (SKUs), Estoque (endereço, foto, Parados), Receber (avisos), Pedidos legado, SKUs, Clientes, Faturas do portal, Conhecimento, painel antigo, formulário de Cobrança | Nunca afirmar vazio ou zero antes da primeira leitura | Todos |
| 4 | Abertura do app, `Suspense` de Faturamento, Catálogo e painel antigo | A marca e um spinner no lugar do branco; "Sem sinal" quando a rede não vem | Todos, toda vez |
| 5 | Posições (todos), Pedidos (Aprovar, Recusar), Fechamento (Salvar, Emitir, Marcar paga), guarda e destino da caixa, falta da linha, guardar do RECEBIMENTO, abertura (fechar, reabrir, voltar, remover), Revogar acesso, Numerar, painel do agente, anotações, playbooks, Documentos (menu), Pessoas (trocar perfil, cancelar convite) | Spinner no botão, rótulo no gerúndio, `aria-busy`; dizer qual linha está em andamento | Operação de todo dia |
| 6 | 22 diálogos (Pedidos, Registrar exceção, Concluir inventário, Receber retorno, Posições ×4, Falta, Recusa, Guardar da área, Documentos, Clientes, Tabela de preços, Sistema, owner, Infra, Produtos, SKUs, Convite, Revogar, Recusar solicitação, Evento do portal, Estoque do portal) e 4 confirmações que fecham no clique (Emitir, Remover item, Remover posição, Apagar rotina) | Segurar o diálogo enquanto `isPending`, desabilitar Cancelar, `preventDefault` no `AlertDialogAction` | Quem usa teclado ou clica fora |
| 7 | Fotos (ficha, chegada, abertura), Documentos, Conhecimento, Separado, Entrega, foto por IA, Infra, Numerar | Contagem ("2 de 4"), progresso quando o canal der, aviso de demora depois de 10 s, mensagem própria para o timeout de 70 s, etapas nas ações encadeadas | Quem anexa e quem fecha o mês |
| 8 | Início, Estoque, Mapa, convites, owner, saldos (refetch sem sinal); Receber, Estoque, Alertas (refetch com erro esconde a lista); Relatórios, Fechamento, Produtos, SKUs, Movimentações, Pedidos legado, lista do agente (filtro volta a "Carregando") | Sinal discreto no refetch; manter a lista anterior apagada (`placeholderData`); erro de refetch não apaga o que já estava na tela | Quem filtra e quem deixa a tela aberta |
| 9 | Pedidos, Receber, Estoque, Alertas, Relatórios, Documentos, Pessoas, legadas, Minhas OS, Comprovante | Um componente só (spinner + rótulo) no lugar do texto seco; skeleton onde a tela tem desenho fixo | Todos, em toda troca de tela |
| 10 | Todos os spinners e skeletons | `Spinner` em uso, `role="status"` ou `aria-hidden`, `aria-label` em pt-BR, `aria-busy` no formulário, `prefers-reduced-motion`; o ícone de alerta sai da validação de saldo | Leitor de tela e regra 1.2 |

## 6. Proposta de implantação (um problema por PR)

1. **Regra escrita e peças.** Uma seção "Carregamento" em
   `docs/sistema-visual.md` (e a linha correspondente em
   `docs/mockups/README.md`): (a) lista ou tela: skeleton onde a tela tem
   desenho fixo (Início, Operações, Contagem, Mapa, Posições, portal) e
   spinner com o rótulo "Carregando…" no resto; (b) ação: botão com spinner
   no lugar do ícone, rótulo no gerúndio, `aria-busy`, largura mantida;
   (c) longa: contagem ou progresso e aviso de demora depois de 10 s;
   (d) sem rede: "Sem sinal"; (e) nunca afirmar vazio, zero ou "produto
   novo" antes da primeira leitura; (f) erro nunca vira vazio;
   (g) reticência "…" única; (h) `prefers-reduced-motion`. As peças:
   `Spinner` com `aria-label="Carregando"` e `motion-reduce`; um bloco
   `Carregando` para listas, fichas e os dois `Suspense`; `Button` com a
   prop `carregando`; `Skeleton` com `aria-busy` e rótulo. A trava de
   textos (`src/test/textos.ts`) continua valendo: "Carregando…" entra na
   lista da tela; o `aria-label` não é texto.
2. **Chegada avulsa, Devoluções e Contagem cíclica.** Esperar
   `lookupQuery` antes de `mustCreate` e de "não localizado", com o mesmo
   "Verificando o catálogo" da abertura; com erro, dizer que o catálogo não
   veio e bloquear o "produto novo".
3. **Erro nunca vira vazio.** Pedidos e Receber ganham `error` próprio (e
   os avisos de Receber, `isLoading`); Exceções, Posições, histórico do item,
   Produtos, Movimentações, Retornos, conversa e Conhecimento do agente idem.
4. **Falsos vazios e zeros.** Painel da abertura, Tabela de preços (e o
   formulário de Cobrança só editável com `config`), cartões do Fechamento,
   Início (SKUs), Estoque (endereço, foto, Parados), Pedidos legado, SKUs,
   Clientes, Faturas do portal, Conhecimento, painel antigo.
5. **Abertura.** Marca e spinner em CSS puro no `index.html`;
   `<Carregando />` no lugar do `null` em `HomeRedirect`, `ProtectedRoute` e
   `RoleGate` e dos `fallback={null}` (Faturamento, Catálogo, painel
   antigo); "Sem sinal" depois de 3 s sem rede.
6. **Botão em ação.** `carregando={...}` nos botões que só apagam (item 5
   da seção 5); em Pedidos, o `busy` por linha, não global.
7. **Diálogos.** `onOpenChange` travado enquanto `isPending`, Cancelar
   desabilitado, `preventDefault` nos quatro `AlertDialogAction`; a janela do
   Evento do portal só fecha depois do retorno.
8. **Operações longas.** Fotos com contagem e `uploadBytesResumable`;
   aviso de que só quatro sobem por vez; Documentos e Conhecimento com
   etapa e tempo limite; Separado e Entrega com etapa; foto por IA com tempo
   decorrido e cancelar; mensagem própria para `deadline-exceeded`.
9. **Atualização.** `placeholderData` nas listas com filtro; sinal discreto
   no refetch automático; erro de refetch não apaga a lista; o "Retomar
   guarda" só gira com operação de verdade; o Avançar só volta depois da
   releitura.
10. **Mecânica.** Os 65 `RefreshCw`/`Loader2` viram `Spinner`; `role`,
    `aria-hidden` e `aria-busy` onde falta; a validação de saldo troca o
    ícone de alerta pelo spinner; os textos de teste atualizam (6 testes do
    WMS travam "Carregando").

Os PRs 1 e 2 vêm antes dos outros; 3 a 10 não dependem entre si.

As telas das propostas estão nos mockups `docs/mockups/WmsCarregando*.dc.html`,
com "Hoje" ao lado da proposta onde a diferença importa (tabela em
`docs/mockups/README.md`, "Carregamento na Armazenagem").

## 7. Decisões do Leonardo (06/11/2026)

As seis perguntas foram respondidas com a recomendação de cada uma:

1. **Listas carregando: spinner com rótulo.** Pedidos, Receber e Estoque
   mostram o spinner com o rótulo no lugar da lista. O skeleton fica só nas
   telas de desenho fixo: Início, Operações, Contagem, Mapa, Posições e o
   portal. A opção B do mockup (`WmsCarregandoPedidosSkeleton`) não entra.
2. **O toast continua o retorno padrão** da Armazenagem depois de uma ação.
3. **Abertura com a marca**: o splash do mockup, em CSS no `index.html`,
   no lugar da tela branca.
4. **Tempos**: o spinner aparece depois de 300 ms, para não piscar na
   resposta rápida, e o aviso de demora, depois de 10 s.
5. **Um ícone só**: o anel com o arco, desenhado no `Spinner`, no lugar do
   `Loader2` e do `RefreshCw` que giram hoje.
6. **Ordem**: a chegada avulsa entra antes de tudo, inclusive da regra
   escrita, no mesmo primeiro PR das cinco correções pequenas: o erro em
   Pedidos, a espera da Tabela de preços, as quatro confirmações que fecham
   antes da resposta (Emitir fatura, Remover item da tabela, Remover
   posição, Apagar rotina), o giro falso do "Retomar guarda" e o zero de
   SKUs no Início. Devoluções e a Contagem cíclica, com o mesmo "não
   localizado", ficam para o PR seguinte, com as peças.

As seis correções do primeiro PR entraram no PR 581, com este diagnóstico e
os mockups:

- a chegada avulsa espera o catálogo (`CatalogoVerificando` e
  `CatalogoIndisponivel`, em `features/warehouse-ops/product-identity.tsx`);
- Pedidos e a Tabela de preços mostram o `ErroNaLeitura`
  (`components/ui/erro-na-leitura.tsx`) no lugar do vazio, e a cobrança só
  salva depois de lida;
- as quatro confirmações usam a `Confirmacao` (`components/ui/confirmacao.tsx`),
  que fecha só no sucesso;
- o "Retomar guarda" gira só com a guarda sendo retomada (`resuming`);
- o Início mostra "—" no total de SKUs enquanto o painel não chega.

O `Spinner` já é o anel (decisão 5). O atraso de 300 ms e o aviso de 10 s
(decisão 4) entram com as peças, no PR seguinte.

## 8. Números do levantamento (só a Armazenagem)

| Medida | Valor |
| --- | --- |
| Arquivos lidos (telas, bancadas, componentes, portal, agente) | 114, 45,6 mil linhas |
| `useQuery` / `useMutation` | 65 / 55 |
| `isPending` / `isLoading` / `isFetching` | 209 / 79 / 40 |
| Botões | 351; 323 `disabled`; 48 mudam o rótulo; 65 giram ícone |
| Ícone girando | `RefreshCw` 36, `Loader2` 25; `Spinner` 0 |
| Texto "Carregando" | 37 lugares |
| `Skeleton` | 42 usos |
| `toast(` | 190 chamadas |
| `role="status"` / `aria-busy` | 24 / 1 |
| Diálogos que fecham durante a ação | 22, mais 4 confirmações que fecham no clique |
| Timeout das callables | 70 s; 180 s na foto de catálogo e no chat |
| Testes do WMS que travam "Carregando" | 6 de 69 |

## 9. No celular (06/11/2026)

Esta seção veio de rodar o app de verdade num Pixel 7 simulado (412 × 839 px),
contra os emuladores locais de `docs/plataforma/ambiente-local.md`: Auth e
Firestore, sem as Functions. A base tinha três usuários de teste (operação,
owner e cliente da BTG) e seis itens de estoque. Cada estado saiu de um jeito:

- o "carregando", de segurar as respostas do Firestore;
- o "sem sinal", de cortar a rede do aparelho;
- a ação em andamento, de segurar e depois recusar as chamadas às Functions.

A leitura do código das telas, com a lente do celular, completou o que as fotos
não mostram (teclado, toque, câmera, volta do segundo plano). As fotos estão em
`docs/plataforma/diagnostico-carregamento/celular/`, e as correções do PR 581
aparecem como estão hoje no código. "Medido" quer dizer que foi visto no app
rodando; o resto foi lido no código, e o que é inferido diz isso.

### 9.1 O que o celular mostra

1. **Sem rede, a lista aparece vazia em vez de dar erro.** São dois caminhos
   para o mesmo "Nenhum pedido…":
   - **Sem rede nenhuma**, o react-query (5.101, `networkMode` padrão) pausa
     a leitura. A tela fica sem `isLoading` e sem erro, e mostra o vazio
     (`pages/pedidos.tsx:494`, `pages/receber.tsx:329`). No portal, o Estoque
     diz "Inventário inicial em andamento" (`pages/client/shared.tsx:475`).
     Lido no pacote instalado.
   - **Com sinal fraco**, o aparelho acha que está conectado, e o Firestore,
     que só tem cache em memória (`lib/firebase.ts`), devolve com sucesso o
     que estiver nessa memória, vazio ou pela metade. Nenhuma das 13 leituras
     de `lib/cloud-api.ts` confere `metadata.fromCache`. Medido sem rede, logo
     depois de entrar: `/api/products` voltou com 0 itens em 4 ms (o servidor
     tem 6), `/api/stock-balances` com 0, e `/api/skus` com os 6 que já
     estavam na memória.

   Nos dois casos, o erro de Pedidos do PR 581 não aparece, porque não há
   erro. Só a faixa "Sem conexão" do shell avisa, e só quando o aparelho sabe
   que está sem rede (`navigator.onLine`).
2. **A ação sem rede trava ou diz "Falha interna no servidor"** (foto 04).
   - Sem rede nenhuma, a gravação fica pausada em "Registrando..." até a rede
     voltar, e aí sai sozinha, minutos depois, sem aviso. A faixa do portal diz
     que "movimentações permanecem bloqueadas"
     (`components/layout/app-layout.tsx:462`), mas nada bloqueia.
   - Com sinal fraco, a chamada que não alcança o servidor volta com o código
     `internal`, e `lib/functions-api.ts:1050` traduz para "Falha interna no
     servidor. Tente novamente ou avise o time técnico." (medido). Se a rede
     só demora, a chamada desiste em 70 s com `deadline-exceeded`.
   - Em Pedidos, o toast de erro mostra o JSON cru da resposta, porque
     `humanApiError` não lê o corpo que `fetchJson` põe na mensagem
     (`lib/permissions.ts:73`).
3. **A tela que ainda não foi aberta quebra sem rede** (foto 05). O service
   worker guarda só o shell, e cada tela entra no cache na primeira visita
   (`vite.config.ts`, `runtimeCaching`). Como todo deploy troca o nome dos
   arquivos, isso vale para toda tela ainda não aberta desde a última
   publicação. Sem sinal, ela cai em "Nao foi possivel carregar esta tela.
   Uma nova versao pode ter sido publicada.", assim, sem acentos (medido).
   "Recarregar", sem rede, não resolve. O mesmo `ChunkErrorBoundary`
   (`App.tsx:50`) pega qualquer erro de tela, não só o de arquivo, e dá a
   mesma frase para todos. Depois de um deploy, nada avisa nem recarrega.
4. **A abertura fica em branco** (foto 01, medido), na operação e no portal:
   até o perfil chegar, a tela não mostra nada. Sem perfil guardado e sem
   sinal, fica assim até a rede voltar. A folha do Google Fonts no
   `index.html` não está em cache e segura a primeira pintura com sinal fraco.
5. **A leitura do armazém pesa no 4G.** O `/api/warehouse/ops` traz até cerca
   de 9.900 documentos de 12 coleções (`lib/cloud-api.ts:184`, `:1545`). O
   shell da Armazenagem relê essa leitura a cada 60 s em qualquer tela, para os
   contadores do menu, que a barra do celular nem mostra
   (`components/layout/wms-layout.tsx:36`). Como a chave é a mesma, o
   "Atualizar" de Pedidos e de Receber gira e desliga sozinho a cada
   releitura. O "Confirmar separação" faz até quatro chamadas e duas dessas
   leituras debaixo de um único "Registrando..." (`pages/pedidos.tsx:388`).
6. **Na volta de outro app, nada relê na hora.** `refetchOnWindowFocus` está
   desligado (`lib/queryClient.ts:6`), e o intervalo parado em segundo plano só
   roda no próximo tique: até 60 s em Pedidos e Receber, de 120 a 300 s no
   Estoque. O `realtime-sync` atualiza Pedidos e Receber quando o Firestore
   reconecta, mas não o Estoque. Nenhuma tela v3 diz "atualizado às".
7. **A ação em andamento apaga a tela inteira** (foto 03, medido). Em
   Posições, durante a gravação, todos os botões esmaecem por igual, sem
   spinner nem rótulo, e o botão tocado não se distingue dos outros.
8. **O toast cobre o cabeçalho** (foto 04, medido). No celular ele aparece no
   topo (`components/ui/toast.tsx:16`, `fixed top-0`) por 5 s, por cima do
   seletor de módulo e do cliente ativo, e essa faixa não aceita toque
   enquanto ele está lá. O X só aparece no hover, então não existe no toque;
   dá para deslizar para a direita.
9. **O diálogo longo esconde a ação, e o teclado esconde mais** (fotos 06 e
   07). Na chegada avulsa, o "Criar conferência" fica no fim da rolagem, uns
   500 px abaixo da tela (medido), e o diálogo cobre a faixa "Sem conexão".
   Sem rede, a linha fica em "Verificando o catálogo" por mais de 30 s
   (medido), sem dizer que o problema é a conexão; o cadastro novo continua
   bloqueado, que é o que importa. O Separado foca o lacre ao abrir
   (`features/warehouse-ops/separado.tsx:100`), e no Android o teclado cobre o
   "Confirmar separação" (inferido). Só o detalhe do produto no portal tem o
   rodapé sempre à vista. A ficha do item, abaixo de 1024 px, abre num painel
   com um X de cerca de 16 px.
10. **As fotos sobem no tamanho original.** A câmera abre direto
    (`capture="environment"`) na chegada avulsa, na Contagem e na ficha do
    item, e a foto vai inteira para o Storage, sem compactar, por um envio que
    não informa progresso (`uploadBytes`, `features/warehouse-ops/shared.ts`).
    O SDK tenta de novo por até 10 min. A compactação já existe no app
    (`lib/attachment-compact.ts`), mas só serve o anexo do Agent Dute e o aviso
    de envio do portal. Uma foto de celular tem de 2 a 5 MB; no 4G do galpão,
    cada uma leva dezenas de segundos só com "Enviando..." (estimado). Os
    Documentos mandam até 20 MB em base64 por uma chamada que desiste em 70 s.
11. **Não há trava contra toque duplo na Armazenagem.** O Campo tem a dele
    (`lib/campo/toque-unico.ts`, 1 s), e nenhuma tela da Armazenagem a usa.
    No celular, o toque sem retorno visual se repete, e há brechas:
    - a guarda da caixa gera uma chave de idempotência nova a cada toque
      (`features/warehouse-ops/guarda-da-caixa.tsx:199`, `:232`, `:238`);
    - a exceção da tarefa vai sem chave (`features/warehouse-ops/task-actions.tsx:81`);
    - em Pedidos, o botão volta ativo antes de a lista se reler;
    - no portal, "Avisar reposição" e "Arquivar" nos cards não desligam
      (`pages/client/estoque.tsx:1526`, `:1807`).

    O que o servidor faz com o segundo envio não foi conferido.
12. **Não há puxar para atualizar, e o Atualizar é pequeno.** A área de
    conteúdo usa `overscroll-behavior: contain` (medido), o que desliga o
    gesto. O Atualizar só existe em Pedidos, Receber e Solicitações, e mede
    40 × 40 px (medido), abaixo dos 44 px da regra 1.2 do plano de
    implantação. Estoque, Mapa e o portal não têm o botão.
13. **O "carregando" é um texto pequeno no topo** (foto 02, medido), e o resto
    da tela parece vazio. O spinner com rótulo já foi decidido (decisão 1) e
    entra com as peças. No portal, o botão flutuante "Pedido · N itens"
    (`pages/client/estoque.tsx:906`) fica por cima da barra de baixo.

No WMS, nada fica escondido atrás da barra de baixo nem do cabeçalho: os dois
ficam no fluxo da página, e o conteúdo rola entre eles.

### 9.2 Necessidades no celular, em ordem de dor

| # | O que falta | Onde | Quem sente |
| --- | --- | --- | --- |
| 1 | Sem rede, a leitura vira "Sem conexão" e nunca lista vazia: a leitura pausada pelo react-query e a que veio só do cache do Firestore aparecem como falta de conexão, no `ErroNaLeitura` | Todas as listas e fichas | A operação no galpão |
| 2 | A ação sem rede tem resposta clara: é recusada na hora com "Sem conexão" (decisão 1). Com sinal fraco, "Sem conexão. Tente de novo quando o sinal voltar." no lugar de "Falha interna no servidor"; o toast sem JSON cru | Toda gravação | Todos |
| 3 | As telas da operação abrem sem sinal: depois de entrar, os papéis internos guardam no cache as telas que usam. O `ChunkErrorBoundary` diz "Sem conexão" quando for isso, separa erro de arquivo de erro de tela e ganha os acentos | Toda tela depois de um deploy | A operação |
| 4 | As fotos sobem compactadas, com a contagem e o progresso | Chegada avulsa, Contagem, ficha do item | Quem recebe e quem conta |
| 5 | A trava contra toque duplo, com a chave de idempotência por tentativa na guarda da caixa e na exceção | Ações | A operação |
| 6 | A leitura do armazém mais leve no celular: o shell não relê a cada 60 s o que a barra não mostra, e o Separado não lê duas vezes | Todas as telas da Armazenagem | Quem usa 4G |
| 7 | A volta do segundo plano relê as listas abertas e diz "atualizado às" | Pedidos, Receber, Estoque | A operação |
| 8 | A abertura com a marca e o spinner (decisão 3), "Sem conexão" depois de 3 s sem rede, e a fonte que não segura a primeira pintura | Abertura | Todos |
| 9 | No celular, o rodapé do diálogo longo fica preso embaixo, acima do teclado, com o "Sem conexão" dentro do diálogo; o X do painel com 44 px | Chegada avulsa, Separado, ficha do item | Quem recebe e quem separa |
| 10 | Só o botão da ação gira e diz o gerúndio; o resto da tela não apaga | Posições e as ações da seção 4 | A operação |
| 11 | O toast longe do cabeçalho, com um jeito de fechar no toque | Toda ação | Todos |
| 12 | Botão de ícone com 44 px no celular, e o Atualizar onde a operação precisa (decisão 5) | Pedidos, Receber, Estoque | A operação |

### 9.3 Proposta para o celular

Os itens 8, 10, 11 e o tamanho do botão (item 12) entram no PR das peças, que
já estava decidido. O restante vira cinco PRs, um problema por PR:

1. **Sem conexão na leitura e na ação** (itens 1 e 2). A leitura pausada ou
   vinda só do cache, com o aparelho sem rede, vira erro de conexão, e a ação
   é recusada na hora (decisão 1). A falha de rede da chamada vira "Sem conexão", e o
   toast de Pedidos para de mostrar o JSON.
2. **Telas da operação sem sinal** (item 3). Depois de entrar, os papéis
   internos aquecem o cache das telas que usam, e o `ChunkErrorBoundary`
   distingue falta de rede, versão nova e erro de tela.
3. **Fotos do celular** (item 4). A foto passa pela compactação que o app já
   tem, e o envio mostra a contagem e o progresso (`uploadBytesResumable`).
4. **Ação no celular** (itens 5 e 9). A trava de toque duplo, as chaves por
   tentativa, o rodapé preso nos diálogos longos e o X de 44 px.
5. **Leitura leve e volta do segundo plano** (itens 6 e 7). O shell sem a
   releitura de 60 s no celular, o Separado com uma leitura só, e a releitura
   na volta ao app com o "atualizado às".

O PR 1 vem antes dos outros. Sem ele, o erro de Pedidos e a espera da chegada
avulsa do PR 581 não aparecem no celular sem sinal, porque a leitura não
falha.

### 9.4 Decisões do Leonardo (06/11/2026)

As cinco perguntas do celular foram respondidas com a recomendação de cada
uma:

1. **Ação sem rede: recusada na hora**, com "Sem conexão", em vez de ficar
   numa fila. É simples e honesto; a fila do Campo pode vir depois, para a
   guarda, se a operação pedir.
2. **Lista sem sinal: o que já estava fica**, marcado com "Sem conexão ·
   lista de 10:42". O aviso no lugar da lista só aparece quando ainda não há
   nada lido.
3. **As telas da operação ficam no aparelho**: depois de entrar, os papéis
   internos guardam as telas que usam, para abrirem sem sinal. O custo é
   baixar alguns MB a cada publicação.
4. **A foto do celular é compactada** para 2000 px no lado maior, como o
   anexo do Agent Dute: a foto do catálogo continua nítida nesse tamanho.
5. **No celular, o toast vai para baixo**, perto do polegar, acima da barra
   de navegação. **No lugar de puxar para atualizar fica o botão Atualizar**
   com 44 px, levado também ao Estoque, porque o gesto conflita com a rolagem
   das listas longas.

O PR 1 do celular (sem conexão na leitura e na ação) entrou no PR 582, com
este diagnóstico:

- a leitura de `lib/cloud-api.ts` que só achou o cache da memória responde
  503 com o código `sem_conexao`; a contagem, o agregado e o índice de
  preços sem rede não viram zero nem vazio (`lib/conexao.ts`);
- o react-query não pausa a leitura nem a ação sem rede (`networkMode:
  "always"` em `lib/queryClient.ts`); a fila do Campo não passa por ali;
- a ação sem rede é recusada na hora, e a chamada sem resposta diz "Sem
  conexão. Tente de novo quando o sinal voltar." no lugar de "Falha interna
  no servidor": em `lib/functions-api.ts`, na chegada por caixa, na guarda da
  área, no cancelamento do recebimento e nas chamadas do núcleo (o Agent
  Dute e a memória);
- o toast mostra a mensagem do servidor, não o JSON: `lib/erro-da-resposta.ts`
  nos `fetchJson` da Armazenagem que guardavam o corpo cru, e o
  `humanApiError`;
- Pedidos, Receber, Estoque, Estoque › Alertas, Mapa, Solicitações, o
  Início e o painel do owner mantêm a lista lida, com "Sem conexão · lista
  de 10:42" (`FaixaSemConexao`), e, sem nada lido, mostram o aviso "Sem
  conexão." (`BlocoSemConexao`), os dois em
  `components/ui/erro-na-leitura.tsx`. O Início sem nada lido não diz que
  nada espera nem mostra os números zerados, e o portal não troca o que já
  estava por "Portal indisponível".

Ficam para depois:

- as leituras que vão ao Firestore sem passar por `lib/cloud-api.ts` (o
  seletor de cliente, Pessoas, as anotações e os playbooks do Agent Dute),
  que sem rede ainda devolvem o cache;
- o `deadline-exceeded` de 70 s, que fica com a mensagem própria das
  operações longas (seção 6, PR 8);
- os PRs 2 a 5 do celular.

O PR 2 do celular (as telas da operação sem sinal) entrou no PR 610, com a
parte 9 do carregamento v2 (10.5). Depois de entrar, a equipe guarda no
aparelho os arquivos das telas que pode abrir, uma vez por versão, e o
`ChunkErrorBoundary` separa a falta de rede, a versão nova e o erro da tela.
Ficam para depois os PRs 3 a 5.

## 10. Carregamento v2 (12/11/2026)

### 10.1 A queixa

Em 12/11/2026, depois de ver as primeiras correções na produção, o Leonardo
disse: "O problema não é só não aparecer… mas sim aparecer assim de forma
simples… com texto e … no final… Eu quero algo mais bonito… tanta coisa legal
acontecendo hoje em UI design, e o nosso sistema tem esses spinner mega
simples… Às vezes nem dá pra ver o spinner escrito carregando…".

O app rodando, com a leitura atrasada em 3 s e as ações seguradas por 6 s,
confirmou a queixa:

- a abertura fica 100% em branco até o perfil chegar;
- as listas mostram só o texto cinza "Carregando pedidos..." no canto;
- dos cerca de 263 botões de ação com espera, 174 só ficam a 50% de opacidade,
  sem ícone nem rótulo. Em Pedidos, aprovar uma linha apaga os botões das três
  linhas, e em Posições os cinco botões apagam;
- o anel aprovado em 06/11 (16 px, cinza, trilho a 20%) só está em 9 deles;
- o esqueleto é vermelho a 10% e fica rosado.

O PR 581 parou nas seis primeiras correções, e as peças que levariam o
indicador ao app inteiro (seção 6, PR 1) não foram feitas.

O mesmo levantamento achou uma regressão do PR 582. Quando o Firestore
demorava mais de 10 s para voltar depois de uma queda curta, a leitura vinha
do cache, e a tela dizia "Sem conexão." com o aparelho conectado. Ela não se
refazia sozinha até a próxima releitura. A parte 7 corrigiu (7a, registro em
10.5): com o aparelho conectado, a tela diz "Reconectando…" e relê sozinha em
2, 4, 8, 16 e 30 s, sem mexer no que está na tela, e se refaz assim que o
servidor responde. "Sem conexão" fica para o aparelho sem rede há 3 s.

### 10.2 As três direções e a avaliação

Três direções foram desenhadas com os mesmos nove momentos:

- **A · Marca em movimento:** a caixa chanfrada do "D", com sucesso em verde;
- **B · Silêncio premium:** esqueleto fiel e texto com brilho;
- **C · Galpão em primeiro lugar:** linha de estado, barra grossa na linha e
  contagens grandes.

Três lentes as avaliaram, e a soma foi ponderada em design 40%, acessibilidade
e operação 35% e engenharia 25%:

| Direção | Design | Acessibilidade e operação | Engenharia | Total |
| --- | --- | --- | --- | --- |
| C | 6,92 | 7,40 | 7,60 | 7,26 |
| A | 8,00 | 6,40 | 5,20 | 6,74 |
| B | 6,25 | 6,00 | 5,20 | 5,90 |

A recomendada é a C com a caixa chanfrada da A, em tinta, refeita só com
`transform` (a máscara parada e o gradiente cônico girando), mais os
acabamentos da B. As pranchas das três direções e da recomendada estão no
canvas "Carregamento v2 · Dutelog". As da recomendada também estão em
`docs/mockups/WmsCarregandoV2*.dc.html`.

### 10.3 Decisões do Leonardo (12/11/2026)

Todas aprovadas "como recomendado":

1. **Direção:** a recomendada (C com a caixa da A e os acabamentos da B).
2. **Indicador:** a caixa chanfrada em tinta. Substitui o anel da decisão 5 de
   06/11. Se não passar no aceite num Android médio, o mesmo `Spinner` volta a
   um anel grosso, com a mesma API.
3. **Listas na primeira leitura:** a forma final, com os títulos reais, a
   contagem em bloco, as linhas-fantasma e a linha de estado "Carregando
   pedidos…". Substitui a decisão 1 de 06/11.
4. **Abertura:** preta, com os PNG reais da marca e da palavra e o trilho
   chanfrado, sem texto na primeira pintura. Ajusta a decisão 3.
5. **"Atualizado às 10:42"** sempre sob o título das listas, no mesmo lugar
   de "Carregando…", "Reconectando…" e "Sem conexão".
6. **Reticência:** continua ("Carregando pedidos…", "Aprovando…").
7. **Sucesso:** festa média. A onda verde nasce da caixa e cobre o botão, o
   check entra com mola e tudo dura cerca de meio segundo.

Ficam como estavam: o toast como retorno padrão (decisão 2), os 300 ms e os
10 s (decisão 4) e as decisões do celular de 06/11.

Em 13/11/2026, durante a parte 6, o Leonardo decidiu que o pedido aprovado
entra em Para separar na posição da fila do servidor, e não no topo, como
dizia o momento 4.

### 10.4 Implantação

A especificação (o relógio, os tokens, as peças, os nove momentos, a
acessibilidade e o aceite) segue o desenho das pranchas, e a regra curta está
em `docs/sistema-visual.md`, seção "Carregamento". O plano é este, um problema
por PR:

| Parte | O que é | Situação |
| --- | --- | --- |
| 1 | O relógio da espera (`lib/carregando`), os tokens e keyframes `--carregando-*` e o `Anunciador` | PR 610 |
| 2 | A caixa chanfrada no `Spinner` | PR 610 |
| 3 | O esqueleto neutro (`Esqueleto`, `CartaoComBrilho` e o `Skeleton` sem rosado) | PR 610 |
| 4 | O `BotaoDeAcao` | PR 610 |
| 5 | O toast embaixo no celular | PR 610 |
| 6 | Pedidos como piloto: a ação por linha (`useAcaoNaLinha`), a barra da linha e os estados de 10 s e 70 s | PR 610 |
| 7 | A conexão (7a: "Reconectando…" com histerese e a releitura sozinha) e a linha de estado nas listas (7b: Pedidos, Receber, Estoque, Alertas) | 7a no PR 610; 7b a fazer |
| 8 | As listas com a forma final | a fazer |
| 9 | A abertura com a marca e a `CarregandoTela` no lugar do branco | PR 610 |
| 10 | A troca de filtro e a releitura sem apagar a lista | a fazer |
| 11 | As operações longas: fotos com progresso e etapas | PR 610 |
| 12 | A trilha do Agent Dute | a fazer |
| 13 | A migração por área e a trava (`animate-spin` só no `Spinner`) | a fazer |

Pequenas escolhas das pranchas que esperam confirmação, sem bloquear o código:

- o selo "Sem confirmação" em âmbar, porque é resultado desconhecido e não erro;
- o esqueleto fora da v3 (o portal) em `#D9DDE3`;
- o piso do violeta do Agent Dute no movimento reduzido (0,75 no claro e 0,85
  no escuro, para manter 3:1);
- a foto que fica 70 s sem um byte novo é cancelada e vira "Foto 2 não
  enviada", com o "Tentar de novo", e não "Sem confirmação do servidor" com
  "Conferir", como no cartão "Quando demora · escrita" da prancha: o envio
  cancelado não tem o que conferir. A dúvida só existe na callable que vem
  depois do último byte, e ela diz "Confira antes de tentar de novo".

### 10.5 Registro das partes

**Parte 6, Pedidos como piloto (PR 610, 13/11/2026).**

- **A ação por linha** (`lib/carregando/use-acao-na-linha.ts`):
  - cada linha tem o próprio estado, e o segundo toque é barrado antes de a
    tela redesenhar;
  - a chave de idempotência é por tentativa. Ela se repete depois do
    "Conferir" e da falta de conexão, e só é trocada quando o servidor recusa;
  - aos 70 s, ou no `deadline-exceeded`, a linha mostra o "Sem confirmação" e
    o "Conferir", que relê e nunca reenvia.
- **A barra da linha** (`components/ui/barra-de-espera.tsx`).
- **"Para aprovar"** com o `BotaoDeAcao`, o objeto aos 3 s e a demora aos
  10 s, no lugar do `busy` global.
- **A saída sem salto**, com o `useListaSemSaltos` e o palco
  (`lib/carregando/palco-sem-saltos.ts`):
  - a linha que sai esmaece, e o cartão, os títulos e os grupos de baixo
    refluem juntos, só por `transform`;
  - o cartão se desenha em três pedaços, como na prancha;
  - a regra do dedo vale para a tela inteira;
  - o foco vai para a linha seguinte ou para o título do grupo, com o anel
    visível;
  - o realce vem só na linha que chegou por uma ação desta tela;
  - Para separar e Para entregar usam o mesmo hook.
- **Medição no Chromium:**
  - antes, 9 peças pulavam num quadro só, até 215 px, e a linha de baixo ficava
    cortada pelo cartão em 20 quadros;
  - depois, nada passa da curva de 240 ms, e nenhuma linha fica cortada, no
    claro e no escuro;
  - no movimento reduzido, tudo pula para o lugar, como manda a especificação.

Ficam para a parte 13 os diálogos de Pedidos que desabilitam o botão enquanto
gravam ("Confirmar entrega" e "Cancelar pedido"). Fica para uma correção do
sistema visual o anel de foco do `Button`, que o título copia: 1,91:1 no claro
e 1,65:1 no escuro.

**Parte 7a, a conexão (PR 610, 13/11/2026).** Corrige a regressão do PR 582
registrada em 10.1.

- **A causa, confirmada no Chromium com os emuladores:** o `getDocs` e o
  `getDoc` de `lib/cloud-api.ts` tratavam toda leitura do cache como "Sem
  conexão". Com o host do Firestore recusado, o SDK se deu por offline aos
  15 s e respondeu do cache com o aparelho conectado: Pedidos disse "Sem
  conexão · lista de 02:03" por 58,5 s e só se refez 50 s depois da volta,
  na releitura de 60 s. Com `context.setOffline` por 20 s, o
  `refetchOnReconnect` releu cedo demais, ainda do cache, e o aviso ficou
  até o fim da observação (40 s depois da volta); numa queda de 1,5 s, o
  "Sem conexão" entrou em 0,36 s e também ficou.
- **As duas faltas** (`lib/conexao.ts`): o aparelho sem rede é "Sem conexão"
  (`sem_conexao`); conectado, o cache, o `unavailable` e a callable sem
  resposta (o `internal`/`internal`) são o servidor sem resposta
  (`sem_resposta`, "Sem resposta do servidor."). A ação sem rede continua
  recusada na hora, e o resultado incerto da `useAcaoNaLinha` não muda: a
  repetição leva a mesma chave.
- **O estado único** (`lib/carregando/estado-da-conexao.ts`), ligado ao
  react-query no `main.tsx`: "Reconectando" com o aparelho conectado; "Sem
  conexão" depois de 3 s sem rede ou de duas leituras seguidas sem resposta
  sem rede; cada aviso fica pelo menos 2 s. Só sai depois que uma leitura que
  tinha ficado sem resposta dá certo: a leitura do cache do Firestore feita
  fora do `lib/cloud-api.ts` (os clientes do seletor, os convites) dá certo
  sem o servidor e não conta. Enquanto reconecta, relê sozinho em 2, 4, 8, 16
  e 30 s; relê também quando a rede ou o servidor voltam. Sem nada com a falta
  na tela, a releitura para, e a próxima falta recomeça dos 2 s. Os tempos
  novos são tokens `--carregando-t-*` e constantes de `CARREGANDO`, travados
  um contra o outro.
- **A releitura sozinha não mexe na tela** (momento 7): ela chama a leitura
  sem passar pelo estado do react-query, que punha a leitura sem dado de volta
  em "carregando" e a com dado em `isFetching`. Na tela ainda não lida, o
  bloco "Reconectando…" e o foco do teclado nele ficam; na lista lida, o
  Atualizar não gira nem se desabilita; o alerta da falha não é dito de novo a
  cada volta. O dado que chega entra direto, sem passar por "carregando", e
  espera o dedo (nada muda se houve toque nos últimos 700 ms, até 3 s). Se o
  servidor responde com outro erro, a leitura de verdade mostra qual. A
  leitura paginada (`useInfiniteQuery`) continua relendo de verdade.
- **O SDK do Firestore acordado:** depois de uma falha, o SDK só tenta o
  servidor no relógio dele, que cresce até 60 s, e até lá responde do cache;
  a releitura e o "Tentar de novo" não alcançavam o servidor. Antes de reler,
  sozinho ou pelo toque, o app desliga e religa a rede do SDK, o que ele mesmo
  faz quando o aparelho volta à rede, e só quando a última leitura achou só o
  cache e o aparelho tem rede (`acordarFirestore`). Enquanto o SDK está
  offline, o app escuta o próprio perfil, que o login já escuta, e relê na
  hora em que ele chega do servidor (`aoVoltarOFirestore`).
- **As telas:** o `FaixaSemConexao` e o `BlocoSemConexao` dizem
  "Reconectando…", em tinta e com os arcos do Wi-Fi, quando não é falta de
  rede, e "Sem conexão" só com o app sem conexão, na pílula com o
  `--carregando-aviso` (6,2:1). A faixa "Sem conexão" do shell (os módulos, a
  Configuração e o portal) segue o mesmo estado: só entra depois de 3 s sem
  rede, e nunca com o aparelho conectado. Nenhuma faixa nem o bloco é região
  viva: o `Anunciador` diz "Sem conexão" uma vez, ao entrar, e não fala
  "Reconectando" nem a volta. O "Tentando de novo…" entra no relógio da
  espera (300 ms, mínimo de 500 ms), e a trava do toque segue o que o botão
  diz: `aria-disabled` e travado juntos, nunca `disabled`. O "Tentar de novo"
  do bloco e do `ErroNaLeitura` tem 44 px de altura.
- **Medição no Chromium**, com o app de verdade, os emuladores e o seed
  fictício; antes é o primeiro commit desta parte, e depois, com a correção:
  - Estoque nunca lido, com o host do Firestore recusado, por 40 s: antes, o
    bloco "Reconectando…" saía e dava lugar a "Carregando estoque..." aos
    2,4 s e aos 18,4 s; depois, ficou parado de 0,4 s a 40 s.
  - O foco do teclado, por 40 s de releituras sozinhas: antes, caiu no
    `body` aos 1,1 s ("Tentar de novo" do bloco do Estoque) e aos 1,8 s
    (Atualizar de Pedidos); depois, ficou nos dois.
  - Configuração › Clientes nunca lida, por 75 s: antes, o alerta "Sem
    resposta do servidor." entrou seis vezes; depois, uma.
  - A volta do servidor depois de 40 s fora: tocando em "Tentar de novo" a
    cada segundo, a faixa saiu 10,5 s depois da volta, antes, e 1,0 s depois,
    com a correção; sem tocar, 33,2 s antes e 2,0 s e 3,0 s depois. Numa queda
    de 15 s, sem tocar, 6,0 s antes e 1,0 s depois.
  - A queda de 1,5 s da rede do aparelho: antes, a faixa do shell dizia "Sem
    conexão" de 20 ms a 1,5 s, ao mesmo tempo que a lista dizia
    "Reconectando…"; depois, nenhum "Sem conexão", e a lista se refez 0,16 s
    depois da volta. Sem rede por 6 s, a faixa do shell e a pílula entram
    juntas aos 3,0 s e saem na volta; a lista se refaz em 0,15 s (antes,
    2,1 s).
  - A regra do dedo na saída da faixa: com toques a cada 150 ms que param
    antes de o dado chegar, a faixa saiu 0,73 s depois do último toque; com
    toques seguidos, no limite de 3 s.
  - A pílula "Sem conexão" tem 6,18:1 no claro e 10,66:1 no escuro, e o
    botão do bloco, 44 px no computador e no celular. O axe-core não acusa
    nada na faixa nem no bloco, no claro, no escuro e no celular.

Fica aberto, para a parte 7b e depois:

- a linha de estado, com altura reservada, o "Atualizado às", as medidas da
  prancha (a linha de 24 px e os arcos de 20 px) e a troca do texto em
  sequência; até lá, a faixa que sai ainda sobe a lista 74 px de uma vez
  (agora esperando o dedo);
- o Atualizar de Pedidos, Receber e Solicitações ainda fica `disabled` e gira
  na releitura de 60 s do intervalo, e a tela nunca lida de Pedidos ainda
  passa por "Carregando…" nesse intervalo e na volta da rede, que o
  `refetchOnReconnect` relê de verdade. O toque no "Tentar de novo" do bloco
  também troca o bloco pelo carregando;
- as callables chamadas fora do react-query (`lib/wms`, o agente e a memória)
  não alimentam o estado da conexão, e só o Firestore lido pelo
  `lib/cloud-api.ts` é acordado: a callable sem resposta segue a releitura de
  2 a 30 s;
- as telas que mostram a falta no `ErroNaLeitura` genérico (como a
  Configuração › Clientes) seguem com o alerta, e sem rede ele diz "Sem
  conexão" junto com o `Anunciador`;
- o axe-core acusa, desde antes desta parte, o contraste do "há N min" das
  linhas de Pedidos, o `aria-controls` das abas do Estoque e, no escuro, uma
  camada do `BotaoDeAcao`;
- a conferência num Android de verdade, com a rede caindo de fato.

**Parte 9, a abertura (PR 610, 13/11/2026).**

- **A abertura** (`#abertura` no `index.html`, fora do `#root`):
  - preta (#161616) nos dois temas, com a marca de 96 px, o trilho chanfrado
    e a palavra a 48 px do pé, e nenhum texto visível;
  - a marca e a palavra vêm embutidas no HTML, já sobre o preto e com a
    paleta reduzida (cerca de 12 KB no HTML): estão na primeira pintura também no
    primeiro acesso com sinal fraco, e o trilho entra 300 ms depois delas;
  - o `role="status"` diz "Abrindo a Dutelog" só ao leitor de tela; sem rede,
    "Sem conexão" aos 3 s; aos 10 s, "Demorando mais que o normal" e "Tentar
    de novo", que recarrega; aos 70 s, "Sem resposta";
  - o aviso que sai sobe e esmaece em 180 ms antes de o seguinte entrar, e a
    região muda no máximo uma vez a cada 2 s, como o `Anunciador`;
  - quando o aviso não cabe acima da palavra (o celular deitado, o zoom de
    200%), a palavra cede o lugar;
  - no alto contraste do Windows, ela mantém as próprias cores;
  - enquanto ela cobre a tela, o `#root` fica inerte: nem o Tab nem o leitor
    de tela chegam ao que está por baixo.
- **A saída** (`fecharAbertura`, em `lib/abertura.ts`, chamada pelo
  `AuthProvider` quando o perfil chega): o segmento completa o trilho em
  200 ms e tudo esmaece em 260 ms, com a marca a 0,96; antes de 300 ms ou
  com movimento reduzido, só esmaece. A barra do navegador troca para o tema
  quando a abertura sai do documento, e não antes.
- **A primeira pintura:** a Inter e a JetBrains Mono saíram; a Manrope chega
  por preload com `swap`, e o service worker guarda as fontes do Google; o
  registro do service worker usa `defer`; a folha do app vai para o corpo,
  logo antes do `#root`; o `theme-color` e o manifest estão em #161616.
- **A `CarregandoTela`** (`components/ui/carregando-tela.tsx`), no lugar do
  "Carregando..." dos dois `Suspense`, dos `fallback={null}` e do `null` das
  rotas que esperam o perfil:
  - aos 300 ms, a caixa de 40 px e "Abrindo Faturamento…"; o nome que não é
    substantivo vem com "a tela" ("Abrindo a tela Separar…"), e toda rota
    tem nome;
  - aos 10 s, a volta calma, "Demorando mais que o normal" e "Tentar de
    novo"; aos 70 s, "Sem resposta do servidor."; tentar de novo recarrega o
    app;
  - nada aparece nem é anunciado enquanto a abertura está na tela, também
    enquanto esmaece;
  - a fronteira que confere o arquivo que não veio segue com o mesmo nome e
    o mesmo relógio, sem anunciar de novo.
- **As telas da equipe no aparelho** (`lib/telas-no-aparelho.ts`, o PR 2 do
  celular):
  - cada tela é declarada com o arquivo do próprio import
    (`telaSobDemanda("pages/billing-hub", …)`), e o build publica o mapa
    `telas-no-aparelho.json`, com os arquivos de cada tela e as telas de
    dentro dela (as abas do Faturamento);
  - cinco segundos depois de entrar, os papéis internos baixam, um por vez,
    os arquivos das telas que abrem neste ambiente; o service worker os
    guarda em `dute-route-chunks`, que passou a caber 400 arquivos;
  - a guarda só baixa e nunca importa a tela: o import que falha numa
    piscada da rede fica preso no mapa de módulos do navegador até a página
    recarregar, e a tela aberta depois cairia em "Sem conexão." sem pedir o
    arquivo de novo;
  - a tela que abre larga o pedido que a guarda estava fazendo, e o arquivo
    parado não segura a tela;
  - o cliente não baixa nada.
- **O `ChunkErrorBoundary`** separa a falta de rede, a versão nova (o
  arquivo que sumiu no deploy) e o erro da própria tela. No Safari, que não
  diz qual arquivo faltou, ele pergunta pelo próprio app: se o servidor
  responde, é a versão nova; se não, é a falta de rede.
- **Medição no Chromium** (build de produção com o Firebase trocado, Slow 4G
  e CPU 4×, celular):
  - na primeira visita, a primeira pintura caiu de cerca de 2,75 s para
    0,65 s, já com a marca e a palavra, e o trilho entra 300 ms depois delas;
  - na volta, a primeira pintura fica perto de 0,13 s, e o Início abre em
    cerca de 1 s;
  - com uma piscada da rede durante a guarda, o Mapa, o Receber e a Contagem
    abrem com a rede de volta; com o pedido da guarda parado, o Mapa abre em
    0,3 s;
  - na produção, só com a Armazenagem, a guarda baixa 106 arquivos (916 KB)
    para a operação, 66 (315 KB) para o financeiro e 138 (1,2 MB) para o
    owner;
  - nenhum quadro com a `CarregandoTela` por baixo da abertura que esmaece.

Mudanças de configuração para conferir na homologação: o registro do service
worker com `defer` (`injectRegister: "script-defer"`), a folha do app no
corpo, o mapa `telas-no-aparelho.json` na raiz do build, o cache das rotas com
400 arquivos, as fontes do Google no service worker e o manifest em #161616.
Se a CSP ganhar `script-src`, o script da abertura e o `onload` do preload
das fontes vão precisar de hash.

Ficam para depois:

- a casca com o esqueleto do Início logo depois da abertura: quando o
  arquivo da Entrada ainda não está no aparelho, a espera é a
  `CarregandoTela`;
- entre a espera da rota e a de dentro da tela (as abas do Catálogo e do
  Faturamento), ou entre o `RoleGate` e o `Suspense`, o rótulo some por até
  300 ms e volta, porque o relógio recomeça;
- a medição num Android de verdade e no Safari, que pode tratar a folha no
  corpo de outro jeito.

**Parte 11, as operações longas (PR 610, 13/11/2026).** É também o PR 3 do
celular (as fotos) e o item 8 da seção 6.

- **As fotos do celular** (`lib/envio-de-fotos.ts`, `useEnvioDeFotos`):
  - compactadas a 2000 px no lado maior (decisão 4 do celular), em JPEG,
    antes de pedir o destino; a foto pequena e leve sobe como veio, e a que
    o navegador não abre também. Um teste confere, no Receber, na Contagem,
    na ficha do item, na OS, no campo e no anexo do portal, que o que vai ao
    Storage é a compactada;
  - sobem pelo `uploadBytesResumable`, uma por vez, na ordem da escolha; a
    barra anda por evento de bytes e a contagem, por foto. A foto de até
    256 KB vai numa requisição só, sem evento no meio: ela gira, em vez de
    encher, até chegar;
  - a que falha fica "Foto 3 não enviada", com o próprio "Tentar de novo", e
    não derruba as outras (o `Promise.all` perdia as que já tinham subido).
    A que passa 70 s sem um byte novo é cancelada e fica do mesmo jeito; o
    prazo para no último byte, e o que vem depois (o endereço da foto, a
    callable da OS) tem o prazo e a mensagem dele;
  - no Receber, na Contagem e na ficha do item, a escolha leva 4 de cada vez,
    como antes, mas diz "Só 4 fotos sobem por vez." (e "Até 8 fotos por
    produto.") no lugar do corte calado, na tela e pelo Anunciador;
  - o diálogo da chegada avulsa e a ficha do item não fecham enquanto elas
    sobem. O campo e o botão de escolher ficam ocupados sem `disabled`, e o
    foco fica neles;
  - na OS, no campo e no anexo do portal, só a JPEG é compactada: o nome no
    Storage já leva a extensão, e a callable confere o tipo por ele. Na OS, a
    foto que falha é falada uma vez, pelo Anunciador, e o motivo sai da tela
    quando o envio recomeça.
- **O `Progresso`** (`components/ui/progresso.tsx`):
  - a contagem: "3 de 4", os segmentos chanfrados, as miniaturas com o véu e
    a caixa determinada, o selo verde, a fila tracejada e o "!". A que não
    foi enviada conta como passada ("3 de 4" com uma enviada, uma não
    enviada e a terceira subindo);
  - no fim, o título e o nome da barra dizem o que subiu ("4 fotos
    enviadas", "3 fotos enviadas" com uma não enviada, "1 foto não enviada"
    quando nenhuma subiu), e as miniaturas ficam com o selo: o bloco não
    encolhe. No Receber, ele fica acima das fotos da linha, como na
    Contagem, e as fotos entram embaixo dele;
  - cada "Tentar de novo" é descrito pela foto dele, e o que sai da tela
    leva o foco ao seguinte, ou ao título;
  - as etapas: "Etapa 1 de 2", os marcadores de 28 px e o fio. Elas ficam na
    tela desde o repouso, pendentes, como na prancha, e a de agora só anda
    aos 300 ms, quando o Anunciador fala o título ("Concluindo a
    separação"). Na caixa estreita (duas etapas no celular, três no
    formulário do Agent Dute), o rótulo vai para baixo do marcador;
  - a barra de progresso tem o nome e o `aria-valuetext`, que muda por item,
    nunca por byte.
- **O `AvisoDeEspera`** (`components/ui/aviso-de-espera.tsx`):
  - aos 10 s, "Demorando mais que o normal · 0:12", com "Tentar de novo" na
    leitura; aos 70 s, na escrita, "Sem confirmação do servidor" e
    "Conferir";
  - o lugar dele fica guardado desde o repouso, no diálogo e no bloco das
    fotos, e ele entra sem empurrar o botão que a pessoa acabou de tocar;
  - nas fotos, a estimativa ("cerca de 20 s") conta só a vez atual, conta
    para baixo sem piscar e sai quando a foto que sobe está há 10 s sem um
    byte novo (parada, ou sem rede);
  - quando a pílula quebra em duas linhas, nenhum "·" sobra no fim da
    primeira.
- **As etapas nas operações longas**: Separação → Embalagem no "Concluir
  separação", Saída → Entrega na entrega pela Dutelog, Arquivo → Cadastro em
  Documentos e Cadastro → Arquivo → Trechos no Conhecimento.
  - O "Voltar" e o X do diálogo ficam `aria-disabled` (o `fecharTravado` do
    `DialogContent`), o botão de ação mantém a largura, os dois têm 44 px e
    o diálogo não fecha.
  - O prazo sem resposta vira o "Conferir", que relê e nunca reenvia.
    Conferindo, o botão diz "Conferindo…", o "Sem confirmação do servidor"
    fica e as etapas não voltam a andar.
  - Na entrega, o "Conferir" lê a saída do pedido: entregue, segue o
    sucesso; cancelada por outra pessoa, o diálogo fecha com "Entrega não
    confirmada"; no resto, volta a "Confirmar entrega", com a mesma chave. O
    fim de um pedido não passa para o diálogo de outro.
  - Em Documentos, o arquivo que já subiu só vale de novo para o mesmo
    arquivo, cliente e tipo: ele mora na pasta do cliente que estava ativo,
    e o `customer_code` é a fronteira.
  - O Conhecimento, que grava direto no Firestore, conta o prazo de 70 s de
    cada lote gravado: a gravação lenta, mas andando, não desiste. O
    "Conferir" lê o cadastro, o arquivo, o último pedaço e o último trecho, e
    só com todos lá segue o sucesso, com o evento uma vez.
- **A foto por IA**: aos 300 ms, a contagem com o tempo decorrido ao lado do
  título, no lugar do texto de repouso, sem empurrar o "Cancelar", que para
  de esperar sem fechar o diálogo. "Gerar" e "Aprovar" são o `BotaoDeAcao`
  ("Gerando…", "Salvando…"), e o foco fica nele.
- **A gestão das fotos e a ficha do Estoque**: "Atualizando fotos…" e
  "Salvando no cadastro…" entram aos 300 ms e são falados pelo Anunciador,
  sem `role="status"` solto. O X da ficha fica `aria-disabled` com as fotos
  subindo.
- **O `deadline-exceeded`** tem a mensagem própria em `lib/functions-api.ts`
  e nas callables da Operação, do WMS, do núcleo, do Comercial, do
  Financeiro e do RH: na escrita, "O servidor não respondeu a tempo. Confira
  antes de tentar de novo."; na leitura, em que repetir é seguro, "O
  servidor não respondeu a tempo. Tente de novo.".
- **O `useEspera`** alcança o agora ao armar o relógio (com a thread ocupada
  no começo da espera, o indicador entrava só aos 3 s), e o tique que
  dispara um décimo de milissegundo antes do marco conta como o marco.
- **Medição no Chromium** (harness com o Storage simulado, quatro fotos de
  4000 × 3000 e 2,7 MB):
  - antes, as 4 subiam inteiras (10,8 MB) em 88,9 s, com "Enviando..."; a
    escolha de 6 levava 4 sem dizer; o Esc fechava o diálogo no meio;
  - depois, 4 × 425 KB em 15 s a 1 Mbps, com "1 de 4" … "4 fotos enviadas"
    e o aviso aos 10 s; o bloco das fotos fica com a mesma posição e a
    mesma altura do começo ao fim, no computador e no celular, e o foco
    fica no campo da foto;
  - "Concluir separação", entrega e Documentos: o botão de ação fica no
    mesmo lugar, com 44 px, do repouso aos 70 s e no "Conferindo…"; o
    anúncio sai entre 340 e 380 ms; no celular de 360 px, as duas etapas
    cabem;
  - o indicador aos 300 ms: em 900 esperas seguidas, nenhuma tardia (antes,
    4 em 600 entravam só aos 3 s);
  - com a foto parada e sem rede, a estimativa sai do aviso e volta quando
    os bytes voltam, só contando para baixo; no movimento reduzido, só
    opacidade.

Ficam para depois:

- o progresso na tela do anexo do portal (Solicitar OS) e nas fotos da
  conclusão da OS, que já sobem compactadas e pelo envio que conta os bytes;
- as duas etapas do "Concluir separação" fecham juntas, porque o
  `completeOrderSeparation` faz as duas numa chamada; a etapa de verdade pede
  o servidor dizer o progresso, ou duas chamadas;
- o "Cancelar" da foto por IA só para de esperar: a geração que já começou
  termina no servidor, e o resultado é ignorado;
- o limite de 8 MB da foto da OS, conferido antes da compactação;
- com a foto de até 256 KB, que sobe sem eventos, e logo depois de uma parada
  longa, a estimativa é grosseira (pode subir uma vez por foto, ou voltar
  alta e cair em 2 a 3 s);
- o "Tipo" de Documentos, um `Select` sem nome acessível, de antes desta
  parte;
- a medição num Android de verdade e no Safari.
