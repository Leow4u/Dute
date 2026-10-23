import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  ARMAZEM,
  ORDERS_COLLECTION,
  entregaDoPedido,
  instanteDeSaoPaulo,
  interpretarDemandaDoArmazem,
  itensDaEntrega,
  pedidoDoWms,
  tituloDaEntrega,
} from "./demanda-do-armazem.js";
import {
  DEMANDS_COLLECTION,
  DEMAND_COUNTERS_COLLECTION,
  DEMAND_COUNTER_ID,
  QUOTES_COLLECTION,
  documentoDaDemandaDireta,
  itensDoPedido,
  proximoNumeroDaDemanda,
  tipoPelaHora,
  type TipoDemanda,
} from "./demanda-direta.js";
import { cadastroPeloCodigo } from "./demanda-direta-gravacao.js";
import { createOperacaoEvent } from "./events.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import {
  SERVICE_ORDERS_COLLECTION,
  SERVICE_ORDER_COUNTERS_COLLECTION,
  fatiaDoSaldo,
  itensSemPreco,
  novaOs,
  numeroDaOs,
  saldoDoEscopo,
  type LocalDaOs,
  type OsGravada,
} from "./os.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Abre a demanda e as OS da entrega pela Dutelog de um pedido de saída do WMS
 * (parte 4.5b). Numa transação: lê o pedido e a entrega gravada nele, o
 * contador do Comercial e o cadastro do cliente; grava o contador, a demanda
 * direta (canal `wms`, `pedido_wms`), a ida (agendada para a entrega) e, com
 * o retorno, a volta (agendada para o retorno, `retorno_ao_armazem`), o número
 * da demanda e das OS de volta no pedido e os eventos, sem nome, endereço,
 * contato nem preço. Só a entrega pela Dutelog: a retirada não gera OS.
 */

export type ResultadoDaDemandaDoArmazem = { numero: string; tipo: TipoDemanda; os_numeros: string[] };

function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function local(complemento: string, contato: LocalDaOs["contato"] = null): LocalDaOs {
  return { local_id: null, nome: null, endereco: null, complemento: complemento.slice(0, 120), contato };
}

export async function openStorageDemandFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaDemandaDoArmazem & { replayed?: true }> {
  if (caller.role !== "wms" && operacaoCadastroProblem(caller.role)) {
    throw new HttpsError("permission-denied", "Seu perfil não abre a entrega na Operação.");
  }
  const pedido = interpretarDemandaDoArmazem(data);

  return runIdempotent(
    db,
    { kind: "storage_demand_open", scope: { order_id: pedido.order_id }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const iso = agora().toISOString();

      // Leituras.
      const pedidoRef = db.collection(ORDERS_COLLECTION).doc(pedido.order_id);
      const pedidoSnap = await transaction.get(pedidoRef);
      if (!pedidoSnap.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
      const doWms = pedidoDoWms(pedidoSnap.id, pedidoSnap.data() ?? {});
      const entrega = entregaDoPedido(doWms);
      if (typeof entrega === "string") throw new HttpsError("failed-precondition", entrega);
      const code = doWms.customerCode;

      const contadorRef = db.collection(DEMAND_COUNTERS_COLLECTION).doc(DEMAND_COUNTER_ID);
      const contador = await transaction.get(contadorRef);
      const numero = proximoNumeroDaDemanda(contador.exists ? contador.get("ultimo") : undefined);
      const demandaRef = db.collection(DEMANDS_COLLECTION).doc(numero);
      const [demandaSnap, orcamentoSnap, contadorDaOsSnap] = await transaction.getAll(
        demandaRef,
        db.collection(QUOTES_COLLECTION).doc(numero),
        db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(numero),
      );
      if (demandaSnap.exists || orcamentoSnap.exists || contadorDaOsSnap.exists) {
        throw new HttpsError("failed-precondition", `O número ${numero} já existe. Confira o contador ${DEMAND_COUNTERS_COLLECTION}/${DEMAND_COUNTER_ID} antes de continuar.`);
      }
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      const customerName = texto(cadastro.name) || code;

      // Conta.
      const recebidaEm = entrega.definidaEm ?? iso;
      const executarAte = instanteDeSaoPaulo(entrega.data, entrega.hora);
      if (Date.parse(executarAte) <= Date.parse(recebidaEm)) throw new HttpsError("failed-precondition", "A data da entrega já passou: corrija a entrega no WMS.");
      const tipo = tipoPelaHora(recebidaEm, executarAte);
      const { pedidos, ida, volta } = itensDaEntrega(doWms, entrega);
      const itens = itensDoPedido(pedidos, new Map(), operationId, { origem: null, destino: null });
      const documento = documentoDaDemandaDireta({
        numero,
        customer_code: code,
        customer_name: customerName,
        pedido: {
          idempotency_key: pedido.idempotency_key,
          customer_code: code,
          titulo: tituloDaEntrega(doWms),
          canal: "wms",
          pedido_por: entrega.contato,
          recebida_em: recebidaEm,
          executar_ate: executarAte,
          origem: { local_id: null, complemento: ARMAZEM },
          destino: { local_id: null, complemento: entrega.destino.slice(0, 120) },
          itens: pedidos,
          solicitacao_id: null,
        },
        pedidoWms: { order_id: doWms.id, order_number: doWms.numero },
        tipo,
        tipo_calculado: tipo,
        itens,
        iso,
        uid: caller.uid,
      });

      const escopo = itensSemPreco(itens);
      const saldo = saldoDoEscopo(escopo, []);
      const contatoNoDestino = entrega.contato ? { nome: entrega.contato.nome, telefone: entrega.contato.telefone } : null;
      const base = { demanda: numero, customer_code: code, cliente_nome: customerName, escopo_rv: null, equipe: [], equipe_uids: [], veiculos: [], instrucoes: null };
      const ordens: Array<OsGravada & { retorno_ao_armazem?: { order_id: string; order_number: string } }> = [
        novaOs({
          ...base,
          numero: numeroDaOs(numero, 1),
          seq: 1,
          itens: fatiaDoSaldo(escopo, saldo, ida.map((indice) => ({ id: escopo[indice].id, planejado: escopo[indice].planejado }))),
          locais: { origem: local(ARMAZEM), destino: local(entrega.destino, contatoNoDestino) },
          janela: { data: entrega.data, inicio: entrega.hora, fim: null },
        }),
      ];
      if (entrega.retorno && volta.length) {
        ordens.push({
          ...novaOs({
            ...base,
            numero: numeroDaOs(numero, 2),
            seq: 2,
            itens: fatiaDoSaldo(escopo, saldo, volta.map((indice) => ({ id: escopo[indice].id, planejado: escopo[indice].planejado }))),
            locais: { origem: local(entrega.destino, contatoNoDestino), destino: local(ARMAZEM) },
            janela: { data: entrega.retorno.data, inicio: entrega.retorno.hora, fim: null },
          }),
          // A volta revisada abre o recebimento do retorno no WMS (parte 4.5d).
          retorno_ao_armazem: { order_id: doWms.id, order_number: doWms.numero },
        });
      }
      const osNumeros = ordens.map((os) => os.numero);

      // Escritas.
      transaction.set(contadorRef, { ultimo: Number(numero), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(demandaRef, {
        ...documento,
        os_numeros: osNumeros,
        operation_id: operationId,
        created_at: FieldValue.serverTimestamp(),
        created_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      });
      transaction.set(db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(numero), { demanda: numero, ultimo: ordens.length, updated_at: FieldValue.serverTimestamp() });
      for (const os of ordens) {
        transaction.create(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
          ...os,
          id: os.numero,
          atualizado_por: { uid: caller.uid, role: caller.role },
          updated_at: FieldValue.serverTimestamp(),
          created_at: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(pedidoRef, { "entrega.demanda": numero, "entrega.os_numeros": osNumeros, updated_at: FieldValue.serverTimestamp() });

      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "demand.storage_opened",
        entity_id: numero,
        customer_code: code,
        payload: { id: numero, tipo, linhas: itens.length, os: ordens.length, retorno: Boolean(entrega.retorno) },
        occurred_at: iso,
        actor: ator(caller),
      });
      for (const os of ordens) {
        createOperacaoEvent(transaction, db, {
          operation_id: operationId,
          suffix: `os.planned:${os.numero}`,
          type: "os.planned",
          entity_id: os.numero,
          customer_code: code,
          payload: { id: os.numero, demanda: numero, seq: os.seq, linhas: os.itens.length, data: os.janela?.data ?? null, equipe: [], veiculos: [] },
          occurred_at: iso,
          actor: ator(caller),
        });
      }
      return { target_id: numero, result: { numero, tipo, os_numeros: osNumeros } };
    },
  );
}
