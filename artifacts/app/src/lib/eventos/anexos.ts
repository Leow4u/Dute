import { LIMITES } from "@workspace/dominio";

import { fileSize } from "../portal-documents";
import { problemaDoArquivoDaEdicao } from "./arquivos";
import type { DocumentoView, EdicaoView } from "./tipos";

/**
 * O layout e a planilha que o cliente anexa à edição
 * (docs/superpowers/specs/2026-11-26-eventos-design.md, "Fotos e
 * documentos"; prancha docs/mockups/EventosPortalNovo.dc.html): a recusa
 * antes de subir, dita com o nome do arquivo; a linha de cada documento; e o
 * layout separado da planilha, só os do cliente.
 */

const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TIPO_DA_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xlsx: PLANILHA,
};

/** O tipo do arquivo; sem ele (o .xlsx em alguns Windows), o da extensão. */
export function tipoDoArquivo(arquivo: { name: string; type: string }): string {
  if (arquivo.type) return arquivo.type;
  const extensao = /\.([a-z0-9]+)$/i.exec(arquivo.name.trim())?.[1]?.toLowerCase() ?? "";
  return TIPO_DA_EXTENSAO[extensao] ?? "";
}

/** "produtos.xlsx: O documento passa de 10 MB."; com a edição cheia, a frase do servidor. */
export function problemaDoAnexo(arquivo: { name: string; type: string; size: number }, documentos: number): string | null {
  if (documentos >= LIMITES.documentos) return `A edição já tem ${LIMITES.documentos} documentos.`;
  const problema = problemaDoArquivoDaEdicao({ type: tipoDoArquivo(arquivo), size: arquivo.size }, "documento");
  return problema ? `${arquivo.name}: ${problema}` : null;
}

export function ehPlanilha(documento: Pick<DocumentoView, "tipo">): boolean {
  return documento.tipo === PLANILHA;
}

/** "layout-necton-2027.pdf · 1,2 MB". */
export function linhaDoDocumento(documento: Pick<DocumentoView, "nome" | "tamanho">): string {
  const tamanho = fileSize(documento.tamanho);
  return tamanho ? `${documento.nome} · ${tamanho}` : documento.nome;
}

/** Os documentos do cliente: o layout (PDF e imagem) e as planilhas; os da Dutelog ficam para a edição registrada. */
export function documentosDoCliente(edicao: Pick<EdicaoView, "documentos"> | null | undefined): { layout: DocumentoView[]; planilhas: DocumentoView[] } {
  const doCliente = (edicao?.documentos ?? []).filter((documento) => documento.origem === "cliente");
  return { layout: doCliente.filter((documento) => !ehPlanilha(documento)), planilhas: doCliente.filter(ehPlanilha) };
}
