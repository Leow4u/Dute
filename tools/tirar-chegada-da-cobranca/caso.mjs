/**
 * A chegada repetida da BTG (pendência das sessões arquivadas em 18/11/2026).
 *
 * A AVL-B1FE59A8 (06/11/2026, pela caixa CX-000227) lançou de novo a
 * mercadoria da AVL-0D0E620B (30/10/2026), da mesma NF 046143. O estoque foi
 * acertado em 16/11/2026 (tools/acerto-btg-2026-10, bloco `duplicada-0611`),
 * por ajuste, que não se cobra. A ENTRADA da chegada repetida ficou: as duas
 * linhas dela (GG 30 e XGG 41) contam 71 peças e 2 movimentos na cobrança de
 * novembro.
 *
 * `esperado` é o que a leitura tem de achar para a ferramenta gravar: outra
 * conta de entradas da chegada no mês recusa, em vez de tirar da cobrança o
 * que o caso não descreve.
 */

export const CASO = {
  id: "chegada-repetida-btg-2026-11",
  cliente: "BTG Pactual",
  competencia: "2026-11",
  chegada: "AVL-B1FE59A8",
  repetiu: "AVL-0D0E620B",
  nf: "046143",
  esperado: { movimentos: 2, pecas: 71 },
  motivo:
    "A chegada AVL-B1FE59A8 (06/11/2026, pela CX-000227) lançou de novo a mercadoria da AVL-0D0E620B (30/10/2026), da mesma NF 046143. O estoque foi acertado em 16/11/2026 (tools/acerto-btg-2026-10, bloco duplicada-0611); a entrada repetida sai da cobrança de 11/2026.",
  ator: {
    uid: "script:tirar-chegada-da-cobranca",
    role: "admin",
    name: "Chegada repetida fora da cobrança (script, Leonardo)",
  },
};
