import { centavosDaLinha } from "./dinheiro.js";
import { digest } from "./operations.js";

/**
 * Tabelas de preço do Comercial: `price_tables/{id}`
 * (docs/plataforma/fase-6-comercial.md, "Tabelas"; cargas em
 * docs/plataforma/comercial-cargas.md).
 *
 * - A tabela é imutável e guarda os preços num documento só:
 *   `precos: { lpu_item_id: { codigo, descricao_cliente, preco } }`, com o
 *   preço em texto decimal exato (até 4 casas, a conta é dinheiro.ts).
 * - É de um cliente (`customer_code`), opcionalmente de um contrato
 *   (`contract_id`), e de uma variante de texto livre ("Comercial",
 *   "Noturna"...). Sem cliente é a Padrão Dutelog, que nunca tem contrato.
 * - Duas tabelas da mesma identidade (cliente, contrato e variante
 *   normalizada) nunca têm vigência sobreposta. A carga de uma tabela nova
 *   encerra a anterior na mesma escrita, na véspera do início da nova; é a
 *   única mudança que uma tabela gravada recebe.
 * - Vale a tabela cuja vigência contém a data-base do orçamento (a data do
 *   orçamento), mesmo que ela já tenha sido encerrada por outra.
 */

export const PRICE_TABLES_COLLECTION = "price_tables";
export const PRICE_TABLE_ID_PREFIX = "pt_";
export const PRICE_TABLE_SCHEMA_VERSION = 1;
export const MOEDA_DAS_TABELAS = "BRL";

export const STATUS_TABELA = ["ativa", "encerrada"] as const;
export type StatusTabela = (typeof STATUS_TABELA)[number];

export const ERROS_DE_TABELA = [
  "DATA_INVALIDA",
  "VIGENCIA_INVERTIDA",
  "VARIANTE_INVALIDA",
  "CONTRATO_SEM_CLIENTE",
  "SOBREPOSICAO",
  "MAIS_DE_UMA_ATIVA",
] as const;
export type CodigoErroTabela = (typeof ERROS_DE_TABELA)[number];

export class ErroTabela extends Error {
  readonly codigo: CodigoErroTabela;

  constructor(codigo: CodigoErroTabela, mensagem: string) {
    super(mensagem);
    this.name = "ErroTabela";
    this.codigo = codigo;
  }
}

// --- Datas --------------------------------------------------------------------

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data AAAA-MM-DD de um dia que existe. Devolve a própria data. */
export function conferirData(valor: unknown, campo = "data"): string {
  const partes = typeof valor === "string" ? DATA.exec(valor) : null;
  if (partes) {
    const [ano, mes, dia] = partes.slice(1).map(Number);
    const instante = new Date(Date.UTC(ano, mes - 1, dia));
    if (instante.getUTCFullYear() === ano && instante.getUTCMonth() === mes - 1 && instante.getUTCDate() === dia) {
      return valor as string;
    }
  }
  throw new ErroTabela("DATA_INVALIDA", `${campo}: data inválida (use AAAA-MM-DD de um dia que existe).`);
}

/** O dia anterior, em AAAA-MM-DD. */
export function vespera(data: string): string {
  const [ano, mes, dia] = conferirData(data).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia - 1)).toISOString().slice(0, 10);
}

type Periodo = { vigente_de: string; vigente_ate: string | null };

/** A data está na vigência (fim null = em aberto). Datas AAAA-MM-DD comparam como texto. */
export function vigenciaContem(periodo: Periodo, data: string): boolean {
  return periodo.vigente_de <= data && (periodo.vigente_ate === null || data <= periodo.vigente_ate);
}

export function periodosSobrepoem(a: Periodo, b: Periodo): boolean {
  const aComecaAntesDoFimDeB = b.vigente_ate === null || a.vigente_de <= b.vigente_ate;
  const bComecaAntesDoFimDeA = a.vigente_ate === null || b.vigente_de <= a.vigente_ate;
  return aComecaAntesDoFimDeB && bComecaAntesDoFimDeA;
}

// --- Identidade -----------------------------------------------------------------

const ESPACOS = /\s+/g;
const VARIANTE_NORMALIZADA = /^[a-z]+(?:_[a-z]+)*$/;
const MAXIMO_DA_VARIANTE = 40;

/** Variante comparada e gravada no evento: sem acento, minúscula, com "_" entre as palavras. */
export function normalizarVariante(variante: string): string {
  return String(variante ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

/**
 * Variante como é mostrada ("Comercial", "Noturna", "Fim de semana"): texto
 * livre, só de letras, espaço e hífen, até 40 caracteres. Sem algarismo nem
 * símbolo, porque a forma normalizada vai no evento (que nunca leva valor).
 */
export function conferirVariante(variante: unknown): string {
  const texto = String(variante ?? "").normalize("NFC").replace(ESPACOS, " ").trim();
  if (!texto || texto.length > MAXIMO_DA_VARIANTE || !VARIANTE_NORMALIZADA.test(normalizarVariante(texto))) {
    throw new ErroTabela(
      "VARIANTE_INVALIDA",
      `Variante inválida: "${texto}". Use só letras, espaço e hífen, até ${MAXIMO_DA_VARIANTE} caracteres (ex.: Comercial, Noturna).`,
    );
  }
  return texto;
}

export type IdentidadeDaTabela = {
  /** null: Tabela Padrão Dutelog. */
  customer_code: string | null;
  /** null ou o id em `contracts`; só com cliente. */
  contract_id: string | null;
  variante: string;
};

function identidadeNormalizada(identidade: IdentidadeDaTabela) {
  const customer = identidade.customer_code === null ? null : String(identidade.customer_code).trim();
  const contract = identidade.contract_id === null ? null : String(identidade.contract_id).trim();
  if (contract !== null && customer === null) {
    throw new ErroTabela("CONTRATO_SEM_CLIENTE", "Tabela de contrato precisa do cliente; a Padrão Dutelog não tem contrato.");
  }
  return { customer_code: customer, contract_id: contract, variante: normalizarVariante(identidade.variante) };
}

/** Chave da vigência: cliente, contrato e variante normalizada. Duas tabelas da mesma chave nunca se sobrepõem. */
export function chaveDeVigencia(identidade: IdentidadeDaTabela): string {
  return `cv_${digest(identidadeNormalizada(identidade))}`;
}

/** Id da tabela: a chave de vigência e o início. */
export function priceTableId(identidade: IdentidadeDaTabela, vigenteDe: string): string {
  return `${PRICE_TABLE_ID_PREFIX}${digest({ chave: chaveDeVigencia(identidade), vigente_de: conferirData(vigenteDe, "vigente_de") })}`;
}

// --- Vigência na carga -------------------------------------------------------------

export type VigenciaDaTabela = IdentidadeDaTabela &
  Periodo & {
    id: string;
    status: StatusTabela;
  };

export type PlanoDeVigencia = {
  /** "encerrada" só para a tabela antiga carregada depois da atual (inteira antes dela). */
  status: StatusTabela;
  substitui: string | null;
  /** A tabela ativa que a nova encerra, com o fim que ela passa a ter. */
  encerrar: { id: string; vigente_ate: string } | null;
};

function mesmaChave(chave: string) {
  return (tabela: IdentidadeDaTabela) => chaveDeVigencia(tabela) === chave;
}

/**
 * Onde a tabela nova entra na vigência das que já existem com a mesma
 * identidade:
 * - começa depois da ativa: encerra a ativa na véspera (ou mantém o fim dela,
 *   se já terminou antes) e entra ativa, substituindo-a;
 * - termina antes da ativa começar: é uma tabela antiga carregada depois (a
 *   RFQ de 2021 do Itaú) e entra encerrada;
 * - qualquer outra sobreposição, inclusive com tabela já encerrada, é recusada.
 */
export function planejarVigencia(
  nova: IdentidadeDaTabela & Periodo,
  existentes: readonly VigenciaDaTabela[],
): PlanoDeVigencia {
  const vigenteDe = conferirData(nova.vigente_de, "vigente_de");
  const vigenteAte = nova.vigente_ate === null ? null : conferirData(nova.vigente_ate, "vigente_ate");
  if (vigenteAte !== null && vigenteAte < vigenteDe) {
    throw new ErroTabela("VIGENCIA_INVERTIDA", `A vigência termina (${vigenteAte}) antes de começar (${vigenteDe}).`);
  }
  const periodo = { vigente_de: vigenteDe, vigente_ate: vigenteAte };
  const mesmas = existentes.filter(mesmaChave(chaveDeVigencia(nova)));
  const ativas = mesmas.filter((tabela) => tabela.status === "ativa");
  if (ativas.length > 1) {
    throw new ErroTabela(
      "MAIS_DE_UMA_ATIVA",
      `Há ${ativas.length} tabelas ativas para o mesmo cliente, contrato e variante (${ativas.map((t) => t.id).join(", ")}).`,
    );
  }

  const anterior = ativas[0];
  let plano: PlanoDeVigencia = { status: "ativa", substitui: null, encerrar: null };
  if (anterior) {
    if (vigenteDe > anterior.vigente_de) {
      const fim =
        anterior.vigente_ate === null || anterior.vigente_ate >= vigenteDe ? vespera(vigenteDe) : anterior.vigente_ate;
      plano = { status: "ativa", substitui: anterior.id, encerrar: { id: anterior.id, vigente_ate: fim } };
    } else if (vigenteAte !== null && vigenteAte < anterior.vigente_de) {
      plano = { status: "encerrada", substitui: null, encerrar: null };
    } else {
      throw sobreposicao(periodo, anterior);
    }
  }

  for (const tabela of mesmas) {
    const efetiva =
      plano.encerrar?.id === tabela.id ? { vigente_de: tabela.vigente_de, vigente_ate: plano.encerrar.vigente_ate } : tabela;
    if (periodosSobrepoem(periodo, efetiva)) throw sobreposicao(periodo, { ...tabela, ...efetiva });
  }
  return plano;
}

function sobreposicao(nova: Periodo, existente: Periodo & { id: string }): ErroTabela {
  const fim = (periodo: Periodo) => periodo.vigente_ate ?? "em aberto";
  return new ErroTabela(
    "SOBREPOSICAO",
    `A vigência ${nova.vigente_de} a ${fim(nova)} se sobrepõe à da tabela ${existente.id} ` +
      `(${existente.vigente_de} a ${fim(existente)}), do mesmo cliente, contrato e variante.`,
  );
}

// --- Escolha da tabela no orçamento ---------------------------------------------------

export type TabelaVigente<T> = { tabela: T; origem: "cliente" | "padrao" };

function naData<T extends VigenciaDaTabela>(tabelas: readonly T[], data: string): T | null {
  const cobrem = tabelas.filter((tabela) => vigenciaContem(tabela, data));
  if (cobrem.length > 1) {
    throw new ErroTabela(
      "SOBREPOSICAO",
      `Mais de uma tabela vale em ${data} para o mesmo cliente, contrato e variante (${cobrem.map((t) => t.id).join(", ")}).`,
    );
  }
  return cobrem[0] ?? null;
}

/** O cliente tem alguma tabela nessa variante, de qualquer contrato ou sem contrato. */
function clienteTemTabela(tabelas: readonly IdentidadeDaTabela[], customerCode: string, variante: string): boolean {
  const cliente = customerCode.trim();
  const chaveDaVariante = normalizarVariante(variante);
  return tabelas.some(
    (tabela) =>
      tabela.customer_code !== null &&
      String(tabela.customer_code).trim() === cliente &&
      normalizarVariante(tabela.variante) === chaveDaVariante,
  );
}

/**
 * A tabela que vale para a data-base do orçamento: a do cliente e do contrato
 * do orçamento (ou sem contrato, quando o orçamento não tem) na variante
 * pedida, cuja vigência contém a data, ativa ou já encerrada.
 *
 * Só o cliente sem nenhuma tabela nessa variante, em contrato nenhum, cai na
 * Padrão Dutelog da mesma variante. O cliente que tem tabela nessa variante,
 * mas nenhuma que sirva para o contrato e a data do orçamento, fica sem
 * tabela (null, a linha fica livre): nunca precifica com a Padrão por engano.
 */
export function tabelaVigente<T extends VigenciaDaTabela>(
  tabelas: readonly T[],
  filtro: IdentidadeDaTabela & { data: string },
): TabelaVigente<T> | null {
  const data = conferirData(filtro.data, "data-base");
  const chave = chaveDeVigencia(filtro);
  if (filtro.customer_code !== null && clienteTemTabela(tabelas, filtro.customer_code, filtro.variante)) {
    const tabela = naData(tabelas.filter(mesmaChave(chave)), data);
    return tabela ? { tabela, origem: "cliente" } : null;
  }
  const padrao = tabelas.filter(mesmaChave(chaveDeVigencia({ customer_code: null, contract_id: null, variante: filtro.variante })));
  const tabela = naData(padrao, data);
  return tabela ? { tabela, origem: "padrao" } : null;
}

// --- Preço da linha ---------------------------------------------------------------------

export type PrecoDaTabela = { codigo: string; descricao_cliente: string; preco: string };

export type PrecoDaLinha = PrecoDaTabela & {
  tabela_id: string;
  lpu_item_id: string;
  quantidade: string;
  total_cents: number;
};

/**
 * Preço de uma linha pela tabela: código e descrição do cliente, preço
 * unitário exato e o total em centavos (quantidade × preço, arredondado na
 * linha, dinheiro.ts). null quando o item não está na tabela.
 */
export function precoDaLinha(
  tabela: { id: string; precos: Record<string, PrecoDaTabela> },
  linha: { lpu_item_id: string; quantidade: string },
): PrecoDaLinha | null {
  if (!Object.prototype.hasOwnProperty.call(tabela.precos, linha.lpu_item_id)) return null;
  const preco = tabela.precos[linha.lpu_item_id];
  return {
    tabela_id: tabela.id,
    lpu_item_id: linha.lpu_item_id,
    codigo: preco.codigo,
    descricao_cliente: preco.descricao_cliente,
    preco: preco.preco,
    quantidade: linha.quantidade,
    total_cents: centavosDaLinha(linha.quantidade, preco.preco),
  };
}
