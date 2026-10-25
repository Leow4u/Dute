import type { Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  AI_STOCK_ALERTS_COLLECTION,
  chaveDoItemDecidido,
  idDoAlerta,
  interpretarRespostaDoAlerta,
  itemDaMemoria,
  itensEscolhidos,
  itensParaAlertar,
  type ItemDaMemoria,
  type ItemDoAlerta,
  type StatusDoAlerta,
} from "./alertas-parados.js";
import { AI_CURSORS_COLLECTION } from "./cursor.js";
import { estavel } from "./estavel.js";
import { createCoreEvent } from "./eventos.js";
import { AI_STOCK_AGE_COLLECTION, runStockAgeFor, type ResultadoDosParados } from "./parados-gravacao.js";
import { diaEmSaoPaulo, regraDoModelo } from "./parados.js";
import { alertaProblem } from "./platform-roles.js";
import type { CoreProfile } from "./profile.js";

/**
 * A rotina e a decisão do alerta do item parado (docs/plataforma/fase-5-memoria.md,
 * parte 5.4d).
 *
 * - Uma vez por dia (o dia de São Paulo, marcado em `ai_cursors`), a rotina
 *   refaz a proposta de cada cliente: os itens que passaram do limite da regra
 *   do modelo dele, menos os já decididos. Sem item, a proposta aberta sai.
 * - Só o cliente ativo, que não é prospect e tem portal, recebe proposta.
 * - A coordenação aprova (escolhendo os itens) ou descarta, numa transação
 *   que confere a proposta aberta e grava o evento. A mesma decisão de novo
 *   não muda nada; outra decisão sobre o alerta decidido recusa.
 * - A rotina não manda nada ao cliente: o aviso é do aprovado (parte 5.4f).
 */

export const CURSOR_DOS_ALERTAS = "alertas_parados";
const CUSTOMERS_COLLECTION = "customers";

export type ResultadoDosAlertas = { dia: string; rodou: boolean; clientes: number; propostas: number; removidas: number };

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function itensGravados(valor: unknown): ItemDoAlerta[] {
  return (Array.isArray(valor) ? valor : []).flatMap((item): ItemDoAlerta[] => {
    const registro = item && typeof item === "object" ? (item as Registro) : {};
    const skuCode = texto(registro.sku_code);
    const ultima = texto(registro.ultima_movimentacao);
    if (!skuCode || !ultima) return [];
    return [
      {
        sku_code: skuCode,
        client_item_code: texto(registro.client_item_code) || null,
        product_name: texto(registro.product_name) || null,
        saldo: Number(registro.saldo) || 0,
        ultima_movimentacao: ultima,
        dias_parado: Number(registro.dias_parado) || 0,
      },
    ];
  });
}

/** O cliente que recebe o alerta: ativo, cliente (não prospect) e com portal. */
function clienteComPortal(dados: Registro | undefined): boolean {
  if (!dados) return false;
  if (dados.archived === true || texto(dados.status || "active") !== "active") return false;
  if (texto(dados.stage) === "prospect") return false;
  return texto(dados.portal_status || "active") === "active";
}

async function cadastros(db: Firestore, codigos: readonly string[]): Promise<Map<string, Registro>> {
  const porCodigo = new Map<string, Registro>();
  for (let inicio = 0; inicio < codigos.length; inicio += 30) {
    const parte = codigos.slice(inicio, inicio + 30);
    const lidos = await db
      .collection(CUSTOMERS_COLLECTION)
      .where("customer_code", "in", parte)
      .select("customer_code", "operation_template", "status", "portal_status", "stage", "archived")
      .get();
    for (const doc of lidos.docs) porCodigo.set(texto(doc.get("customer_code")), doc.data());
  }
  return porCodigo;
}

export async function runStockAlertsFor(db: Firestore, opcoes: { agora?: () => Date } = {}): Promise<ResultadoDosAlertas> {
  const instante = (opcoes.agora ?? (() => new Date()))();
  const hoje = diaEmSaoPaulo(instante.toISOString()) ?? instante.toISOString().slice(0, 10);
  const cursor = db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DOS_ALERTAS);
  if ((await cursor.get()).get("dia") === hoje) return { dia: hoje, rodou: false, clientes: 0, propostas: 0, removidas: 0 };

  const [comSaldo, alertas] = await Promise.all([
    db.collection(AI_STOCK_AGE_COLLECTION).where("saldo", ">", 0).select("customer_code", "sku_code", "client_item_code", "product_name", "saldo", "relogio").get(),
    db.collection(AI_STOCK_ALERTS_COLLECTION).select("customer_code", "status", "itens").get(),
  ]);
  const itensPorCliente = new Map<string, ItemDaMemoria[]>();
  for (const doc of comSaldo.docs) {
    const customerCode = texto(doc.get("customer_code"));
    const item = itemDaMemoria(doc.data());
    if (customerCode && item) itensPorCliente.set(customerCode, [...(itensPorCliente.get(customerCode) ?? []), item]);
  }
  const decididos = new Map<string, Set<string>>();
  // A proposta aberta leva o instante em que foi lida: a rotina só a grava ou tira se ela não mudou desde então.
  const abertas = new Map<string, { id: string; itens: ItemDoAlerta[]; lida: Timestamp }>();
  for (const doc of alertas.docs) {
    const customerCode = texto(doc.get("customer_code"));
    const itens = itensGravados(doc.get("itens"));
    if (doc.get("status") === "proposta") abertas.set(customerCode, { id: doc.id, itens, lida: doc.updateTime });
    else decididos.set(customerCode, new Set([...(decididos.get(customerCode) ?? []), ...itens.map(chaveDoItemDecidido)]));
  }

  const clientes = [...new Set([...itensPorCliente.keys(), ...abertas.keys()])].sort();
  const porCodigo = await cadastros(db, clientes);
  const batch = db.batch();
  let propostas = 0;
  let removidas = 0;
  for (const customerCode of clientes) {
    const cadastro = porCodigo.get(customerCode);
    const regra = regraDoModelo(cadastro?.operation_template);
    const itens = clienteComPortal(cadastro) ? itensParaAlertar(itensPorCliente.get(customerCode) ?? [], regra, hoje, decididos.get(customerCode) ?? new Set()) : [];
    const aberta = abertas.get(customerCode);
    if (!itens.length) {
      if (aberta) {
        batch.delete(db.collection(AI_STOCK_ALERTS_COLLECTION).doc(aberta.id), { lastUpdateTime: aberta.lida });
        removidas += 1;
      }
      continue;
    }
    if (aberta && estavel(aberta.itens) === estavel(itens)) continue;
    const id = aberta?.id ?? idDoAlerta(customerCode, hoje);
    const ref = db.collection(AI_STOCK_ALERTS_COLLECTION).doc(id);
    const proposta = { id, customer_code: customerCode, status: "proposta", regra, itens, atualizada_em: instante.toISOString() };
    if (aberta) batch.update(ref, proposta, { lastUpdateTime: aberta.lida });
    else batch.set(ref, { ...proposta, proposta_em: instante.toISOString() }, { merge: true });
    propostas += 1;
  }
  // A decisão que entrou depois da leitura faz o lote falhar inteiro, sem
  // marcar o dia: a rodada seguinte refaz com ela lida, em vez de voltar o
  // alerta decidido para proposta ou apagá-lo.
  batch.set(cursor, { dia: hoje, atualizado_em: instante.toISOString() });
  await batch.commit();
  return { dia: hoje, rodou: true, clientes: clientes.length, propostas, removidas };
}

/** O relógio do estoque e, depois dele, a proposta do dia: a proposta lê o relógio já em dia. */
export async function runStockFor(db: Firestore, opcoes: { agora?: () => Date } = {}): Promise<{ parados: ResultadoDosParados; alertas: ResultadoDosAlertas }> {
  const parados = await runStockAgeFor(db, opcoes);
  return { parados, alertas: await runStockAlertsFor(db, opcoes) };
}

export type ResultadoDaDecisao = { alerta_id: string; status: StatusDoAlerta; itens: number; replayed?: true };

/** A decisão da coordenação sobre a proposta: aprovar com os itens escolhidos, ou descartar. */
export async function answerStockAlertFor(db: Firestore, caller: CoreProfile, data: unknown, agora: () => Date = () => new Date()): Promise<ResultadoDaDecisao> {
  const problema = alertaProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  const resposta = interpretarRespostaDoAlerta(data);
  return db.runTransaction(async (transaction: Transaction) => {
    const ref = db.collection(AI_STOCK_ALERTS_COLLECTION).doc(resposta.alerta_id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "O alerta não existe.");
    const status = texto(snapshot.get("status")) as StatusDoAlerta;
    const proposta = itensGravados(snapshot.get("itens"));
    const esperado: StatusDoAlerta = resposta.decisao === "aprovar" ? "aprovada" : "descartada";

    if (status !== "proposta") {
      const enviados = itensGravados(snapshot.get("itens_enviados")).map((item) => item.sku_code);
      const mesmaDecisao = status === esperado && (esperado === "descartada" || estavel([...enviados].sort()) === estavel([...new Set(resposta.itens)].sort()));
      if (mesmaDecisao) return { alerta_id: resposta.alerta_id, status, itens: esperado === "aprovada" ? enviados.length : proposta.length, replayed: true };
      throw new HttpsError("failed-precondition", "O alerta já foi decidido.");
    }

    const enviados = esperado === "aprovada" ? itensEscolhidos(proposta, resposta.itens) : [];
    const customerCode = texto(snapshot.get("customer_code"));
    const instante = agora().toISOString();
    const decididaPor: Registro = { uid: caller.uid, role: caller.role };
    if (caller.name) decididaPor.name = caller.name;
    transaction.update(ref, { status: esperado, itens_enviados: enviados, decidida_em: instante, decidida_por: decididaPor });
    createCoreEvent(transaction, db, {
      type: esperado === "aprovada" ? "estoque_parado.aprovado" : "estoque_parado.descartado",
      payload: { id: resposta.alerta_id, itens: esperado === "aprovada" ? enviados.length : proposta.length },
      customer_code: customerCode,
      actor: caller,
      occurred_at: instante,
    });
    return { alerta_id: resposta.alerta_id, status: esperado, itens: esperado === "aprovada" ? enviados.length : proposta.length };
  });
}

