/**
 * As correções de código do cliente feitas por esta ferramenta, uma por
 * produto que entrou pelo Receber com o código errado. O motor está em
 * `corrigir.mjs`; o roteiro, no README desta pasta.
 *
 * O `id` de cada correção é fixo: é ele que dá o recibo
 * (`operational_operations`), então rodar de novo não repete nada.
 *
 * `nome`: "familia" dá ao produto o nome da família do código novo (o mais
 * comum entre os tamanhos ativos dela, como a padronização de 06/11); sem
 * família, o nome de hoje com o gênero de `genero` no lugar do outro. Um texto
 * é o nome exato.
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
      "Leonardo, 11/11/2026: trocar o código no mesmo SKU, só o M da CX-000229, com o nome da família masculina, e corrigir a linha da NF.",
  },
];
