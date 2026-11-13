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
   lugar de desabilitado.*
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
   preso e o X de 44 px entraram na parte 13a do carregamento v2 (registro
   em 10.5); a trava de toque duplo veio com o `BotaoDeAcao` (parte 4).*
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
| 13 | A migração por área e a trava (`animate-spin` só no `Spinner`) | 13a (os diálogos), 13b (o Estoque e o armazém) e 13c (Receber, Operações, Pedidos e Solicitações) no PR 610; o resto a fazer |

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
  `alert-dialog.tsx` e `sheet.tsx`), ligado pelo `ocupado` da raiz (`Dialog`,
  `AlertDialog`, `Sheet`) ou do `DialogContent`, quando a ação mora no
  conteúdo (o convite):
  - o `onOpenChange(false)` não chega a quem usa, e o Esc, o toque fora e o
    X não fecham; o conteúdo marca `data-ocupado`;
  - o X e o Cancelar (o `DialogCancelar`, o `AlertDialogCancel`) ficam
    `aria-disabled`, a 0,45, com a trava no código, nunca `disabled`;
  - o `AlertDialogAction` é o `BotaoDeAcao` e nunca fecha sozinho (o
    `preventDefault` mora nele): quem fecha é o sucesso; na falha, a
    confirmação fica;
  - o confirmar é o `BotaoDeAcao` em todos, com o gerúndio ("Cancelando…",
    "Cadastrando…", "Salvando…"), e o foco fica nele durante a ação;
  - no fim, o foco volta ao controle que abriu o diálogo; o item do menu "⋯"
    vira o botão do menu. Se ele saiu da tela, ou sai logo depois (a linha
    que a releitura tira), o foco vai ao `focoAoFechar` de quem usa ou ao
    título da página, sem rolar a tela, nunca ao `body`
    (`lib/foco-de-volta.ts`, vigia de até `CARREGANDO.desisteMs`);
  - o `fecharTravado` da parte 11 saiu: os cinco diálogos dela (a chegada
    avulsa, a foto por IA, "Concluir separação", a entrega de Pedidos e
    Documentos) usam o `ocupado`.
- **No celular**: o `DialogFooter` fica preso embaixo do diálogo que rola
  (`sticky`, cobrindo até a borda, com o fio de cima), com os botões de
  44 px, também no `AlertDialogFooter`; o X do diálogo e do painel tem 44 px,
  e só o título deixa o lugar dele.
- **O que mudou, contra o código atual** (os 22 diálogos e as 4 confirmações
  da necessidade 6):
  - Pedidos: "Cancelar pedido" e "Salvar entrega" eram `disabled` e fechavam
    no meio; a recusa da solicitação fechava com "Recusando…". Agora os três
    seguram o diálogo, com o `BotaoDeAcao` e a mesma chave na nova tentativa;
  - Registrar exceção, Concluir inventário ("Encerrando…"), Receber retorno,
    Posições (Nova posição, Nova rua, Zona da rua), Falta da linha, Recusa
    da prateleira (e o Liberar da guarda), Guardar do RECEBIMENTO, Tabela de
    preços (o item), Sistema (Registrar incidente), owner (Preços e
    orçamento), Infra (Tabela do faturamento), Produtos e SKUs (o cadastro e
    o Excluir ou Arquivar), Recusar solicitação: fechavam no meio da ação e
    desligavam os botões;
  - Clientes (Novo cliente e Arquivar), Convite, Reenviar, Remover da lista e
    Revogar acesso: o Esc já não fechava em quase todos, mas o Revogar
    fechava, e os botões `disabled` derrubavam o foco no `body`;
  - as quatro confirmações (Emitir, Remover item, Remover posição, Apagar
    rotina), pela `Confirmacao`: não fechavam mais no clique desde 06/11, mas
    o confirmar e o Cancelar ficavam `disabled`;
  - o portal: o Editar evento só fecha depois do retorno (antes, fechar no
    meio desmontava a janela, e o aviso do salvo não chegava), o Excluir
    evento segura a confirmação, e o painel "Seu pedido" do Estoque fica
    aberto enquanto o pedido vai para a Dutelog, com o "Fechar pedido"
    `aria-disabled` e o Enviar no `BotaoDeAcao` ("Enviando o pedido…", no
    lugar do caminhão pulsando);
  - as duas outras confirmações com `AlertDialogAction` (a foto do produto e
    "Marcar como cliente" do Comercial) passaram ao `BotaoDeAcao` também.
- **O que já estava feito**: a entrega de Pedidos ("Confirmar entrega"),
  "Concluir separação", Documentos e a chegada avulsa seguravam o diálogo
  desde a parte 11, e o Esc não fechava Clientes nem Pessoas; mudaram só
  para o `ocupado`, com o X e o rodapé novos.
- **Testes**: por peça (`components/ui/dialogo-em-acao.test.tsx`,
  `lib/foco-de-volta.test.ts`, `confirmacao.test.tsx`): o Esc, o toque fora,
  o X e o Cancelar não fecham durante a ação, o Cancelar e o X ficam
  `aria-disabled`, o foco fica no botão tocado e volta ao gatilho ou ao
  título, e o axe; por área: Pedidos (`pedidos.dialogos.test.tsx`), Posições
  (`warehouse-positions.dialogos.test.tsx`), Documentos, Clientes e o portal
  (`eventos-editar.test.tsx`, `estoque-envio.test.tsx`). Contra o commit
  anterior, 26 deles falham, e o do foco de volta nem carrega.
- **Medição no Chromium** (harness com a API falsa e o servidor a 3 s, só
  127.0.0.1), antes e depois:
  - "Cancelar pedido", "Nova rua" e "Remover a posição": antes, o foco caía
    no `body` 100 ms depois do toque, e o Esc, o toque fora, o X e o
    Cancelar fechavam os dois primeiros no meio da gravação; depois, o foco
    fica no botão de ação ("Cancelando…") e nenhum dos quatro fecha;
  - o fim: antes, o foco ficava no `body` em Posições (a linha removida e a
    rua cadastrada); depois, vai ao "Nova rua" que abriu o diálogo e, na
    posição removida, ao título "Posições";
  - no celular de 390 × 664: o X passou de 28 para 44 px; com o diálogo
    rolado ao topo, o botão de ação ficava fora da vista (612 a 652 px, com o
    diálogo até 631) e passa a ficar preso a 77 px da borda de baixo, nos
    dois diálogos longos medidos (Nova posição e Cancelar pedido), no claro
    e no escuro.

Fica aberto:

- o teclado do celular: o rodapé fica preso na altura do diálogo, mas o
  Chrome do Android não encolhe a página quando o teclado abre (falta o
  `interactive-widget=resizes-content` no `viewport`, que muda o app
  inteiro) e o Safari não encolhe nada;
- o "fieldset" `disabled` da chegada avulsa durante o envio, que desliga o
  Cancelar e o "Criar conferência"; e os diálogos fora da lista (Trocar de
  caixa, Conferir e fechar, Remover rascunho, Remover linha e caixa da
  abertura, o Comercial, a Operação e o RH), que seguram o diálogo do jeito
  antigo, com `disabled`;
- o X do diálogo longo rola com o conteúdo, como antes;
- entre o toque e o primeiro desenho do `isPending` (um tique), o Esc ainda
  fecha o diálogo;
- a conferência com leitor de tela de verdade e num Android médio.

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
    entrou no lugar (`SaiComOFoco` e `useFocoQueSegue`, em
    `lib/carregando/use-foco-que-segue.tsx`): "Iniciar conferência da caixa"
    e a guarda, ao título da caixa; "Iniciar contagem", ao título do cartão;
    "Voltar à nova conferência", ao da nova caixa; "Carregar mapa inicial", à
    linha de estado das Posições;
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

Fica aberto:

- a `idempotency_key` nova a cada toque no "Salvar conferência" da ficha por
  linha (4.5): mudar é mudar a escrita, e esta parte não muda;
- na chegada por caixa e na bancada de separação, os vizinhos da ação em
  andamento (a seleção da caixa, "Revisar caixa", "Revisar entrada", "Editar
  conteúdo", "Marcar falta", o "⋯" e "Dividir em volumes") seguem `disabled`
  durante a ação, como na abertura (13b); o botão tocado nunca fica. O toque
  repetido dentro de 1 s do `BotaoDeAcao` também vale ali (a nova tentativa
  logo depois de uma falha espera o segundo);
- os Retornos da Operação que voltam a ler depois da falha e não têm retorno
  somem com o foco no aviso: o foco não tem para onde ir na tela;
- a mensagem da falha do romaneio, da lista de separação, da bancada de
  separação e do pedido separado ("Não foi possível carregar o pedido.")
  continua sem "Tentar de novo": vem da leitura ao vivo, que não relê sozinha;
- a foto dos itens que não veio (a leitura das fotos que falhou) volta ao
  "sem foto", sem aviso;
- os `role="status"` dos cartões de identificação (o produto novo e a
  família), que não são espera, ficam como estavam;
- o foco que segue o botão que entra no lugar na bancada de separação
  ("Separar" vira "Desfazer") não tem teste nem medição no navegador; o da
  disposição registrada tem;
- a conferência com leitor de tela de verdade e num Android médio.
