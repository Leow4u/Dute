import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { digest } from "./operations.js";

/**
 * A solicitação de OS pelo portal (docs/plataforma/fase-4-financeiro.md,
 * parte 4.4a; docs/mockups/Portal.dc.html, "Solicitar OS"). O cliente diz o
 * tipo de serviço, a data e o horário, de onde e para onde, o que será feito
 * e, quando quiser, anexa a nota fiscal ou um documento. A solicitação fica
 * em `service_requests/{sol_id}`, recebida, e cai em Para planejar da
 * Operação. Ela nunca abre demanda nem OS sozinha: quem coordena abre a
 * demanda direta a partir dela (o mesmo formulário de quem recebe por
 * telefone, com o canal portal e o escopo do catálogo) ou a recusa com o
 * motivo, que o cliente lê.
 *
 * O anexo sobe do navegador para o Storage em
 * `portal/{customer_code}/solicitacoes/an_<16 hex>.<ext>` (storage.rules: o
 * cliente com a Operação no contrato, sem sobrescrever); `requestService`
 * confere que o arquivo chegou, com o tipo e o tamanho, antes de gravar.
 */

export const SERVICE_REQUESTS_COLLECTION = "service_requests";
export const SOLICITACAO_SCHEMA_VERSION = 1;

export const TIPOS_DE_SERVICO = ["transporte", "armazenagem", "servico_em_campo", "mudanca"] as const;
export type TipoDeServico = (typeof TIPOS_DE_SERVICO)[number];

export const STATUS_DA_SOLICITACAO = ["recebida", "aceita", "recusada"] as const;
export type StatusDaSolicitacao = (typeof STATUS_DA_SOLICITACAO)[number];

export const MAX_ANEXOS = 3;
export const MAX_BYTES_DO_ANEXO = 10 * 1024 * 1024;
/** O tipo de cada extensão aceita no anexo (o mesmo do storage.rules). */
export const TIPO_DO_ANEXO = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
/** Até quantos dias à frente o cliente pede. */
export const DIAS_A_FRENTE = 365;
export const MAX_ORIGEM = 160;
export const MAX_DESCRICAO = 1000;
export const MAX_MOTIVO = 300;

const ARQUIVO = /^an_[a-f0-9]{16}\.(pdf|jpg|png|webp)$/;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function dataValida(valor: string): boolean {
  const partes = DATA.exec(valor);
  if (!partes) return false;
  const [ano, mes, dia] = partes.slice(1).map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

/** Uma linha só, sem espaço repetido. */
const linha = (min: number, max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .min(min, `Informe ${rotulo}.`)
    .max(max, `Use até ${max} caracteres em ${rotulo}.`)
    .transform((valor) => valor.replace(/\s+/g, " "));

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const solicitacaoId = z.string().trim().regex(/^sol_[a-f0-9]{16}$/, "Solicitação do portal inválida.");

const anexo = z
  .object({
    arquivo: z.string().trim().regex(ARQUIVO, "Anexo inválido: use PDF, JPG, PNG ou WEBP."),
    nome: linha(1, 120, "o nome do anexo"),
  })
  .strict();

const PedirServico = z
  .object({
    idempotency_key: chave,
    tipo_servico: z.enum(TIPOS_DE_SERVICO),
    data: z.string().trim().refine(dataValida, "Data inválida: use aaaa-mm-dd."),
    horario: z.string().trim().regex(HORARIO, "Horário inválido: use hh:mm."),
    origem: linha(3, MAX_ORIGEM, "a origem"),
    destino: z
      .string()
      .trim()
      .max(MAX_ORIGEM, `Use até ${MAX_ORIGEM} caracteres no destino.`)
      .nullable()
      .optional()
      .transform((valor) => (valor ? valor.replace(/\s+/g, " ") : null)),
    descricao: z
      .string()
      .trim()
      .min(3, "Diga o que será feito.")
      .max(MAX_DESCRICAO, `Use até ${MAX_DESCRICAO} caracteres em o que será feito.`)
      .transform((valor) => valor.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")),
    anexos: z
      .array(anexo)
      .max(MAX_ANEXOS, `Anexe até ${MAX_ANEXOS} arquivos.`)
      .optional()
      .transform((valor) => valor ?? [])
      .refine((lista) => new Set(lista.map((item) => item.arquivo)).size === lista.length, "O mesmo anexo foi enviado duas vezes."),
  })
  .strict();

export type PedidoDeServico = z.infer<typeof PedirServico>;

export function interpretarPedidoDeServico(data: unknown): PedidoDeServico {
  const parsed = PedirServico.safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

const RecusarSolicitacao = z
  .object({
    idempotency_key: chave,
    solicitacao_id: solicitacaoId,
    motivo: linha(5, MAX_MOTIVO, "o motivo"),
  })
  .strict();

export type RecusaDeSolicitacao = z.infer<typeof RecusarSolicitacao>;

export function interpretarRecusa(data: unknown): RecusaDeSolicitacao {
  const parsed = RecusarSolicitacao.safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

/** A data e o horário pedidos, em São Paulo (sem horário de verão desde 2019), como instante em UTC. */
export function desejadaEm(data: string, horario: string): string {
  return new Date(`${data}T${horario}:00-03:00`).toISOString();
}

/** A data e o horário que já passaram, ou além de um ano, são engano. */
export function problemaDaData(data: string, horario: string, agora: Date): string | null {
  const quando = Date.parse(desejadaEm(data, horario));
  if (quando <= agora.getTime()) return "A data e o horário pedidos já passaram.";
  if (quando > agora.getTime() + DIAS_A_FRENTE * 86_400_000) return `Peça com até ${DIAS_A_FRENTE} dias de antecedência.`;
  return null;
}

/** O id da solicitação pela operação (o recibo da idempotência). */
export function idDaSolicitacao(operationId: string): string {
  return `sol_${digest({ operationId, solicitacao: true }, 16)}`;
}

/** Onde o navegador sobe o anexo (o mesmo caminho do storage.rules). */
export function caminhoDoAnexo(customerCode: string, arquivo: string): string {
  return `portal/${customerCode}/solicitacoes/${arquivo}`;
}

export type ArquivoDoAnexo = { contentType: string; size: number };

/** Por que o arquivo no Storage não serve de anexo, ou null. */
export function problemaDoAnexo(arquivo: string, noStorage: ArquivoDoAnexo | null): string | null {
  if (!noStorage) return "O anexo não chegou. Envie o arquivo de novo.";
  const extensao = arquivo.slice(arquivo.lastIndexOf(".") + 1) as keyof typeof TIPO_DO_ANEXO;
  if (noStorage.contentType !== TIPO_DO_ANEXO[extensao]) return "O anexo não é do tipo que o nome diz.";
  if (!(noStorage.size > 0) || noStorage.size > MAX_BYTES_DO_ANEXO) return "O anexo passa de 10 MB.";
  return null;
}

export type AnexoGravado = { arquivo: string; caminho: string; nome: string; tipo: string; tamanho: number };

/** Quem pediu: o login do cliente. O e-mail fica na solicitação, para a coordenação responder. */
export type ContatoDaSolicitacao = { uid: string; nome: string; email: string | null };

export type SolicitacaoNova = {
  id: string;
  customer_code: string;
  customer_name: string;
  pedido: PedidoDeServico;
  anexos: AnexoGravado[];
  contato: ContatoDaSolicitacao;
  iso: string;
};

export function documentoDaSolicitacao(dados: SolicitacaoNova): Record<string, unknown> {
  return {
    id: dados.id,
    customer_code: dados.customer_code,
    customer_name: dados.customer_name,
    tipo_servico: dados.pedido.tipo_servico,
    data: dados.pedido.data,
    horario: dados.pedido.horario,
    desejada_em: desejadaEm(dados.pedido.data, dados.pedido.horario),
    origem: dados.pedido.origem,
    destino: dados.pedido.destino,
    descricao: dados.pedido.descricao,
    anexos: dados.anexos,
    contato: dados.contato,
    status: "recebida",
    recebida_em: dados.iso,
    demanda: null,
    aceita_em: null,
    aceita_por_uid: null,
    recusa: null,
    schema_version: SOLICITACAO_SCHEMA_VERSION,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A solicitação como a transação lê: o status, o cliente, quando chegou e quem pediu. */
export type SolicitacaoLida = {
  id: string;
  status: StatusDaSolicitacao | null;
  customer_code: string;
  recebida_em: string;
  demanda: string | null;
  contato: { nome: string };
};

export function solicitacaoLida(id: string, dados: Record<string, unknown>): SolicitacaoLida {
  const status = (STATUS_DA_SOLICITACAO as readonly string[]).includes(texto(dados.status)) ? (texto(dados.status) as StatusDaSolicitacao) : null;
  const contato = dados.contato && typeof dados.contato === "object" ? (dados.contato as Record<string, unknown>) : {};
  return {
    id,
    status,
    customer_code: texto(dados.customer_code),
    recebida_em: texto(dados.recebida_em),
    demanda: texto(dados.demanda) || null,
    contato: { nome: texto(contato.nome) },
  };
}

/** Por que a solicitação não vira demanda (ou não se recusa), ou null: só a recebida, do mesmo cliente. */
export function problemaDaSolicitacao(solicitacao: SolicitacaoLida, customerCode: string | null): string | null {
  if (solicitacao.status === "aceita") return solicitacao.demanda ? `A solicitação já virou a demanda ${solicitacao.demanda}.` : "A solicitação já virou demanda.";
  if (solicitacao.status === "recusada") return "A solicitação foi recusada.";
  if (solicitacao.status !== "recebida") return "A solicitação está num estado desconhecido.";
  if (customerCode !== null && solicitacao.customer_code !== customerCode) return "A solicitação é de outro cliente.";
  if (!solicitacao.recebida_em) return "A solicitação está sem o instante em que chegou.";
  return null;
}
