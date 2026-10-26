# Fase 2: Núcleo e app único (partes 1 a 3)

Desenho aprovado pelo Leonardo em 20/10/2026. É o runbook da fase: o registro de cada parte fica no fim.

## O pedido

Executar a Fase 2 do `docs/plataforma/plano.md` começando por:

1. módulos contratados no perfil do cliente e papéis da plataforma, com regras do Firestore e testes;
2. tela de entrada com um card por módulo, e entrada direta quando a pessoa só tem um módulo (cliente só com armazenagem cai direto no portal do WMS);
3. menu por papel e por perfil.

Um PR por parte, homologação primeiro, nada em produção sem OK.

## Como está hoje

- **Papéis.** São 7: `owner`, `admin`, `interno`, `wms`, `financeiro`, `suporte` e `cliente`. Vêm só de `users/{uid}`, sem custom claims. A lista está copiada em 9 lugares do app, das Functions e das regras.
- **`lib/dominio`.** Só tem `MODULOS = ["wms","operacao","comercial","financeiro","rh"]`, e ninguém importa. As Functions não conseguem importar: têm npm próprio, `rootDir: src` e o deploy leva só `functions/wms`.
- **Perfil do cliente.** O cadastro `customers` é gravado só pela callable `mutateManagedEntity`, com validação em `domain/customer-profile.ts`. A projeção `client_profiles` é o que o portal lê. O id dela é o do cadastro, não o `customer_code`, então as regras não conseguem achá-la. Não existe campo de módulos.
- **Entrada.** `/` só redireciona: cliente vai a `/portal`, wms a `/pedidos`, financeiro a `/faturamento` e os demais a `/dashboard`. Não há tela de escolha nem mockup dela.
- **Menu.** `APP_MODULES` em `lib/modules.ts` é uma lista de telas. Não sabe a que módulo da plataforma cada tela pertence. No portal, o menu é filtrado pelo modelo de operação.
- **Publicação.** Push na `main` publica frontend e functions na homologação. A produção sai da `main` por disparo manual. Regras e índices do Firestore sobem pelo job `regras` do CI, antes das functions e do frontend, e o job confere o conteúdo servido.

## Decisões deste desenho

1. **Chaves dos módulos** são as de `lib/dominio`. Na tela, `wms` aparece como "Armazenagem".
2. **O cliente contrata `wms`, `operacao` e `financeiro`**, como no plano. `financeiro` controla as Faturas do portal. Perfil sem o campo vale `["wms","financeiro"]` no app, nas Functions e nas regras, então a BTG continua igual sem migração.
3. **O backend nega por padrão.** As callables continuam recusando papel novo e cliente sem `wms`. Hoje todas as callables são do WMS. Cada módulo novo libera as suas, com teste.
4. **Liberação por ambiente** em `lib/liberacao.ts`, pela `VITE_FIREBASE_PROJECT_ID`: ligada no `dute-homolog`, desligada no `dute-prod`, no `dute-btg` e em build sem configuração. Ligar na produção é um PR com o seu OK. O CI não muda. Fica sob a liberação: a tela de entrada, o campo de módulos em Clientes, os papéis novos no convite e o link do logo. As Functions e as regras não ficam: elas são inertes para a BTG e para os 7 papéis de hoje, e vão junto se a `main` for publicada na produção.
5. **A tela de entrada segue a v3**, com tokens só dentro dela (`.v3`), sem tocar no visual do WMS. No escuro ela usa as cores escuras de hoje.
6. **Menu agrupado por módulo fica para o shell v3.** A parte 3 entrega o filtro por papel e por perfil e a barreira de rota. Assim não se faz um agrupamento no visual atual que o shell v3 jogaria fora.

## Papel × módulo

Fica em `lib/dominio`, ao lado da lista única de papéis.

| Papel | Módulos |
|---|---|
| owner, admin | wms, operacao, comercial, financeiro, rh |
| interno | wms, operacao |
| wms | wms |
| campo | operacao |
| comercial | comercial |
| financeiro | financeiro |
| rh | rh |
| suporte | wms, operacao |
| painel | nenhum; vai para `/tv` quando ela existir (existe desde a parte 3.12b da Fase 3: o painel tem a Operação e entra direto na TV) |
| cliente | os contratados |

Um módulo só aparece se tiver tela no app. Desde as partes 2.5 e 2.6 são
`wms`, `operacao`, `comercial` e `financeiro` (o Faturamento). Para o
cliente, `financeiro` nunca vira card: as Faturas são parte do portal.

A casa de cada módulo (atualizada na parte 2.8 e, com as Fases 3, 4 e 8,
em 24/10/2026):

| Módulo | Papel | Casa |
|---|---|---|
| wms | owner, admin, interno, suporte | `/dashboard` |
| wms | wms | `/pedidos` |
| wms | cliente | `/portal` |
| operacao | owner, admin, interno | `/operacao` (Início da Operação) |
| operacao | campo | `/campo` (o app do campo, parte 3.8b) |
| operacao | painel | `/tv` (a TV da sala, parte 3.12b) |
| operacao | cliente | `/portal/servicos` (Minhas OS, parte 4.3b) |
| comercial | owner, admin, comercial | `/comercial` (Início do Comercial) |
| financeiro | owner, admin, financeiro | `/financeiro` onde o Financeiro está liberado; fora, `/faturamento` |
| rh | owner, admin, rh | `/rh`, onde o RH está liberado (parte 8.1b) |

Quem cai onde, na homologação e na produção (as liberações do Comercial, da
Operação e da plataforma estão ligadas nas duas; as do Financeiro e do RH,
só na homologação; o `dute-btg` fica de fora de todas):

| Quem | Para onde vai |
|---|---|
| owner, admin | entrada com Armazenagem, Operação, Comercial e Financeiro (e o RH, onde ele está liberado), com os contadores |
| interno | entrada com Armazenagem e Operação |
| suporte | `/dashboard` direto (a Operação do suporte é só leitura da OS, sem tela) |
| wms | `/pedidos` direto |
| comercial | `/comercial` direto, o Início do Comercial |
| financeiro | `/financeiro` direto onde o Financeiro está liberado; no `dute-prod`, até o lançamento da Fase 4, `/faturamento` |
| campo | `/campo` direto, o app do campo |
| painel | `/tv` direto, a TV da sala |
| rh | `/rh` direto onde o RH está liberado; fora, "Nenhum módulo liberado" |
| cliente BTG, sem o campo | `/portal` direto, com armazenagem e faturas |
| cliente com wms e operacao | `/portal` direto, com Minhas OS e sem Faturas |
| cliente só com operacao | Minhas OS (`/portal/servicos`) direto: o Início do portal é o do armazém e sai do menu dele |
| cliente só com financeiro | "Nenhum módulo liberado": sem armazenagem nem Operação, não há serviço que gere fatura |
| papel novo | "Nenhum módulo liberado" |

O cliente nunca vê os cards: o portal é um lugar só.

Dentro de cada módulo, o nome no topo da barra é o seletor (parte 2.3), e o
logo leva aos cards.

## Parte 1: papéis da plataforma e módulos contratados (um PR)

**Domínio compartilhado**
- `lib/dominio/src/index.ts`: `PAPEIS` com os 11, `Papel`, `MODULOS_POR_PAPEL`, `MODULOS_CONTRATAVEIS`, `MODULOS_PADRAO_CLIENTE` e os rótulos dos módulos.
- O app passa a depender de `@workspace/dominio`, no padrão de `@workspace/api-client-react`, com referência no `tsconfig.json`. O `pnpm-lock.yaml` é gerado com o pnpm 9 do CI.
- As Functions recebem uma cópia literal em `functions/wms/src/domain/platform-roles.ts`. Um teste do app lê `lib/dominio`, esse arquivo e o `firestore.rules` e trava as três listas, como `operations.test.ts` já faz com os modelos.

**Functions**
- `Role`, `VALID_ROLES` e `loadProfile` usam a lista única. Convite e troca de papel aceitam os 11.
- `getProfile` passa por uma função pura de acesso, com teste. Recusa papel fora dos 7 de hoje. Recusa cliente cujo contrato não tem `wms`; para saber isso, lê `client_access` só quando a pessoa é cliente. A rotina agendada (`runRoutine`) passa pela mesma função. Com isso, `recordOperationalEvent`, `requireCustomerScope`, as rotinas e as ferramentas do agente não alcançam papel novo nem cliente sem armazenagem.
- `domain/customer-profile.ts`:
  - `resolveContractedModules(data.modules ?? before.modules)`: só chaves conhecidas, sem repetição, ao menos uma, padrão quando ausente.
  - O valor é gravado depois do `...data`, para o navegador não mandar um array cru.
  - `modules` entra em `CLIENT_PROFILE_PUBLIC_FIELDS` e na projeção `client_profiles`.
  - Nova projeção `client_access/{customer_code}` com `customer_code`, `modules` e `updated_at`. O id é o código cru, sem `safeDocId`. É gravada em toda escrita do cadastro, inclusive no arquivamento, a partir de `{...before, ...payload}`, e nunca é apagada.
  - Na criação, o código não pode ter `/` nem ser `.`, `..` ou `__x__`, e não pode repetir o de outro cadastro. A checagem fica na transação, como a da sigla.
- `index.ts`: `modules` em `CUSTOMER_WRITE_FIELDS`. A transação do cadastro grava `client_access`. O evento `customers.*` leva os módulos antes e depois.
- Os arquivos de teste novos entram na lista fixa de `test:unit` e `test:integration` do `package.json`.

**Regras do Firestore**
- `validProfileRole` com os 11.
- `customerHasModule(m)` lê `client_access/{customer_code}` e usa `['wms','financeiro']` quando o documento não existe. Só é avaliada para cliente. O navegador não lê `client_access`: o `get()` das regras não depende de permissão.
- O cliente precisa de `wms` para ler `client_inventory`, `client_order_tracking`, `client_request_status` e `client_documents`, e de `financeiro` para ler `client_invoices`.
- `ops_aggregates` deixa de ser lido por qualquer cliente. Hoje um cliente lê os totais de todos, e o portal não usa essa coleção.
- `client_event_templates` continua sem regra, ou seja, ninguém lê direto. A barreira fica nas callables.
- Storage não muda.

**App**
- `ProfileRole` passa a ser `Papel`, e `normalizeProfileRole` aceita os 11.
- `INTERNAL_ROLES` continua com os 6 de hoje. Assim, papel novo não herda Agent Dute, Documentos nem rota sem dono.
- Configuração fica aberta aos 11, em `modules.ts` e `settings-nav.ts`.
- Papel novo aterrissa em `/configuracoes/conta` até a parte 2. Sem isso, `/dashboard` nega e volta para `/` em laço.
- A sincronização em tempo real e o seletor de cliente ativo passam a valer só para `INTERNAL_ROLES`.
- Rótulos de Campo, Comercial, RH e Painel. As cópias da lista de papéis em `App.tsx`, `users.tsx`, `cloud-api.ts` e `system-dashboard.ts` passam a usar a lista única.
- O convite e o quadro "O que cada perfil faz" mostram os papéis novos só com a liberação ligada.
- Campo "Módulos contratados" em Configurações › Clientes, com Armazenagem, Operação e Financeiro, sob a liberação.
- `modules` em `CustomerProfileRecord` e `OperationProfile`, com o padrão também quando a leitura falha.

**Ferramentas**
- `tools/full_reset_btg.py` preserva `client_access` junto com `customers`.

**Testes que falham antes e passam depois**
- **Regras:**
  - aceite de convite com papel novo;
  - papel novo negado em `customers`, `stock_balances`, `orders`, `billing_*`, `client_inventory`, `events` e no chat;
  - seed com `suporte`;
  - cliente sem `client_access` lê como hoje;
  - cliente com `client_access` só `operacao`, código "BTG Pactual", não lê o WMS nem as faturas;
  - cliente com `wms` e `financeiro` lê;
  - interno com `customer_code` "Dutelog" continua lendo mesmo com `client_access/Dutelog` só `operacao`;
  - cliente não lê `ops_aggregates`;
  - ninguém lê nem grava `client_access` pelo navegador.
- **Functions:**
  - função de acesso para os 11 papéis e para cliente com e sem `wms`;
  - `resolveContractedModules`;
  - alterar sem o campo mantém os módulos;
  - arquivar mantém `client_access`;
  - código repetido é recusado;
  - a transação grava as duas projeções.
- **App:**
  - 11 papéis;
  - papel novo sem menu e com casa na Conta;
  - rota sem dono nega papel novo;
  - convite por liberação;
  - padrão do perfil;
  - trava das três listas.
- **Python:** `client_access` é preservado na zeragem.

## Parte 2: tela de entrada (um PR, só frontend)

- `lib/platform-modules.ts`: os módulos do app, com rótulo, ícone, se têm tela e a casa por papel. A função pura `entrada(papel, perfil)` responde "vai para X", "mostra estes cards" ou "nenhum módulo".
- `App.tsx`: com a liberação ligada, `/` usa `entrada`. O cliente espera o perfil, como o `RoleGate` já faz. Com a liberação desligada, tudo continua como hoje.
- `pages/entrada.tsx`:
  - cabeçalho preto de 64 px com logo e menu da conta (Configuração, Sair), como em `Portal.dc.html`;
  - "Bom dia, Nome" como em `Inicio.dc.html`;
  - um card por módulo, com ícone em caixa de 52 px e nome; o card inteiro é clicável;
  - sem legenda e sem números;
  - sem módulo: "Nenhum módulo liberado" e Sair.
- Tokens v3 em `.v3` no `index.css`, fora de `@layer`. A Manrope entra no `@import` de fontes que já existe; o navegador só baixa o arquivo quando a tela usa a fonte.
- O "Voltar" da Configuração cai em `/` com a liberação ligada. A casa de papel novo deixa de ser a Conta.
- **Testes:**
  - `entrada` para cada papel e perfil;
  - trava: a casa de cada módulo é uma rota que o papel abre;
  - render sem legenda;
  - com a liberação desligada, `getHomePathForProfile` fica igual;
  - `theme-colors.test.ts` verde;
  - a liberação recebe o ambiente como parâmetro, então os testes não dependem do `.env` da máquina.

## Parte 3: menu por papel e por perfil (um PR, só frontend)

- `AppModule` ganha `modulo`:
  - Pedidos e Estoque são `wms`;
  - Faturamento é `financeiro`;
  - Início, Agent Dute, Relatórios e Documentos são núcleo;
  - no portal, Faturas é `financeiro`, Início e Agent Dute são núcleo e o resto é `wms`;
  - rota sem módulo conhecido conta como núcleo.
- `getNavigationForProfileRole` filtra também por módulo. Para a equipe, `MODULOS_POR_PAPEL` com tela. Para o cliente, os contratados com tela.
- A decisão do `RoleGate` vira função pura e passa a barrar rota de módulo não contratado.
- A sincronização do portal só assina as coleções dos módulos contratados.
- O logo leva a `/` com a liberação ligada.
- **Testes:**
  - para os 7 papéis e toda rota protegida, "abre hoje" é igual a "abre depois" (trava nova);
  - os testes de `modules.test.ts` passam sem mudar;
  - cliente só com `operacao` não vê nem abre tela do WMS;
  - cliente sem `financeiro` não vê Faturas;
  - com `operacao` marcado como tendo tela num teste, o interno vê Armazenagem e Operação no mesmo menu e o cliente só com `wms` não vê nada de Operação.

## Publicação de cada parte

1. Abro o PR e espero o CI verde.
2. Faço o merge na `main`. Desde o PR #106 (20/10/2026) o CI publica na homologação, nesta ordem: regras e índices (job `regras`, conferido por `tools/check_rules_deployed.sh`), depois frontend e functions.
3. Confiro a publicação e a homologação e passo para a próxima parte.

Na parte 1, o campo de módulos só deve ser salvo depois que o job de functions terminar. Frontend e functions sobem em paralelo, e antes disso a function antiga descartaria o campo.

Produção: nada, até o seu OK. Se a `main` for publicada na produção no meio da fase, as Functions e as regras novas vão junto e não mudam nada para a BTG nem para os 7 papéis. As telas novas ficam desligadas pela liberação.

## O que estas partes não entregam

O resto da Fase 2:
- catálogo da LPU no núcleo;
- shell v3, com o menu agrupado por módulo e a Administração no menu;
- Início "Precisa de você" de todos os módulos. Até lá, o card Armazenagem leva ao Início de hoje;
- TV em `/tv` com o papel `painel`;
- colaboradores e veículos, entregues na parte 1 da Fase 3
  (`docs/plataforma/fase-3-operacao.md`).

O critério de pronto da fase ("cliente só armazenagem não vê nada de OS, interno vê WMS e Operação no mesmo menu") fica provado por teste na parte 3. Na homologação, ele aparece quando a Operação tiver a primeira tela. A regra de `service_orders` com `customerHasModule('operacao')` entra na Fase 3, com a coleção.

A checagem de módulo por callable (por exemplo, Faturas pedindo `financeiro` no backend) e o filtro das ferramentas do agente por módulo entram antes de existir cliente sem armazenagem, na Fase 4. Até lá, a barreira geral do `getProfile` cobre.

## Achados fora destas partes

- **Corrigido pelo PR #107, na produção desde 20/10/2026:** `/portal/faturas/relatorio` e `/portal/agente/operacional` não estavam na tabela de rotas, e o cliente que abria o relatório das faturas voltava ao Início.
- `suporte` lê faturamento, contra a regra "preço só para owner, admin, financeiro e comercial".
- A troca de papel não ajusta o `customer_code`, e o evento não guarda o papel anterior.
- O aceite de convite de cliente não grava evento.
- O convite de cliente aceita qualquer texto como código.
- `portal_status` inativo não bloqueia nada.
- O plano dá RH ao owner ("tudo") e também diz "só rh e admin". Decidir na Fase 8.
- Funções mortas nas regras (`safeUserRoleUpdate`, `validInviteRoleForManager` e outras) carregam listas antigas de papéis.

## Registro

### Parte 1: papéis da plataforma e módulos contratados

Branch `plataforma/fase-2-parte-1`. Entregue como no desenho acima, menos o teste da transação do cadastro (último parágrafo).

Testes que falhavam antes e passam depois:
- **Regras do Firestore:** 7 testes de comportamento novo falham com as regras da `main` (aceite de convite para os 4 papéis novos; cliente só com operação; cliente sem financeiro; cliente lendo `ops_aggregates`).
- **Functions, app e ferramentas:** os testes novos cobrem funções que não existiam (`wmsAccessProblem`, `resolveContractedModules`, `clientAccessProjection`, `assertCustomerCodeAvailable`, `readContractedModules`, `plataformaLiberada`) ou mudam de propósito (`getHomePathForProfile` para papel novo, Configuração aberta aos 11).

A ligação no `index.ts` (barreira em `getProfile` e `runRoutine`, gravação de `client_access` na transação do cadastro, módulos no evento `customers.*`) não tem teste próprio: o `index.ts` não é testável direto, como o resto das callables (CLAUDE.md, "Como trabalhamos").

Publicada na homologação em 20/10/2026 pelo merge do PR #110. No run do merge (39409185672), as Functions da parte 1 subiram ("Publicar todas as functions" terminou com sucesso); o cancelado foi a conferência do invoker, interrompida pela publicação do merge do PR #109. Essa conferência rodou completa no run do #109 (39409836510), que já continha o #110.

### Parte 2: tela de entrada

Branch `plataforma/fase-2-parte-2`. Entregue como no desenho.

- `lib/platform-modules.ts`: os módulos do app, a casa de cada um por papel e a função pura `entrada`. A trava confere que cada casa é rota que o papel abre e que só existe para o papel que trabalha no módulo.
- `pages/entrada.tsx`: cabeçalho preto, saudação e um card por módulo; sem módulo, "Nenhum módulo liberado" e Sair. O teste de render confere que a tela só tem data, saudação, nome, iniciais e os módulos.
- `index.css`: tokens v3 em `.v3`, só no claro; no escuro valem as cores de sempre. A Manrope entrou no `@import` de fontes e só é baixada por esta tela.
- Com a liberação desligada, `/` e o "Voltar" da Configuração continuam como antes.
- O Início (`pages/home.tsx`) passou a usar a saudação de `lib/saudacao.ts`, a mesma da entrada.

Conferido numa prévia estática com o CSS do build: claro, escuro e celular de 375 px sem rolagem lateral.

### Decisão de 23/10/2026: um shell por módulo

O Leonardo pediu a separação por módulo: um menu único com todos os módulos
inflava demais. A decisão 6 deste desenho (agrupar por módulo num shell v3
único) e a parte do item 3 que juntava tudo num menu ficam superadas. Vale o
que está em `plano-de-implantacao.md`, seção 1.1 e seção 4: cada módulo tem o
próprio shell; o nome do módulo no topo da barra é o seletor; o logo leva aos
cards; Início por módulo; Clientes por módulo; Configuração no menu da conta;
Agent Dute só no WMS até a Fase 5. A barreira por módulo contratado do cliente
continua e entra na parte 2.7.

### Parte 2.3: shell v3 por módulo

- `components/layout/shell-do-modulo.tsx`: barra lateral preta (`bg-v3-header`)
  com o logo (leva a `/`), o seletor de módulo, as telas do módulo com
  contador opcional por item (vermelho só no alerta) e a conta no rodapé; no
  celular, cabeçalho preto com o seletor e a conta, e a barra inferior preta
  com o ícone aberto no vermelho da marca. Sem conexão, uma linha de status
  "Sem conexão". O Comercial e a Operação usam esse shell; `comercial-shell` e
  `operacao-shell` saíram.
- `lib/seletor-de-modulo.ts` (`opcoesDoSeletor`, `moduloAberto`) e
  `components/layout/seletor-de-modulo.tsx`: a lista do seletor é a dos cards
  da entrada, na mesma ordem, com o aberto marcado e "Todos os módulos" no
  fim. Quem tem um módulo só vê o nome, sem lista.
- WMS: o seletor entra no topo da barra (aberta e recolhida); o menu da conta
  deixa de ter o submenu Módulos no computador e mantém a lista no cabeçalho
  do celular, que não tem o seletor. Nada mais muda no WMS.
- Token novo `--v3-marca` (o vermelho #E71C23 nos dois temas; o `--primary`
  do escuro é azul), para o marcador, o contador de alerta e o avatar.
- Testes: `shell-do-modulo.test.tsx` (telas, seletor, contador, celular, sem
  conexão, lista de textos e axe), `seletor-de-modulo.test.ts`,
  `account-menu.test.tsx` atualizado. Ajudantes novos para as telas das
  próximas partes: `src/test/acessibilidade.ts` (axe-core no jsdom, regras
  WCAG 2.1 A e AA, sem o contraste, que o jsdom não calcula) e
  `src/test/textos.ts` (a trava contra legenda), com o teste deles.
- Conferido no Chromium com o CSS do build, a 1440 e a 390 px.


### Ordem das partes 2.4 a 2.6

A entrada com contadores (2.4) conta o que o Início de cada módulo mostra.
Por isso a ordem ficou 2.5 (Início do Comercial), 2.6 (Início da Operação) e
depois 2.4: os contadores leem as mesmas consultas dos Inícios, sem uma
segunda regra de contagem.

### Parte 2.5: Início do Comercial

- `/comercial` passa a ser o Início (`pages/comercial/inicio.tsx`), como em
  `docs/mockups/ModComInicio.dc.html`; a fila de orçamentos mudou para
  `/comercial/orcamentos`. O menu do Comercial ganhou Início no topo; a
  montagem, a aprovação e o documento continuam acendendo Orçamentos.
- O "Precisa de você" saiu do Início do WMS (`lib/home-inbox.ts` e
  `pages/home.tsx` não leem mais nada do Comercial) e mora em
  `lib/comercial/pendencias.ts`: orçamentos para aprovar (só o owner),
  orçamento devolvido (só para quem montou), alertas de contrato, prazo de
  faturamento e executados há mais de 30 dias, medição do mês que passou sem
  envio e proposta aguardando o cliente há mais de 5 dias corridos
  (`DIAS_SEM_RESPOSTA`, a confirmar com o Leonardo). O mais urgente primeiro:
  crítico, atenção e informação; no mesmo tom, a ordem das fontes.
- Ao lado, "Orçamentos por etapa" (as oito etapas ativas, com "Abrir a fila")
  e o mês: enviados (primeiro envio), fechados (primeira entrada em "Para
  planejar") e perdidos, no fuso de São Paulo. Duas consultas a `demands`
  (etapas ativas; `updated_at` desde o início do mês) e uma a `quotes` em
  rascunho, para os devolvidos.
- As telas do Comercial deixaram as abas internas (`abas-do-comercial.tsx`
  saiu): a barra do módulo é a única navegação entre elas, e o título de cada
  tela é o nome dela (Orçamentos, Contratos, Autorizações, Medições; na
  montagem, o número do orçamento).
- O shell v3 do módulo usa três telas e "Mais" na barra do celular, como nos
  mockups (`MOBILE_BAR_SLOTS_DO_MODULO`); o WMS continua com quatro.
- `getActiveModule` passou a respeitar as telas de cada item (`tambem`), como
  o menu: com a fila fora de `/comercial`, a montagem acenderia o Início.
- Testes: `pendencias.test.ts` (cada fonte, quem vê, a ordem, sem resposta e
  devolvidos), `inicio-view.test.tsx` (textos na ordem, lista contra legenda,
  estados e axe), navegação e telas atualizadas.
- Conferido no Chromium com o CSS do build, a 1440 e a 390 px.

### Parte 2.6: Início da Operação

- `/operacao` passa a ser o Início (`pages/operacao/inicio.tsx`), como em
  `docs/mockups/ModOpInicio.dc.html`; a fila do dia mudou para
  `/operacao/hoje`. O menu da Operação ganhou Início no topo.
- O "Precisa de você" (`lib/operacao/pendencias.ts`) usa só o que a OS já
  grava (aberta, agendada com data, hora, equipe e veículo, cancelada):
  - OS aberta ou agendada de demanda que o Comercial perdeu ou cancelou
    (crítico, "Cancelar OS");
  - OS agendada para hoje ou depois com alguém da equipe ou o veículo
    desativado no cadastro: é a "OS sem equipe ou veículo" do modelo de hoje,
    porque agendar exige os dois (crítico no dia, "Reagendar");
  - OS para agendar e demandas em Para planejar sem OS;
  - CNH vencida ou vencendo em até 30 dias (`DIAS_PARA_A_CNH`), de quem está
    ativo, com quantas OS a pessoa tem até a validade.
- Ao lado, "Hoje na operação" (agendadas hoje, para agendar, próximos dias,
  com "Abrir o Hoje") e "Equipe hoje" (quem está escalado, pela hora da
  primeira OS, e quem está livre).
- Ficam para as partes da Fase 3 que criam os estados: "OS em revisão",
  "Em execução" e "Atrasadas" no "Hoje na operação", o prazo da OS e a
  equipe "agora" (a caminho, em campo), que depende do registro do campo.
  Até lá, a seção se chama "Equipe hoje", porque mostra a escala, não a
  posição.
- Links diretos: `/operacao/hoje?os=10045-01` abre a ficha da OS e
  `/operacao/colaboradores?id=col_...` abre a do colaborador
  (`hrefDaOs`, `hrefDoColaborador`).
- As leituras são ao vivo, como no resto do módulo, e só para owner, admin e
  interno; as OS lidas são só as abertas e agendadas. Enquanto uma leitura
  não chega, a lista não aparece, para não dizer "nada parado" sem saber.
- Testes: `lib/operacao/pendencias.test.ts` (cada fonte, ordem por tom, o dia
  e a equipe, nenhum valor), `pages/operacao/inicio-view.test.tsx` (textos na
  ordem, lista contra legenda, ações, estados e axe), navegação atualizada.

### Parte 2.4: entrada e menus com contadores

- Os contadores saem da mesma lista do "Precisa de você" de cada Início, sem
  segunda regra de contagem (`lib/resumo-do-modulo.ts`):
  - na entrada, cada card mostra quantas linhas o Início do módulo tem e a
    primeira delas; a frase soma tudo ("6 coisas precisam de você hoje.")
    e só aparece quando todos os módulos responderam. O número fica
    vermelho só quando há item crítico; sem nada parado, sem número;
    carregando ou com falha, o card fica só com o nome (não inventa zero);
  - no menu do Comercial e da Operação, o Início conta todas as linhas e
    cada tela conta as linhas cuja ação leva a ela (Orçamentos, Autorizações,
    Medições; Hoje, Colaboradores).
- As leituras são as mesmas dos Inícios: `useInicioDoWms` (extraído de
  `pages/home.tsx`), `useInicioDoComercial` e `useInicioDaOperacao`, com um
  parâmetro `ligado` para a entrada só consultar os módulos dos cards. O
  Comercial ganhou um minuto de validade nas consultas, para o menu e o
  Início não repetirem a leitura; na Operação, o SDK do Firestore junta as
  assinaturas iguais.
- O Financeiro não tem Início ainda (Fase 7): o card dele fica só com o nome.
- Testes: `resumo-do-modulo.test.ts` (o contador bate com a lista do Início
  do Comercial e da Operação), `entrada.test.tsx` (cards, frase, vermelho só
  no crítico, carregando, lista de textos e axe) e
  `entrada-leituras.test.tsx` (no jsdom, com o Firestore e o fetch
  espionados: o papel comercial não assina nada da Operação, o interno não
  lê nada do Comercial, e a entrada só lê os módulos dos cards).
- Conferido no Chromium com o CSS do build, a 1440 e a 390 px.

### Parte 2.7: barreira por módulo contratado do cliente

- Cada tela do portal depende de um módulo contratado
  (`MODULO_DA_TELA_DO_PORTAL` em `lib/operations`): o Início é de todos;
  estoque, eventos, envios, pedidos, documentos e o Agent Dute do portal são
  da armazenagem (`wms`); faturas, do `financeiro`. `portalModulesFor` passa
  a cruzar o modelo de operação com os módulos do perfil publicado
  (`client_profiles`): o menu esconde, e o `RoleGate` devolve ao Início do
  portal a tela de fora do contrato, mesmo por link direto.
- O portal só lê as projeções do contrato (`leiturasDoPortal`, em
  `/api/client/overview`), a mesma régua das regras (`isOwnProjectionWith`):
  sem armazenagem, nada de `client_inventory`, `client_order_tracking`,
  `client_request_status`, `client_documents` nem do valor da mercadoria
  (`catalog_prices`); sem financeiro, nada de `client_invoices`. Antes o
  portal pedia tudo e as regras negavam.
- O Início do portal esconde as seções de fora do contrato.
- Regra: `service_orders` ganha o ramo do cliente, só as próprias OS e só com
  a Operação contratada (`isOwnProjectionWith('operacao')`). Sem tela que leia
  até a Fase 4.
- Testes: `operations.test.ts` (telas por contrato e a régua conferida contra
  o `firestore.rules`), `modules.test.ts` (menu), `portal-leituras.test.ts`
  (no jsdom, o que o portal pede para cada contrato),
  `pages/client/inicio.test.tsx` (seções) e
  `functions/wms/src/operacao-cadastro.rules.test.ts` (no emulador, o cliente
  lê a própria OS só com a Operação no contrato; falha com a regra antiga).

### Parte 2.8: registro

- "Quem cai onde" e a casa de cada módulo atualizados acima, com a Operação e
  o Comercial.
- `CLAUDE.md`: o estado da Fase 2 e a regra das telas novas (lista de textos,
  `axe` e a contagem única pelo "Precisa de você").
- Fica em aberto o cliente só com `financeiro`, que hoje cai em "Nenhum
  módulo liberado" porque o portal só abre com a armazenagem.
  - Desde 24/10/2026 o cliente só com a Operação entra em Minhas OS
    (correção da Fase 4, em `fase-4-financeiro.md`). O só com `financeiro`
    continua sem módulo: sem armazenagem nem Operação, não há serviço que
    gere fatura.

**Pronto da Fase 2 na homologação** (plano, seção 4): o owner entra pelos
cards com os contadores e troca de módulo pelo seletor; o Guilherme cai no
Início do Comercial e não vê seletor; o interno vê Armazenagem e Operação; um
cliente só com armazenagem não vê nada de OS; as telas novas passam no `axe`
e no teste de textos; o WMS não mudou além do seletor. A produção recebe com
o OK do Leonardo, pela publicação manual.

### Correção: o token do convite nos eventos

Achada em 25/10/2026, numa revisão da administração de acesso. Está na
produção.

- **O defeito.** O id do convite é o token do link (`invites/{token}`), e
  quem o tem aceita o convite com o e-mail convidado.
  - O evento `invites.create` (e o `invites.archive`) gravava o token no
    `entity_id` e na descrição, e os eventos são lidos por interno, wms e
    suporte, que não administram acesso. O evento do aceite, gravado pelo
    app, levava o token no `payload`.
  - Com o token, o `lookupInvite` dá o e-mail convidado. Quem cria no
    Firebase Auth uma conta com esse e-mail grava o próprio `users` com o
    papel do convite, porque a regra confere só o e-mail do login, não se
    ele foi verificado (pergunta 68 do plano).
- **A correção.** Os eventos do convite levam a referência do token:
  `convite_` e os 16 primeiros dígitos do SHA-256 dele
  (`domain/customer-invite.ts`, `inviteEventReference`). Ela liga os eventos
  do mesmo convite sem abri-lo, e o app manda a mesma no evento do aceite
  (`lib/convite.ts`). O convite continua abrindo pelo link, e a tela de
  Usuários continua copiando o link.
- **O que fica.** Os eventos de antes não se apagam: os convites pendentes
  criados até a publicação se cancelam e se refazem depois dela (pergunta 67
  do plano). O aceite sem o e-mail verificado espera a pergunta 68.
- **Testes:** `convites.integration.test.ts` (a callable de verdade, no
  emulador: criar e cancelar o convite gravam a referência, o token não
  aparece no evento, e o convite continua abrindo pelo `lookupInvite`) e
  `lib/convite.test.ts` (a mesma referência no app). Antes, os dois testes
  do evento falhavam.

### Correção: o evento da mudança de acesso sem o antes e o depois

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção.

- **O defeito.** A troca de papel em Usuários gravava o evento
  `users.set_role` com `changed_fields: ["role"]`, sem o papel de antes nem
  o de depois. O novo ficava só no recibo da operação, que o navegador não
  lê, e o antigo se perdia: a linha do tempo não reconstruía quem passou a
  ver o quê (invariante 2).
  - O cadastro do cliente tinha o mesmo buraco na situação, no portal, no
    modelo de operação e na sigla; só os módulos levavam o antes e o
    depois.
- **A correção.** O evento leva `role_before` e `role_after` e, no cliente,
  `status`, `portal_status`, `operation_template` e `sku_prefix` com
  `_before` e `_after` (`domain/access.ts`, `accessChangeFromTo`). O que a
  alteração não manda fica com o valor de antes.
- **Teste:** `acessos.integration.test.ts`, a callable de verdade no
  emulador: a troca de papel e o cliente sem portal gravam o antes e o
  depois. Antes, os dois falhavam.

### Correção: a troca de papel para cliente ligava a pessoa a um cliente sem conferir

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção.

- **O defeito.** A troca de papel em Usuários gravava só o papel: quem
  virava cliente ficava com o `customer_code` que já tinha no perfil, sem a
  conferência do convite de cliente.
  - O interno convidado leva "Dutelog" no perfil. Trocado para cliente,
    virava cliente de "Dutelog", que não é cliente: sem `client_access`, com
    os módulos padrão (armazenagem e faturas), passava pela porta do WMS e
    abria pedidos em nome de um cliente que não existe.
- **A correção.** A troca para cliente passa pela mesma conferência do
  convite, dentro da transação (`domain/customer-invite.ts`,
  `assertClientRoleCustomer`): o cliente do perfil precisa estar cadastrado,
  não arquivado, não ser prospect e ter sigla; a BTG passa, como no convite.
  Quem não tem cliente no perfil é recusado com "A pessoa não está ligada a
  um cliente: para dar o portal, convide-a pelo cliente."
- **Teste:** `acessos.integration.test.ts`, a callable de verdade no
  emulador: o interno de "Dutelog" e quem não tem cliente não viram
  cliente; quem é ligado a um cliente cadastrado vira. Antes, as duas
  recusas falhavam.

### Correção: o convite de cliente saía com um cliente que ninguém escolheu

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção.

- **O defeito.** No convite do perfil cliente (Usuários › Convidar), sem
  escolha, ia o primeiro cliente da lista, ou a BTG enquanto a lista
  carregava ou quando ela falhava. O servidor aceita a BTG sem procurar o
  cadastro, e quem recebia o link entrava no portal de um cliente que
  ninguém tinha escolhido.
- **A correção.** O convite de cliente só sai com o cliente escolhido: o que
  vem do "Convidar" de Configurações › Clientes ou o que a pessoa escolhe na
  lista (`pages/users.tsx`). Sem ele, "Criar convite e copiar link" fica
  desligado.
- **Teste:** `pages/users-convite.test.tsx`, com a tela de verdade: sem
  escolha e com a lista falhando, o convite não sai; o cliente do
  "Convidar" vale como escolhido. Antes, os dois primeiros falhavam.

### Correção: dois owners podiam se tirar ao mesmo tempo

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção, e é rara: pede dois owners mexendo um no outro no mesmo instante.

- **O defeito.** O papel de quem age era lido antes da transação, e a
  transação lia só a pessoa alterada. Dois owners que se removessem ou se
  rebaixassem ao mesmo tempo passavam os dois, e o sistema ficava sem
  nenhum owner, sem como devolver pelo próprio app.
- **A correção.** Remover ou devolver o acesso, trocar o papel e criar ou
  cancelar o convite releem quem age dentro da transação
  (`domain/access.ts`, `assertAccessActorCurrent`): com o acesso removido
  ou o papel mudado, a alteração para em "Seu acesso mudou: entre de novo
  para administrar acessos.". As duas transações leem o perfil que a outra
  muda, então a segunda recomeça e para.
- **Teste:** `domain/access.integration.test.ts`: o owner que perdeu o
  acesso ou foi rebaixado no meio do caminho não tira o acesso de outro
  owner. Antes, os dois testes falhavam.

### Correção: o convite sem token nascia com a hora como id

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção, mas a tela não chega nela: só quem chama a API direto, como owner
ou admin.

- **O defeito.** O id do convite é o token do link. Sem `token` nem `id`, o
  convite nascia com `Date.now()` como id, 13 dígitos fáceis de adivinhar,
  e o `lookupInvite` o abria. Um `id` ou `token` curto também servia.
- **A correção.** O convite só nasce com o token longo e aleatório que a
  tela de Usuários gera (18 bytes em hexadecimal): de 32 a 128 dígitos
  hexadecimais, pelo `token` ou pelo `id`. Fora disso, "O convite precisa
  do token gerado pela tela de Usuários.".
- **Teste:** `acessos.integration.test.ts`, a callable de verdade no
  emulador: sem token, com token curto e com id curto, o convite não nasce;
  com o token da tela, ele vira o id. Antes, os dois primeiros falhavam.

### Correção: a falha no login ao tirar ou devolver o acesso ficava escondida

Achada em 25/10/2026, na mesma revisão da administração de acesso. Está na
produção.

- **O defeito.** Remover ou devolver o acesso grava o perfil e depois acerta
  o login no Firebase Auth. A falha no Auth ficava só no log, e a tela dizia
  "Acesso devolvido" com o login ainda bloqueado. A nova tentativa achava o
  perfil já mudado (`changed: false`) e pulava o Auth, então não havia como
  liberar o login pelo app.
  - Na remoção, o perfil já bloqueia (Rules e `getProfile`); o que sobrava
    era a conta do Auth ativa.
- **A correção.** A cada chamada, mudando o perfil ou não, o login acompanha
  o perfil (`domain/access.ts`, `setUserAccessFor`). A falha volta como
  erro na tela ("O acesso voltou no sistema, mas o login da pessoa não foi
  liberado. Tente de novo."), e a nova tentativa refaz o passo. Sem a conta
  no Auth, remover vale, porque não há login para bloquear. Devolver avisa
  que a pessoa não tem login e pede um convite novo, em vez de outra
  tentativa: nenhuma rotina apaga a conta, só o console do Firebase.
- **Teste:** `domain/access.integration.test.ts`, com o Auth de mentira:
  - o login que não foi liberado volta como erro, e a nova tentativa o libera;
  - remover bloqueia o login e derruba as sessões;
  - sem a conta, remover vale, e devolver pede o convite.

  Com o comportamento anterior, o primeiro falha.

### Pergunta 69: arquivar e "Sem portal" cortam o portal

Decidida pelo Leonardo e feita no servidor em 26/10/2026. A tela que explica
o corte à pessoa do cliente vem com o alinhamento.

- **O problema.** Arquivar o cliente ou pôr "Portal do cliente: Sem portal"
  (Configurações › Clientes) não cortava as pessoas dele. As portas olhavam
  só os módulos do contrato, que o arquivo mantém. As pessoas do cliente
  seguiam lendo os dados e pedindo pelo portal, e os convites pendentes
  seguiam valendo.
- **A decisão.** Arquivar e "Sem portal" cortam o portal. O portal ativo fica
  gravado no `client_access`, e as portas e o convite o conferem. Os logins
  ficam.
- **A correção:**
  - `client_access/{customer_code}` ganha `portal_ativo`, gravado na mesma
    transação do cadastro (`clientAccessProjection`, com
    `portalAtivoDoCadastro`). É falso no arquivado e no "Sem portal"; o
    modelo sem portal já grava "Sem portal". Sem o documento, ou sem o
    campo, o portal segue ligado, como antes.
  - As portas recusam com a mesma frase, "O portal do seu cliente está
    desligado.":
    - as callables do WMS e a rotina do agente do WMS
      (`wmsAccessProblem`, antes do contrato);
    - o pedido de OS pelo portal e o sino da Operação (`domain/profile.ts`);
    - o Agent Dute do núcleo para o cliente (`escopoDoAgente`).
  - As regras do Firestore: `isOwnProjection()` passa a conferir o portal
    (estoque, pedidos, solicitações, documentos, faturas, OS, avisos e
    valores), e também o `client_portal_status` e o chat do agente. O
    perfil (`client_profiles`) segue legível: é por ele que o app vai saber
    que o portal está desligado.
  - O Storage: o anexo da solicitação de OS.
  - O convite: o convite novo para o cliente "Sem portal" é recusado ("O
    cliente X está sem portal."; o do arquivado já era). O aceite do convite
    pendente do cliente com o portal desligado não cria o perfil (a regra do
    `users`).
  - A equipe não depende do portal do cliente.
- **O que fica de fora:**
  - a tela: a pessoa do cliente com o portal desligado vê as recusas, sem a
    explicação, até o alinhamento;
  - os avisos por e-mail aos contatos continuam saindo, com o link do portal
    (pergunta 71 do plano);
  - o cadastro arquivado ou "Sem portal" antes desta parte não tem o campo,
    e o portal dele segue ligado:
    - o "Sem portal" se corta gravando o cadastro de novo;
    - o arquivado, removendo o acesso das pessoas dele em Pessoas e acessos;
    - na produção, em 26/10, o `client_access` não tinha nenhum documento
      (o teste de restauração listou as coleções);
  - a BTG continua recebendo convite sem a conferência do cadastro (a trava
    antiga, `customer-invite.ts`); o aceite confere o portal.
- **Testes:**
  - WMS:
    - `customer-profile.test.ts`: a projeção leva o portal, desligado no
      arquivado, no "Sem portal" e no modelo sem portal, e religado no
      "Ativo"; a leitura do campo;
    - `platform-roles.test.ts` e `customer-invite.test.ts`: a porta e o
      convite;
    - `customer-profile.integration.test.ts`: a leitura no emulador, com e
      sem o campo;
    - `callables-auth.integration.test.ts`: toda callable recusa o cliente
      com o portal desligado, na porta;
    - `firestore.rules.test.ts`: cada leitura e gravação do cliente passa
      com o portal ligado e é recusada com ele desligado; o perfil segue
      legível; o aceite do convite; o outro cliente e a equipe;
    - `operacao-solicitacoes.rules.test.ts`: as solicitações e o anexo no
      Storage.
  - Operação: `profile.integration.test.ts`, o pedido pelo portal e o sino.
  - Núcleo: `agente-escopo.integration.test.ts`.
