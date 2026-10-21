import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  cadastroArquivado,
  cadastroDoWms,
  canonicalCustomerCode,
  cnpjDaEntrada,
  cnpjNormalizado,
  codigoDoNovoCadastro,
  customerIdentityConflict,
  customerStage,
  entityIdDoCadastro,
  safeDocId,
  textoLimpo as text,
} from "./customer-identity.js";
import { createComercialEvent } from "./events.js";
import { digest, runIdempotent, type ComercialActor } from "./operations.js";
import { comercialAccessProblem, isPlatformRole, type PlatformRole } from "./platform-roles.js";
import { USERS_COLLECTION, type ComercialProfile } from "./profile.js";

/**
 * Cadastro comercial no backend (docs/plataforma/fase-6-comercial.md,
 * "Cadastro"; parte 6): o prospect e os dados comerciais em `customers`, os
 * locais em `customer_locations` e os contatos em `customer_contacts`.
 *
 * - `customers` é o mesmo documento do WMS. O Comercial grava só os campos
 *   dele e nunca `sku_prefix`, `operation_template`, `modules`,
 *   `client_profiles` nem `client_access`: o prospect não tem sigla, módulos
 *   nem projeções, e marcar como cliente não liga nada no WMS.
 * - Toda escrita passa por runIdempotent (recibo em comercial_operations) e
 *   grava o evento na mesma transação, com o código real do cliente e sem
 *   nome, e-mail, telefone ou endereço.
 * - A entrada passa por safeParse (invalid-argument com mensagem em
 *   português); toda transição confere o estado atual dentro da transação, e
 *   todas as leituras vêm antes das escritas.
 */

export const CUSTOMERS_COLLECTION = "customers";
export const CLIENT_PROFILES_COLLECTION = "client_profiles";
export const CUSTOMER_LOCATIONS_COLLECTION = "customer_locations";
export const CUSTOMER_CONTACTS_COLLECTION = "customer_contacts";

/** Quem arquiva cadastro pelo Comercial: owner e admin. O comercial não. */
export const CUSTOMER_ARCHIVER_ROLES = ["owner", "admin"] as const satisfies readonly PlatformRole[];

export const ORIGENS_CADASTRO = ["comercial", "omie"] as const;
export type OrigemCadastro = (typeof ORIGENS_CADASTRO)[number];

export const PAPEIS_CONTATO = ["gestor_cliente", "gerenciadora", "financeiro", "outro"] as const;
export type PapelContato = (typeof PAPEIS_CONTATO)[number];

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

// --- Entrada -----------------------------------------------------------------

/** Mensagens em português para o que o schema não diz com mensagem própria. */
const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  switch (issue.code) {
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? `Informe ${campo}.` : `${campo}: tipo inválido.` };
    case z.ZodIssueCode.too_small:
      return { message: `${campo}: curto demais.` };
    case z.ZodIssueCode.too_big:
      return { message: `${campo}: longo demais.` };
    default:
      return { message: `${campo}: valor inválido.` };
  }
};

/** safeParse com invalid-argument: nunca "internal" no app. */
export function parseEntrada<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data ?? {}, { errorMap: mensagens });
  if (parsed.success) return parsed.data;
  throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
}

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const codigoCliente = z.string().trim().min(1, "Informe o código do cliente.").max(200);
/** Texto opcional: vazio vira null (limpa o campo). */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));
const uf = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null))
  .refine((value) => value == null || (UFS as readonly string[]).includes(value), "UF inválida.");
/**
 * Id que o Firestore aceita como documento: sem barra, diferente de "." e
 * "..", e fora do formato reservado `__x__`. O que vira caminho de documento
 * passa por aqui, para o erro sair como invalid-argument e nunca como o erro
 * cru do Firestore ("internal" no app).
 */
export function idDeDocumentoValido(value: string): boolean {
  return value.length > 0 && !value.includes("/") && value !== "." && value !== ".." && !/^__.*__$/.test(value);
}
const idDocumento = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,120}$/, "Id inválido.")
  .refine(idDeDocumentoValido, "Id inválido.");
const nomeObrigatorio = z.string().trim().min(2, "Informe o nome (ao menos 2 caracteres).").max(120, "Use até 120 caracteres no nome.");
/** Uid do responsável: vira `users/{uid}` na leitura. */
const uidResponsavel = z
  .string()
  .trim()
  .min(1, "Informe o responsável.")
  .max(128, "Responsável inválido.")
  .refine(idDeDocumentoValido, "Responsável inválido.");

const dadosComerciais = z
  .object({
    responsavel_uid: uidResponsavel.nullable().optional(),
    cidade: textoOpcional(80),
    uf,
  })
  .strict();

const CriarCadastro = z
  .object({
    action: z.literal("create"),
    idempotency_key: chave,
    name: nomeObrigatorio,
    code: z.string().max(40).optional(),
    legal_name: textoOpcional(160),
    document: z.string().max(40).nullable().optional(),
    comercial: dadosComerciais.optional(),
  })
  .strict();

const AlterarCadastro = z
  .object({
    action: z.literal("update"),
    idempotency_key: chave,
    customer_code: codigoCliente,
    name: nomeObrigatorio.optional(),
    legal_name: textoOpcional(160),
    document: z.string().max(40).nullable().optional(),
    comercial: dadosComerciais.optional(),
  })
  .strict();

const MarcarCliente = z
  .object({ action: z.literal("mark_client"), idempotency_key: chave, customer_code: codigoCliente })
  .strict();

const ArquivarCadastro = z
  .object({ action: z.literal("archive"), idempotency_key: chave, customer_code: codigoCliente })
  .strict();

export const SaveCommercialCustomerInput = z.discriminatedUnion("action", [
  CriarCadastro,
  AlterarCadastro,
  MarcarCliente,
  ArquivarCadastro,
]);
export type SaveCommercialCustomerInput = z.infer<typeof SaveCommercialCustomerInput>;

const endereco = z
  .object({
    logradouro: textoOpcional(160),
    numero: textoOpcional(20),
    complemento: textoOpcional(80),
    bairro: textoOpcional(80),
    cidade: textoOpcional(80),
    uf,
    cep: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value ? value.replace(/\D/g, "") : null))
      .refine((value) => value == null || /^\d{8}$/.test(value), "CEP inválido: use 8 dígitos.")
      .transform((value) => (value ? `${value.slice(0, 5)}-${value.slice(5)}` : value)),
  })
  .strict();

const siglaLocal = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null))
  .refine(
    (value) => value == null || /^[A-Z0-9][A-Z0-9-]{0,11}$/.test(value),
    "Sigla do local inválida: letras sem acento, números e hífen, até 12 caracteres.",
  );

export const SaveCustomerLocationInput = z
  .object({
    idempotency_key: chave,
    customer_code: codigoCliente,
    local_id: idDocumento.optional(),
    nome: nomeObrigatorio,
    sigla: siglaLocal,
    endereco: endereco.nullable().optional(),
    ativo: z.boolean().optional(),
  })
  .strict();
export type SaveCustomerLocationInput = z.infer<typeof SaveCustomerLocationInput>;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null))
  .refine((value) => value == null || z.string().email().max(160).safeParse(value).success, "E-mail inválido.");

const telefone = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value ? value.replace(/[\s().-]/g, "") : null))
  .refine((value) => value == null || /^\+?\d{8,15}$/.test(value), "Telefone inválido: use DDD e número.");

export const SaveCustomerContactInput = z
  .object({
    idempotency_key: chave,
    customer_code: codigoCliente,
    contato_id: idDocumento.optional(),
    nome: nomeObrigatorio,
    email,
    telefone,
    empresa: textoOpcional(120),
    papel: z.enum(PAPEIS_CONTATO).optional(),
    ativo: z.boolean().optional(),
  })
  .strict();
export type SaveCustomerContactInput = z.infer<typeof SaveCustomerContactInput>;

// --- Apoio --------------------------------------------------------------------

function actorOf(caller: ComercialProfile): ComercialActor {
  const actor: ComercialActor = { uid: caller.uid, role: caller.role };
  if (caller.email) actor.email = caller.email;
  if (caller.name) actor.name = caller.name;
  return actor;
}

/** Os testes chamam as funções de domínio direto: a barreira do módulo vale aqui também. */
function assertComercialCaller(caller: ComercialProfile): void {
  const problem = comercialAccessProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

/** Conteúdo da chamada para o hash do recibo: tudo menos a chave. */
function conteudo<T extends { idempotency_key: string }>(input: T): Omit<T, "idempotency_key"> {
  const { idempotency_key: _chave, ...rest } = input;
  return rest;
}

type CadastroEncontrado = { ref: DocumentReference; id: string; data: Record<string, unknown> };

/**
 * Cadastro pelo código real (`customer_code`, ou `code` no cadastro antigo
 * sem o campo), dentro da transação. Nenhum: not-found. Mais de um:
 * failed-precondition, sem escolher por conta própria.
 */
async function cadastroPeloCodigo(transaction: Transaction, db: Firestore, code: string): Promise<CadastroEncontrado> {
  const customers = db.collection(CUSTOMERS_COLLECTION);
  let docs = (await transaction.get(customers.where("customer_code", "==", code))).docs;
  if (!docs.length) docs = (await transaction.get(customers.where("code", "==", code))).docs;
  if (!docs.length) throw new HttpsError("not-found", `Cadastro ${code} não encontrado.`);
  if (docs.length > 1) {
    throw new HttpsError(
      "failed-precondition",
      `Há mais de um cadastro com o código ${code}. Confira em Configurações › Clientes antes de continuar.`,
    );
  }
  return { ref: docs[0].ref, id: docs[0].id, data: docs[0].data() ?? {} };
}

function assertNaoArquivado(cadastro: CadastroEncontrado, code: string): void {
  if (cadastroArquivado(cadastro.data)) {
    throw new HttpsError("failed-precondition", `O cadastro ${code} está arquivado.`);
  }
}

/** O responsável é alguém com acesso ao Comercial e com o acesso ativo. */
async function assertResponsavel(transaction: Transaction, db: Firestore, uid: string): Promise<void> {
  const snapshot = await transaction.get(db.collection(USERS_COLLECTION).doc(uid));
  const data = snapshot.data() ?? {};
  const valido =
    snapshot.exists &&
    data.access_disabled !== true &&
    isPlatformRole(data.role) &&
    comercialAccessProblem(data.role) === null;
  if (!valido) {
    throw new HttpsError("invalid-argument", "O responsável precisa ser alguém da equipe com acesso ao Comercial.");
  }
}

async function temProjecao(transaction: Transaction, db: Firestore, documentId: string): Promise<boolean> {
  return (await transaction.get(db.collection(CLIENT_PROFILES_COLLECTION).doc(documentId))).exists;
}

// --- Cadastro: criação --------------------------------------------------------

export type DadosDoProspect = {
  code: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  origem: OrigemCadastro;
  comercial: {
    responsavel_uid: string | null;
    cidade: string | null;
    uf: string | null;
    omie_ids: string[];
  };
};

/**
 * Documento de um prospect novo em `customers`. Só os campos do Comercial:
 * nada de sigla, modelo, módulos ou projeção. A carga da Omie (parte 8) usa
 * a mesma função com origem "omie".
 */
export function prospectPayload(documentId: string, dados: DadosDoProspect, actorUid: string): Record<string, unknown> {
  return {
    id: documentId,
    code: dados.code,
    customer_code: dados.code,
    name: dados.name,
    legal_name: dados.legal_name,
    document: dados.document,
    stage: "prospect",
    stage_changed_at: FieldValue.serverTimestamp(),
    origem: dados.origem,
    comercial: dados.comercial,
    status: "active",
    portal_status: "inactive",
    archived: false,
    created_by: actorUid,
    updated_by: actorUid,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
}

export type CadastroResult = {
  ok: true;
  customer_id: string;
  customer_code: string;
  stage: "prospect" | "cliente";
  campos?: string[];
  events: string[];
};

async function criarCadastro(
  db: Firestore,
  caller: ComercialProfile,
  input: z.infer<typeof CriarCadastro>,
): Promise<CadastroResult & { replayed?: true }> {
  const code = codigoDoNovoCadastro(input.code, input.name);
  const document = cnpjDaEntrada(input.document);
  const documentId = safeDocId(code);
  const responsavel = input.comercial?.responsavel_uid === undefined ? caller.uid : input.comercial.responsavel_uid;
  const actor = actorOf(caller);

  return runIdempotent<CadastroResult>(
    db,
    {
      kind: "commercial_customer_create",
      scope: {},
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      // Leituras: o cadastro inteiro (centenas de documentos) e o responsável.
      const todos = await transaction.get(db.collection(CUSTOMERS_COLLECTION));
      if (responsavel && responsavel !== caller.uid) await assertResponsavel(transaction, db, responsavel);

      const mesmoId = todos.docs.find((row) => row.id === documentId);
      if (mesmoId) {
        const nome = text(mesmoId.get("name")) || mesmoId.id;
        throw new HttpsError("already-exists", `O código ${code} já está em uso no cadastro ${nome}.`);
      }
      const conflito = customerIdentityConflict(
        { code, document, documentId },
        todos.docs.map((row) => ({ id: row.id, data: row.data() })),
      );
      if (conflito) throw new HttpsError("already-exists", conflito);

      // Escritas.
      transaction.create(
        db.collection(CUSTOMERS_COLLECTION).doc(documentId),
        prospectPayload(
          documentId,
          {
            code,
            name: input.name,
            legal_name: input.legal_name ?? null,
            document,
            origem: "comercial",
            comercial: {
              responsavel_uid: responsavel ?? null,
              cidade: input.comercial?.cidade ?? null,
              uf: input.comercial?.uf ?? null,
              omie_ids: [],
            },
          },
          caller.uid,
        ),
      );
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.created",
        entity_id: entityIdDoCadastro(documentId),
        customer_code: code,
        payload: { stage: "prospect" },
        actor,
      });
      return {
        target_id: documentId,
        result: { ok: true, customer_id: documentId, customer_code: code, stage: "prospect", events: [event.id] },
      };
    },
  );
}

// --- Cadastro: alteração ------------------------------------------------------

/** Código de cada campo no evento (snake_case, sem algarismo). */
const CAMPO_DO_EVENTO = {
  name: "nome",
  legal_name: "razao_social",
  document: "cnpj",
  responsavel_uid: "responsavel",
  cidade: "cidade",
  uf: "uf",
} as const;

function mesmoValor(antes: unknown, depois: unknown): boolean {
  return (antes ?? null) === (depois ?? null);
}

/**
 * O CNPJ informado é o que já está gravado? Compara sem máscara, e vale
 * também para o que o WMS gravou sem ser um CNPJ válido (o provisório
 * "00.000.000/0000-00"): reenviar o valor da ficha não é mudar a identidade.
 */
function mesmoDocumento(antes: unknown, informado: unknown): boolean {
  const semMascara = (value: unknown) => text(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (semMascara(antes) === semMascara(informado)) return true;
  const normalizado = cnpjNormalizado(informado);
  return normalizado !== null && normalizado === cnpjNormalizado(antes);
}

/** O mapa `comercial` inteiro, como o prospect nasce: o cadastro do WMS não tem o mapa. */
function comercialPadrao(): Record<string, unknown> {
  return { responsavel_uid: null, cidade: null, uf: null, omie_ids: [] };
}

async function alterarCadastro(
  db: Firestore,
  caller: ComercialProfile,
  input: z.infer<typeof AlterarCadastro>,
): Promise<CadastroResult & { replayed?: true }> {
  const code = input.customer_code;
  const actor = actorOf(caller);

  return runIdempotent<CadastroResult>(
    db,
    {
      kind: "commercial_customer_update",
      scope: { customer_code: code },
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      // Leituras.
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      assertNaoArquivado(cadastro, code);
      const before = cadastro.data;
      const comercialAntes = (
        before.comercial && typeof before.comercial === "object" && !Array.isArray(before.comercial) ? before.comercial : {}
      ) as Record<string, unknown>;

      const identidade: Record<string, unknown> = {};
      if (input.name !== undefined && !mesmoValor(text(before.name), input.name)) identidade.name = input.name;
      if (input.legal_name !== undefined && !mesmoValor(text(before.legal_name) || null, input.legal_name)) {
        identidade.legal_name = input.legal_name;
      }
      // O WMS guarda o CNPJ como foi digitado: primeiro vê se mudou, e só o
      // CNPJ novo passa pela validação (invalid-argument, antes de qualquer escrita).
      if (input.document !== undefined && !mesmoDocumento(before.document, input.document)) {
        identidade.document = cnpjDaEntrada(input.document);
      }

      const comercial: Record<string, unknown> = {};
      for (const campo of ["responsavel_uid", "cidade", "uf"] as const) {
        const valor = input.comercial?.[campo];
        if (valor !== undefined && !mesmoValor(comercialAntes[campo], valor)) comercial[campo] = valor;
      }
      // O que falta no mapa (o cadastro do WMS não tem nenhum) entra com o padrão do prospect.
      const comercialCompleto: Record<string, unknown> = {};
      for (const [campo, padrao] of Object.entries(comercialPadrao())) {
        if (!(campo in comercialAntes)) comercialCompleto[campo] = padrao;
      }
      Object.assign(comercialCompleto, comercial);

      if (Object.keys(identidade).length) {
        if (cadastroDoWms(before, await temProjecao(transaction, db, cadastro.id))) {
          throw new HttpsError(
            "failed-precondition",
            "Este cadastro tem armazenagem no WMS: nome, razão social e CNPJ se editam em Configurações › Clientes.",
          );
        }
        if (identidade.document) {
          const todos = await transaction.get(db.collection(CUSTOMERS_COLLECTION));
          // Só a raiz do CNPJ: o código não muda na alteração.
          const conflito = customerIdentityConflict(
            { code: "", document: identidade.document, documentId: cadastro.id },
            todos.docs.map((row) => ({ id: row.id, data: row.data() })),
          );
          if (conflito) throw new HttpsError("already-exists", conflito);
        }
      }
      if (typeof comercial.responsavel_uid === "string" && comercial.responsavel_uid !== caller.uid) {
        await assertResponsavel(transaction, db, comercial.responsavel_uid);
      }

      const campos = [...Object.keys(identidade), ...Object.keys(comercial)].map(
        (campo) => CAMPO_DO_EVENTO[campo as keyof typeof CAMPO_DO_EVENTO],
      );
      const stage = customerStage(before.stage);
      if (!campos.length) {
        // Nada mudou: só o recibo, sem escrita nem evento.
        return {
          target_id: cadastro.id,
          result: { ok: true, customer_id: cadastro.id, customer_code: code, stage, campos: [], events: [] },
        };
      }

      // Escritas.
      transaction.set(
        cadastro.ref,
        {
          ...identidade,
          ...(Object.keys(comercial).length ? { comercial: comercialCompleto } : {}),
          updated_by: caller.uid,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.updated",
        entity_id: entityIdDoCadastro(cadastro.id),
        customer_code: code,
        payload: { campos },
        actor,
      });
      return {
        target_id: cadastro.id,
        result: { ok: true, customer_id: cadastro.id, customer_code: code, stage, campos, events: [event.id] },
      };
    },
  );
}

// --- Cadastro: marcar como cliente e arquivar ---------------------------------

async function marcarCliente(
  db: Firestore,
  caller: ComercialProfile,
  input: z.infer<typeof MarcarCliente>,
): Promise<CadastroResult & { replayed?: true }> {
  const code = input.customer_code;
  const actor = actorOf(caller);
  return runIdempotent<CadastroResult>(
    db,
    {
      kind: "commercial_customer_mark_client",
      scope: { customer_code: code },
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      assertNaoArquivado(cadastro, code);
      if (customerStage(cadastro.data.stage) !== "prospect") {
        throw new HttpsError("failed-precondition", `O cadastro ${code} já é cliente.`);
      }
      // Não liga nada no WMS: sigla, modelo e módulos continuam em Configurações › Clientes.
      transaction.update(cadastro.ref, {
        stage: "cliente",
        stage_changed_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.became_client",
        entity_id: entityIdDoCadastro(cadastro.id),
        customer_code: code,
        payload: {},
        actor,
      });
      return {
        target_id: cadastro.id,
        result: { ok: true, customer_id: cadastro.id, customer_code: code, stage: "cliente", events: [event.id] },
      };
    },
  );
}

async function arquivarCadastro(
  db: Firestore,
  caller: ComercialProfile,
  input: z.infer<typeof ArquivarCadastro>,
): Promise<CadastroResult & { replayed?: true }> {
  if (!(CUSTOMER_ARCHIVER_ROLES as readonly string[]).includes(caller.role)) {
    throw new HttpsError("permission-denied", "Só owner e admin arquivam cadastro.");
  }
  const code = input.customer_code;
  const actor = actorOf(caller);
  return runIdempotent<CadastroResult>(
    db,
    {
      kind: "commercial_customer_archive",
      scope: { customer_code: code },
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      assertNaoArquivado(cadastro, code);
      if (cadastroDoWms(cadastro.data, await temProjecao(transaction, db, cadastro.id))) {
        throw new HttpsError(
          "failed-precondition",
          "Este cadastro tem armazenagem no WMS: arquive em Configurações › Clientes.",
        );
      }
      // O código continua reservado: a unicidade compara também os arquivados.
      transaction.update(cadastro.ref, {
        status: "archived",
        archived: true,
        portal_status: "inactive",
        archived_by: caller.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.archived",
        entity_id: entityIdDoCadastro(cadastro.id),
        customer_code: code,
        payload: {},
        actor,
      });
      return {
        target_id: cadastro.id,
        result: {
          ok: true,
          customer_id: cadastro.id,
          customer_code: code,
          stage: customerStage(cadastro.data.stage),
          events: [event.id],
        },
      };
    },
  );
}

/**
 * saveCommercialCustomer: create, update e mark_client para owner, admin e
 * comercial; archive só para owner e admin.
 */
export async function saveCommercialCustomerFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
): Promise<CadastroResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(SaveCommercialCustomerInput, data);
  switch (input.action) {
    case "create":
      return criarCadastro(db, caller, input);
    case "update":
      return alterarCadastro(db, caller, input);
    case "mark_client":
      return marcarCliente(db, caller, input);
    case "archive":
      return arquivarCadastro(db, caller, input);
  }
}

// --- Locais e contatos ----------------------------------------------------------

/** Id novo, tirado da operação: a repetição da transação dá o mesmo id. */
function novoId(prefixo: string, operationId: string): string {
  return `${prefixo}_${digest({ operationId, prefixo }, 20)}`;
}

type Existente = { id: string; data: Record<string, unknown> } | null;

/**
 * Lê o registro que vai ser alterado (ou nenhum, se é novo) e confere que ele
 * é do mesmo cliente: local e contato não mudam de cliente.
 */
async function registroDoCliente(
  transaction: Transaction,
  ref: DocumentReference | null,
  code: string,
  rotulo: string,
): Promise<Existente> {
  if (!ref) return null;
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError("not-found", `${rotulo} não encontrado.`);
  const data = snapshot.data() ?? {};
  if (text(data.customer_code) !== code) {
    throw new HttpsError(
      "failed-precondition",
      `${rotulo} é de outro cliente. A mesma pessoa ou o mesmo local em outro cliente é outro cadastro.`,
    );
  }
  return { id: snapshot.id, data };
}

/** O valor informado; sem ele, o que estava; sem os dois, o padrão. */
function escolher<T>(informado: T | undefined, antes: unknown, padrao: T): T {
  if (informado !== undefined) return informado;
  return antes === undefined ? padrao : (antes as T);
}

/** Quem criou e quando: mantidos na alteração. */
function criacao(atual: Existente, uid: string): Record<string, unknown> {
  if (!atual) return { created_by: uid, created_at: FieldValue.serverTimestamp() };
  return {
    created_by: atual.data.created_by ?? uid,
    created_at: atual.data.created_at ?? FieldValue.serverTimestamp(),
  };
}

export type LocalResult = { ok: true; local_id: string; customer_code: string; novo: boolean; events: string[] };

export async function saveCustomerLocationFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
): Promise<LocalResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(SaveCustomerLocationInput, data);
  const code = input.customer_code;
  const actor = actorOf(caller);
  const locations = db.collection(CUSTOMER_LOCATIONS_COLLECTION);

  return runIdempotent<LocalResult>(
    db,
    {
      kind: "customer_location_save",
      scope: { customer_code: code, local_id: input.local_id ?? null },
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      // Leituras: o cadastro, o local (se é alteração) e os outros locais do cliente.
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      assertNaoArquivado(cadastro, code);
      const atual = await registroDoCliente(
        transaction,
        input.local_id ? locations.doc(input.local_id) : null,
        code,
        "Local",
      );
      const doCliente = await transaction.get(locations.where("customer_code", "==", code));

      const antes = atual?.data ?? {};
      const nome = input.nome;
      const sigla = escolher(input.sigla, antes.sigla, null as string | null);
      const outros = doCliente.docs.filter((row) => row.id !== atual?.id);
      const nomeCanonico = canonicalCustomerCode(nome);
      if (outros.some((row) => canonicalCustomerCode(row.get("nome")) === nomeCanonico)) {
        throw new HttpsError("already-exists", `O cliente ${code} já tem um local com o nome ${nome}.`);
      }
      if (sigla && outros.some((row) => canonicalCustomerCode(row.get("sigla")) === canonicalCustomerCode(sigla))) {
        throw new HttpsError("already-exists", `O cliente ${code} já tem um local com a sigla ${sigla}.`);
      }

      // Escritas.
      const localId = atual?.id ?? novoId("loc", operationId);
      const enderecoAntes = (antes.endereco ?? null) as Record<string, unknown> | null;
      const endereco =
        input.endereco === undefined
          ? enderecoAntes
          : input.endereco === null
            ? null
            : {
                logradouro: escolher(input.endereco.logradouro, enderecoAntes?.logradouro, null),
                numero: escolher(input.endereco.numero, enderecoAntes?.numero, null),
                complemento: escolher(input.endereco.complemento, enderecoAntes?.complemento, null),
                bairro: escolher(input.endereco.bairro, enderecoAntes?.bairro, null),
                cidade: escolher(input.endereco.cidade, enderecoAntes?.cidade, null),
                uf: escolher(input.endereco.uf, enderecoAntes?.uf, null),
                cep: escolher(input.endereco.cep, enderecoAntes?.cep, null),
              };
      transaction.set(locations.doc(localId), {
        id: localId,
        customer_code: code,
        customer_id: cadastro.id,
        nome,
        sigla,
        endereco,
        ativo: escolher(input.ativo, antes.ativo, true),
        ...criacao(atual, caller.uid),
        updated_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "customer_location.saved",
        entity_id: localId,
        customer_code: code,
        payload: { local_id: localId, novo: !atual },
        actor,
      });
      return {
        target_id: localId,
        result: { ok: true, local_id: localId, customer_code: code, novo: !atual, events: [event.id] },
      };
    },
  );
}

export type ContatoResult = { ok: true; contato_id: string; customer_code: string; novo: boolean; events: string[] };

export async function saveCustomerContactFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
): Promise<ContatoResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(SaveCustomerContactInput, data);
  const code = input.customer_code;
  const actor = actorOf(caller);
  const contacts = db.collection(CUSTOMER_CONTACTS_COLLECTION);

  return runIdempotent<ContatoResult>(
    db,
    {
      kind: "customer_contact_save",
      scope: { customer_code: code, contato_id: input.contato_id ?? null },
      idempotency_key: input.idempotency_key,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      // Leituras: o cadastro, o contato (se é alteração) e os outros contatos do cliente.
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      assertNaoArquivado(cadastro, code);
      const atual = await registroDoCliente(
        transaction,
        input.contato_id ? contacts.doc(input.contato_id) : null,
        code,
        "Contato",
      );
      const doCliente = await transaction.get(contacts.where("customer_code", "==", code));

      const antes = atual?.data ?? {};
      const emailFinal = escolher(input.email, antes.email, null as string | null);
      // Um contato por e-mail dentro do cliente. Em outro cliente, a mesma pessoa é outro contato.
      if (
        emailFinal &&
        doCliente.docs.some((row) => row.id !== atual?.id && text(row.get("email")).toLowerCase() === emailFinal)
      ) {
        throw new HttpsError("already-exists", `O cliente ${code} já tem um contato com esse e-mail.`);
      }

      // Escritas.
      const contatoId = atual?.id ?? novoId("ct", operationId);
      transaction.set(contacts.doc(contatoId), {
        id: contatoId,
        customer_code: code,
        customer_id: cadastro.id,
        nome: input.nome,
        email: emailFinal,
        telefone: escolher(input.telefone, antes.telefone, null as string | null),
        empresa: escolher(input.empresa, antes.empresa, null as string | null),
        papel: escolher(input.papel, antes.papel, "outro" as PapelContato),
        ativo: escolher(input.ativo, antes.ativo, true),
        ...criacao(atual, caller.uid),
        updated_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "customer_contact.saved",
        entity_id: contatoId,
        customer_code: code,
        payload: { contato_id: contatoId, novo: !atual },
        actor,
      });
      return {
        target_id: contatoId,
        result: { ok: true, contato_id: contatoId, customer_code: code, novo: !atual, events: [event.id] },
      };
    },
  );
}
