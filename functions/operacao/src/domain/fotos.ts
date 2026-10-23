import { z } from "zod";

import {
  ETAPAS_DA_OS,
  chave,
  falha,
  informadoPor,
  instante,
  instanteDoRegistro,
  interpretar,
  invalid,
  meio,
  numero,
  origemDoRegistro,
  problemaParaRegistrar,
  registroLido,
  type ContextoDoRegistro,
  type EtapaDaOs,
  type RegistroDaExecucao,
} from "./execucao.js";
import type { OsGravada } from "./os.js";

/**
 * As fotos da OS (docs/plataforma/fase-3-operacao.md, parte 3.7c). A foto
 * sobe do navegador para o Storage em `os/{numero}/fotos/ft_<16 hex>.jpg`
 * (storage.rules: quem coordena ou está escalado, OS agendada ou em
 * execução, sem sobrescrever). `attachPhoto` confere que o arquivo chegou e é
 * uma imagem e só então grava a foto na OS, com o instante em que foi tirada
 * e, quando houver, a etapa, a ocorrência ou o item a que se refere. A
 * legenda ("Origem", "Sala 412") fica só na OS.
 */

export const MAX_FOTOS_POR_OS = 200;
export const MAX_LEGENDA = 60;
export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

const ARQUIVO = /^ft_[a-f0-9]{16}\.(jpg|png|webp)$/;

export type ArquivoNoStorage = { contentType: string; size: number };

export type FotoRegistrada = RegistroDaExecucao & {
  id: string;
  caminho: string;
  etapa: EtapaDaOs | null;
  ocorrencia: string | null;
  linha: string | null;
  legenda: string | null;
};

const opcional = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullable()
    .optional()
    .transform((valor: z.infer<T> | null | undefined) => valor ?? null);

const AnexarFoto = z
  .object({
    idempotency_key: chave,
    numero,
    arquivo: z.string().trim().regex(ARQUIVO, "Arquivo da foto inválido."),
    instante,
    etapa: opcional(z.enum(ETAPAS_DA_OS)),
    ocorrencia: opcional(z.string().trim().regex(/^oc_\d{2,3}$/, "Ocorrência inválida.")),
    linha: opcional(z.string().trim().min(1).max(64)),
    legenda: opcional(z.string().trim().min(1).max(MAX_LEGENDA, `Use até ${MAX_LEGENDA} caracteres na legenda.`)),
    informado_por: informadoPor,
    meio,
  })
  .strict();

export type PedidoDeFoto = z.infer<typeof AnexarFoto>;

export function interpretarFoto(data: unknown): PedidoDeFoto {
  return interpretar(AnexarFoto, data);
}

/** Onde o navegador sobe a foto (o mesmo caminho do storage.rules). */
export function caminhoDaFoto(numeroDaOs: string, arquivo: string): string {
  return `os/${numeroDaOs}/fotos/${arquivo}`;
}

export type FotoNaOs = { fotos: FotoRegistrada[]; registro: FotoRegistrada };

/**
 * Grava a foto na OS depois de conferir o arquivo no Storage. A ocorrência
 * e o item, quando informados, precisam existir na OS.
 */
export function registrarFoto(
  os: OsGravada,
  atuais: readonly FotoRegistrada[],
  pedido: PedidoDeFoto,
  contexto: ContextoDoRegistro,
  entrada: { arquivo: ArquivoNoStorage | null; ocorrencias: readonly string[]; linhas: readonly string[] },
): FotoNaOs {
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  const id = pedido.arquivo.replace(/\.[a-z]+$/, "");
  if (atuais.some((foto) => foto.id === id)) falha("A foto já está na OS.");
  if (atuais.length >= MAX_FOTOS_POR_OS) falha(`A OS já tem ${MAX_FOTOS_POR_OS} fotos.`);
  if (!entrada.arquivo) falha("A foto não chegou ao armazenamento. Envie de novo.");
  if (!(TIPOS_DE_FOTO as readonly string[]).includes(entrada.arquivo.contentType)) falha("O arquivo enviado não é uma foto.");
  if (pedido.ocorrencia && !entrada.ocorrencias.includes(pedido.ocorrencia)) invalid("A ocorrência não está na OS.");
  if (pedido.linha && !entrada.linhas.includes(pedido.linha)) invalid("O item não está na OS.");
  const registro: FotoRegistrada = {
    id,
    caminho: caminhoDaFoto(os.numero, pedido.arquivo),
    etapa: pedido.etapa,
    ocorrencia: pedido.ocorrencia,
    linha: pedido.linha,
    legenda: pedido.legenda,
    instante: instanteDoRegistro(pedido.instante, os, contexto.agora),
    canal: contexto.canal,
    ...origemDoRegistro(os, pedido, contexto.canal),
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };
  return { fotos: [...atuais, registro], registro };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** As fotos gravadas na OS; o que não se lê fica de fora. */
export function fotosLidas(data: Record<string, unknown>): FotoRegistrada[] {
  if (!Array.isArray(data.fotos)) return [];
  return data.fotos.flatMap((bruto): FotoRegistrada[] => {
    if (!bruto || typeof bruto !== "object") return [];
    const foto = bruto as Record<string, unknown>;
    const registro = registroLido(foto);
    const id = texto(foto.id);
    const caminho = texto(foto.caminho);
    if (!registro || !id || !caminho) return [];
    const etapa = texto(foto.etapa);
    return [
      {
        ...registro,
        id,
        caminho,
        etapa: (ETAPAS_DA_OS as readonly string[]).includes(etapa) ? (etapa as EtapaDaOs) : null,
        ocorrencia: texto(foto.ocorrencia) || null,
        linha: texto(foto.linha) || null,
        legenda: texto(foto.legenda) || null,
      },
    ];
  });
}
