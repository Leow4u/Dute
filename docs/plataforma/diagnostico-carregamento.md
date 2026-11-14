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
   veio e bloquear o "produto novo". *A chegada avulsa entrou no PR 581; as
   Devoluções e a contagem cíclica, na parte 13c do carregamento v2 (registro
   em 10.5).*
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
   Evento do portal só fecha depois do retorno. *Entrou na parte 13a do
   carregamento v2 (registro em 10.5), com o Cancelar `aria-disabled` no
   lugar de desabilitado, o aviso dos 10 s no rodapé e a saída aos 70 s.*
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
   tentativa, o rodapé preso nos diálogos longos e o X de 44 px. *O rodapé
   preso e o X de 44 px, em pé e deitado, entraram na parte 13a do
   carregamento v2 (registro em 10.5), com o campo que recebe o foco fora de
   trás do rodapé e o toast no topo enquanto o diálogo está aberto; a trava de
   toque duplo veio com o `BotaoDeAcao` (parte 4). O "Sem conexão" dentro do
   diálogo espera um desenho.*
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

- ~~as leituras que vão ao Firestore sem passar por `lib/cloud-api.ts` (o
  seletor de cliente, Pessoas, as anotações e os playbooks do Agent Dute),
  que sem rede ainda devolvem o cache~~: feito. O seletor e Pessoas leem pelo
  `lerDocsDoServidor` desde a parte 13e do carregamento v2 (10.5), e as
  anotações e os playbooks, pelas callables do núcleo e pelas rotas do
  `lib/cloud-api.ts`;
- o `deadline-exceeded` de 70 s, que fica com a mensagem própria das
  operações longas (seção 6, PR 8);
- os PRs 2 a 5 do celular.

O PR 2 do celular (as telas da operação sem sinal) entrou no PR 610, com a
parte 9 do carregamento v2 (10.5). Depois de entrar, a equipe guarda no
aparelho os arquivos das telas que pode abrir, uma vez por versão, e o
`ChunkErrorBoundary` separa a falta de rede, a versão nova e o erro da tela.
O PR 3 do celular (as fotos) entrou com a parte 11, e o PR 5 (a leitura leve
e a volta do segundo plano), com a parte 10 (10.5). O PR 4 (a ação no
celular) não tem registro próprio.

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
| 7 | A conexão (7a: "Reconectando…" com histerese e a releitura sozinha) e a linha de estado nas listas (7b: Pedidos, Receber, Estoque, Alertas) | PR 610 |
| 8 | As listas com a forma final | PR 610 |
| 9 | A abertura com a marca e a `CarregandoTela` no lugar do branco | PR 610 |
| 10 | A troca de filtro e a releitura sem apagar a lista | PR 610 |
| 11 | As operações longas: fotos com progresso e etapas | PR 610 |
| 12 | A trilha do Agent Dute | PR 610 |
| 13 | A migração por área e a trava (`animate-spin` só no `Spinner`) | PR 610 |

Pequenas escolhas das pranchas que esperam confirmação, sem bloquear o código:

- o selo "Sem confirmação" em âmbar, porque é resultado desconhecido e não erro;
- o esqueleto fora da v3 (o portal) em `#D9DDE3`;
- o piso do violeta do Agent Dute no movimento reduzido (0,75 no claro e 0,85
  no escuro, para manter 3:1);
- a foto que fica 70 s sem um byte novo é cancelada e vira "Foto 2 não
  enviada", com o "Tentar de novo", e não "Sem confirmação do servidor" com
  "Conferir", como no cartão "Quando demora · escrita" da prancha: o envio
  cancelado não tem o que conferir. A dúvida só existe na callable que vem
  depois do último byte, e ela diz "Confira antes de tentar de novo";
- a releitura que falha por erro do servidor, com o aparelho conectado e a
  lista lida, diz "Não consegui atualizar · lista de 10:42", com "Tentar de
  novo", e não "Reconectando…" (parte 10). O momento 8 fala do servidor que
  "demora ou falha", mas o "Reconectando…" relê sozinho, e o erro do servidor
  não passa sozinho. No Fechamento, "lista de" fala da competência;
- a lista que troca de filtro fica `inert` e com `aria-busy`, como na prancha
  (parte 10). No Chromium, o `inert` a tira da árvore de acessibilidade, e o
  `aria-busy` nunca chega ao leitor de tela: para ele, a lista some até a nova
  chegar. Quem diz que ela está atualizando é a linha de estado, aos 5 s
  ("Atualizando…", sem região viva) e aos 10 s (a demora, dita pelo
  Anunciador). Deixar a lista fora do `inert` exporia ao leitor e ao teclado
  uma lista de outro filtro.

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

**Parte 7b, a linha de estado nas listas (PR 610, 13/11/2026).**

- **A linha de estado** (`components/ui/linha-de-estado.tsx`, no `estado` do
  `PageHeader`): 24 px sempre reservados sob o título de Pedidos, Receber,
  Estoque e Estoque › Alertas, numa fila só dela, sempre abaixo das ações, e
  nada empurra a lista.
  - Primeira leitura: nada antes de 300 ms; depois, a caixa de 24 px e
    "Carregando pedidos…"; aos 10 s, a pílula âmbar "Demorando mais que o
    normal" e "Tentar de novo", com a volta calma. O toque cancela a leitura
    presa e lê de novo (o react-query só se juntaria a ela).
  - Lida: "Atualizado às 10:42", com a hora da leitura mais recente da lista
    (no Estoque, os saldos relêem a cada 2 min e o catálogo a cada 5).
  - A falta com a lista lida, no lugar do `FaixaSemConexao` dessas quatro:
    "Reconectando… · lista de 10:42" em tinta, com os arcos de 20 px, ou a
    pílula "Sem conexão · lista de 10:42", com "Tentar de novo", que acorda
    a conexão antes de reler. O `BlocoSemConexao` e a faixa do shell ficam.
  - O texto troca em sequência (sai em 80 ms, entra em 150 ms; de uma vez no
    movimento reduzido), e só o atual fica na árvore.
  - O "Tentar de novo" tem 24 px de altura e o toque de 44 px pelo `::before`.
- **O Atualizar** (`BotaoAtualizar` e `lib/carregando/use-atualizar-lista.ts`):
  - 40 px no computador e 44 px no celular, também no Estoque (aba Itens);
  - só mostra a espera quando a pessoa toca nele, com `aria-busy` e a trava
    em `aria-disabled`, e no fim o Anunciador diz "Lista atualizada";
  - na primeira leitura, fica travado (`aria-disabled`, a 0,45);
  - a releitura automática (o intervalo da tela, o tempo real, a volta da
    rede) não o gira nem o desabilita.
- **A volta do app ao primeiro plano** relê a lista já lida, com a barra no
  topo do primeiro cartão (`QueueGroup`, `barraDoTopo`; a lista do Estoque e
  o cartão do alerta). Passados 5 s, a linha diz "Atualizando…".
- **O Anunciador** diz "Carregando pedidos" aos 300 ms e "Demorando mais que
  o normal" aos 10 s, só na primeira leitura. A releitura automática não fala
  nem mexe na região viva.
- **Nenhum "0" nem "Nenhum…" antes de ler:** o "Carregando…" no lugar da lista
  saiu (a linha diz), e os filtros do Estoque não mostram 0 antes da primeira
  leitura.
- **Medição no Chromium**, num harness com dados sintéticos e o servidor
  simulado; antes é o `4ab6cf9`:
  - releitura automática com o servidor a 1,5 s: antes, o Atualizar de Pedidos
    e Receber girava e ficava `disabled` por 1,5 s; depois, 0 ms. A região
    viva não mudou nas duas;
  - a falta com a lista lida: antes, a faixa empurrava a lista 74 px (Pedidos,
    Receber) e 66 px (Estoque, Alertas); depois, 0 px;
  - primeira leitura com o servidor a 12 s: antes, "Carregando pedidos..." em
    cinza desde o primeiro quadro e nada aos 10 s; depois, a linha vazia até
    0,29 s, "Carregando pedidos…" com o anúncio, e aos 10,0 s a pílula da
    demora, com o anúncio;
  - a volta do app: antes, nenhuma releitura; depois, a lista relê, e a barra
    do topo fica de 0,32 s até a leitura voltar. Com o servidor a 7 s,
    "Atualizando…" aos 5 s;
  - o Atualizar tocado: antes, `disabled` e girando, sem `aria-busy` nem
    anúncio; depois, `aria-busy` a partir de 0,32 s, nunca `disabled`, e
    "Lista atualizada" no fim;
  - celular: o Atualizar passou de 40 a 44 px, e o do Estoque passou a
    existir;
  - contraste: o calmo 5,61:1 (7,71:1 no escuro), o forte 16,57:1 (18,9:1), a
    pílula 6,18:1 (10,66:1) e o "Tentar de novo" âmbar 6,23:1 (13,18:1);
  - o axe-core não acusa nada na linha em nenhum estado, no claro e no
    escuro, no computador e no celular. No Estoque, segue o `aria-controls`
    das abas, que vem de antes;
  - no movimento reduzido, a cabeça do indicador não gira (a caixa respira),
    e as trocas são de uma vez.

- **A revisão** achou defeitos que esta parte trazia, corrigidos no mesmo
  PR:
  - **O celular:** a linha não quebrava e passava da tela (a 390 px, o
    "Tentando de novo…" saía 46 px pela direita, e a 320 px todos os avisos
    rolavam de lado). Agora cada peça fica inteira e o que não cabe passa à
    linha de baixo; no celular, os vãos são os de 6 px da prancha, e o
    "Tentando de novo…" não leva a caixa pequena (a linha já tem a dela).
  - **O cabeçalho:** a linha corria por baixo das ações nas larguras do meio,
    e o toque estendido do "Tentar de novo" roubava a borda de baixo delas (o
    clique em "Recebidos" relia a lista em vez de trocar a aba). Agora a linha
    tem fila própria, abaixo das ações, que ficam por cima do toque estendido;
    a coluna do título não fica mais estreita que o título, e as ações quebram
    em duas linhas antes de cobri-lo.
  - **O foco:** na troca de "Reconectando…" para "Sem conexão", e quando o
    "Tentar de novo" dava certo, o foco caía no `body`. Agora vai ao "Tentar
    de novo" novo ou, sem ele, à própria linha, com o contorno visível.
  - **O "Tentar de novo" da demora** cancelava todas as leituras sem dado da
    tela, e só a lista era lida de novo: o cliente ativo ficava carregando para
    sempre (o Faturamento não lia mais), e as caixas e os dias parado do
    Estoque ficavam presos. Agora ele cancela só as leituras da lista.
  - **A fala:** com a falta e nada lido, a releitura de 60 s voltava a dizer
    "Carregando pedidos" a cada minuto. Depois de uma falha, a releitura não
    fala, até a lista ser lida. O "Lista atualizada" do Atualizar tocado não
    sai mais na tela seguinte quando a pessoa sai antes do fim.
  - **A rede:** com o aparelho sem rede e nenhuma leitura falhando, a linha
    ficava em "Atualizado às" até a releitura seguinte (até 2 min). Agora a
    pílula "Sem conexão" entra aos 3 s, com o estado da conexão. Na volta da
    rede, "Sem conexão" fica até a leitura voltar e vai direto a "Atualizado
    às", como na prancha do momento 8; se o servidor não responde em 2 s,
    "Reconectando…".
  - **Os fins da espera, como nas pranchas:** aos 10 s, a caixa fica no lugar
    e só o texto troca; na chegada, a espera sai em 180 ms; o Atualizar
    travado volta a 1 em 150 ms; o ícone do Atualizar e a caixa trocam em
    sequência; a barra do topo da volta do app completa em tinta e esmaece. A
    entrada do texto novo guarda o atraso dela até o fim, e a camada que saiu
    só deixa a árvore quando o novo acabou de entrar (antes, o que saía era
    cortado no meio e o novo aparecia de uma vez). O tempo de entrada virou a
    constante `trocaEntraMs`, travada contra o `--carregando-t-troca-entra`.
  - **Os testes:** o teste da releitura de 60 s estourava os 5 s sob carga e
    derrubava os seguintes; a releitura automática que passa de 5 s não
    tinha teste; e dois testes das telas passavam sem a linha.
- **Medição da revisão no Chromium**, no mesmo harness; antes é o `a62f9a1`:
  - rolagem lateral, nas quatro telas, em 8 estados e 9 larguras de 320 a
    1440 px (288 medidas): antes, a 390 px, 5 px na demora e 56 px no
    "Tentando de novo…"; depois, nenhuma vinda da linha, e o "Tentar de novo"
    sempre dentro da tela. A 390 px, "Reconectando…" e "Sem conexão" cabem
    numa linha; a demora e o "Tentando de novo…" ocupam duas;
  - toque das ações: antes, o toque estendido capturava até 15% de
    "Recebidos" (Receber, 1024 px), e o clique na borda de baixo não trocava a
    aba e relia duas vezes; depois, nenhum ponto de nenhuma ação vai para o
    "Tentar de novo", e o mesmo clique troca a aba sem reler;
  - foco: antes, o `body` nas quatro telas; depois, o "Tentar de novo" na
    troca de aviso e a linha, com contorno de 2 px, quando a tentativa dá
    certo (na falta e na demora), e o Tab seguinte segue a ordem da tela;
  - aos 10 s: antes, a caixa sumia e voltava em cerca de 100 ms; depois, a
    mesma caixa, inteira, em todos os quadros, e o texto sai em 80 ms e entra
    em cerca de 150 ms;
  - na chegada: a espera sai em cerca de 190 ms e a hora entra em seguida, em
    cerca de 150 ms, sem as duas visíveis juntas; o Atualizar vai de 0,45 a 1
    em cerca de 140 ms;
  - a barra do topo da volta: antes, sumia num quadro; depois, completa de
    0,3 a 1 em cerca de 185 ms (da parada, de 0,6 de opacidade a 1) e esmaece
    em cerca de 170 ms. No movimento reduzido, não varre: fica inteira e só
    esmaece, e as trocas são de uma vez;
  - a rede: sem rede e sem leitura, a pílula entrou aos 57 s antes e aos 3,0 s
    depois; na volta, "Sem conexão" foi a "Atualizado às" em 0,42 s, sem
    passar por "Reconectando…" (antes, 0,44 s nele); com o servidor ainda
    fora, "Reconectando…" aos 2,0 s a 2,4 s;
  - os dois arquivos de teste da parte, quatro vezes em paralelo: antes, 4
    falhas por tempo em cada rodada; depois, todos verdes, o mais lento em
    2,8 s;
  - o axe-core, em 96 estados (6 estados × 4 telas × claro e escuro × 1440 e
    390 px), não acusa nada na linha nem no cabeçalho.

Fica aberto, para a parte 8 e depois:

- a contagem em bloco, as linhas-fantasma e o anúncio do fim da primeira
  leitura ("3 para aprovar, 2 para separar, 1 para entregar"), na parte 8;
- a tela nunca lida ainda volta a "Carregando…" na releitura de verdade (o
  intervalo e o "Tentar de novo" do bloco), porque o react-query põe a
  leitura sem dado de volta em `pending` (em Pedidos e no Receber, resolvido:
  o "Tentar de novo" da pessoa volta à forma final na parte 8, e a releitura
  automática deixa o aviso na tela desde a junção das partes 9, 11 e 12);
- os 70 s da primeira leitura (o `ErroNaLeitura` "Sem resposta do servidor."),
  que dependem do prazo da leitura, e a troca de filtro com a lista anterior a
  50% e `inert` (caso 4 do momento 7), na parte 10;
- Solicitações, o Início, o Mapa e o painel do owner seguem com o
  `FaixaSemConexao`, e o Atualizar de Solicitações ainda gira sozinho
  (parte 13);
- no celular de 390 px, o "Tentando de novo…" de "Reconectando…" passa à
  linha de baixo e desce a lista 24 px enquanto aparece; de 320 a 360 px,
  também o próprio "Reconectando…" (e "Sem conexão" a 320 px). A demora
  ocupa duas linhas, mas ainda sem lista embaixo;
- de 640 a 1024 px, quando o "Tentar de novo" fica sob as ações, a parte de
  cima do toque estendido é delas: ali o toque dele tem de 36 a 39 px de
  altura;
- o Receber a 320 px rola 9 px de lado pelas ações do cabeçalho, desde antes
  desta parte;
- escolhas para confirmar com o Leonardo: "Atualizado às" mostra a leitura
  mais recente da lista, e "lista de", a mais antiga das que falharam (ou de
  todas, com o aparelho sem rede); no Estoque, o Atualizar fica só na aba
  Itens; Alertas não tem Atualizar; e a volta ao primeiro plano relê sempre,
  sem tempo mínimo fora do app;
- a conferência num Android de verdade, com a rede caindo de fato.

**Parte 8, as listas com a forma final (PR 610, 13/11/2026).** A decisão P3
de 12/11/2026, na primeira leitura de Pedidos e Receber.

- **Desde 0 ms, a forma final:** os títulos reais dos grupos ("Para aprovar",
  "Para separar"…) com o bloco de 16 × 12 px no lugar do número, o
  segmentado "Em aberto · ▪" e o Atualizar travado. Nunca "0" nem
  "Nenhum…" antes de ler. Os cartões já têm a altura das linhas-fantasma,
  invisíveis até os 300 ms.
- **Aos 300 ms**, as linhas-fantasma entram em 150 ms, com a anatomia da
  linha real (a caixa de 44 px, o título, o apoio e os botões de 40 px), e o
  brilho do cartão faz dois ciclos, 120 ms depois do cartão de cima. A linha
  de estado diz "Carregando pedidos…". O contêiner da lista fica com
  `aria-busy` e `aria-describedby` apontando para a linha de estado; os
  fantasmas e os blocos ficam fora da árvore.
- **A contagem lembrada** (`lib/carregando/contagem-lembrada.ts`): a última
  contagem lida de cada grupo, por lista e por cliente, guardada no aparelho
  (`localStorage`, com `try/catch`), dá de 1 a 5 linhas-fantasma; sem ela,
  2. Na abertura, enquanto a lista dos clientes não chega, vale o cliente
  escolhido no aparelho (`codeProvavel` do cliente ativo), e só se grava com
  o cliente confirmado. Cada leitura grava por cima da anterior: quem não
  decide não apaga a contagem de "Para aprovar". No pedido, a linha-fantasma
  tem a linha do "Ver volumes" e, no celular, as ações no bloco de baixo,
  como a linha real.
- **Na chegada**, as linhas reais entram por opacidade em 150 ms, subindo 4
  px, em cascata de 30 ms em até seis linhas, por cima dos fantasmas, que
  esmaecem em 150 ms junto com a primeira linha do grupo. O bloco sai
  subindo enquanto o número entra. A chegada acaba quando as animações dela
  terminam (`useChegada`), e não num relógio: elas só começam no primeiro
  quadro pintado, que no celular lento vem mais de 150 ms depois.
- **O segmentado** guarda a casa de 16 px do número, onde o bloco estava, e
  nada anda quando ele chega. No celular, cada opção tem 44 px de alvo, em
  todos os segmentados; em Pedidos e Receber, ele ocupa a linha das ações,
  com as opções em partes iguais e, a 320 px, sem sair da tela.
- **O número do grupo** passou ao `--muted-foreground` (5,61:1; antes, a
  tinta a 50%, com 3,34:1).
- **O Anunciador** diz "Carregando pedidos" aos 300 ms e, quando a lista
  chega, o resumo ("3 para aprovar, 2 para separar, 1 para entregar"; "2
  para conferir, 1 para guardar" no Receber), só se disse o primeiro. O
  resumo que ainda espera o intervalo de 2 s sai com a tela
  (`useRetirarAnuncio`). Depois de uma falha, a releitura automática não
  fala; a nova tentativa que a pessoa pede ("Tentar de novo" no aviso) fala
  como a primeira (`lib/carregando/pedido-da-pessoa.ts`), e o foco vai à
  linha de estado quando o aviso sai.
- **Só a primeira leitura da tela.** No Receber, trocar o cliente com a lista
  lida relê os avisos do cliente novo com a lista na tela; a troca com a
  lista anterior a 50% é da parte 10. A leitura que falha não espera a
  outra: o aviso entra no lugar da lista na hora, e a linha de estado fica
  vazia.
- **Estoque e Alertas** já não mostravam "0" antes de ler desde a parte 7b;
  ficaram os testes que travam isso.
- **O relógio da espera:** no Chromium, o timer dos 300 ms dispara 0,2 ms
  antes do marco, e o tique não mostrava nada; o indicador e o anúncio só
  vinham aos 3 s. Agora o marco do timer conta como alcançado.
- **No movimento reduzido**, sem brilho, os blocos parados e a chegada só
  por opacidade.

- **Medição no Chromium**, num harness com dados sintéticos e o servidor a
  2,4 s. No relógio, antes é o `0ed9003`; no resto, o `b1e3143`, o primeiro
  desenho desta parte, e depois, a revisão:
  - o timer adiantado: antes, 5 de 48 rodadas só mostravam a espera aos 3 s;
    depois, nenhuma, com os fantasmas e "Carregando pedidos…" entre 330 e 370
    ms (de 382 a 408 ms com a CPU 4× e o Slow 4G);
  - a cascata: antes, com a CPU 4×, de 4 a 6 linhas por rodada pulavam para
    o fim no meio da entrada (de 0,86 a 0,93 para 1 num quadro); depois, nenhuma em
    11 rodadas a 1×, 4× e 6×, nem no reduzido, no celular e no Receber, e a
    chegada acaba de 340 a 430 ms depois de começar;
  - o cartão vazio: antes, de 15 a 26 quadros por rodada com um cartão sem
    fantasma e sem linha (abaixo de 0,3 de opacidade); depois, nenhum, e o
    mais visível dos dois nunca fica abaixo de 0,8;
  - os saltos com a contagem lembrada exata: no computador, os títulos andam
    0 px, e a borda de baixo de "Para entregar", 22 px antes e 0 depois; no
    celular, "Para entregar" desce 60 px (92 antes), e as linhas-fantasma do
    pedido têm a altura das reais (147 e 168 px). A primeira visita, sem
    lembrança, desce 79 px por linha a mais, como a P3 previa;
  - o segmentado: antes, andava de 7,3 a 8,2 px na chegada; depois, 0. No
    celular, cada opção passou de 34 a 44 px (em Pedidos, 153 × 44 num
    grupo de 306 px, como na prancha, com o Atualizar ao lado);
  - o Receber a 320 px: antes, 337 px de largura lendo e 328 lido; depois,
    320 nos dois;
  - a troca de cliente no Receber: antes, a lista sumia por uns 300 ms e
    voltava em fantasmas; depois, fica inteira, e só a linha de estado diz
    "Carregando chegadas…";
  - a nova tentativa depois da falha: antes, nada falado e o foco no `body`;
    depois, "Carregando pedidos", o resumo e o foco na linha de estado;
  - o axe-core, em 24 estados (até 300 ms, lendo e na demora × Pedidos e
    Receber × claro e escuro × 1440 e 390 px), não acusa nada. Na lista lida
    ficam as violações de antes: a idade da linha ("· há 25 min", a tinta a
    45%, 2,92:1) e o primário no escuro (4,3:1).

Fica aberto:

- no celular, "Para aprovar" ainda cresce na chegada quando o resumo do
  pedido quebra em duas linhas (60 px com três pedidos), o que depende do
  texto;
- "Para separar" com o pedido de itens abertos por padrão fica mais alto que
  a linha-fantasma;
- o resumo das vistas Entregues, Recebidos e Cancelados ("N entregues", "N
  chegadas recebidas") e o vazio ("Nenhum pedido em aberto") passam das seis
  palavras do Anunciador: a especificação só define a frase de Pedidos em
  aberto. Fica para confirmar com o Leonardo;
- o resumo já pedido ainda é dito quando a pessoa troca para "Entregues"
  dentro dos 2 s do anúncio (o número é da lista em aberto);
- na troca de cliente do Receber, até os avisos do cliente novo chegarem, o
  "Em aberto" e "Para conferir" contam sem eles, como antes desta parte; a
  troca com a lista anterior a 50% é da parte 10;
- o segmentado de 44 px no celular vale para os sete que existem (Pedidos,
  Receber, a falta da linha, a entrega do pedido, o destino da caixa, a
  demanda nova da Operação e as faturas do portal): conferir os outros cinco
  num celular;
- a 320 px, os botões "Aprovar" de Pedidos ficam cortados pelo cartão, desde
  a parte 6;
- a linha ocupada (`aria-busy`) sem teste com leitor de tela de verdade
  (NVDA, JAWS, VoiceOver), e o Android médio de verdade (aceite da seção 8).

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
  300 ms e volta, porque o relógio recomeça (a primeira leitura das quatro
  listas com a linha de estado continua a espera da rota desde a junção das
  partes 9, 11 e 12);
- a medição num Android de verdade e no Safari, que pode tratar a folha no
  corpo de outro jeito.

**Parte 10, a troca de filtro e a releitura (PR 610, 13/11/2026).** O momento
7 (casos 3 e 4) e a releitura do momento 8. Entraram aqui o item 9 da seção 6
(a atualização) e o PR 5 do celular (9.3: a leitura leve e a volta do segundo
plano).

- **A troca de filtro, mês ou cliente** (`lib/carregando/use-lista-em-troca.tsx`),
  com `placeholderData: keepPreviousData` nas listas com filtro no servidor:
  Produtos e SKUs (a busca e a página), Movimentações (o tipo, a busca e a
  página, também na aba Histórico do Estoque), Pedidos legado (o status, a
  busca e a página), Relatórios (o período), o Fechamento do mês (o mês e o
  cliente) e o Receber (a troca de cliente, que a parte 8 deixou para cá):
  - a lista anterior fica, a 50% em 150 ms, `inert` e com `aria-busy`, que só
    vale neste caso. Nada de "Carregando..." no lugar dela, e a tela não pula;
  - a barra do topo do cartão (`BarraDaLista`, a `BarraDeEspera` com o fim em
    tinta) entra aos 300 ms, inteira: o CSS esmaece tudo dentro da lista
    menos o caminho até ela, desde o começo da troca;
  - aos 5 s, a linha de estado diz "Atualizando…"; até lá, a hora da lista
    na tela. Aos 10 s, a demora, com "Tentar de novo". A troca não fala até a
    demora;
  - na chegada, a lista nova volta a 1 da opacidade em que a anterior estava,
    subindo 4 px, em 150 ms (só opacidade no reduzido);
  - o filtro, a busca e a paginação ficam fora do que fica inerte, e o foco
    fica onde a pessoa tocou. "Anterior" e "Próximo" ficam ocupados com
    `aria-disabled`, sem `disabled`, até a página chegar, e o cursor das
    Movimentações não pega o da página que ainda está na tela (antes, o
    `disabled` tirava o foco do botão; com a página anterior na tela, o cursor
    seguinte seria o dela);
  - nos Relatórios, o "Baixar planilha" fica ocupado na troca: a prévia na
    tela é do período anterior, e a planilha sairia com o nome do novo. "Nada
    neste filtro" diz o período da prévia; no Fechamento, o cartão do total
    diz o mês que está na tela;
  - no Receber, os avisos do cliente anterior ficam até os do novo chegarem
    (antes, sumiam na hora, e "Para conferir" contava sem eles), e a contagem
    lembrada do cliente novo não é gravada com os do anterior;
  - a troca que falha mostra o aviso no lugar da lista (`FalhaNaLeitura`: o
    `ErroNaLeitura` ou, na falta de conexão, o `BlocoSemConexao`), nunca o
    vazio. A nova tentativa segue com o aviso e "Tentando de novo…" (o
    react-query voltaria a lista do filtro anterior por baixo,
    `useListaComFiltro`). Antes, a busca de Produtos que falhava deixava a
    tabela vazia e "Produtos cadastrados 0".
- **A releitura que falha nunca apaga a lista** (momentos 7 e 8). Antes, o
  Receber, o Estoque, os Alertas, os Relatórios e o Fechamento trocavam a
  lista pelo aviso de erro; Pedidos dizia "Atualizado às 10:42" como se nada
  tivesse falhado; Produtos, SKUs, Movimentações e Pedidos legado não diziam
  nada. Agora só a leitura sem nada lido troca a lista pelo aviso:
  - a linha de estado diz "Não consegui atualizar · lista de 10:42", com
    "Tentar de novo" (o ícone em crítico, o texto em tinta, como o
    "Reconectando…"). Além das quatro listas que já tinham a linha, ela entrou
    sob o título de Produtos, SKUs, Movimentações, Pedidos legado e
    Relatórios, e logo abaixo dos meses no Fechamento (a decisão 5:
    "Atualizado às" sempre sob o título das listas). Essas telas também
    passaram a dizer a falta de conexão ("Reconectando… · lista de 10:42",
    "Sem conexão · lista de 10:42"), que não mostravam;
  - a releitura automática não fala. Quem tocou em Atualizar ou em "Tentar de
    novo" e viu falhar de novo ouve "Não consegui atualizar".
- **O "Avançar" só volta depois da releitura** (o item 9 da seção 6 e a
  linha "Tratar" de 4.3): a mutação de `useWarehouseTaskActions` espera a
  bancada voltar. Antes, o botão voltava ativo com a tarefa ainda na etapa
  antiga, até a releitura chegar.
- **A leitura leve no celular** (o PR 5 do celular):
  - abaixo de 768 px, onde o menu lateral com os contadores não aparece, o
    shell da Armazenagem não lê o armazém (`/api/warehouse/ops`, até cerca
    de 9.900 documentos) nem o relê a cada 60 s; cada tela lê o que mostra. O
    menu lateral volta a ler quando aparece;
  - o "Conferir" da separação que acha o pedido concluído usa a leitura que
    acabou de fazer, e não lê a fila de novo (antes, duas leituras);
  - a volta do app ao primeiro plano já relia as listas, com a barra no topo
    e "Atualizado às" (parte 7b): nada a mais aqui.
- **Medição no Chromium**, num harness com dados sintéticos e o servidor
  simulado (a troca com o servidor a 2,5 s; antes é o `96ea50d`):
  - a troca, nas sete telas: antes, a lista sumia por toda a espera (150
    quadros de 151, cerca de 2,5 s), no lugar dela "Carregando..." ou
    "Calculando…", e a tela encolhia de uma vez (de 2.265 a 2.965 px nas
    listas legadas, 230 px nos Relatórios, 291 px no Fechamento e 315 px no
    Receber, onde os avisos sumiam); depois, a lista anterior em todos os
    quadros, nenhum "Carregando", `aria-busy` e `inert` em todos, a 0,5
    depois de 150 ms, a barra do topo entre 287 e 338 ms, e 0 px de salto até
    a chegada. No celular de 390 px, antes de 471 a 3.165 px; depois, 0 px.
    No movimento reduzido, a mesma forma, com a barra parada e inteira;
  - a chegada: a lista nova vai de 0 a 1 em cerca de 140 ms, e a barra
    completa em tinta e esmaece;
  - no Receber, com o servidor a 6,5 s: antes, "Carregando chegadas…" e os
    avisos fora por todo o tempo; depois, "Atualizado às" e, a 5,22 s da
    troca, "Atualizando…";
  - a releitura que falha (um erro 500): antes, o Receber, o Fechamento e os
    Relatórios ficavam com 0 linhas e o aviso de erro, e o Estoque com "Não
    consegui carregar o estoque."; Produtos seguia sem dizer nada. Depois, as
    mesmas linhas na tela (3, 2, 8 e 50), com "Não consegui atualizar · lista
    de" na linha de estado ou na faixa (o "· lista de" com 6,07:1 no claro e
    7,36:1 no escuro). A busca de Produtos que falhava deixava a tabela vazia;
    agora, o aviso com "Tentar de novo";
  - o shell no celular, em 3 min numa tela que não lê o armazém: antes, 1
    leitura de `/api/warehouse/ops` ao abrir e 3 no intervalo; depois, 0 e 0.
    No computador, segue 1 e 3;
  - o axe-core no Chromium, com o contraste, no claro e no escuro: nenhuma
    violação nova na troca (a lista `inert` sai da árvore) nem com as faixas
    de falha. As que existem são de antes desta parte: nas telas legadas, os
    botões de ícone sem nome (100 em Produtos), as barras de progresso sem
    nome (50 em Pedidos legado) e o contraste; no escuro, o primário (4,3:1).

- **A revisão (13/11/2026)**, com o que o navegador e o leitor de tela
  mostraram:
  - **A faixa saiu; a linha de estado entrou.** A `FaixaDaReleitura`, que
    entrava logo acima da lista nas telas sem a linha, empurrava a lista 74 px
    em Produtos e 66 px no Fechamento e nos Relatórios quando entrava, e de
    novo quando saía, também na falta de conexão. Agora o estado dessas seis
    telas mora na linha reservada (acima), e nada empurra a lista. A primeira
    leitura delas ainda diz "Carregando..." na tabela, e a linha fica vazia e
    calada até a lista chegar (`primeiraNaLista`). Na aba Histórico do
    Estoque, a linha das movimentações fica reservada logo acima da lista, sem
    a hora (a do Estoque, sob o título, é a dos itens; `semHora`): ela só diz
    a troca que passa de 5 s, a demora, a falha e a falta de conexão;
  - **A troca que demora.** Aos 5 s, "Atualizando…" nas sete telas (antes, só
    no Receber; nas outras, a barra parada e nenhum texto). Aos 10 s, a pílula
    "Demorando mais que o normal" com "Tentar de novo", como na primeira
    leitura, dita uma vez pelo Anunciador (antes, a troca ficava parada no
    estado dos 5 s para sempre). O "Tentar de novo" larga a leitura presa e lê
    de novo o filtro novo, com a lista anterior na tela até ela chegar;
  - **O toque.** A lista anterior não se redesenha enquanto a nova não chega
    (`ConteudoEmTroca`): antes, o toque refazia a tabela inteira duas vezes. Com
    a CPU 4× mais lenta, o primeiro quadro que muda depois do toque em
    "Próximo" (Produtos, 50 linhas, o build de produção) passou de 150 a 171
    ms para 102 a 116 ms no computador, e de 137 a 154 ms para 83 a 98 ms no
    celular; o script nos primeiros 250 ms, de 94 para 21 ms. O que resta é o
    recálculo de estilo do `inert` e do esmaecer na tabela inteira (cerca de
    45 ms com a CPU 4×), que a troca pede;
  - **A chegada sem piscar.** A lista nova volta a 1 da opacidade em que a
    anterior estava, por uma transição, e sobe 4 px por `transform`
    (`carregando-chega-troca`): nunca passa por 0. Antes, ela ia de 0,5 a 0 em
    um quadro, o cartão ficava vazio por 2 ou 3 quadros, e a troca rápida
    piscava. Com o servidor a 150 ms, a opacidade agora vai de 0,50 a 0,60,
    0,87, 0,92… e 1; a 40 ms, de 1 a 0,90, 0,99 e 1;
  - **A paginação.** Nas pontas, "Anterior" e "Próximo" ficam indisponíveis
    com `aria-disabled` (a 50%), sem `disabled`: o foco fica no botão quando a
    última ou a primeira página chega (antes, ia ao `body`). A página nova que
    chega com o topo do cartão acima da tela o traz à vista, de uma vez, e a
    pessoa lê a página do começo (antes, ficava no pé, vendo o fim da página
    nova: no Chromium, a primeira linha visível era a A.085, e agora é a
    A.051);
  - **O aviso da troca que falha** (`FalhaNaLeitura`). "Tentando de novo…" só
    na nova tentativa que a pessoa pede: a releitura automática não mexe mais
    no aviso, que é um alerta e era lido de novo sem ninguém tocar. Quando a
    nova tentativa dá certo, o foco vai à linha de estado, e não ao `body`. Ao
    lado do aviso, nada de "Exibindo 0 de 0", "0 produto(s) nesta página" ou
    as contagens dos filtros;
  - **Os Relatórios de estoque.** A primeira leitura que falha segue com o
    aviso e "Tentando de novo…" na nova tentativa; antes, o aviso virava
    "Carregando..." e o foco caía no `body`;
  - **O Receber.** A troca de cliente que falha mostra "Não consegui carregar
    as chegadas." com "Tentar de novo" no lugar da lista; antes, a lista
    ficava sem os avisos, a linha vazia, e "Para conferir" contava sem eles.
    Na nova tentativa, "Tentando de novo…", sem os avisos do cliente anterior
    por baixo, e o "Em aberto" fica com o bloco enquanto o aviso está na tela.
    Na troca, só os avisos do cliente anterior ficam a 50% e `inert`: as
    chegadas e as guardas do armazém, que a troca não relê, seguem com o
    toque;
  - **O "Não consegui atualizar"** que a pessoa pediu só é dito com a tela
    aberta, e o que ainda espera o intervalo do Anunciador sai com ela;
  - **O "Avançar" e o "Concluir entrada"**, que agora esperam a releitura,
    ficam ocupados com `aria-disabled`, a caixa do indicador e "Avançando…",
    sem `disabled`: antes, o foco caía no `body` e ficava lá durante toda a
    releitura.
- **Medição da revisão no Chromium**, no mesmo tipo de harness, com o
  `5ad56f4` como antes:
  - a releitura que falha e a falta de conexão de verdade
    (`context.setOffline`): 0 px de salto em Produtos, Fechamento e Relatórios
    (antes, 74, 66 e 66 px);
  - a troca nas sete telas, com o servidor a 2,5 s: nenhum quadro sem lista,
    a lista a 0,5 aos 150 ms, e só os 4 px da subida na chegada;
  - na troca longa (80 s): "Atualizando…" aos 5,6 s, "Demorando mais que o
    normal" com "Tentar de novo" aos 10,3 s, e "Atualizado às" na chegada;
  - o foco: depois do "Tentar de novo" que dá certo, na linha de estado;
    na última página e na primeira, no botão;
  - o Receber: os três avisos do cliente anterior a 0,5 e `inert`, as duas
    chegadas a 1 e com o toque; a troca que falha com o aviso, "Tentando de
    novo…" e, na volta, "Atualizado às";
  - o axe-core, nas sete telas, no claro, no escuro e no celular, em
    repouso, na troca, com a releitura que falhou, em "Tentando de novo…" e
    com o aviso da troca que falhou: nenhuma regra nova. As que aparecem são
    de antes desta parte.

Fica aberto:

- na aba Histórico do Estoque, a linha sob o título continua dizendo a hora
  dos itens; a das movimentações fica na linha delas, acima da lista, só com
  o que muda;
- a decisão do `inert` com o `aria-busy` na lista que troca e a frase "Não
  consegui atualizar" esperam a confirmação do Leonardo (10.4);
- aos 70 s, a troca segue com "Demorando mais que o normal" e "Tentar de
  novo", como a primeira leitura das listas: a saída dos 70 s ("Sem resposta
  do servidor.") não existe em nenhuma lista;
- o toque em "Próximo" ainda leva de 102 a 116 ms no computador com a CPU 4×
  mais lenta, pelo recálculo de estilo do `inert` na tabela inteira;
- durante a troca, os números fora da lista (os cartões de Produtos, SKUs e
  Pedidos legado, o "Exibindo 50 de 120" da paginação, a contagem do
  relatório no menu dos Relatórios e o "Em aberto · N" do Receber) ficam com
  os da lista anterior, inteiros, até a nova chegar; e, com a busca que
  falhou, o cartão "Produtos cadastrados" ainda diz 0;
- no Fechamento, os cartões dos meses do cliente novo dizem "Em aberto" até a
  lista dos períodos chegar (o falso vazio de 4.8, de antes desta parte);
- a primeira leitura dessas seis telas segue com "Carregando..." em texto (a
  migração, parte 13);
- "Anterior" e "Próximo" ocupados na troca não mudam de aspecto: quem diz é a
  lista a 50% e a barra. Na paginação do pé de uma página longa, a barra do
  topo fica fora da tela durante a troca;
- o `realtime-sync` relê a fila do armazém quando as tarefas mudam: na
  conclusão da separação, a releitura dela e a do app podem somar duas
  leituras (a segunda cancela a primeira). O harness não tem o Firestore, e
  isso não foi medido; o "Avançar" ocupado também não foi medido no
  navegador (o harness não tem bancada com tarefa que avança);
- a conferência num Android de verdade e com leitor de tela de verdade.

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
    produto.") no lugar do corte calado, na tela e pelo Anunciador, no
    anúncio do começo ("Enviando 4 de 6 fotos"; desde a junção das partes 9,
    11 e 12, um anúncio só); sem nenhuma que caiba, o motivo;
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

**Parte 12, o Agent Dute (PR 610, 13/11/2026).** O momento 9 na conversa e o
carregamento novo nas outras telas do agente.

- **A trilha** (`TrilhaDoAgente`, `components/agent/trilha-do-agente.tsx`),
  no lugar do "Pensando…", das etiquetas soltas das consultas e do ícone
  girando:
  - aos 300 ms, a caixa violeta de 20 px e "Lendo a pergunta…"; depois, uma
    linha por consulta: "Consultando o estoque…" na da vez, "Estoque" com o
    check violeta de 16 px nas feitas. O check tem o nome "Consulta feita"
    para o leitor de tela. A mesma ferramenta chamada de novo é outra
    consulta, no fim. Até 4 linhas; as antigas recolhem em "+N consultas". A
    caixa aberta tem pelo menos 300 px, e a borda direita não pula a cada
    consulta;
  - o texto que o modelo manda antes de uma consulta ("Vou verificar…") sai
    da tela enquanto ela roda: quem diz o que o agente faz é a trilha;
  - quando o texto começa, a trilha recolhe numa linha, na mesma caixa e com
    a altura de uma linha dela: "Leu o estoque e o razão de movimentos", ou
    "Leu o estoque, o razão de movimentos e mais 2 fontes". A recolhida
    entra em 150 ms, e a resposta gravada mostra a mesma linha;
  - enquanto a resposta chega, o bloco dela não encolhe, e o lugar das
    fontes e do Copiar fica guardado: com a conversa presa no fim, nada
    desce para depois subir de novo;
  - as linhas entram com opacidade e 4 px e o check com a mola, só nos
    primeiros 5 s. No reduzido, a caixa respira até o piso do violeta (0,75
    no claro e 0,85 no escuro), e as linhas e a recolhida entram só por
    opacidade.
- **A demora e o prazo:**
  - aos 10 s sem texto, "Demorando mais que o normal" e o Parar, de 44 px. O
    texto antes de uma consulta não conta como texto. O Parar corta a
    espera neste aparelho e devolve a pergunta e as notas ao campo, se ele
    está vazio: o que a pessoa escreveu durante a espera fica. Parar não é
    erro, e não sai toast;
  - o prazo do chat é de 180 s sem notícia do servidor (`CARREGANDO.desisteDoAgenteMs`):
    a resposta que ainda chega não é cortada. O `.stream()` da callable não
    tem prazo próprio (o `timeout` do `httpsCallable` só vale para a chamada
    comum), e o stream que fecha sem o resultado, quando a function cai ou
    passa dos 180 s dela, também vira "Sem resposta do Agent Dute"
    (`resultadoDoStream`, em `lib/functions-api.ts`);
  - o "Tentar de novo" relê a conversa antes: se o servidor gravou a
    resposta depois do corte, ela aparece, sem perguntar de novo nem rodar o
    agente outra vez. Se não, a mesma pergunta, na mesma conversa, com as
    mesmas notas, sem mexer no campo;
  - a conversa presa no fim rola quando a demora e o "Sem resposta" chegam:
    o Parar e o "Tentar de novo" ficam à vista, também no celular;
  - sair da tela no meio da resposta corta a espera sem toast.
- **As fontes** (`FontesDaResposta`): "De onde tirei: Estoque · Razão de
  movimentos", em chips, no fim da resposta (invariante 3). Saem de
  `tools_used`, por um catálogo que cobre as ferramentas dos dois agentes (o
  do WMS e o do núcleo); o rascunho, a rotina e a anotação são propostas do
  agente e não viram fonte. Na chegada, os chips e o Copiar entram em 150 ms
  no lugar guardado.
- **O foco e o leitor de tela:**
  - o Enviar nunca fica `disabled`: sem texto ou esperando a resposta, ele
    fica `aria-disabled`, e o foco não cai no body quando a resposta chega.
    O foco que estava no Parar ou no "Tentar de novo" vai ao campo quando o
    botão sai da tela;
  - a resposta não fica em região viva. O Anunciador fala a primeira
    consulta, a demora e "Resposta pronta". O anúncio que ainda esperava a
    vez sai da fila quando a espera acaba (o `useAnuncio` devolve o
    "retirar"): ninguém ouve "Demorando mais que o normal" depois do Parar,
    nem "Carregando playbooks" com os playbooks já na tela;
  - no escuro, o texto violeta usa o `--agent-strong`: o `--agent` ficaria
    abaixo de 4,5:1 como texto.
- **As outras telas do agente** (anotações, playbooks, rotinas, os quatro
  cartões de rascunho, o `/agente/painel`, o painel antigo e o
  Conhecimento): `Spinner`, `Esqueleto`, `BotaoDeAcao` (com a opção `tinta`,
  o primário em tinta onde o desenho pede) e a decisão por linha
  (`useAcaoNaLinha`). A região que ainda lê é a `CarregandoNaRegiao` e, nas
  listas, a `LeituraDaListaDoAgente` (antes `LeituraDaLista`, o nome do tipo
  da linha de estado):
  - as linhas-fantasma entram aos 300 ms, com o rótulo; antes, o lugar fica
    guardado e vazio. Na barra, elas têm a forma da lista que chega (o grupo
    e as linhas);
  - a leitura que falhou fica na tela enquanto tenta de novo
    (`useLeituraComFalha`, em `lib/carregando`). O react-query 5, na nova
    tentativa sem dado, volta a leitura a "pending" e zera o erro, e o
    "Tentar de novo" sumia com o foco nele; agora ele diz "Tentando de
    novo…" até a leitura responder;
  - a lista de conversas sem conexão diz "Reconectando…" ou "Sem conexão.",
    como a conversa ao lado, e não "Não consegui carregar as conversas.";
  - no Conhecimento, cada número sai da leitura dele: os arquivos fonte que
    falharam não prendem os números dos documentos, e o que não carregou
    mostra "—" ("Não carregou" para o leitor de tela);
  - no celular, as ações da linha têm 48 px, com 8 px entre Recusar e
    Aprovar, e o Atualizar tem 44 px;
  - a leitura direta do Firestore que só achou o cache (o Conhecimento e as
    conversas do núcleo) vira falta de conexão, pela mesma regra de
    `lib/cloud-api.ts`;
  - o painel antigo, as rotinas e os estados de falha da conversa ganharam
    teste com a lista de textos e o axe.
- **Medição no Chromium** (harness com o chat por fetch e NDJSON, um
  servidor falso e 8 pares de histórico; o antes é a primeira versão desta
  parte):
  - a trilha aparece aos 335 ms; só `transform` e `opacity` animam, com um
    laço só (o indicador da vez);
  - quando o texto começa, a conversa descia 74 px e voltava a subir; agora
    fica no lugar (4 px). Na chegada da resposta, ela subia 70 px de uma vez
    (124 no celular); agora, 8 px (nada no celular, onde o lugar das fontes
    entra junto com o texto);
  - o Parar aos 10 s, no celular de 390 × 844 com histórico, ficava 46 px
    escondido atrás do campo; agora fica 52 px acima do fim da área
    visível, como no computador. Aos 180 s, o "Tentar de novo" ficava
    inteiro escondido e o foco caía no body; agora fica à vista, e o foco
    fica no Enviar;
  - quem envia pelo Enviar continua nele quando a resposta chega (antes, o
    foco caía no body aos 7,5 s);
  - a caixa da trilha vai de 300 a 319 px (antes, de 191 a 319), a
    recolhida tem 50 px e o check, 16 px;
  - com a leitura em 150 ms, nenhum bloco-fantasma aparece; em 600 ms, eles
    entram aos 300 ms;
  - com a primeira consulta aos 9,5 s e o Parar aos 10,6 s, "Demorando mais
    que o normal" era falado 900 ms depois do Parar; agora, não é falado;
  - nas anotações, Recusar, Aprovar e Arquivar tinham 36 px no celular;
    agora, 48 px (36 no computador);
  - o axe não acusa nada na trilha, na recolhida, na resposta com as fontes,
    na demora, no prazo e sem rede, no claro, no escuro e a 390 px. Com a
    CPU 4× mais lenta e Slow 4G, nenhuma tarefa longa; o maior intervalo
    entre quadros foi 42 ms.

Esperam o OK do Leonardo:

- a trilha recolhida e as fontes também nas respostas gravadas, como no
  quadro final da prancha: nada pula quando a resposta termina, mas todo
  histórico com leituras ganha a caixa e os chips;
- a opção `tinta` do `BotaoDeAcao`, para o Aprovar do painel (o teste do
  mockup trava a tinta), os cartões e a janela de rotina, que já eram
  pretos; o diálogo de playbook e o Salvar ou Aprovar das anotações no
  Conhecimento continuam no primário vermelho.

Ficam para depois:

- os números por consulta ("38 pedidos"): o stream não manda o resumo;
- o Parar e o prazo só cortam a espera neste aparelho; a callable continua
  no servidor e pode gravar a resposta, que aparece na próxima leitura;
- o texto que chega antes de uma consulta ainda troca de lugar com a trilha:
  quando ele chega, não dá para saber se é a resposta;
- "De onde tirei:" e os chips ficam com 12 px, porque a escala de texto não
  tem 13 px, e a borda da caixa usa o `--agent-border` do app;
- o "fieldset" `disabled` dos cartões e das janelas de playbook e de rotina
  durante o envio, o Cancelar `disabled` nessas janelas e as sugestões
  `disabled` das boas-vindas;
- o Pessoas, o seletor de cliente e a lista de separação ainda leem o cache
  do Firestore sem rede;
- as ações de linha de Pedidos, o piloto, ainda têm 40 px no celular.

**A junção das partes 9, 11 e 12 com as 7b e 8 (PR 610, 13/11/2026).** As
partes 9, 11 e 12 foram feitas ao mesmo tempo que as 7b e 8, numa cópia, e
entraram pelo merge `96ea50d`. Três revisões do app junto acharam o que só
aparece com as partes juntas; o que mudou:

- **Uma espera, um relógio** (`lib/carregando/espera-da-rota.ts`): quando o
  arquivo da tela chega e a lista ainda lê, a linha de estado e as
  linhas-fantasma continuam a espera da `CarregandoTela`. Antes, a caixa de
  40 px saía e, por 300 a 410 ms, a tela ficava com os cartões vazios, sem
  indicador; a caixa de 24 px voltava em outro lugar, a demora vinha só aos
  10 s da lista (até 19 s do toque), e a espera era anunciada duas vezes
  ("Abrindo Pedidos…" e "Carregando pedidos"). Com a abertura ainda na tela,
  a lista conta do zero, como antes. A `CarregandoTela` anuncia sem a
  reticência ("Abrindo Pedidos"), como as outras falas.
- **O anúncio da espera que acabou sai da fila**: a linha de estado retira
  "Carregando pedidos" e a demora quando a lista chega ou a leitura falha; a
  `CarregandoTela` retira o dela quando sai (sem lista que continue a
  espera); a linha de "Para aprovar", o `AvisoDeEspera`, as etapas do
  `Progresso`, "Salvando no cadastro" e "Atualizando fotos" retiram o deles
  quando a espera acaba. Antes, "Carregando estoque" era falado 1,5 s depois
  de a lista estar na tela, "Carregando pedidos" depois do aviso da falha e
  "Aprovando pedido 1042" depois do "Aprovado".
- **O Anunciador**: o texto que acabou de ser dito, pedido de novo dentro dos
  2 s, não tira da fila o outro que espera a vez (um segundo "Demorando mais
  que o normal" apagava o "Sem conexão"). Na passagem da abertura, o
  primeiro anúncio do app espera os 2 s da última fala dela (o script marca
  `data-dito` e `data-dito-em`, e o #root guarda quando ela sai), e o "Sem
  conexão" que ela já disse não é dito de novo, até a rede voltar.
- **A lista que falhou sem dado e é relida pelo intervalo** (Pedidos e
  Receber, `useFalhaNaReleituraAutomatica`): o aviso fica, com "Tentando de
  novo…" no botão e o foco nele; antes, a cada 60 s ele virava fantasmas, o
  foco ia à linha de estado e não voltava ao botão quando a falha voltava. A
  nova tentativa que a pessoa pede segue a regra da parte 8 (a forma final,
  a fala e o foco na linha de estado).
- **O Atualizar do Conhecimento e da Central da IA** passa pelo
  `useAtualizarLista`: acorda o Firestore que se deu por offline antes de
  reler (antes, o toque relia do cache e a falta continuava) e diz "Lista
  atualizada".
- **As fotos além do limite**: "Enviando 4 de 6 fotos", um anúncio só; com a
  região ocupada, "Enviando 4 fotos" se perdia atrás de "Só 4 fotos sobem
  por vez.".
- **A primeira pergunta de uma conversa nova do Agent Dute**: o foco vai ao
  campo da conversa, e não ao body (era da parte 12, em "Ficam para depois").
- **Medição no Chromium** (os harnesses das revisões, com o Firebase e a API
  falsos, só 127.0.0.1):
  - Pedidos com o arquivo da tela segurado 3 s: a caixa da rota até a tela
    chegar e, na mesma pintura, "Carregando pedidos…" e as linhas-fantasma
    (antes, de 300 a 410 ms sem indicador); falas: "Abrindo Pedidos" e o
    resumo. Igual no Receber e no celular de 390 px, escuro e reduzido;
  - de Pedidos para o Estoque, com o arquivo a 800 ms e a lista a 600 ms: só
    "Abrindo Estoque", dito enquanto a lista ainda lia (antes, "Carregando
    estoque" 1,46 s depois da lista);
  - aprovar com o servidor a 700 ms e a região ocupada: nada de "Aprovando
    pedido 1042" depois do "Aprovado";
  - a abertura com a demora: "Demorando mais que o normal" a 10,03 s e
    "Carregando pedidos" a 12,03 s (antes, 1,5 a 1,8 s entre as duas); sem
    rede, "Sem conexão" só pela abertura (antes, de novo pelo app a 5,9 s);
  - as fotos com a região ocupada: "Enviando 4 de 6 fotos", a demora e "4
    fotos enviadas";
  - o Agent Dute: o foco fica no campo depois do Enter numa conversa nova.

Fica aberto:

- o resumo que esperava a vez e foi trocado por um anúncio que depois saiu da
  fila (aprovar logo depois de a lista chegar) não volta: no Anunciador, só o
  último pedido vale;
- a passagem do `RoleGate` para o `Suspense` e as abas do Catálogo e do
  Faturamento seguem com o relógio que recomeça (parte 9);
- a conferência com leitor de tela de verdade (NVDA, VoiceOver) das falas
  na passagem da abertura.

**Parte 13a, os diálogos (PR 610, 13/11/2026).** É a necessidade 6 (seção 5),
o PR 7 da seção 6 e o PR 4 do celular (9.3), no app inteiro.

- **Um jeito só de segurar o diálogo durante a ação** (`components/ui/dialog.tsx`,
  `alert-dialog.tsx` e `sheet.tsx`, com o estado em `dialogo-em-acao.ts`),
  ligado pelo `ocupado` da raiz (`Dialog`, `AlertDialog`, `Sheet`) ou do
  `DialogContent`, quando a ação mora no conteúdo (o convite):
  - o `onOpenChange(false)` não chega a quem usa, e o Esc, o toque fora e o
    X não fecham; o conteúdo marca `data-ocupado`. O Esc e o toque fora, que
    escapam sem querer, esperam também o toque aceito no confirmar, antes de
    a ação chegar à tela: por até 300 ms, e daí quem segura é a ação. A
    falha que volta antes disso os solta na hora. O X e o Cancelar seguem o
    que dizem: sem `aria-disabled`, fecham;
  - o X e o Cancelar (o `DialogCancelar`, o `AlertDialogCancel`) ficam
    `aria-disabled` desde o toque, com a trava no código, nunca `disabled`.
    Eles esmaecem a 0,45 aos 300 ms, junto com o gerúndio do confirmar, e
    ficam assim pelo menos 500 ms, como ele; a ação que volta antes dos
    300 ms não os faz piscar. Do X, só o ícone esmaece: o anel do foco fica
    inteiro;
  - o `AlertDialogAction` é o `BotaoDeAcao` e nunca fecha sozinho (o
    `preventDefault` mora nele): quem fecha é o sucesso; na falha, a
    confirmação fica;
  - o confirmar é o `BotaoDeAcao` em todos, com o gerúndio ("Cancelando…",
    "Cadastrando…", "Salvando…"), e o foco fica nele durante a ação. O
    destrutivo cheio é o `perigo` dele (o vermelho sólido no repouso, no toque
    e travado): com a classe solta de antes, o confirmar travado mostrava o
    primário com o ponteiro em cima, azul fora da v3 e no escuro;
  - aos 10 s, o rodapé diz "Demorando mais que o normal · 0:12", em cima dos
    botões. Aos 70 s, "Sem confirmação do servidor", e o diálogo volta a
    fechar: a ação pode ter gravado ou não, e o confirmar segue nela. O
    diálogo da operação longa (o `Progresso`, as fotos, o aviso da tela) não
    repete o aviso e cuida da própria saída;
  - no fim, o foco volta ao controle que abriu o diálogo; o item do menu "⋯"
    vira o botão do menu. Se ele saiu da tela, ou sai logo depois (a linha
    que a releitura tira), o foco vai ao `focoAoFechar` de quem usa, ao
    vizinho dele na ordem do Tab (o controle da linha seguinte ou, sem ela,
    o da anterior, lidos na abertura) ou, sem nenhum, ao título da página,
    que vem até a borda quando está fora da vista; nunca ao `body`
    (`lib/foco-de-volta.ts`). A vigia do foco que voltou dura até
    `CARREGANDO.desisteMs` e acaba quando a pessoa leva o foco a outro
    lugar, também quando clica no fundo da página;
  - o `fecharTravado` da parte 11 saiu: os cinco diálogos dela (a chegada
    avulsa, a foto por IA, "Concluir separação", a entrega de Pedidos e
    Documentos) usam o `ocupado`.
- **No celular, em pé ou deitado** (a variante `celular` do `index.css`:
  menos de 768 px de largura ou menos de 500 de altura): o `DialogFooter`
  fica preso embaixo do diálogo que rola (`sticky`, cobrindo até a borda, com
  o fio de cima), com os botões de 44 px, também no `AlertDialogFooter`; o X
  do diálogo e do painel tem 44 px, e só o título deixa o lugar dele (dos dois
  lados quando está centrado, em pé; só à direita, deitado). O campo que
  recebe o foco não fica atrás do rodapé preso: o rodapé mede a própria
  altura, e o diálogo a guarda como `scroll-padding` embaixo. Com um diálogo
  aberto, o toast vai para o topo, porque embaixo ele cobria o rodapé preso,
  com o Voltar e a nova tentativa.
- **O que mudou, contra o código atual** (os 22 diálogos e as 4 confirmações
  da necessidade 6):
  - Pedidos: "Cancelar pedido" e "Salvar entrega" eram `disabled` e fechavam
    no meio; a recusa da solicitação fechava com "Recusando…". Agora os três
    seguram o diálogo, com o `BotaoDeAcao` e a mesma chave na nova tentativa.
    O diálogo que sai mostra o que mostrava até sair: antes, o fim trocava o
    conteúdo pelo vazio, o cartão caía para uma faixa só com o X e o foco
    ficava no `body` até ele sair;
  - Registrar exceção, Concluir inventário ("Encerrando…"), Receber retorno,
    Posições (Nova posição, Nova rua, Zona da rua), Falta da linha, Recusa
    da prateleira (e o Liberar da guarda), Guardar do RECEBIMENTO, Tabela de
    preços (o item), Sistema (Registrar incidente), owner (Preços e
    orçamento), Infra (Tabela do faturamento), Produtos e SKUs (o cadastro e
    o Excluir ou Arquivar), Recusar solicitação: fechavam no meio da ação e
    desligavam os botões;
  - Concluir inventário fecha no sucesso: antes, o diálogo só sumia porque a
    aba virava "Contagem cíclica", e com a aba escolhida à mão ele ficava
    aberto, pronto para outro envio;
  - Infra e owner fecham quando o POST vale, e a releitura do painel segue
    por trás: esperar por ela deixava o diálogo "Salvando…" e preso enquanto
    o Google Cloud respondia;
  - Clientes (Novo cliente e Arquivar), Convite, Reenviar, Remover da lista e
    Revogar acesso: o Esc já não fechava em quase todos, mas o Revogar
    fechava, e os botões `disabled` derrubavam o foco no `body`. O Revogar e
    o Devolver acesso são a mesma mutação: o diálogo segura só a revogação
    daquela pessoa, e o item "Revogar acesso" espera, como o "Devolver
    acesso", enquanto ela grava;
  - as quatro confirmações (Emitir, Remover item, Remover posição, Apagar
    rotina), pela `Confirmacao`: não fechavam mais no clique desde 06/11, mas
    o confirmar e o Cancelar ficavam `disabled`. Enquanto sai, ela mostra o
    texto de quando estava aberta, e não "Remover a posição ?";
  - o portal: o Editar evento só fecha depois do retorno (antes, fechar no
    meio desmontava a janela, e o aviso do salvo não chegava); o Excluir
    evento segura a confirmação e só fecha no sucesso (antes, fechava também
    na falha); o painel "Seu pedido" do Estoque fica aberto enquanto o pedido
    vai para a Dutelog, com o "Fechar pedido" `aria-disabled` e o Enviar no
    `BotaoDeAcao` ("Enviando o pedido…", no lugar do caminhão pulsando), e
    usa o jeito único: o pedido enviado tira da tela o "Pedido ·" que abriu
    o painel, e o foco vai ao título, não ao `body`;
  - as duas outras confirmações com `AlertDialogAction` (a foto do produto e
    "Marcar como cliente" do Comercial) passaram ao `BotaoDeAcao` também;
  - o Mapa do armazém, no celular: o painel da prateleira dentro do painel de
    baixo ficou sem o "Fechar" dele, que o X de 44 px cobria; ao lado da
    lista, ele continua;
  - o `BotaoDeAcao` solta a trava do toque duplo quando a pessoa mexe no
    formulário dele: o nome que a validação recusou, corrigido e salvo de
    novo logo depois, era engolido sem aviso.
- **O que já estava feito**: a entrega de Pedidos ("Confirmar entrega"),
  "Concluir separação", Documentos e a chegada avulsa seguravam o diálogo
  desde a parte 11, e o Esc não fechava Clientes nem Pessoas; mudaram só
  para o `ocupado`, com o X e o rodapé novos.
- **Testes**: por peça (`components/ui/dialogo-em-acao.test.tsx`,
  `lib/foco-de-volta.test.ts`, `confirmacao.test.tsx`,
  `botao-de-acao.test.tsx`, `toast.test.tsx`): o Esc, o toque fora, o X e o
  Cancelar não fecham durante a ação nem logo depois do toque, o Cancelar e o
  X ficam `aria-disabled` e esmaecem aos 300 ms, o aviso dos 10 s e a saída
  dos 70 s, o foco fica no botão tocado e volta ao gatilho, ao vizinho ou ao
  título, e o axe; por área: Pedidos (`pedidos.dialogos.test.tsx`, também a
  saída sem esvaziar), Posições (`warehouse-positions.dialogos.test.tsx`),
  Documentos, Clientes, Pessoas (`pessoas/acoes.test.tsx`), o Sistema
  (`system/dialogos-que-gravam.test.tsx`), a Contagem
  (`inventory-concluir.test.tsx`), o Mapa (`warehouse-map-painel.test.tsx`) e
  o portal (`eventos-editar.test.tsx`, `eventos-excluir.test.tsx`,
  `estoque-envio.test.tsx`). Contra o commit de antes da parte, 26 deles
  falham, e o do foco de volta nem carrega; os da revisão da parte, 33 em 14
  arquivos, falham contra a primeira versão dela.
- **Medição no Chromium** (harness com a API falsa e o servidor a 3 s, só
  127.0.0.1, no build de produção):
  - "Cancelar pedido", "Nova rua" e "Remover a posição": antes, o foco caía
    no `body` 100 ms depois do toque, e o Esc, o toque fora, o X e o
    Cancelar fechavam os dois primeiros no meio da gravação; depois, o foco
    fica no botão de ação ("Cancelando…") e nenhum dos quatro fecha. O Esc
    dado de 2 a 15 ms depois do Enter, antes de a ação chegar à tela (de 13
    a 63 ms, também com a CPU 4× mais lenta), não fecha em 15 de 15; antes,
    fechava com a gravação andando;
  - o esmaecer: na recusa sem rede (30 ms) e no erro aos 120 ms, o Voltar e
    o X ficam inteiros; na ação lenta, o Voltar vai a 0,45 aos 327 ms e o
    ícone do X, de 0,70 a 0,45 em 200 ms;
  - com o servidor parado: aos 12 s, "Demorando mais que o normal · 0:12" em
    cima dos botões, e aos 69,5 s, "· 1:09"; aos 70 s, a callable desiste,
    o diálogo destrava e o toast diz "O servidor não respondeu a tempo";
  - o fim: em Posições, o foco vai ao "Nova rua" que abriu o diálogo; na
    posição removida do fim de uma lista de 40, rolada, ao "Editar" da
    vizinha, à vista. No "Cancelar pedido", o diálogo que sai fica com os
    646 px e o conteúdo, com o foco no botão, até ir ao "Separar";
  - no celular de 390 × 664: o X passou de 28 para 44 px; o botão de ação,
    que ficava fora da vista, fica preso a 77 px da borda de baixo; pelo Tab,
    nenhum campo fica atrás do rodapé preso, na Nova posição e num
    formulário de nove campos;
  - deitado, em 844 × 390: o rodapé fica preso, com os botões de 44 px à
    vista, e o X tem 44 px; no computador nada muda;
  - em 390 × 844, sem rede: o toast fica de 8 a 106 px, o Voltar (712 a
    756) fica livre, e o toque nele fecha o diálogo;
  - o anel do foco do X tem de 4,22 a 6,04:1 contra o fundo, no claro e no
    escuro, na v3 e fora dela; o ícone, de 5,21 a 9,31:1;
  - o confirmar destrutivo travado, com o ponteiro em cima, fica no mesmo
    vermelho do repouso, nos dois temas;
  - no Mapa do celular, um "Fechar" só, de 44 px.

Fica aberto:

- o teclado do celular: o rodapé fica preso na altura do diálogo, mas o
  Chrome do Android não encolhe a página quando o teclado abre (falta o
  `interactive-widget=resizes-content` no `viewport`, que muda o app
  inteiro) e o Safari não encolhe nada;
- o "Sem conexão" dentro do diálogo, como pede a necessidade 9 do celular
  (9.2): por ora, com um diálogo aberto, o toast vai para o topo, e por 5 s
  cobre o título e o X (o Voltar e a nova tentativa ficam livres). Dentro do
  diálogo, ele pede um desenho;
- o aviso dos 10 s entra sem lugar guardado: no computador, o diálogo
  centrado cresce 44 px, e os botões descem 22 px (no celular, o rodapé
  preso cresce para cima, e o botão tocado não sai do lugar). Os diálogos da
  operação longa (parte 11) guardam o lugar;
- o "Conferir" dos 70 s, que relê e nunca reenvia, fica com as telas que
  sabem conferir (a entrega de Pedidos, Documentos); nas outras, "Sem
  confirmação do servidor" e o diálogo que volta a fechar;
- o "fieldset" `disabled` da chegada avulsa durante o envio, que desliga o
  Cancelar e o "Criar conferência"; e os diálogos fora da lista (Trocar de
  caixa, Conferir e fechar, Remover rascunho, Remover linha e caixa da
  abertura, o Comercial, a Operação e o RH), que seguram o diálogo do jeito
  antigo, com `disabled` (*o `fieldset` saiu na parte 13c; os diálogos da
  abertura seguram como os outros desde a 13b, e os do Comercial, da
  Operação e do RH, desde a 13g; registros abaixo*);
- o X do diálogo longo rola com o conteúdo, como antes;
- o Recusar da linha (parte 4) ainda esmaece no toque, e não aos 300 ms; o
  "⋯" de Pedidos fica `disabled` enquanto outra ação grava;
- a conferência com leitor de tela de verdade, num Android médio e no
  Safari; o anel do foco do `Button` (1,91:1), da parte 6.

**Parte 13b, o Estoque e o armazém (PR 610, 13/11/2026).** A migração das
seções 4.4, 4.6 e 4.7 (Estoque › Itens e Alertas, a Contagem com a abertura e
a contagem cíclica, o Mapa, as Posições e as Etiquetas) e, de 4.5, as Exceções
e o painel da tarefa (`task-detail.tsx`). As necessidades 2, 3, 5, 8 e 10 da
seção 5, conferidas contra o código atual.

- **O que já estava feito**, e ficou: o "Retomar guarda" que só gira com a
  guarda retomada (PR 581); no Estoque e nos Alertas, a linha de estado, o
  Atualizar, os filtros sem "0" antes de ler e a releitura que falha na linha
  (partes 7b, 8 e 10); as fotos da ficha e da Contagem (parte 11); os
  diálogos de Posições, do Concluir inventário e do Guardar do RECEBIMENTO
  (parte 13a); o "Avançar" ocupado até a releitura (parte 10); e o `Skeleton`
  neutro nas telas de desenho fixo (parte 3).
- **O ícone antigo girando** (17 `RefreshCw` com `animate-spin` na Contagem,
  no painel da tarefa, nas Exceções e no "Corrigir caixa") saiu:
  - as ações viraram o `BotaoDeAcao`, ocupado sem `disabled` e com o
    gerúndio: "Iniciar contagem" e "Iniciar conferência da caixa"
    ("Iniciando…"), "Confirmar guarda em B-05" ("Guardando…"), o lançamento
    ("Salvando…"), "Reabrir para ajustar", "Reabrir conferência"
    ("Reabrindo…"), "Voltar à conferência" ("Voltando…"), "Retomar guarda",
    "Registrar contagem" ("Registrando…"), os cinco "Registrar"/"Enviar
    evidência" do painel da tarefa ("Registrando…"), "Confirmar tratativa"
    ("Confirmando…"), "Carregar mapa inicial" ("Carregando o mapa…") e, nos
    Alertas, "Enviar ao cliente" e "Descartar" ("Enviando…", "Descartando…"),
    cada um só com a própria espera, no lugar do "Gravando..." dos dois;
  - a alternativa tocada do "Se preferir" diz "Guardando em B-06…" com a
    caixa, e as outras esperam com `aria-disabled`;
  - as esperas em bloco ("Verificando o catálogo…", "Consultando a
    sugestão…", "Conferindo o encaixe nesta prateleira…", "Carregando
    posições…", "Carregando movimentos…", "Carregando caixas…",
    "Carregando exceções…", "Carregando a contagem…", "Carregando as
    etiquetas…" e "Verificando inventário de BTG Pactual…") são a
    `CarregandoNaRegiao`: nada antes de 300 ms, a caixa de 24 px e o anúncio
    pelo Anunciador. Os dois `role="status"` soltos (a sugestão da abertura e
    a verificação do Mapa) saíram; o seletor de prateleira ganhou a caixa ao
    lado de "Carregando prateleiras…";
  - o Atualizar das Exceções passa pelo `useAtualizarLista`: só mostra a
    espera quando a pessoa toca nele, e a releitura automática não o gira nem
    o desabilita (antes, girava e desligava a cada releitura).
- **Os diálogos que a parte 13a deixou abertos na abertura** seguram como os
  outros (o `ocupado`, o `DialogCancelar` e o `BotaoDeAcao`): Conferir e
  fechar ("Fechando…"), Remover rascunho, Remover para corrigir e Remover
  caixa ("Removendo…") e Corrigir caixa ("Corrigindo…", com a mesma chave na
  nova tentativa).
- **Erro nunca vira vazio** (necessidade 2): a leitura que falhou sem nada
  lido mostra o aviso com "Tentar de novo", que fica na tela enquanto tenta
  (`useLeituraComFalha`), e diz "Tentando de novo…" só com a leitura que
  falhou relendo:
  - Estoque: os saldos ou as fotos que falham (antes, a lista aparecia com
    "Sem endereço" e nenhum aviso; o catálogo que falhava dizia o erro sem
    "Tentar de novo"); os últimos movimentos da ficha (antes, "Nenhum
    movimento registrado.");
  - Exceções: antes, "Sem exceções abertas";
  - Posições: antes, a tabela vazia ("Nenhuma posição com esses filtros", "0
    de 0 posições") junto do alerta;
  - Mapa, Etiquetas, Alertas, a sessão e a conferência da abertura, as
    prateleiras e o catálogo da abertura e as caixas da sessão.
- **A releitura que falha não apaga a lista** (necessidade 8): o Mapa (antes,
  a releitura do intervalo que falhava trocava o mapa pelo alerta), as
  Etiquetas (a releitura depois de registrar a impressão) e a abertura (a
  sessão relida depois de cada gravação, que trocava a bancada pelo alerta)
  ficam na tela. O
  Mapa e as Posições ganharam a linha de estado sob o título ("Carregando o
  mapa…", "Carregando posições…", "Atualizado às", "Não consegui atualizar ·
  lista de", "Reconectando…", "Sem conexão"), no lugar da faixa que empurrava
  o mapa. No Mapa, enquanto ele lê, a caixa é só a da linha: "Verificando
  inventário" entra depois.
- **Nunca vazio nem zero antes de ler** (necessidade 3): a lista do Estoque
  só entra com o catálogo, os saldos e as fotos lidos, e Parados e Sem giro
  ficam sem número até os dias parado chegarem; o painel do progresso da
  abertura mostra o bloco no lugar de Caixas e Posições ocupadas, "—" sem a
  sessão e "Carregando caixas…" no lugar de "Nenhuma caixa nesta sessão."; o
  Mapa espera também os saldos e o catálogo (a busca dizia "Nenhuma
  prateleira" antes de ler); as Exceções não dizem "0 aberta(s)" nem "Nada
  selecionado"; as Etiquetas não dizem "0 etiquetas · 0 folhas".
- **A reticência**: "Gravando..." e o "Auditoria, foto, inventário..." da
  contagem cíclica viraram "…"; "Carregando posições." e "Tentar novamente"
  passaram a "Carregando posições…" e "Tentar de novo".
- **O toque duplo nos Alertas**: o Enviar é o mesmo botão de um alerta para o
  seguinte, e o segundo toque dentro de 1 s é ignorado (o toque único do
  `BotaoDeAcao`): o toque duplo não envia o alerta que acabou de entrar na
  tela sem ninguém o ver.
- **A trava da área** (`features/warehouse-ops/carregamento-do-armazem.test.ts`):
  nas telas da área, nenhum `animate-spin`, `animate-pulse` ou `Loader2`,
  nenhum `role="status"` nem `aria-live` solto e nenhum texto com três
  pontos. A trava do app inteiro é a parte 13h.
- **Testes**: um por tela (`estoque.carregamento`, `warehouse-map.carregamento`,
  `warehouse-positions.carregamento`, `warehouse-labels.carregamento`,
  `exceptions`, `inventory-carregamento`, `task-detail.carregamento`,
  `opening-line-correction`) e os de antes atualizados (Alertas, o resumo da
  caixa, o seletor de prateleira, o Estoque e o Mapa), com a lista de textos e
  o axe. Contra o `e6b449d`, 45 dos 100 testes dos 17 arquivos falham.
- **Medição no Chromium** (harness com a API falsa, só 127.0.0.1; antes é o
  `e6b449d`):
  - Estoque com o catálogo a 100 ms e os saldos e as fotos a 3 s: antes, as
    linhas entravam aos 102 ms com "Sem endereço" e "Sem foto" por 2,9 s (174
    quadros); depois, nenhum quadro com eles, e as linhas entram aos 2,99 s,
    com os dados;
  - os saldos que falham: antes, 3 linhas sem endereço e nenhum aviso;
    depois, o aviso com "Tentar de novo" e nenhuma linha. Os movimentos da
    ficha: antes, "Carregando..." seco de 11 ms a 2 s e, na falha, "Nenhum
    movimento registrado."; depois, "Carregando movimentos…" aos 274 ms e o
    aviso na falha;
  - Posições na falha: antes, a tabela com "Nenhuma posição com esses
    filtros" e "0 de 0 posições"; depois, só o aviso. "Carregar mapa
    inicial" com o servidor a 3 s: antes, `disabled` e o foco no `body` de
    40 ms ao fim (155 de 157 quadros), sem `aria-busy` nem rótulo, e quatro
    botões do cabeçalho `disabled`; depois, o foco no botão em todos os
    quadros, "Carregando o mapa…" e `aria-busy` aos 325 ms, e "Nova rua" e
    "Nova posição" com `aria-disabled` (ficam `disabled` só os que não têm o
    que fazer: "Imprimir etiquetas" e "Zona da rua", sem posição);
  - Mapa: a releitura que falha apagava o mapa (o alerta no lugar); depois,
    o mapa fica e a linha diz "Não consegui atualizar". Na primeira leitura,
    antes, o texto "Verificando inventário…" num `role="status"` solto e
    nada sobre o mapa; depois, "Carregando o mapa…" aos 285 ms, uma caixa só
    e nenhuma região viva solta;
  - Contagem com as caixas a 3 s: antes, "Caixas 0", "Posições ocupadas 0" e
    "Nenhuma caixa nesta sessão." por 3 s (181 quadros); depois, nenhum.
    "Iniciar conferência da caixa" com o servidor a 3 s: antes, o foco no
    `body` de 42 ms ao fim e o `RefreshCw` girando; depois, o foco no botão,
    a caixa chanfrada e "Iniciando…" aos 326 ms;
  - Exceções: antes, "0 aberta(s)" e "Nada selecionado" por 2 s de leitura,
    "Sem exceções abertas" na falha, e o Atualizar girando e `disabled` em
    todos os quadros da releitura automática, com o foco no `body` no toque;
    depois, nada disso, e o toque deixa o foco no botão, com `aria-busy` aos
    305 ms;
  - Alertas, "Enviar ao cliente" com o servidor a 3 s: antes, "Gravando..."
    de 31 ms ao fim, o foco no `body` e as três marcas `disabled`; depois,
    "Enviando…" aos 322 ms, o foco no botão e nenhuma marca `disabled`;
  - Etiquetas com as caixas a 3 s: antes, "0 etiquetas · 0 folhas" em todos
    os quadros (170); depois, nenhum;
  - nenhuma rolagem lateral nas capturas de 1440 e 390 px; o axe-core, no
    claro e no escuro, não acusa nada novo nas sete telas: ficam o
    `aria-controls` das abas (Estoque e Contagem), o cabeçalho da tabela a
    50% (Estoque, Alertas) e o primário no escuro (4,3:1), de antes desta
    parte.
- **A revisão (13/11/2026)**, com o que a lógica, o navegador e o leitor de
  tela mostraram:
  - **A falha vem da cópia.** O Estoque, o Mapa, os Alertas e as Etiquetas
    juntam as leituras que falharam sem nada lido numa só para a
    `FalhaNaLeitura` (`lib/carregando/falha-das-leituras.ts`), a partir das
    cópias da `useLeituraComFalha`. Antes, a falta de conexão saía da leitura
    crua, cujo erro o react-query zera na nova tentativa: com o servidor sem
    resposta e nada lido, a releitura sozinha do estado da conexão (e o
    "Tentar de novo" do bloco) trocava o "Reconectando…" por "Não consegui
    carregar o estoque.", com o alerta, e no Estoque o foco saía do botão.
    Agora o "Reconectando…" fica até a leitura responder;
  - **"Tentando de novo…" só quando a pessoa pede.** Nenhuma tela da área usa
    mais o `ErroNaLeitura` direto, com o `isFetching` da leitura (a trava da
    área reprova): a releitura do intervalo (2 min no Estoque, no Mapa e nos
    Alertas) e a que segue uma gravação não mudam o aviso, que é um alerta e
    era lido de novo duas vezes. Nas Etiquetas e na abertura, a falta de
    conexão sem nada lido volta a ser "Sem conexão." ou "Reconectando…", e
    não o erro genérico;
  - **A leitura de apoio não tira a lista.** No Estoque, a falha só das fotos
    deixa a lista com o saldo e o endereço, e acima dela "Não consegui
    carregar as fotos." com "Tentar de novo"; as linhas não afirmam "Sem foto"
    (o lugar da foto fica neutro), e o filtro Sem foto fica sem número e sem
    lista até ler. A primeira leitura continua esperando as fotos. No Mapa, o
    mapa são as posições e as caixas: os saldos esperam a primeira leitura
    (a prateleira com saldo sem caixa registrada não parece vazia), mas a
    falha deles não tira o mapa ("Não consegui carregar os saldos das
    prateleiras."); o catálogo nem espera, e a busca por nome diz "Carregando
    o catálogo…" até ele chegar, no lugar de "Nenhuma prateleira tem o que
    você buscou.";
  - **O foco nunca cai no `body`.** Quando a nova tentativa dá certo e o aviso
    sai com o foco nele, o foco vai à linha de estado (Exceções, Alertas e a
    situação do inventário no Mapa), ao resumo da impressão (Etiquetas), ao
    título da seção (os últimos movimentos da ficha) e, na abertura, ao
    título das caixas da sessão, da caixa aberta, do "Guardar em" ou do
    cartão. Quando a ação dá certo e o botão sai da tela, o foco vai ao que
    entrou no lugar (`SaiComOFoco`, em `lib/carregando/use-foco-que-segue.tsx`;
    desde a junção com a 13e, sobre a `segurarOFocoQueSai`): "Iniciar
    conferência da caixa" e a guarda, ao título da caixa; "Iniciar contagem",
    ao título do cartão; "Voltar à nova conferência", ao da nova caixa;
    "Carregar mapa inicial", à linha de estado das Posições;
  - **A abertura não afirma o que não leu.** As caixas da sessão precisam das
    caixas e da sessão lidas: até lá, o bloco no lugar do número e
    "Carregando caixas…"; sem a sessão, "—" e nada na lista, e o cabeçalho
    não diz "sessão concluída". Na Contagem, a sessão que falha abre na aba
    da abertura, onde está o aviso (antes, a tela abria na contagem cíclica e
    a falha não aparecia); na nova tentativa, a tela não volta a "Carregando
    a contagem…". Nas Etiquetas, a nota "Conteúdo da caixa" só aparece com a
    sessão lida;
  - **Os Alertas.** Cada alerta tem a chave dele: o "Enviando…" do decidido
    não passa ao seguinte (antes, com a resposta entre 300 e 800 ms, o alerta
    do outro cliente entrava com o Enviar ocupado e o toque ignorado). O foco
    vai ao título do alerta seguinte, e não ao Enviar do outro cliente. O
    toque repetido do mesmo gesto, no segundo depois da decisão, continua
    sem efeito, agora de propósito, na tela (o `toqueRepetido`);
  - **As Exceções.** O selo fica no lugar desde o começo, com o bloco no lugar
    do número e a mesma largura: o Atualizar não pula quando a contagem chega
    (antes, 86,7 px no celular). O Atualizar é o das listas (o
    `BotaoAtualizar`, 44 × 44 no celular, em que só o ícone vira a caixa), e
    a linha de estado sob o título do cartão diz "Atualizado às" e "Não
    consegui atualizar · lista de" quando o toque falha com a lista lida
    (antes, só o leitor de tela ficava sabendo). O teste delas passou ao
    relógio simulado: a espera de 300 ms dependia da máquina e reprovou a
    suíte uma vez;
  - **As esperas feitas à mão.** A alternativa do "Se preferir" é o
    `BotaoDeAcao`: a tocada fica cheia e diz "Guardando em A-04…" com a caixa
    aos 300 ms, por pelo menos 500 ms, e as outras esperam a 0,45. O seletor
    de prateleira espera com `aria-disabled`, sem o `disabled` a 50%, a caixa
    entra aos 300 ms, e a releitura das posições não o desliga mais. A
    releitura do catálogo depois de cada gravação não mostra a espera nem
    fala: só a primeira leitura diz "Verificando o catálogo…". Na guarda,
    "Carregando posições…" aparece uma vez, a da região;
  - **Nenhum botão que troca de rótulo dentro de um alerta.** A "Situação do
    inventário indisponível" do Mapa e o "Catálogo indisponível" da abertura
    viraram o aviso da falha ("Não consegui confirmar o inventário de
    abertura de BTG Pactual.", "Não consegui carregar o catálogo. O cadastro
    de produto novo foi bloqueado para evitar duplicidade."), e o quadro
    "Nenhuma posição cadastrada" das Posições deixou de ser alerta;
  - **Os rótulos.** O gerúndio é o do próprio verbo: "Enviar evidência" diz
    "Enviando…"; "Carregar mapa inicial", "Carregando mapa inicial…";
    "Confirmar guarda em B-05", "Guardando em B-05…", como a alternativa. A
    linha do Mapa diz "Carregando prateleiras…" (o objeto no plural, como nas
    outras listas), e a espera das Etiquetas, "Carregando etiquetas…";
  - **O toque no celular.** As ações migradas têm 48 px no celular:
    "Carregar mapa inicial", "Iniciar contagem", "Iniciar conferência da
    caixa", "Confirmar guarda", as alternativas, "Confirmar tratativa",
    "Enviar ao cliente" e "Descartar". Os "Tentar de novo" são os do aviso
    da falha, de 44 px;
  - **Testes**: novos no Estoque, no Mapa (`warehouse-map.falhas`), nos
    Alertas (`estoque-alertas.falhas`), nas Etiquetas
    (`warehouse-labels.falhas`), na abertura (`inventory-falhas`), nas
    Exceções, no seletor e no painel da tarefa, com a lista de textos dos
    estados novos, e a trava da área reprova o `ErroNaLeitura` direto e o
    gerúndio de outro verbo. Contra o `c8eaa31`, 48 dos 107 testes dos 15
    arquivos mudados reprovam (um só em cascata: sozinho, passa).
- **Medição da revisão no Chromium**, no mesmo harness (a API falsa, só
  127.0.0.1):
  - a releitura do intervalo com a leitura falhando, no Estoque, no Mapa e
    nos Alertas: 181 quadros seguidos com "Tentar de novo" e o foco nele, sem
    "Tentando de novo…" (antes, a troca a cada releitura);
  - Alertas com o servidor a 400 ms: de 482 ms em diante, o alerta seguinte
    com "Enviar ao cliente" em repouso e o foco no título dele (antes,
    "Enviando…" no alerta seguinte até 881 ms);
  - Estoque com só as fotos falhando: as 4 linhas, com o endereço e o saldo,
    e o aviso das fotos (antes, nenhuma linha);
  - Etiquetas sem rede: "Sem conexão." e, na volta, "Reconectando…" e as
    etiquetas; as caixas da abertura sem rede: "Reconectando…";
  - o foco depois do "Tentar de novo" que dá certo, em dez casos (Exceções,
    Etiquetas, Alertas, caixas e sessão da abertura, Estoque, Mapa, situação
    do inventário, Posições e movimentos): sempre no que ficou, nunca no
    `body`; depois de "Iniciar conferência da caixa", "Iniciar contagem",
    "Carregar mapa inicial" e da guarda, no que entrou no lugar;
  - a alternativa tocada: cheia e "Guardando em A-04…" com a caixa aos
    ~300 ms do toque, o texto a 14,4:1 (antes, 2,6:1, a 0,45), e as outras a
    0,45; o seletor esperando: sem `disabled`, a caixa aos ~300 ms do toque,
    o rótulo a 5,3:1 no claro e 7,4:1 no escuro (antes, 3,1:1);
  - Exceções a 390 × 844 com a leitura a 3 s: o Atualizar parado em x =
    133,7 do começo ao fim, com 44 × 44 e a caixa de 20 px;
  - a Contagem com a sessão falhando abre na aba da abertura, com o aviso,
    sem tocar;
  - nenhuma rolagem lateral a 390 px, e o axe-core, no claro e no escuro, com
    as mesmas violações de antes desta parte, nenhuma nova.

Fica aberto:

- as Devoluções (a `ReturnWorkspace`, no mesmo arquivo das Exceções) e a
  espera do catálogo na contagem cíclica ("Produto ainda não localizado"
  antes de ler) são da parte 13c (o PR 2 da seção 6);
- na abertura, os botões vizinhos da ação em andamento (Trocar caixa,
  Cadastrar caixa já armazenada, Não cabe aqui, Imprimir etiqueta, Abrir, o
  Editar e o remover dos rascunhos) seguem `disabled`, também durante a
  releitura da conferência (o `conferenceBusy` inclui o `isFetching`, que
  guarda a revisão esperada); o botão tocado nunca fica;
- o toque repetido nos Alertas, no segundo depois de uma decisão, não decide
  o alerta seguinte: é proteção de propósito, mas muda o comportamento, e
  vale confirmar com o Leonardo;
- no painel da guarda, "Não consegui consultar as posições." ainda é texto
  seco, sem "Tentar de novo";
- o Mapa e as Posições não têm Atualizar, nem a barra do topo na volta do
  app ao primeiro plano; aos 70 s, nenhuma lista desta área diz "Sem resposta
  do servidor.", como as outras;
- os dias parado que falham deixam Parados e Sem giro sem número e sem aviso;
- a conferência com leitor de tela de verdade e num Android médio.

**Parte 13c, Receber, Operações, Pedidos e Solicitações (PR 610, 13/11/2026).**
A migração das seções 4.3 e 4.5 que as partes 6 a 13b não cobriram: o Receber
(a ficha por linha, a chegada avulsa, a chegada por caixa, o destino e a guarda
da caixa, o cancelamento e o Guardar do RECEBIMENTO), as Operações (a bancada,
que hoje só abre na Qualidade), as Devoluções e os Retornos da Operação, o que
sobrava de Pedidos (a bancada de separação, o romaneio, a lista de separação,
o pedido separado, a entrega e as fotos), o Pedidos legado e as Solicitações.
Fecha também o PR 2 da seção 6. As necessidades 2, 3, 5, 8 e 10 da seção 5,
conferidas contra o código atual.

- **O que já estava feito**, e ficou: a lista do Receber com a linha de estado,
  os avisos com a falha e a troca de cliente (partes 7b, 8 e 10); a chegada
  avulsa que espera o catálogo (PR 581) e as fotos dela (parte 11); "Para
  aprovar" com a ação por linha (parte 6); o "Avançar" e o "Concluir entrada"
  ocupados até a releitura (parte 10); os diálogos de Pedidos, da falta da
  linha, da recusa da prateleira, do Guardar do RECEBIMENTO, do Registrar
  exceção e do Receber retorno (parte 13a); e o painel da tarefa e as Exceções
  (parte 13b). O alerta de erro da guarda já era `role="alert"` (o do `Alert`).
- **O PR 2 da seção 6** (necessidade 1): as Devoluções e a contagem cíclica
  esperam o catálogo antes de dizer "não localizado" ou "Produto ainda não
  localizado", com a mesma espera da chegada avulsa e da abertura. As peças
  `CatalogoVerificando` e `CatalogoIndisponivel`
  (`features/warehouse-ops/product-identity.tsx`) passaram ao carregamento
  v2: a espera em bloco (`CarregandoNaRegiao`, sem o `role="status"` solto) e
  a `FalhaNaLeitura`, que fica na tela enquanto tenta de novo, diz "Sem
  conexão." ou "Reconectando…" na falta de conexão e leva o foco ao código
  digitado quando o catálogo chega. Com o catálogo falhando, a linha diz "sem
  catálogo", e nada se registra (as duas telas só aceitam produto já
  cadastrado). Na chegada avulsa, a falha também vem da cópia
  (`useLeituraComFalha`): antes, "Tentar de novo" sumia com o foco nele e
  voltava a "Verificando o catálogo".
- **O ícone antigo girando** (o `RefreshCw` e o `Loader2` com `animate-spin`)
  saiu da área, e as ações viraram o `BotaoDeAcao`, ocupado sem `disabled` e
  com o gerúndio: "Salvar conferência" ("Salvando…"), "Divergência"
  ("Registrando…"), "Concluir entrada" ("Concluindo…"), "Criar conferência"
  ("Criando…", com o rodapé fora do `fieldset` que desligava o Cancelar e o
  envio, o que a 13a deixou aberto), "Cancelar recebimento" ("Cancelando…"),
  "Confirmar destino em B-02" ("Confirmando…"), "Concluir guarda em B-02"
  ("Guardando em B-02…"), "Registrar devolução" e "Registrar disposição"
  ("Registrando…"), "Encerrar" e "Aprovar e separar" ("Encerrando…",
  "Aprovando…", no lugar dos três pontos), "Registrar diferença" e "Confirmar
  caixas" (que seguram o diálogo, como os da 13a), "Fechar volume"
  ("Fechando…") e, na bancada de separação, "Separar", "Levar a caixa" e
  "Desfazer" ("Separando…", "Levando…", "Desfazendo…"). Na chegada por caixa,
  "Iniciar caixa", "Adicionar à caixa" e "Salvar quantidade", "Remover produto
  da caixa", "Remover caixa", "Fechar caixa", "Reabrir para ajustar",
  "Concluir entrada" e "Desmarcar" mostram a espera de cada um (a ação em
  curso fica num estado da tela, fora da chave de idempotência). O Atualizar
  das Solicitações e da bancada de Operações é o das listas
  (`BotaoAtualizar` com o `useAtualizarLista`): a releitura automática não o
  gira nem o desliga. A caixa do "Conferindo saldo" das Solicitações é o
  `Spinner`.
- **A ação por linha** (necessidade 5): a disposição das Devoluções é o
  `useAcaoNaLinha` (antes, a espera de uma linha desligava todas), com a chave
  por tentativa; registrada, o foco vai à linha registrada. A bancada de
  separação guarda a ação de cada linha (o `ocupadas` virou um mapa), e o
  "Separar menos" e o "Outra caixa" só esperam a gravação da linha deles, não
  a de qualquer linha. A linha que muda de estado leva o foco ao botão que
  entra no lugar ("Separar" vira "Desfazer", e o contrário). O vínculo do
  aviso no Receber mostra a caixa na opção tocada, e as outras esperam com
  `aria-disabled`. "Concluir entrada" espera a conferência que salva, e a
  conferência espera a entrada que conclui (antes, a entrada concluía com a
  contagem de antes).
- **Nenhuma região viva solta**: os `role="status"` e o `aria-live` da
  chegada por caixa saíram; o retorno ("Quantidade salva nesta caixa") fica
  escrito e o Anunciador diz a primeira frase dele; a espera é a do botão.
  "Consultando a sugestão…" e "Conferindo o encaixe nesta prateleira…" são a
  `CarregandoNaRegiao`.
- **Erro nunca vira vazio nem some** (necessidade 2): as pendentes das
  Devoluções que falham não dizem mais "Nenhuma devolução recém registrada";
  os Retornos da Operação que falham não somem (o aviso com "Tentar de novo",
  que assina a leitura ao vivo de novo e fica até ela responder), e as linhas
  do retorno que falham não ficam em "Carregando..." para sempre; a sugestão
  do destino que falha fica na tela enquanto tenta de novo; o Guardar do
  RECEBIMENTO diz o motivo, com "Tentar de novo"; a bancada de Operações é a
  `FalhaNaLeitura`; as Solicitações sem nada lido mostram a falha com "Tentar
  de novo", e a entrega dos pedidos que não carregou diz "Não consegui
  carregar a entrega.".
- **A releitura que falha não apaga a lista** (necessidade 8): nas
  Solicitações, a releitura que falhava trocava a fila lida por "Não consegui
  carregar a fila."; agora a fila fica, e a linha de estado sob o título diz
  "Não consegui atualizar · lista de 10:42" (a falta de conexão também, no
  lugar da `FaixaSemConexao`). A sugestão do destino já lida não sai mais da
  tela na releitura.
- **Nunca vazio nem zero antes de ler** (necessidade 3): o Pedidos legado
  mostra "—" nos quatro cartões até ler (antes, "0" por toda a leitura e na
  falha), com as linhas-fantasma e "Carregando pedidos…" na linha de estado,
  no lugar do texto seco numa célula; a foto dos itens de Pedidos e das
  Solicitações fica neutra até as três leituras chegarem (antes, o ícone de
  "sem foto"); a linha do pedido em "Para entregar" só oferece a entrega
  depois de ler as entregas (antes, "Entrega" no lugar de "Alterar entrega",
  e o formulário abria vazio sobre a entrega que existia); o endereço da
  prateleira na guarda tem o lugar reservado até chegar. As Solicitações têm
  a linha de estado ("Carregando solicitações…") e os cartões-fantasma, no
  lugar de "Carregando solicitações...". A bancada de separação, o romaneio,
  a lista de separação e os volumes do pedido separado trocaram o
  "Carregando" seco pela espera em bloco ("Carregando o pedido…",
  "Carregando volumes…").
- **A reticência**: os rótulos e os placeholders da área com três pontos
  passaram a "…", e "Tentar novamente" a "Tentar de novo".
- **A trava da área** (`features/warehouse-ops/carregamento-do-recebimento.test.ts`):
  nos 31 arquivos da área, nenhum `animate-spin`, `animate-pulse` ou
  `Loader2`, nenhum `role="status"` nem `aria-live` solto (os cartões de
  identificação de `product-identity.tsx`, que não são espera, ficam fora; o
  catálogo, não), nenhum texto ou placeholder com três pontos e nenhum
  "Carregando" seco. A trava do app inteiro é a parte 13h.
- **Testes**: novos nas Devoluções e na contagem cíclica
  (`devolucoes-e-contagem.carregamento`), na ficha da chegada
  (`receiving.carregamento`), nas Solicitações
  (`customer-requests.carregamento`), no Pedidos legado e na bancada de
  Operações (`orders.carregamento`), no Guardar do RECEBIMENTO
  (`guardar-da-area.carregamento`), na entrega de Pedidos
  (`pedidos.entrega-lida`), nos Retornos, nas fotos dos itens e nas vistas de
  Pedidos; os de antes atualizados (a chegada por caixa, o destino e a guarda,
  o cancelamento, o "Separar menos", o "Outra caixa", a bancada de separação,
  a chegada avulsa, o catálogo e o Receber), com a lista de textos (as
  camadas do `BotaoDeAcao` incluídas) e o axe. Contra o `67ff53c`, 57 dos 287
  testes dos 29 arquivos novos ou mudados falham.
- **Medição no Chromium** (harness com a API falsa, só 127.0.0.1; antes é o
  `67ff53c`):
  - Devoluções com o catálogo a 3 s: antes, "não localizado" e "Não crie SKU
    duplicado" em 160 de 193 quadros (de 15 ms a 2,7 s); depois, nenhum, e
    "Verificando o catálogo…" de 310 ms até o catálogo chegar. Com o catálogo
    falhando: antes, "não localizado" e nenhum aviso; depois, "Não consegui
    carregar o catálogo." com "Tentar de novo";
  - contagem cíclica com o catálogo a 3 s: antes, "Produto ainda não
    localizado" em 161 quadros; depois, nenhum, e "Verificando o catálogo…"
    aos 295 ms;
  - "Registrar disposição" com o servidor a 3 s: antes, o foco no `body` em
    173 de 175 quadros, o botão tocado e o da outra linha `disabled` o tempo
    todo e o ícone girando; depois, o foco no botão, "Registrando…" aos
    307 ms, a outra linha livre e nada girando;
  - Solicitações a 390 px com a leitura a 2,5 s: antes, "Carregando
    solicitações..." de 1 ms ao fim; depois, "Carregando solicitações…" na
    linha de estado aos 285 ms, os cartões-fantasma e nenhuma rolagem
    lateral. A releitura que falha: antes, a fila sumia ("Não consegui
    carregar a fila."); depois, ela fica, e a linha diz "Não consegui
    atualizar". "Aprovar e separar" com o servidor a 3 s: antes, o foco no
    `body` em 174 quadros, "Aprovando..." e os dois botões `disabled`;
    depois, o foco no botão, "Aprovando…" aos 318 ms e nenhum `disabled`;
  - a ficha da chegada, "Salvar conferência" com o servidor a 3 s: antes, o
    foco no `body` em 173 de 175 quadros, o ícone girando e "Concluir
    entrada" livre em todos os quadros; depois, o foco no botão, "Salvando…"
    aos 320 ms e "Concluir entrada" ocupado (livre só no primeiro quadro, o do
    toque);
  - Pedidos legado com a leitura a 2,5 s: antes, os quatro cartões em "0" e
    "Carregando pedidos..." em todos os quadros; depois, "—" e "Carregando
    pedidos…" na linha de estado aos 253 ms;
  - o axe-core nas Devoluções esperando o catálogo: nada no claro; no
    escuro, o mesmo contraste do primário de antes desta parte (4 nós, os
    botões de disposição).
- **A revisão (13/11/2026)**, com o que a lógica, o navegador e o leitor de
  tela mostraram:
  - **A repetição da disposição é a mesma tentativa.** A chave da disposição
    se repete depois da falha incerta (o `useAcaoNaLinha`), mas o corpo
    levava um `occurred_at` novo a cada toque, e o servidor, que compara o
    conteúdo inteiro com o da chave, recusava a repetição como "outro
    conteúdo" em vez de devolver o recibo. Agora a tentativa guarda o
    `occurred_at` da primeira vez, e a repetição manda o mesmo corpo. A
    callable e o resto do corpo não mudam. Na recusa, o botão diz "Não
    registrada" por 2 s e o motivo fica na linha até a próxima ação; aos 3 s,
    a linha diz "Registrando a disposição de Polo…"; aos 10 s, "Demorando mais
    que o normal · 0:12"; o Anunciador diz a espera, a demora e a desistência.
    A linha registrada diz a disposição em português ("Volta para
    disponível", e não "available");
  - **A bancada de Operações diz o estado dela.** O título e a linha de estado
    ficam desde a primeira leitura: "Carregando tarefas…" aos 300 ms, com o
    anúncio e a região ocupada apontando para ela; lida, "Atualizado às"; a
    releitura que falha com a bancada lida, "Não consegui atualizar · lista
    de 10:42", com "Tentar de novo" (antes, a bancada velha ficava sem nenhum
    sinal, e só o Anunciador dizia, quando a pessoa tocava no Atualizar);
  - **A entrada espera a releitura da conferência.** "Salvar conferência" só
    acaba quando a bancada relê: até lá, "Concluir entrada" espera, porque a
    chegada na ficha ainda é a de antes (sem a divergência que pede a
    justificativa). A gravação e a chave seguem as de antes;
  - **A falha é da leitura em que aconteceu.** Nos Retornos da Operação, a
    falha dos itens do pedido A não aparece mais no pedido B aberto em
    seguida: B espera os itens dele ("Carregando itens…"). A nova assinatura
    da leitura ao vivo virou uma peça, que a entrega dos pedidos também usa
    (na junção com a 13g, ela passou à própria `useLeitura`, em
    `lib/operacao/leitura.ts`): a entrega que não carregou diz "Não
    consegui carregar a entrega." com "Tentar de novo" na linha, que assina de
    novo e fica até a resposta; quando ela chega, o foco vai à entrega;
  - **Nada aparece antes de 300 ms.** Os cartões-fantasma das Solicitações e
    as linhas-fantasma do Pedidos legado ficam no lugar, invisíveis, e entram
    aos 300 ms, com o brilho; a leitura rápida não pisca nada. Os fantasmas
    têm a altura do dado (o cartão de 98 px, a linha de 61 px) e o legado
    reserva quantas linhas a última leitura trouxe, entre 1 e 5. A caixa do
    vínculo do aviso e a do "Conferindo o saldo" (agora em tinta) também
    esperam os 300 ms; vinculando, a opção diz "Vinculando…", que entra no
    nome dela, e o Anunciador diz. Nos cartões do Pedidos legado, o bloco no
    lugar do número enquanto lê, e "—" só na falha; a paginação não diz
    "Exibindo 0 de 0" antes de ler. O bloco no lugar da foto e do endereço
    ficou como estava: é o lugar de um dado dentro da linha real, como o
    bloco da contagem, que entra com a estrutura;
  - **O catálogo.** "Verificando o catálogo…" que apareceu fica o mínimo de
    500 ms antes de a falha tomar o lugar (`useFalhaDoCatalogo`, nas
    Devoluções, na contagem cíclica e na chegada avulsa). Nas Devoluções, o
    aviso da falha é um só, na primeira linha com código (antes, um por linha,
    cada um com o próprio "Tentar de novo"), e a linha não tem mais o selo
    "verificando o catálogo", que piscava antes dos 300 ms e repetia a caixa.
    O campo do código diz "Código do cliente da linha 1" e "Cód. cliente";
  - **O foco nunca cai no `body`.** Aprovada ou encerrada a solicitação, o
    foco vai ao título da seguinte no detalhe (sem ela, à linha de estado);
    separada a última linha de uma prateleira, que se fecha, ao botão do
    grupo; o "Tentar de novo" que dá certo leva ao título "Guardar em" (o
    destino da caixa), à linha de estado (a bancada) e ao título "Disposição
    física" (as devoluções pendentes); a entrada por caixa concluída, ao
    título "Detalhes do recebimento"; a falta desmarcada, ao "Marcar falta"
    que entra no lugar, que espera com `aria-disabled` em vez de `disabled`;
  - **O leitor de tela ouve uma vez.** O "Desmarcar" tem o nome do rótulo na
    tela ("Desmarcar", "Desmarcando…"), e a linha vem pela descrição (antes, o
    `aria-label` fixo escondia a espera). Na chegada por caixa, o resultado
    que o toast diz (a entrada concluída) não é repetido pelo Anunciador; o
    destino confirmado, a busca sem produto e a quantidade não salva, que
    tinham a região viva solta, são ditos pelo Anunciador quando aparecem;
  - **O Guardar da área.** A recusa do servidor (a área não é de passagem, o
    item sem saldo livre) diz o motivo sem "Tentar de novo", porque a nova
    tentativa não muda nada; a falha de leitura segue com ele. O título e o
    aviso dizem "da EXPEDICAO";
  - **O celular.** As ações de linha migradas têm 48 px: "Separar", "Levar a
    caixa", "Desfazer", "Registrar disposição", "Aprovar e separar",
    "Recusar com motivo" e os dois "Concluir entrada". Na bancada de
    separação, o "Levar a caixa" fica numa linha dele, e o "Separar" e o "⋯"
    (48 × 48) na de baixo: lado a lado, o "⋯" encolhia a 18 px. O texto do
    "Desfazer" volta ao lado em que a linha alinha (à esquerda no celular, à
    direita no computador), dentro da largura do rótulo mais largo;
  - **Os testes.** Os gerúndios da bancada de separação entram na lista do
    teste (antes, o teste aceitava qualquer camada terminada em "…": um
    gerúndio errado passava); o Pedidos legado lendo, a bancada lendo e
    falhando, o Guardar lendo, falhando e recusado, a ficha salvando e a
    entrega que falhou ganharam a lista de textos. Contra o `5cd002a`, 28 dos
    108 testes dos 10 arquivos novos ou mudados reprovam; a troca de
    "Levando…" por outro gerúndio reprova a lista nova e passava na de antes.
- **Medição da revisão no Chromium**, no harness com a API falsa (só
  127.0.0.1):
  - "Aprovar e separar" pelo teclado, a 1440 e a 390 px: o foco no botão
    durante a espera e, no fim, no título da solicitação seguinte (antes, no
    `body` de 2,3 s em diante);
  - destino da caixa: depois do "Tentar de novo" que dá certo, o foco no
    título "Guardar em" (antes, no `body` de 3,4 s a 7 s); bancada de
    Operações: "Carregando tarefas" anunciado aos 345 ms e, depois da nova
    tentativa, o foco na linha de estado; com a bancada lida e a releitura
    falhando, "Não consegui atualizar · lista de 19:15" sob o título;
  - a disposição recusada: "Não registrada" no botão de 3,06 s a 4,5 s e
    "Saldo insuficiente" na linha depois que o botão volta, a 6,5:1 no claro
    e 5,5:1 no escuro; o anúncio "Registrando a disposição" aos 349 ms;
  - o vínculo do aviso com o servidor a 150 ms: nenhuma caixa (antes, de 28 a
    149 ms); a 3 s, a caixa aos ~380 ms, o nome "Aviso 0412 · Loja Faria
    Lima Vinculando…" e o anúncio aos 355 ms; o saldo a 400 ms: nenhuma caixa
    (antes, de 168 a 427 ms); a 2 s, a caixa em tinta, rgb(31, 42, 61);
  - o catálogo que falha aos 420 ms, nas Devoluções e na contagem cíclica:
    "Verificando o catálogo…" de ~330 a ~805 ms, e só então a falha (antes,
    cortado aos 408 ms, ainda entrando); com duas linhas digitadas, um aviso
    só, e o foco volta ao código quando o catálogo chega;
  - Pedidos legado com a leitura a 2,5 s: os cartões no bloco, as linhas-
    fantasma invisíveis até ~300 ms depois da montagem e a 61 px, como a
    linha real (antes, quatro de 73 px desde o primeiro quadro, e a tabela
    encolhia de 292 a 122 px na chegada); com a leitura a 150 ms, nenhum
    fantasma visível. Solicitações a 390 px: o cartão-fantasma com 98 px,
    como o real, no mesmo lugar (antes, 84 px);
  - o foco em dez casos (a última linha da prateleira, a outra linha, o
    Levar a caixa, o destino, a bancada, as devoluções pendentes, as
    Solicitações, o catálogo da cíclica e o das Devoluções, a disposição):
    nunca no `body`; a entrada por caixa concluída: o foco no título e só o
    toast falando; o "Desmarcar": o nome "Desmarcando…" na espera, a
    descrição "2 · TESTE-000002" e o foco no "Marcar falta" no fim;
  - a 390 px, a linha da Lancheira com o "Levar a caixa" de 324 × 48, o
    "Separar" de 268 × 48 e o "⋯" de 48 × 48 (antes, 18 × 40, fora do
    cartão); o "Desfazer" com o texto em x = 33 a 390 px e terminando em
    1375 a 1440 px, como antes desta parte; os "Concluir entrada" com 48 px;
  - o axe-core em 19 estados, no claro e no escuro: as mesmas violações de
    antes desta revisão, nenhuma nova; no movimento reduzido, nada gira nem
    desliza nos estados novos.

Fica aberto:

- a `idempotency_key` nova a cada toque no "Salvar conferência" da ficha por
  linha (4.5): mudar é mudar a escrita, e esta parte não muda;
- na chegada por caixa e na bancada de separação, os vizinhos da ação em
  andamento (a seleção da caixa, "Revisar caixa", "Revisar entrada", "Editar
  conteúdo", o "⋯" e "Dividir em volumes") seguem `disabled` durante a ação,
  como na abertura (13b); o botão tocado nunca fica, e o "Marcar falta"
  passou a `aria-disabled`. O toque repetido dentro de 1 s do `BotaoDeAcao`
  também vale ali (a nova tentativa logo depois de uma falha espera o
  segundo);
- a chave da disposição é por tentativa (o `useAcaoNaLinha`), e não mais um
  UUID novo a cada toque: a repetição depois da falha incerta devolve o
  recibo. A pessoa que muda a nota ou o endereço entre as duas tentativas
  manda outro conteúdo com a mesma chave, e o servidor recusa se a primeira
  tiver gravado; vale confirmar com o Leonardo;
- os Retornos da Operação que voltam a ler depois da falha e não têm retorno
  somem com o foco no aviso; desde a junção com o PR, o foco vai ao título da
  página (a `segurarOFocoQueSai`), e não mais ao `body`;
- a mensagem da falha do romaneio, da lista de separação, da bancada de
  separação e do pedido separado ("Não foi possível carregar o pedido.")
  ficou sem "Tentar de novo", porque a leitura ao vivo não relia; depois da
  junção, a `useLeitura` relê (13g), e a correção da junção deu às quatro a
  saída (a demora, a desistência e a falha com "Tentar de novo");
- a foto dos itens que não veio (a leitura das fotos que falhou) volta ao
  "sem foto", sem aviso;
- os `role="status"` dos cartões de identificação (o produto novo e a
  família), que não são espera, ficam como estavam;
- a linha da disposição recusada cresce uma linha com o motivo (o cartão de
  baixo desce 20 px);
- a entrega dos pedidos e os Retornos da Operação não têm medição no
  navegador: o harness simula a leitura ao vivo; os testes cobrem;
- a conferência com leitor de tela de verdade e num Android médio.

**Parte 13d, o Faturamento, os Relatórios, os Documentos e o Catálogo (PR 610,
13/11/2026).** A migração das seções 4.8 e 4.9 que as partes 6 a 13c não
cobriram: o Fechamento do mês, a fatura, a Tabela de preços com a Cobrança, a
aba Contratos do Faturamento, os Relatórios, os Documentos, Produtos, SKUs e o
"Numerar pedidos e envios antigos" (em Configurações › Sistema). A foto e o
estúdio de foto ficaram com a parte 11. As necessidades 2, 3, 5, 8 e 10 da
seção 5, conferidas contra o código atual. As chamadas, as callables e as
escritas seguem as de antes.

- **O que já estava feito**, e ficou: a `CarregandoTela` nos `Suspense` do
  Faturamento e do Catálogo (parte 9); a troca de mês, período e página com a
  lista anterior, e a releitura que falha na linha de estado, no Fechamento,
  nos Relatórios, em Produtos e em SKUs (parte 10); a confirmação de Emitir e
  a do Remover item, e os diálogos de item, produto, SKU e documento (parte
  13a); as etapas de "Adicionar documento" (parte 11); a tabela de preços que
  falha sem nada lido (PR 581); os Relatórios com o perfil não lido (o
  `ProtectedRoute` já espera o usuário).
- **A forma final na primeira leitura** (necessidade 3):
  - o Fechamento deixa o "Calculando…": o esqueleto do mês (o cobrado
    automaticamente, os serviços e o cartão do total), com as linhas lembradas
    por cliente, e "Carregando outubro de 2026…" na linha de estado, logo
    abaixo dos meses, que continua a espera também enquanto o cliente ativo
    lê. Os meses mostram o bloco no lugar do estado antes da lista e "—" na
    falha, nunca "Em aberto";
  - a Tabela de preços tem a linha de estado sob "Serviços e valores" e as
    linhas-fantasma; a Cobrança mostra o esqueleto dos campos até a
    configuração chegar (antes, os campos vazios e um "Salvar" que gravava a
    taxa 0);
  - nos Relatórios, a linha diz o objeto de cada relatório ("Carregando a
    posição de estoque…"), a prévia tem a forma final (o resumo, as linhas
    lembradas, até 8, e o rodapé) e a lateral guarda a casa do número;
  - os Documentos têm a linha de estado e as linhas-fantasma, na tabela e nos
    cartões do celular;
  - Produtos e SKUs mostram o bloco no lugar dos números e do resumo da
    página antes de ler, e "—" na falha, sem "0 produto(s)" nem "Exibindo 0 de
    0". Nos SKUs, o endereço fica neutro até os saldos chegarem (antes, "Sem
    endereço" em todas as linhas);
  - a fatura tem a espera em bloco, "Carregando a fatura…", e a aba Contratos
    mostra a `CarregandoTela` enquanto o cliente ativo lê, no lugar da aba em
    branco.
- **Erro nunca vira vazio nem some** (necessidade 2): a fatura, a tabela, a
  cobrança, os Documentos e os saldos dos SKUs que falham sem nada lido
  mostram a `FalhaNaLeitura`, com "Tentar de novo"; a falha dos avisos de
  chegada tem aviso próprio e não afirma mais "Nenhum documento ainda".
- **A releitura que falha não apaga a lista** (necessidade 8): nos Documentos,
  ela trocava a lista pelo texto do erro; agora a lista fica, e a linha de
  estado diz.
- **As ações** (necessidade 5): "Salvar quantidades", "Marcar como paga",
  "Salvar cobrança", "Ver o que muda" e "Numerar agora" são o `BotaoDeAcao`,
  ocupados sem `disabled`; quando o botão do Fechamento sai, o foco vai ao
  link da fatura, e o Emitir devolve o foco a ele ao fechar a confirmação. As
  ações do menu "⋯" de cada documento são por linha (`useAcaoNaLinha`): a
  linha tocada mostra a espera dela, as outras seguem livres, e o segundo
  toque na linha ocupada não grava de novo.
- **A trava da área** (`pages/carregamento-do-faturamento.test.ts`): nos
  arquivos da área, nenhum `animate-spin`, `animate-pulse` ou `Loader2`,
  nenhuma região viva solta, nenhum "Carregando" seco, nenhum texto com três
  pontos e nenhum botão que só apaga durante a ação.
- **Testes**: novos no Fechamento e na fatura (`billing.carregamento`), na
  Tabela de preços, nos Relatórios, nos Documentos, no Catálogo, no Numerar e
  no Faturamento com a aba Contratos, com a lista de textos e o axe. Contra o
  `c4066b4`, 33 dos 39 testes dos 9 arquivos novos ou mudados falham.
- **Medição no Chromium** (harness com a API falsa, só 127.0.0.1; antes é o
  `c4066b4`), o quanto a tela cresce na chegada, a 1440 px: o Fechamento, de
  365 px a 0, e a Tabela de preços, 0 antes e depois; na segunda visita, os
  Documentos, de 228 a 0, e os Relatórios, de 184 a −1. Produtos e SKUs
  crescem menos (de 703 a 475 px e de 575 a 355), pela regra das cinco
  linhas lembradas. A 390 px, o Fechamento, de 767 a 78.
- **A revisão (14/11/2026)**, com o que a lógica, o navegador e o leitor de
  tela mostraram:
  - **O cliente ativo é a fronteira também enquanto lê.** Com a lista dos
    clientes demorando, o "Tentar de novo" da demora do Fechamento lia o mês
    do cliente padrão e o mostrava como se fosse o escolhido, com as ações
    ligadas: "Salvar quantidades", "Emitir" e "Marcar como paga" gravariam no
    cliente errado. Agora, enquanto o cliente ativo lê, nenhum mês nem fatura
    do cliente padrão entra na tela, e o "Tentar de novo" do Fechamento e da
    fatura lê de novo a lista dos clientes (hoje o `tentar` do
    `ActiveCustomerProvider`), cancelando a que ficou presa: sem isso, o
    react-query só esperava a mesma leitura. O esqueleto do mês usa as linhas
    lembradas do cliente que a tela vai operar (o provável), como Pedidos e
    Receber;
  - **O menu "⋯" do documento não reabre sozinho.** Ele passou a ser
    controlado e ficava aberto por dentro quando a linha ficava ocupada antes
    de o menu fechar: quando a ação terminava, no sucesso ou no erro, o menu
    abria sozinho e puxava o foco, e o que a pessoa digitava depois caía nele
    (um "o" e Enter ocultavam o documento). Agora a escolha fecha o menu, e o
    ocupado só impede que ele abra;
  - **A linha diz o fim.** Do fim da chamada até a lista relida chegar, a
    linha diz o que mudou ("Arquivado", "Oculto do cliente", "Enviado para o
    Conhecimento"), com o check verde, no lugar da origem do documento (antes,
    a linha não dizia nada, e o "⋯" parecia livre sem abrir). A espera, a
    demora, o "Sem confirmação do servidor" e o motivo da falha também ficam
    nesse lugar, na mesma linha de 16 px: a linha não cresce nem empurra as de
    baixo;
  - **O "Conferir" relê e diz que relê.** Ele fica na tela com "Conferindo…",
    `aria-busy` e o foco, e o "⋯" se chama "Conferindo NF 48213…"; antes, a
    linha voltava a "Arquivando…" e o Anunciador dizia de novo "Arquivando NF
    48213", como se a escrita fosse refeita. A lista que diz que não valeu
    devolve a linha e leva o foco ao "⋯" dela. A resposta da escrita que chega
    depois disso relê a lista, e o documento arquivado sai;
  - **A chave da tentativa vai ao servidor** no "Enviar para o Conhecimento",
    no Aprovar e no Recusar: a repetição depois do resultado incerto leva a
    mesma `idempotency_key` e devolve o recibo. O Mostrar, o Ocultar e o
    Arquivar vão por rotas que não recebem a chave;
  - **O relógio é da ação, não da linha na tela.** A linha que sai da lista
    (a busca, o filtro) e volta no meio da ação segue a demora de onde estava,
    e o Anunciador não repete o que já disse dessa espera, nem pela linha da
    tabela e pelo cartão do celular, que existem os dois;
  - **Os botões mostram o fim.** "Salvar quantidades", "Marcar como paga",
    "Salvar cobrança" e "Numerar agora" seguem o relógio da ação: o sucesso
    ("Quantidades salvas", "Marcada como paga", "Cobrança salva", "Numerado")
    fica pelo menos 1 s e até a releitura chegar (antes, o gerúndio ficava até
    a releitura, depois do toast de sucesso), e o erro ("Quantidades não
    salvas", "Não marcada como paga", "Cobrança não salva", "Não numerado")
    fica 2 s. Aos 70 s sem resposta, "Conferir" relê o mês ou a configuração e
    nunca grava de novo;
  - **Os meses.** A lista dos meses que falha diz "Não consegui carregar os
    meses.", com "Tentar de novo" (antes, o "—" nos cartões e a linha dizendo
    "Atualizado às"). A faixa nasce com a forma final: os meses que a lista
    vai trazer entram como cartões-fantasma à esquerda, quantos a última lista
    deste cliente trouxe (sem lembrança, a faixa cheia, com quatro); antes, o
    mês escolhido saltava 330 px para a direita na chegada e, no celular,
    tudo abaixo descia;
  - **O que lê à parte tem estado.** A Cobrança tem a linha de estado dela,
    sob o título ("Carregando a cobrança…", a demora com "Tentar de novo",
    "Atualizado às"), que descreve a seção ocupada, e o "Tentar de novo" da
    falha leva o foco a ela quando a cobrança chega (antes, ao `body`). Nos
    SKUs, a linha diz "Carregando os endereços…" até os saldos chegarem, com a
    demora aos 10 s; com o filtro "Sem endereço", a tabela espera os
    endereços com as linhas-fantasma, sem "0 SKU(s) exibido(s)" nem a tabela
    vazia, e a falha deles fica no aviso;
  - **A Tabela de preços no celular.** A linha de estado fica na largura do
    cartão, abaixo da fileira do título e do "Novo item": a demora não cobre
    mais o botão nem sai do cartão;
  - **A fatura presa tem saída.** A espera em bloco (`CarregandoNaRegiao`)
    ganhou o "Tentar de novo" aos 10 s, quando quem lê sabe ler de novo, com
    44 px; a leitura presa é cancelada e lida de novo, e o foco vai à volta
    para o Fechamento quando a fatura chega. Na junção com o PR, o "Tentando
    de novo…" do botão saiu: a nova tentativa é uma espera nova, que diz o
    gerúndio de novo aos 300 ms, com o foco na região;
  - **A aba Contratos é uma espera só.** A espera do cliente ativo e a do
    arquivo da aba usam o mesmo relógio, desde que a aba abriu: a caixa não
    some na troca, e a demora vem aos 10 s do começo;
  - **Um brilho por cartão e a chegada em cascata.** O brilho saiu de cada
    bloco e ficou no cartão (o corpo das linhas-fantasma, a prévia, a
    Cobrança, cada cartão do Fechamento, a 120 ms um do outro); nas tabelas, o
    `corpoDaTabela` do `stock-workbench` liga o brilho, o `aria-busy` e a
    chegada. Na chegada, as linhas reais entram por opacidade, subindo 4 px,
    em cascata (`useChegada`), em todas as telas da parte;
  - **"Adicionar documento" diz que espera.** Com o cliente ativo lendo, a
    caixa entra no lugar do ícone aos 300 ms, com `aria-busy` (antes, só a
    opacidade de 0,45). O "⋯" dos documentos tem 48 px no celular;
  - **A segunda visita aos Documentos não cresce.** As linhas-fantasma lembram
    quantos documentos têm o selo do Conhecimento ("Aguardando aprovação para
    o Conhecimento"), que dá à linha uma terceira linha de texto;
  - **Os testes.** A lista de textos passou a valer também nos estados das
    ações (o gerúndio, o fim, o erro, "Sem confirmação do servidor" e
    "Conferir") e na espera da aba Contratos. A tabela que falhou e é relida
    sem a pessoa pedir ganhou o teste que faltava. Contra o `3078d17`, 33 dos
    68 testes dos 9 arquivos novos ou mudados reprovam.
- **Medição da revisão no Chromium**, no harness com a API falsa (só
  127.0.0.1):
  - o menu "⋯" com Mostrar, Aprovar e a falha do servidor, pelo clique a 1440
    px, pelo toque a 390 px e pelo teclado: fechado nos 4 a 6 s seguintes, com
    o foco no "⋯" (antes, aberto de novo cerca de 1 s depois da resposta);
  - Arquivar com o servidor a 1,2 s e a releitura a 2,5 s: "Arquivando…" de
    690 ms a 1,5 s e "Arquivado" de 1,57 s a 4 s; a linha de baixo parada em
    todos os quadros (antes, descia 14 px e voltava); quando a linha sai, o
    foco vai à linha de estado. A 390 px, o "⋯" com 48 × 48 e o cartão de
    baixo parado (antes, 40 × 40 e 18 px de salto);
  - o "Conferir" dos 70 s pelo teclado, a 1440 e a 390 px: "Conferindo…" com
    `aria-busy` e o foco nele, o toque de 44 px, um GET só, a linha na mesma
    altura e, quando a lista diz que não valeu, o foco no "⋯"; o Anunciador
    diz "Conferindo NF 48213", nunca "Arquivando" de novo;
  - o Fechamento com o cliente ativo preso: aos 10,8 s, o "Tentar de novo"
    relê a lista dos clientes, e nenhum mês é lido nem aparece;
  - a chegada do Fechamento: o mês escolhido anda 13,5 px (antes, 329,5) e o
    "Outro mês" 34 px (antes, 350); a 390 px, a linha de estado e o cartão do
    total não descem (antes, 62 px);
  - "Salvar quantidades" com o servidor a 3 s: "Salvando…" aos 357 ms,
    "Quantidades salvas" de 3,1 s até o mês relido (4,55 s) e o foco em "Ver
    prévia da fatura (PDF)", sem nenhum quadro no `body`;
  - a Cobrança a 90 s: "Carregando a cobrança…" aos 300 ms e, aos 10,5 s, a
    demora com "Tentar de novo" (antes, nada); a fatura presa: o "Tentar de
    novo" aos 10,8 s lê de novo, e o foco vai a "Fechamento do mês";
  - SKUs com os saldos a 8 s e "Sem endereço": as linhas-fantasma e
    "Carregando os endereços…", sem "0 SKU(s)"; lidos, "4 SKU(s) exibido(s)";
  - a Tabela de preços a 390 e 360 px com a demora: a linha não cobre o "Novo
    item" nem sai do cartão, e nada rola de lado;
  - em laço depois do primeiro segundo, 4 animações no Fechamento e na Tabela
    de preços e 2 nas outras telas (antes, de 19 a 31); o brilho para entre
    4,27 e 4,49 s; só `transform` e `opacity`. Na chegada, a cascata em todas;
    no movimento reduzido, só por opacidade;
  - a segunda visita aos Documentos: 0 px de salto a 1440 e a 390 px (antes,
    14 e 20);
  - o axe-core em 26 estados no claro e no escuro a 1440 px e em 17 a 390 px:
    só as violações de antes desta parte.

Fica aberto:

- as colunas das tabelas mudam de largura na chegada (o layout automático da
  tabela segue o conteúdo, que os blocos não conhecem): nos Documentos, os
  títulos andam até 63 px de lado. Fixar as larguras muda a tabela lida;
  fica para decidir;
- Produtos e SKUs ainda crescem na chegada: a contagem lembrada vai de 1 a 5
  linhas, e a página tem até 50 (na segunda visita, 475 e 355 px a 1440 px); é
  a regra do Pedidos legado e vale confirmar com o Leonardo. Na primeira
  visita, sem lembrança, os Relatórios crescem 184 px e os Documentos 130 px.
  Na chegada do Fechamento, o cartão do mês escolhido se alarga 21 px com o
  estado;
- no computador, a demora da Cobrança passa o "Tentar de novo" à linha de
  baixo na coluna de 340 px e empurra os campos 28 px aos 10 s;
- as linhas dos Documentos não têm a `BarraDeEspera` da linha;
- o Mostrar, o Ocultar e o Arquivar não levam a chave da tentativa: as rotas
  deles não a recebem, e mudar é mudar a escrita;
- "Ver o que muda" é uma leitura: o fim dela é o texto da seção ("Vai numerar
  2 solicitação(ões)"), e o botão não tem o sucesso;
- se a releitura do mês falha depois de "Salvar quantidades", o botão volta a
  "Salvar quantidades" com as quantidades na tela (a linha de estado diz que
  não atualizou); gravar de novo grava as mesmas quantidades;
- a fatura lida rola de lado a 390 px (o `InvoiceDocument`, de antes desta
  parte);
- as violações do axe de antes desta parte: o cabeçalho das tabelas a 3,01:1
  (que o esqueleto dos Documentos repete), o primário no escuro a 4,3:1, os
  códigos em `text-primary` no escuro a 4,38:1, a pílula do estado do mês a
  4,4:1, o toast de erro no escuro a 3,3:1, o `scrollable-region-focusable`
  das tabelas no celular e o `aria-controls` das abas do Faturamento;
- o Numerar mora em `pages/settings-system.tsx`, a área da 13e: o merge desse
  bloco pode dar conflito. O resto da tela não foi tocado;
- o Remover da Tabela de preços devolve o foco ao título da página pelo
  foco-de-volta, sem medição no navegador;
- com a suíte inteira carregada, testes de outras partes falham às vezes e
  passam sozinhos (`inventory-carregamento`, `opening-line-correction`,
  `agent-knowledge`);
- a conferência num Android médio, com leitor de tela de verdade e na
  homologação.

**Parte 13e, as Configurações, o sistema e o Início (PR 610, 13/11/2026).** A
parte 13 em Pessoas e acessos, Clientes, Chaves de API, Sistema e
Infraestrutura, no Início dos módulos, no painel do owner e no shell (as
seções 4.1, 4.2 e 4.10). Fecha também a pendência da 9.4.

- **O que já estava feito**: Pessoas dizia "Carregando pessoas…" com o
  `Spinner`; as Chaves de API já tinham a reticência certa e a trava por ref;
  a parte 13a já cuidava dos diálogos (Convite, Reenviar, Remover, Revogar,
  Clientes, Sistema, owner e Infra); o total de SKUs do Início já dizia "—"
  sem leitura (decisão 6); o `Skeleton` já era o bloco neutro (parte 3); e o
  painel do owner já tinha a `FaixaSemConexao` e o `BlocoSemConexao`.
- **O shell**:
  - o seletor do cliente ativo mostra o bloco e, aos 300 ms, a caixa de 16 px
    no lugar da seta, nunca o cliente legado. Lendo, fica `aria-disabled`, e
    o menu não abre;
  - quando a lista dos clientes não vem, ele diz "Não carregou",
    "Reconectando…" ou "Sem conexão", com o ícone de tentar de novo no lugar
    da seta e sem dizer que abre um menu (`aria-haspopup`), e o toque tenta de
    novo. A nova tentativa fica na falha, com "Tentando de novo", e não volta
    ao bloco de quem carrega (`useLeituraComFalha` no provedor). No cabeçalho
    do celular, o seletor tem 44 px;
  - o item do menu da tela que abre mostra a caixa no lugar do contador
    (`useRotaEsperando`), também na barra da Configuração;
  - enquanto o "Precisa de você" lê, o contador do Início é o bloco, e nenhum
    número aparece pela metade (antes, "Início 1" e, no quadro seguinte,
    "Início 2"), nos cinco módulos.
- **A pendência da 9.4, feita**: os convites de Pessoas e a lista de clientes
  do comercial no seletor leem pelo `lerDocsDoServidor`. Sem rede, a leitura
  que só achou o cache é falta de conexão, e o app relê sozinho (parte 7a).
  As anotações e os playbooks do Agent Dute já liam pelas callables do núcleo
  e pelas rotas do `lib/cloud-api.ts`.
- **As peças**:
  - a `CarregandoNaRegiao` ganhou a saída da tabela da seção 3 para quem sabe
    repetir a leitura (`onTentar`): aos 10 s, "Tentar de novo" ao lado do
    aviso da demora; aos 70 s, "Sem resposta do servidor." no `ErroNaLeitura`,
    com "Tentar de novo". A nova tentativa recomeça o relógio, e o foco fica
    na região. Quem usa relê do zero (`lib/carregando/reler-do-zero.ts`): o
    react-query não recomeça a leitura sem dado que ainda lê, e o `refetch`
    só se juntaria à presa. Está no Início, nos incidentes do Sistema, no
    painel do owner, na Infraestrutura, em Pessoas, em Clientes e nas Chaves;
  - a `FalhaNaSecao` (a falha de uma parte da tela) diz "Tentando de novo…"
    só na tentativa que a pessoa pediu, até a promessa da releitura acabar: o
    intervalo da tela não muda o botão. A frase é alerta quando a seção não
    tem nada lido; com o que já estava lido na tela (a releitura que falhou,
    quase sempre a automática), fica escrita, sem falar (momento 7);
  - quando a nova tentativa dá certo e o aviso sai com o foco nele, o foco vai
    ao título da seção ou do diálogo onde ele morava, nunca ao `body`. Vale
    para a `FalhaNaSecao` e para o `ErroNaLeitura` sem linha de estado
    (`lib/foco-de-volta.ts`).
- **O Início dos módulos**:
  - nasce com a forma final: os rótulos reais, as linhas-fantasma com a
    anatomia da linha e, no lugar da frase, "Carregando o que precisa de
    você…", que continua a espera da tela que abriu. O "Precisa de você"
    aponta para essa linha (`aria-describedby`) enquanto lê;
  - a fonte que falhou sem nada lido fica na falha enquanto é relida
    (`useLeituraComFalha`): o "Tentar de novo" diz "Tentando de novo…", e o
    aviso não sai da tela com o foco nele. A releitura de cada minuto não tira
    o aviso, não mexe no foco e não fala. O toque relê todas as fontes,
    também as anotações e os playbooks do Agent Dute. A releitura que falha
    depois de lido fica escrita, sem falar;
  - "Hoje no armazém" não afirma zero: lendo, o bloco do tamanho do número de
    24 px (28 × 18); com o armazém sem leitura, "—";
  - quem não tinha nada parado na última leitura não vê o "Precisa de você"
    nascer lendo para sumir na chegada (a contagem lembrada guarda o zero), e
    o que está ao lado e embaixo não salta;
  - na chegada, as linhas reais entram por opacidade, subindo 4 px, em
    cascata, e a frase entra por opacidade (no reduzido, só a opacidade);
  - o aviso da fonte que falhou tem "Tentar de novo" no WMS, no Comercial e no
    RH.
- **Pessoas e acessos**:
  - cancelar o convite, trocar o perfil e devolver o acesso têm a espera na
    linha (`useAcaoNaLinha`): o gerúndio ("Cancelando o convite…"), a caixa no
    lugar do "⋯", com `aria-busy`, e as outras linhas livres. Se a linha sai,
    o foco vai ao vizinho;
  - cada linha espera a própria gravação: trocar o perfil de duas pessoas
    seguidas soltava só a última, e a primeira ficava presa (o react-query só
    dá os avisos do pedido ao último `mutate`); a devolução tem a mutação
    dela, e devolver o acesso de uma pessoa não trava o das outras;
  - a ação que sai do menu o fecha: antes, ele reabria sozinho quando a ação
    acabava. No celular, o "⋯" tem 44 px;
  - a releitura que falha não apaga a lista, e "Não foi possível atualizar as
    pessoas." fica escrita em cima dela, sem falar.
- **Clientes**:
  - nenhum "0 no portal" nem "…" antes de ler: o bloco enquanto lê e "—" na
    falha. Na galeria, a falha das prateleiras ou das pessoas também fica
    dita, em cima dos cartões, com "Tentar de novo";
  - na página do cliente, "Pessoas · ▪" lendo e "Pessoas · —" na falha, com o
    separador fora da árvore (o leitor de tela ouve "Pessoas"); a ocupação
    que falhou fica na falha durante a nova tentativa, e a releitura que falha
    não apaga a ocupação lida;
  - sem rede, a página, a ocupação e as pessoas dizem a mesma falta, no aviso
    da conexão ("Reconectando…" ou "Sem conexão."), e não o erro vermelho;
  - o Salvar das seções é o `BotaoDeAcao`; o Cancelar fica `aria-disabled` e
    esmaece aos 300 ms; quando o formulário fecha, o foco volta ao "Editar"
    da seção.
- **Chaves de API**:
  - a leitura que não alcança a API é falta de conexão: sem nada lido, o
    aviso da conexão, e o app relê sozinho quando a rede volta; com a lista,
    a faixa com a hora;
  - a releitura que falha com a lista na tela fica escrita em cima dela, sem
    falar; a página seguinte que não veio diz "Não carregou" no botão por 2 s
    e "Não foi possível carregar mais chaves." ao lado, falado uma vez;
  - criando a chave, os campos ficam só para leitura (`aria-disabled`, com a
    trava no código), nunca `disabled`: o Enter no Nome não derruba o foco;
  - o link da documentação fica em tinta, sublinhado (o vermelho dava 4,2:1).
- **Sistema e conta**: o "Verificar agora" só mostra a espera quando a pessoa
  toca nele. Cada gerúndio diz o quê ("Verificando o sistema…", "Verificando
  a infraestrutura…", "Conferindo a numeração…"), e o "Verificar agora" da
  Infraestrutura só sublinha com o ponteiro em cima (o fundo do ghost dava
  3,35:1 no escuro). No celular, o Verificar agora, o Ver o que muda, o
  Numerar agora, o Carregar mais e o Sair têm 44 px.
- **Testes**: por peça (`falha-na-secao.test.tsx`,
  `carregando-na-regiao.test.tsx`) e por área (`inicio-do-modulo.carregando`,
  `home.carregando`, `pessoas/acoes.carregando`, `users.carregando`,
  `settings-customers`, `settings-integrations`, `carregando-do-sistema`,
  `carregando-no-shell`, `active-customer-context.falta`, os Inícios do
  Comercial e do RH), com a lista dos textos e o axe. Contra o código de antes
  da revisão, 48 testes falham; os que ainda passam são as travas dos textos
  que já existiam. Os testes que esperavam um tempo fixo depois dos 300 ms
  esperam o estado chegar: com a suíte inteira rodando, eles falhavam à toa.
- **Medição no Chromium** (harness com a API falsa, só 127.0.0.1):
  - a nova tentativa que dá certo: o foco fica no "Tentar de novo" com
    "Tentando de novo…" e depois vai ao título da seção (o H2 dos incidentes,
    da ocupação e do portal, o H1 da tela), em dez casos de oito telas;
    antes, o `body`. No seletor, o foco fica no mesmo botão;
  - o Início com o armazém falhando sempre, o foco no "Tentar de novo" por 66
    s: o aviso e o foco ficam, nenhuma linha-fantasma, nenhum anúncio, e a
    releitura de 1 min falha em silêncio; antes, aos 59,7 s, o aviso sumia e o
    foco ia ao `body`;
  - a leitura presa em sete telas (Início, Sistema, Pessoas, Clientes,
    Chaves, painel e Infraestrutura): "Tentar de novo" aos 11 s e "Sem
    resposta do servidor." aos 72 s; antes, só a demora, para sempre;
  - trocar o perfil e devolver o acesso: o menu fica fechado até o fim (4,5
    s); antes, reabria a 3,2 s;
  - o Início sem nada parado, na segunda visita: CLS 0 no computador e 0,0003
    no celular; antes, 0,15 e 0,13;
  - na chegada, a linha entra de 0 a 1 de opacidade e de 4 a 0 px em 166 ms;
    o menu passa do bloco ao "Início 2" num quadro só;
  - sem rede, as Chaves e a página do cliente dizem "Reconectando…" e depois
    "Sem conexão.", e voltam sozinhas com a rede;
  - criar a chave pelo Enter no Nome: o foco fica no campo durante o
    "Criando…"; antes, no `body`. O Salvar da seção devolve o foco ao
    "Editar contrato";
  - a 390 px, nenhum dos botões da parte abaixo de 44 px; o axe não acusa nada
    no claro, e no escuro só o branco sobre o primário azul (4,3:1, o token
    registrado na seção 4.3 da especificação).

Fica aberto:

- a primeira visita ao Início de quem não tem nada parado ainda mostra o
  "Precisa de você" lendo e o tira na chegada: sem lembrança, a forma é a de
  duas linhas;
- os Inícios da Operação, que lê ao vivo, e do Financeiro, que junta quatro
  leituras, mostram a falha sem "Tentar de novo";
- o Sistema do owner: o painel lendo ocupa uma linha e não guarda a forma, e
  ele e a Infraestrutura empurram os incidentes quando chegam (cerca de 700 e
  320 px);
- os contadores dos outros itens do menu (Pedidos) só aparecem na chegada; o
  bloco fica no Início;
- no celular lendo, o `main` que rola fica sem nada focável até o dado chegar
  (o axe acusa; o Chrome já deixa a rolagem focável);
- o Cancelar convite continua sem confirmação, que pede um desenho;
- as telas que esperam o `isLoading` do cliente ativo (Faturamento,
  Contratos) não leem o `falhou`: com a lista que falhou, seguem com o
  cliente legado (área 13d; resolvido na correção da junção das partes 10 e
  13);
- quando tudo lê ao mesmo tempo, aparecem três indicadores juntos (o seletor,
  o item do menu e a tela), a confirmar com o Leonardo;
- a conferência com leitor de tela de verdade, num Android médio e no
  Safari.

**Parte 13f, o portal do cliente (PR 610, 13/11/2026).** A parte 13 no portal
do cliente (seção 4.13): Pedidos, Estoque, Envios, Eventos, Faturas, o
Relatório, o Início, Minhas OS, o comprovante e o sino. Fecha também, no
portal, as necessidades 2, 3, 5, 8 e 10 (seção 5). As escritas, as chaves de
idempotência e o `customer_code` como fronteira não mudam.

- **O que já estava feito**: o `#D9DDE3` do esqueleto fora da v3, como token,
  desde a parte 3; o caminhão pulsando do Enviar pedido, que virou o
  `BotaoDeAcao` ("Enviando o pedido…") na 13a; os diálogos do Evento (Editar e
  Excluir) e o painel "Seu pedido", também da 13a; o `Skeleton` neutro; e o
  "Enviando anexo i de n…".
- **A leitura do portal**, que toda tela dele espera:
  - a tela nasce com o título e a largura dela; os blocos neutros entram aos
    300 ms e, sob o título, "Carregando o portal…", com o anúncio; aos 10 s,
    a demora e "Tentar de novo", que lê do zero; aos 70 s, "Sem resposta do
    servidor." (`CarregandoNaRegiao`). Continua a espera da tela que abriu
    ("Abrindo Estoque…"), sem anunciar de novo. O texto só para leitor de
    tela, fora de região viva, saiu;
  - a espera passa adiante (`passaAdiante`): a tela que chega e ainda lê o
    que é dela ("Carregando eventos…", "Carregando as NFs dos serviços…",
    "Carregando as OS…", "Abrindo o evento…") segue o mesmo relógio. O
    indicador não some, a caixa não entra de novo, nada é anunciado duas
    vezes, e a demora vem aos 10 s do começo, e não da leitura da tela. O
    item do menu não conta essa espera como tela abrindo;
  - a linha de estado nunca encolhe nem fica sob os blocos: os blocos cabem
    no que sobra, sem rolar. Só o contêiner dos blocos fica `aria-busy`,
    apontando para a linha, que fica fora dele, também aos 70 s;
  - sem nada lido, a falha fica no lugar da tela, com "Tentar de novo" de
    44 px; a nova tentativa fica na falha (`useLeituraComFalha`) e diz
    "Tentando de novo…" só aos 300 ms, e pelo menos 500 ms: a que falha de
    novo antes não pisca o botão nem muda a frase do alerta, e a primeira
    falha nasce dizendo "Tentar de novo". Sem rede, o aviso da conexão. O
    "Portal indisponível", com o RefreshCw girando e o botão `disabled`,
    saiu;
  - com o portal lido, a releitura que falha não apaga a tela (necessidade
    8): sem rede, a faixa do topo já diz; por outro motivo, "Não foi possível
    atualizar o portal." fica escrita em cima da tela, sem falar, com "Tentar
    de novo". Antes, a tela inteira virava a falha, e o teste do PR 582
    travava isso para a falha que não é de conexão; ele mudou. A estrutura em
    volta da tela é sempre a mesma, para a frase entrar e sair sem montar a
    tela de novo.
- **A leitura de cada tela**:
  - Eventos: o título fica, e sob ele "Carregando eventos…", no lugar do
    segundo esqueleto da tela inteira. A falha tem "Tentar de novo", e a
    releitura que falha não apaga a lista: "Não foi possível atualizar os
    eventos." fica escrita, sem falar;
  - Faturas nunca dizem "Nenhuma fatura fechada" antes de ler as NFs, e a
    falha delas fica dita, com a nova tentativa;
  - Minhas OS (as OS, as NFs e as solicitações), o sino e o comprovante leem
    ao vivo com a nova tentativa (`useLeituraDoPortal` e
    `useDocumentoDoPortal`): o `onSnapshot` que falha não volta sozinho, e a
    falha fica na tela durante a nova tentativa, com "Tentando de novo…",
    até ela responder;
  - as datas de entrada no detalhe do produto: lendo e na falha, a seção
    fica, com a espera ou a falha. Só no produto que tem peça nas
    prateleiras, livre ou reservada: o zerado e o que só está em recebimento
    não têm data, e a seção deles não nasce lendo para sumir na chegada;
  - as rotinas do Agent Dute no Início: a falha fica dita, com "Tentar de
    novo".
- **O comprovante**: o "Baixar PDF" espera os endereços da assinatura e das
  fotos, travado no código (nunca `disabled`), até a desistência dos 70 s;
  depois, volta a sair com o que chegou, e a região diz que o servidor não
  respondeu. A imagem que não veio fica dita, na barra e no papel ("Foto 2
  não carregou", "Assinatura não carregou"); a que ainda chega guarda o
  lugar à vista, fora da árvore, e a lista do leitor de tela não tem item em
  branco.
- **As ações**:
  - o `BotaoDeAcao`, com o gerúndio, em Cancelar o pedido e o aviso
    ("Cancelando…"), Avisar um envio ("Registrando o aviso…"), Baixar
    planilha ("Gerando a planilha…"), Salvar evento ("Salvando o evento…") e
    Solicitar OS ("Enviando a solicitação…"). Manter, Cancelar e Fechar
    ficam `aria-disabled` desde o toque e esmaecem junto com o gerúndio, aos
    300 ms: o `DialogCancelar` com `ocupado` segue o relógio do confirmar, e
    a ação que responde antes não pisca o botão. Vale também para a falta da
    linha, a guarda da área e o destino da caixa, na Armazenagem;
  - a pergunta na linha ("Cancelar PED-0001?", `ConfirmacaoNaLinha`): ao
    abrir, o foco vai ao "Manter", no grupo que tem a pergunta como nome; o
    "Manter" e o sucesso devolvem o foco ao gatilho e, se ele sai depois (a
    releitura tirou a ação da linha), ao pedido no lugar novo dele, ao
    vizinho ou ao título. Nunca ao `body`;
  - os produtos zerados do Estoque têm a ação de cada um (`useAcaoNaLinha`,
    num contexto): antes, os botões dividiam o `isPending`, e no card não
    havia trava. O "Avisado" fica até a releitura do portal, que é uma só
    (antes, duas). O produto arquivado sai da vitrine, e o foco vai ao
    vizinho;
  - em Envios, o aviso não sai durante a leitura da nota (antes, saía sem os
    itens, e o arquivo subia duas vezes), soltar um arquivo é ignorado nesse
    tempo, a caixa violeta aparece aos 300 ms e a demora aos 10 s; Anexar,
    Ler e Remover ficam `aria-disabled`. A área da nota é a própria região de
    estado: sem `aria-busy` nela.
- **Acessibilidade**:
  - quem fala é o Anunciador: a contagem do Estoque (só quando a pessoa
    busca), o "adicionado", "Solicitação enviada" e "Nenhum tipo encontrado".
    A trava do portal (`carregando-v2.test.ts`) pega também o `role="status"`
    solto, e não só o `aria-live`;
  - quando a região sai com o foco nela (a pessoa tocou em "Tentar de novo"
    na demora), o foco vai ao título da seção ou da tela que chegou, nunca ao
    `body`, em qualquer tela que use a `CarregandoNaRegiao`;
  - no celular, as ações de linha têm 48 px (Cancelar pedido, Cancelar
    aviso, Manter, Avisar reposição, Arquivar; o gatilho de texto pelo
    `::before`, sem mudar a linha), Anexar e Ler nota têm 44 px, e o Remover
    do anexo tem 24 px (44 no celular) e o anel cheio do foco, com o recuo
    (antes, 12 px e o anel a 1,9:1);
  - o texto de apoio da caixa violeta, a demora inclusive, tem 5,7:1 no
    escuro (antes, 3,9:1).
- **Testes**: por área (`shared.carregando`, `shared-sem-conexao`,
  `cancelar-no-portal`, `estoque-carregando`, `envios-carregando`,
  `eventos-carregando`, `faturas-carregando`, `minhas-os-carregando`,
  `comprovante-carregando`, `relatorio-carregando`, `inicio-carregando`,
  `sino-carregando`), as leituras ao vivo com a nova tentativa
  (`lib/portal/leitura-do-portal.test.tsx`, que pega a nova tentativa que
  voltasse a "carregando" ou soltasse a falha antes da resposta) e a trava
  do portal, com a lista dos textos e o axe. Contra o código de antes da
  parte, 58 de 123 testes dela falham; contra o código da parte, 22 dos 83
  da revisão falham. Os que passam são as travas dos textos e as guardas.
- **Medição no Chromium** (harness com a API falsa, só 127.0.0.1):
  - o portal lendo: "Carregando o portal…" à vista e anunciado aos 309 ms;
    a demora e "Tentar de novo" aos 9,98 s. A 390 × 844, aos 10,2 s, a linha
    tem 56 px e o "Tentar de novo" recebe o toque; aos 70,3 s, 170 px, com o
    "Tentar de novo" de 324 × 44 à vista. A 1366 × 657, aos 70 s, o cartão
    de 78 px inteiro. Antes da revisão, a linha encolhia a 24 px, os blocos
    a cobriam, e o toque não chegava ao botão;
  - Eventos e Faturas com o portal em 1 s e a leitura da tela em 3 s: a
    caixa fica de 0,36 s a 3,03 s, sem quadro vazio e sem entrar de novo, e
    a única fala é "Carregando o portal"; antes, nada de 1,05 a 1,35 s e uma
    segunda fala. Com o portal em 8 s e os eventos em 16 s, a demora aos
    10,03 s, dita uma vez; antes, nunca;
  - o cancelamento com a releitura do portal que falha: a lista fica, com
    "Não foi possível atualizar o portal." e nenhum alerta; antes, a tela
    virava "Não foi possível carregar o portal.". O foco vai ao "Manter" ao
    abrir e, no fim, ao gatilho; antes, ao `body` por 2,4 s;
  - a nova tentativa do portal que falha de novo em 150 ms: o botão fica
    "Tentar de novo" o tempo todo, sem caixa; antes, a caixa piscava por
    cerca de 115 ms;
  - arquivar pelo teclado: o foco fica no "Arquivando…" e, quando o produto
    sai, vai ao card vizinho aos 1,66 s; antes, ao `body`;
  - as datas com a resposta em 600 ms: o produto zerado nunca mostra a
    seção (antes, 74 px de 7 a 571 ms); o que tem peça mostra a seção desde
    o começo e "Carregando as datas…" aos 296 ms;
  - "Tentar de novo" da demora pelo teclado: o foco fica na região e vai ao
    título "Pedidos" quando a tela chega; antes, ao `body`;
  - aos 0,4 s e aos 71 s, o `main` sem `aria-busy`, a linha e o alerta
    "Sem resposta do servidor." fora de qualquer `aria-busy`;
  - a chegada a 1440: o título da espera no lugar do título da tela (144,
    20 em Pedidos; 32, 20 no Estoque; 80, 20 em Eventos);
  - a 390 px, os alvos acima, e nenhuma rolagem lateral. O axe não acusa
    nada nos estados da parte a 390 (o portal lendo inclusive, que antes
    rolava sem nada focável), nem a 1440 no claro, fora o rodapé do
    relatório, de antes; no escuro, a caixa violeta da nota passa, e ficam o
    azul do primário (4,3 e 4,38:1, o token registrado na seção 4.3 da
    especificação) e o mesmo rodapé.

Fica aberto:

- com `?evento=` no Estoque, "Abrindo o evento…" guarda a altura dela e,
  quando o evento chega, sai, e a grade sobe 44 px. No caminho comum, o
  painel do pedido abre no mesmo instante, por cima; só no "Evento não
  encontrado" a subida fica à vista;
- o corpo da espera do portal é genérico (os cartões e o bloco grande): o
  título e a largura já são os da tela, o resto muda na chegada;
- a leitura da nota fiscal em Envios segue sem prazo: aos 10 s diz que
  demora, sem a saída dos 70 s nem cancelar;
- o "Baixar PDF" espera os endereços das imagens, e não os bytes: na rede
  lenta, o PDF ainda pode sair com a foto em branco;
- o progresso nos anexos do Solicitar OS, a confirmação do "Marcar como
  lidos" do sino, e a nova tentativa da foto do comprovante, que relê todas
  as imagens, e não só as que faltaram;
- "Avisar reposição" transborda a borda do botão na grade de duas e de três
  colunas (o layout, de antes);
- fora do portal, as telas que passam o `isFetching` cru ao `ErroNaLeitura`
  (a tabela de preços, a central da IA, Pessoas, Clientes, as Chaves de API,
  a conversa do Agent Dute) ainda dizem "Tentando de novo…" no toque, sem o
  relógio; o `useTentandoNoRelogio` é a peça para elas;
- a conferência com leitor de tela de verdade, num Android médio e no
  Safari.

**Parte 13g, os outros módulos (PR 610, 14/11/2026).** A parte 13 nos shells
e nas telas do Comercial, da Operação (com a Agenda), do campo, da TV da sala,
do Financeiro e do RH. Fecha também, nesses módulos, as necessidades 2, 3, 5,
8 e 10 (seção 5). As escritas, as callables, as chaves de idempotência e o
`customer_code` como fronteira não mudam, e a Operação e o campo continuam
sem ver valor.

- **O que já estava feito**: o `Dialog`, o `AlertDialog` e o `Sheet` já
  aceitavam o `ocupado` da parte 13a, mas os diálogos destes módulos não o
  usavam; o Início da Operação já tinha "Carregando o que precisa de você…" e
  parte dos blocos; a `useLeituraComFalha` já segurava a falha das leituras do
  react-query. O resto dizia "Carregando..." ou "Carregando" solto, pulsava o
  `Skeleton` antigo (5 telas), tinha 10 regiões vivas soltas, botões
  `disabled` que só trocavam o texto e leituras ao vivo cuja falha não tinha
  saída.
- **A leitura de cada tela**:
  - lendo, a `CarregandoNaRegiao`, que continua a espera da rota, com o
    gerúndio e o objeto ("Carregando os contratos…", "Carregando o Hoje…",
    "Carregando suas OS…", "Carregando as emissões…", "Carregando as
    pessoas…"); os Inícios do Comercial, da Operação, do Financeiro e do RH
    ficam com o título, a frase reservada e os blocos neutros; os Relatórios
    da Operação e do Financeiro mostram os números e as linhas em blocos, com
    o brilho de dois ciclos;
  - nenhuma contagem diz zero antes de ler (`NumeroLido`): lendo, o bloco;
    na falha, "—", fora da árvore (Contratos, Clientes, Orçamentos,
    Autorizações, Faturas, A faturar, Pessoas, Exportação);
  - a leitura ao vivo que falha tem "Tentar de novo" (`useNovaTentativa`,
    `novaTentativaDe`): o `onSnapshot` que falha não volta sozinho. A falha
    fica à vista até a nova assinatura responder, e só a leitura que não
    respondeu assina de novo: a lida fica com o que leu (a lateral do Início
    do Financeiro não some quando a nova tentativa é das emissões). O pedido
    chega às outras leituras da mesma chave na tela, e o contador do menu
    volta junto com o Início;
  - as leituras de cada parte da tela também têm a saída: os pagamentos da
    NF aberta e a receita do mês (antes, os pagamentos que falhavam ficavam
    girando para sempre), as autorizadas a faturar, os locais, os contatos e
    os contratos do cliente, as tabelas e os aditivos do contrato, a medição e
    a tabela do orçamento. Lendo, "Tentar de novo" aos 10 s e "Sem resposta
    do servidor." aos 70 s; na falha, a frase com "Tentar de novo";
  - as consultas que a tela junta (as fontes da via da NF, o rateio dos
    Relatórios do Financeiro) ficam na falha durante a nova tentativa
    (`useConsultasComFalha`), como a A faturar: o aviso não sai com o foco
    nele;
  - a releitura que falha não apaga o que já estava lido (necessidade 8):
    Pessoas, a ficha e a Exportação do RH e as Emissões mantêm a lista, e
    "Não foi possível atualizar…" fica escrita em cima dela, sem falar, com
    "Tentar de novo". Antes, a lista dava lugar ao alerta;
  - a TV sem quadro lido fica na falha durante a releitura dos 30 s, sem
    voltar a "Carregando o quadro…" nem falar a cada ciclo. A caixa de 40 px
    continua a espera da rota ("Abrindo TV da sala…"), sem o vão de 300 ms e
    sem outro anúncio;
  - o relatório só é o papel claro da impressão quando está lido: lendo e na
    falha, ele fica nas cores do tema (no escuro, a caixa e o rótulo da espera
    sumiam em tinta escura sobre o fundo escuro);
  - sem rede, as leituras do RH e do Financeiro pelas callables dizem a falta
    de conexão no erro, e são relidas sozinhas quando a rede volta, como as do
    WMS.
- **As ações**:
  - cerca de 40 ações passaram ao `BotaoDeAcao`, com o gerúndio, `aria-busy`
    e `aria-disabled`, nunca `disabled`; o Cancelar e o Voltar, ao
    `DialogCancelar`, travado durante a gravação. Uma chave por linha
    (`emAndamento`: o local, o contato, o aplicar, o baixar, a emissão e a
    baixa) diz qual linha grava, com as chaves de idempotência de sempre. As
    confirmações destrutivas mantêm a variante;
  - a ação de uma linha entre várias iguais leva o objeto (`objeto` no
    `BotaoDeAcao`): o nome é o rótulo à vista com ele ("Retomando…, Itaú
    Unibanco"), e aos 300 ms o Anunciador diz "Retomando, Itaú Unibanco"
    (momento 4). Antes, o nome fixo dizia "Tentar de novo" com "Retomando…"
    na tela. Vale para as Emissões, a Exportação, os locais e os contatos do
    Clientes e o aplicar da tarifa nas Medições;
  - o botão que sai da tela no fim da ação (`focoAoSair`) leva o foco ao
    título da seção, nunca ao `body`: o formulário dos Colaboradores, dos
    Veículos e da ficha do RH que fecha, a emissão que vai para Em andamento,
    a medição que muda de situação. No Aprovar do celular, o foco vai ao
    Próximo que entra no lugar dos botões;
  - o Ctrl+S e a "Prévia do PDF" do orçamento dizem "Salvando…" como o
    clique no Salvar;
  - o "Anexar arquivo" da ficha do RH segue o relógio da espera ("Enviando o
    arquivo…" aos 300 ms, e pelo menos 500 ms), e o seletor de arquivo nunca
    fica `disabled`: o foco de quem o usou pelo teclado fica nele;
  - a faixa da fila do campo também segue o relógio: o registro que vai na
    hora, com sinal, não mostra "Enviando" nem fala; quando o sinal volta, o
    "Sem sinal" fica até o envio aparecer. A fila sem sinal (`lib/campo`) não
    mudou.
- **Acessibilidade**:
  - quem fala é o Anunciador; as regiões vivas soltas saíram, também o aviso
    do recálculo do orçamento, e a trava do módulo pega o papel que escolhe
    entre dois (`role={erro ? "alert" : "status"}`). O resultado da A faturar
    e das Faturas sai só pelo toast, e não duas vezes;
  - a nova tentativa pedida que falha de novo deixa o mesmo alerta, que o
    leitor de tela não repete: 300 ms depois, se o aviso continua, o
    Anunciador diz a frase de novo (`FalhaNaSecao`, em todas as telas);
  - os rótulos com a reticência dos seis módulos estão numa lista só
    (`modulos-carregando-v2`), com os que a `SemLeitura` monta: o gerúndio que
    só aparece aos 300 ms também passa pela trava;
  - a lista de clientes vazia do Novo orçamento não é `listbox` sem opção.
- **Testes**: as travas do módulo (`modulos-carregando-v2`, a fonte;
  `modulos-carregando`; `modulos-acoes`), as leituras ao vivo com a nova
  tentativa (`lib/operacao/leitura.test.tsx`), as releituras do Financeiro e
  do RH, a TV, a fila do campo, o Anexar, a leitura sem rede, os anúncios e o
  axe dos diálogos e das telas do Comercial que não o tinham, com a lista dos
  textos. Contra o código de antes da parte, 75 dos 451 testes dela falham;
  contra o código da parte, 39 dos 317 da revisão falham, e os que passam são
  as travas e o axe que faltava. A suíte do app fica em 425 arquivos e 5.021
  testes.
- **Medição no Chromium** (harness com o SDK falso, só 127.0.0.1):
  - nada antes de 300 ms, salvo a continuação da espera da rota; aos 400 ms,
    o gerúndio com a caixa de 24 px em 17 telas, e nenhuma contagem "0"
    antes de ler (antes, "Carregando..." em 0 ms e "0" em Contratos e
    Pessoas); aos 10 s, a demora com "Tentar de novo"; aos 70 s, "Sem
    resposta do servidor." com o botão de 44 px;
  - Colaboradores › Salvar: o foco fica no "Salvando…" com `aria-disabled`, e
    dois Enter fazem uma chamada (antes, `disabled` e o foco no `body`); no
    fim, o foco vai ao título "Colaboradores". Na ficha do RH, ao "Ana
    Souza"; nas Emissões, a "Precisam de você"; no Aprovar a 390 px, ao
    Próximo. Antes, ao `body` nos quatro;
  - Emissões e Exportação aos 400 ms: o nome "Retomando…, Itaú Unibanco" e
    "Baixando…, Setembro de 2026 · versão 1", e o axe não acusa
    `label-content-name-mismatch` (antes, um nó em cada);
  - o relatório no escuro, lendo: a caixa e "Carregando o relatório…" em
    #F8FAFC sobre #070A13, 18,9:1 (antes, #1F2A3D, 1,37:1); na falha, o
    "Tentar de novo" escuro. O axe não acusa nada lendo, na demora e na falha;
  - a TV com o arquivo da tela em 1,5 s: "Abrindo TV da sala…" até 1.962 ms
    e "Carregando o quadro…" a partir de 1.986 ms, inteira desde o primeiro
    quadro, com uma fala só (antes, nada de 2.628 a 2.900 ms, a caixa entrando
    de novo e duas falas);
  - a fila do campo com a rede de volta em 1 s: com o envio de 60 ms, nenhuma
    faixa "Enviando" e nenhuma fala (antes, a caixa por 77 ms e a fala 1,6 s
    depois do fim); com 300 ms, "Enviando" de 1.322 a 1.802 ms, o mínimo, e a
    fala retirada; com 3 s, de 1.322 a 4.003 ms, e a fala aos 2,9 s, no
    intervalo de 2 s depois de "Sem conexão";
  - Pessoas, Exportação e Emissões sem rede: na volta da rede, aos 14 s, a
    lista chega sozinha em cerca de 15,3 s (antes, a falha ficava até o
    toque);
  - as autorizadas que nunca respondem: aos 71 s, "Sem resposta do
    servidor." com "Tentar de novo" (antes, a caixa girando sem saída);
  - o axe em Emissões, Exportação, Pessoas, Contratos e Clientes, lendo, na
    falha e lidas, no claro e no escuro, só acusa o azul do primário no escuro
    (4,3:1), o token registrado na seção 4.3 da especificação;
  - os Inícios do Financeiro, do RH e da Operação com o "Precisa de você"
    vazio: na primeira visita, sem a contagem lembrada, a lateral ainda muda
    de lugar (CLS de 0,32, 0,15 e 0,18, como antes); na segunda, 0.

Fica aberto:

- a assinatura ao vivo que falha depois de ter lido (a permissão que mudou, o
  índice) ainda troca a lista pela falha, com "Tentar de novo": guardar a
  lista com a frase em cima pede um estado a mais em cada tela;
- as ações de linha não usam a `useAcaoNaLinha`: falta o apoio da linha aos
  3 s ("Retomando a emissão…") e o "Conferir" da própria linha aos 70 s;
- os campos dos formulários e os botões que abrem painéis ou diálogos (Novo
  contrato, Editar, Fechar, Novo local) continuam `disabled` durante a
  gravação;
- a troca de filtro nos Relatórios ainda mostra "Carregando o relatório…" no
  lugar da tabela anterior (o padrão da parte 10 não chegou à tela de
  relatórios compartilhada);
- o "Abrir arquivo" da ficha do RH e o "Recarregar" do Aprovar no celular não
  têm espera;
- a caixa da TV continua a da rota, mas muda de lugar: a rota a mostra no
  alto, e o quadro, no meio da tela;
- sem rede, as leituras do RH e do Financeiro dizem "Não foi possível
  carregar…" na seção, e a falta de conexão fica com o aviso do shell;
- a fila do campo não diz o fim do envio;
- na primeira visita, o Início com o "Precisa de você" vazio ainda salta.

**A junção das partes 10 e 13b a 13d com as 13a, 13e a 13g (PR 610,
14/11/2026).** A parte 10 e as 13b, 13c e 13d foram feitas numa cópia, ao
mesmo tempo que a revisão da 13a, as 13e, 13f e 13g e a correção do relógio
(`99ee4b6`) no PR. Na junção, cada peça feita dos dois lados ficou uma só:

- **A `CarregandoNaRegiao`** é a do PR (a demora com "Tentar de novo" que
  recomeça o relógio, a desistência aos 70 s, `continuaARota`,
  `passaAdiante`, o `id`), com o que a da 13d tinha a mais: o `focoAoSair`
  (o foco vai à volta para o Fechamento quando a fatura chega) e a promessa
  do `onTentar`, que nunca fica sem tratar. O "Tentando de novo…" no botão da
  13d saiu: a nova tentativa é uma espera nova, que diz o gerúndio de novo
  aos 300 ms. A fatura, a separação, o romaneio e as Etiquetas continuam a
  espera da rota (`continuaARota`), como as telas do PR.
- **O "Tentar de novo" do cliente ativo** é um só, o `tentar` do
  `useActiveCustomer` (13e), agora pela `relerDoZero`: relê a falha e
  cancela a leitura presa sem dado, como fazia o `recarregar` da 13d, que
  saiu. O Fechamento e a fatura usam o `tentar`.
- **A nova tentativa da leitura ao vivo** é a da `useLeitura` (13g). A
  `useNovaAssinatura` da 13c (`lib/operacao/nova-assinatura.ts`) saiu; o que
  ela tinha a mais, a promessa do `tentar` que acaba quando a nova assinatura
  responde (o "Tentando de novo…" da `FalhaNaLeitura`), passou à
  `useLeitura`. A entrega dos Pedidos e os Retornos da Operação usam a
  `useLeitura` direto.
- **O foco que sai com o pedaço da tela** é um mecanismo só, a
  `segurarOFocoQueSai` (13e): a `SaiComOFoco` da 13b passou a ser ela, dita
  na tela, sem o pedido que a tela levava (`useFocoQueSegue` saiu); sem o
  alvo na tela, o foco vai ao título da seção, e nunca fica no `body`. O "⋯"
  dos Documentos usa a `segurarOFocoQueSai` direto. O `useFocoAoSair` do
  `ErroNaLeitura`, sem o alvo na tela, também vai ao título.
- **O Numerar do Sistema** (13d e 13e): os dois `BotaoDeAcao` com 44 px no
  celular, "Conferindo a numeração…" no "Ver o que muda", o fim do "Numerar
  agora" ("Numerado" pelo menos 1 s, "Não numerado" por 2 s) e o aviso dos
  10 s embaixo dos botões.
- **Os registros e a regra**: a 10.5 em ordem de parte, a linha 13 da
  tabela 10.4 com as sete partes e, no sistema visual, uma linha só para a
  `CarregandoNaRegiao`.

Fica aberto (no registro da junção; a revisão abaixo resolveu o primeiro e o
último):

- a `FalhaNaLeitura` (parte 10) ainda diz "Tentando de novo…" no toque, sem
  o relógio, no `ErroNaLeitura`; na falta de conexão, o `BlocoSemConexao` já
  usa o relógio. O `useTentandoNoRelogio` (13f) é a peça, e os testes da
  parte 10 que pedem o texto na hora mudam com ela;
- a `useLeituraDoPortal` (13f) tenta de novo por cima da `useLeitura`, que já
  tenta desde a 13g: fica para a revisão da 13g;
- o "Conferir" do "Numerar agora" aos 70 s não relê nada enquanto a
  numeração não responde (a 13d não deu a ele o que conferir).

**A revisão da junção (14/11/2026).** Três revisões (a lógica entre as
partes, o app inteiro no Chromium e o leitor de tela) acharam o que a junção
deixou entre as duas metades; cada achado foi reproduzido e corrigido com o
teste que falha antes:

- **O cliente ativo que falhou não segura mais as telas da cópia.** Com a
  lista dos clientes que falhou, a 13e diz "Não carregou" no seletor e não
  conta mais como lendo (o `isLoading` cai, também na nova tentativa); o
  Fechamento, a fatura, os Contratos, o Receber e "Adicionar documento" só
  esperavam o `isLoading` e liam e gravavam com o cliente padrão, também com
  outro escolhido no aparelho ("Marcar como paga" e "Emitir" iam ao padrão).
  Agora, com o `falhou`, a tela diz "Não consegui carregar o cliente ativo."
  no lugar do dado (`FalhaDoClienteAtivo`), com "Tentar de novo", que lê de
  novo a lista dos clientes e nunca o dado da tela; os meses do Fechamento
  dizem "—", o Receber não lê os avisos e a "Chegada avulsa" e o "Adicionar
  documento" ficam `aria-disabled`. A contagem lembrada de Pedidos não grava
  com o cliente que não se confirmou;
- **O "Numerar agora" aos 70 s confere.** A junção juntou o botão da 13d,
  que vira "Conferir", ao aviso da escrita da 13e. O "Conferir" ficava mudo
  enquanto a chamada não respondia e depois só voltava ao repouso, com a
  prévia velha na tela. Agora ele relê a prévia (a numeração sem gravar),
  também com a chamada a caminho, e diz "Conferindo…": sem nada a numerar,
  valeu ("Numerado"); com o que falta, a prévia nova, e o "Numerar agora"
  fica `aria-disabled` até a primeira chamada responder; nunca numera de
  novo. O aviso é o apoio do botão: "Sem confirmação do servidor" fica com o
  "Conferir", também depois de a chamada cair no prazo, e sai com o fim que
  ele achou. O tipo do aviso é o da chamada feita, e a numeração que acaba
  depois dos 10 s não faz o Anunciador dizer a demora de novo;
- **A nova tentativa da `FalhaNaLeitura` e dos Clientes no relógio.** O
  "Tentando de novo…" entra depois de 300 ms e fica pelo menos 500 ms (o
  `useTentandoNoRelogio`, como o bloco da conexão e o portal): a nova
  tentativa que responde antes, com o dado ou com a falha de novo, não pisca
  o botão nem muda o alerta, que o leitor de tela relia inteiro duas vezes em
  100 ms. A que demora mais diz "Tentando de novo…" e, se falhar de novo,
  volta ao "Tentar de novo": o alerta muda e é relido, o que diz a falha
  nova. O toque repetido com a leitura a caminho não lê de novo;
- **A lista de separação, o romaneio, a bancada e o pedido separado têm
  saída.** A lista continua a espera da rota, como o romaneio. As quatro
  ganharam o `onTentar`: "Tentar de novo" aos 10 s, a desistência aos 70 s e
  a falha com "Tentar de novo" (a `FalhaNaLeitura`). A lista e a bancada
  leem do zero a fila e o que a folha espera; o romaneio e o pedido separado
  assinam de novo só a leitura ao vivo que não chegou
  (`tentarOsQueFaltam`, na `useVolumesDoPedido`);
- **A `SaiComOFoco` com o alvo travado.** O alvo que está na tela mas não
  pode receber o foco (o "Entrega" `disabled` enquanto outra ação grava, o
  que está numa lista inerte ou escondida) conta como ausente: o foco vai ao
  título da seção, e não ao da página;
- **A contagem do segmentado na falha** é "—" em Pedidos e no Receber, como
  a `NumeroLido` e os SKUs: o Receber ficava com o bloco de quem ainda lê, e
  Pedidos com o rótulo só;
- **No Chromium** (harness com a API falsa, só 127.0.0.1): com a lista dos
  clientes em 500 e ACME no aparelho, o Fechamento não chama `/api/billing`
  e diz a falha, com os meses em "—"; com o prazo de 70 s, aos 71 s, a
  mesma tela, e nenhuma leitura do mês; o Receber diz "Em aberto · —" e a
  falha do cliente. O "Tentar de novo" com a nova tentativa em 150 ms não
  mostra mais "Tentando de novo…" no Catálogo, no Estoque nem nos Clientes.
  O "Conferir" do Numerar com o Enter diz "Conferindo…" (`aria-busy`) e
  volta à prévia nova; o Anunciador diz a demora uma vez. A `SaiComOFoco`
  com o alvo `disabled` leva o foco ao H2 da seção. Pedidos e Receber em
  falha, a 1440 e a 390 no escuro: "Em aberto · —", sem rolagem lateral e o
  axe limpo.

Fica aberto:

- o Estoque, o Catálogo e as outras telas que leem pelo `code` sem esperar o
  cliente ativo (nem enquanto lê, nem na falha) seguem com o cliente padrão
  quando a lista falha (o título diz "Estoque · BTG Pactual"): elas não
  esperavam o `isLoading` antes da junção, e a regra precisa de uma espera
  que essas telas não têm;
- enquanto a lista dos clientes lê, o Receber lê os avisos com o provisório,
  como na parte 8 (a contagem lembrada não grava com ele);
- o Pedidos e as outras telas que passam o `isFetching` cru ao
  `ErroNaLeitura` (Pedidos, as Chaves, a Central da IA) ainda dizem
  "Tentando de novo…" na hora;
- o diálogo "Cancelar pedido" de Pedidos diz o nome do cliente ativo, e não
  o do pedido.

**Parte 13h, a trava, o anel de foco e o aceite (PR 610, 14/11/2026).** A
última parte da seção 10.4: ela trava o que as anteriores fizeram, corrige o
anel do foco e os contrastes da fila que as revisões da parte 6 acharam, e
refaz o aceite do indicador (seção 8 da especificação) no Chromium.

- **A trava** (`lib/carregando/trava.test.ts`): lê o texto do código do app
  pelo parser do TypeScript (os literais, os modelos e o texto do JSX; os
  comentários e os testes ficam de fora) e reprova, com a lista do que
  achou, `animate-spin` fora do `Spinner`, `animate-pulse` fora do
  `Esqueleto` e do `Skeleton`, e "..." de três pontos em qualquer texto; no
  `index.css`, o `@apply` e a `animation` com `spin` ou `pulse`. Vale com
  zero exceções. No estado de antes, não havia `animate-spin` nem
  `animate-pulse` (só num comentário do `Skeleton`), mas sobravam dez textos
  de três pontos, migrados agora:
  - a entrada (`/sign-in`): "Entrando..." com o botão `disabled`. A
    `SignInPage` saiu do `App.tsx` para `pages/entrar.tsx`, para ter teste, e
    o "Entrar" é o `BotaoDeAcao` ("Entrando…" aos 300 ms, o foco fica nele, o
    segundo Enter não entra de novo);
  - o convite: "Conferindo seu convite..." numa região viva solta virou a
    `CarregandoNaRegiao`; "Saindo...", "Conferindo..." e "Aceitando..." com
    `disabled` viraram o `BotaoDeAcao`. O ocupado diz qual ação anda: a do
    botão diz o gerúndio, e as outras esperam `aria-disabled` (antes, o
    "Reenviar e-mail" fazia o "Já confirmei" dizer "Conferindo...");
  - as Movimentações (Estoque › Histórico e a rota antiga): "Carregando
    movimentações..." aparecia na hora, duas vezes (a lista do celular e a
    tabela), e nunca tinha saída. Agora é uma `CarregandoNaRegiao` só, no
    lugar da lista, que continua a espera da rota, com a demora, o "Tentar de
    novo" (`relerDoZero`) e o foco que sai para a linha de estado. O
    "Registrar Movimentação" é o `BotaoDeAcao` ("Registrando…"), num diálogo
    `ocupado` com o `DialogCancelar`, como a 13a;
  - o "Dividir em volumes": "Separando..." e "Dividindo..." num botão
    `disabled`. O confirmar é o `BotaoDeAcao` e o Voltar, o `DialogCancelar`
    ocupado, como o "Separar menos" da 13c.
- **O anel do foco** (WCAG 1.4.11 e 2.4.7). O `ring-ring/40` do `Button` e
  das peças que o copiavam (o título dos grupos da fila, a
  `CarregandoNaRegiao`, o chip, o segmentado, as abas, os links de Pessoas e
  Clientes, as linhas do campo e da Operação) tinha 1,91:1 no claro da v3 e
  1,65:1 no escuro, e o `outline-none` do Tailwind v4 o tirava também das
  cores forçadas, onde a sombra do anel some. Agora:
  - o token `--foco` (`ring-foco`) é o `--ring` cheio, relido na raiz, na v3
    e no `.dark` (a TV), com 3:1 ou mais no fundo, no cartão, no popover, no
    muted, no secundário, no `primary-soft` e na lateral, em todos os
    contextos (`tokens.test.ts`);
  - todo anel de foco do app usa o `ring-foco` e o `outline-hidden` da
    variante do foco, que deixa nas cores forçadas o contorno de 2 px que o
    sistema pinta: 93 classes em 70 arquivos, mudadas por um script e
    conferidas uma a uma. Ficam com outra cor só o anel na barra preta (o
    branco dela a 80%, 11,6:1), o do toast crítico (a cor do texto dele) e o
    halo claro do campo cujo foco é a borda cheia (`border-primary`). A
    borda do foco dos campos do Agent Dute e do painel do sistema, a 60%, vai
    à cheia. A trava reprova o anel com o `--ring` translúcido, o
    `outline-none` junto do anel e o anel sem o `outline-hidden`.
- **Os contrastes da fila** (as linhas da `QueueRow`):
  - "há 25 min" ia em tinta a 45% (2,92:1 no claro e 4,38:1 no escuro, pelo
    axe) e passa ao tom do apoio, como na prancha (4,67:1 e 6,86:1);
  - o "Ver itens", e na mesma linha o "Ver volumes" e o "Ver solicitações"
    do grupo vazio, usam o token novo `--primary-texto` (`text-primary-texto`):
    o próprio `--primary` no claro (4,57:1 no branco da v3) e, no escuro,
    `217 85% 65%` (6,25:1 no cartão; o `--primary`, como texto, dava 4,39:1);
  - o branco sobre o botão primário do escuro fica em 4,30:1, aberto (abaixo).
- **No Chromium** (harness com a API falsa servida pela rede, só 127.0.0.1;
  antes = `dae1a03`, depois = esta parte):
  - o anel, nos recortes a 2x com e sem o foco: antes, 1,91:1 no fundo
    `#F6F6F4` e 1,94:1 no cartão (claro), 1,65:1 e 1,67:1 (escuro); depois,
    4,22:1 e 4,57:1 (claro), 4,60:1 e 4,39:1 (escuro), no Aprovar, no
    Recusar, no chip, no fantasma e no título "Para aprovar";
  - nas cores forçadas emuladas: antes, o Aprovar, o chip, o segmentado, o
    fantasma e o título do grupo não mudavam um pixel com o foco (o Recusar
    só pela borda); depois, todos ganham o contorno sólido de 2 px (11,3:1 no
    claro e 8,7:1 no escuro, nas cores do sistema);
  - as Movimentações: antes, "Carregando movimentações..." de 0 ms aos 11 s,
    sem caixa, sem demora e sem saída; depois, nada até 300 ms, a caixa e
    "Carregando movimentações…" aos 400 ms, e aos 11 s "Demorando mais que o
    normal" com "Tentar de novo". O Registrar gravando: antes `disabled`,
    "Salvando...", o foco no `body` e o Esc fechava o diálogo; depois
    "Registrando…", `aria-busy` e `aria-disabled`, o foco no botão, o
    Cancelar `aria-disabled` e o Esc não fecha.
- **O aceite do indicador** (seção 8, refeito em Pedidos, no app de
  verdade):
  1. em 20 quadros parados ao acaso, entre 0,5 e 3,5 s, a caixa de 24 px da
     linha de estado ("Carregando pedidos…", no fundo `#F6F6F4`) tem de 400 a
     434 px com 3:1 ou mais, a 2x (o piso é 120), e a de 16 px no "Aprovando…"
     vermelho, de 155 a 170 (o piso é 40);
  2. com a thread principal ocupada por 2.001 ms (o screencast do
     Chromium), a caixa produz 111 quadros, 110 distintos (o piso é 30);
  3. com a CPU 4x mais lenta e a Slow 4G do DevTools (562,5 ms, 180 kB/s e
     84 kB/s), com a API na rede: Pedidos carregando por 4 s dá 241 quadros,
     nenhum acima de 33 ms (o maior, 17 ms) e nenhum quadro longo
     (`long-animation-frame`); o INP do Aprovar, em três linhas, é de 112, 80
     e 96 ms (antes, 128, 88 e 96): abaixo dos 200 ms;
  4. o axe (WCAG 2.1 A e AA) em Pedidos lendo, lida e aprovando, no claro e
     no escuro, só acusa o branco sobre o primário do escuro (4,3:1). Antes,
     também a idade (nos dois temas) e o "Ver itens" do escuro.

  Os itens 1, 2 e 3 passam no Chromium: o `Spinner` fica na caixa chanfrada.
  **O Android médio de verdade fica pendente**: a emulação da CPU e da rede
  não substitui o aparelho (a decisão 2 de 12/11 pede o aceite nele).
- **Testes**: a trava (os três padrões, o anel e a leitura do código), o
  token do anel e o do primário como texto, a linha da fila, a entrada
  (`pages/entrar.test.tsx`), as Movimentações
  (`pages/movements.carregamento.test.tsx`), o convite e o "Dividir em
  volumes". Contra o código de antes, 23 dos 101 testes dos oito arquivos da
  parte falham (e a entrada não tem o que importar); os que passam são o que
  já valia. A suíte do app fica em 473 arquivos e 5.335 testes (antes, 470 e
  5.313).

Fica aberto:

- o branco sobre o botão primário do escuro, 4,30:1 (o `#2B75EE`). Um token
  só não serve aos dois: o branco pede o azul com luminância até 0,183, e o
  azul como texto no cartão escuro pede 0,200 ou mais. O `--primary-texto`
  começa a separação, mas o fundo do botão é o `--primary` em 143 classes e
  o texto, em 153: escurecer o `--primary` do escuro (para `217 85% 50%`,
  5,07:1 com o branco) pede a medição nas telas principais e um PR próprio;
- o resto do `text-primary` do app no cartão escuro (4,39:1) e o vermelho da
  v3 como texto no fundo `#F5F5F3` (4,2:1, como o "Ver histórico completo de
  pedidos"): só a fila passou ao `--primary-texto`;
- nas Movimentações, a primeira leitura ainda não tem a forma final (as
  linhas-fantasma), e o rodapé diz "Exibindo 0 de 0 movimentações" enquanto
  lê;
- no convite, o "Link reenviado." continua um `role="status"` solto, e o
  "Esqueci minha senha" da entrada não tem espera;
- a trava cobre o anel de foco; o foco que é só cor de fundo (os itens dos
  menus do Radix, com `outline-none` e `focus:bg-*`) continua sem contorno
  nas cores forçadas (a revisão abaixo resolveu);
- o aceite num Android médio de verdade.

**A revisão da parte 13h (14/11/2026).** Três revisões (a lógica e o tempo,
a tela no Chromium e o leitor de tela) acharam o que a parte deixou; cada
achado foi reproduzido e corrigido com o teste que falha antes:

- **A capa de entrada é escura também para a espera.** A entrada e o convite
  moram na capa (`.auth-cover`), sempre escura, mas as peças do carregamento
  leem os tokens do tema. No claro, que é o tema padrão, "Conferindo seu
  convite…" e a caixa saíam em `#1F2A3D` sobre o cartão `#101112` (1,31:1;
  antes da parte, o texto solto tinha 3,59:1), e o "Reenviando…", a 1,12:1.
  A capa relê a tinta e o aviso da espera (`--carregando-cor`, o texto dela,
  e `--carregando-aviso`, o âmbar do escuro), e a `CarregandoNaRegiao` pinta
  a caixa e o rótulo com a tinta da espera (`text-carregando-cor`), que fora
  da capa é o `--foreground` de sempre. O toque dos botões escuros da capa é
  o fundo do hover dela: antes, de 0 a 300 ms, o "Reenviar e-mail" ficava com
  o `#E4E7EC` sob o texto claro, e o "Já confirmei" piscava azul cheio.
- **O convite.** A leitura tem a saída da seção 3: aos 10 s, "Tentar de
  novo", que lê o convite de novo; aos 70 s, "Sem resposta do servidor." com
  "Tentar de novo". Antes, a espera não acabava. O envio do e-mail que segue
  o "Aceitar convite" é a espera do "Reenviar e-mail", que diz "Enviando…",
  com `aria-busy`: antes, a tela "Confirme seu e-mail" esperava o envio sem
  sinal nenhum, com os dois botões travados em repouso. E, quando a tela
  troca (o "Aceitar convite", o "Já confirmei" que confirmou, o "Sair e
  continuar com o convite"), o foco que estava nela vai ao título da capa, e
  não ao `body`.
- **A capa no celular e nas cores forçadas.** Os campos e os botões têm 44
  px (eram 42), e o "Esqueci minha senha", 44 (era 20). O branco do "Entrar"
  e do "Aceitar convite" fica sobre o acento mais fundo
  (`--auth-accent-fundo`, `#1D6AE5`, 4,95:1; no `#3F8CFF`, 3,28:1); como
  texto e borda no cartão, o acento continua o `#3F8CFF`. O campo com o foco
  tem o contorno transparente, que nas cores forçadas o sistema pinta: a
  regra da capa com `outline: none` vencia o `outline-hidden`, e lá só
  sobravam o cursor e a borda.
- **O foco sem anel.** A trava só via a classe com a cor de um anel, e o
  foco feito de outro jeito escapava. Agora ela reprova também, com a lista:
  o `outline-none` em qualquer classe; a borda do foco translúcida (a 40%,
  50% ou 60%, abaixo de 3:1); o `outline-hidden` sem a variante do foco (nas
  cores forçadas, o contorno ficaria sempre); e quem esconde o contorno sem
  outro sinal no mesmo lugar (o anel, a borda cheia ou, nos itens dos menus
  do Radix e do cmdk, o fundo realçado). Os que mostram o foco em outro
  lugar estão numa lista curta, com o porquê: o campo sem moldura dentro da
  caixa que acende com o foco de dentro e os painéis que passam o foco para
  dentro. No `index.css`, nenhum `:focus-visible` apaga o contorno. O que
  ela achou foi corrigido: o menu lateral (os links do portal, o da área
  interna, o "Recolher menu" e a conta), que não mudava um pixel com o foco,
  e a barra de baixo do celular, só com o fundo, ganharam o anel; os campos
  do Agent Dute, do Envios e do Início do portal ganharam a borda cheia; a
  quantidade do pedido do Agent Dute, o anel por dentro; os itens dos menus,
  o contorno das cores forçadas no item com foco; o painel das abas e os
  títulos que recebem o foco do código, o anel do título da fila.
- **As Movimentações.** A `CarregandoNaRegiao` reserva a linha dentro do
  recuo de quem a usa (`box-content`): com o `py-8`, a região tinha 64 px e
  ia a 88 quando a caixa entrava, e o rodapé descia 24 px aos 300 ms (o
  mesmo no sino, no pedido separado, no romaneio, na separação, nas pessoas
  do cliente e nas notificações). No celular, a demora que quebra a linha
  fica centralizada, como a primeira. A nova tentativa que falha leva o foco
  ao "Tentar de novo" da falha que entra no lugar, e não à linha de estado,
  ainda vazia (em toda região e falha, pelo `useFocoAoSair`). O cabeçalho da
  tabela vai no tom do apoio (a tinta a 50% tinha 3,4:1), o código do
  produto no `--primary-texto` (4,38:1 no escuro), e o "Tipo de
  Movimentação" do diálogo Registrar tem nome (o rótulo não apontava para o
  campo).
- **Os textos e o axe** da demora e da desistência do convite e das
  Movimentações e do diálogo Registrar, em repouso e registrando, estão nos
  testes das telas.
- **No Chromium** (harness com a API falsa, só 127.0.0.1):
  - "Conferindo seu convite…" e a caixa em `#F7F8F8` sobre `#101112`, nos
    dois temas; o "Reenviando…", 15,2:1. O axe no convite lendo não acusa
    nada (antes, o contraste de 1,31:1). Aos 11 s, a pílula da demora com
    6,2:1 e o "Tentar de novo" em `#F8CD77`, 12,6:1; aos 72 s, "Sem resposta
    do servidor." com "Tentar de novo". O toque pelo teclado deixa o foco na
    região e, quando o convite chega, no título "Aceitar convite";
  - nas três trocas de tela do convite, o foco vai ao título (antes, ao
    `body`);
  - a 390 px, todos os controles da capa com 44 px; o "Entrando…" com
    4,95:1; nas cores forçadas, o campo de e-mail com o contorno sólido de 2
    px (antes, nenhum);
  - o Tab no menu do portal: os dez links e a conta mudam cerca de 1.270
    pixels com o foco, 5,25:1 no claro e 4,6:1 no escuro, e o contorno
    sólido de 2 px nas cores forçadas (antes, nenhum pixel nos três modos).
    A "Nova anotação": a borda com 3,62:1 no claro e 3,01:1 no escuro (antes,
    1,6:1 e 1,27:1) e o contorno nas cores forçadas (antes, só o cursor);
  - as Movimentações com a API em 1,6 s: a região tem 88 px desde o começo,
    e o rodapé fica em y=329 quando a caixa entra (antes, de 305 a 329, com o
    `layout-shift` aos 564 ms); a 390 px, a demora fica no meio, com 55 px de
    cada lado (antes, à esquerda). Lidas, o axe não acusa nada no claro
    (antes, o cabeçalho); no escuro, só o branco sobre o primário (aberto);
  - com o react-query de verdade, a nova tentativa que falha termina com o
    foco no "Tentar de novo" da falha (antes, na linha de estado vazia), e o
    convite com o envio pendurado diz "Enviando…", com `aria-busy`.
- **Testes**: contra o código da parte, 16 dos 75 testes dos sete arquivos
  com testes novos falham; os que passam são o que já valia (o foco que vai
  à linha de estado quando a lista chega, a troca de tela sem o foco nela, a
  regra da trava). A suíte do app fica em 474 arquivos e 5.355 testes
  (antes, 473 e 5.335).

Fica aberto:

- o controle travado (o `BotaoDeAcao` bloqueado a 0,45, a paginação
  indisponível a 0,5) leva o anel junto na opacidade: 2,07:1 no claro e
  1,81:1 no escuro no "Dividir em volumes" com o peso inválido. O 1.4.11
  isenta o componente inativo, e o foco continua visível; separar o anel da
  opacidade pede outro desenho do travado;
- na capa, aos 70 s, a desistência é o cartão claro do `ErroNaLeitura`, com
  o texto em linhas curtas;
- no celular, aos 10 s, a demora das Movimentações quebra a linha e empurra o
  rodapé 64 px: é o aviso que entra;
- seguem abertos o branco sobre o primário do escuro, o resto do
  `text-primary` no cartão escuro, a forma final da primeira leitura das
  Movimentações, o "Link reenviado." solto, o "Esqueci minha senha" sem
  espera e o aceite num Android médio de verdade.
