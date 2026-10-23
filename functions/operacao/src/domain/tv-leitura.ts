import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import { tvProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";
import { diaEmSaoPaulo, inicioDoDia, quadroDaTv, type DemandaNaTv, type QuadroDaTv } from "./tv.js";

/**
 * A leitura da TV da sala (parte 3.12): duas consultas de um campo só, sem
 * índice composto. A agendada e a em execução vêm pelo status; a concluída
 * hoje vem pelas OS gravadas desde o começo do dia (a conclusão e a revisão
 * gravam updated_at). O prazo da demanda direta sai da demanda. Só lê.
 */

const DEMANDS_COLLECTION = "demands";
/** Teto de cada consulta: o quadro de um dia cabe com folga. */
const LIMITE = 500;

export async function getRoomBoardFor(db: Firestore, caller: OperacaoProfile, agora: () => Date = () => new Date()): Promise<QuadroDaTv> {
  const problema = tvProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  const instante = agora();
  const desde = Timestamp.fromDate(inicioDoDia(diaEmSaoPaulo(instante)));
  const ordens = db.collection(SERVICE_ORDERS_COLLECTION);
  const [ativas, deHoje] = await Promise.all([
    ordens.where("status", "in", ["agendada", "em_execucao"]).limit(LIMITE).get(),
    ordens.where("updated_at", ">=", desde).limit(LIMITE).get(),
  ]);
  const documentos = [...ativas.docs, ...deHoje.docs].map((doc) => ({ id: doc.id, data: doc.data() }));
  const numeros = [...new Set(documentos.map((documento) => documento.data.demanda).filter((numero): numero is string => typeof numero === "string" && /^\d{5,8}$/.test(numero)))];
  const demandas = new Map<string, DemandaNaTv>();
  if (numeros.length) {
    const lidas = await db.getAll(...numeros.map((numero) => db.collection(DEMANDS_COLLECTION).doc(numero)));
    for (const lida of lidas) {
      const prazo = lida.get("executar_ate");
      demandas.set(lida.id, { executar_ate: typeof prazo === "string" ? prazo : null });
    }
  }
  return quadroDaTv(documentos, demandas, instante);
}
