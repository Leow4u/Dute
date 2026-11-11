/**
 * O que os dois caminhos da correção usam (corrigir.mjs, no mesmo SKU, e
 * transferir.mjs, para o SKU que já tem o código certo): texto, ids dos
 * recibos e dos eventos, leitura igual no banco e na transação, e a busca
 * do SKU e do cartão de products pelo código.
 */

import { createHash } from "node:crypto";

import { chaveDoCodigo, clienteDe } from "../padronizar-nomes/relatorio.mjs";
import { ATOR } from "./correcoes.mjs";

export { ATOR, chaveDoCodigo, clienteDe };

export const FONTE = "script_corrigir_codigo_do_produto";
export const confirmacaoDe = (projeto) => `CORRIGIR CODIGO ${projeto}`;

export const texto = (v) => String(v ?? "").trim();
export const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);
/** O id de documento como o WMS monta (safeDocId de domain/operations.ts). */
export const safeDocId = (v) => String(v).replace(/[^\w.-]/g, "_").slice(0, 900);
/** Chaves em ordem, como o digest do WMS (domain/operations.ts): o mesmo objeto dá o mesmo id. */
export function canonical(valor) {
  if (Array.isArray(valor)) return valor.map(canonical);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, item]) => [k, canonical(item)]),
    );
  }
  return valor;
}
export const digest = (v, tamanho = 32) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex").slice(0, tamanho);
export const arquivado = (d) => d.archived === true || texto(d.status) === "archived";
export const nomeDe = (d) => texto(d.produto || d.name || d.product_name);
export const codigoDe = (d) => texto(d.cod_cliente || d.client_item_code);
export const linhasDe = (d) => (Array.isArray(d?.lines) ? d.lines : []);
export const linhaViva = (d) => !["removed", "transferred", "reversed", "cancelled"].includes(texto(d.status));
export const cancelada = (d) => ["cancelled", "canceled"].includes(texto(d?.status).toLowerCase());

/** Data e hora de São Paulo, para o dry-run ("10/11/2026 14:32"). */
export const quando = (v) => {
  const data = typeof v?.toDate === "function" ? v.toDate() : texto(v) ? new Date(texto(v)) : null;
  if (!data || Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
};

export const STATUS_DA_CHEGADA = { created: "a conferir", checking: "em conferência", received: "com entrada concluída", cancelled: "cancelada", canceled: "cancelada" };
export const STATUS_DA_CAIXA = { counting: "em conferência", reviewed: "fechada, sem prateleira", committing: "com destino, por guardar", stored: "guardada", emptied: "vazia", cancelled: "cancelada" };
export const status = (mapa, valor) => mapa[texto(valor)] ?? (texto(valor) || "sem status");

export class ErroDaCorrecao extends Error {}
export const recusar = (mensagem) => {
  throw new ErroDaCorrecao(mensagem);
};

/** O recibo da correção inteira, ou de uma parte dela (`parte`). */
export const idDoRecibo = (correcao, parte) => `op_corrigir_codigo_${digest(parte ? { correcao: correcao.id, parte } : { correcao: correcao.id })}`;
export const idDoEvento = (correcao, tipo, entidade) => `evt_corrigir_codigo_${digest({ correcao: correcao.id, tipo, entidade })}`;
/** O recibo do movimento que o WMS grava (createInventoryMovementTransaction, domain/operations.ts). */
export const idDoReciboDeMovimento = (cliente, chave) => `op_inventory_${digest({ customer: cliente, nonce: chave })}`;
/** O documento do item em `ai_stock_age` (idDoItemParado de functions/core/src/domain/parados-gravacao.ts). */
export const idDoItemParado = (cliente, sku) =>
  `item_${createHash("sha256").update(JSON.stringify([cliente, sku])).digest("hex").slice(0, 24)}`;

/** `get` igual para o banco (dry-run) e para a transação (aplicação). */
export const leitorDoBanco = () => ({ get: (alvo) => alvo.get() });
export const leitorDaTransacao = (tx) => ({ get: (alvo) => tx.get(alvo) });

/** Os SKUs do cliente com o código, pelos três campos de busca (o cadastro importado não tem a chave). */
export async function skusComCodigo(leitor, db, codigo, cliente) {
  const achados = new Map();
  const consultas = [
    db.collection("skus").where("cod_cliente_key", "==", chaveDoCodigo(codigo)),
    db.collection("skus").where("cod_cliente", "==", texto(codigo)),
    db.collection("skus").where("client_item_code", "==", texto(codigo)),
  ];
  for (const consulta of consultas) {
    for (const doc of (await leitor.get(consulta)).docs) if (clienteDe(doc.data()) === cliente) achados.set(doc.id, doc);
  }
  return [...achados.values()];
}

/** Os cartões de `products` com o código: o do id (que não tem dono no id) e os das consultas do cliente. */
export async function productsComCodigo(leitor, db, codigo, cliente) {
  const achados = new Map();
  for (const consulta of [
    db.collection("products").where("cod_cliente_key", "==", chaveDoCodigo(codigo)),
    db.collection("products").where("cod_cliente", "==", texto(codigo)),
  ]) {
    for (const doc of (await leitor.get(consulta)).docs) if (!cliente || clienteDe(doc.data()) === cliente) achados.set(doc.ref.path, doc);
  }
  const direto = await leitor.get(db.collection("products").doc(safeDocId(chaveDoCodigo(codigo))));
  if (direto.exists && (!cliente || clienteDe(direto.data()) === cliente)) achados.set(direto.ref.path, direto);
  return [...achados.values()];
}

export const doCliente = (docs, cliente) => docs.filter((doc) => clienteDe(doc.data()) === cliente);
export const descreverMovimento = (d) =>
  `${texto(d.source) || "sem origem"} ${texto(d.tipo_mov || d.type)} ${fmt(num(d.quantity ?? d.qtde))} em ${texto(d.location_id) || "?"}${quando(d.occurred_at) ? ` ${quando(d.occurred_at)}` : ""}`;

/** Confere os campos da correção (correcoes.mjs). */
export function conferirCorrecao(correcao, tamanhoDoCodigo) {
  const cliente = texto(correcao.cliente);
  const kDe = chaveDoCodigo(correcao.de);
  const kPara = chaveDoCodigo(correcao.para);
  if (!cliente || !kDe || !kPara || kDe === kPara) recusar("a correção precisa de cliente, de e para diferentes");
  if (tamanhoDoCodigo(correcao.de) !== tamanhoDoCodigo(correcao.para)) recusar(`os dois códigos precisam terminar no mesmo tamanho (${correcao.de}, ${correcao.para})`);
  if (!(correcao.caixas ?? []).length) recusar("a correção precisa da caixa (caixas)");
  if (!["Masculino", "Feminino"].includes(correcao.genero)) recusar('o gênero da correção é "Masculino" ou "Feminino"');
}

/** O estoque congelado para reconciliação recusa (assertInventoryOperationsEnabled do WMS). */
export async function conferirCongelamento(leitor, db) {
  const controle = await leitor.get(db.collection("system_controls").doc("inventory"));
  if (controle.exists && (controle.data().movements_frozen === true || texto(controle.data().reconciliation_status) === "running")) {
    recusar("as movimentações do estoque estão congeladas (system_controls/inventory); libere antes da correção");
  }
}
