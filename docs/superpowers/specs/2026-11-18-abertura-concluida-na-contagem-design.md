# A Contagem como a entrada das contagens

Desenho curto, aprovado na conversa de 18/11/2026 com o Leonardo (a segunda
versão: a primeira tirava só a aba da abertura e deixava a cíclica; o Leonardo
pediu que a Contagem não deixasse a cíclica, que a BTG não usa, nem jogasse a
pessoa direto nas prateleiras). Registro definitivo no diagnóstico da Contagem
(`docs/plataforma/diagnostico-contagem-ciclica.md`), que todo PR da Contagem
atualiza.

## Intenção e porquê

Com a sessão de abertura concluída, a Contagem da BTG mostra duas coisas sem
uso: a aba "Inventário de abertura", só de leitura, com o painel de progresso,
as caixas e as linhas, que parece viva e confunde quem reconta (diagnóstico,
seção 2, ressalva 1); e o formulário "Registrar contagem" da aba cíclica, que
grava por SKU × prateleira sem saber de caixa e deixa o registro da caixa
errado. A recontagem de verdade vai pela Contagem por caixa, mas abrir a
Contagem já nela expõe todas as prateleiras de cara.

O Leonardo quer que abrir a Contagem mostre as contagens: a que está em
andamento, com "Continuar"; "Iniciar contagem" quando não há nenhuma; e as
anteriores, com o inventário de abertura como a primeira linha ("uma linha com
o progresso da abertura, pra ver o que foi feito"). As prateleiras ficam a um
clique, dentro da contagem. É a coleção da rodada decidida em 17/11/2026 (o
cartão "Rodada" e "Anteriores", a rodada como a própria Contagem na v3).

## Objetivos deste PR (a primeira foto aprovada)

- `/wms/contagem` vira a entrada, na v3, para o cliente com a abertura
  concluída:
  - cabeçalho "Contagem · <cliente>", com "Folha de contagem" e "Caixas ×
    saldo";
  - "Em andamento": o cartão da recontagem geral (o mesmo cartão de números da
    tela Contagem por caixa: título, começo, prateleiras, caixas, caixas com
    diferença, diferença líquida e a barra), com "Continuar <prateleira>" para
    a bancada e "Ver prateleiras" para a Contagem por caixa; sem prateleira
    por contar, só "Ver prateleiras"; sem prateleira com caixa, a seção não
    aparece;
  - "Anteriores": a linha do inventário de abertura, lida da sessão
    (`completed_at`, `completed_by`, `line_count`, `unit_count`):

    ```
    ✓ Inventário de abertura   20/10/2026 às 18:40 · Leonardo   249 lançamentos · 7.314 unidades
    ```

- A tela de hoje (as abas, a abertura e a cíclica) passa para
  `/wms/contagem/abertura`, no visual de hoje, sem mudar: a entrada manda para
  lá quando a sessão lida não está concluída, e ela manda para a entrada
  quando a sessão conclui (também logo depois de "Confirmar encerramento").
- A Contagem por caixa (`/estoque/contagem/rodada`), a bancada, a folha e o
  Caixas × saldo não mudam; o "Contagem" de voltar da rodada leva à entrada.

## Não objetivos

- "Iniciar contagem", o fim de uma contagem e as contagens anteriores além da
  abertura: precisam do registro da rodada (coleção, callables de iniciar e
  concluir com evento e recibo, regras, índices, zeragem, a bancada gravando
  o id da rodada aberta). É o PR seguinte, como decidido em 17/11/2026
  (segunda foto aprovada em 18/11/2026). A prateleira "em contagem" e a fila
  de revisão ficam para depois dele.
- A cíclica como entrada secundária para um cliente sem caixas: não existe
  cliente assim; fica para o PR da coleção.
- O título da Contagem por caixa continua "Contagem por caixa".
- Sem valor (preço) nem contagem de caixas na linha da abertura; sem link
  para as caixas e linhas da abertura (a folha, a bancada e o Caixas × saldo
  mostram a entrada por caixa; as etiquetas saem por Estoque › Etiquetas e
  pelo Mapa). Sem "Posições ocupadas".
- Nenhuma callable nova, nenhuma escrita.

## Restrições

- Um problema por PR, com o teste que falha antes.
- Tela nova na v3 (`TELAS_DO_WMS_NA_V3` ganha `/wms/contagem`;
  `/wms/contagem/abertura` fica fora, no visual de hoje), sem legenda: só
  rótulos, dados e ações, com a lista de textos e o `axe`; só tokens de cor.
- Carregamento v2: a linha de estado sob o título, a forma final na primeira
  leitura (o esqueleto do cartão e da lista), a falha nunca vira vazio, e o
  teste de espera não usa tempo fixo de relógio real.
- Data e hora no fuso `America/Sao_Paulo`; sem quem concluiu, só a data; sem
  data válida, só quem; singular em 1.
- O menu marca "Contagem" na entrada e em `/wms/contagem/abertura`; a rota
  nova tem papéis próprios na lista de rotas (os mesmos da Contagem) e título
  de documento.

## Abordagens

1. **A entrada nova em `/wms/contagem`, a tela de hoje em
   `/wms/contagem/abertura`, redirecionamento pelo status da sessão.**
   Escolhida: cada tela com um visual só, a entrada na v3, a de hoje intacta;
   o cartão da rodada reaproveitado como componente.
2. Esconder só a aba da abertura e deixar a cíclica (a primeira versão deste
   desenho): a cíclica sem uso continuava exposta; o Leonardo recusou.
3. Mandar a Contagem direto para a Contagem por caixa: as prateleiras todas de
   cara, "muito exposto"; o Leonardo recusou.
4. A entrada com "Iniciar contagem" já: pede o registro da rodada; fica para o
   PR seguinte.

## O que fica com quem constrói

- O esqueleto da entrada enquanto lê (a linha de estado diz "Carregando
  contagens…").
- Para onde vai o foco quando o aviso da falha sai.
- A ordem e o espaçamento das seções, com as fotos aprovadas como referência
  (`docs/mockups/contagem-entrada/`).
