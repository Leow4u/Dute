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
