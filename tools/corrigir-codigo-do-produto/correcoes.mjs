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
 *
 * O tamanho errado (o XGG lançado no lugar do XG, 16/11/2026) só se corrige
 * pela transferência: as peças vão para o SKU que já tem o código certo, com
 * o tamanho dele. No mesmo SKU, o tamanho não muda, e a correção recusa.
 *
 * `pendente` (o motivo) deixa a correção no dry-run, com o estado de hoje,
 * e fora da gravação, mesmo com --aplicar. Para ligar, apague o campo.
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
  // A CX-000227 não entra aqui: a leitura de 16/11 mostrou que a chegada dela (AVL-B1FE59A8) repetiu a AVL-0D0E620B,
  // e as 41 XG já estavam no saldo. A correção dela é a do acerto (tools/acerto-btg-2026-10, bloco duplicada-0611).
  {
    id: "cx-000221-a02-0806-005-xg",
    cliente: "BTG Pactual",
    de: "A.02.0806.005.XGG",
    para: "A.02.0806.005.XG",
    caixas: ["CX-000221"],
    genero: "Feminino",
    referencia: "Leonardo, 16/11/2026: correções da separação do PED-0001",
    motivo:
      "Na separação do PED-0001, a linha da polo feminina piquet preta XGG (BTG-000186) apontou 12 peças na CX-000221; o tamanho dentro da caixa é XG (A.02.0806.005.XG).",
    decisao:
      "Leonardo, 16/11/2026: corrigir no sistema. A leitura de 16/11 mostrou o BTG-000186 só com as 12 da CX-000221 e o A.02.0806.005.XG fora do cadastro: o acerto cria o XG (bloco feminina-xg), e as 12 passam para ele. O BTG-000186 sai depois da entrega do PED-0001.",
  },
];
