import { FieldPath, FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";

import { createEvent, refreshClientInventorySplitTransaction, type OperationalActor } from "./operations.js";

/**
 * O recálculo do disponível do portal (docs/plataforma/recebimento-com-caixas.md,
 * parte 7c). Desde a parte 7, cada escrita da projeção do cliente
 * (client_inventory) grava o disponível só das prateleiras (qty_available) e o
 * em recebimento (qty_receiving) a partir dos saldos do SKU; a projeção que não
 * teve escrita nova ainda tem o disponível de antes, que contava todos os
 * locais. A rotina refaz esses dois campos de cada projeção, uma transação por
 * projeção, até uma passada inteira sem nada a refazer; aí grava o evento,
 * marca o recálculo como feito e passa a só ler o controle.
 *
 * O controle mora em system_controls (a zeragem o apaga junto com o resto, e
 * aí a rotina passa de novo pelas projeções, que estarão vazias). Com o
 * estoque congelado para reconciliação ou zeragem, a rodada para e a próxima
 * continua de onde parou.
 */

export const CONTROLE_DO_RECALCULO = "client_inventory_split";
/** Mudou a conta do disponível de novo? Suba a versão: a rotina refaz tudo. */
export const VERSAO_DO_RECALCULO = 1;
export const ATOR_DO_RECALCULO: OperationalActor = {
  uid: "rotina-disponivel-do-portal",
  role: "sistema",
  name: "Rotina do disponível do portal",
};

const POR_PAGINA = 200;
/**
 * O recálculo só se dá por feito com uma passada limpa que começa ao menos
 * uma hora depois da primeira rodada da versão: a publicação troca as
 * functions do WMS aos poucos, e uma escrita de revisão antiga ainda grava o
 * disponível de antes nesse intervalo. Cada projeção dessa passada é conferida
 * depois da espera.
 */
export const ESPERA_MINIMA_MS = 60 * 60 * 1000;
/** Folga para não estourar os 540 s da rotina: o resto fica para a próxima. */
const TEMPO_DA_RODADA_MS = 420_000;

export type ResultadoDoRecalculo = {
  status: "feito" | "em_andamento" | "congelado";
  passada?: number;
  conferidas?: number;
  refeitas?: number;
};

type Controle = {
  version?: number;
  status?: string;
  pass?: number;
  cursor?: string | null;
  pass_checked?: number;
  pass_changed?: number;
  total_changed?: number;
  started_at?: string;
  pass_started_at?: string | null;
  /** Uma página começou e a rodada parou antes de gravar o fim dela. */
  page_open?: boolean;
};

function numero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** O estoque congelado para reconciliação ou zeragem (system_controls/inventory). */
function congeladoNoControle(controle: Record<string, unknown> | undefined) {
  return controle?.movements_frozen === true || controle?.reconciliation_status === "running";
}

function congelado(error: unknown) {
  const details = (error as { details?: { code?: unknown } } | undefined)?.details;
  return details?.code === "INVENTORY_RECONCILIATION_IN_PROGRESS";
}

export async function recalcularDisponivelDoPortal(
  db: Firestore,
  options: { porPagina?: number; tempoMs?: number; agora?: () => Date } = {},
): Promise<ResultadoDoRecalculo> {
  const porPagina = options.porPagina ?? POR_PAGINA;
  const tempoMs = options.tempoMs ?? TEMPO_DA_RODADA_MS;
  const agora = options.agora ?? (() => new Date());
  const inicio = Date.now();
  const controleRef = db.collection("system_controls").doc(CONTROLE_DO_RECALCULO);
  const lido = ((await controleRef.get()).data() ?? {}) as Controle;
  if (lido.version === VERSAO_DO_RECALCULO && lido.status === "done") {
    return { status: "feito" };
  }
  // Com o estoque congelado (reconciliação ou zeragem), nada se grava: nem o
  // controle, que a zeragem apaga e confere no fim.
  if (await estoqueCongelado(db)) return { status: "congelado" };
  const mesmaVersao = lido.version === VERSAO_DO_RECALCULO;
  const estado = {
    pass: mesmaVersao ? Math.max(1, numero(lido.pass)) : 1,
    cursor: mesmaVersao ? (lido.cursor ?? null) : null,
    checked: mesmaVersao ? numero(lido.pass_checked) : 0,
    changed: mesmaVersao ? numero(lido.pass_changed) : 0,
    totalChanged: mesmaVersao ? numero(lido.total_changed) : 0,
    startedAt: mesmaVersao && lido.started_at ? lido.started_at : agora().toISOString(),
    // O começo da passada em curso; sem cursor, a passada começa nesta rodada.
    passStartedAt: null as string | null,
  };
  if (mesmaVersao && estado.cursor) {
    estado.passStartedAt = lido.pass_started_at || estado.startedAt;
    // A rodada anterior parou no meio de uma página: o que ela refez ali não
    // ficou contado, e esta passada não se dá por limpa. (Sem cursor, a
    // passada recomeça do início e confere tudo de novo.)
    if (lido.page_open === true) estado.changed = Math.max(estado.changed, 1);
  }
  const inventarioRef = db.collection("system_controls").doc("inventory");
  // O controle só se grava com o estoque solto, na mesma transação que confere
  // o congelamento: a zeragem apaga o controle e confere no fim.
  const gravar = (paginaAberta: boolean) =>
    db.runTransaction(async (transaction) => {
      const inventario = await transaction.get(inventarioRef);
      if (congeladoNoControle(inventario.data())) return false;
      transaction.set(
        controleRef,
        {
          version: VERSAO_DO_RECALCULO,
          status: "running",
          pass: estado.pass,
          cursor: estado.cursor,
          pass_checked: estado.checked,
          pass_changed: estado.changed,
          total_changed: estado.totalChanged,
          started_at: estado.startedAt,
          pass_started_at: estado.passStartedAt,
          page_open: paginaAberta,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return true;
    });
  const andamento = (): ResultadoDoRecalculo => ({
    status: "em_andamento",
    passada: estado.pass,
    conferidas: estado.checked,
    refeitas: estado.changed,
  });

  const parar = async (): Promise<ResultadoDoRecalculo> =>
    (await gravar(false)) ? andamento() : { ...andamento(), status: "congelado" };

  for (;;) {
    if (!estado.cursor) estado.passStartedAt = agora().toISOString();
    // A página fica marcada como aberta antes da primeira projeção refeita
    // nela; esta gravação também guarda o fim da página anterior.
    if (!(await gravar(true))) return { ...andamento(), status: "congelado" };
    let pagina = db
      .collection("client_inventory")
      .orderBy(FieldPath.documentId())
      .limit(porPagina);
    if (estado.cursor) pagina = pagina.startAfter(estado.cursor);
    const documentos = (await pagina.get()).docs;
    for (const documento of documentos) {
      let resultado: Awaited<ReturnType<typeof refreshClientInventorySplitTransaction>>;
      try {
        resultado = await refreshClientInventorySplitTransaction(db, documento.id);
      } catch (error) {
        // Congelou no meio: a rodada para sem gravar; a seguinte retoma do
        // último cursor salvo, com a página marcada como aberta.
        if (congelado(error)) return { ...andamento(), status: "congelado" };
        throw error;
      }
      estado.cursor = documento.id;
      if (resultado === "missing") continue;
      estado.checked += 1;
      if (resultado === "changed") {
        estado.changed += 1;
        estado.totalChanged += 1;
      }
    }
    if (documentos.length < porPagina) {
      // Fim da passada. Feito só depois de uma passada limpa que começou ao
      // menos ESPERA_MINIMA_MS depois da primeira rodada desta versão: uma
      // escrita de revisão antiga do WMS, durante a publicação, ainda pode
      // gravar o disponível de antes.
      const limpa = estado.changed === 0;
      const comecoDaPassada = new Date(estado.passStartedAt ?? estado.startedAt).getTime();
      const esperou = comecoDaPassada - new Date(estado.startedAt).getTime() >= ESPERA_MINIMA_MS;
      if (limpa && esperou) {
        const concluiu = await concluir(db, controleRef, estado, agora());
        return concluiu
          ? { status: "feito", passada: estado.pass, conferidas: estado.checked, refeitas: estado.totalChanged }
          : { ...andamento(), status: "congelado" };
      }
      estado.pass += 1;
      estado.cursor = null;
      estado.passStartedAt = null;
      estado.checked = 0;
      estado.changed = 0;
      // Limpa, mas cedo: a próxima passada fica para a próxima rodada.
      if (limpa) return parar();
    }
    if (Date.now() - inicio > tempoMs) return parar();
  }
}

async function estoqueCongelado(db: Firestore) {
  return congeladoNoControle((await db.collection("system_controls").doc("inventory").get()).data());
}

async function concluir(
  db: Firestore,
  controleRef: DocumentReference,
  estado: { pass: number; checked: number; totalChanged: number; startedAt: string; passStartedAt: string | null },
  quando: Date,
): Promise<boolean> {
  const quandoIso = quando.toISOString();
  // Um evento por recálculo: o refazer (o controle apagado, ou a zeragem que
  // guarda os eventos) começa de novo o started_at e grava o seu.
  const eventoRef = db
    .collection("events")
    .doc(`evt_portal_disponivel_v${VERSAO_DO_RECALCULO}_${estado.startedAt.replace(/\D/g, "")}`);
  const inventarioRef = db.collection("system_controls").doc("inventory");
  return db.runTransaction(async (transaction) => {
    const [controle, evento, inventario] = await Promise.all([
      transaction.get(controleRef),
      transaction.get(eventoRef),
      transaction.get(inventarioRef),
    ]);
    // Congelou entre a última passada e aqui: nada se grava.
    if (congeladoNoControle(inventario.data())) return false;
    if (controle.get("version") === VERSAO_DO_RECALCULO && controle.get("status") === "done") return true;
    transaction.set(
      controleRef,
      {
        version: VERSAO_DO_RECALCULO,
        status: "done",
        pass: estado.pass,
        cursor: null,
        pass_checked: estado.checked,
        pass_changed: 0,
        total_changed: estado.totalChanged,
        started_at: estado.startedAt,
        pass_started_at: estado.passStartedAt,
        page_open: false,
        done_at: quandoIso,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (evento.exists) return true;
    createEvent(
      transaction,
      db,
      eventoRef.id,
      {
        type: "warehouse.client_projection_recalculated",
        title: "Disponível do portal recalculado",
        description: `${estado.totalChanged} projeção(ões) refeita(s) pelos saldos: o disponível conta só a prateleira.`,
        severity: "info",
        inbox: false,
        entity_type: "client_inventory",
        entity_id: CONTROLE_DO_RECALCULO,
        // As refeitas que a rotina registrou: a rodada derrubada no meio de
        // uma página não conta as que já tinha refeito.
        payload: {
          version: VERSAO_DO_RECALCULO,
          passes: estado.pass,
          projections_checked: estado.checked,
          projections_changed: estado.totalChanged,
          started_at: estado.startedAt,
        },
        occurred_at: quandoIso,
        source: "functions_wms",
      },
      ATOR_DO_RECALCULO,
    );
    return true;
  });
}
