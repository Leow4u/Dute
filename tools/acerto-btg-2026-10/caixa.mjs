/**
 * A caixa no acerto, sem banco (acerto.mjs importa daqui; o teste é
 * caixa.test.mjs). O conteúdo de entrada da caixa mora nas linhas da abertura
 * ou na própria caixa do Receber (`lines[]`); o que as separações tiraram fica
 * na caixa (`taken_lines`, `taken_units`, `balance_at`), e o que as
 * recontagens acertaram também (`count_adjustments`, com sinal e o id da
 * contagem). O saldo é a entrada menos o retirado mais os ajustes, pela regra
 * do domínio (tools/corrigir-codigo-do-produto/saldo-da-caixa.mjs, gerada de
 * lib/dominio).
 *
 * A recontagem por caixa (diagnóstico da contagem cíclica, seção 6, item 4)
 * é a forma de acertar uma caixa daqui em diante: a operação do plano que
 * mexeria no conteúdo de um SKU que a recontagem ajustou numa caixa recusa,
 * e a que mexe na caixa inteira (a baixa sem `itens`, remover, esvaziar)
 * recusa a caixa com qualquer ajuste. As escritas em caixa sem ajuste no SKU
 * só tocam os campos delas: nenhuma apaga ou reescreve um ajuste.
 */

import { ajustesDaCaixa, conteudoDaCaixa, recontagemNoSku, resumoDosAjustes, textoDosAjustes, unidadesDaCaixaAgora } from "../corrigir-codigo-do-produto/ajustes-da-caixa.mjs";
import { retiradoCom as retiradoComDaRegra } from "../corrigir-codigo-do-produto/saldo-da-caixa.mjs";

const texto = (v) => String(v ?? "").trim();
const numero = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const formato = new Intl.NumberFormat("pt-BR");

/** O que as separações tiraram de um SKU da caixa (`taken_lines`). */
export function retiradoDe(dados, sku) {
  return (Array.isArray(dados?.taken_lines) ? dados.taken_lines : []).filter((t) => texto(t?.sku_code) === sku).reduce((s, t) => s + numero(t.qty), 0);
}

/** O retirado depois de somar (ou, com `delta` negativo, devolver) um SKU, pela regra (retiradoCom); a caixa sem o campo começa vazia. */
export function retiradoCom(linhas, sku, delta) {
  return retiradoComDaRegra(Array.isArray(linhas) ? linhas : [], sku, delta);
}

/**
 * Os campos do retirado na caixa: com linhas, elas, o total e a hora do
 * saldo; sem linhas, os três saem (`apagar` é o FieldValue.delete) e a caixa
 * volta a ser a de entrada. A caixa com ajuste da recontagem continua aberta
 * sem o retirado: a hora do saldo fica, com a da mudança, porque a "etiqueta
 * para trocar" a compara com a da etiqueta impressa.
 */
export function retiradoGravado(linhas, agora, dados, apagar) {
  if (linhas.length) return { taken_lines: linhas, taken_units: linhas.reduce((s, l) => s + l.qty, 0), balance_at: agora };
  return { taken_lines: apagar(), taken_units: apagar(), balance_at: ajustesDaCaixa(dados).length ? agora : apagar() };
}

/**
 * A caixa guardada de que a separação tirou tudo o que ela tem sai da
 * prateleira (vazia), como a separação faz (pick-progress.ts): o que fica é a
 * entrada menos o retirado mais os ajustes da recontagem. `entrada` e
 * `retirado` são os que a escrita vai deixar.
 */
export function ficaVazia(dados, { entrada, retirado }) {
  return texto(dados?.status) === "stored" && retirado > 0 && unidadesDaCaixaAgora(dados, { entrada, retirado }) <= 0;
}

/** A recusa da operação que mexeria num SKU que a recontagem ajustou na caixa; null quando ela não ajustou. */
export function recusaNoSku(dados, caixa, sku, rotulo, consequencia) {
  const recontada = recontagemNoSku(dados, caixa, sku, rotulo);
  return recontada ? `${recontada}: ${consequencia}. Confira com --caixa ${caixa}` : null;
}

/** A recusa da operação na caixa inteira (baixar tudo, remover, esvaziar) que a recontagem ajustou; null sem ajuste. */
export function recusaNaCaixa(dados, caixa, consequencia) {
  const resumo = resumoDosAjustes(dados);
  return resumo ? `a recontagem já ajustou a caixa ${caixa} (${resumo}): ${consequencia}. Confira com --caixa ${caixa}` : null;
}

/**
 * O que o --caixa mostra depois das linhas: o conteúdo da caixa do Receber,
 * o retirado, os ajustes da recontagem e o que fica de cada item pela regra.
 * `entrada`: as linhas da abertura vivas da caixa (as da caixa do Receber
 * vêm da própria caixa).
 */
export function resumoDaCaixa(dados, linhasDaAbertura) {
  const proprias = Array.isArray(dados?.lines) ? dados.lines : [];
  const fonte = proprias.length ? proprias : linhasDaAbertura;
  const itens = conteudoDaCaixa(
    dados,
    fonte.map((l) => ({ sku_code: l?.sku_code, qty: numero(l?.counted_qty), client_item_code: l?.client_item_code, product_name: l?.product_name })),
  );
  const rotulo = (x) => `${x.sku_code}${x.codigo ? ` (${x.codigo})` : ""}`;
  const saida = [];
  if (proprias.length) saida.push(`conteúdo da caixa (Receber): ${proprias.map((l) => `${texto(l?.sku_code)} · "${texto(l?.client_item_code)}" · ${formato.format(numero(l?.counted_qty))}`).join(", ")}`);
  const tirados = itens.filter((x) => x.saiu > 0);
  if (tirados.length) saida.push(`separação tirou: ${tirados.map((x) => `${rotulo(x)} ${formato.format(x.saiu)}`).join(", ")}`);
  const ajustados = itens.filter((x) => x.ajustes.length);
  if (ajustados.length) saida.push(`recontagem: ${ajustados.map((x) => `${rotulo(x)} ${textoDosAjustes(x.ajustes)}`).join("; ")}`);
  saida.push(`fica pela regra (entrada − retirado + ajustes): ${itens.filter((x) => x.fica > 0).map((x) => `${rotulo(x)} ${formato.format(x.fica)}`).join(", ") || "nada"}`);
  return saida;
}
