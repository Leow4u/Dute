import type { z } from "zod";

import type { EscopoDoAgente, ModuloDoAgente } from "./agente-escopo.js";
import type { LeitorDoAgente } from "./agente-leitor.js";

/**
 * As ferramentas do Agent Dute do núcleo (docs/plataforma/fase-5-memoria.md,
 * partes 5.5c e 5.5d). Cada uma recebe o leitor do escopo, nunca o banco: só
 * lê, e só do cliente da conversa. A entrada é o que o modelo escolhe, e
 * nunca tem o cliente. Quem recebe cada ferramenta sai do módulo e do papel,
 * no servidor.
 */

export type ContextoDaFerramenta = {
  leitor: LeitorDoAgente;
  escopo: EscopoDoAgente;
  agora: Date;
  /** A conversa em andamento: as conversas anteriores a deixam de fora. */
  conversaId?: string;
};

export type FerramentaDoAgente<S extends z.ZodRawShape = z.ZodRawShape> = {
  nome: string;
  descricao: string;
  /** O módulo da ferramenta; null vale em todos. */
  modulo: ModuloDoAgente | null;
  entrada: z.ZodObject<S>;
  /** Quem recebe, dentro do módulo: o papel e a audiência. */
  para: (escopo: EscopoDoAgente) => boolean;
  executar: (contexto: ContextoDaFerramenta, entrada: z.infer<z.ZodObject<S>>) => Promise<unknown>;
};

/** Define a ferramenta com o tipo da entrada amarrado ao esquema. */
export function ferramenta<S extends z.ZodRawShape>(definicao: FerramentaDoAgente<S>): FerramentaDoAgente {
  return definicao as unknown as FerramentaDoAgente;
}

/** As ferramentas que a pessoa recebe nesta conversa: as dos módulos dela que o papel abre. */
export function ferramentasDoEscopo(escopo: EscopoDoAgente, ferramentas: readonly FerramentaDoAgente[]): FerramentaDoAgente[] {
  return ferramentas.filter((item) => (item.modulo === null || escopo.modulos.includes(item.modulo)) && item.para(escopo));
}

/** Roda a ferramenta com a entrada conferida pelo esquema; a entrada inválida volta como erro para o modelo. */
export async function executarFerramenta(item: FerramentaDoAgente, contexto: ContextoDaFerramenta, entrada: unknown): Promise<unknown> {
  const lida = item.entrada.safeParse(entrada ?? {});
  if (!lida.success) return { erro: lida.error.issues[0]?.message ?? "Entrada inválida." };
  return item.executar(contexto, lida.data);
}

// --- Leitura dos registros ------------------------------------------------------------------

export function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

export function numero(valor: unknown): number {
  const lido = Number(valor);
  return Number.isFinite(lido) ? lido : 0;
}

export function normalizado(valor: unknown): string {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** O instante em ISO. O leitor já entrega o Timestamp como texto; o `{seconds}` de importação antiga também vale. */
export function instante(valor: unknown): string | undefined {
  if (typeof valor === "string" && valor.trim()) {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? undefined : data.toISOString();
  }
  if (valor && typeof valor === "object") {
    const registro = valor as { seconds?: unknown; _seconds?: unknown };
    const segundos = Number(registro.seconds ?? registro._seconds);
    if (Number.isFinite(segundos)) return new Date(segundos * 1000).toISOString();
  }
  return undefined;
}

/** Cada palavra da busca aparece em algum dos valores, sem acento nem caixa. */
export function bate(busca: string | undefined, ...valores: unknown[]): boolean {
  const palavras = normalizado(busca).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  const palheiro = valores.map(normalizado).join(" ");
  return palavras.every((palavra) => palheiro.includes(palavra));
}

const DIA_MS = 86_400_000;

export function diasDesde(valor: unknown, agora: Date): number | undefined {
  const lido = instante(valor);
  return lido ? Math.max(0, Math.floor((agora.getTime() - Date.parse(lido)) / DIA_MS)) : undefined;
}
