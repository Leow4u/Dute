// Cópia literal de lib/dominio/src/saldo-da-caixa.ts: não edite aqui (trava em saldo-da-caixa.test.ts).
/**
 * O saldo da caixa (docs/plataforma/separacao-com-caixas.md, seção 4.3,
 * parte 3). O conteúdo de entrada da caixa não muda: o que cada separação
 * tira fica gravado na própria caixa (`taken_lines`), e o saldo é a entrada
 * menos o retirado. A linha do pedido sai da caixa mais antiga da prateleira
 * que tem o item; se ela não basta, a seguinte completa; o que as caixas não
 * cobrem sai sem caixa.
 *
 * Funções puras, sem Firestore. functions/wms guarda uma cópia literal
 * (domain/saldo-da-caixa.ts), e os dois rodam os mesmos casos de
 * saldo-da-caixa.casos.json.
 */

/** Uma linha do conteúdo da caixa: o que entrou, o que saiu ou o que resta de um SKU. */
export type LinhaDaCaixa = { sku_code: string; qty: number };

type LinhaLida = { sku_code?: unknown; qty?: unknown };

function quantidade(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function porSku(linhas: Iterable<LinhaLida>): Map<string, number> {
  const soma = new Map<string, number>();
  for (const linha of linhas) {
    const sku = typeof linha.sku_code === "string" ? linha.sku_code.trim() : "";
    const qty = quantidade(linha.qty);
    if (!sku || !qty) continue;
    soma.set(sku, (soma.get(sku) ?? 0) + qty);
  }
  return soma;
}

/** A entrada menos o retirado, por SKU: nunca negativo, sem as linhas zeradas, na ordem da entrada. */
export function saldoDaCaixa(entrada: Iterable<LinhaLida>, retirado: Iterable<LinhaLida>): LinhaDaCaixa[] {
  const saiu = porSku(retirado);
  const saldo: LinhaDaCaixa[] = [];
  for (const [sku_code, entrou] of porSku(entrada)) {
    const resta = entrou - (saiu.get(sku_code) ?? 0);
    if (resta > 0) saldo.push({ sku_code, qty: resta });
  }
  return saldo;
}

/** As unidades de um conteúdo: a soma das linhas. */
export function unidadesDaCaixa(linhas: Iterable<LinhaLida>): number {
  let soma = 0;
  for (const qty of porSku(linhas).values()) soma += qty;
  return soma;
}

/** O retirado depois de somar (ou, com `qty` negativo, devolver) um SKU: sem as linhas zeradas. */
export function retiradoCom(retirado: Iterable<LinhaLida>, sku_code: string, qty: number): LinhaDaCaixa[] {
  const soma = porSku(retirado);
  const novo = (soma.get(sku_code) ?? 0) + (Number.isFinite(qty) ? qty : 0);
  if (novo > 0) soma.set(sku_code, novo);
  else soma.delete(sku_code);
  return [...soma].map(([sku, valor]) => ({ sku_code: sku, qty: valor }));
}

/** A caixa da prateleira que tem o item da linha. */
export type CaixaComOItem = {
  code: string;
  /** Quando a caixa foi guardada: a mais antiga sai primeiro. */
  stored_at?: string | null;
  /** O que a caixa tem do item agora. */
  disponivel: number;
  /** O saldo da caixa inteira, de todos os itens. */
  saldo: number;
  /** A caixa de onde nunca saiu nada. */
  intacta: boolean;
};

/** De onde a linha sai: a caixa, quanto, e se a caixa sai inteira ou fica vazia. */
export type CaixaDaLinha = {
  box_code: string;
  qty: number;
  /** A caixa intacta que sai toda nesta linha. */
  inteira: boolean;
  /** A caixa já aberta que esta linha esvazia. */
  esvazia: boolean;
};

export type CaixasDaLinha = { caixas: CaixaDaLinha[]; sem_caixa: number };

/** A ordem de saída: a guardada há mais tempo primeiro; sem data, depois; no empate, o código. */
export function ordemDeSaida<T extends Pick<CaixaComOItem, "code" | "stored_at">>(caixas: Iterable<T>): T[] {
  return [...caixas].sort((left, right) => {
    const a = left.stored_at || "￿";
    const b = right.stored_at || "￿";
    return a < b ? -1 : a > b ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });
}

function daLinha(caixa: CaixaComOItem, qty: number): CaixaDaLinha {
  const zera = qty >= caixa.saldo;
  return { box_code: caixa.code, qty, inteira: zera && caixa.intacta, esvazia: zera && !caixa.intacta };
}

/**
 * A sugestão do sistema: a caixa mais antiga primeiro, a seguinte completa.
 * O que as caixas da prateleira não cobrem sai sem caixa.
 */
export function sugerirCaixas(pedido: number, caixas: Iterable<CaixaComOItem>): CaixasDaLinha {
  let falta = quantidade(pedido);
  const sugeridas: CaixaDaLinha[] = [];
  for (const caixa of ordemDeSaida(caixas)) {
    if (falta <= 0) break;
    const qty = Math.min(falta, quantidade(caixa.disponivel));
    if (!qty) continue;
    sugeridas.push(daLinha(caixa, qty));
    falta -= qty;
  }
  return { caixas: sugeridas, sem_caixa: falta };
}

/**
 * "Outra caixa": a pessoa informa de quais caixas da prateleira o item saiu.
 * Cada caixa tem de ter o item, na quantidade informada, e a soma tem de
 * fechar com a linha; só sai sem caixa o que as caixas da prateleira não têm.
 */
export function conferirCaixasInformadas(
  pedido: number,
  informadas: Iterable<{ box_code?: unknown; qty?: unknown }>,
  caixas: Iterable<CaixaComOItem>,
): CaixasDaLinha | { problema: string } {
  const total = quantidade(pedido);
  const porCodigo = new Map<string, CaixaComOItem>();
  let naPrateleira = 0;
  for (const caixa of caixas) {
    porCodigo.set(caixa.code, caixa);
    naPrateleira += quantidade(caixa.disponivel);
  }
  const pedidas = new Map<string, number>();
  for (const informada of informadas) {
    const codigo = typeof informada.box_code === "string" ? informada.box_code.trim().toUpperCase() : "";
    const qty = quantidade(informada.qty);
    if (!codigo || !qty) continue;
    pedidas.set(codigo, (pedidas.get(codigo) ?? 0) + qty);
  }
  const conferidas: CaixaDaLinha[] = [];
  let soma = 0;
  for (const [codigo, qty] of pedidas) {
    const caixa = porCodigo.get(codigo);
    const tem = quantidade(caixa?.disponivel);
    if (!caixa || !tem) return { problema: `A caixa ${codigo} não tem este item nesta prateleira.` };
    if (qty > tem) return { problema: `A caixa ${codigo} tem ${tem} un. deste item, e não ${qty}.` };
    conferidas.push(daLinha(caixa, qty));
    soma += qty;
  }
  const esperado = Math.min(total, naPrateleira);
  if (soma !== esperado) return { problema: `As caixas somam ${soma} un., e o separado nas caixas desta prateleira é de ${esperado} un.` };
  const ordem = new Map(ordemDeSaida(porCodigo.values()).map((caixa, index) => [caixa.code, index]));
  conferidas.sort((left, right) => (ordem.get(left.box_code) ?? 0) - (ordem.get(right.box_code) ?? 0));
  return { caixas: conferidas, sem_caixa: total - soma };
}
