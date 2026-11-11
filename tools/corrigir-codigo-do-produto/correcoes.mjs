/**
 * As correções de código do cliente feitas por esta ferramenta, uma por
 * produto que entrou pelo Receber com o código errado. O motor está em
 * `corrigir.mjs` (e `transferir.mjs`); o roteiro, no README desta pasta.
 *
 * O `id` de cada correção é fixo: é ele que dá os recibos
 * (`operational_operations`) e as chaves dos movimentos, então rodar de novo
 * não repete nada.
 *
 * `nome` só vale no caminho no mesmo SKU (o código certo livre): "familia" dá
 * ao produto o nome da família do código novo (o mais comum entre os tamanhos
 * ativos dela, como a padronização de 06/11); sem família, o nome de hoje com
 * o gênero de `genero` no lugar do outro. Um texto é o nome exato. Na
 * transferência, o produto certo fica com o nome que tem.
 */

export const ATOR = {
  uid: "script:corrigir-codigo-do-produto",
  role: "admin",
  name: "Correção de código do produto (script, Leonardo)",
  email: "leonardo@dutelog.com.br",
};

export const CORRECOES = [
  {
    id: "cx-000229-a01-0810-002-m",
    cliente: "BTG Pactual",
    de: "A.02.0810.002.M",
    para: "A.01.0810.002.M",
    caixas: ["CX-000229"],
    genero: "Masculino",
    nome: "familia",
    referencia: 'E-mail do Guilherme Dantas de 10/11/2026, "CX-000229 - Correção no Sistema"',
    motivo:
      "Na segunda conferência da CX-000229, o código anotado A.02.0810.002.M é o da polo feminina; a peça e a NF são a polo masculina A.01.0810.002.M.",
    decisao:
      "Leonardo, 11/11/2026: só as 92 peças da CX-000229, com a linha da NF corrigida. O A.01.0810.002.M já existe (BTG-000219): as peças passam para ele. O A.02.0810.002.M (BTG-000213) fica: é a feminina de verdade, com as 79 da CX-000228, da outra chegada da mesma NF 046315.",
  },
];
