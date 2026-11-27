import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import {
  LIMITES,
  ORIGENS_DO_FEITO,
  ROTULO_DO_MOMENTO,
  STATUS_DA_EDICAO,
  TIPOS_DE_MOMENTO,
  problemaDoCronograma,
  type MomentoPrevisto,
  type OrigemDoFeito,
  type StatusDaEdicao,
  type TipoDeMomento,
} from "./dominio.js";

/**
 * A edição do evento sem o banco (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "A edição, campo a campo" e "Limites e mensagens"): as entradas das
 * callables, todas estritas, a recusa que diz o campo e o limite ("A
 * observação de Montagem passa de 300 caracteres", nunca a frase genérica do
 * modelo antigo), o que cada status e papel muda no patch, o que falta para
 * enviar e a leitura do documento (EdicaoView, com os carimbos em ISO).
 * Nenhum acesso ao Firestore aqui: a gravação é edicao-gravacao.ts.
 */

// ------------------------------------------------------------------ entradas

/** Texto livre opcional: o vazio vira null (o molde de client-events.ts). Só onde o objeto vem inteiro. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const ID_DO_MOMENTO = /^mo_[0-9a-f]{8}$/;

/** R$ 1 bilhão, em centavos: o valor declarado da coleta. */
export const VALOR_DECLARADO_MAXIMO_CENTS = 1_000_000_000_00;

const idempotencyKey = z.string().trim().min(8).max(200);
const customerCode = z.string().trim().max(120).optional();
const idDaEdicao = z.string().trim().min(1).max(120);

/**
 * Um momento do cronograma como a tela o manda: o `id` só no momento já
 * gravado (o patch funde por ele), o tipo, o rótulo do `outro` e o previsto.
 * A hora só é obrigatória na entrega no local (decisão 12 da spec): nos outros
 * momentos a linha grava com o dia e sem a hora.
 */
export const MomentoPrevistoSchema = z
  .object({
    id: z.string().regex(ID_DO_MOMENTO).optional(),
    tipo: z.enum(TIPOS_DE_MOMENTO),
    rotulo: optionalText(LIMITES.rotulo),
    data: z.string().trim().min(1).regex(DATA),
    hora: z.preprocess((value) => (typeof value === "string" && !value.trim() ? null : value), z.string().trim().regex(HORA).nullish()),
    ate: z.preprocess((value) => (value === "" ? null : value), z.string().trim().regex(HORA).nullish()),
    local: optionalText(LIMITES.local),
    observacao: optionalText(LIMITES.observacaoDoMomento),
  })
  .strict()
  .superRefine((momento, ctx) => {
    if (momento.tipo === "entrega_no_local" && !momento.hora) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hora"], message: `Informe a hora de ${ROTULO_DO_MOMENTO.entrega_no_local}` });
    }
  });

export const ItemDaEdicaoSchema = z
  .object({
    sku_code: z.string().trim().min(1).max(120),
    client_item_code: optionalText(120),
    product_name: z.string().trim().min(1).max(200),
    size: optionalText(80),
    category: optionalText(120),
    quantity: z.number().int().min(1).max(LIMITES.quantidade),
  })
  .strict();

/** A coleta no cliente: quantidade 0 é sem coleta. O valor declarado vai a client_event_prices, nunca à edição. */
export const ColetaSchema = z
  .object({
    onde: optionalText(LIMITES.coletaOnde),
    quantidade: z.number().int().min(0).max(LIMITES.quantidade),
    valor_declarado_cents: z.number().int().min(0).max(VALOR_DECLARADO_MAXIMO_CENTS).nullish(),
  })
  .strict();

export const ContatoSchema = z
  .object({ nome: optionalText(LIMITES.contatoNome), telefone: optionalText(LIMITES.contatoTelefone) })
  .strict();

export const OndeSchema = z
  .object({
    local: optionalText(LIMITES.local),
    endereco: optionalText(LIMITES.endereco),
    contato: ContatoSchema.nullish(),
  })
  .strict();

/** O nome e a descrição da capa (client_events), mudados depois do nascimento. */
export const EventoDoPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITES.nome).optional(),
    description: z.string().trim().max(LIMITES.descricao).nullish(),
  })
  .strict();

/**
 * O conteúdo de um patch. Cada campo presente substitui o gravado inteiro
 * (o cronograma se funde pelo id do momento); o ausente fica como está. Sem
 * transform na raiz: o ausente não pode virar null.
 */
export const ConteudoDaEdicaoSchema = z
  .object({
    label: z.string().trim().max(LIMITES.label).nullish(),
    onde: OndeSchema.nullish(),
    cronograma: z.array(MomentoPrevistoSchema).max(LIMITES.momentos).optional(),
    itens: z.array(ItemDaEdicaoSchema).max(LIMITES.itens).optional(),
    coleta: ColetaSchema.nullish(),
    observacoes: z.string().trim().max(LIMITES.observacoes).nullish(),
    separar_ate: z.string().trim().regex(DATA).nullish(),
    evento: EventoDoPatchSchema.optional(),
  })
  .strict();

/** A criação: o evento existente (`event_id`) ou um novo, pelo nome; o resto pode vir vazio. */
export const CriarEdicaoSchema = z
  .object({
    idempotency_key: idempotencyKey,
    customer_code: customerCode,
    event_id: optionalText(120),
    name: optionalText(LIMITES.nome),
    description: optionalText(LIMITES.descricao),
    origem_edicao_id: optionalText(120),
    patch: ConteudoDaEdicaoSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.event_id || value.name), { message: "Informe o nome do evento", path: ["name"] });

export const PatchDaEdicaoSchema = z
  .object({
    id: idDaEdicao,
    expected_edicao: z.number().int().min(1),
    customer_code: customerCode,
    patch: ConteudoDaEdicaoSchema,
  })
  .strict();

export const EnviarEdicaoSchema = z
  .object({ id: idDaEdicao, expected_edicao: z.number().int().min(1), idempotency_key: idempotencyKey, customer_code: customerCode })
  .strict();

export const CancelarEdicaoSchema = z
  .object({ id: idDaEdicao, idempotency_key: idempotencyKey, motivo: optionalText(LIMITES.motivo), customer_code: customerCode })
  .strict();

export const ArquivarEventoSchema = z
  .object({ event_id: z.string().trim().min(1).max(120), idempotency_key: idempotencyKey, customer_code: customerCode })
  .strict();

export type MomentoPrevistoEntrada = z.output<typeof MomentoPrevistoSchema>;
export type ItemDaEdicao = z.output<typeof ItemDaEdicaoSchema>;
export type Coleta = z.output<typeof ColetaSchema>;
export type Onde = z.output<typeof OndeSchema>;
export type Conteudo = z.output<typeof ConteudoDaEdicaoSchema>;
export type CriarEdicao = z.output<typeof CriarEdicaoSchema>;
export type PatchDaEdicao = z.output<typeof PatchDaEdicaoSchema>;
export type EnviarEdicao = z.output<typeof EnviarEdicaoSchema>;
export type CancelarEdicao = z.output<typeof CancelarEdicaoSchema>;
export type ArquivarEvento = z.output<typeof ArquivarEventoSchema>;

// ------------------------------------------------------- a recusa por campo

type Caminho = ReadonlyArray<string | number>;

type ContextoDoRotulo = {
  /** A posição na lista do caminho (o momento ou o item), contada de 0. */
  indice: number;
  /** "de Montagem", "de Ensaio" (o outro com rótulo) ou "do momento 3". */
  deMomento: string;
  /** "de A.01.0809.002" (o código do cliente da linha, senão o SKU) ou "do item 3": o nome se repete entre os tamanhos. */
  deCodigo: string;
  /** "de BTG-000002" (o SKU da linha) ou "do item 3". */
  deSku: string;
};

type Rotulo = string | ((contexto: ContextoDoRotulo) => string);

/**
 * O rótulo de cada campo, pelo caminho da issue com `<n>` no lugar da
 * posição; vale a chave mais longa que é prefixo do caminho. Começa pelo
 * artigo, que decide a concordância ("passa" ou "passam", "inválido" ou
 * "inválida"). A chave `observacao` da raiz fica de fora: cada callable que
 * a tem passa o rótulo dela na chamada.
 */
export const ROTULO_DO_CAMPO: Record<string, Rotulo> = {
  idempotency_key: "a chave da operação",
  customer_code: "o código do cliente",
  id: "a edição",
  expected_edicao: "a versão da edição",
  event_id: "o evento",
  name: "o nome do evento",
  description: "a descrição do evento",
  origem_edicao_id: "a edição de origem",
  motivo: "o motivo",
  patch: "a mudança da edição",
  "patch.label": "o nome da edição",
  "patch.onde": "o lugar do evento",
  "patch.onde.local": "o local",
  "patch.onde.endereco": "o endereço",
  "patch.onde.contato": "o contato no local",
  "patch.onde.contato.nome": "o contato no local",
  "patch.onde.contato.telefone": "o telefone do contato",
  "patch.cronograma": "o cronograma",
  "patch.cronograma.<n>": ({ indice }) => `o ${indice + 1}º momento do cronograma`,
  "patch.cronograma.<n>.id": ({ deMomento }) => `o momento ${deMomento}`,
  "patch.cronograma.<n>.tipo": "o tipo do momento",
  "patch.cronograma.<n>.rotulo": "o nome do outro momento",
  "patch.cronograma.<n>.data": ({ deMomento }) => `a data ${deMomento}`,
  "patch.cronograma.<n>.hora": ({ deMomento }) => `a hora ${deMomento}`,
  "patch.cronograma.<n>.ate": ({ deMomento }) => `a hora final ${deMomento}`,
  "patch.cronograma.<n>.local": ({ deMomento }) => `o local ${deMomento}`,
  "patch.cronograma.<n>.observacao": ({ deMomento }) => `a observação ${deMomento}`,
  // "Os itens leva até 100 itens" não concorda: quem leva os itens é a edição.
  "patch.itens": "a edição",
  "patch.itens.<n>": ({ indice }) => `o ${indice + 1}º item`,
  "patch.itens.<n>.sku_code": ({ indice }) => `o código do item ${indice + 1}`,
  "patch.itens.<n>.client_item_code": ({ deSku }) => `o código do cliente ${deSku}`,
  "patch.itens.<n>.product_name": ({ deCodigo }) => `o nome ${deCodigo}`,
  "patch.itens.<n>.size": ({ deCodigo }) => `o tamanho ${deCodigo}`,
  "patch.itens.<n>.category": ({ deCodigo }) => `o tipo ${deCodigo}`,
  "patch.itens.<n>.quantity": ({ deCodigo }) => `a quantidade ${deCodigo}`,
  "patch.coleta": "a coleta no cliente",
  "patch.coleta.onde": "o lugar da coleta",
  "patch.coleta.quantidade": "a quantidade da coleta",
  "patch.coleta.valor_declarado_cents": "o valor declarado",
  "patch.observacoes": "as observações para a Dutelog",
  "patch.separar_ate": "o separar até",
  "patch.evento": "o evento",
  "patch.evento.name": "o nome do evento",
  "patch.evento.description": "a descrição do evento",
  // Os arquivos da edição (parte 3): attachEventDocument, removeEventDocument e attachEventPhoto.
  edition_id: "a edição",
  arquivo: "o arquivo",
  nome: "o nome do arquivo",
  legenda: "a legenda",
  momento_id: "o momento",
  instante: "o instante da foto",
  documento_id: "o documento",
};

/** A unidade de cada lista, pelo nome dela: "O cronograma leva até 12 momentos". */
const UNIDADE_DA_LISTA: Record<string, string> = {
  cronograma: "momentos",
  itens: "itens",
  fotos: "fotos",
  documentos: "documentos",
};

const unidades = new Intl.NumberFormat("pt-BR");

function registro(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lerCaminho(raiz: unknown, caminho: Caminho): unknown {
  let atual: unknown = raiz;
  for (const parte of caminho) {
    if (atual == null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string | number, unknown>)[parte];
  }
  return atual;
}

function contextoDe(caminho: Caminho, raw: unknown): ContextoDoRotulo {
  let posicao = -1;
  caminho.forEach((parte, n) => {
    if (typeof parte === "number") posicao = n;
  });
  const indice = posicao >= 0 ? Number(caminho[posicao]) : 0;
  const linha = registro(posicao >= 0 ? lerCaminho(raw, caminho.slice(0, posicao + 1)) : undefined);
  const tipo = linha.tipo;
  const nomeDoMomento =
    typeof tipo === "string" && tipo in ROTULO_DO_MOMENTO
      ? tipo === "outro"
        ? texto(linha.rotulo) ?? ROTULO_DO_MOMENTO.outro
        : ROTULO_DO_MOMENTO[tipo as TipoDeMomento]
      : null;
  const sku = texto(linha.sku_code);
  const codigo = texto(linha.client_item_code) ?? sku;
  return {
    indice,
    deMomento: nomeDoMomento ? `de ${nomeDoMomento}` : `do momento ${indice + 1}`,
    deCodigo: codigo ? `de ${codigo}` : `do item ${indice + 1}`,
    deSku: sku ? `de ${sku}` : `do item ${indice + 1}`,
  };
}

/** O rótulo da chave mais longa que é prefixo do caminho, com a posição como está ou como `<n>`. */
function rotuloNoMapa(mapa: Record<string, Rotulo | undefined>, caminho: Caminho): Rotulo | undefined {
  const exato = caminho.map(String);
  const generico = caminho.map((parte) => (typeof parte === "number" ? "<n>" : String(parte)));
  for (let tamanho = caminho.length; tamanho > 0; tamanho -= 1) {
    const rotulo = mapa[exato.slice(0, tamanho).join(".")] ?? mapa[generico.slice(0, tamanho).join(".")];
    if (rotulo !== undefined) return rotulo;
  }
  return undefined;
}

/** O rótulo do campo: primeiro o mapa da chamada, depois ROTULO_DO_CAMPO. */
function rotuloDoCaminho(caminho: Caminho, raw: unknown, rotulos: Record<string, string>): string {
  const rotulo = rotuloNoMapa(rotulos, caminho) ?? rotuloNoMapa(ROTULO_DO_CAMPO, caminho);
  if (rotulo === undefined) return `o campo ${caminho.join(".") || "da entrada"}`;
  return typeof rotulo === "function" ? rotulo(contextoDe(caminho, raw)) : rotulo;
}

const maiuscula = (frase: string) => frase.charAt(0).toUpperCase() + frase.slice(1);
const minuscula = (frase: string) => frase.charAt(0).toLowerCase() + frase.slice(1);

/**
 * A frase da recusa para a primeira issue: o texto acima do limite e a lista
 * cheia dizem o limite, o obrigatório ausente pede o campo, e o resto diz
 * que o campo é inválido, concordando com o artigo do rótulo.
 */
export function mensagemDoCampo(issue: z.ZodIssue, raw: unknown, rotulos: Record<string, string> = {}): string {
  if (issue.code === z.ZodIssueCode.custom) return issue.message;
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return `Campo não aceito: ${[...issue.path, issue.keys[0]].join(".")}`;
  const rotulo = rotuloDoCaminho(issue.path, raw, rotulos);
  const artigo = minuscula(rotulo).split(" ")[0];
  const plural = artigo === "os" || artigo === "as";
  const feminino = artigo === "a" || artigo === "as";
  if (issue.code === z.ZodIssueCode.too_big) {
    if (issue.type === "string") return `${maiuscula(rotulo)} ${plural ? "passam" : "passa"} de ${issue.maximum} caracteres`;
    if (issue.type === "array") {
      const lista = [...issue.path].reverse().find((parte): parte is string => typeof parte === "string") ?? "";
      return `${maiuscula(rotulo)} ${plural ? "levam" : "leva"} até ${issue.maximum} ${UNIDADE_DA_LISTA[lista] ?? "itens"}`;
    }
    if (issue.type === "number") return `${maiuscula(rotulo)} ${plural ? "passam" : "passa"} de ${unidades.format(Number(issue.maximum))}`;
  }
  const ausente = issue.code === z.ZodIssueCode.invalid_type && (issue.received === "undefined" || issue.received === "null");
  if (issue.code === z.ZodIssueCode.too_small || ausente) return `Informe ${minuscula(rotulo)}`;
  return `${maiuscula(rotulo)} ${feminino ? (plural ? "inválidas" : "inválida") : plural ? "inválidos" : "inválido"}`;
}

/**
 * A entrada validada, ou invalid-argument com a frase da primeira issue.
 * `rotulos` é o mapa da chamada (as chaves no formato de ROTULO_DO_CAMPO) e
 * prevalece sobre ele.
 */
export function entradaDe<S extends z.ZodTypeAny>(schema: S, raw: unknown, rotulos?: Record<string, string>): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data as z.output<S>;
  const issue = parsed.error.issues[0];
  throw new HttpsError("invalid-argument", issue ? mensagemDoCampo(issue, raw, rotulos) : "Entrada inválida");
}

/** saveEventEdition: com `id` é o patch, sem ele é a criação (um union perderia o campo da recusa). */
export function entradaDoSalvar(raw: unknown): CriarEdicao | PatchDaEdicao {
  const comId = registro(raw).id != null;
  return comId ? entradaDe(PatchDaEdicaoSchema, raw) : entradaDe(CriarEdicaoSchema, raw);
}

// --------------------------------------------------- o que cada status muda

export const CAMPOS_DO_CONTEUDO = ["label", "onde", "cronograma", "itens", "coleta", "observacoes", "separar_ate", "evento"] as const;
export type CampoDoConteudo = (typeof CAMPOS_DO_CONTEUDO)[number];

/** Quem mexe nos eventos do cliente: o cliente e a coordenação em nome dele (assertClientEventEditor). */
const EDITORES = ["cliente", "owner", "admin", "interno"];
const COORDENACAO = ["owner", "admin", "interno"];

/**
 * O rascunho muda inteiro, menos o separar até, que nasce na confirmação.
 * Depois do envio só a coordenação muda, e só onde, o cronograma previsto,
 * o label e o evento; confirmada, também o separar até; separada, só ele.
 */
export function camposDoPatchPermitidos(status: StatusDaEdicao, papel: string): readonly CampoDoConteudo[] {
  if (status === "rascunho") return EDITORES.includes(papel) ? CAMPOS_DO_CONTEUDO.filter((campo) => campo !== "separar_ate") : [];
  if (!COORDENACAO.includes(papel)) return [];
  if (status === "enviado") return ["label", "onde", "cronograma", "evento"];
  if (status === "confirmado") return ["label", "onde", "cronograma", "separar_ate", "evento"];
  if (status === "separado") return ["separar_ate"];
  return [];
}

/** A primeira recusa do patch neste status, para este papel, ou null. */
export function problemaDoPatch(status: StatusDaEdicao, papel: string, patch: Partial<Record<CampoDoConteudo, unknown>>): string | null {
  const presentes = CAMPOS_DO_CONTEUDO.filter((campo) => patch[campo] !== undefined);
  if (presentes.includes("separar_ate") && (status === "rascunho" || status === "enviado")) return "O separar até nasce na confirmação";
  if (presentes.includes("itens") && status !== "rascunho") return "Os itens não mudam depois do envio";
  const permitidos = camposDoPatchPermitidos(status, papel);
  if (!permitidos.length || presentes.some((campo) => !permitidos.includes(campo))) return "A edição não aceita mudança neste status";
  return null;
}

/**
 * A forma do cronograma que se grava: cada tipo fixo uma vez e até cinco
 * outros (as frases de problemaDoCronograma). O resto (o evento com data, a
 * ordem) só se exige no envio: o rascunho se preenche aos poucos.
 */
export function problemaDaFormaDoCronograma<M extends { tipo: TipoDeMomento }>(momentos: readonly M[]): string | null {
  if (momentos.filter((momento) => momento.tipo === "outro").length > LIMITES.outros) {
    return "O cronograma leva até cinco momentos do tipo outro";
  }
  const vistos = new Set<TipoDeMomento>();
  for (const momento of momentos) {
    if (momento.tipo === "outro") continue;
    if (vistos.has(momento.tipo)) return `O momento ${ROTULO_DO_MOMENTO[momento.tipo]} se repete`;
    vistos.add(momento.tipo);
  }
  return null;
}

// ------------------------------------------------------------------ leitura

export type ActorRef = { uid: string; name: string | null; role: string };

export type FeitoDoMomentoView = {
  inicio: string;
  fim: string | null;
  observacao: string | null;
  origem: OrigemDoFeito;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
  corrigido_em: string | null;
};

export type MomentoView = {
  id: string;
  tipo: TipoDeMomento;
  rotulo: string | null;
  /** `hora` null fora da entrega no local, quando a pessoa não a deu (decisão 12). */
  previsto: { data: string; hora: string | null; ate: string | null; local: string | null; observacao: string | null };
  feito: FeitoDoMomentoView | null;
};

export type ItemView = {
  sku_code: string;
  client_item_code: string | null;
  product_name: string;
  size: string | null;
  category: string | null;
  quantity: number;
  foi: number | null;
  voltou: number | null;
  avariadas: number | null;
  nao_voltaram: number | null;
  observacao: string | null;
};

export type DocumentoView = {
  id: string;
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
  origem: "cliente" | "dutelog";
  momento_id: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
};

export type FotoView = {
  id: string;
  caminho: string;
  momento_id: string | null;
  legenda: string | null;
  instante: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
};

export type VolumeView = {
  numero: number;
  unidades: number;
  peso_kg: number | null;
  itens: Array<{ client_item_code: string | null; product_name: string; size: string | null; quantidade: number }>;
};

export type PedidoView = {
  request_id: string | null;
  request_number: string | null;
  order_id: string | null;
  order_number: string | null;
  separado_em: string | null;
  lacre: string | null;
  volumes_total: number | null;
  volumes: VolumeView[];
  entregue_em: string | null;
  entregue_por: ActorRef | null;
  comprovante: string | null;
  cancelado_em: string | null;
};

export type RetornoView = {
  chegou_em: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
  observacao: string | null;
  return_id: string | null;
};

/** O documento da edição como as telas e as callables o leem: os carimbos em ISO e o ausente em null. */
export type EdicaoView = {
  id: string;
  customer_code: string;
  event_id: string;
  event_name: string;
  label: string | null;
  status: StatusDaEdicao;
  edicao: number;
  origem_edicao_id: string | null;
  onde: { local: string | null; endereco: string | null; contato: { nome: string | null; telefone: string | null } };
  cronograma: MomentoView[];
  itens: ItemView[];
  itens_total: number;
  pecas_total: number;
  coleta: { onde: string | null; quantidade: number; voltou: number | null; distribuidos: number | null };
  observacoes: string | null;
  observacoes_dutelog: string | null;
  documentos: DocumentoView[];
  fotos: FotoView[];
  equipe: { estoquistas: string | null; do_cliente: string | null; veiculo: string | null; contato_no_local: string | null };
  /** Na raiz, nunca em `pedido`: a confirmação o grava, com ou sem pedido. */
  separar_ate: string | null;
  pedido: PedidoView | null;
  retorno: RetornoView | null;
  enviada_em: string | null;
  confirmada_em: string | null;
  fechada_em: string | null;
  cancelada_em: string | null;
  cancelada_por: ActorRef | null;
  cancelamento_motivo: string | null;
  created_by: ActorRef | null;
  created_at: string | null;
  updated_by: ActorRef | null;
  updated_at: string | null;
};

/** O carimbo em ISO: o Timestamp lido, o Date da escrita desta chamada ou o texto ISO gravado. */
function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" && value ? value : null;
}

function numero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numeroOuNulo(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lista(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(registro) : [];
}

function ator(value: unknown): ActorRef | null {
  const dados = registro(value);
  if (!texto(dados.uid)) return null;
  return { uid: String(dados.uid), name: texto(dados.name), role: String(dados.role ?? "") };
}

function statusDe(value: unknown): StatusDaEdicao {
  // Só o servidor grava o status; sem um válido, a edição não aceita nada.
  return (STATUS_DA_EDICAO as readonly unknown[]).includes(value) ? (value as StatusDaEdicao) : "cancelado";
}

function feitoDe(value: unknown): FeitoDoMomentoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    inicio: iso(dados.inicio) ?? "",
    fim: iso(dados.fim),
    observacao: texto(dados.observacao),
    origem: (ORIGENS_DO_FEITO as readonly unknown[]).includes(dados.origem) ? (dados.origem as OrigemDoFeito) : "registro",
    registrado_por: ator(dados.registrado_por),
    registrado_em: iso(dados.registrado_em),
    corrigido_em: iso(dados.corrigido_em),
  };
}

function momentoDe(dados: Record<string, unknown>): MomentoView {
  const previsto = registro(dados.previsto);
  return {
    id: String(dados.id ?? ""),
    tipo: (TIPOS_DE_MOMENTO as readonly unknown[]).includes(dados.tipo) ? (dados.tipo as TipoDeMomento) : "outro",
    rotulo: texto(dados.rotulo),
    previsto: {
      data: String(previsto.data ?? ""),
      hora: texto(previsto.hora),
      ate: texto(previsto.ate),
      local: texto(previsto.local),
      observacao: texto(previsto.observacao),
    },
    feito: feitoDe(dados.feito),
  };
}

function itemDe(dados: Record<string, unknown>): ItemView {
  return {
    sku_code: String(dados.sku_code ?? ""),
    client_item_code: texto(dados.client_item_code),
    product_name: String(dados.product_name ?? ""),
    size: texto(dados.size),
    category: texto(dados.category),
    quantity: numero(dados.quantity),
    foi: numeroOuNulo(dados.foi),
    voltou: numeroOuNulo(dados.voltou),
    avariadas: numeroOuNulo(dados.avariadas),
    nao_voltaram: numeroOuNulo(dados.nao_voltaram),
    observacao: texto(dados.observacao),
  };
}

function pedidoDe(value: unknown): PedidoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    request_id: texto(dados.request_id),
    request_number: texto(dados.request_number),
    order_id: texto(dados.order_id),
    order_number: texto(dados.order_number),
    separado_em: iso(dados.separado_em),
    lacre: texto(dados.lacre),
    volumes_total: numeroOuNulo(dados.volumes_total),
    volumes: lista(dados.volumes).map((volume) => ({
      numero: numero(volume.numero),
      unidades: numero(volume.unidades),
      peso_kg: numeroOuNulo(volume.peso_kg),
      itens: lista(volume.itens).map((item) => ({
        client_item_code: texto(item.client_item_code),
        product_name: String(item.product_name ?? ""),
        size: texto(item.size),
        quantidade: numero(item.quantidade),
      })),
    })),
    entregue_em: iso(dados.entregue_em),
    entregue_por: ator(dados.entregue_por),
    comprovante: texto(dados.comprovante),
    cancelado_em: iso(dados.cancelado_em),
  };
}

function retornoDe(value: unknown): RetornoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    chegou_em: iso(dados.chegou_em),
    registrado_por: ator(dados.registrado_por),
    registrado_em: iso(dados.registrado_em),
    observacao: texto(dados.observacao),
    return_id: texto(dados.return_id),
  };
}

export function viewDaEdicao(id: string, data: Record<string, unknown>): EdicaoView {
  const onde = registro(data.onde);
  const contato = registro(onde.contato);
  const coleta = registro(data.coleta);
  const equipe = registro(data.equipe);
  return {
    id,
    customer_code: String(data.customer_code ?? ""),
    event_id: String(data.event_id ?? ""),
    event_name: String(data.event_name ?? ""),
    label: texto(data.label),
    status: statusDe(data.status),
    edicao: numero(data.edicao),
    origem_edicao_id: texto(data.origem_edicao_id),
    onde: { local: texto(onde.local), endereco: texto(onde.endereco), contato: { nome: texto(contato.nome), telefone: texto(contato.telefone) } },
    cronograma: lista(data.cronograma).map(momentoDe),
    itens: lista(data.itens).map(itemDe),
    itens_total: numero(data.itens_total),
    pecas_total: numero(data.pecas_total),
    coleta: { onde: texto(coleta.onde), quantidade: numero(coleta.quantidade), voltou: numeroOuNulo(coleta.voltou), distribuidos: numeroOuNulo(coleta.distribuidos) },
    observacoes: texto(data.observacoes),
    observacoes_dutelog: texto(data.observacoes_dutelog),
    documentos: lista(data.documentos).map((documento) => ({
      id: String(documento.id ?? ""),
      caminho: String(documento.caminho ?? ""),
      nome: String(documento.nome ?? ""),
      tipo: String(documento.tipo ?? ""),
      tamanho: numero(documento.tamanho),
      origem: documento.origem === "dutelog" ? "dutelog" : "cliente",
      momento_id: texto(documento.momento_id),
      registrado_por: ator(documento.registrado_por),
      registrado_em: iso(documento.registrado_em),
    })),
    fotos: lista(data.fotos).map((foto) => ({
      id: String(foto.id ?? ""),
      caminho: String(foto.caminho ?? ""),
      momento_id: texto(foto.momento_id),
      legenda: texto(foto.legenda),
      instante: iso(foto.instante),
      registrado_por: ator(foto.registrado_por),
      registrado_em: iso(foto.registrado_em),
    })),
    equipe: {
      estoquistas: texto(equipe.estoquistas),
      do_cliente: texto(equipe.do_cliente),
      veiculo: texto(equipe.veiculo),
      contato_no_local: texto(equipe.contato_no_local),
    },
    separar_ate: texto(data.separar_ate),
    pedido: pedidoDe(data.pedido),
    retorno: retornoDe(data.retorno),
    enviada_em: iso(data.enviada_em),
    confirmada_em: iso(data.confirmada_em),
    fechada_em: iso(data.fechada_em),
    cancelada_em: iso(data.cancelada_em),
    cancelada_por: ator(data.cancelada_por),
    cancelamento_motivo: texto(data.cancelamento_motivo),
    created_by: ator(data.created_by),
    created_at: iso(data.created_at),
    updated_by: ator(data.updated_by),
    updated_at: iso(data.updated_at),
  };
}

/** O momento lido como o domínio o confere (problemaDoCronograma). */
export function previstoDoMomento(momento: MomentoView): MomentoPrevisto {
  return {
    tipo: momento.tipo,
    rotulo: momento.rotulo,
    data: momento.previsto.data,
    hora: momento.previsto.hora,
    ate: momento.previsto.ate,
    local: momento.previsto.local,
    observacao: momento.previsto.observacao,
  };
}

/** O que falta para enviar, na ordem da tela: o local, um item ou a coleta, e o cronograma. */
export function problemaParaEnviar(edicao: EdicaoView): string | null {
  if (!edicao.onde.local) return "Informe o local";
  const comItensDoEstoque = edicao.itens.length > 0;
  const comColeta = edicao.coleta.quantidade > 0;
  if (!comItensDoEstoque && !comColeta) return "Escolha ao menos um item ou informe a coleta no cliente";
  return problemaDoCronograma(edicao.cronograma.map(previstoDoMomento), { comItensDoEstoque, comColeta });
}
