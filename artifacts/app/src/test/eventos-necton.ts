import type { TipoDeMomento } from "@workspace/dominio";

import type { ProdutoDoEstoque } from "@/lib/eventos/itens";
import type { EdicaoView, FeitoDoMomentoView, ItemView, MomentoView } from "@/lib/eventos/tipos";

/**
 * A edição da B2B Conference Necton como dado dos testes do portal dos
 * Eventos (docs/mockups/EventosPortalNovo.dc.html e EventosPortalItens.dc.html):
 * sete momentos, todos com hora, 100 itens em 40 famílias (2.000 peças, Polo
 * 28, Camiseta 22, Brindes 31, Móveis 19), a coleta de 2.190 produtos e os
 * produtos do Estoque que dão R$ 86.400,00 em peças. Dados sintéticos.
 */

type Previsto = Partial<MomentoView["previsto"]> & { data: string };

let proximoId = 1;

/** Um momento lido, com o id `mo_` + 8 hex. */
export function momento(tipo: TipoDeMomento, previsto: Previsto, extra: Partial<MomentoView> = {}): MomentoView {
  const id = extra.id ?? `mo_${(proximoId++).toString(16).padStart(8, "0")}`;
  return {
    id,
    tipo,
    rotulo: null,
    previsto: { hora: null, ate: null, local: null, observacao: null, ...previsto },
    feito: null,
    ...extra,
  };
}

/** O registro de um momento feito (o instante em ISO, UTC). */
export function feito(inicio: string, fim: string | null = null): FeitoDoMomentoView {
  return { inicio, fim, observacao: null, origem: "registro", registrado_por: null, registrado_em: null, corrigido_em: null };
}

type Familia = { nome: string; codigo: string; categoria: string; tamanhos: Array<[string | null, number]>; reaisPorPeca: number };

const PRIMEIRAS: Familia[] = [
  { nome: "Polo Masculino Piquet Arpoador", codigo: "A.01.0809.002", categoria: "Polo", tamanhos: [["P", 120], ["M", 300], ["G", 200], ["GG", 80]], reaisPorPeca: 40 },
  { nome: "Polo Feminina Piquet Azul Marinho", codigo: "A.01.0805.002", categoria: "Polo", tamanhos: [["P", 90], ["M", 220], ["G", 140]], reaisPorPeca: 40 },
  { nome: "Camiseta Feminina Piquet Preto", codigo: "A.02.0311.006", categoria: "Camiseta", tamanhos: [["P", 40], ["M", 60], ["G", 40]], reaisPorPeca: 30 },
  { nome: "Sacola Quadrada BTG", codigo: "J.0149.003", categoria: "Brindes", tamanhos: [["N1", 300]], reaisPorPeca: 20 },
  { nome: "Balcão de Recepção", codigo: "MAT-021", categoria: "Móveis", tamanhos: [[null, 1]], reaisPorPeca: 5000 },
  { nome: "Caneca Necton", codigo: "B.0412.001", categoria: "Brindes", tamanhos: [["U", 150]], reaisPorPeca: 30 },
  { nome: "Toalha de Academia", codigo: "C.0659.001", categoria: "Brindes", tamanhos: [["U", 100]], reaisPorPeca: 25 },
  { nome: "Poltrona Lounge Preta", codigo: "MAT-034", categoria: "Móveis", tamanhos: [[null, 4]], reaisPorPeca: 4550 },
  { nome: "Mesa Bistrô Branca", codigo: "MAT-040", categoria: "Móveis", tamanhos: [[null, 2]], reaisPorPeca: 0 },
];

/** As 31 famílias seguintes: 22 de três tamanhos e 9 de dois, sem valor, com 153 peças. */
function familiasSeguintes(): Familia[] {
  const grupos: Array<{ categoria: string; nome: string; prefixo: string; de3: number; de2: number }> = [
    { categoria: "Polo", nome: "Polo Masculino Piquet Cor", prefixo: "A.01.09", de3: 7, de2: 0 },
    { categoria: "Camiseta", nome: "Camiseta Masculina Básica", prefixo: "A.02.04", de3: 5, de2: 2 },
    { categoria: "Brindes", nome: "Caderno Necton Modelo", prefixo: "D.05.", de3: 8, de2: 2 },
    { categoria: "Móveis", nome: "Pufe Redondo Modelo", prefixo: "M.07.", de3: 2, de2: 5 },
  ];
  const familias: Familia[] = [];
  for (const grupo of grupos) {
    for (let n = 0; n < grupo.de3 + grupo.de2; n += 1) {
      const sufixo = String(n + 1).padStart(2, "0");
      familias.push({
        nome: `${grupo.nome} ${sufixo}`,
        codigo: `${grupo.prefixo}${sufixo}.001`,
        categoria: grupo.categoria,
        tamanhos: n < grupo.de3 ? [["P", 0], ["M", 0], ["G", 0]] : [["P", 0], ["M", 0]],
        reaisPorPeca: 0,
      });
    }
  }
  // As 84 linhas levam 153 peças: 69 com duas e 15 com uma.
  let linha = 0;
  for (const familia of familias) {
    familia.tamanhos = familia.tamanhos.map(([tamanho]) => [tamanho, linha++ < 69 ? 2 : 1]);
  }
  return familias;
}

/** O código do cliente de um tamanho: a família e a variação ("A.01.0809.002.GG"); sem variação, o código da família. */
function codigoDoTamanho(familia: Familia, tamanho: string | null): string {
  return tamanho === null ? familia.codigo : `${familia.codigo}.${tamanho}`;
}

type Linha = { item: ItemView; reaisPorPeca: number };

function linhasDaNecton(): Linha[] {
  let sku = 1;
  return [...PRIMEIRAS, ...familiasSeguintes()].flatMap((familia) =>
    familia.tamanhos.map(([tamanho, quantidade]) => ({
      reaisPorPeca: familia.reaisPorPeca,
      item: {
        sku_code: `BTG-${String(sku++).padStart(6, "0")}`,
        client_item_code: codigoDoTamanho(familia, tamanho),
        product_name: familia.nome,
        size: tamanho === null || tamanho === "U" ? null : tamanho,
        category: familia.categoria,
        quantity: quantidade,
        foi: null,
        voltou: null,
        avariadas: null,
        nao_voltaram: null,
        observacao: null,
      },
    })),
  );
}

export const OBSERVACOES_DA_NECTON = [
  "Separação dos móveis que estão no estoque Dutelog.",
  "Coleta dos produtos que vão ser separados no BTG no dia anterior ou no próprio dia 28/01 às 05:00.",
  "Montagem do evento: 2 estoquistas e 2 pessoas do cliente, das 10:00 às 19:00.",
  "Trabalho no evento: 2 estoquistas e 2 pessoas do cliente, das 08:00 às 20:00.",
  "Coleta dos produtos no evento no dia 29/01 às 20:00, contagem no estoque Dutelog e entrega do que voltou no BTG.",
].join("\n");

/** O cronograma da Necton, com os ids fixos `mo_00000001` a `mo_00000007`. */
export function cronogramaDaNecton(): MomentoView[] {
  const equipe = "2 estoquistas Dutelog e 2 pessoas do cliente";
  return [
    momento("coleta_no_cliente", { data: "2027-01-28", hora: "05:00", observacao: "Produtos separados no BTG, Faria Lima" }, { id: "mo_00000001" }),
    momento("entrega_no_local", { data: "2027-01-28", hora: "08:30", observacao: "Doca do hotel" }, { id: "mo_00000002" }),
    momento("montagem", { data: "2027-01-28", hora: "10:00", ate: "19:00", observacao: equipe }, { id: "mo_00000003" }),
    momento("evento", { data: "2027-01-29", hora: "08:00", ate: "20:00", observacao: equipe }, { id: "mo_00000004" }),
    momento("desmontagem", { data: "2027-01-29", hora: "20:00" }, { id: "mo_00000005" }),
    momento("retorno_ao_estoque", { data: "2027-01-30", hora: "09:00", observacao: "Contagem do que voltou" }, { id: "mo_00000006" }),
    momento("entrega_de_volta", { data: "2027-02-02", hora: "10:00", observacao: "Produtos que voltaram do evento" }, { id: "mo_00000007" }),
  ];
}

/** Uma edição lida, com os campos da leitura; o resto vem de `extra`. */
export function edicao(extra: Partial<EdicaoView> = {}): EdicaoView {
  const itens = extra.itens ?? [];
  return {
    id: "ced_0000000000000001",
    customer_code: "BTG",
    event_id: "cve_0000000000000001",
    event_name: "Evento",
    label: null,
    status: "rascunho",
    edicao: 1,
    origem_edicao_id: null,
    onde: { local: null, endereco: null, contato: { nome: null, telefone: null } },
    cronograma: [],
    itens,
    itens_total: itens.length,
    pecas_total: itens.reduce((soma, item) => soma + item.quantity, 0),
    coleta: { onde: null, quantidade: 0, voltou: null, distribuidos: null },
    observacoes: null,
    observacoes_dutelog: null,
    documentos: [],
    fotos: [],
    equipe: { estoquistas: null, do_cliente: null, veiculo: null, contato_no_local: null },
    separar_ate: null,
    pedido: null,
    retorno: null,
    enviada_em: null,
    confirmada_em: null,
    fechada_em: null,
    cancelada_em: null,
    cancelada_por: null,
    cancelamento_motivo: null,
    created_by: null,
    created_at: null,
    updated_by: null,
    updated_at: null,
    ...extra,
  };
}

/** O rascunho da Necton, como a leitura o entrega. */
export function edicaoDaNecton(extra: Partial<EdicaoView> = {}): EdicaoView {
  const itens = linhasDaNecton().map((linha) => linha.item);
  return edicao({
    id: "ced_0123456789abcdef",
    event_id: "cve_0123456789abcdef",
    event_name: "B2B Conference Necton",
    label: "2027",
    status: "rascunho",
    edicao: 3,
    onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700", contato: { nome: "Cristiane", telefone: null } },
    cronograma: cronogramaDaNecton(),
    itens,
    coleta: { onde: "BTG Pactual · Av. Brigadeiro Faria Lima, 3477", quantidade: 2190, voltou: null, distribuidos: null },
    observacoes: OBSERVACOES_DA_NECTON,
    updated_at: "2026-11-27T17:32:00.000Z",
    ...extra,
  });
}

/** Os produtos do Estoque da Necton: cada SKU com 100 livres além do que vai, e o valor que dá R$ 86.400,00 em peças. */
export function produtosDaNecton(): ProdutoDoEstoque[] {
  return linhasDaNecton().map(({ item, reaisPorPeca }) => {
    const total = item.quantity + 100;
    return {
      sku: item.sku_code,
      clientItemCode: item.client_item_code,
      total,
      available: total,
      value: reaisPorPeca * total,
      photoUrl: null,
    };
  });
}
