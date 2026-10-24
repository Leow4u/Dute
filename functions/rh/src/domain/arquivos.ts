import { randomBytes } from "node:crypto";

import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { ID_REGISTRO, parseEntrada, type RegistroGravado } from "./ficha.js";

/**
 * Os arquivos da ficha (docs/plataforma/fase-8-rh.md, parte 8.2b): o
 * documento, o exame ou o certificado escaneado de um registro. Ficam no
 * Storage em `rh/{colaborador}/{registro}/{arquivo}`, fechados ao navegador
 * pelas regras (o storage.rules nega tudo fora dos caminhos que ele abre).
 * Sobem e abrem por URL assinada da callable, que confere o papel; cada
 * abertura vira evento. O arquivo trocado continua no bucket: o registro
 * guarda os anteriores.
 *
 * O registro guarda a geração do objeto que o anexo conferiu, e a abertura
 * pede só ela: o arquivo regravado pela mesma URL de envio, nos minutos em
 * que ela vale, não toma o lugar do conferido sem o evento.
 */

export const TIPOS_DE_ARQUIVO = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type TipoDeArquivo = keyof typeof TIPOS_DE_ARQUIVO;

export const TAMANHO_MAXIMO_DO_ARQUIVO = 10 * 1024 * 1024;
export const ID_ARQUIVO = /^arq_[a-f0-9]{16}$/;

export type ArquivoDoRegistro = {
  id: string;
  caminho: string;
  content_type: TipoDeArquivo;
  tamanho: number;
  /** A geração do objeto conferido no anexo; null no arquivo anexado antes dela. */
  geracao: string | null;
};

export function novoIdDeArquivo(): string {
  return `arq_${randomBytes(8).toString("hex")}`;
}

export function tipoDeArquivo(valor: unknown): valor is TipoDeArquivo {
  return typeof valor === "string" && Object.hasOwn(TIPOS_DE_ARQUIVO, valor);
}

/** O caminho no bucket, do colaborador, do registro e do arquivo. */
export function caminhoDoArquivo(registro: Pick<RegistroGravado, "id" | "colaborador_id">, arquivoId: string, contentType: TipoDeArquivo): string {
  return `rh/${registro.colaborador_id}/${registro.id}/${arquivoId}.${TIPOS_DE_ARQUIVO[contentType]}`;
}

const registroId = z.string().regex(ID_REGISTRO, "Registro inválido.");
const arquivoId = z.string().regex(ID_ARQUIVO, "Arquivo inválido.");
const contentType = z.string().refine(tipoDeArquivo, "Envie PDF, JPG, PNG ou WebP.");
const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const edicao = z.number().int().min(1).max(100_000);

const envioSchema = z
  .object({
    registro_id: registroId,
    content_type: contentType,
    tamanho: z.number().int().min(1, "O arquivo está vazio.").max(TAMANHO_MAXIMO_DO_ARQUIVO, "O arquivo passa de 10 MB."),
  })
  .strict();

export type EntradaDoEnvio = { registro_id: string; content_type: TipoDeArquivo; tamanho: number };

/** requestRhUpload: o registro, o tipo e o tamanho do arquivo que vai subir. */
export function entradaDoEnvio(data: unknown): EntradaDoEnvio {
  return parseEntrada(envioSchema, data) as EntradaDoEnvio;
}

const anexoSchema = z
  .object({ idempotency_key: chave, registro_id: registroId, arquivo_id: arquivoId, content_type: contentType, expected_edicao: edicao })
  .strict();

export type EntradaDoAnexo = { idempotency_key: string; registro_id: string; arquivo_id: string; content_type: TipoDeArquivo; expected_edicao: number };

/** attachRhFile: o arquivo que subiu, para ligar ao registro. */
export function entradaDoAnexo(data: unknown): EntradaDoAnexo {
  return parseEntrada(anexoSchema, data) as EntradaDoAnexo;
}

const aberturaSchema = z.object({ registro_id: registroId }).strict();

export function entradaDaAbertura(data: unknown): { registro_id: string } {
  return parseEntrada(aberturaSchema, data);
}

/** O que o bucket diz do arquivo: o tipo, o tamanho e a geração, ou null quando ele não existe. */
export type ArquivoNoBucket = { contentType: string; size: number; generation: string };

/** O que o arquivo no bucket tem de errado, ou null quando confere com o que a pessoa disse que subiu. */
export function problemaDoArquivoNoBucket(noBucket: ArquivoNoBucket, esperado: TipoDeArquivo): string | null {
  if (noBucket.contentType !== esperado) return "O arquivo enviado não é do tipo informado. Envie de novo.";
  if (noBucket.size < 1) return "O arquivo está vazio.";
  if (noBucket.size > TAMANHO_MAXIMO_DO_ARQUIVO) return "O arquivo passa de 10 MB.";
  return null;
}

/** O arquivo no bucket confere: o tamanho e a geração que o registro guarda. */
export function conferirArquivoNoBucket(noBucket: ArquivoNoBucket | null, esperado: TipoDeArquivo): { tamanho: number; geracao: string | null } {
  if (!noBucket) throw new HttpsError("failed-precondition", "O arquivo não chegou. Envie de novo.");
  const problema = problemaDoArquivoNoBucket(noBucket, esperado);
  if (problema) throw new HttpsError("failed-precondition", problema);
  return { tamanho: noBucket.size, geracao: /^\d+$/.test(noBucket.generation) ? noBucket.generation : null };
}

/**
 * O registro com o arquivo novo: a edição sobe, e o anterior (quando havia)
 * sai do registro e continua no bucket.
 */
export function registroComArquivo(atual: RegistroGravado, esperada: number, arquivo: ArquivoDoRegistro): RegistroGravado {
  if (atual.edicao !== esperada) throw new HttpsError("failed-precondition", "O registro foi atualizado. Recarregue e tente de novo.");
  if (atual.situacao === "arquivado") throw new HttpsError("failed-precondition", "O registro está arquivado.");
  return { ...atual, arquivo, edicao: atual.edicao + 1 };
}
