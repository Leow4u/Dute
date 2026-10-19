import type { OperationPack } from "../types";

/**
 * Pacote da BTG sobre o modelo Uniformes. Hoje é só o que já existe: nada a
 * mudar. É o lugar da regra nova do BTG quando aparecer, com teste que falha
 * antes e passa depois. Regra que outro cliente também pedir sobe para o modelo.
 */
export const btg: OperationPack = {
  key: "btg",
  label: "BTG Pactual",
  template: "uniformes",
  customers: ["BTG Pactual"],
  summary: "Sobre Uniformes e materiais. Hoje é só o que já existe; regra própria do BTG entra aqui.",
  file: "lib/operations/packs/btg.ts",
};
