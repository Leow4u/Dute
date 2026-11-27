import { httpsCallable } from "firebase/functions";

import type {
  AnexarDocumento,
  AnexarFoto,
  ArquivarEvento,
  CancelarEdicao,
  CriarEdicao,
  EnviarEdicao,
  PatchDaEdicao,
  ResultadoDaFoto,
  ResultadoDaRetirada,
  ResultadoDoAnexo,
  ResultadoDoArquivamento,
  ResultadoDoCancelamento,
  ResultadoDoEnvio,
  ResultadoDoSalvar,
  TirarDocumento,
} from "../eventos/tipos";
import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";

import { erroDaCallable } from "./erro-da-callable";
import { semCamposVazios } from "./separacao";

/**
 * Os Eventos do portal, do portal ao histórico
 * (docs/superpowers/specs/2026-11-26-eventos-design.md): as callables do WMS
 * (functions/wms, domain/eventos/), um wrapper por callable. A lista é
 * travada contra o index.ts em platform-lists.test.ts: cada uma existe numa
 * linha e confere a liberação. O campo sem valor não vai: o SDK do Firebase
 * troca o `undefined` por `null`, e o servidor recusa `null` no campo só
 * opcional; o `null` de propósito (o `ate` do momento, o texto apagado) vai.
 * O erro leva a frase do servidor, o código da callable e o motivo em
 * `detalhe`.
 */

export const CALLABLES_DOS_EVENTOS = [
  "saveEventEdition",
  "sendEventEdition",
  "cancelEventEdition",
  "archiveClientEvent",
  "attachEventDocument",
  "removeEventDocument",
  "attachEventPhoto",
] as const;
export type CallableDosEventos = (typeof CALLABLES_DOS_EVENTOS)[number];

async function chamarEventos<T>(nome: CallableDosEventos, dados: object): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(semCamposVazios({ ...dados }) as Record<string, unknown>)).data;
  } catch (error) {
    throw erroDaCallable(error);
  }
}

/** Sem `id`, a edição nasce em rascunho; com `id`, o patch pelo `expected_edicao`. */
export function salvarEdicao(entrada: CriarEdicao | PatchDaEdicao): Promise<ResultadoDoSalvar> {
  return chamarEventos("saveEventEdition", entrada);
}

export function enviarEdicao(entrada: EnviarEdicao): Promise<ResultadoDoEnvio> {
  return chamarEventos("sendEventEdition", entrada);
}

/** O rascunho é excluído; a edição enviada, cancelada. */
export function cancelarEdicao(entrada: CancelarEdicao): Promise<ResultadoDoCancelamento> {
  return chamarEventos("cancelEventEdition", entrada);
}

export function arquivarEvento(entrada: ArquivarEvento): Promise<ResultadoDoArquivamento> {
  return chamarEventos("archiveClientEvent", entrada);
}

/** O arquivo que já subiu ao Storage entra na edição (o cliente, o an_; a Dutelog, o dc_). */
export function anexarDocumento(entrada: AnexarDocumento): Promise<ResultadoDoAnexo> {
  return chamarEventos("attachEventDocument", entrada);
}

/** Tira o documento da edição; o arquivo fica no bucket. */
export function tirarDocumento(entrada: TirarDocumento): Promise<ResultadoDaRetirada> {
  return chamarEventos("removeEventDocument", entrada);
}

/** A foto que já subiu entra na edição, no momento dela. */
export function anexarFoto(entrada: AnexarFoto): Promise<ResultadoDaFoto> {
  return chamarEventos("attachEventPhoto", entrada);
}
