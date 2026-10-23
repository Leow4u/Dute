# Mockups v3 da plataforma Dute

Identidade visual do app único, aprovada pelo Leonardo em 19/10/2026. O canvas
com as 14 telas fica em https://claude.ai/artifact/KzkB7KUsJFB1fKAVsMPWse
(privado); os arquivos `*.dc.html` desta pasta são as fontes de cada tela.

| Tela | Arquivo |
|---|---|
| Login | `Main.dc.html` |
| Início | `Inicio.dc.html` |
| TV da sala de operações (`/tv`) | `TVSala.dc.html` |
| Operação (kanban do dia) | `Operacao.dc.html` |
| Nova OS | `OSNova.dc.html` |
| Detalhe da OS | `OSDetalheV2.dc.html` |
| Impressão da OS (A4, via operacional) | `OSImpressao.dc.html` |
| Financeiro | `Financeiro.dc.html` |
| Relatórios | `Relatorios.dc.html` |
| Clientes | `Cadastros.dc.html` |
| Portal do cliente | `Portal.dc.html` |
| Campo: OS do dia | `CampoV2.dc.html` |
| Campo: detalhe da OS | `CampoDetalhe.dc.html` |
| Campo: concluir | `CampoConcluir.dc.html` |

As telas do Comercial, aprovadas em 20/10/2026, ficam na página "Comercial ·
orçamentos e contratos" do mesmo canvas. O desenho está em
`docs/plataforma/fase-6-comercial.md`.

| Tela | Arquivo |
|---|---|
| Comercial · orçamentos | `ComFila.dc.html` |
| Montar orçamento | `ComOrcamento.dc.html` |
| Aprovar no celular | `ComAprovarCelular.dc.html` |
| PDF do orçamento (A4) | `ComDocumento.dc.html` |
| Clientes e prospects | `ComClientes.dc.html` |
| Contrato | `ComContrato.dc.html` |
| Autorizações de faturamento | `ComAutorizacoes.dc.html` |
| Medição mensal | `ComMedicaoMensal.dc.html` |

A página "Operação · demandas e OS" do canvas traz a proposta "Demanda: do
pedido ao faturamento", feita entre 17 e 19/10/2026 e recuperada para o
repositório em 23/10/2026 (até então só existia no canvas). As premissas e as
nove perguntas "para validar com a operação" estão nas notas da página e em
`docs/plataforma/alinhamento-comercial-operacao.md`, seção 2.5.

| Tela | Arquivo |
|---|---|
| Fluxo da demanda | `OpFluxo.dc.html` |
| Nova demanda direta (paraquedas) | `OpDemandaNova.dc.html` |
| Comercial · fila (versão da proposta) | `ComOrcamentos.dc.html` |
| Armazenagem · pedido de saída com entrega Dutelog | `WmsExpedicao.dc.html` |
| Operação · hoje (kanban) | `OpHoje.dc.html` |
| Operação · agenda da semana | `OpAgenda.dc.html` |
| Operação · demandas | `OpDemandas.dc.html` |
| Demanda planejada (várias OS) | `OpDemanda.dc.html` |
| Planejar OS a partir do saldo | `OpOSPlanejar.dc.html` |
| OS em execução (escritório) | `OpOS.dc.html` |
| Campo · minhas OS (líder) | `Campo2Hoje.dc.html` |
| Campo · OS em execução | `Campo2Execucao.dc.html` |
| Campo · incluir item executado | `Campo2IncluirItem.dc.html` |
| Campo · concluir com assinatura | `Campo2Concluir.dc.html` |
| Campo · OS de vistoria | `Campo2Vistoria.dc.html` |
| Revisão interna da OS | `OpRevisao.dc.html` |
| Comercial · aditivo de orçamento | `ComAditivo.dc.html` |
| Comercial · orçamento da execução (paraquedas) | `ComMedicao.dc.html` |

A página "Shell por módulo · 23/10" registra as decisões de UX e UI de
23/10/2026 (um shell por módulo na v3, seletor de módulo no topo da barra,
Início por módulo, cards da entrada com contadores, Clientes por módulo, fila
do dia com "Para planejar", celular por módulo). As telas são interativas: o
seletor abre no clique.

| Tela | Arquivo |
|---|---|
| Entrada · cards com contadores | `ModEntrada.dc.html` |
| Comercial · Início (shell v3, seletor no topo) | `ModComInicio.dc.html` |
| Operação · Início (shell v3, seletor no topo) | `ModOpInicio.dc.html` |
| Operação · Hoje (Para planejar, agendar, agendadas, execução, revisão) | `ModOpHoje.dc.html` |
| Operação · Clientes (locais, só leitura) | `ModOpClientes.dc.html` |
| Armazenagem · barra de hoje, só ganha o seletor | `ModWms.dc.html` |
| Celular · Comercial (Guilherme, um módulo) | `ModCelularCom.dc.html` |
| Celular · Operação (seletor no cabeçalho) | `ModCelularOp.dc.html` |

A página "Portal · gênero no cartão do estoque" tem canvas próprio (privado,
https://claude.ai/artifact/2NH76ezJdQkmF6ZvDrCBtZ): a proposta de 23/10/2026
para o Estoque do portal mostrar o que é feminino e o que é masculino sem
depender de ler o nome. As telas seguem o visual do WMS
(`docs/sistema-visual.md`), não a v3, porque o Estoque do portal ainda é tela
do WMS.

O Leonardo aprovou a opção A em 23/10/2026, e ela está no app: chip com
símbolo e cor no canto direito da foto (FEM rosa, MASC azul-petróleo), na linha
do tipo quando o cartão não tem foto, ao lado do nome na lista e junto do tipo
no detalhe. Sem gênero, sem chip. O gênero sai do nome que o cartão mostra
(`productGender` em `artifacts/app/src/lib/portal-stock.ts`), não do campo
Gênero do cadastro: a Contagem pré-preenche esse campo pelo prefixo do código
(A.01 vira Masculino), e a polo feminina A.01.0805.002 tem esse prefixo. O
filtro por gênero da prancha principal ficou fora; entra se o Leonardo pedir.

| Tela | Arquivo |
|---|---|
| Estoque · cartões com o chip de gênero (A, aprovada) | `PortalEstoqueGenero.dc.html` |
| Alternativas: A suave, B sólido, C só na linha de apoio | `PortalEstoqueGeneroAlternativas.dc.html` |
| Estoque · lista | `PortalEstoqueGeneroLista.dc.html` |

## Regras da v3

- Menu lateral preto `#161616` com logo branco; item ativo com marcador
  vermelho. Desde 23/10/2026 cada módulo tem o próprio shell (Armazenagem,
  Comercial, Operação): o menu lista o Início e as telas daquele módulo, o
  nome do módulo no topo da barra é o seletor para trocar de módulo e o logo
  leva à entrada por cards. As telas anteriores, com os seis módulos num menu
  só, valem pelo conteúdo, não pelo menu.
- Conteúdo `#F5F5F3`, cartões brancos com borda `#E5E5E1` e raio 12.
- Vermelho da marca `#E71C23` (hover `#AD0015`) só na ação principal da tela, uma
  por tela, e em alertas. No app ele é o token `--v3-marca` (igual nos dois temas) e,
  no claro, o `--primary` dentro de `.v3`. Links no azul da marca `#0054CE`.
- Fonte Manrope.
- Status (fundo/texto): agendada `#ECE6FA`/`#5B21B6`, em execução
  `#FDF0D5`/`#8A4B00`, concluída `#DDF5E4`/`#14602F`, faturada `#D5F2EF`/`#0E5F58`,
  paga `#E7E7E3`/`#3F403F`, atrasada `#FBE3E4`/`#8E1016`.
- TV da sala em modo escuro, fundo `#0E0E10`. Agent Dute em violeta
  (`#C9B8FB`/`#5B3FC4`).
- Celular: cabeçalho preto e barra inferior com quatro itens.
- Sem legendas: só rótulos, dados e ações. Explicação vai para manual em `docs/`.
- Operação e campo nunca veem valores.
