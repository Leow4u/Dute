import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { digest } from "./operations.js";

/**
 * A demanda direta (docs/plataforma/fase-3-operacao.md, parte 3.4d): o
 * paraquedas e o emergencial que chegam direto na Operação e se orçam depois
 * da execução. Nasce no mesmo `demands/{numero}` do Comercial, com o número do
 * mesmo contador, sem orçamento, em Para planejar (o `etapaDaDemanda` do
 * Comercial reconhece a direta sem orçamento desde a parte 3.4c). Os itens
 * pedidos vão sem preço em `itens_pedidos`: são o escopo das OS dela.
 *
 * As constantes do Comercial abaixo são cópias literais de
 * functions/comercial/src/domain/demanda.ts e events.ts, travadas por
 * demanda-direta.test.ts.
 */

export const DEMANDS_COLLECTION = "demands";
export const QUOTES_COLLECTION = "quotes";
export const DEMAND_COUNTERS_COLLECTION = "demand_counters";
export const DEMAND_COUNTER_ID = "geral";
export const DEMAND_SCHEMA_VERSION = 1;
export const PRIMEIRO_NUMERO = 10001;
export const ULTIMO_NUMERO = 99_999_999;
export const TIPOS_DEMANDA = ["planejada", "emergencial", "paraquedas"] as const;
export type TipoDemanda = (typeof TIPOS_DEMANDA)[number];
/** Os canais do Comercial (CANAIS_DEMANDA) por onde um pedido chega direto à Operação. */
export const CANAIS_DA_DIRETA = ["telefone", "whatsapp", "email", "portal"] as const;

/** Até quantas horas corridas a demanda é emergencial. */
export const HORAS_DO_EMERGENCIAL = 48;
/** Folga do relógio para o "recebida em" no futuro (a do Comercial). */
export const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;

const INSTANTE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function dataValida(valor: string): boolean {
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function instante(rotulo: string) {
  return z
    .string()
    .trim()
    .refine((valor) => {
      const partes = INSTANTE.exec(valor);
      return partes !== null && dataValida(partes[1]) && !Number.isNaN(Date.parse(valor));
    }, `${rotulo}: informe a data e a hora, com o fuso (ex.: 2026-10-23T13:05-03:00).`)
    .transform((valor) => new Date(valor).toISOString());
}

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  if (issue.code === z.ZodIssueCode.invalid_enum_value) return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
  return { message: `${campo}: valor inválido.` };
};

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function falha(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

const textoOpcional = (max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres em ${rotulo}.`)
    .nullable()
    .optional()
    .transform((valor) => (valor ? valor.replace(/\s+/g, " ") : null));

const localPedido = z
  .object({
    local_id: z.string().trim().min(1).max(120).nullable().optional(),
    complemento: textoOpcional(120, "andar ou sala"),
  })
  .strict()
  .transform((valor) => ({ local_id: valor.local_id ?? null, complemento: valor.complemento ?? null }));

const itemPedido = z
  .object({
    lpu_item_id: z.string().trim().min(1).max(120).nullable().optional(),
    item: textoOpcional(120, "item"),
    unidade: textoOpcional(12, "unidade"),
    quantidade: z.string().trim().regex(QUANTIDADE, "Quantidade inválida: use número com ponto e até 3 casas."),
  })
  .strict()
  .refine((valor) => Number(valor.quantidade) > 0, "Informe uma quantidade maior que zero.")
  .refine((valor) => Boolean(valor.lpu_item_id) || Boolean(valor.item && valor.unidade), "Item avulso: informe o nome e a unidade.");

const AbrirDemandaDireta = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    customer_code: z.string().trim().min(1, "Informe o cliente.").max(80),
    titulo: z.string().trim().min(2, "Informe o título da demanda.").max(120, "Use até 120 caracteres no título."),
    canal: z.enum(CANAIS_DA_DIRETA),
    pedido_por: z
      .object({
        nome: z.string().trim().min(2, "Informe quem pediu.").max(80, "Use até 80 caracteres em quem pediu."),
        telefone: z
          .string()
          .trim()
          .nullable()
          .optional()
          .transform((valor) => (valor ? valor.replace(/[\s().-]/g, "") : null))
          .refine((valor) => valor == null || /^\+?\d{8,15}$/.test(valor), "Telefone de quem pediu inválido: use DDD e número."),
      })
      .strict()
      .transform((valor) => ({ nome: valor.nome.replace(/\s+/g, " "), telefone: valor.telefone ?? null }))
      .nullable()
      .optional(),
    recebida_em: instante("Recebida em"),
    executar_ate: instante("Executar até"),
    tipo: z.enum(TIPOS_DEMANDA).optional(),
    origem: localPedido.nullable().optional(),
    destino: localPedido.nullable().optional(),
    itens: z.array(itemPedido).min(1, "Informe ao menos um item.").max(100, "A demanda passa de 100 itens."),
  })
  .strict();

export type PedidoDeDemandaDireta = z.infer<typeof AbrirDemandaDireta>;
export type ItemDoPedido = z.infer<typeof itemPedido>;

export function interpretarDemandaDireta(data: unknown): PedidoDeDemandaDireta {
  const parsed = AbrirDemandaDireta.safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

/** "Recebida em" no futuro (além da folga) e "executar até" antes de receber são engano de digitação. */
export function problemaDosInstantes(recebidaEm: string, executarAte: string, agora: Date): string | null {
  if (Date.parse(recebidaEm) > agora.getTime() + FOLGA_DO_RELOGIO_MS) return "Recebida em não pode ser depois de agora.";
  if (Date.parse(executarAte) <= Date.parse(recebidaEm)) return "Executar até vem depois de quando o pedido foi recebido.";
  return null;
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * O tipo pela hora do pedido e pela hora pedida para a execução: paraquedas
 * no mesmo dia (em São Paulo), emergencial até 48 horas corridas, planejada
 * depois disso.
 */
export function tipoPelaHora(recebidaEm: string, executarAte: string): TipoDemanda {
  const recebida = new Date(recebidaEm);
  const prazo = new Date(executarAte);
  if (DIA_EM_SAO_PAULO.format(recebida) === DIA_EM_SAO_PAULO.format(prazo)) return "paraquedas";
  if (prazo.getTime() - recebida.getTime() <= HORAS_DO_EMERGENCIAL * 3_600_000) return "emergencial";
  return "planejada";
}

/** O próximo número do contador do Comercial (cópia de proximoNumero, em functions/comercial). */
export function proximoNumeroDaDemanda(ultimo: unknown): string {
  if (ultimo === undefined || ultimo === null) return String(PRIMEIRO_NUMERO);
  if (typeof ultimo !== "number" || !Number.isSafeInteger(ultimo) || ultimo < 0) {
    falha(`O contador de demandas está com um valor inválido (${JSON.stringify(ultimo) ?? String(ultimo)}).`);
  }
  if (ultimo >= ULTIMO_NUMERO) falha(`O contador de demandas chegou ao fim da faixa (${ultimo}).`);
  return String(Math.max(ultimo + 1, PRIMEIRO_NUMERO));
}

export type ItemDoCatalogo = { id: string; item: string; descricao: string; servico: string; unidade: string; ativo: boolean; orcavel: boolean };

/** O item pedido, sem preço, no formato das linhas do escopo (o que a OS lê). */
export type ItemPedidoGravado = {
  id: string;
  lpu_item_id: string | null;
  codigo: null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  quantidade: string;
  origem_local: string | null;
  destino_local: string | null;
};

/** O id da linha, como o Comercial dá (ln_ + 16 do digest da operação e da posição). */
export function idDaLinha(operationId: string, indice: number): string {
  return `ln_${digest({ operationId, indice }, 16)}`;
}

/**
 * Os itens pedidos com o que o catálogo diz (nome, serviço e unidade) ou,
 * no avulso, o que foi digitado. Item fora do catálogo, inativo ou que não
 * se orça é recusado. Nunca preço.
 */
export function itensDoPedido(
  pedidos: readonly ItemDoPedido[],
  catalogo: ReadonlyMap<string, ItemDoCatalogo>,
  operationId: string,
  locais: { origem: string | null; destino: string | null },
): ItemPedidoGravado[] {
  return pedidos.map((pedido, indice) => {
    const base = { id: idDaLinha(operationId, indice), codigo: null, quantidade: pedido.quantidade, origem_local: locais.origem, destino_local: locais.destino };
    if (!pedido.lpu_item_id) {
      const nome = pedido.item ?? "";
      return { ...base, lpu_item_id: null, item: nome, descricao: nome, servico: null, unidade: pedido.unidade ?? null };
    }
    const doCatalogo = catalogo.get(pedido.lpu_item_id);
    if (!doCatalogo) falha(`O item ${pedido.lpu_item_id} não está no catálogo.`);
    if (!doCatalogo.ativo) falha(`O item ${doCatalogo.item} está inativo no catálogo.`);
    if (!doCatalogo.orcavel) falha(`O item ${doCatalogo.item} não se pede numa demanda (é de armazenagem).`);
    return {
      ...base,
      lpu_item_id: doCatalogo.id,
      item: doCatalogo.item,
      descricao: doCatalogo.descricao || doCatalogo.item,
      servico: doCatalogo.servico || null,
      unidade: doCatalogo.unidade || null,
    };
  });
}

export type DemandaDiretaNova = {
  numero: string;
  customer_code: string;
  customer_name: string;
  pedido: PedidoDeDemandaDireta;
  tipo: TipoDemanda;
  tipo_calculado: TipoDemanda;
  itens: ItemPedidoGravado[];
  iso: string;
  uid: string;
};

/**
 * O documento da demanda direta, no esquema do Comercial (demandaNova em
 * functions/comercial/src/domain/quotes.ts), com o que é da direta: quem
 * pediu (sem contato do cadastro, que a Operação não lê), executar até, o
 * tipo calculado e a correção, e os itens pedidos.
 */
export function documentoDaDemandaDireta(dados: DemandaDiretaNova): Record<string, unknown> {
  const etapa = "para_planejar";
  const corrigido = dados.tipo !== dados.tipo_calculado;
  return {
    numero: dados.numero,
    customer_code: dados.customer_code,
    customer_name: dados.customer_name,
    contrato_id: null,
    cobranca: "por_demanda",
    entrada: "direta",
    canal: dados.pedido.canal,
    tipo: dados.tipo,
    tipo_calculado: dados.tipo_calculado,
    tipo_corrigido_por: corrigido ? dados.uid : null,
    titulo: dados.pedido.titulo,
    ref_cliente: null,
    solicitante: null,
    pedido_por: dados.pedido.pedido_por ?? null,
    recebida_em: dados.pedido.recebida_em,
    pedido_em: dados.pedido.recebida_em,
    executar_ate: dados.pedido.executar_ate,
    email_assunto: null,
    email_link: null,
    origem: dados.pedido.origem ?? null,
    destino: dados.pedido.destino ?? null,
    execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null },
    etapa,
    etapa_desde: dados.iso,
    marcos: [{ etapa, em: dados.iso, por_uid: dados.uid }],
    numero_legado: null,
    duplicado_de: null,
    escopo_rv: null,
    escopo_origem: null,
    escopo: [],
    itens_pedidos: dados.itens,
    executado_de: null,
    executado_ate: null,
    registro_execucao: null,
    aditivos_recusados: [],
    validacao: null,
    medicao_pendente: false,
    os_seq: 0,
    os_ids: [],
    os_numeros: [],
    perda: null,
    perdas_anteriores: [],
    cancelamento: null,
    aberta_pela: "operacao",
    schema_version: DEMAND_SCHEMA_VERSION,
  };
}
