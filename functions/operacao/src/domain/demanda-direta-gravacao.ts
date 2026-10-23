import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  DEMANDS_COLLECTION,
  DEMAND_COUNTERS_COLLECTION,
  DEMAND_COUNTER_ID,
  QUOTES_COLLECTION,
  documentoDaDemandaDireta,
  interpretarDemandaDireta,
  itensDoPedido,
  problemaDosInstantes,
  proximoNumeroDaDemanda,
  tipoPelaHora,
  type ItemDoCatalogo,
  type TipoDemanda,
} from "./demanda-direta.js";
import { createOperacaoEvent } from "./events.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Abre a demanda direta (parte 3.4d). Numa transação: lê o contador do
 * Comercial, confere que o número está livre (demanda e orçamento), acha o
 * cadastro do cliente, confere os locais e lê os itens do catálogo; depois
 * grava o contador, a demanda e o evento `demand.direct_opened`, sem nome,
 * contato, item nem preço.
 */

const CUSTOMERS = "customers";
const CUSTOMER_LOCATIONS = "customer_locations";
const LPU_ITEMS = "lpu_items";

export type ResultadoDaDemandaDireta = { numero: string; tipo: TipoDemanda; linhas: number };

function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O cadastro pelo código, como o Comercial acha (customer_code e, sem ele, code). */
async function cadastroPeloCodigo(transaction: Transaction, db: Firestore, code: string): Promise<DocumentData> {
  const customers = db.collection(CUSTOMERS);
  let docs = (await transaction.get(customers.where("customer_code", "==", code))).docs;
  if (!docs.length) docs = (await transaction.get(customers.where("code", "==", code))).docs;
  if (!docs.length) throw new HttpsError("not-found", `Cadastro ${code} não encontrado.`);
  if (docs.length > 1) throw new HttpsError("failed-precondition", `Há mais de um cadastro com o código ${code}. Confira em Configurações › Clientes.`);
  const dados = docs[0].data() ?? {};
  if (dados.archived === true || texto(dados.status) === "archived") throw new HttpsError("failed-precondition", `O cadastro ${code} está arquivado.`);
  return dados;
}

async function conferirLocais(transaction: Transaction, db: Firestore, ids: readonly string[], code: string): Promise<void> {
  if (ids.length === 0) return;
  const snapshots = await transaction.getAll(...ids.map((id) => db.collection(CUSTOMER_LOCATIONS).doc(id)));
  for (const snapshot of snapshots) {
    if (!snapshot.exists) throw new HttpsError("not-found", `Local ${snapshot.id} não encontrado.`);
    if (texto(snapshot.get("customer_code")) !== code) throw new HttpsError("failed-precondition", `O local ${snapshot.id} é de outro cliente.`);
  }
}

export async function lerCatalogo(transaction: Transaction, db: Firestore, ids: readonly string[]): Promise<Map<string, ItemDoCatalogo>> {
  const catalogo = new Map<string, ItemDoCatalogo>();
  if (ids.length === 0) return catalogo;
  const snapshots = await transaction.getAll(...ids.map((id) => db.collection(LPU_ITEMS).doc(id)));
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const dados = snapshot.data() ?? {};
    catalogo.set(snapshot.id, {
      id: snapshot.id,
      item: texto(dados.item),
      descricao: texto(dados.descricao),
      servico: texto(dados.servico),
      unidade: texto(dados.unidade),
      ativo: dados.ativo !== false,
      orcavel: dados.orcavel !== false,
    });
  }
  return catalogo;
}

export async function openDirectDemandFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaDemandaDireta & { replayed?: true }> {
  const problemaDoPapel = operacaoCadastroProblem(caller.role);
  if (problemaDoPapel) throw new HttpsError("permission-denied", problemaDoPapel);
  const pedido = interpretarDemandaDireta(data);
  const problema = problemaDosInstantes(pedido.recebida_em, pedido.executar_ate, agora());
  if (problema) throw new HttpsError("invalid-argument", problema);
  const code = pedido.customer_code;

  return runIdempotent(
    db,
    { kind: "demand_direct_open", scope: { customer_code: code }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const iso = agora().toISOString();

      // Leituras.
      const contadorRef = db.collection(DEMAND_COUNTERS_COLLECTION).doc(DEMAND_COUNTER_ID);
      const contador = await transaction.get(contadorRef);
      const numero = proximoNumeroDaDemanda(contador.exists ? contador.get("ultimo") : undefined);
      const demandaRef = db.collection(DEMANDS_COLLECTION).doc(numero);
      const [demandaSnap, orcamentoSnap] = await transaction.getAll(demandaRef, db.collection(QUOTES_COLLECTION).doc(numero));
      if (demandaSnap.exists || orcamentoSnap.exists) {
        throw new HttpsError("failed-precondition", `O número ${numero} já existe. Confira o contador ${DEMAND_COUNTERS_COLLECTION}/${DEMAND_COUNTER_ID} antes de continuar.`);
      }
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      const origem = pedido.origem?.local_id ?? null;
      const destino = pedido.destino?.local_id ?? null;
      await conferirLocais(transaction, db, [...new Set([origem, destino].filter((id): id is string => Boolean(id)))], code);
      const catalogo = await lerCatalogo(
        transaction,
        db,
        [...new Set(pedido.itens.map((item) => item.lpu_item_id).filter((id): id is string => Boolean(id)))],
      );

      // Conta.
      const tipoCalculado = tipoPelaHora(pedido.recebida_em, pedido.executar_ate);
      const tipo = pedido.tipo ?? tipoCalculado;
      const itens = itensDoPedido(pedido.itens, catalogo, operationId, { origem, destino });
      const documento = documentoDaDemandaDireta({
        numero,
        customer_code: code,
        customer_name: texto(cadastro.name) || code,
        pedido,
        tipo,
        tipo_calculado: tipoCalculado,
        itens,
        iso,
        uid: caller.uid,
      });

      // Escritas.
      transaction.set(contadorRef, { ultimo: Number(numero), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(demandaRef, {
        ...documento,
        operation_id: operationId,
        created_at: FieldValue.serverTimestamp(),
        created_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "demand.direct_opened",
        entity_id: numero,
        customer_code: code,
        payload: { id: numero, tipo, tipo_calculado: tipoCalculado, linhas: itens.length },
        occurred_at: iso,
        actor: ator(caller),
      });
      return { target_id: numero, result: { numero, tipo, linhas: itens.length } };
    },
  );
}
