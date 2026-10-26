import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { PAPEIS_DE_CAMPO, type ColaboradorGravado, type DonoDeVeiculo, type PapelDeCampo, type VeiculoGravado, type Vinculo } from "./cadastro.js";

/**
 * A OS (docs/plataforma/fase-3-operacao.md). A demanda com escopo fechado vira
 * uma ou várias OS (10045-01, 10045-02...), cada uma com uma fatia do saldo
 * dos itens do escopo: a soma das fatias das OS que não foram canceladas
 * nunca passa do escopo. Os itens saem da revisão fechada, sem preço.
 *
 * A OS é uma ida a campo: uma janela (um dia, início e fim), uma equipe com o
 * papel de cada pessoa, os veículos e as instruções. Nome, papel, vínculo e
 * placa são copiados do cadastro quando a OS é planejada ou agendada: o
 * campo lê a OS, nunca o cadastro (que tem CPF). Nenhum campo de valor.
 *
 * Status: aberta (Para agendar), agendada, em_execucao, em_revisao, revisada e
 * cancelada. Esta parte (3.4b) grava aberta, agendada e cancelada; execução,
 * revisão e conclusão entram nas partes 3.7 a 3.10.
 *
 * A vistoria (parte 3.11a) também é uma OS (`tipo: "vistoria"`), sem itens:
 * vai a campo antes do escopo fechado, levanta ambientes, itens e medidas e
 * vai direto ao Comercial, de Em execução a Revisada, sem assinatura nem
 * revisão (domain/vistoria.ts).
 */

export const SERVICE_ORDERS_COLLECTION = "service_orders";
export const SERVICE_ORDER_COUNTERS_COLLECTION = "service_order_counters";

export const STATUS_DA_OS = ["aberta", "agendada", "em_execucao", "em_revisao", "revisada", "cancelada"] as const;
export type StatusDaOs = (typeof STATUS_DA_OS)[number];

/** A OS de serviço (sai do escopo, com itens) ou a vistoria (antes do escopo, sem itens). */
export const TIPOS_DE_OS = ["servico", "vistoria"] as const;
export type TipoDaOs = (typeof TIPOS_DE_OS)[number];

/** O que a OS faz, derivado dos itens (serviço, item e descrição), na ordem da execução. */
export const SERVICOS_DA_OS = ["vistoria", "desmontagem", "embalagem", "transporte", "montagem", "armazenagem"] as const;
export type ServicoDaOs = (typeof SERVICOS_DA_OS)[number];

/** Quantas OS um planejamento cria de uma vez. */
export const MAX_OS_POR_PLANO = 10;
export const MAX_EQUIPE = 20;
export const MAX_VEICULOS = 6;

const DEMANDA = /^\d{5,8}$/;
const NUMERO = /^\d{5,8}-\d{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Quantidade do orçamento: decimal com ponto, até 3 casas (CASAS_DA_QUANTIDADE no Comercial). */
const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

export type ItemDaOs = {
  /** O id da linha no orçamento: o mesmo em todas as RV, é a chave do saldo. */
  id: string;
  lpu_item_id: string | null;
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  /** Quanto desta linha vai nesta OS (no escopo, quanto foi contratado). */
  planejado: string;
  /**
   * Quanto do saldo a OS revisada levou (parte 3.10a): o executado quando o
   * feito a mais se cobra ou o a menos volta ao saldo; o planejado nos outros
   * casos. Só existe depois da revisão; é o que o saldo conta.
   */
  consumido?: string;
  origem_local: string | null;
  destino_local: string | null;
};

export type JanelaDaOs = { data: string; inicio: string | null; fim: string | null };

export type ContatoNoLocal = { nome: string; telefone: string | null };

export type LocalDaOs = {
  local_id: string | null;
  nome: string | null;
  /** O endereço do local numa linha, copiado quando a OS nasce. */
  endereco: string | null;
  complemento: string | null;
  contato: ContatoNoLocal | null;
};

export type LocaisDaOs = { origem: LocalDaOs | null; destino: LocalDaOs | null };

export type PessoaDaOs = {
  colaborador_id: string;
  nome: string;
  papel: PapelDeCampo | null;
  vinculo: Vinculo;
  empresa: string | null;
  /** A pessoa tem o login do app ligado ao cadastro (o uid fica em equipe_uids). */
  no_app: boolean;
  /** O login ligado (parte 3.8a): é como o celular sabe qual pessoa da equipe é quem está nele. */
  usuario_uid: string | null;
};

export type VeiculoDaOs = {
  veiculo_id: string;
  placa: string;
  tipo: string;
  modelo: string | null;
  dono: DonoDeVeiculo;
  empresa: string | null;
};

/**
 * O cancelamento da OS: o motivo e, desde a pergunta 58, quando e quem
 * cancelou (o histórico da OS mostra). O de antes tem só o motivo.
 */
export type CancelamentoDaOs = { motivo: string; instante?: string; por?: { uid: string; nome: string | null } };

export type OsGravada = {
  numero: string;
  demanda: string;
  seq: number;
  customer_code: string;
  /** O nome do cliente copiado da demanda: o campo lê a OS, não o cadastro do cliente (parte 3.8a). */
  cliente_nome: string | null;
  /** Serviço ou vistoria; a OS de antes da parte 3.11a é de serviço. */
  tipo: TipoDaOs;
  status: StatusDaOs;
  /** A RV do escopo fechado de onde saiu a fatia; null na demanda direta (os itens pedidos são o escopo). */
  escopo_rv: number | null;
  itens: ItemDaOs[];
  servicos: ServicoDaOs[];
  locais: LocaisDaOs;
  janela: JanelaDaOs | null;
  equipe: PessoaDaOs[];
  /** Os logins do app da equipe: é o que deixa o campo ler esta OS. */
  equipe_uids: string[];
  veiculos: VeiculoDaOs[];
  instrucoes: string | null;
  edicao: number;
  cancelamento: CancelamentoDaOs | null;
};

// --- Entrada ------------------------------------------------------------------------------

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

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const demanda = z.string().trim().regex(DEMANDA, "Número da demanda inválido.");
const numero = z.string().trim().regex(NUMERO, "Número da OS inválido.");
const edicaoVista = z.number().int().min(1).max(100_000);
const motivo = z.string().trim().min(3, "Informe o motivo do cancelamento.").max(200, "Use até 200 caracteres no motivo.");
const idColaborador = z.string().regex(/^col_[a-f0-9]{16}$/, "Colaborador inválido.");
const idVeiculo = z.string().regex(/^vei_[a-f0-9]{16}$/, "Veículo inválido.");
const hora = z.string().trim().regex(HORA, "Hora inválida: use HH:MM.");

const janela = z
  .object({
    data: z.string().trim().regex(DATA, "Data inválida."),
    inicio: hora.nullable().optional(),
    fim: hora.nullable().optional(),
  })
  .strict()
  .transform((valor) => ({ data: valor.data, inicio: valor.inicio ?? null, fim: valor.fim ?? null }))
  .refine((valor) => !valor.inicio || !valor.fim || valor.fim > valor.inicio, "O fim da janela vem depois do início.")
  .refine((valor) => valor.inicio || !valor.fim, "Informe o início da janela antes do fim.");

const itemPedido = z
  .object({
    id: z.string().trim().min(1, "Item sem id.").max(120),
    planejado: z.string().trim().regex(QUANTIDADE, "Quantidade inválida: use número com ponto e até 3 casas."),
  })
  .strict();

const itensPedidos = z
  .array(itemPedido)
  .min(1, "Escolha ao menos um item para a OS.")
  .max(300, "A OS passa de 300 itens.")
  .refine((lista) => new Set(lista.map((item) => item.id)).size === lista.length, "Um item aparece duas vezes na mesma OS.");

const pessoaPedida = z
  .object({
    colaborador_id: idColaborador,
    papel: z.enum(PAPEIS_DE_CAMPO).nullable().optional(),
  })
  .strict();

const equipePedida = z
  .array(pessoaPedida)
  .max(MAX_EQUIPE, `A equipe passa de ${MAX_EQUIPE} pessoas.`)
  .refine((lista) => new Set(lista.map((pessoa) => pessoa.colaborador_id)).size === lista.length, "A equipe tem pessoa repetida.");

const veiculosPedidos = z
  .array(idVeiculo)
  .max(MAX_VEICULOS, `A OS passa de ${MAX_VEICULOS} veículos.`)
  .refine((lista) => new Set(lista).size === lista.length, "Um veículo aparece duas vezes.");

const instrucoes = z
  .string()
  .trim()
  .max(1000, "Use até 1000 caracteres nas instruções.")
  .nullable()
  .optional()
  .transform((valor) => (valor === undefined ? undefined : valor || null));

const contato = z
  .object({
    nome: z.string().trim().min(2, "Informe o nome do contato no local.").max(80, "Use até 80 caracteres no nome do contato."),
    telefone: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((valor) => (valor ? valor.replace(/[\s().-]/g, "") : null))
      .refine((valor) => valor == null || /^\+?\d{8,15}$/.test(valor), "Telefone do contato inválido: use DDD e número."),
  })
  .strict()
  .transform((valor) => ({ nome: valor.nome.replace(/\s+/g, " "), telefone: valor.telefone ?? null }));

const contatos = z
  .object({ origem: contato.nullable().optional(), destino: contato.nullable().optional() })
  .strict()
  .optional();

const Criar = z.object({ action: z.literal("create"), idempotency_key: chave, demanda }).strict();

/** Abrir a vistoria da demanda (parte 3.11a): a OS sem itens, já agendada quando vem com a janela. */
const AbrirVistoria = z
  .object({
    action: z.literal("survey"),
    idempotency_key: chave,
    demanda,
    janela: janela.nullable().optional(),
    equipe: equipePedida.optional(),
    veiculos: veiculosPedidos.optional(),
    instrucoes,
    contatos,
  })
  .strict();

const OrdemDoPlano = z
  .object({
    itens: itensPedidos,
    janela: janela.nullable().optional(),
    equipe: equipePedida.optional(),
    veiculos: veiculosPedidos.optional(),
    instrucoes,
    contatos,
  })
  .strict();

const Planejar = z
  .object({
    action: z.literal("plan"),
    idempotency_key: chave,
    demanda,
    ordens: z.array(OrdemDoPlano).min(1, "Planeje ao menos uma OS.").max(MAX_OS_POR_PLANO, `Planeje até ${MAX_OS_POR_PLANO} OS de uma vez.`),
  })
  .strict();

const Agendar = z
  .object({
    action: z.literal("schedule"),
    idempotency_key: chave,
    numero,
    expected_edicao: edicaoVista,
    janela,
    equipe: equipePedida,
    veiculos: veiculosPedidos,
    instrucoes,
    contatos,
  })
  .strict();

const AlterarItens = z
  .object({ action: z.literal("set_items"), idempotency_key: chave, numero, expected_edicao: edicaoVista, itens: itensPedidos })
  .strict();

const Cancelar = z
  .object({ action: z.literal("cancel"), idempotency_key: chave, numero, expected_edicao: edicaoVista, motivo })
  .strict();

export type ItemPedido = z.infer<typeof itemPedido>;
export type PessoaPedida = z.infer<typeof pessoaPedida>;
export type ContatosPedidos = z.infer<typeof contatos>;
export type OrdemPedida = z.infer<typeof OrdemDoPlano>;

export type AcaoOs =
  | z.infer<typeof Criar>
  | z.infer<typeof AbrirVistoria>
  | z.infer<typeof Planejar>
  | z.infer<typeof Agendar>
  | z.infer<typeof AlterarItens>
  | z.infer<typeof Cancelar>;

export function interpretarOs(data: unknown): AcaoOs {
  const parsed = z
    .discriminatedUnion("action", [Criar, AbrirVistoria, Planejar, Agendar, AlterarItens, Cancelar])
    .safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

// --- Datas --------------------------------------------------------------------------------

function dataCalendario(value: string): boolean {
  const ano = Number(value.slice(0, 4));
  const mes = Number(value.slice(5, 7));
  const dia = Number(value.slice(8, 10));
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

/** A data do agendamento, comparada com o dia de hoje em AAAA-MM-DD. */
export function problemaDaData(data: string, hoje: string): string | null {
  if (!DATA.test(data) || !dataCalendario(data)) return "Data inválida.";
  if (data < hoje) return "A data do agendamento já passou.";
  return null;
}

// --- Demanda ------------------------------------------------------------------------------

function preenchido(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== false;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function textoOuNull(valor: unknown): string | null {
  return texto(valor) || null;
}

export type DemandaParaOs = {
  entrada?: unknown;
  etapa?: unknown;
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

/**
 * Por que a demanda não recebe OS nova, ou null. A OS nasce do escopo fechado
 * pelo cliente (`escopo_rv`). Com a RV fechada em curso, a demanda está em
 * Para planejar; com um aditivo em negociação (RV seguinte em curso), o
 * escopo fechado continua valendo e a Operação planeja o resto do saldo. A
 * demanda executada, validada, perdida ou cancelada não recebe OS.
 */
export function problemaParaAbrirOs(demanda: DemandaParaOs, orcamento: OrcamentoParaOs | null): string | null {
  if (demandaDiretaSemEscopo(demanda)) {
    // A direta (parte 3.4d) não tem orçamento até a execução: os itens pedidos são o escopo.
    if (orcamento || texto(demanda.executado_de) || preenchido(demanda.perda) || preenchido(demanda.cancelamento)) {
      return "A OS nasce de uma demanda em Para planejar.";
    }
    return null;
  }
  if (!orcamento) return "A demanda não tem orçamento para virar OS.";
  const code = texto(demanda.customer_code);
  if (!code || code !== texto(orcamento.customer_code)) return "A demanda e o orçamento não são do mesmo cliente.";
  const escopo = demanda.escopo_rv;
  const rv = orcamento.rv;
  if (typeof escopo !== "number" || !Number.isInteger(escopo) || typeof rv !== "number" || !Number.isInteger(rv)) {
    return "A OS nasce de uma demanda em Para planejar.";
  }
  const validacao = demanda.validacao as { rv?: unknown } | null | undefined;
  const validada = Boolean(validacao && typeof validacao === "object" && validacao.rv === escopo);
  const fechadaEmCurso = rv === escopo && orcamento.status === "enviado";
  const aditivoEmCurso = rv > escopo;
  if (!(fechadaEmCurso || aditivoEmCurso)) return "A OS nasce de uma demanda em Para planejar.";
  if (texto(demanda.executado_de) || validada || preenchido(demanda.perda) || preenchido(demanda.cancelamento)) {
    return "A OS nasce de uma demanda em Para planejar.";
  }
  return null;
}

/**
 * Por que a demanda não recebe vistoria, ou null (parte 3.11a). A vistoria
 * vem antes do escopo fechado: é da demanda do Comercial ainda não fechada
 * pelo cliente, nem executada, perdida ou cancelada, e uma por vez (a que
 * está em aberto termina ou se cancela antes de outra).
 */
export function problemaParaAbrirVistoria(demanda: DemandaParaOs, ordens: readonly Pick<OsGravada, "numero" | "tipo" | "status">[]): string | null {
  if (demanda.entrada === "direta") return "A demanda direta não tem vistoria: a Operação executa e o Comercial orça depois.";
  if (preenchido(demanda.cancelamento)) return "A demanda foi cancelada no Comercial.";
  if (preenchido(demanda.perda)) return "A demanda foi perdida no Comercial.";
  if (typeof demanda.escopo_rv === "number" || texto(demanda.executado_de)) {
    return "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.";
  }
  const emAberto = ordens.find((os) => os.tipo === "vistoria" && (os.status === "aberta" || os.status === "agendada" || os.status === "em_execucao"));
  if (emAberto) return `A demanda já tem a vistoria ${emAberto.numero} em aberto.`;
  return null;
}

/** A demanda direta aberta pela Operação, ainda sem escopo fechado: as OS saem dos itens pedidos. */
export function demandaDiretaSemEscopo(demanda: DemandaParaOs): boolean {
  return demanda.entrada === "direta" && (demanda.escopo_rv === null || demanda.escopo_rv === undefined);
}

/**
 * Por que a OS não pode ser agendada pela demanda dela, ou null. A demanda
 * perdida ou cancelada no Comercial não leva equipe nem veículo: a OS só se
 * cancela. Reaberta, volta a agendar. O aditivo em negociação não trava: o
 * escopo fechado continua valendo e o serviço não espera o aditivo.
 */
export function problemaParaAgendarOs(demanda: Pick<DemandaParaOs, "perda" | "cancelamento">): string | null {
  if (preenchido(demanda.cancelamento)) return "A demanda foi cancelada no Comercial. Cancele a OS.";
  if (preenchido(demanda.perda)) return "A demanda foi perdida no Comercial. Cancele a OS.";
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

/**
 * O último número já usado na demanda: o maior entre o contador e as OS que
 * existem. Um contador atrasado ou ausente nunca faz repetir um número.
 */
export function ultimaSequencia(contador: unknown, ordens: readonly { seq: number }[]): number {
  const base = contador === undefined || contador === null ? 0 : contador;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
    throw new HttpsError("failed-precondition", "O contador da OS está inválido.");
  }
  return Math.max(base, ...ordens.map((os) => os.seq));
}

// --- Escopo e saldo -----------------------------------------------------------------------

/** "12.5" → 12500. Quantidade fora do formato do orçamento → null. */
export function emMilesimos(quantidade: string): number | null {
  const valor = quantidade.trim();
  if (!QUANTIDADE.test(valor)) return null;
  const [inteiro, decimais = ""] = valor.split(".");
  return Number(inteiro) * 1000 + Number(decimais.padEnd(3, "0"));
}

/** 12500 → "12.5"; 2000 → "2". */
export function deMilesimos(milesimos: number): string {
  if (!Number.isSafeInteger(milesimos) || milesimos < 0) throw new HttpsError("internal", `Quantidade inválida: ${milesimos}.`);
  const inteiro = Math.floor(milesimos / 1000);
  const resto = String(milesimos % 1000).padStart(3, "0").replace(/0+$/, "");
  return resto ? `${inteiro}.${resto}` : String(inteiro);
}

/**
 * O escopo: as linhas de serviço da revisão fechada (ou os itens pedidos da
 * demanda direta), sem preço, motivo nem a linha de ajuste (que é só
 * dinheiro). `planejado` é a quantidade contratada ou pedida.
 */
export function itensSemPreco(valor: unknown): ItemDaOs[] {
  if (!Array.isArray(valor)) falha("O escopo da demanda não tem itens.");
  const itens: ItemDaOs[] = [];
  for (const bruto of valor) {
    if (!bruto || typeof bruto !== "object") falha("Um item do escopo da demanda está incompleto.");
    const linha = bruto as Record<string, unknown>;
    if (linha.origem === "ajuste") continue;
    const id = texto(linha.id);
    const item = texto(linha.item);
    const quantidade = texto(linha.quantidade);
    if (!id || !item || !quantidade) falha("Um item do escopo da demanda está incompleto.");
    if (emMilesimos(quantidade) === null) falha(`A quantidade da linha ${id} do escopo da demanda está fora do formato.`);
    itens.push({
      id,
      lpu_item_id: textoOuNull(linha.lpu_item_id),
      codigo: textoOuNull(linha.codigo),
      item,
      descricao: texto(linha.descricao) || item,
      servico: textoOuNull(linha.servico),
      unidade: textoOuNull(linha.unidade),
      planejado: quantidade,
      origem_local: textoOuNull(linha.origem_local),
      destino_local: textoOuNull(linha.destino_local),
    });
  }
  if (itens.length === 0) falha("O escopo da demanda não tem item de serviço.");
  return itens;
}

export type OsParaSaldo = { numero: string; status: string; itens: readonly { id: string; planejado: string; consumido?: string }[] };

/**
 * Quanto de cada linha do escopo ainda não está em OS (em milésimos). A OS
 * cancelada devolve a fatia; a revisada conta o consumido (parte 3.10a);
 * `exceto` deixa de fora a OS que está sendo alterada. Linha planejada que
 * saiu do escopo (num aditivo) não conta.
 */
export function saldoDoEscopo(escopo: readonly ItemDaOs[], ordens: readonly OsParaSaldo[], exceto?: string): Map<string, number> {
  const saldo = new Map<string, number>();
  for (const linha of escopo) saldo.set(linha.id, emMilesimos(linha.planejado) ?? 0);
  for (const os of ordens) {
    if (os.status === "cancelada" || os.numero === exceto) continue;
    for (const item of os.itens) {
      const restante = saldo.get(item.id);
      if (restante === undefined) continue;
      saldo.set(item.id, restante - (emMilesimos(item.consumido ?? item.planejado) ?? 0));
    }
  }
  return saldo;
}

function rotuloDaLinha(linha: ItemDaOs): string {
  return linha.codigo ? `${linha.codigo} ${linha.item}` : linha.item;
}

/**
 * A fatia pedida, conferida contra o saldo: cada linha é do escopo, a
 * quantidade é maior que zero e não passa do que resta. Desconta do saldo
 * (que é alterado), para várias OS do mesmo planejamento somarem.
 */
export function fatiaDoSaldo(escopo: readonly ItemDaOs[], saldo: Map<string, number>, pedido: readonly ItemPedido[]): ItemDaOs[] {
  const porId = new Map(escopo.map((linha) => [linha.id, linha]));
  return pedido.map((item) => {
    const linha = porId.get(item.id);
    if (!linha) invalid(`O item ${item.id} não está no escopo fechado da demanda.`);
    const quanto = emMilesimos(item.planejado) ?? 0;
    if (quanto <= 0) invalid(`Informe uma quantidade maior que zero para ${rotuloDaLinha(linha)}.`);
    const restante = saldo.get(linha.id) ?? 0;
    if (quanto > restante) {
      falha(`${rotuloDaLinha(linha)}: o saldo é ${deMilesimos(Math.max(restante, 0))} e a OS pede ${item.planejado}.`);
    }
    saldo.set(linha.id, restante - quanto);
    return { ...linha, planejado: deMilesimos(quanto) };
  });
}

/** Todo o saldo que resta numa OS só (abrir a OS pela fila). */
export function todoOSaldo(escopo: readonly ItemDaOs[], saldo: Map<string, number>): ItemDaOs[] {
  const itens = escopo.flatMap((linha) => {
    const restante = saldo.get(linha.id) ?? 0;
    return restante > 0 ? [{ ...linha, planejado: deMilesimos(restante) }] : [];
  });
  if (itens.length === 0) falha("Todo o saldo da demanda já está em OS.");
  return itens;
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const PALAVRAS_DO_SERVICO: Record<ServicoDaOs, RegExp> = {
  vistoria: /vistori|levantament/,
  desmontagem: /desmont/,
  embalagem: /embal/,
  transporte: /transport|frete|mudanc|carreto|remoc/,
  montagem: /(?<!des)montag|(?<!des)montar/,
  armazenagem: /armazen|guarda de/,
};

/** Os serviços que os itens pedem, na ordem da execução. Item sem serviço conhecido não muda nada. */
export function servicosDosItens(itens: readonly Pick<ItemDaOs, "servico" | "item" | "descricao">[]): ServicoDaOs[] {
  const textos = itens.map((item) => semAcento([item.servico, item.item, item.descricao].filter(Boolean).join(" ")));
  return SERVICOS_DA_OS.filter((servico) => textos.some((valor) => PALAVRAS_DO_SERVICO[servico].test(valor)));
}

// --- Locais, equipe e veículos ------------------------------------------------------------

export type ReferenciaDoLocal = { local_id: string | null; complemento: string | null } | null;

export function referenciaDoLocal(valor: unknown): ReferenciaDoLocal {
  if (!valor || typeof valor !== "object") return null;
  const local = valor as { local_id?: unknown; complemento?: unknown };
  const localId = textoOuNull(local.local_id);
  const complemento = textoOuNull(local.complemento);
  return localId || complemento ? { local_id: localId, complemento } : null;
}

/** "Av. Brig. Faria Lima, 3500 · 5º andar · Itaim Bibi · São Paulo/SP": o que o campo lê para chegar. */
export function enderecoEmLinha(endereco: unknown): string | null {
  if (!endereco || typeof endereco !== "object") return null;
  const e = endereco as Record<string, unknown>;
  const rua = [texto(e.logradouro), texto(e.numero)].filter(Boolean).join(", ");
  const cidade = [texto(e.cidade), texto(e.uf)].filter(Boolean).join("/");
  const partes = [rua, texto(e.complemento), texto(e.bairro), cidade].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * O local da demanda copiado na OS, com o endereço do cadastro de locais do
 * cliente no momento. Local de outro cliente não entra (fica só a referência).
 */
export function localDaOs(
  referencia: ReferenciaDoLocal,
  cadastro: { customer_code?: unknown; nome?: unknown; endereco?: unknown } | null,
  customerCode: string,
  contatoNoLocal: ContatoNoLocal | null,
): LocalDaOs | null {
  if (!referencia && !contatoNoLocal) return null;
  const doCliente = cadastro && texto(cadastro.customer_code) === customerCode ? cadastro : null;
  return {
    local_id: referencia?.local_id ?? null,
    nome: doCliente ? textoOuNull(doCliente.nome) : null,
    endereco: doCliente ? enderecoEmLinha(doCliente.endereco) : null,
    complemento: referencia?.complemento ?? null,
    contato: contatoNoLocal,
  };
}

/** O contato pedido (undefined mantém o que a OS tem; null apaga). */
export function comContatos(locais: LocaisDaOs, pedidos: ContatosPedidos): LocaisDaOs {
  if (!pedidos) return locais;
  const trocar = (local: LocalDaOs | null, contatoPedido: ContatoNoLocal | null | undefined): LocalDaOs | null => {
    if (contatoPedido === undefined) return local;
    if (!local) return contatoPedido ? { local_id: null, nome: null, endereco: null, complemento: null, contato: contatoPedido } : null;
    return { ...local, contato: contatoPedido };
  };
  return { origem: trocar(locais.origem, pedidos.origem), destino: trocar(locais.destino, pedidos.destino) };
}

const PAPEL_ROTULO: Record<PapelDeCampo, string> = { lider: "líder", motorista: "motorista", montador: "montador", ajudante: "ajudante" };

/**
 * A equipe pedida com o que o campo precisa copiado do cadastro: nome,
 * papel, vínculo e empresa. Sem papel pedido, vale o primeiro do cadastro.
 * Quem tem papéis marcados só entra num deles. Só gente ativa.
 */
export function equipeDaOs(
  pedido: readonly PessoaPedida[],
  cadastro: ReadonlyMap<string, ColaboradorGravado>,
): { equipe: PessoaDaOs[]; equipe_uids: string[] } {
  const equipe = pedido.map((pessoa) => {
    const colaborador = cadastro.get(pessoa.colaborador_id);
    if (!colaborador || !colaborador.ativo) falha("Há alguém na equipe que não está ativo.");
    const papel = pessoa.papel ?? colaborador.papeis[0] ?? null;
    if (papel && colaborador.papeis.length > 0 && !colaborador.papeis.includes(papel)) {
      falha(`${colaborador.nome} não tem o papel ${PAPEL_ROTULO[papel]} no cadastro.`);
    }
    return {
      colaborador_id: colaborador.id,
      nome: colaborador.nome,
      papel,
      vinculo: colaborador.vinculo,
      empresa: colaborador.empresa,
      no_app: Boolean(colaborador.usuario_uid),
      usuario_uid: colaborador.usuario_uid ?? null,
    } satisfies PessoaDaOs;
  });
  const uids = pedido.flatMap((pessoa) => {
    const uid = cadastro.get(pessoa.colaborador_id)?.usuario_uid;
    return uid ? [uid] : [];
  });
  return { equipe, equipe_uids: [...new Set(uids)] };
}

/** As situações em que a OS ainda vai a campo: é nelas que o login do app trocado no cadastro chega. */
export const STATUS_QUE_VAO_A_CAMPO = ["aberta", "agendada", "em_execucao"] as const satisfies readonly StatusDaOs[];

/** Quantas OS o login trocado de uma pessoa atualiza de uma vez (cabe numa transação). */
export const MAX_OS_DO_LOGIN = 400;

function login(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * O login do app que o cadastro ligou, trocou ou tirou, na OS que ainda vai a
 * campo: a pessoa passa a mostrar o login novo, e o acesso da equipe
 * (`equipe_uids`, o mesmo das regras e de quem registra) troca o antigo pelo
 * novo. Sai também o login que a OS guardou da pessoa; o de outra pessoa da
 * equipe nunca sai. O resto do que a OS guardou fica. Sem a pessoa na equipe,
 * na OS de antes da parte 3.4 (só os ids) ou sem nada a mudar, devolve null.
 */
export function equipeComLogin(
  data: { equipe?: unknown; equipe_uids?: unknown },
  colaboradorId: string,
  uidAntes: string | null,
  uidDepois: string | null,
): { equipe: Record<string, unknown>[]; equipe_uids: string[] } | null {
  if (!Array.isArray(data.equipe) || !data.equipe.every((pessoa) => pessoa !== null && typeof pessoa === "object")) return null;
  const equipe = data.equipe as Record<string, unknown>[];
  const daPessoa = (pessoa: Record<string, unknown>) => pessoa.colaborador_id === colaboradorId;
  const guardada = equipe.find(daPessoa);
  if (!guardada) return null;
  const dosOutros = new Set(equipe.filter((pessoa) => !daPessoa(pessoa)).map((pessoa) => login(pessoa.usuario_uid)).filter((uid) => uid !== null));
  const saem = new Set([uidAntes, login(guardada.usuario_uid)].filter((uid): uid is string => uid !== null && uid !== uidDepois && !dosOutros.has(uid)));
  const atuais = Array.isArray(data.equipe_uids) ? data.equipe_uids.filter((uid): uid is string => typeof uid === "string") : [];
  const equipe_uids = [...new Set([...atuais.filter((uid) => !saem.has(uid)), ...(uidDepois ? [uidDepois] : [])])];
  const mesmaPessoa = login(guardada.usuario_uid) === uidDepois && guardada.no_app === Boolean(uidDepois);
  const mesmoAcesso = equipe_uids.length === atuais.length && equipe_uids.every((uid, indice) => uid === atuais[indice]);
  if (mesmaPessoa && mesmoAcesso) return null;
  return {
    equipe: equipe.map((pessoa) => (daPessoa(pessoa) ? { ...pessoa, usuario_uid: uidDepois, no_app: Boolean(uidDepois) } : pessoa)),
    equipe_uids,
  };
}

function placaLegivel(placa: string): string {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa) ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa;
}

/**
 * Os veículos pedidos, com placa, tipo e dono copiados do cadastro. Só
 * veículo ativo, e nunca no dia da revisão preventiva (`revisao_em`, parte
 * 3.13a): nesse dia o veículo está na oficina.
 */
export function veiculosDaOs(pedido: readonly string[], cadastro: ReadonlyMap<string, VeiculoGravado>, dia: string | null = null): VeiculoDaOs[] {
  return pedido.map((id) => {
    const veiculo = cadastro.get(id);
    if (!veiculo || !veiculo.ativo) falha("Há um veículo que não está ativo.");
    if (dia && veiculo.revisao_em === dia) {
      falha(`O veículo ${placaLegivel(veiculo.placa)} está em revisão preventiva em ${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}.`);
    }
    return { veiculo_id: veiculo.id, placa: veiculo.placa, tipo: veiculo.tipo, modelo: veiculo.modelo, dono: veiculo.dono, empresa: veiculo.empresa };
  });
}

// --- Documento ----------------------------------------------------------------------------

export type NovaOs = {
  numero: string;
  demanda: string;
  seq: number;
  customer_code: string;
  cliente_nome: string | null;
  escopo_rv: number | null;
  itens: ItemDaOs[];
  locais: LocaisDaOs;
  janela: JanelaDaOs | null;
  equipe: PessoaDaOs[];
  equipe_uids: string[];
  veiculos: VeiculoDaOs[];
  instrucoes: string | null;
};

/** A OS nova: agendada quando já tem a janela, aberta (Para agendar) sem ela. */
export function novaOs(entrada: NovaOs): OsGravada {
  if (entrada.numero !== numeroDaOs(entrada.demanda, entrada.seq)) throw new HttpsError("internal", "O número da OS não confere com a demanda.");
  if (entrada.itens.length === 0) throw new HttpsError("internal", "A OS nasce com ao menos um item.");
  return {
    numero: entrada.numero,
    demanda: entrada.demanda,
    seq: entrada.seq,
    customer_code: entrada.customer_code,
    cliente_nome: entrada.cliente_nome,
    tipo: "servico",
    status: entrada.janela ? "agendada" : "aberta",
    escopo_rv: entrada.escopo_rv,
    itens: entrada.itens,
    servicos: servicosDosItens(entrada.itens),
    locais: entrada.locais,
    janela: entrada.janela,
    equipe: entrada.equipe,
    equipe_uids: entrada.equipe_uids,
    veiculos: entrada.veiculos,
    instrucoes: entrada.instrucoes,
    edicao: 1,
    cancelamento: null,
  };
}

/** A vistoria nova (parte 3.11a): sem itens nem escopo, o serviço é a vistoria. */
export function novaVistoria(entrada: Omit<NovaOs, "itens" | "escopo_rv">): OsGravada {
  if (entrada.numero !== numeroDaOs(entrada.demanda, entrada.seq)) throw new HttpsError("internal", "O número da OS não confere com a demanda.");
  return {
    numero: entrada.numero,
    demanda: entrada.demanda,
    seq: entrada.seq,
    customer_code: entrada.customer_code,
    cliente_nome: entrada.cliente_nome,
    tipo: "vistoria",
    status: entrada.janela ? "agendada" : "aberta",
    escopo_rv: null,
    itens: [],
    servicos: ["vistoria"],
    locais: entrada.locais,
    janela: entrada.janela,
    equipe: entrada.equipe,
    equipe_uids: entrada.equipe_uids,
    veiculos: entrada.veiculos,
    instrucoes: entrada.instrucoes,
    edicao: 1,
    cancelamento: null,
  };
}

/** A OS que se planeja de novo (agenda, itens, cancelamento): número e edição vistos, aberta ou agendada. */
export function exigirPlanejavel(atual: OsGravada | null, numeroVisto: string, edicao: number, verbo: string): OsGravada {
  if (!atual) throw new HttpsError("not-found", "OS não encontrada.");
  if (atual.numero !== numeroVisto) throw new HttpsError("internal", "O número da OS não confere.");
  if (atual.edicao !== edicao) falha("A OS foi atualizada. Recarregue e tente de novo.");
  if (atual.status === "cancelada") falha("A OS já está cancelada.");
  if (atual.status !== "aberta" && atual.status !== "agendada") falha(`Só uma OS aberta ou agendada pode ser ${verbo}.`);
  return atual;
}

/**
 * A OS que se cancela: aberta ou agendada; a vistoria também em execução,
 * quando não deu certo no local (o cliente não recebeu a equipe, o local
 * fechado; pergunta 58). A OS de serviço iniciada não se cancela.
 */
export function exigirCancelavel(atual: OsGravada | null, numeroVisto: string, edicao: number): OsGravada {
  if (atual?.tipo !== "vistoria" || atual.status !== "em_execucao") return exigirPlanejavel(atual, numeroVisto, edicao, "cancelada");
  if (atual.numero !== numeroVisto) throw new HttpsError("internal", "O número da OS não confere.");
  if (atual.edicao !== edicao) falha("A OS foi atualizada. Recarregue e tente de novo.");
  return atual;
}

export type AgendaResolvida = {
  janela: JanelaDaOs;
  equipe: PessoaDaOs[];
  equipe_uids: string[];
  veiculos: VeiculoDaOs[];
  instrucoes: string | null | undefined;
  contatos: ContatosPedidos;
};

/** Agendar: janela, equipe e veículos novos. Sem equipe ou sem veículo é alerta, não bloqueio. */
export function agendada(atual: OsGravada, agenda: AgendaResolvida): OsGravada {
  return {
    ...atual,
    status: "agendada",
    edicao: atual.edicao + 1,
    janela: agenda.janela,
    equipe: agenda.equipe,
    equipe_uids: agenda.equipe_uids,
    veiculos: agenda.veiculos,
    instrucoes: agenda.instrucoes === undefined ? atual.instrucoes : agenda.instrucoes,
    locais: comContatos(atual.locais, agenda.contatos),
  };
}

export function comItens(atual: OsGravada, itens: ItemDaOs[], escopoRv: number | null): OsGravada {
  if (atual.tipo === "vistoria") falha("A vistoria não tem itens do escopo: os itens levantados vão no envio ao Comercial.");
  return { ...atual, itens, servicos: servicosDosItens(itens), escopo_rv: escopoRv, edicao: atual.edicao + 1 };
}

/** Cancelada, com o motivo, o instante e quem cancelou. */
export function cancelada(atual: OsGravada, motivoDoCancelamento: string, por: { uid: string; nome: string | null }, instante: string): OsGravada {
  return { ...atual, status: "cancelada", edicao: atual.edicao + 1, cancelamento: { motivo: motivoDoCancelamento, instante, por } };
}

// --- Leitura ------------------------------------------------------------------------------

function ilegivel(): never {
  throw new HttpsError("failed-precondition", "OS ilegível.");
}

export function itemLido(bruto: unknown): ItemDaOs {
  if (!bruto || typeof bruto !== "object") ilegivel();
  const item = bruto as Record<string, unknown>;
  // OS de antes da parte 3.4: a quantidade estava em `quantidade`.
  const planejado = texto(item.planejado) || texto(item.quantidade);
  const id = texto(item.id);
  if (!id || emMilesimos(planejado) === null) ilegivel();
  return {
    id,
    lpu_item_id: textoOuNull(item.lpu_item_id),
    codigo: textoOuNull(item.codigo),
    item: texto(item.item),
    descricao: texto(item.descricao) || texto(item.item),
    servico: textoOuNull(item.servico),
    unidade: textoOuNull(item.unidade),
    planejado,
    origem_local: textoOuNull(item.origem_local),
    destino_local: textoOuNull(item.destino_local),
    ...(emMilesimos(texto(item.consumido)) !== null ? { consumido: texto(item.consumido) } : {}),
  };
}

function localLido(bruto: unknown, idAntigo: unknown): LocalDaOs | null {
  if (bruto && typeof bruto === "object") {
    const local = bruto as Record<string, unknown>;
    const contatoBruto = local.contato as Record<string, unknown> | null | undefined;
    const contatoLido = contatoBruto && typeof contatoBruto === "object" && texto(contatoBruto.nome)
      ? { nome: texto(contatoBruto.nome), telefone: textoOuNull(contatoBruto.telefone) }
      : null;
    return {
      local_id: textoOuNull(local.local_id),
      nome: textoOuNull(local.nome),
      endereco: textoOuNull(local.endereco),
      complemento: textoOuNull(local.complemento),
      contato: contatoLido,
    };
  }
  // OS de antes da parte 3.4: só o id do local.
  const id = textoOuNull(idAntigo);
  return id ? { local_id: id, nome: null, endereco: null, complemento: null, contato: null } : null;
}

function janelaLida(bruto: unknown, agendaAntiga: unknown): JanelaDaOs | null {
  const fonte = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : null;
  if (fonte) {
    if (!DATA.test(texto(fonte.data))) ilegivel();
    return { data: texto(fonte.data), inicio: textoOuNull(fonte.inicio), fim: textoOuNull(fonte.fim) };
  }
  // OS de antes da parte 3.4: agenda { data, hora, equipe, veiculo_id }.
  const agenda = agendaAntiga && typeof agendaAntiga === "object" ? (agendaAntiga as Record<string, unknown>) : null;
  if (!agenda) return null;
  if (!DATA.test(texto(agenda.data))) ilegivel();
  return { data: texto(agenda.data), inicio: textoOuNull(agenda.hora), fim: null };
}

function pessoaLida(bruto: unknown): PessoaDaOs {
  if (typeof bruto === "string") {
    // OS de antes da parte 3.4: só o id; o nome volta no próximo agendamento.
    return { colaborador_id: bruto, nome: "", papel: null, vinculo: "proprio", empresa: null, no_app: false, usuario_uid: null };
  }
  if (!bruto || typeof bruto !== "object") ilegivel();
  const pessoa = bruto as Record<string, unknown>;
  const papel = (PAPEIS_DE_CAMPO as readonly string[]).includes(String(pessoa.papel)) ? (pessoa.papel as PapelDeCampo) : null;
  const vinculo = pessoa.vinculo === "freelancer" || pessoa.vinculo === "terceiro" ? pessoa.vinculo : "proprio";
  return {
    colaborador_id: texto(pessoa.colaborador_id),
    nome: texto(pessoa.nome),
    papel,
    vinculo,
    empresa: textoOuNull(pessoa.empresa),
    no_app: pessoa.no_app === true,
    usuario_uid: typeof pessoa.usuario_uid === "string" && pessoa.usuario_uid ? pessoa.usuario_uid : null,
  };
}

function veiculoLidoDaOs(bruto: unknown): VeiculoDaOs {
  if (typeof bruto === "string") return { veiculo_id: bruto, placa: "", tipo: "", modelo: null, dono: "proprio", empresa: null };
  if (!bruto || typeof bruto !== "object") ilegivel();
  const veiculo = bruto as Record<string, unknown>;
  return {
    veiculo_id: texto(veiculo.veiculo_id),
    placa: texto(veiculo.placa),
    tipo: texto(veiculo.tipo),
    modelo: textoOuNull(veiculo.modelo),
    dono: veiculo.dono === "terceiro" ? "terceiro" : "proprio",
    empresa: textoOuNull(veiculo.empresa),
  };
}

/** A OS gravada, inclusive a de antes da parte 3.4 (agenda, quantidade e ids dos locais). */
export function osLida(numeroDaLeitura: string, data: Record<string, unknown>): OsGravada {
  if (!(STATUS_DA_OS as readonly string[]).includes(String(data.status))) ilegivel();
  if (typeof data.edicao !== "number" || typeof data.demanda !== "string" || typeof data.customer_code !== "string") ilegivel();
  const agendaAntiga = data.agenda && typeof data.agenda === "object" ? (data.agenda as Record<string, unknown>) : null;
  const equipeBruta = Array.isArray(data.equipe) ? data.equipe : Array.isArray(agendaAntiga?.equipe) ? (agendaAntiga.equipe as unknown[]) : [];
  const veiculosBrutos = Array.isArray(data.veiculos)
    ? data.veiculos
    : typeof agendaAntiga?.veiculo_id === "string"
      ? [agendaAntiga.veiculo_id]
      : [];
  const itens = Array.isArray(data.itens) ? data.itens.map(itemLido) : [];
  return {
    numero: numeroDaLeitura,
    demanda: data.demanda,
    seq: typeof data.seq === "number" ? data.seq : 1,
    customer_code: data.customer_code,
    cliente_nome: textoOuNull(data.cliente_nome),
    tipo: data.tipo === "vistoria" ? "vistoria" : "servico",
    status: data.status as StatusDaOs,
    escopo_rv: typeof data.escopo_rv === "number" ? data.escopo_rv : null,
    itens,
    servicos: Array.isArray(data.servicos)
      ? SERVICOS_DA_OS.filter((servico) => (data.servicos as unknown[]).includes(servico))
      : servicosDosItens(itens),
    locais: {
      origem: localLido((data.locais as Record<string, unknown> | undefined)?.origem, data.origem_local_id),
      destino: localLido((data.locais as Record<string, unknown> | undefined)?.destino, data.destino_local_id),
    },
    janela: janelaLida(data.janela, data.agenda),
    equipe: equipeBruta.map(pessoaLida),
    equipe_uids: Array.isArray(data.equipe_uids) ? data.equipe_uids.filter((uid): uid is string => typeof uid === "string") : [],
    veiculos: veiculosBrutos.map(veiculoLidoDaOs),
    instrucoes: textoOuNull(data.instrucoes),
    edicao: data.edicao,
    cancelamento: cancelamentoLido(data.cancelamento),
  };
}

function cancelamentoLido(bruto: unknown): CancelamentoDaOs | null {
  if (!bruto || typeof bruto !== "object") return null;
  const dados = bruto as Record<string, unknown>;
  if (typeof dados.motivo !== "string") return null;
  const por = dados.por && typeof dados.por === "object" ? (dados.por as Record<string, unknown>) : null;
  return {
    motivo: dados.motivo,
    ...(typeof dados.instante === "string" ? { instante: dados.instante } : {}),
    ...(por && typeof por.uid === "string" ? { por: { uid: por.uid, nome: typeof por.nome === "string" ? por.nome : null } } : {}),
  };
}
