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

## Ajustes de UX para validar (22/10/2026)

Mockup do visual atual do WMS e do portal, para os cinco ajustes conferidos
no código. Não é a identidade v3: o WMS segue `docs/sistema-visual.md` até
o lançamento da Operação.

| Tela | Arquivo |
|---|---|
| Guarda, avisos, pedidos e carrinho | `ux-cinco-passos.html` |

## Regras da v3

- Menu lateral preto `#161616` com logo branco e seis módulos (Início, Operação,
  Clientes, Financeiro, Agent Dute, Administração); item ativo com marcador
  vermelho.
- Conteúdo `#F5F5F3`, cartões brancos com borda `#E5E5E1` e raio 12.
- Vermelho da marca `#E71C23` (hover `#AD0015`) só na ação principal da tela, uma
  por tela, e em alertas. Links no azul da marca `#0054CE`.
- Fonte Manrope.
- Status (fundo/texto): agendada `#ECE6FA`/`#5B21B6`, em execução
  `#FDF0D5`/`#8A4B00`, concluída `#DDF5E4`/`#14602F`, faturada `#D5F2EF`/`#0E5F58`,
  paga `#E7E7E3`/`#3F403F`, atrasada `#FBE3E4`/`#8E1016`.
- TV da sala em modo escuro, fundo `#0E0E10`. Agent Dute em violeta
  (`#C9B8FB`/`#5B3FC4`).
- Celular: cabeçalho preto e barra inferior com quatro itens.
- Sem legendas: só rótulos, dados e ações. Explicação vai para manual em `docs/`.
- Operação e campo nunca veem valores.
