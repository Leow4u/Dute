/**
 * O que a recontagem por caixa grava na caixa, como as ferramentas do acerto
 * o leem (ler-estoque.mjs, corrigir.mjs e transferir.mjs desta pasta, e
 * tools/acerto-btg-2026-10). A recontagem (recountWarehouseBox,
 * docs/plataforma/diagnostico-contagem-ciclica.md, seção 6, item 4) não muda
 * a entrada da caixa (`lines[]` da caixa do recebimento ou as linhas da
 * abertura) nem o retirado (`taken_lines`): ela acrescenta, por item, um
 * ajuste com sinal em `count_adjustments`, com o id da contagem
 * (`recount_id`), a hora (`at`) e, no item que passou de uma caixa para
 * outra da prateleira, de onde veio (`moved_from`) ou para onde foi
 * (`moved_to`). O saldo é a entrada menos o retirado mais os ajustes, pela
 * regra do domínio (saldo-da-caixa.mjs, gerada de lib/dominio).
 *
 * Nenhuma ferramenta apaga nem reescreve um ajuste: a escrita que muda o
 * conteúdo de um SKU numa caixa recusa quando a recontagem ajustou esse SKU
 * ali, e as outras escritas na mesma caixa só tocam os campos delas.
 *
 * Funções puras, sem Firestore.
 */

import { saldoDaCaixa, unidadesAjustadas } from "./saldo-da-caixa.mjs";

const texto = (v) => String(v ?? "").trim();
const numero = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const formato = new Intl.NumberFormat("pt-BR");

/** Data e hora de São Paulo ("17/11/2026, 14:05"), como o `quando` de comum.mjs. */
function quando(v) {
  const data = typeof v?.toDate === "function" ? v.toDate() : texto(v) ? new Date(texto(v)) : null;
  if (!data || Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Os ajustes gravados na caixa, na ordem, com tudo o que cada um traz; sem os que não têm SKU ou quantidade (a regra não os soma). */
export function ajustesDaCaixa(dados) {
  const lista = Array.isArray(dados?.count_adjustments) ? dados.count_adjustments : [];
  return lista.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const sku_code = texto(item.sku_code);
    const qty = numero(item.qty);
    return sku_code && qty ? [{ ...item, sku_code, qty }] : [];
  });
}

/** Os ajustes de um SKU na caixa. */
export function ajustesDoSku(dados, sku) {
  const alvo = texto(sku);
  return ajustesDaCaixa(dados).filter((ajuste) => ajuste.sku_code === alvo);
}

/** A caixa tem ajuste da recontagem, em qualquer SKU. */
export const caixaAjustada = (dados) => ajustesDaCaixa(dados).length > 0;

/** O saldo de um SKU na caixa pela regra: a entrada menos o retirado mais os ajustes dele, nunca negativo. */
export function saldoDoSku(sku, { entrada = 0, retirado = 0, ajustes = [] } = {}) {
  const alvo = texto(sku);
  const doSku = ajustes.filter((ajuste) => texto(ajuste?.sku_code) === alvo);
  return saldoDaCaixa([{ sku_code: alvo, qty: entrada }], [{ sku_code: alvo, qty: retirado }], doSku).find((linha) => linha.sku_code === alvo)?.qty ?? 0;
}

/**
 * As unidades da caixa agora, como o `unidadesDaCaixaAgora` do WMS
 * (box-balance.ts): a entrada (`unit_count`) menos o retirado
 * (`taken_units`) mais os ajustes, nunca negativo. `entrada` e `retirado`
 * trocam os do registro pelo que a escrita vai deixar.
 */
export function unidadesDaCaixaAgora(dados, { entrada = numero(dados?.unit_count), retirado = numero(dados?.taken_units) } = {}) {
  return Math.max(0, entrada - retirado + unidadesAjustadas(ajustesDaCaixa(dados)));
}

/**
 * O conteúdo da caixa pela regra, um item por SKU: o que entrou, o que a
 * separação tirou, o que a recontagem ajustou e o que fica. `entrada` é a
 * entrada da caixa ({ sku_code, qty, client_item_code?, product_name? }:
 * as linhas da caixa do recebimento ou as da abertura). Na ordem da entrada;
 * o SKU que só a recontagem pôs na caixa vem depois, com o código e o nome
 * que o ajuste gravou.
 */
export function conteudoDaCaixa(dados, entrada) {
  const porSku = new Map();
  const item = (sku) => {
    if (!porSku.has(sku)) porSku.set(sku, { sku_code: sku, codigo: "", nome: "", entrou: 0, saiu: 0, ajustes: [], ajustado: 0, fica: 0 });
    return porSku.get(sku);
  };
  for (const linha of entrada ?? []) {
    const sku = texto(linha?.sku_code);
    if (!sku) continue;
    const x = item(sku);
    x.entrou += Math.max(0, numero(linha.qty));
    x.codigo ||= texto(linha.client_item_code);
    x.nome ||= texto(linha.product_name);
  }
  for (const tirado of Array.isArray(dados?.taken_lines) ? dados.taken_lines : []) {
    const sku = texto(tirado?.sku_code);
    if (sku) item(sku).saiu += Math.max(0, numero(tirado.qty));
  }
  const ajustes = ajustesDaCaixa(dados);
  for (const ajuste of ajustes) {
    const x = item(ajuste.sku_code);
    x.ajustes.push(ajuste);
    x.ajustado += ajuste.qty;
    x.codigo ||= texto(ajuste.client_item_code);
    x.nome ||= texto(ajuste.product_name);
  }
  const itens = [...porSku.values()];
  const fica = new Map(
    saldoDaCaixa(
      itens.map((x) => ({ sku_code: x.sku_code, qty: x.entrou })),
      itens.map((x) => ({ sku_code: x.sku_code, qty: x.saiu })),
      ajustes,
    ).map((linha) => [linha.sku_code, linha.qty]),
  );
  return itens.map((x) => ({ ...x, fica: fica.get(x.sku_code) ?? 0 }));
}

/**
 * Um ajuste em texto: "−2 em 17/11/2026, 14:05, contagem brc_…", com de onde
 * a peça a mais veio ("+3 em …, 1 do saldo sem caixa e 2 da CX-000140, …")
 * ou para qual caixa foi ("−1 em …, para a CX-000138, …").
 */
export function textoDoAjuste(ajuste) {
  const qty = numero(ajuste?.qty);
  let saida = `${qty > 0 ? "+" : "−"}${formato.format(Math.abs(qty))}`;
  const hora = quando(ajuste?.at);
  if (hora) saida += ` em ${hora}`;
  const veio = (Array.isArray(ajuste?.moved_from) ? ajuste.moved_from : []).map((m) => `${formato.format(numero(m?.qty))} da ${texto(m?.box_code)}`).filter((t) => !t.endsWith(" da "));
  if (numero(ajuste?.from_loose) > 0) veio.unshift(`${formato.format(numero(ajuste.from_loose))} do saldo sem caixa`);
  if (veio.length) saida += `, ${veio.join(" e ")}`;
  if (texto(ajuste?.moved_to)) saida += `, para a ${texto(ajuste.moved_to)}`;
  if (texto(ajuste?.recount_id)) saida += `, contagem ${texto(ajuste.recount_id)}`;
  return saida;
}

export const textoDosAjustes = (ajustes) => ajustes.map(textoDoAjuste).join("; ");

/**
 * Os ajustes da caixa por SKU, para o dry-run: "BTG-000143 −1 em 17/11/2026,
 * 14:05, contagem brc_…"; vazio na caixa sem ajuste. `incluir(sku)` escolhe
 * os SKUs (todos, sem ele).
 */
export function resumoDosAjustes(dados, incluir = () => true) {
  const porSku = new Map();
  for (const ajuste of ajustesDaCaixa(dados)) {
    if (incluir(ajuste.sku_code)) porSku.set(ajuste.sku_code, [...(porSku.get(ajuste.sku_code) ?? []), ajuste]);
  }
  return [...porSku].map(([sku, ajustes]) => `${sku} ${textoDosAjustes(ajustes)}`).join("; ");
}

/**
 * O começo da recusa da escrita que mexeria num SKU que a recontagem ajustou
 * na caixa; null quando ela não ajustou. Cada ferramenta completa com o que a
 * escrita faria por cima do ajuste.
 */
export function recontagemNoSku(dados, codigoDaCaixa, sku, rotulo = sku) {
  const ajustes = ajustesDoSku(dados, sku);
  return ajustes.length ? `a recontagem já ajustou ${rotulo} na caixa ${codigoDaCaixa} (${textoDosAjustes(ajustes)})` : null;
}
