/**
 * Plano do acerto único do estoque da BTG (29 e 30/10/2026).
 *
 * Origem: e-mail da Cristiane Penteado (BTG), "RE: Saldão PAN/BTG- Dutelog",
 * 29/10/2026 11:40, com 14 pontos, e a conferência física do Guilherme Dantas
 * em 29/10/2026 ("Correções BTG - Cris 29/10/2026"). O que foi contado errado
 * na abertura de outubro se corrige aqui, uma vez, pelo banco. O motor está em
 * `acerto.mjs`; este arquivo é só a lista do que gravar.
 *
 * Cada operação tem um `id` fixo: é ele que dá a chave de idempotência, então
 * rodar duas vezes não repete nada. `pendente` deixa a operação listada no
 * dry-run e fora da aplicação até a dúvida ser resolvida; para ligar, apague
 * o campo.
 *
 * Posição (`posicao`, `posicao_entrada`): "A-13" literal, `{ caixa: "CX-000091" }`
 * para a posição onde a caixa está guardada, `{ sku: "A.02.0808.002.G" }` para a
 * única posição com saldo desse SKU. Sem nada, o motor usa a única posição com
 * saldo do SKU de origem e reclama se houver mais de uma.
 *
 * Os códigos de cliente aqui são os gravados no cadastro, com o tamanho no fim
 * (o `--buscar` na produção em 30/10/2026 mostrou `A.01.0808.002.M` =
 * BTG-000109, `A.01.05334.005.M` = BTG-000045, `J.0562.003.N6` = BTG-000169,
 * `A.01.O719.004.P` = BTG-000087 e `A.01.0719.004.PP` = BTG-000088). O portal
 * mostra só a base, por isso o e-mail cita `A.01.0808.002` e `J.0562.003`.
 */

export const PLANO = {
  id: "acerto-btg-2026-10",
  cliente: "BTG Pactual",
  referencia: "RE: Saldão PAN/BTG- Dutelog, Cristiane Penteado 29/10/2026 11:40; conferência do Guilherme 29/10/2026",
  ator: {
    uid: "script:acerto-btg-2026-10",
    role: "admin",
    name: "Acerto BTG 29/10 (script, Leonardo)",
    email: "leonardo@dutelog.com.br",
  },
};

const ITEM = (n, detalhe) => `E-mail Cristiane 29/10, item ${n}: ${detalhe}`;

export const BLOCOS = [
  {
    id: "cadastro",
    titulo: "Cadastro: nome e fotos da polo azul-marinho",
    ops: [
      // Só o PP estava como feminina na produção; os outros seis já eram "MASCULINO".
      ...["PP", "P", "M", "G", "GG", "XG", "XGG"].map((tam) => ({
        id: `renomear-0805-${tam}`,
        tipo: "renomear",
        codigo: `A.01.0805.002.${tam}`,
        nome: `POLO MASCULINO PIQUET AZUL MARINHO ${tam}`,
        genero: "Masculino",
        motivo: ITEM(1, "A.01.0805.002 é a polo masculina, não feminina"),
      })),
      {
        id: "renomear-0809-masc-M",
        tipo: "renomear",
        codigo: "A.01.0809.002.M",
        nome: "POLO MASCULINO PIQUET ARPOADOR M",
        motivo: ITEM(5, "nome com erro de digitação, ARPOARDOR"),
      },
      {
        id: "fotos-0805",
        tipo: "trocar_fotos",
        familia_a: "A.01.0805.002.",
        familia_b: "A.02.0805.002.",
        motivo: ITEM(1, "fotos da masculina e da feminina estão trocadas"),
      },
    ],
  },
  {
    id: "skus-novos",
    titulo: "SKUs que não existem no cadastro",
    ops: [
      {
        id: "criar-0809-fem-M",
        tipo: "criar_sku",
        codigo: "A.02.0809.002.M",
        copiar_de: "A.02.0809.002.P",
        tamanho: "M",
        motivo: ITEM(4, "75 polos femininas arpoador M estavam lançadas como masculinas"),
      },
      {
        id: "criar-0808-fem-M",
        tipo: "criar_sku",
        codigo: "A.02.0808.002.M",
        copiar_de: "A.02.0808.002.P",
        tamanho: "M",
        motivo: ITEM(7, "polo feminina mescla preto M estava com código A.01.0808.002"),
      },
      {
        id: "criar-sacola-N6",
        tipo: "criar_sku",
        codigo: "J.0149.003.N6",
        copiar_de: "J.0149.003.N1",
        tamanho: "N6",
        manter_nome: true,
        motivo: ITEM(2, "a sacola grande N6 tem a mesma base das outras; J.0562.003.N6 é erro de cadastro"),
      },
      {
        id: "criar-0534-M",
        tipo: "criar_sku",
        codigo: "A.01.0534.005.M",
        copiar_de: "A.01.05334.005.M",
        tamanho: "M",
        motivo: ITEM(11, "código correto do tricot M; se já existir no cadastro, nada a fazer"),
      },
      {
        id: "criar-0605-P",
        tipo: "criar_sku",
        codigo: "A.01.0605.003.P",
        copiar_de: "A.01.O719.004.P",
        tamanho: "P",
        motivo: ITEM(12, "código lido na peça pelo Guilherme"),
        pendente: "Guilherme confirma o código A.01.0605.003.P e se o PP de 9 peças (A.01.0719.004.PP, BTG-000088) é o mesmo caso",
      },
      {
        id: "criar-0813-GG",
        tipo: "criar_sku",
        codigo: "A.02.0813.005.GG",
        copiar_de: "A.02.0813.005.G",
        tamanho: "GG",
        motivo: ITEM(13, "25 polos pima preto GG lançadas como azul A.02.0814.002"),
        pendente: "Guilherme reconta a azul A.02.0814.002 GG e XG depois de separar as pretas",
      },
      {
        id: "criar-0813-XG",
        tipo: "criar_sku",
        codigo: "A.02.0813.005.XG",
        copiar_de: "A.02.0813.005.G",
        tamanho: "XG",
        motivo: ITEM(13, "15 polos pima preto XG lançadas como azul A.02.0814.002"),
        pendente: "Guilherme reconta a azul A.02.0814.002 GG e XG depois de separar as pretas",
      },
    ],
  },
  {
    id: "transferencias",
    titulo: "Saldo que está no SKU errado",
    ops: [
      {
        id: "transf-0809-M-cx91",
        tipo: "transferir",
        de: "A.01.0809.002.M",
        para: "A.02.0809.002.M",
        qtde: 50,
        posicao: { caixa: "CX-000091" },
        motivo: ITEM(5, "CX-000091 tem 50 polos femininas M"),
      },
      {
        id: "transf-0809-M-cx92",
        tipo: "transferir",
        de: "A.01.0809.002.M",
        para: "A.02.0809.002.M",
        qtde: 25,
        posicao: { caixa: "CX-000092" },
        motivo: ITEM(5, "CX-000092 tem 25 polos femininas M"),
      },
      {
        id: "transf-oceano-G",
        tipo: "transferir",
        de: "BTG-000165",
        para: "A.01.0811.002.G",
        qtde: "tudo",
        posicao: { caixa: "CX-000198" },
        motivo: ITEM(6, "CX-000198 lacrada, mesmo código das outras, A.01.0811.002.G"),
      },
      // No cadastro o código errado é "A.01.0808.002.M" (BTG-000109); o e-mail cita a base A.01.0808.002.
      {
        id: "transf-0808-M",
        tipo: "transferir",
        de: "A.01.0808.002.M",
        para: "A.02.0808.002.M",
        qtde: 54,
        posicao: { caixa: "CX-000150" },
        motivo: ITEM(7, "CX-000150 tem 54 polos femininas M com o código errado"),
      },
      {
        id: "transf-0808-G",
        tipo: "transferir",
        de: "A.01.0808.002.M",
        para: "A.02.0808.002.G",
        qtde: 4,
        posicao: { caixa: "CX-000150" },
        posicao_entrada: { sku: "A.02.0808.002.G" },
        motivo: ITEM(7, "4 polos femininas G estavam na CX-000150 com o código errado"),
      },
      {
        id: "transf-tricot",
        tipo: "transferir",
        de: "A.01.05334.005.M",
        para: "A.01.0534.005.M",
        qtde: "tudo",
        motivo: ITEM(11, "código com um 3 a mais; correto A.01.0534.005"),
      },
      {
        id: "transf-sacola-N6",
        tipo: "transferir",
        de: "J.0562.003.N6",
        para: "J.0149.003.N6",
        qtde: "tudo",
        motivo: ITEM(2, "sacola N6 com base de código errada"),
      },
      {
        id: "transf-0719-P",
        tipo: "transferir",
        de: "A.01.O719.004.P",
        para: "A.01.0605.003.P",
        qtde: "tudo",
        motivo: ITEM(12, "código com letra O e número errado; correto A.01.0605.003.P"),
        pendente: "Guilherme confirma o código A.01.0605.003.P",
      },
      {
        id: "transf-0813-GG",
        tipo: "transferir",
        de: "A.02.0814.002.GG",
        para: "A.02.0813.005.GG",
        qtde: 25,
        posicao: { caixa: "CX-000180" },
        motivo: ITEM(13, "CX-000180 tem 25 polos pima preto GG lançadas como azul"),
        pendente: "Guilherme reconta a azul A.02.0814.002 GG",
      },
      {
        id: "transf-0813-XG",
        tipo: "transferir",
        de: "A.02.0814.002.XG",
        para: "A.02.0813.005.XG",
        qtde: 15,
        posicao: { caixa: "CX-000180" },
        motivo: ITEM(13, "CX-000180 tem 15 polos pima preto XG lançadas como azul"),
        pendente: "Guilherme reconta a azul A.02.0814.002 XG",
      },
    ],
  },
  {
    id: "quantidades",
    titulo: "Diferenças de contagem do Guilherme",
    ops: [
      { id: "aj-0809-P", tipo: "ajuste", codigo: "A.02.0809.002.P", delta: -4, posicao: "A-10", motivo: ITEM(4, "CX-000076 tem 66 polos P, não 70") },
      { id: "aj-0809-G", tipo: "ajuste", codigo: "A.02.0809.002.G", delta: 1, posicao: "A-10", motivo: ITEM(4, "CX-000079 tem 57 polos G, não 56") },
      { id: "aj-0809-GG", tipo: "ajuste", codigo: "A.02.0809.002.GG", delta: 1, posicao: "A-11", motivo: ITEM(4, "CX-000083 tem 19 polos GG, não 18") },
      { id: "aj-0809-masc-M", tipo: "ajuste", codigo: "A.01.0809.002.M", delta: -2, posicao: { caixa: "CX-000090" }, motivo: ITEM(5, "CX-000090 tem 42 polos masculinas M, não 44") },
      // O Guilherme contou 58 na CX-000150 (54 M + 4 G), que as transferências acima tiram do código errado.
      // O que o sistema tiver além disso não existe no físico: "zerar" tira o que sobrar depois delas (0 se o sistema tinha 58).
      { id: "aj-0808-sobra", tipo: "ajuste", codigo: "A.01.0808.002.M", delta: "zerar", posicao: { caixa: "CX-000150" }, motivo: ITEM(7, "CX-000150 tem 58 peças (54 M + 4 G); o que o sistema tiver a mais não existe") },
      { id: "aj-jaqueta-dup", tipo: "ajuste", codigo: "A.01.0798.002.P", delta: -12, posicao: { caixa: "CX-000019" }, motivo: ITEM(9, "CX-000019 é leitura duplicada da CX-000018; só há 12 jaquetas P") },
      {
        id: "aj-0805-por-tamanho",
        tipo: "nota",
        motivo: ITEM(14, "a polo A.01.0805.002 por tamanho entra aqui quando o Guilherme contar"),
        pendente: "contagem física da A.01.0805.002 por tamanho e posição",
      },
      {
        id: "aj-sacola-N6-contagem",
        tipo: "nota",
        motivo: ITEM(3, "o Guilherme contou 73 numa caixa da sacola N6 contra 72; o sistema mostra 147"),
        pendente: "Guilherme confirma se a N6 tem 147 ou 148 no total",
      },
    ],
  },
  {
    id: "saldao",
    titulo: "Saldão: sai do sistema, controle na planilha",
    ops: [
      { id: "saldao-cx5", tipo: "baixar_caixa", caixa: "CX-000005", motivo: ITEM(8, "conteúdo passou para as caixas de saldão, fora do sistema") },
      { id: "saldao-cx32", tipo: "baixar_caixa", caixa: "CX-000032", motivo: ITEM(8, "conteúdo passou para as caixas de saldão, fora do sistema") },
      { id: "saldao-cx130", tipo: "baixar_caixa", caixa: "CX-000130", motivo: ITEM(10, "caixa inteira passou para o saldão") },
      {
        id: "saldao-cx4",
        tipo: "saida",
        codigo: null,
        qtde: null,
        posicao: { caixa: "CX-000004" },
        motivo: ITEM(10, "polos retiradas da CX-000004 para o saldão"),
        pendente: "Guilherme informa qual SKU e quantas peças saíram da CX-000004",
      },
    ],
  },
  {
    id: "caixas",
    titulo: "Caixas e linhas da abertura, para o Mapa e as Etiquetas",
    ops: [
      { id: "cx-remover-5", tipo: "remover_caixa", caixa: "CX-000005", se_apoia: "esvaziar", motivo: ITEM(8, "caixa vazia, conteúdo no saldão; fica como apoio da CX-000033") },
      { id: "cx-remover-32", tipo: "remover_caixa", caixa: "CX-000032", motivo: ITEM(8, "caixa vazia, conteúdo no saldão") },
      { id: "cx-remover-130", tipo: "remover_caixa", caixa: "CX-000130", motivo: ITEM(10, "caixa inteira no saldão") },
      {
        id: "cx-remover-19",
        tipo: "remover_caixa",
        caixa: "CX-000019",
        transferir_apoio_para: "CX-000018",
        motivo: ITEM(9, "leitura duplicada da CX-000018; a CX-000036 passa a apoiar na CX-000018"),
        pendente: "Guilherme confirma que a CX-000036 está em cima da CX-000018",
      },
      { id: "cx-linha-91", tipo: "corrigir_linha", caixa: "CX-000091", de: "A.01.0809.002.M", para: "A.02.0809.002.M", qtde: 50, motivo: ITEM(5, "CX-000091: 50 femininas M") },
      { id: "cx-linha-92", tipo: "corrigir_linha", caixa: "CX-000092", de: "A.01.0809.002.M", para: "A.02.0809.002.M", qtde: 25, motivo: ITEM(5, "CX-000092: 25 femininas M") },
      { id: "cx-linha-90", tipo: "ajustar_linha", caixa: "CX-000090", codigo: "A.01.0809.002.M", qtde: 42, motivo: ITEM(5, "CX-000090 tem 42") },
      { id: "cx-linha-76", tipo: "ajustar_linha", caixa: "CX-000076", codigo: "A.02.0809.002.P", qtde: 66, motivo: ITEM(4, "CX-000076 tem 66") },
      { id: "cx-linha-79", tipo: "ajustar_linha", caixa: "CX-000079", codigo: "A.02.0809.002.G", qtde: 57, motivo: ITEM(4, "CX-000079 tem 57") },
      { id: "cx-linha-83", tipo: "ajustar_linha", caixa: "CX-000083", codigo: "A.02.0809.002.GG", qtde: 19, motivo: ITEM(4, "CX-000083 tem 19") },
      { id: "cx-linha-198", tipo: "corrigir_linha", caixa: "CX-000198", de: "BTG-000165", para: "A.01.0811.002.G", motivo: ITEM(6, "CX-000198 é A.01.0811.002.G") },
      { id: "cx-linha-150", tipo: "corrigir_linha", caixa: "CX-000150", de: "A.01.0808.002.M", para: "A.02.0808.002.M", qtde: 54, motivo: ITEM(7, "CX-000150: 54 femininas M") },
      { id: "cx-linha-0808-G", tipo: "ajustar_linha", codigo: "A.02.0808.002.G", delta: 4, motivo: ITEM(7, "4 femininas G juntadas à caixa do mesmo modelo e tamanho") },
      { id: "cx-linha-tricot", tipo: "corrigir_linha", de: "A.01.05334.005.M", para: "A.01.0534.005.M", motivo: ITEM(11, "código com um 3 a mais") },
      // Sem caixa: corrige as linhas das duas caixas da sacola N6 (147 no total), cada uma com a própria quantidade.
      { id: "cx-linha-sacola", tipo: "corrigir_linha", de: "J.0562.003.N6", para: "J.0149.003.N6", motivo: ITEM(2, "sacola N6, nas duas caixas") },
      { id: "cx-linha-0719", tipo: "corrigir_linha", de: "A.01.O719.004.P", para: "A.01.0605.003.P", motivo: ITEM(12, "código lido na peça"), pendente: "Guilherme confirma o código A.01.0605.003.P" },
      { id: "cx-linha-180-GG", tipo: "corrigir_linha", caixa: "CX-000180", de: "A.02.0814.002.GG", para: "A.02.0813.005.GG", qtde: 25, motivo: ITEM(13, "CX-000180: 25 pretas GG"), pendente: "Guilherme reconta a azul A.02.0814.002" },
      { id: "cx-linha-180-XG", tipo: "corrigir_linha", caixa: "CX-000180", de: "A.02.0814.002.XG", para: "A.02.0813.005.XG", qtde: 15, motivo: ITEM(13, "CX-000180: 15 pretas XG"), pendente: "Guilherme reconta a azul A.02.0814.002" },
      { id: "cx-linha-4", tipo: "ajustar_linha", caixa: "CX-000004", codigo: null, qtde: null, motivo: ITEM(10, "o que sobrou na CX-000004"), pendente: "Guilherme informa qual SKU e quantas peças saíram da CX-000004" },
    ],
  },
  {
    id: "arquivar",
    titulo: "SKUs errados, esvaziados",
    ops: [
      { id: "arq-oceano", tipo: "arquivar", codigo: "BTG-000165", motivo: ITEM(6, "SKU solto da polo oceano G") },
      { id: "arq-0808", tipo: "arquivar", codigo: "A.01.0808.002.M", motivo: ITEM(7, "código errado da polo feminina mescla preto M") },
      { id: "arq-tricot", tipo: "arquivar", codigo: "A.01.05334.005.M", motivo: ITEM(11, "código com um 3 a mais") },
      { id: "arq-sacola", tipo: "arquivar", codigo: "J.0562.003.N6", motivo: ITEM(2, "base de código errada da sacola N6") },
      { id: "arq-0719", tipo: "arquivar", codigo: "A.01.O719.004.P", motivo: ITEM(12, "código com letra O"), pendente: "Guilherme confirma o código A.01.0605.003.P" },
    ],
  },
];
