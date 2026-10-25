# Plano de implantação da plataforma Dute (fases 2 a 8)

Escrito em 23/10/2026, a pedido do Leonardo. Consolida num documento só o que
está combinado e espalhado em vários: o plano de 19/10 (`plano.md`), o desenho
da Fase 2 (`fase-2-nucleo.md`), o desenho do Comercial (`fase-6-comercial.md`
e `comercial-producao.md`), a proposta da Operação "Demanda: do pedido ao
faturamento" (página do canvas, recuperada em 23/10, resumida em
`alinhamento-comercial-operacao.md`, seção 2.5), as decisões de 23/10 (um
shell por módulo, UX e UI, Omie e legado fora) e o estado do código.

O plano tem nove fases, 0 a 8. As duas primeiras estão feitas. Este documento
desenha as fases 2 a 8 e o trabalho contínuo: objetivo, decisões, dados,
papéis, telas, eventos, o que a IA captura, as partes (um PR cada) em ordem,
o critério de pronto e o caminho até a produção. Cada fase ganha o próprio
runbook (`fase-N-*.md`) com o registro de cada parte, como a Fase 2 e a Fase
6 já têm; este documento não substitui os runbooks, ordena-os.

Onde o plano propõe algo que ainda não foi decidido, o texto diz "proposta" e
a pergunta entra na seção 13, para o Leonardo responder antes da parte que
depende dela.

## 0. Como o plano funciona

- **Fase** é um objetivo com critério de pronto. **Parte** é um PR, com
  desenho antes do código, teste que falha antes e passa depois, CI verde,
  homologação e registro no runbook da fase. Uma parte roda numa sessão.
- **Produção** só com o OK do Leonardo, pela liberação por ambiente
  (`lib/liberacao.ts` e a cópia em cada codebase) e pela publicação manual
  (`Actions > CI > Run workflow` com `publicar_producao`). Nada do que entra
  na `main` muda a produção sozinho.
- **Ordem entre fases** (seção 3): 2 → 6 (fechamento) → 3 → 4 → 5 → 7; a 8
  pode correr em paralelo depois da 4. Dentro de uma fase, as partes têm
  ordem; entre fases, o que não depende pode andar junto.
- **Documentação** anda com o código: desenho da fase, perguntas numeradas,
  registro por parte, `CLAUDE.md` atualizado quando a regra de trabalho muda.

## 1. Regras que valem em todas as fases

### 1.1 Produto e navegação (decisões de 23/10/2026)

- **Um shell por módulo**: Armazenagem, Comercial e Operação hoje; Financeiro
  e RH quando tiverem tela. Cada shell lista o Início e as telas do próprio
  módulo. O nome do módulo no topo da barra lateral é o seletor para trocar
  de módulo; o logo leva à entrada por cards. Quem tem um módulo só não vê
  seletor. No celular, o seletor fica no cabeçalho e a barra inferior é a do
  módulo (quatro itens e "Mais").
- **Entrada por cards** (`/`), com o contador de pendências de cada módulo.
  Quem tem um módulo cai direto nele.
- **Início em cada módulo**, com o "Precisa de você" daquele módulo, os
  números do dia e a ação de cada item. O Início do WMS fica com os itens do
  WMS.
- **Clientes dentro de cada módulo**, com a visão do módulo: o Comercial
  cadastra e vê contatos e contratos; a Operação lê locais, acesso e contato
  no local; a Armazenagem segue com Configurações › Clientes. Contato e preço
  nunca vazam para o módulo que não os precisa.
- **Identidade v3** em toda tela nova (`docs/mockups/README.md`). O WMS
  adota a v3 na Fase 4, no lançamento. Mockups aprovados: página "Identidade
  v3" (19/10), "Comercial · orçamentos e contratos" (20/10), "Operação ·
  demandas e OS" (proposta, 17 a 19/10) e "Shell por módulo · 23/10" do
  canvas; fontes em `docs/mockups/`.
- **Campo** (`/campo`, papel `campo`) e **TV** (`/tv`, papel `painel`) são
  telas próprias, fora dos shells.

### 1.2 Sem legenda, limpo e acessível

Regra do Leonardo, que vale para toda tela, diálogo e e-mail: **só rótulos,
dados e ações.** O que precisaria de explicação vai para o manual em `docs/`
ou vira um rótulo melhor.

O que isso quer dizer, para o PR passar na revisão:

1. Nenhum parágrafo explicando a tela, a coluna ou o botão. Nenhuma caixa de
   "dica", "observação", "como funciona" ou "atenção". Nenhuma legenda de
   cores.
2. O rótulo diz o que a coisa é, com a unidade quando houver ("Peso (kg)",
   "Faturar até", "Executado em"). A coluna de um quadro se chama pelo
   status que contém. O status é um selo com texto, nunca só uma cor.
3. Estado vazio é uma frase de dados mais a ação ("Nenhuma OS hoje" e
   "Nova demanda"), não um texto ensinando o que fazer.
4. Erro é uma linha, no campo que falhou, dizendo o que corrigir
   ("Informe o CPF"). O servidor manda a mensagem; a tela não reescreve.
5. Contagens, prazos e idades aparecem como dados ("faltam 4h40", "há 32
   dias"), sem adjetivo.
6. Botão só com ícone tem `aria-label`; ícone decorativo tem
   `aria-hidden`. Tooltip só nesses botões, com o mesmo texto do rótulo.
7. A sugestão da IA é um cartão com a sugestão, a base ("26 min por
   unidade · 31 execuções") e as ações Usar e Ignorar. A base é dado, não
   legenda.
8. Texto da marca, nome de cliente e valor seguem as regras de quem pode
   ver; a tela nunca mostra "você não tem acesso a X": o que a pessoa não
   pode ver não existe na tela dela.

Acessibilidade visual, conferida em cada tela nova:

- Contraste de texto 4,5:1 (3:1 a partir de 24 px), inclusive nos rótulos
  cinza de 12 px em caixa alta. As cores de status da v3 passam; cor nova
  entra em `docs/mockups/README.md` com o par fundo e texto conferido.
- Status que precisam ser distinguidos diferem em claridade e em texto, não
  só em matiz. Vermelho é só ação principal e alerta.
- Alvo de toque e clique de 44 px no celular; foco visível no teclado; a
  ordem de leitura é a ordem do DOM; nada depende só de hover.
- Botão é `<button>`, link é `<a href>`, campo tem `<label>`; nunca
  `onClick` num `div`.
- Texto de dado em 13,5 px ou mais; números tabulares alinhados; datas e
  horas em pt-BR; moeda com símbolo e duas casas onde quem lê pode ver
  valor.
- `prefers-reduced-motion` respeitado; nada de transição que esconda dado.
- Tela de página funciona em 390 px sem rolagem lateral; tabela larga rola
  dentro da própria caixa.

Como se garante, em cada PR de tela:

- O teste de render da tela lista os textos que ela mostra (como
  `entrada.test.tsx` já faz) e falha se aparecer texto fora da lista: é a
  trava contra legenda.
- Teste de acessibilidade com `axe` (vitest e `axe-core`, a incluir na
  parte 2.3) sem violações.
- `theme-colors.test.ts` continua travando cor fixa e valor fora da escala.
- A revisão do PR confere a lista acima e o mockup aprovado; divergência
  do mockup vira pergunta, não decisão silenciosa.

### 1.3 Engenharia

- **Invariantes 1 a 5** do `CLAUDE.md`: escrita crítica só por Function com
  papel, status atual, transação e idempotência; evento auditável em `events`
  no mesmo fluxo; a IA recomenda, nunca executa; `customer_code` isola;
  permissão nas regras e no backend.
- **Codebase por módulo** (`functions/<modulo>`), callable numa linha
  (`export const nome = onCall(`), entrada por `require<Modulo>Caller`
  (liberação, login, papel), escrita por `runIdempotent` com recibo, evento
  com payload `.strict()`, sem valor, nome nem contato de cliente. O nome
  do tipo de evento nunca contém as palavras que o roteador de avisos do WMS
  procura (`order`, `picking`, `shipment`, `dispatch`, `billing`,
  `invoice`, `receb`): por isso `os.*`, `nf.*`, `cobranca.*`.
- **Coleção com um dono.** Cada coleção é escrita por uma codebase. Quando
  duas precisam gravar no mesmo documento (a demanda, escrita pelo Comercial
  e lida pela Operação), cada uma escreve só os próprios campos, declarados
  no desenho, e a outra os trata como leitura.
- **Regras e índices antes do frontend e das functions**; invoker conferido
  depois de todo deploy; zeragem preserva as coleções novas; dados sensíveis
  fora do repositório.
- **Dinheiro** em centavos inteiros, decimal em texto, servidor recalcula;
  preço só para `owner`, `admin`, `financeiro` e `comercial`; o cliente vê os
  das próprias OS e faturas; operação, campo e armazém nunca.
- **IA native**: cada módulo grava desde a primeira parte os eventos, os
  tempos e as medidas que a Fase 5 lê. Sem tempo real por item não há o que
  aprender; a parte que cria uma transição grava o instante dela.
- **Multicliente**: módulos contratados em `client_access`; o portal mostra
  só o contratado; personalização por perfil, nunca por cópia de código.

## 2. Estado em 25/10/2026

| Fase | Estado |
|---|---|
| 0 Projetos e repositório | Feita em 19/10 |
| 1 Migração do WMS | Feita em 20/10; `dute-btg` congelado até 02/12 |
| 2 Núcleo e app único | Partes 1 a 2.8 na `main`: o shell v3 por módulo, a entrada com os contadores, os Inícios do Comercial e da Operação e a barreira por módulo contratado (`fase-2-nucleo.md`) |
| 3 Operação | Partes 3.0 a 3.14 na `main` (23/10), ligada no `dute-homolog` e no `dute-prod`. A produção serve até `fde9ba0`; o resto da fase sobe com o lançamento da Fase 4 |
| 4 Financeiro da operação, portal e lançamento | Partes 4.1a a 4.9a na `main`; o Financeiro só no `dute-homolog`. O lançamento (marcos 2, 3 e 4 juntos, e a parte 4.9b, que liga o Financeiro) espera o OK do Leonardo (`lancamento-producao.md`) |
| 5 Memória da Dute | Partes 5.1a a 5.6 na `main`, só no `dute-homolog` (`fase-5-memoria.md`) |
| 6 Comercial | v1 (partes 1 a 19) na `main` e ligado no `dute-prod` desde 21/10, sem dado carregado; do fechamento, 6.20 a 6.22 e 6.25 feitas, e 6.23 e 6.24 (as cargas e o contador na produção, a semana em paralelo) com o Leonardo |
| 7 Financeiro unificado | Partes 7.1 a 7.5c na `main`, só no `dute-homolog`. A NFS-e e a baixa pela Omie (7.4) estão no código, e as chaves de um aplicativo de teste da Omie estão no `dute-homolog` desde 24/10; a primeira emissão espera os serviços `DUTE-OS` e `DUTE-ARMAZENAGEM` cadastrados nele. O cancelamento da NFS-e autorizada espera a resposta da Omie (`fase-7-financeiro-unificado.md`) |
| 8 RH | Partes 8.1a a 8.3 na `main` e ligadas no `dute-homolog` desde 24/10: a 8.1b pôs no `firebase.json` o banco `dute-rh`, que existe nos dois ambientes (na produção, com PITR e backup diário). A produção recebe o código com o lançamento; a liberação do RH lá é outro OK (`fase-8-rh.md`) |
| Contínuo | PITR e backup diário desde 20/10 (no `dute-rh`, desde 24/10). O teste de restauração é o workflow `Teste de restauração`, que espera o OK do Leonardo para rodar (`backup-e-recuperacao.md`). O painel do sistema mostra os erros de todas as functions, o estado e o acesso das callables de todas as codebases, a latência e o e-mail que desistiu (`docs/painel-sistema.md`). O inventário da LGPD está em `lgpd.md`, com 12 decisões do Leonardo. Manuais de todos os módulos: `docs/manual-comercial.md`, `docs/manual-operacao.md`, `docs/manual-financeiro.md`, `docs/manual-rh.md`, `docs/manual-portal.md` (o portal do cliente) e `docs/manual-armazenagem.md`; o roteiro do treinamento por marco em `docs/treinamento.md`. A revisão dos manuais virou correções (PRs 342 a 361) e as perguntas 36 a 54 da seção 13 |

## 3. Ordem de implantação

```
Fase 2 (shell por módulo, Início por módulo, entrada com contadores)
   │
   ├── Fase 6, fechamento (Comercial em uso: cargas, contador, CNPJ, Guilherme)
   │
Fase 3 (Operação: demanda direta, planejar, executar, campo, assinatura, revisão, vistoria, TV)
   │
Fase 4 (Financeiro da operação, portal com OS, notificações, WMS na v3, lançamento)
   │
   ├── Fase 5 (memória: medidas, casos parecidos, sugestões, dias parado, Agent Dute no núcleo)
   ├── Fase 7 (financeiro unificado, NF e contabilidade por integração)
   └── Fase 8 (RH, banco à parte; pode começar depois da 4, em paralelo)
Contínuo: backups testados, monitoramento, LGPD, manual, treinamento
```

Por que esta ordem:

- A Fase 2 vem primeiro porque toda tela nova precisa do shell por módulo e
  do Início por módulo; sem isso cada parte da Operação nasceria no visual
  errado e seria refeita.
- O fechamento do Comercial vem logo em seguida porque o módulo já está em
  produção, vazio, e porque a Operação nasce da demanda: sem demanda real
  não há OS real.
- A Fase 3 antes da 4 porque o faturamento é da demanda executada e
  revisada; a 4 precisa do ciclo completo da OS.
- A Fase 5 depois da 4 porque as medidas precisam de execuções com tempo e
  de valores fechados (orçado x realizado).
- A Fase 7 depois da 4 porque unifica o que a 4 e o WMS cobram.
- A Fase 8 só depende dos papéis (Fase 2) e de um banco novo; fica depois da
  4 para não disputar sessões com a Operação.

Marcos de produção, cada um com OK do Leonardo:

1. Comercial em uso (fim do fechamento da Fase 6).
2. Shell por módulo e Início por módulo (fim da Fase 2).
3. Operação completa (fim da Fase 3), que religa ou mantém a liberação da
   Operação na produção (pergunta 1 da seção 13).
4. Lançamento: WMS na v3, portal com OS, financeiro da operação (fim da
   Fase 4).
5. Memória da Dute (Fase 5), Financeiro unificado (Fase 7) e RH (Fase 8),
   cada um no próprio fim.

## 4. Fase 2: núcleo e app único (o que falta)

**Objetivo.** Um app com um shell por módulo, menu por papel e por perfil,
Início por módulo e entrada por cards com contadores. A base das telas das
fases 3 a 8.

**Feito.** Parte 1 (papéis da plataforma, módulos contratados,
`client_access`, regras) e parte 2 (tela de entrada), 20/10. A parte 3 do
desenho original (menu agrupado num shell só) foi substituída em 23/10 pelo
shell por módulo; o que sobrou dela (barreira por módulo contratado para o
cliente) continua válido e entra abaixo.

**Decisões.**

- Os shells do Comercial e da Operação passam para a v3 nesta fase; o do
  WMS fica como está, ganhando só o seletor no topo da barra, e adota a v3
  na Fase 4.
- O seletor lista os módulos que a pessoa abre (`modulesForPerson`), marca o
  atual e termina em "Todos os módulos" (os cards). Quem tem um módulo só
  vê o nome do módulo, sem seletor.
- Os contadores da entrada vêm da mesma consulta que alimenta o "Precisa de
  você" de cada módulo: uma função pura por módulo devolve a lista de
  pendências; o card mostra o total e a primeira linha. Sem consulta para
  módulo que a pessoa não abre.
- O Início do Comercial recebe os itens que hoje estão no Início do WMS
  (orçamentos para aprovar, executados esperando autorização, prazo de
  faturamento, medição não enviada); o Início do WMS fica só com o WMS.
- Catálogo da LPU continua em `functions/comercial`, lido pela Operação
  pelas regras (decisão da Fase 6). Não há "núcleo" de código separado: o
  núcleo são `lib/dominio`, as regras e `users`, `customers`,
  `client_access`, `events`.
- A TV (`/tv`) sai desta fase e entra na Fase 3, porque mostra os status de
  execução que só existem lá.

**Telas** (mockups da página "Shell por módulo · 23/10"): entrada com
contadores (`ModEntrada`), Comercial · Início (`ModComInicio`), Operação ·
Início (`ModOpInicio`), barra do WMS com o seletor (`ModWms`), celular do
Comercial e da Operação (`ModCelularCom`, `ModCelularOp`).

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 2.3 | Shell v3 por módulo: um componente `ShellDoModulo` (barra preta, Manrope, seletor, itens com contador, conta no rodapé, cabeçalho e barra inferior no celular) usado pelo Comercial e pela Operação; `comercial-shell.tsx` e `operacao-shell.tsx` passam a ser instâncias dele; o WMS ganha o seletor no topo da própria barra. Entra o teste de acessibilidade com `axe` | Render dos dois shells com os textos esperados e sem violação do `axe`; seletor só para quem tem mais de um módulo; cliente nunca vê seletor; `/comercial` e `/operacao` sem nada do WMS no menu |
| 2.4 | Entrada com contadores: `pendenciasDoModulo(modulo)` por módulo (pura, sobre as mesmas leituras do Início); card com total e primeira linha; sem consulta para módulo que a pessoa não abre | Contador bate com a lista do Início; papel `comercial` não dispara leitura da Operação |
| 2.5 | Comercial · Início: "Precisa de você" (para aprovar, executados há mais de 30 dias, prazo de faturamento, medição não enviada, proposta sem resposta há N dias), "Orçamentos por etapa" e os números do mês; os itens saem do Início do WMS; rota `/comercial` passa a ser o Início e a fila vira `/comercial/orcamentos` | Guilherme vê o próprio Início; owner vê os mesmos itens no Comercial e não mais no WMS; render sem texto fora da lista |
| 2.6 | Operação · Início: OS sem equipe ou veículo perto do prazo, demandas para planejar, OS em revisão, CNH vencendo (lida de `collaborators.cnh.validade`), "Hoje na operação", "Equipe agora"; rota `/operacao` passa a ser o Início e a fila vira `/operacao/hoje` | Interno vê o Início com os itens; nenhum valor na tela (teste de regras já cobre) |
| 2.7 | Barreira por módulo contratado para o cliente: `RoleGate` nega rota de módulo não contratado; o portal assina só as coleções dos módulos contratados; a regra de `service_orders` ganha o ramo do cliente com `customerHasModule('operacao')` (sem efeito até a Fase 4) | Cliente só com `operacao` não vê nem abre tela do WMS; cliente sem `financeiro` não vê Faturas |
| 2.8 | Registro: `fase-2-nucleo.md` ganha a decisão de 23/10 superando a decisão 6, o registro das partes 2.3 a 2.7 e a tabela "quem cai onde" atualizada; `CLAUDE.md` atualizado | Documentação |

**Pronto quando.** Na homologação, o owner entra pelos cards com os
contadores e troca de módulo pelo seletor; o Guilherme cai no Início do
Comercial e não vê seletor; o interno vê Armazenagem e Operação; um cliente
só com armazenagem não vê nada de OS; as telas novas passam no `axe` e no
teste de textos; o WMS não mudou além do seletor.

**Produção.** Com o OK do Leonardo, pela publicação manual. Nada de
liberação nova: o shell por módulo substitui o que já está ligado.

## 5. Fase 6: Comercial, fechamento do v1

**Objetivo.** O Guilherme orça no sistema e a planilha de controle para. O
que falta não é tela: é dado, decisão e uso.

**Feito.** Partes 1 a 19 (21/10). Cadastro com prospect, locais e contatos;
catálogo e tabelas com vigência; contratos e aditivos; demanda e orçamento
com RVs congeladas; envio, fechamento, perda, revisão, RV de execução e
aditivo; aprovação no celular; PDF A4; autorizações de faturamento; medição
mensal; fila; conferência final. Ligado no `dute-prod` em 21/10.

**Decisões de 23/10.** Sem carga de clientes da Omie, sem integração com a
Omie e sem legado da planilha. (A NFS-e pela Omie veio depois, em 24/10,
na pergunta 21 da Fase 7: a Omie emite a nota; os clientes continuam
entrando pela tela de Clientes.) Os clientes entram pela tela de Clientes
(Itaú, Safra e BTG primeiro; prospect quando o pedido chegar). Tabelas e
contratos continuam entrando pelas cargas.

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 6.20 | Razão social e CNPJ da Dutelog no cabeçalho do PDF (pergunta 15 do desenho), como constantes do papel | Documento renderiza os dois; teste de textos do documento |
| 6.21 | Ferramenta do contador: `cargas/contador.ts` com dry-run, que grava `demand_counters/geral.ultimo` nunca abaixo de 10000 nem do maior `demands/{numero}` | Recusa valor menor que o maior existente; dry-run não grava |
| 6.22 | Pendências da parte 17 que mudam código: segmento "A faturar" na fila para demanda sem autorização; `contrato_id` gerado no servidor; `comercialStatus` removida; ações sem botão decididas (Perdido em rascunho e aprovado, Aditivo em execução a orçar) conforme a pergunta 10 da seção 13 | Um teste por item |
| 6.23 | Operação de go-live, da máquina do Leonardo, registrada em `comercial-producao.md`: export gerenciado, cargas de tabelas (Padrão Dutelog, LPU do Itaú Comercial e Noturna, RFQ 2021 encerrada, Safra quando chegar) e de contratos com dry-run antes de cada `--executar`; contador; clientes à mão; papel `comercial` ao Guilherme | Relatórios do dry-run conferidos antes de gravar |
| 6.24 | Uma semana em paralelo com o Excel; ajustes das perguntas de uso (1, 7, 8, 14, 16 do desenho) em PRs pequenos conforme o uso pedir | Teste por ajuste |
| 6.25 | Registro: `fase-6-comercial.md` com as respostas e `comercial-producao.md` com o que foi feito de cada passo | Documentação |

O que fica para outras fases: gerar OS a partir da demanda (Fase 3, já
parcialmente feito), vistoria e aditivo vindos do campo (Fase 3), NF e
cobrança (Fase 4), sugestão por orçamentos parecidos (Fase 5), Contratos e
Autorizações lidos pelo Financeiro e a perda por prazo de faturamento (Fase
7), tela de edição de tabelas (quando a renovação anual pedir).

**Pronto quando.** Um mês de orçamentos feitos no sistema sem a planilha;
o Leonardo aprovando no celular; autorizações e medições do mês registradas;
nenhum valor visível fora dos quatro papéis (teste de regras já existe).

## 6. Fase 3: Operação

**Objetivo.** Do pedido à OS revisada: demanda (do comercial, direta ou da
armazenagem), uma ou várias OS por demanda, planejamento com equipe, veículos
e terceiros, execução no campo com etapas, itens, fotos e assinatura, revisão
interna com divergências, vistoria como OS, TV da sala. Tudo com tempo por
etapa e por item gravado, sem valor em lugar nenhum.

**Base.** A proposta "Demanda: do pedido ao faturamento" (18 telas), com as
decisões de 23/10 por cima (shell, Início, Hoje com "Para planejar"). O
`fase-3-operacao.md` de hoje descreve as partes 1 a 3 e vira o registro
delas dentro do runbook novo, `fase-3-operacao.md` reescrito no padrão da
Fase 6 (parte 3.0).

**Feito.** Partes 1 a 3: `collaborators` e `vehicles` com callables, OS
`10045-01` aberta a partir da demanda em Para planejar, agendar com equipe e
veículo, cancelar com motivo; eventos `os.created`, `os.scheduled`,
`os.cancelled`; regras; telas no visual do WMS.

**Decisões (da proposta, assumidas aqui).**

- A demanda agrupa pedido, orçamento, aditivos e OS. A OS é uma ida a campo:
  uma equipe, um dia. A vistoria é uma OS. Uma demanda tem uma ou várias OS,
  cada uma com uma fatia do saldo dos itens orçados.
- Entrada da demanda: pelo comercial (orçamento antes), direta na operação
  (paraquedas e emergencial, orçamento depois da execução) ou pela
  armazenagem (pedido de saída com entrega pela Dutelog, Fase 4). Retirada
  pelo cliente não gera OS.
- Tipo da demanda calculado pela hora do pedido e pela hora pedida para a
  execução: paraquedas no mesmo dia, emergencial até 48 horas corridas,
  planejada depois disso. O coordenador corrige.
- Status da OS: Para agendar → Agendada → Em execução → Em revisão →
  Revisada; Cancelada com motivo antes de Revisada; Revisada volta a Em
  execução só por owner ou admin. Atraso e falta de equipe são alertas, não
  status.
- Fotos e assinatura no local são o aceite da execução. Item incluído em
  campo acima do saldo vira divergência; na revisão, vira pedido de aditivo
  ao comercial, absorção sem cobrar ou correção de quantidade. A revisão
  interna não pede nova aprovação do cliente, salvo aditivo.
- Freelancers e motoristas terceiros não têm login; ficam num cadastro
  simples (`collaborators` com `vinculo` freelancer ou terceiro, e a empresa
  no terceiro) e o líder registra a presença deles na OS.
- O celular guarda os registros sem sinal e envia quando volta. Cada
  registro leva a própria chave de idempotência e o instante em que foi
  feito, não o instante do envio.
- Fatura-se a demanda, não a OS (Fase 4).
- Operação, campo e armazém nunca veem valores. `service_orders` não tem
  campo de preço; o teste de schema trava.

**Perguntas da proposta, com a resposta proposta** (a confirmar na parte
3.0; lista na seção 13):

1. Faturamento no fim da demanda; medição parcial só para contrato que a
   exige (o Safra já tem a medição mensal). O PO do Itaú entra pela
   autorização de faturamento, que já existe; o aditivo recebe o próprio
   aceite.
2. A assinatura no local aceita as quantidades executadas; o preço do que
   passou do orçado só se fatura com o aditivo aprovado pelo cliente.
3. A coordenação decide na revisão: absorver (não cobra, com motivo),
   corrigir a quantidade ou pedir aditivo. Executado a menos reduz o
   faturado na RV de execução, no Comercial.
4. Sem responsável para assinar, o líder registra o nome de quem recebeu e
   fotos do local; a OS conclui "sem aceite no local" e o aceite vem pela
   validação do cliente no Comercial, que já existe.
5. A vistoria não pede assinatura nem passa pela revisão: vai direto ao
   comercial com fotos, itens levantados e medidas.
6. Paraquedas, noturno e sábado não mudam a regra de preço: valem os itens
   e a variante da tabela (Noturna, diárias de sábado), escolhidos no
   orçamento ou na RV de execução pelo comercial.
7. Freelancer e terceiro ficam no cadastro simples; a presença, com
   entrada e saída, é registrada pelo líder e é o que paga a diária. O valor
   da diária fica no RH e no Financeiro, nunca na OS.
8. 48 horas corridas; o coordenador corrige o tipo.
9. O líder marca a presença de toda a equipe; quem tem o app também se
   registra, e vale o primeiro registro.

**Dados.**

- `demands` (dono: Comercial) ganha os campos que a Operação lê e os que ela
  escreve: `entrada` (`comercial`, `direta`, `armazenagem`, `portal`), `tipo`
  (`paraquedas`, `emergencial`, `planejada`, com `tipo_corrigido_por`),
  `pedido_em`, `executar_ate`, `os_numeros` (já existe), `execucao`
  (resumo: período, OS revisadas), `revisao` (divergências com decisão). A
  demanda direta nasce por callable da Operação, no mesmo esquema, sem RV;
  a etapa da demanda sem RV é `para_planejar` até a revisão e
  `execucao_a_orcar` depois (o `etapaDaDemanda` do Comercial aprende os dois
  casos). A Operação só escreve `os_numeros`, `execucao` e `revisao`; o
  Comercial só lê esses três.
- `service_orders` (dono: Operação), além do que já tem: `servicos`
  (transporte, montagem, desmontagem, embalagem, vistoria, armazenagem:
  derivados dos itens), `janela` (data, início, fim), `locais` (origem e
  destino com o endereço copiado no momento da OS e o contato no local),
  `equipe` com papel por pessoa (líder, motorista, montador, ajudante),
  `freelancers`, `terceiros` (empresa, pessoa, veículo), `veiculos` (próprios
  e de terceiro), `instrucoes`, `observacoes_internas`, `etapas` (saída do
  pátio, chegada na origem, carregamento, saída da origem, chegada no
  destino, montagem, fim: instante, quem, canal celular ou escritório),
  `itens` com `planejado`, `executado`, `incluido_em_campo` (quem pediu,
  motivo, fotos) e os instantes de cada registro, `fotos` (caminho no
  Storage, etapa, instante, quem), `ocorrencias`, `presencas` (pessoa,
  entrada, saída, registrado por), `conclusao` (fim, responsável do cliente
  com nome, cargo e documento, assinatura no Storage, aceite ou "sem aceite
  no local"), `revisao` (quem, quando, horas planejadas e reais,
  divergências e decisões), `status` com os novos valores, `cancelamento`.
  Nenhum campo de valor.
- `service_order_counters` (já existe). Storage: `os/{numero}/fotos/` e
  `os/{numero}/assinatura` com `storage.rules` por papel (campo escalado,
  coordenação, cliente dono na Fase 4).
- `collaborators` ganha `vinculo` (`proprio`, `freelancer`, `terceiro`),
  `empresa` no terceiro e `papeis` (líder, motorista, montador, ajudante).
  `vehicles` ganha `dono` (próprio ou terceiro) e `revisao_em`.
- Fila offline no celular (IndexedDB) com os registros pendentes; nenhuma
  coleção nova no Firestore.

**Papéis e regras.**

- Coordenação (owner, admin, interno) grava tudo pelas callables e lê tudo
  da Operação. Suporte lê a OS. Campo lê só as OS em que está escalado
  (`equipe_uids` na OS) e grava só pelas callables de execução. Comercial
  lê `demands` e o resumo de execução, nunca `service_orders`. Cliente lê
  as próprias OS a partir da Fase 4.
- Campo não lê `collaborators` (tem CPF): a OS leva o nome e o papel de cada
  pessoa da equipe, copiados no agendamento.

**Callables de `functions/operacao`** (cada uma numa linha, com
`requireOperacaoCaller`): `saveServiceOrder` (já existe: create, schedule,
cancel; ganha `plan` para várias OS de uma demanda e os campos novos),
`openDirectDemand` (demanda direta), `registerStep` (etapa, com instante e
canal), `registerItem` (executado, incluído em campo, correção),
`attachPhoto` (confirma a foto subida ao Storage e grava na OS),
`registerPresence`, `registerOccurrence`, `completeServiceOrder` (fim,
fotos, responsável, assinatura ou "sem aceite"), `reviewServiceOrder`
(divergências e decisões; pede aditivo ao Comercial gravando
`demands.revisao`), `reopenServiceOrder` (owner e admin),
`sendSurveyToCommercial` (vistoria).

**Eventos** (`source: functions_operacao`, sem nome, valor, CPF ou placa):
`os.created`, `os.scheduled`, `os.planned`, `os.started`, `os.step_recorded`
(etapa e instante), `os.item_executed` (item, quantidade, instante),
`os.item_added_in_field`, `os.photo_attached`, `os.presence_recorded`,
`os.occurrence_recorded`, `os.completed`, `os.signed`, `os.completed_without_acceptance`,
`os.reviewed`, `os.addendum_requested`, `os.reopened`, `os.cancelled`,
`demand.direct_opened`, `survey.sent_to_commercial`,
`collaborator.cnh_expiring`, `vehicle.maintenance_due`.

**O que a IA captura desde a primeira parte.** Instante de cada etapa;
quantidade e instante de cada item executado; tamanho e composição da
equipe; veículos; planejado x executado por item; horas planejadas x reais;
divergências e a decisão de cada uma. É a matéria-prima das medidas da Fase
5 (`ai_measures`): duração por item da LPU por equipe, erro do planejamento,
itens que estouram o orçado.

**Telas** (shell da Operação, v3, sem legenda; mockups da página "Operação ·
demandas e OS" com o shell de 23/10): Início (parte 2.6); Hoje
(`ModOpHoje`: Para planejar, Para agendar, Agendadas hoje, Em execução, Em
revisão; busca; chips; "Nova demanda"); Agenda (`OpAgenda`: sem equipe, grade
da semana, equipe própria, freelancers, veículos, terceiros); Demandas
(`OpDemandas`); Demanda (`OpDemanda`: escopo e saldo, OS da demanda, locais,
pessoas, documentos, histórico); Nova demanda direta (`OpDemandaNova`);
Planejar OS (`OpOSPlanejar`: uma ou várias OS, itens do saldo, equipe,
veículos, instruções; a sugestão da IA entra na Fase 5); OS (`OpOS`: quatro
passos, locais, etapas, itens, fotos, equipe, histórico, "Registrar
andamento" pelo escritório); Revisão (`OpRevisao`); Colaboradores e Veículos
(as telas de hoje, na v3); Clientes (`ModOpClientes`); impressão da OS
(`OSImpressao`); TV (`TVSala`). Campo (`/campo`, PWA, papel `campo`): Minhas
OS (`Campo2Hoje`), OS em execução (`Campo2Execucao`), Incluir item
(`Campo2IncluirItem`), Concluir com assinatura (`Campo2Concluir`), Vistoria
(`Campo2Vistoria`). "Sem sinal · 4 registros guardados" é dado, não legenda.

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 3.0 | Runbook `fase-3-operacao.md` reescrito no padrão da Fase 6: pedido, decisões, respostas às nove perguntas, dados, partes, perguntas abertas; o texto atual vira o registro das partes 1 a 3. `plano.md` ganha a nota de que a especificação da Operação de 19/10 foi substituída por este desenho | Documentação |
| 3.4 | Modelo completo da OS e demanda direta no backend: campos novos, `openDirectDemand`, tipo calculado, `plan` com várias OS e fatia do saldo por item, equipe com papéis, freelancers e terceiros, `collaborators.vinculo`, regras e índices; `etapaDaDemanda` do Comercial aprende a demanda sem RV (PR na codebase do Comercial, pequeno e separado) | Saldo da demanda nunca negativo; demanda direta nasce em Para planejar; campo sem acesso a `collaborators`; schema sem preço |
| 3.5 | Telas Hoje (colunas completas e "Para planejar"), Demandas, Demanda e Nova demanda direta, no shell v3 | Render com textos listados; `axe`; filtros por tipo, entrada e cliente |
| 3.6 | Planejar OS a partir do saldo (várias OS, itens, equipe, veículos, instruções) e Agenda da semana | Duas OS da mesma demanda somam no máximo o saldo; sem equipe e sem veículo aparecem como alertas |
| 3.7 | Execução pelo escritório: `registerStep`, `registerItem`, `registerOccurrence`, fotos no Storage com `storage.rules`, status Em execução, tela da OS em quatro passos com "Registrar andamento" | Etapa fora de ordem recusada; instante gravado; foto só de quem está na OS ou coordena |
| 3.8 | Campo (PWA): papel `campo` lê as próprias OS; Minhas OS; OS em execução com etapas, itens e fotos; incluir item executado com quem pediu e motivo; presença de freelancer e terceiro; fila offline com reenvio idempotente | Regras: campo lê só OS escalada; dois envios do mesmo registro gravam um; registro feito sem sinal guarda o instante original |
| 3.9 | Concluir com assinatura (responsável, assinatura, fotos do final, motivo por diferença), "sem aceite no local", status Em revisão; impressão da OS (via operacional) | Concluir sem motivo para item a menos recusado; assinatura no Storage com regra |
| 3.10 | Revisão interna: horas planejadas x reais, itens com divergência, decisões (aditivo, absorver, corrigir), status Revisada, reabrir por owner e admin; o pedido de aditivo aparece na fila do Comercial ("Aditivos a fazer", RV de aditivo já existente) e a demanda direta revisada aparece em "Execução a orçar" | Divergência sem decisão não conclui a revisão; `demands.revisao` escrito só pela Operação |
| 3.11 | Vistoria como OS: ambientes, fotos, itens levantados (catálogo), medidas, "Enviar vistoria ao comercial"; na fila do Comercial, "Vistorias concluídas" com os itens levantados pré-carregados no orçamento | Vistoria não passa pela revisão; orçamento nasce com os itens da vistoria |
| 3.12 | TV da sala (`/tv`): papel `painel`, sessão longa, modo escuro, agendadas, em execução, concluídas, atrasadas, próxima saída, relógio, atualização sozinha | Papel `painel` só lê o que a TV mostra; sem valor; sem ação |
| 3.13 | Alertas no Início e rotina diária: CNH vencendo (`collaborator.cnh_expiring`), revisão do veículo (`vehicle.maintenance_due`), OS sem equipe ou veículo perto do prazo | Rotina gera o evento uma vez por dia por item |
| 3.14 | Produção: conforme a pergunta 1 da seção 13 (manter a Operação ligada em parte ou religar aqui); conferência de invoker; registro no runbook | Conferência de produção |

**Pronto quando.** Uma demanda do comercial e uma direta percorrem pedido →
OS → planejamento com várias OS → execução → assinatura no celular, sem
sinal → revisão com divergência → aditivo ou orçamento da execução no
Comercial → a faturar. Cada OS revisada tem o tempo de cada etapa e de cada
item. A vistoria vira orçamento sem redigitar. A TV atualiza sozinha. Nenhum
valor em `service_orders`, nem para o owner (teste de schema e de regras).

## 7. Fase 4: financeiro da operação, portal e lançamento

**Objetivo.** Faturar a demanda executada, receber, mostrar OS e faturas ao
cliente no portal, avisar por sino e e-mail, e lançar a Operação com a v3 em
todo o app.

**Decisões.**

- Fatura-se a demanda, pelo orçamento aprovado mais os aditivos (ou a RV de
  execução validada), com a autorização de faturamento do cliente que já
  existe: pedido e aceite (Itaú), medição aprovada (Safra), portal do
  fornecedor ou outro registro. A armazenagem continua na fatura do WMS até
  a Fase 7.
- A NF é emitida fora do sistema até a integração da Fase 7; o sistema
  registra número, série, data, valor, vencimento e forma de pagamento, e
  marca a autorização como usada (os campos `nf_ids`, `enviada_portal_em` já
  estão reservados nas autorizações). Omie fora até nova decisão (a
  decisão veio em 24/10/2026, na Fase 7: a NFS-e pela Omie).
- Módulo Financeiro ganha shell próprio (owner, admin, financeiro) com
  Início, A faturar, Faturas, A receber, Vencidos, Pagos e Relatórios. O
  Faturamento do WMS continua no shell da Armazenagem até a Fase 7.
- Portal do cliente (`/portal`) mostra, pelo perfil: estoque (WMS), OS em
  andamento com etapas, comprovantes e PDF, faturas da demanda, e "Solicitar
  OS". A solicitação vira demanda com `entrada: portal` em Para planejar.
- Pedido de saída do WMS com entrega pela Dutelog gera demanda e OS
  (`entrada: armazenagem`); retirada pelo cliente não. A OS de retorno ao
  armazém gera recebimento.
- Notificações automáticas por modelo (sino e e-mail pelo Resend): OS
  agendada, iniciada, concluída com PDF e comprovantes, fatura emitida,
  pedido do portal recebido. Mensagens escritas pela IA só na Fase 5, com
  aprovação.
- O WMS adota a v3 nesta fase, no lançamento: shell v3 na Armazenagem e as
  telas do WMS migram tela a tela, começando pelas mais usadas (Início,
  Pedidos, Estoque, Receber), sem mudar comportamento.
- Nomes de evento sem as palavras do roteador do WMS: `nf.*`, `cobranca.*`,
  `portal.*`.

**Dados.** `invoices` passa a ser do Financeiro novo: `faturas` (demanda,
autorizações, itens faturados com valor, NF, vencimento, forma, status:
a emitir, emitida, enviada ao cliente, paga, cancelada), `pagamentos`,
`service_requests` (pedido do portal), `notifications` (já existe no WMS)
com os tipos novos. Preço só em `faturas` e `pagamentos` (regras por
`canReadPrices()` e cliente dono).

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 4.1 | Codebase `functions/financeiro`, shell do Financeiro (v3), fila A faturar (demandas em `a_faturar` com as autorizações), emissão registrada da NF, demanda `faturada`; eventos `nf.*` | Demanda sem autorização não fatura; valor da fatura é a soma das RVs autorizadas; operação não lê `faturas` |
| 4.2 | A receber, vencidos, pagos, receita por cliente, exportação XLSX, via comercial do PDF | Vencido calculado do vencimento; pagamento parcial |
| 4.3 | Portal: OS do cliente (andamento com etapas, comprovantes, PDF), faturas da demanda; regra `customerHasModule('operacao')` ativa | Cliente só vê as próprias OS e faturas; cliente sem `operacao` não vê OS |
| 4.4 | Solicitação de OS pelo portal: formulário por tipo de serviço, anexo, data e horário; vira demanda `entrada: portal` em Para planejar; aparece em "Para planejar" do Hoje e no Início | Pedido do portal nunca cria OS sozinho |
| 4.5 | Expedição do WMS com entrega pela Dutelog gera demanda e OS; retorno gera recebimento (`WmsExpedicao`) | Retirada pelo cliente não gera OS |
| 4.6 | Notificações: sino e e-mail por modelo (Resend), preferências por cliente no perfil | E-mail só com o canal ligado no perfil; nenhum valor para quem não vê valor |
| 4.7 | WMS na v3: shell da Armazenagem e as quatro telas mais usadas; as demais em PRs seguintes, tela a tela | `theme-colors.test.ts`; render e `axe` por tela migrada |
| 4.8 | Relatórios: OS por período, tipo, cliente e equipe; produtividade; uso de veículos; receita; Excel e PDF | Relatório sem valor para quem não vê valor |
| 4.9 | Lançamento em produção: liberação do Financeiro, portal com OS, conferência; registro | Conferência de produção |

**Pronto quando.** Uma demanda vai de a faturar a paga; o cliente vê estoque,
OS e faturas no mesmo portal e pede uma OS por lá; o motorista recebe a OS
no celular e o cliente recebe o PDF por e-mail ao concluir; a operação não lê
preço (teste de regras); o WMS está na v3 nas telas migradas.

## 8. Fase 5: memória da Dute

**Objetivo.** O sistema passa a sugerir com base no que foi feito, mostrando
de onde tirou. Uma pessoa decide.

**Decisões (do plano).** Três camadas: fatos (`events`), medidas
(`ai_measures`, recalculadas a cada revisão de OS e fechamento de demanda)
e lembranças (`ai_case_memory`, com resumo em texto e vetor, busca vetorial
do Firestore). Toda sugestão em `ai_suggestions` com o que a pessoa aceitou,
mudou ou recusou, e depois o valor real. Sem treino de modelo; com pouco
histórico, a sugestão diz que ainda não tem base. Dado de um cliente nunca
aparece para outro; medidas agregadas só para a equipe interna. O Agent Dute
sai do WMS para o núcleo, com ferramentas de leitura de todos os módulos e
rascunhos com aprovação.

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 5.1 | `ai_measures`: duração por item da LPU por tamanho de equipe, erro do planejamento (planejado x real por OS), itens que estouram o orçado, prazo de aprovação de orçamento, recalculadas na revisão e no fechamento | Medida bate com os eventos de uma OS conhecida; cliente A não entra na medida do cliente B |
| 5.2 | Duração sugerida e divisão em OS no Planejar OS, com a base; aviso de plano otimista; `ai_suggestions` com aceitar, mudar, recusar | Sugestão só com N execuções mínimas; origem gravada |
| 5.3 | `ai_case_memory` e orçamentos parecidos no Comercial: itens, quantidades, prazo e preço sugeridos com orçado x realizado de cada caso | Caso de outro cliente nunca sugerido; sugestão não grava no orçamento sem a pessoa aceitar |
| 5.4 | Dias parado no WMS por item, caixa e peça; etiquetas e alertas por regra do perfil do cliente; alerta no portal e por e-mail com aprovação | Limite do perfil respeitado; alerta não sai sem aprovação |
| 5.5 | Agent Dute no núcleo: `functions/core` (ou a codebase que o desenho da fase definir) com as ferramentas de leitura dos módulos, radar, briefing, rascunhos com aprovação; o WMS passa a usar o do núcleo | Ferramenta nunca escreve; isolamento por cliente nas respostas |
| 5.6 | Painel de acerto: erro médio da duração prevista, taxa de aceite das sugestões | Painel calculado dos `ai_suggestions` |

**Pronto quando.** Uma OS nova recebe duração sugerida com a origem
mostrada; um orçamento novo recebe itens e prazo de casos parecidos; um item
parado além do limite do cliente gera etiqueta e alerta aprovado; o painel
mostra o erro médio.

## 9. Fase 7: financeiro unificado

**Objetivo.** Um só lugar para faturar armazenagem e OS, um só a receber,
uma só fatura por cliente e competência, e a NF e a contabilidade por
integração. Desenho e registro das partes:
`docs/plataforma/fase-7-financeiro-unificado.md`.

**Decisões.** Antes de tocar nas trilhas de dinheiro do WMS
(`functions/wms/src/billing.ts`, `domain/operations.ts`, `index.ts`), testes
nessas trilhas, como o `CLAUDE.md` exige. A LPU de cobrança do WMS
(`billing_price_list`) unifica-se ao catálogo e às tabelas do Comercial. A
integração de NF-e e NFS-e e a contabilidade escolhem fornecedor nesta fase
(pergunta 21 da seção 13, decidida em 24/10/2026: a NFS-e sai pela Omie, o
CT-e segue à mão, a Dute lança a baixa na Omie e o contador cadastra os
serviços lá). Contratos e
Autorizações passam a ser lidos pelo Financeiro (pergunta 5 do desenho do
Comercial);
a demanda que perdeu o prazo de faturamento ganha o motivo de perda "prazo
de faturamento" (pergunta 10 do desenho do Comercial).

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 7.1 | Testes nas trilhas de dinheiro do WMS: prévia, emissão, competência congelada, fatura por cliente | Cobertura das funções de cálculo com casos reais fictícios |
| 7.2 | A receber único: faturas do WMS e da demanda na mesma fila do Financeiro | Total do a receber é a soma das duas origens |
| 7.3 | LPU de cobrança do WMS no catálogo e nas tabelas do Comercial, com vigência | Fatura do WMS calcula igual antes e depois (teste de regressão) |
| 7.4 | A NFS-e pela Omie e a baixa do pagamento lá (partes 7.4a a 7.4i no runbook da fase) | Emissão idempotente; falha não marca a fatura como emitida; a baixa sai uma vez |
| 7.5 | Contratos e Autorizações no shell do Financeiro; perda por prazo de faturamento | Financeiro lê sem editar itens nem preço |

**Pronto quando.** Uma competência fecha com armazenagem e OS na mesma
fatura; a NF sai pela integração; o a receber é um só.

## 10. Fase 8: RH

**Objetivo.** Documentos, CNH, exames e treinamentos dos colaboradores, com
vencimentos avisados, num banco à parte; folha e eSocial por integração.
Desenho e registro das partes: `docs/plataforma/fase-8-rh.md`.

**Decisões.** Banco Firestore `dute-rh`, separado, com regras próprias: lê e
grava `rh`; `admin` e `owner` leem (proposta, resolvendo a divergência do
plano; pergunta 23 da seção 13). `collaborators` do núcleo continua operacional (nome,
função, papéis, CNH com validade, telefone, vínculo); o banco `dute-rh`
guarda o sensível (documentos, exames, treinamentos, contrato de trabalho,
salário) ligado ao id do colaborador. Alertas de vencimento vão ao Início do
RH e, os de CNH, ao da Operação. Zeragem do WMS nunca toca o banco `dute-rh`.

**Partes, em ordem.**

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 8.1 | Banco `dute-rh`, `firestore-rh.rules`, codebase `functions/rh`, papel `rh` no shell | Só `rh`, `admin` e `owner` leem; ninguém grava pelo navegador |
| 8.2 | Ficha do colaborador: documentos (Storage com regra), exames, treinamentos, vencimentos; alertas no Início | Vencimento gera alerta uma vez; documento visível só no RH |
| 8.3 | Exportação da competência para a contabilidade, que faz a folha e transmite o eSocial (pergunta 24, decidida em 24/10/2026) | Exportação idempotente |

**Pronto quando.** Só `rh`, `admin` e `owner` leem o banco `dute-rh` (teste de
regras); CNH, exame e treinamento vencendo aparecem no Início certo.

## 11. Contínuo

- **Backups**: teste de restauração para um banco novo antes da primeira
  carga do Comercial em produção; depois, a cada trimestre. É o workflow
  `Teste de restauração`, um banco por vez (`backup-e-recuperacao.md`).
- **Monitoramento e alertas**: erros das Functions por codebase, invoker,
  latência das callables, falhas de envio de e-mail; um painel só. O painel
  do sistema (Configuração › Sistema, `docs/painel-sistema.md`) mostra os
  erros de todas as functions e, desde 24/10/2026, o estado e o acesso das
  callables de todas as codebases. Desde 25/10/2026, o e-mail dos avisos que
  desiste depois de 5 tentativas vira erro da `runNotifications`, com o id
  e o erro de cada um, e aparece no mesmo quadro; o quadro Latência mostra o
  p50 e o p95 de 24 h de cada function (Cloud Monitoring).
- **LGPD**: retenção e exclusão de fotos, assinaturas e dados de campo;
  CPF só onde o papel precisa; registro de quem acessou o que. O inventário
  dos dados pessoais, o que falta e as 12 decisões do Leonardo, cada uma com
  a recomendação, estão em `lgpd.md` (25/10/2026); as mudanças entram depois
  das decisões.
- **Manual do usuário** em `docs/manual-*.md`, por módulo: é para lá que vai
  toda explicação que a tela não mostra.
- **Treinamento**: Guilherme (Comercial), coordenação (Operação), líderes
  (campo), financeiro e cliente (portal), a cada marco de produção. O roteiro
  de cada sessão, com os exercícios na homologação e o registro de quem foi
  treinado, está em `docs/treinamento.md`.

## 12. Riscos

- **Produção no meio da fase.** Publicar a `main` leva junto o que estiver
  pronto; a liberação por ambiente e o backend que nega por padrão são a
  proteção. A Operação já ligada em produção em parte é o caso a decidir
  (pergunta 1).
- **Dados reais cedo.** CPF, CNH, fotos e assinaturas entram na Fase 3; as
  regras do Storage e a LGPD entram com elas, não depois.
- **Duas codebases num documento.** A demanda é escrita pelo Comercial e
  pela Operação; os campos de cada um estão declarados e testados, e o
  evento diz quem escreveu.
- **Campo sem sinal.** A fila offline e a idempotência das callables são o
  que evita registro perdido ou duplicado; o teste 3.8 cobre os dois.
- **Memória vazia no começo.** Sugestão só com histórico mínimo; até lá a
  tela diz que não há base.
- **Arquivos grandes do WMS.** Nada se refatora antes dos testes das
  trilhas de dinheiro (7.1).
- **Legenda voltando.** A trava é o teste de textos de cada tela e a
  revisão com a lista da seção 1.2.

## 13. Perguntas para o Leonardo, por fase

Antes da fase indicada; a resposta entra no runbook dela.

**Fase 2** (respondidas pelo Leonardo em 23/10/2026: 1, a Operação fica
ligada na produção, porque ninguém usa o sistema ainda; 2, a plataforma
ligada para todos fica; 3, o Agent Dute só no WMS até a Fase 5; 4, a
Configuração fica no menu da conta; 5, a quinta coluna do Hoje é "Em
revisão")
1. A Operação continua ligada na produção enquanto a Fase 3 anda (cadastro
   e fila do dia em uso), ou desliga até a parte 3.9 e religa como
   lançamento? Recomendo desligar: cada parte muda o modelo da OS, e OS
   parciais em produção não servem à revisão nem à IA.
2. A plataforma ligada para todos na produção (cards para owner, admin e
   interno) fica assim? Recomendo que sim, agora que o shell por módulo é a
   navegação.
3. O Agent Dute entra em cada shell com o contexto do módulo (Fase 5) ou só
   no WMS até lá? Recomendo só no WMS até a Fase 5.
4. Configuração continua no menu da conta, fora dos shells? Recomendo que
   sim.
5. A quinta coluna do Hoje é "Em revisão" (proposta) e não "Concluídas hoje"
   (v3 de 19/10)? Recomendo "Em revisão".

**Fase 6, fechamento**
6. Razão social e CNPJ para o PDF (pergunta 15 do desenho).
7. Ponto de partida do contador: 10001 ou o último da planilha?
8. Quais passos do roteiro já foram feitos fora do repositório (publicação,
   `splitCatalogPrices`, papel do Guilherme)?
9. Perguntas de uso do desenho (1, 7, 8, 14, 16): podem esperar a semana em
   paralelo? Recomendo que sim.
10. Ações sem botão hoje aceitas pelo servidor: Perdido em rascunho e
    aprovado, Aditivo em execução a orçar. Recomendo dar botão às duas
    primeiras e deixar a terceira para o uso.

**Fase 3**
11. As nove respostas propostas na seção 6 (faturamento no fim da demanda,
    assinatura como aceite de quantidades, revisão decide, sem responsável,
    vistoria sem assinatura, preço pela tabela, freelancer com presença,
    48 horas corridas, presença pelo líder).
12. Os tipos de serviço da OS (transporte, montagem, desmontagem,
    embalagem, vistoria, armazenagem) derivados dos itens: basta, ou a OS
    tem um tipo escolhido à mão?
13. Vistoria e demanda direta podem nascer pelo celular do líder, ou só
    pela coordenação? Recomendo só pela coordenação no v1.
14. A TV fica em `/tv` com o papel `painel` e sessão longa, como no plano?

**Fase 4**
15. Emissão da NF fora do sistema com registro, até a integração da Fase 7:
    confirma?
16. O cliente pede OS pelo portal e a solicitação cai em Para planejar como
    demanda `portal`: confirma? Quem é o contato do cliente nessa demanda?
17. Quais notificações saem por e-mail e quais só no sino, por modelo de
    cliente?
18. A ordem de migração das telas do WMS para a v3: Início, Pedidos,
    Estoque, Receber primeiro?

**Fase 5** (seguimos a recomendação até a resposta: 19, 5 do mesmo item e
cliente ou 15 em qualquer cliente; 20, `functions/core`; desenho em
`fase-5-memoria.md`)
19. Mínimo de execuções para a IA sugerir duração (recomendo 5 do mesmo
    item e cliente, ou 15 do item em qualquer cliente para a média interna).
20. O Agent Dute no núcleo: codebase `functions/core` ou dentro de uma
    existente?

**Fase 7**
21. Fornecedor da NF-e e NFS-e e da contabilidade, com a Omie fora.
    Decidida em 24/10/2026: a Omie (a NFS-e; o CT-e segue à mão).
22. A perda por prazo de faturamento (pergunta 10 do Comercial): motivo
    próprio aceito só com o alerta vencido?

**Fase 8**
23. `owner` e `admin` leem o banco `dute-rh`? O plano diz "tudo" para eles e
    "só rh e admin" para o banco. Recomendo que leiam; só `rh` grava. Seguimos
    a recomendação até a resposta (`fase-8-rh.md`).
24. Fornecedor da folha e do eSocial. Decidida em 24/10/2026: a
    contabilidade faz a folha e transmite o eSocial; a Dute exporta a
    competência (parte 8.3).

**Surgidas na implantação**
25. Proposta sem resposta (parte 2.5): o Início do Comercial a mostra depois
    de 5 dias corridos aguardando o cliente. São 5 dias, ou outro prazo?
26. Receita por serviço (parte 4.8b): a NF registrada guarda só o total. O
    relatório vale o rateio da NF pelas linhas do orçamento de cada demanda?
    Até a resposta, o Financeiro mostra as NFs emitidas por mês no lugar.
27. O tempo por item (parte 5.1) é em homem-minuto: 2 pessoas fazem na
    metade do tempo de 1. Vale para montagem e carga?
28. O tempo de trabalho deixa o deslocamento de fora, e quem planeja soma o
    trajeto. Vale, ou a sugestão estima o trajeto também?
29. Orçamentos parecidos (parte 5.3): comparar pelos itens da LPU e pelas
    quantidades, em vez do vetor do texto? Recomendo pelos itens, mais exato
    e explicável, com o resumo em texto guardado para o Agent Dute. Seguimos
    assim desde a parte 5.3a; a semelhança é o cosseno dos itens vezes a
    razão das escalas (12 mesas contra 30 dão 75%).
30. Dias parado (parte 5.4): os três modelos de operação com "Parado 90+
    dias" sem entrada nem saída e "Sem giro" aos 180 dias sem saída, ou cada
    modelo com os dele (o mobiliário fica guardado por mais tempo; o insumo
    deveria girar mais rápido)? Seguimos com o mesmo para os três desde a
    parte 5.4a.
31. Agent Dute no núcleo (parte 5.5): a equipe passa a falar do cliente
    ativo, e não mais só da BTG? Recomendo que sim.
32. Quem tem o Agent Dute: owner, admin, interno, wms, comercial,
    financeiro, suporte e o cliente; o campo (app sem sinal) e o painel (TV)
    não; o RH na Fase 8? Recomendo assim.
33. A prévia do faturamento sai do agente até a Fase 7, que unifica o
    faturamento, e o agente lê as faturas emitidas? Recomendo; hoje ela lê o
    período antigo da BTG para qualquer cliente.
34. A anotação que o agente sugere entra só pelo cartão, quando a pessoa a
    envia (hoje a ferramenta já grava a pendente)? Recomendo: ferramenta
    nunca grava.
35. O briefing do dia vira uma rotina pronta ("Resumo do dia", dias úteis
    às 7h) que cada pessoa liga, e o radar do painel mostra as linhas do
    "Precisa de você" dos módulos da pessoa, sem regra própria? Recomendo.

**Revisão dos manuais** (25/10/2026). O que os manuais de cada módulo
acharam e o código não decide sozinho. Os defeitos viraram PRs (342 a 361);
estas esperam a resposta, e até ela vale o que está no código, que é o que
os manuais descrevem.

*Armazenagem*
36. Devoluções (`/wms/devolucoes`) e Qualidade (`/wms/qualidade`) só abrem
    pelo endereço: nenhum item de menu, nenhum link, e o retorno a receber
    não aparece no Início. Recomendo Devoluções como item de Pedidos, com o
    retorno a receber no "Precisa de você", e Qualidade como item de
    Estoque, onde a exceção se resolve.
37. O Histórico de movimentações e os Relatórios mostram todos os clientes,
    sem seguir o cliente ativo como as outras telas internas. Recomendo
    seguir o cliente ativo.
38. O relatório "Itens parados" conta qualquer movimento e oferece 30, 60 e
    90 dias; a regra dos dias parado (parte 5.4, `lib/dominio/src/parados.ts`)
    conta só algumas origens, com 90 e 180 dias. São dois números para a
    mesma pergunta. Recomendo o relatório usar a regra da 5.4.
39. O custo da mercadoria é valor? As leituras o tiram de quem não é owner,
    admin ou financeiro, mas a Contagem mostra "Valor controlado" a quem
    conta, inclusive o `wms`, e a abertura exige custo maior que zero, que o
    `interno` e o `wms` digitam sem ver o do cadastro. Recomendo tratar como
    valor: a Contagem não pede custo a quem não vê valor, o custo vem do
    cadastro do produto (o financeiro ou o admin informa) e a abertura recusa,
    com o motivo, a linha de produto sem custo cadastrado. O ad valorem da
    armazenagem sai desse custo.
40. O "Local" do Receber, o "Endereço contado" da Contagem, o "Endereço de
    retorno" da devolução e a "Origem" e o "Destino" da movimentação (que
    vêm com "ESTOQUE_BTG") são texto livre; só a guarda confere a posição no
    cadastro, e o `CLAUDE.md` diz que a prateleira nunca é digitada.
    Recomendo escolher a posição do cadastro em todos, como na guarda.
41. A ficha da chegada no Receber, tela já na v3, tem legendas; o teste de
    textos cobre só o cartão do aviso. Recomendo tirá-las na próxima rodada
    de UX do Receber, com o teste cobrindo a ficha.
42. Na chegada "a conferir", o botão "Concluir entrada" só a passa para "em
    conferência". Recomendo o botão dizer "Conferir" nesse status e
    "Concluir entrada" só na conferência.
43. O suporte e o Faturamento: o servidor deixa o suporte ler a prévia e o
    desenho da Fase 7 o põe na tela, mas a rota é só de owner, admin e
    financeiro. Recomendo seguir a regra do preço do `CLAUDE.md` (owner,
    admin, financeiro e comercial): o suporte fica fora, e o servidor deixa
    de lhe dar a prévia.
44. O Mapa difere do desenho: o desenho fala em livre, parcial, cheia, em
    verificação e bloqueada, e no espaço restante em caixas de referência; a
    tela mostra "sem caixas registradas", "sem vaga na base" e o volume
    registrado. Recomendo manter a tela, que mostra o que o sistema mede
    hoje, e corrigir o desenho.
45. No Mapa, "Etiquetas das caixas" aparece em qualquer prateleira, mas a
    tela de etiquetas só imprime as do cliente ativo e, nas de outro, diz que
    algumas não estão disponíveis. Recomendo o botão só nas prateleiras com
    caixa do cliente ativo.

*Portal*
46. O convite do cliente exige a sigla do SKU ("sem armazenagem, ele não tem
    portal"), mas desde 24/10 o portal atende o cliente só com a Operação:
    fica sem convite o cliente que nasceu no Comercial e nunca foi salvo em
    Configurações › Clientes. Recomendo convidar sem a sigla quando o
    contrato não tem armazenagem.
47. O número "Agendadas" de Minhas OS soma as OS ainda sem data. Recomendo
    contar só as com data.
48. O aviso "Itens parados" leva ao Estoque do portal, que não marca o item
    parado: os dias parado só existem no Estoque interno. Recomendo o
    Estoque do portal marcar os itens do aviso, como o plano previa.

*Operação*
49. Mudar os itens de uma OS (`set_items`) e criar a OS com todo o saldo
    (`create`) existem no servidor, sem tela. Recomendo as duas na próxima
    rodada de UX da OS.
50. O servidor aceita a presença marcada pelo escritório, e o "Registrar
    andamento" não a oferece. Recomendo oferecer, para quando o líder não
    marcou no celular.
51. Na vistoria, o celular só tem "Registrar chegada"; a "Saída do pátio" só
    se registra pelo escritório. Recomendo o celular registrar as duas.
52. O cartão de itens do celular mostra "Registre a primeira etapa antes dos
    itens.", uma legenda. Recomendo mostrar os itens com os botões desligados
    até a primeira etapa, sem a frase.
53. O "E-mail do app" aceita login `interno` (`PAPEIS_COM_APP`), mas o
    `/campo` só abre para `campo`, owner e admin. Recomendo abrir o `/campo`
    ao `interno` com o app ligado, para a coordenação que vai a campo.
54. A presença do freelancer e do terceiro "paga a diária" (comentário de
    `functions/operacao/src/domain/presencas.ts`), mas nenhum módulo lê a
    presença. Recomendo as presenças do mês por pessoa na exportação do RH
    para a contabilidade (parte 8.3), numa parte própria.

**Matriz de papéis do WMS** (25/10/2026). O teste
`functions/wms/src/callables-papeis.integration.test.ts` trava quem passa em
cada callable do WMS; onde o código diverge da tabela de
`docs/modulos-e-permissoes.md`, vale o código até a resposta.

55. Qualquer papel do WMS abre solicitação (`createCustomerRequest`),
    inclusive o pedido de retirada, que já reserva o estoque. Nenhuma tela da
    equipe abre solicitação (só o portal e os cartões do Agent Dute do
    cliente), e a tabela dá a criação ao cliente e à coordenação: o wms
    executa depois da aprovação, o financeiro e o suporte acompanham.
    Recomendo o servidor aceitar só o cliente, no próprio contrato, e owner,
    admin e interno.

**Auditoria de 24/07** (25/10/2026). Achados da auditoria
(`docs/auditoria-codigo-2026-07-24.md`) ainda abertos que são tela e
esperam o alinhamento.

56. O Painel do Agent Dute (`/agente/painel`) mostra "Nenhuma mensagem
    pendente" quando a lista de notificações não carrega: o erro parece fila
    vazia (achado 66 da auditoria de 24/07, ainda aberto). Recomendo a tela
    dizer que não carregou, com "Tentar de novo", como as telas da v3.
