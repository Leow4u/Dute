import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { createOperacaoEvent } from "./events.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import { RETENCAO_ACTOR } from "./retencao-gravacao.js";
import { limiteDasFotos, revisadaEm, separarFotos } from "./retencao-das-fotos.js";
import { diaEmSaoPaulo } from "./tv.js";

/**
 * A retenção das fotos da OS no Firestore e no Storage (LGPD, decisão 2):
 * para cada OS revisada há mais de 12 meses, apaga os arquivos das fotos que
 * saem e, numa transação que relê a OS, tira essas fotos da lista (e dos
 * ambientes da vistoria), marca a OS com `retencao_das_fotos` e grava o
 * evento com as contagens. A OS marcada não volta: rodar de novo não apaga
 * mais nada. A gravação não mexe no `updated_at`, que puxaria a OS antiga
 * para a leitura do dia da TV.
 */

/** Apaga um arquivo do bucket; o que já não existe conta como apagado. */
export type ApagarArquivo = (caminho: string) => Promise<void>;

/** Quantas OS por rodada (o resto fica para o dia seguinte), e quantos arquivos saem ao mesmo tempo. */
const OS_POR_RODADA = 50;
const ARQUIVOS_DE_UMA_VEZ = 10;
const LEITURA = 500;

/** Os dois relógios da OS revisada: a revisão da OS de serviço e o envio da vistoria ao Comercial. */
const RELOGIOS = ["revisao.instante", "vistoria.registrado_em"] as const;

export type ResultadoDaRetencaoDasFotos = {
  antes_de: string;
  os: number;
  fotos: number;
  protegidas: number;
  falhas: number;
  sem_permissao: boolean;
  completo: boolean;
};

/** As OS revisadas antes do limite que ainda não passaram pela retenção, pelos dois relógios, só com os campos da regra. */
async function osParaReter(db: Firestore, limiteIso: string, leitura: number): Promise<string[]> {
  const numeros = new Set<string>();
  for (const relogio of RELOGIOS) {
    let depois: QueryDocumentSnapshot | undefined;
    for (;;) {
      let consulta = db
        .collection(SERVICE_ORDERS_COLLECTION)
        .where(relogio, "<", limiteIso)
        .orderBy(relogio)
        .select("status", "retencao_das_fotos", relogio)
        .limit(leitura);
      if (depois) consulta = consulta.startAfter(depois);
      const lidas = await consulta.get();
      for (const doc of lidas.docs) if (doc.get("status") === "revisada" && doc.get("retencao_das_fotos") === undefined) numeros.add(doc.id);
      if (lidas.size < leitura) break;
      depois = lidas.docs.at(-1);
    }
  }
  return [...numeros].sort();
}

async function apagarArquivos(caminhos: readonly string[], apagar: ApagarArquivo): Promise<void> {
  for (let inicio = 0; inicio < caminhos.length; inicio += ARQUIVOS_DE_UMA_VEZ) {
    await Promise.all(caminhos.slice(inicio, inicio + ARQUIVOS_DE_UMA_VEZ).map(apagar));
  }
}

/** O bucket recusou por permissão: as outras OS dariam o mesmo erro. */
function semPermissao(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return codigo === 401 || codigo === 403;
}

export async function runPhotoRetentionFor(
  db: Firestore,
  apagar: ApagarArquivo,
  opcoes: { agora?: Date; porRodada?: number; leitura?: number } = {},
): Promise<ResultadoDaRetencaoDasFotos> {
  const agora = opcoes.agora ?? new Date();
  const limite = limiteDasFotos(agora);
  const limiteIso = limite.toISOString();
  const agoraIso = agora.toISOString();
  const resultado: ResultadoDaRetencaoDasFotos = { antes_de: diaEmSaoPaulo(limite), os: 0, fotos: 0, protegidas: 0, falhas: 0, sem_permissao: false, completo: true };
  const numeros = await osParaReter(db, limiteIso, opcoes.leitura ?? LEITURA);
  const porRodada = opcoes.porRodada ?? OS_POR_RODADA;
  if (numeros.length > porRodada) resultado.completo = false;
  for (const numero of numeros.slice(0, porRodada)) {
    const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(numero);
    const lida = (await ref.get()).data() ?? {};
    const quando = revisadaEm(lida);
    if (!quando || quando >= limiteIso || lida.retencao_das_fotos !== undefined) continue;
    // O arquivo sai antes da OS: a falha no meio deixa a OS como estava, e a rodada seguinte repete.
    try {
      await apagarArquivos(separarFotos(lida, numero).saem.map((foto) => String(foto.caminho)), apagar);
    } catch (erro) {
      console.error("[runOperacaoRetention] fotos da OS não apagadas", { numero, erro });
      if (semPermissao(erro)) {
        resultado.sem_permissao = true;
        resultado.completo = false;
        break;
      }
      resultado.falhas += 1;
      continue;
    }
    const gravada = await gravarRetencao(db, numero, quando, agoraIso).catch((erro: unknown) => {
      console.error("[runOperacaoRetention] OS não gravada depois de apagar as fotos", { numero, erro });
      resultado.falhas += 1;
      return null;
    });
    if (!gravada) continue;
    resultado.os += 1;
    resultado.fotos += gravada.saem.length;
    if (gravada.protegida) resultado.protegidas += 1;
  }
  return resultado;
}

/**
 * Tira da OS as fotos que saíram (e dos ambientes da vistoria), marca a OS e
 * grava o evento, numa transação que relê a OS: a que mudou desde a leitura
 * fica para a rodada seguinte.
 */
async function gravarRetencao(db: Firestore, numero: string, quando: string, agoraIso: string) {
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(numero);
  return db.runTransaction(async (transaction) => {
    const os = (await transaction.get(ref)).data() ?? {};
    if (os.retencao_das_fotos !== undefined || revisadaEm(os) !== quando) return null;
    const separadas = separarFotos(os, numero);
    const saindo = new Set(separadas.saem.map((foto) => String(foto.id)));
    const mudanca: Record<string, unknown> = {
      fotos: separadas.ficam,
      retencao_das_fotos: { em: agoraIso, apagadas: separadas.saem.length, ficaram: separadas.ficam.length, ...(separadas.protegida ? { motivo: "cobranca" } : {}) },
    };
    const ambientes = (os.vistoria as { ambientes?: unknown } | undefined)?.ambientes;
    if (os.tipo === "vistoria" && Array.isArray(ambientes)) {
      mudanca["vistoria.ambientes"] = ambientes.map((ambiente: unknown) =>
        ambiente && typeof ambiente === "object" && Array.isArray((ambiente as { fotos?: unknown }).fotos)
          ? { ...ambiente, fotos: ((ambiente as { fotos: unknown[] }).fotos).filter((id) => !saindo.has(String(id))) }
          : ambiente,
      );
    }
    transaction.update(ref, mudanca);
    if (separadas.saem.length) {
      createOperacaoEvent(transaction, db, {
        operation_id: `retencao-fotos:${numero}`,
        type: "os.photos_removed",
        entity_id: numero,
        payload: { id: numero, demanda: String(os.demanda ?? ""), fotos: separadas.saem.length, ficaram: separadas.ficam.length, revisada_em: diaEmSaoPaulo(new Date(quando)) },
        actor: RETENCAO_ACTOR,
        customer_code: typeof os.customer_code === "string" ? os.customer_code : null,
        occurred_at: agoraIso,
      });
    }
    return separadas;
  });
}
