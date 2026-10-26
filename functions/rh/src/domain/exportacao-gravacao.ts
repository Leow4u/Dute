import { randomUUID } from "node:crypto";

import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { diaEmSaoPaulo } from "./dia.js";
import { createRhEvent } from "./events.js";
import {
  EXPORTACOES_COLLECTION,
  EXPORTACOES_NA_LISTA,
  ID_EXPORTACAO,
  arquivoDaExportacao,
  conteudoDaExportacao,
  entradaDaExportacao,
  entradaDoDownload,
  hashDoConteudo,
  idDaExportacao,
  type ArquivoGerado,
  type ColaboradorDaExportacao,
  type ConteudoGuardado,
} from "./exportacao.js";
import { COLLABORATORS_COLLECTION, REGISTROS_COLLECTION } from "./ficha.js";
import { atorDoRh, exigeQuemGrava, registroLido } from "./ficha-gravacao.js";
import { actorPayload, runIdempotent } from "./operations.js";
import type { RhProfile } from "./profile.js";
import { VINCULOS_COLLECTION, vinculosPorColaborador } from "./vinculo.js";

/**
 * A exportação no Firestore (parte 8.3). Do banco padrão, lê os colaboradores
 * de vínculo próprio, com o CPF; no banco `dute-rh`, as datas do vínculo
 * (parte 8.4), e a versão da competência guarda as linhas que foram para a
 * contabilidade, o hash, quem gerou e o evento. Baixar não muda nada: monta a
 * planilha da versão guardada, no formato em que foi gerada, e registra o
 * evento de quem baixou.
 */

function texto(data: DocumentData, campo: string): string {
  const valor = data[campo];
  return typeof valor === "string" ? valor.trim() : "";
}

function ilegivel(): never {
  throw new HttpsError("failed-precondition", "Exportação ilegível.");
}

type ColaboradorDoCadastro = Omit<ColaboradorDaExportacao, "admissao" | "desligamento">;

/** Os de vínculo próprio, ativos ou não; o cadastro sem vínculo é próprio, como na ficha. */
async function colaboradoresDaExportacao(padrao: Firestore): Promise<ColaboradorDoCadastro[]> {
  const snapshot = await padrao.collection(COLLABORATORS_COLLECTION).get();
  return snapshot.docs
    .filter((doc) => (doc.data().vinculo ?? "proprio") === "proprio")
    .map((doc) => {
      const data = doc.data();
      return { id: doc.id, nome: texto(data, "nome"), cpf: texto(data, "cpf").replace(/\D/g, ""), funcao: texto(data, "funcao"), ativo: data.ativo === true };
    });
}

type VersaoGravada = { id: string; competencia: string; versao: number; hash: string };

function versaoLida(id: string, data: DocumentData): VersaoGravada {
  if (!ID_EXPORTACAO.test(id) || typeof data.competencia !== "string" || !Number.isInteger(data.versao) || typeof data.hash !== "string") ilegivel();
  return { id, competencia: data.competencia, versao: data.versao, hash: data.hash };
}

export type ResultadoDaExportacao = { id: string; versao: number; nova: boolean };

/**
 * exportRhMonth: a exportação da competência. Sem mudança desde a última
 * versão, devolve ela (`nova: false`) e não grava nada além do recibo; com
 * mudança, grava a versão seguinte e o evento. Só o rh.
 */
export async function exportRhMonthFor(padrao: Firestore, rh: Firestore, caller: RhProfile, data: unknown, agora: Date = new Date()) {
  exigeQuemGrava(caller);
  const entrada = entradaDaExportacao(data, diaEmSaoPaulo(agora));
  const colaboradores = await colaboradoresDaExportacao(padrao);
  const actor = atorDoRh(caller);
  const { idempotency_key, ...input } = entrada;
  return runIdempotent<ResultadoDaExportacao>(
    rh,
    { kind: "exportacao_rh", scope: { competencia: entrada.competencia }, idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const [versoes, exames, gravados] = await Promise.all([
        transaction.get(rh.collection(EXPORTACOES_COLLECTION).where("competencia", "==", entrada.competencia)),
        transaction.get(rh.collection(REGISTROS_COLLECTION).where("categoria", "==", "exame")),
        transaction.get(rh.collection(VINCULOS_COLLECTION)),
      ]);
      const vinculos = vinculosPorColaborador(gravados.docs);
      const conteudo = conteudoDaExportacao(
        entrada.competencia,
        colaboradores.map((colaborador) => {
          const datas = vinculos.get(colaborador.id);
          return { ...colaborador, admissao: datas?.admissao ?? null, desligamento: datas?.desligamento ?? null };
        }),
        exames.docs.map((doc) => registroLido(doc.id, doc.data())),
      );
      const hash = hashDoConteudo(conteudo);
      const ultima = versoes.docs.map((doc) => versaoLida(doc.id, doc.data())).sort((a, b) => b.versao - a.versao)[0] ?? null;
      if (ultima?.hash === hash) return { target_id: ultima.id, result: { id: ultima.id, versao: ultima.versao, nova: false } };
      const versao = (ultima?.versao ?? 0) + 1;
      const id = idDaExportacao(entrada.competencia, versao);
      transaction.create(rh.collection(EXPORTACOES_COLLECTION).doc(id), {
        id,
        competencia: entrada.competencia,
        versao,
        hash,
        formato: conteudo.formato,
        exames: conteudo.exames,
        colaboradores: conteudo.colaboradores,
        totais: { exames: conteudo.exames.length, colaboradores: conteudo.colaboradores.length },
        gerada_em: agora.toISOString(),
        gerada_por: actorPayload(actor),
        created_at: FieldValue.serverTimestamp(),
      });
      createRhEvent(transaction, rh, {
        operation_id: operationId,
        type: "rh.export_created",
        entity_id: id,
        payload: { id, competencia: entrada.competencia, versao, exames: conteudo.exames.length, colaboradores: conteudo.colaboradores.length },
        actor,
        occurred_at: agora.toISOString(),
      });
      return { target_id: id, result: { id, versao, nova: true } };
    },
  );
}

export type ExportacaoNaLista = {
  id: string;
  competencia: string;
  versao: number;
  exames: number;
  colaboradores: number;
  gerada_em: string;
  gerada_por: string;
};

function contagem(valor: unknown): number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : ilegivel();
}

/** listRhExports: as versões mais novas, sem as linhas. Owner, admin e rh. */
export async function listRhExportsFor(rh: Firestore): Promise<{ exportacoes: ExportacaoNaLista[] }> {
  const snapshot = await rh.collection(EXPORTACOES_COLLECTION).orderBy("gerada_em", "desc").limit(EXPORTACOES_NA_LISTA).get();
  return {
    exportacoes: snapshot.docs.map((doc) => {
      const data = doc.data();
      const versao = versaoLida(doc.id, data);
      const totais = (data.totais ?? {}) as Record<string, unknown>;
      const autor = (data.gerada_por ?? {}) as Record<string, unknown>;
      return {
        id: versao.id,
        competencia: versao.competencia,
        versao: versao.versao,
        exames: contagem(totais.exames),
        colaboradores: contagem(totais.colaboradores),
        gerada_em: typeof data.gerada_em === "string" ? data.gerada_em : ilegivel(),
        gerada_por: [autor.name, autor.email].find((valor): valor is string => typeof valor === "string" && valor.length > 0) ?? "",
      };
    }),
  };
}

function linhas<T>(valor: unknown): T[] {
  return Array.isArray(valor) && valor.every((linha) => linha && typeof linha === "object") ? (valor as T[]) : ilegivel();
}

/** downloadRhExport: a planilha de uma versão guardada; o download fica registrado. Owner, admin e rh. */
export async function downloadRhExportFor(rh: Firestore, caller: RhProfile, data: unknown, agora: Date = new Date()): Promise<ArquivoGerado> {
  const entrada = entradaDoDownload(data);
  const snapshot = await rh.collection(EXPORTACOES_COLLECTION).doc(entrada.id).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Exportação não encontrada.");
  const gravada = snapshot.data() ?? {};
  const versao = versaoLida(snapshot.id, gravada);
  // A versão substituída perde as linhas 30 dias depois (LGPD, decisão 7): ficam o hash e as contagens.
  if (typeof gravada.linhas_apagadas_em === "string") {
    throw new HttpsError("failed-precondition", "Esta versão foi substituída e as linhas dela saíram (LGPD). Baixe a versão mais nova da competência.");
  }
  // As versões de antes da parte 8.4 não têm o formato: saem com as colunas de então.
  const conteudo = {
    competencia: versao.competencia,
    formato: gravada.formato === 2 ? 2 : 1,
    exames: linhas(gravada.exames),
    colaboradores: linhas(gravada.colaboradores),
  } as ConteudoGuardado;
  const arquivo = arquivoDaExportacao(conteudo, versao.versao, entrada.arquivo);
  await rh.runTransaction(async (transaction) => {
    createRhEvent(transaction, rh, {
      operation_id: `download:${randomUUID()}`,
      type: "rh.export_downloaded",
      entity_id: versao.id,
      payload: { id: versao.id, competencia: versao.competencia, versao: versao.versao, arquivo: entrada.arquivo },
      actor: atorDoRh(caller),
      occurred_at: agora.toISOString(),
    });
  });
  return arquivo;
}

