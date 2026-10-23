import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  chave,
  falha,
  instante,
  instanteDoRegistro,
  interpretar,
  invalid,
  numero,
  problemaParaRegistrar,
  type CanalDoRegistro,
  type ContextoDoRegistro,
  type QuemRegistrou,
} from "./execucao.js";
import type { OsGravada } from "./os.js";

/**
 * A presença da equipe na OS (docs/plataforma/fase-3-operacao.md, parte
 * 3.8a): a entrada e a saída de cada pessoa. É o que paga a diária do
 * freelancer e do terceiro (o valor fica no RH e no Financeiro, nunca na
 * OS). O líder marca a presença de toda a equipe; quem tem o app também se
 * registra; vale o primeiro registro. O escritório também marca.
 */

export const TIPOS_DE_PRESENCA = ["entrada", "saida"] as const;
export type TipoDePresenca = (typeof TIPOS_DE_PRESENCA)[number];

export type MarcaDePresenca = {
  instante: string;
  canal: CanalDoRegistro;
  registrado_por: QuemRegistrou;
  /** O colaborador ligado ao login de quem marcou (no celular), ou null. */
  por_colaborador: string | null;
  registrado_em: string;
};

export type PresencaNaOs = { colaborador_id: string; entrada: MarcaDePresenca | null; saida: MarcaDePresenca | null };

const MarcarPresenca = z
  .object({
    idempotency_key: chave,
    numero,
    colaborador_id: z.string().regex(/^col_[a-f0-9]{16}$/, "Colaborador inválido."),
    tipo: z.enum(TIPOS_DE_PRESENCA),
    instante,
  })
  .strict();

export type PedidoDePresenca = z.infer<typeof MarcarPresenca>;

export function interpretarPresenca(data: unknown): PedidoDePresenca {
  return interpretar(MarcarPresenca, data);
}

function horaEmSaoPaulo(instanteUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instanteUtc));
}

export type PresencaRegistrada = { presencas: PresencaNaOs[]; marca: MarcaDePresenca; registrada: boolean };

/**
 * Marca a entrada ou a saída. No celular, quem não é o líder da OS só marca a
 * própria. A marca que já existe fica (vale a primeira): o resultado diz que
 * nada mudou. A saída pede a entrada antes, e não vem antes dela.
 */
export function registrarPresenca(os: OsGravada, atuais: readonly PresencaNaOs[], pedido: PedidoDePresenca, contexto: ContextoDoRegistro): PresencaRegistrada {
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  const pessoa = os.equipe.find((integrante) => integrante.colaborador_id === pedido.colaborador_id);
  if (!pessoa) invalid("A pessoa não está na equipe da OS.");
  if (contexto.canal === "celular") {
    const lider = os.equipe.some((integrante) => integrante.colaborador_id === contexto.informante && integrante.papel === "lider");
    if (!lider && pedido.colaborador_id !== contexto.informante) {
      throw new HttpsError("permission-denied", "Só o líder marca a presença de outra pessoa.");
    }
  }
  const marca: MarcaDePresenca = {
    instante: instanteDoRegistro(pedido.instante, os, contexto.agora),
    canal: contexto.canal,
    registrado_por: contexto.registrado_por,
    por_colaborador: contexto.canal === "celular" ? (contexto.informante ?? null) : null,
    registrado_em: contexto.agora.toISOString(),
  };
  const atual = atuais.find((presenca) => presenca.colaborador_id === pedido.colaborador_id) ?? { colaborador_id: pedido.colaborador_id, entrada: null, saida: null };
  if (pedido.tipo === "entrada") {
    if (atual.entrada) return { presencas: [...atuais], marca: atual.entrada, registrada: false };
    if (atual.saida && marca.instante > atual.saida.instante) falha(`A entrada vem depois da saída (${horaEmSaoPaulo(atual.saida.instante)}).`);
  } else {
    if (atual.saida) return { presencas: [...atuais], marca: atual.saida, registrada: false };
    if (!atual.entrada) falha(`Registre a entrada de ${pessoa.nome || "quem saiu"} antes da saída.`);
    if (marca.instante < atual.entrada.instante) falha(`A saída vem antes da entrada (${horaEmSaoPaulo(atual.entrada.instante)}).`);
  }
  const nova: PresencaNaOs = { ...atual, [pedido.tipo]: marca };
  const presencas = atuais.some((presenca) => presenca.colaborador_id === pedido.colaborador_id)
    ? atuais.map((presenca) => (presenca.colaborador_id === pedido.colaborador_id ? nova : presenca))
    : [...atuais, nova];
  return { presencas, marca, registrada: true };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function marcaLida(bruto: unknown): MarcaDePresenca | null {
  if (!bruto || typeof bruto !== "object") return null;
  const marca = bruto as Record<string, unknown>;
  const quando = texto(marca.instante);
  if (!quando || Number.isNaN(new Date(quando).getTime())) return null;
  const quem = marca.registrado_por && typeof marca.registrado_por === "object" ? (marca.registrado_por as Record<string, unknown>) : {};
  return {
    instante: quando,
    canal: marca.canal === "celular" ? "celular" : "escritorio",
    registrado_por: { uid: texto(quem.uid), role: texto(quem.role) },
    por_colaborador: texto(marca.por_colaborador) || null,
    registrado_em: texto(marca.registrado_em),
  };
}

/** As presenças gravadas na OS; o que não se lê fica de fora. */
export function presencasLidas(data: Record<string, unknown>): PresencaNaOs[] {
  if (!Array.isArray(data.presencas)) return [];
  return data.presencas.flatMap((bruto): PresencaNaOs[] => {
    if (!bruto || typeof bruto !== "object") return [];
    const presenca = bruto as Record<string, unknown>;
    const colaborador = texto(presenca.colaborador_id);
    return colaborador ? [{ colaborador_id: colaborador, entrada: marcaLida(presenca.entrada), saida: marcaLida(presenca.saida) }] : [];
  });
}
