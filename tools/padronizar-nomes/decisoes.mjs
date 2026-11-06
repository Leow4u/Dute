/**
 * As escolhas que a regra não faz sozinha, aprovadas pelo Leonardo em
 * 06/11/2026 depois do relatório na produção. O passo 3 (aplicar.mjs) grava o
 * padrão e, por cima dele, estas escolhas; sem planilha para revisar.
 */
export const DECISOES = {
  /** Fica no recibo e no evento de cada SKU. */
  referencia: "Padrão do nome do produto, decisões do Leonardo de 06/11/2026",

  /**
   * O nome que a regra propõe e o nome certo: a grafia que a família ou o
   * cadastro tem errada. A família masculina da Arpoador tem "Arpoardor" na
   * maioria dos tamanhos; a Básica empatou com "Basica".
   */
  nomes: {
    "Polo Masculino Piquet Arpoardor": "Polo Masculino Piquet Arpoador",
    "Polo Masculino Basica Preta": "Polo Masculino Básica Preta",
    "Copo Termico Thermocup": "Copo Térmico Thermocup",
    "Lancheira Grande Az": "Lancheira Grande Azul",
  },

  /**
   * O código e o nome, quando produtos diferentes ficariam com o mesmo nome:
   * os dois copos de café tinham o tamanho no nome ("- P" e "- G") e o código
   * de tamanho único.
   */
  codigos: {
    "B.0790.005.U": "Copo Café Pequeno",
    "B.0791.005.U": "Copo Café Grande",
  },
};
