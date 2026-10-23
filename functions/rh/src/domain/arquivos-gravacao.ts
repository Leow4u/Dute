import { randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";

import {
  caminhoDoArquivo,
  conferirArquivoNoBucket,
  entradaDaAbertura,
  entradaDoAnexo,
  entradaDoEnvio,
  novoIdDeArquivo,
  registroComArquivo,
  type ArquivoNoBucket,
} from "./arquivos.js";
import { createRhEvent } from "./events.js";
import { REGISTROS_COLLECTION, type RegistroGravado } from "./ficha.js";
import { atorDoRh, exigeQuemGrava, registroLido } from "./ficha-gravacao.js";
import { actorPayload, runIdempotent } from "./operations.js";
import type { RhProfile } from "./profile.js";

/**
 * Os arquivos da ficha no Storage e no banco `rh` (parte 8.2b).
 *
 * - requestRhUpload (só o rh) dá a URL assinada para subir, válida por
 *   MINUTOS_PARA_SUBIR, no caminho do registro. Não grava nada.
 * - attachRhFile (só o rh) confere no bucket o arquivo que subiu e o liga
 *   ao registro, com o recibo e o evento, numa transação do banco `rh`.
 * - openRhFile (owner, admin e rh) dá a URL assinada para abrir, válida por
 *   MINUTOS_PARA_ABRIR, e grava o evento da abertura antes de devolvê-la.
 *
 * O bucket entra por ArmazemDoRh: no ar, armazemDoBucket; nos testes, um
 * armazém de mentira, porque o emulador não assina URL.
 */

export const MINUTOS_PARA_SUBIR = 10;
export const MINUTOS_PARA_ABRIR = 5;

export type ArmazemDoRh = {
  /** O tipo e o tamanho do arquivo, ou null quando ele não existe. */
  conferir(caminho: string): Promise<ArquivoNoBucket | null>;
  /** A URL assinada para subir (PUT) o arquivo com o tipo informado. */
  urlParaSubir(caminho: string, contentType: string, expiraEm: Date): Promise<string>;
  /** A URL assinada para abrir o arquivo no navegador. */
  urlParaAbrir(caminho: string, expiraEm: Date): Promise<string>;
};

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

function erroDeAssinatura(error: unknown): boolean {
  const mensagem = error instanceof Error ? error.message : String(error ?? "");
  return mensagem.includes("iam.serviceAccounts.signBlob") || mensagem.includes("SigningError") || (error instanceof Error && error.name === "SigningError");
}

async function assinada(assinar: () => Promise<[string]>): Promise<string> {
  try {
    const [url] = await assinar();
    return url;
  } catch (error) {
    if (erroDeAssinatura(error)) {
      throw new HttpsError(
        "failed-precondition",
        "Arquivo indisponível: a service account das Functions precisa da role Service Account Token Creator (signBlob) para assinar URLs do Storage.",
      );
    }
    throw new HttpsError("internal", "Não foi possível autorizar o arquivo no Storage.");
  }
}

/** O armazém no bucket padrão do projeto. */
export function armazemDoBucket(bucket: Bucket): ArmazemDoRh {
  return {
    async conferir(caminho) {
      const arquivo = bucket.file(caminho);
      const [existe] = await arquivo.exists();
      if (!existe) return null;
      const [metadados] = await arquivo.getMetadata();
      return { contentType: String(metadados.contentType ?? ""), size: Number(metadados.size ?? 0) };
    },
    urlParaSubir(caminho, contentType, expiraEm) {
      return assinada(() => bucket.file(caminho).getSignedUrl({ version: "v4", action: "write", expires: expiraEm, contentType }));
    },
    urlParaAbrir(caminho, expiraEm) {
      return assinada(() => bucket.file(caminho).getSignedUrl({ version: "v4", action: "read", expires: expiraEm, responseDisposition: "inline" }));
    },
  };
}

async function lerRegistro(rh: Firestore, id: string): Promise<RegistroGravado> {
  const snapshot = await rh.collection(REGISTROS_COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
  return registroLido(snapshot.id, snapshot.data() ?? {});
}

function depoisDe(agora: Date, minutos: number): Date {
  return new Date(agora.getTime() + minutos * 60_000);
}

export type EnvioDoArquivo = { arquivo_id: string; upload_url: string; upload_headers: Record<string, string>; expira_em: string };

/** requestRhUpload: a URL para subir o arquivo do registro. Só o rh. */
export async function requestRhUploadFor(rh: Firestore, caller: RhProfile, data: unknown, armazem: ArmazemDoRh, agora: Date = new Date()): Promise<EnvioDoArquivo> {
  exigeQuemGrava(caller);
  const entrada = entradaDoEnvio(data);
  const registro = await lerRegistro(rh, entrada.registro_id);
  if (registro.situacao === "arquivado") throw new HttpsError("failed-precondition", "O registro está arquivado.");
  const arquivoId = novoIdDeArquivo();
  const expiraEm = depoisDe(agora, MINUTOS_PARA_SUBIR);
  const url = await armazem.urlParaSubir(caminhoDoArquivo(registro, arquivoId, entrada.content_type), entrada.content_type, expiraEm);
  return { arquivo_id: arquivoId, upload_url: url, upload_headers: { "content-type": entrada.content_type }, expira_em: expiraEm.toISOString() };
}

export type ResultadoDoAnexo = { id: string; edicao: number; arquivo_id: string };

/** attachRhFile: liga ao registro o arquivo que subiu, conferido no bucket. Só o rh. */
export async function attachRhFileFor(rh: Firestore, caller: RhProfile, data: unknown, armazem: ArmazemDoRh) {
  exigeQuemGrava(caller);
  const entrada = entradaDoAnexo(data);
  const registro = await lerRegistro(rh, entrada.registro_id);
  const caminho = caminhoDoArquivo(registro, entrada.arquivo_id, entrada.content_type);
  const tamanho = conferirArquivoNoBucket(await armazem.conferir(caminho), entrada.content_type);
  const actor = atorDoRh(caller);
  const { idempotency_key, ...input } = entrada;
  return runIdempotent<ResultadoDoAnexo>(
    rh,
    { kind: "arquivo_rh", scope: { id: entrada.registro_id }, idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const ref = rh.collection(REGISTROS_COLLECTION).doc(entrada.registro_id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
      const atual = registroLido(snapshot.id, snapshot.data() ?? {});
      const anexado = registroComArquivo(atual, entrada.expected_edicao, { id: entrada.arquivo_id, caminho, content_type: entrada.content_type, tamanho });
      transaction.update(ref, {
        arquivo: anexado.arquivo,
        ...(atual.arquivo ? { arquivos_anteriores: FieldValue.arrayUnion(atual.arquivo) } : {}),
        edicao: anexado.edicao,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actorPayload(actor),
      });
      createRhEvent(transaction, rh, {
        operation_id: operationId,
        type: "rh.file_attached",
        entity_id: atual.id,
        payload: { id: atual.id, colaborador_id: atual.colaborador_id, categoria: atual.categoria, tipo: atual.tipo, substituiu: atual.arquivo !== null },
        actor,
      });
      return { target_id: atual.id, result: { id: atual.id, edicao: anexado.edicao, arquivo_id: entrada.arquivo_id } };
    },
  );
}

export type AberturaDoArquivo = { url: string; content_type: string; expira_em: string };

/**
 * openRhFile: a URL para abrir o arquivo do registro, para owner, admin e
 * rh. A abertura fica registrada antes de a URL sair; sem o registro, não há
 * URL. O registro arquivado ainda abre: é o histórico.
 */
export async function openRhFileFor(rh: Firestore, caller: RhProfile, data: unknown, armazem: ArmazemDoRh, agora: Date = new Date()): Promise<AberturaDoArquivo> {
  const { registro_id } = entradaDaAbertura(data);
  const registro = await lerRegistro(rh, registro_id);
  if (!registro.arquivo) throw new HttpsError("not-found", "O registro não tem arquivo.");
  const expiraEm = depoisDe(agora, MINUTOS_PARA_ABRIR);
  const url = await armazem.urlParaAbrir(registro.arquivo.caminho, expiraEm);
  await rh.runTransaction(async (transaction) => {
    createRhEvent(transaction, rh, {
      operation_id: `abertura:${randomUUID()}`,
      type: "rh.file_opened",
      entity_id: registro.id,
      payload: { id: registro.id, colaborador_id: registro.colaborador_id, categoria: registro.categoria, tipo: registro.tipo },
      actor: atorDoRh(caller),
      occurred_at: agora.toISOString(),
    });
  });
  return { url, content_type: registro.arquivo.content_type, expira_em: expiraEm.toISOString() };
}
