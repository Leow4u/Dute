/**
 * O preço da armazenagem pela tabela do Comercial (parte 7.3a,
 * docs/plataforma/fase-7-financeiro-unificado.md).
 *
 * - O item da LPU de cobrança do WMS (`billing_price_list`) continua dizendo
 *   como a linha se calcula: a fonte automática, o grupo e a ordem.
 * - O item ligado ao catálogo do Comercial (`lpu_item_id`) tira o preço da
 *   tabela do cliente (`price_tables`) vigente no último dia da competência.
 *   A tabela é imutável e o preço é texto decimal exato, então o mês fechado
 *   tem o mesmo preço antes e depois da emissão.
 * - Sem a tabela com o item, ou com duas tabelas do cliente valendo para o
 *   item no mesmo dia, a conta recusa: preço de dinheiro nunca se adivinha.
 * - O item sem ligação segue com o `valor_unit` do WMS. O ad valorem segue com
 *   a taxa do `billing_config`, ligado ou não.
 */

/** Cópia literal de PRICE_TABLES_COLLECTION (functions/comercial/src/domain/tabelas.ts); trava em billing-price-tables.test.ts. */
export const COMERCIAL_PRICE_TABLES = "price_tables";

type Registro = Record<string, unknown>;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O último dia da competência ("2026-09" → "2026-09-30"). */
export function dataBaseDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, "0")}`;
}

export type TabelaDoComercial = {
  id: string;
  vigente_de: string;
  vigente_ate: string | null;
  /** O preço de cada item do catálogo, em texto decimal com ponto. */
  precos: ReadonlyMap<string, string>;
};

/** A tabela como o WMS lê de `price_tables`; null sem vigência legível. */
export function tabelaDoComercialLida(id: string, dados: Registro): TabelaDoComercial | null {
  const de = typeof dados.vigente_de === "string" && DATA.test(dados.vigente_de) ? dados.vigente_de : null;
  const ate = typeof dados.vigente_ate === "string" && DATA.test(dados.vigente_ate) ? dados.vigente_ate : null;
  if (!de) return null;
  const precos = new Map<string, string>();
  const brutos = dados.precos && typeof dados.precos === "object" ? (dados.precos as Registro) : {};
  for (const [lpuItemId, valor] of Object.entries(brutos)) {
    const preco = valor && typeof valor === "object" ? (valor as Registro).preco : undefined;
    if (typeof preco === "string" && /^\d+(?:\.\d+)?$/.test(preco)) precos.set(lpuItemId, preco);
  }
  return { id, vigente_de: de, vigente_ate: ate, precos };
}

export type PrecoNaTabela =
  | { tipo: "preco"; preco: string; tabela_id: string }
  | { tipo: "sem_preco" }
  | { tipo: "ambiguo"; tabela_ids: string[] };

/** O preço do item nas tabelas do cliente vigentes na data-base. */
export function precoNaTabela(tabelas: readonly TabelaDoComercial[], lpuItemId: string, dataBase: string): PrecoNaTabela {
  const vigentes = tabelas.filter(
    (tabela) => tabela.vigente_de <= dataBase && (tabela.vigente_ate === null || dataBase <= tabela.vigente_ate) && tabela.precos.has(lpuItemId),
  );
  if (vigentes.length === 0) return { tipo: "sem_preco" };
  if (vigentes.length > 1) return { tipo: "ambiguo", tabela_ids: vigentes.map((tabela) => tabela.id).sort() };
  return { tipo: "preco", preco: vigentes[0].precos.get(lpuItemId) as string, tabela_id: vigentes[0].id };
}

/** "30/09/2026". */
export function dataBr(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}
