import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

/**
 * Núcleo da OS (docs/plataforma/fase-3-operacao.md). A demanda em Para
 * planejar vira OS 10045-01. Os itens saem da revisão fechada, sem preço.
 * Agendar entra na parte 3. Executar e concluir ficam para a próxima parte.
 */

export const SERVICE_ORDERS_COLLECTION = "service_orders";
export const SERVICE_ORDER_COUNTERS_COLLECTION = "service_order_counters";

const DEMANDA = /^\d{5,8}$/;
const NUMERO = /^\d{5,8}-\d{2}$/;

export type ItemDaOs = {
  id: string;
  lpu_item_id: string | null;
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  quantidade: string;
  origem_local: string | null;
  destino_local: string | null;
};

export type AgendaDaOs = {
  data: string;
  hora: string | null;
  equipe: string[];
  veiculo_id: string;
};

export type OsGravada = {
  numero: string;
  demanda: string;
  seq: number;
  customer_code: string;
  status: "aberta" | "agendada" | "cancelada";
  escopo_rv: number;
  itens: ItemDaOs[];
  origem_local_id: string | null;
  destino_local_id: string | null;
  edicao: number;
  cancelamento: { motivo: string } | null;
  agenda: AgendaDaOs | null;
};

export type AberturaDaOs = {
  numero: string;
  seq: number;
  customer_code: string;
  escopo_rv: number;
  itens: ItemDaOs[];
  origem_local_id: string | null;
  destino_local_id: string | null;
};

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  return { message: `${campo}: valor inválido.` };
};

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const demanda = z.string().trim().regex(DEMANDA, "Número da demanda inválido.");
const numero = z.string().trim().regex(NUMERO, "Número da OS inválido.");
const motivo = z.string().trim().min(3, "Informe o motivo do cancelamento.").max(200, "Use até 200 caracteres no motivo.");

const Criar = z.object({ action: z.literal("create"), idempotency_key: chave, demanda }).strict();
const Cancelar = z
  .object({
    action: z.literal("cancel"),
    idempotency_key: chave,
    numero,
    expected_edicao: z.number().int().min(1).max(100_000),
    motivo,
  })
  .strict();

const idColaborador = z.string().regex(/^col_[a-f0-9]{16}$/, "Colaborador inválido.");
const idVeiculo = z.string().regex(/^vei_[a-f0-9]{16}$/, "Veículo inválido.");
const Agendar = z
  .object({
    action: z.literal("schedule"),
    idempotency_key: chave,
    numero,
    expected_edicao: z.number().int().min(1).max(100_000),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    hora: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida.")
      .nullable()
      .optional(),
    equipe: z.array(idColaborador).min(1, "Escolha ao menos uma pessoa.").max(12, "A equipe passa de 12 pessoas."),
    veiculo_id: idVeiculo,
  })
  .strict();

export type AcaoOs =
  | { action: "create"; idempotency_key: string; demanda: string }
  | { action: "cancel"; idempotency_key: string; numero: string; expected_edicao: number; motivo: string }
  | {
      action: "schedule";
      idempotency_key: string;
      numero: string;
      expected_edicao: number;
      data: string;
      hora?: string | null;
      equipe: string[];
      veiculo_id: string;
    };

export function interpretarOs(data: unknown): AcaoOs {
  const parsed = z.discriminatedUnion("action", [Criar, Cancelar, Agendar]).safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  if (parsed.data.action === "schedule" && new Set(parsed.data.equipe).size !== parsed.data.equipe.length) {
    invalid("A equipe tem pessoa repetida.");
  }
  return parsed.data;
}

function dataCalendario(value: string): boolean {
  const ano = Number(value.slice(0, 4));
  const mes = Number(value.slice(5, 7));
  const dia = Number(value.slice(8, 10));
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

/** A data do agendamento, comparada com o dia de hoje em AAAA-MM-DD. */
export function problemaDaData(data: string, hoje: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !dataCalendario(data)) return "Data inválida.";
  if (data < hoje) return "A data do agendamento já passou.";
  return null;
}

function preenchido(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== false;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export type DemandaParaOs = {
  customer_code?: unknown;
  escopo_rv?: unknown;
  executado_de?: unknown;
  perda?: unknown;
  cancelamento?: unknown;
  validacao?: unknown;
};

export type OrcamentoParaOs = {
  status?: unknown;
  rv?: unknown;
  customer_code?: unknown;
};

/** Por que a demanda não está em Para planejar, ou null quando a OS pode nascer. */
export function problemaParaAbrirOs(demanda: DemandaParaOs, orcamento: OrcamentoParaOs | null): string | null {
  if (!orcamento) return "A demanda não tem orçamento para virar OS.";
  const code = texto(demanda.customer_code);
  const codeOrcamento = texto(orcamento.customer_code);
  if (!code || code !== codeOrcamento) return "A demanda e o orçamento não são do mesmo cliente.";
  const rv = orcamento.rv;
  const escopo = demanda.escopo_rv;
  const validacao = demanda.validacao as { rv?: unknown } | null | undefined;
  const validadaNestaRv = Boolean(validacao && typeof validacao === "object" && validacao.rv === rv);
  const executada = texto(demanda.executado_de).length > 0;
  const paraPlanejar =
    orcamento.status === "enviado" &&
    typeof rv === "number" &&
    Number.isInteger(rv) &&
    escopo === rv &&
    !executada &&
    !preenchido(demanda.perda) &&
    !preenchido(demanda.cancelamento) &&
    !validadaNestaRv;
  if (!paraPlanejar) return "A OS nasce de uma demanda em Para planejar.";
  return null;
}

export function numeroDaOs(demanda: string, seq: number): string {
  if (!DEMANDA.test(demanda)) throw new HttpsError("internal", `Número da demanda inválido: ${demanda}.`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99) throw new HttpsError("internal", `Sequência da OS inválida: ${seq}.`);
  return `${demanda}-${String(seq).padStart(2, "0")}`;
}

export function proximaSequencia(ultimo: unknown): number {
  const base = ultimo === undefined || ultimo === null ? 0 : ultimo;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
    throw new HttpsError("failed-precondition", "O contador da OS está inválido.");
  }
  if (base >= 99) throw new HttpsError("failed-precondition", "A demanda chegou ao fim da sequência de OS.");
  return base + 1;
}

function textoOuNull(valor: unknown): string | null {
  const textoLimpo = texto(valor);
  return textoLimpo || null;
}

/** Itens de serviço da revisão fechada. Preço, motivo e linha de ajuste ficam de fora. */
export function itensSemPreco(valor: unknown): ItemDaOs[] {
  if (!Array.isArray(valor)) throw new HttpsError("failed-precondition", "A revisão fechada não tem itens.");
  const itens: ItemDaOs[] = [];
  for (const bruto of valor) {
    if (!bruto || typeof bruto !== "object") throw new HttpsError("failed-precondition", "Um item da revisão fechada está incompleto.");
    const linha = bruto as Record<string, unknown>;
    if (linha.origem === "ajuste") continue;
    const id = texto(linha.id);
    const item = texto(linha.item);
    const quantidade = texto(linha.quantidade);
    if (!id || !item || !quantidade) throw new HttpsError("failed-precondition", "Um item da revisão fechada está incompleto.");
    itens.push({
      id,
      lpu_item_id: textoOuNull(linha.lpu_item_id),
      codigo: textoOuNull(linha.codigo),
      item,
      descricao: texto(linha.descricao) || item,
      servico: textoOuNull(linha.servico),
      unidade: textoOuNull(linha.unidade),
      quantidade,
      origem_local: textoOuNull(linha.origem_local),
      destino_local: textoOuNull(linha.destino_local),
    });
  }
  if (itens.length === 0) throw new HttpsError("failed-precondition", "A demanda fechada não tem item de serviço.");
  return itens;
}

export function localDaDemanda(valor: unknown): string | null {
  if (!valor || typeof valor !== "object") return null;
  return textoOuNull((valor as { local_id?: unknown }).local_id);
}

export type EfeitoOs = { documento: OsGravada; evento: "os.created" | "os.cancelled" | "os.scheduled" };

export function aplicarOs(atual: OsGravada | null, acao: AcaoOs, abertura: AberturaDaOs | null): EfeitoOs {
  if (acao.action === "create") {
    if (atual) throw new HttpsError("internal", "Criar não recebe uma OS que já existe.");
    if (!abertura) throw new HttpsError("internal", "Abrir a OS sem o escopo da demanda.");
    if (abertura.numero !== numeroDaOs(acao.demanda, abertura.seq)) {
      throw new HttpsError("internal", "O número da OS não confere com a demanda.");
    }
    return {
      evento: "os.created",
      documento: {
        numero: abertura.numero,
        demanda: acao.demanda,
        seq: abertura.seq,
        customer_code: abertura.customer_code,
        status: "aberta",
        escopo_rv: abertura.escopo_rv,
        itens: abertura.itens,
        origem_local_id: abertura.origem_local_id,
        destino_local_id: abertura.destino_local_id,
        edicao: 1,
        cancelamento: null,
        agenda: null,
      },
    };
  }
  if (acao.action === "schedule") {
    if (!atual) throw new HttpsError("not-found", "OS não encontrada.");
    if (atual.numero !== acao.numero) throw new HttpsError("internal", "O número da OS não confere.");
    if (atual.edicao !== acao.expected_edicao) {
      throw new HttpsError("failed-precondition", "A OS foi atualizada. Recarregue e tente de novo.");
    }
    if (atual.status === "cancelada") throw new HttpsError("failed-precondition", "A OS já está cancelada.");
    if (atual.status !== "aberta" && atual.status !== "agendada") {
      throw new HttpsError("failed-precondition", "Só uma OS aberta ou agendada pode ser agendada.");
    }
    return {
      evento: "os.scheduled",
      documento: {
        ...atual,
        status: "agendada",
        edicao: atual.edicao + 1,
        agenda: {
          data: acao.data,
          hora: acao.hora ?? null,
          equipe: acao.equipe,
          veiculo_id: acao.veiculo_id,
        },
      },
    };
  }
  if (!atual) throw new HttpsError("not-found", "OS não encontrada.");
  if (atual.numero !== acao.numero) throw new HttpsError("internal", "O número da OS não confere.");
  if (atual.edicao !== acao.expected_edicao) {
    throw new HttpsError("failed-precondition", "A OS foi atualizada. Recarregue e tente de novo.");
  }
  if (atual.status === "cancelada") throw new HttpsError("failed-precondition", "A OS já está cancelada.");
  if (atual.status !== "aberta" && atual.status !== "agendada") {
    throw new HttpsError("failed-precondition", "Só uma OS aberta ou agendada pode ser cancelada.");
  }
  return {
    evento: "os.cancelled",
    documento: {
      ...atual,
      status: "cancelada",
      edicao: atual.edicao + 1,
      cancelamento: { motivo: acao.motivo },
    },
  };
}
