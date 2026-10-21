import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  MESES_PAGAMENTO,
  STATUS_CONTRATO,
  TIPOS_PAGAMENTO,
  TIPOS_REAJUSTE,
  TIPOS_RENOVACAO,
  dataValida,
  diasEntre,
  mesDiaValido,
  problemaDasFaixas,
} from "./contratos-datas.js";
import { isProspect } from "./customer-identity.js";
import { REGIMES_COBRANCA, TIPOS_ADITIVO, TIPOS_AUTORIZACAO, createComercialEvent } from "./events.js";
import { actorPayload, canonical, compactValue, runIdempotent, type ComercialActor } from "./operations.js";

/**
 * Contratos e aditivos (docs/plataforma/fase-6-comercial.md, parte 8).
 *
 * - `contracts/{id}`: o contrato de um cliente (`customer_code`), com a
 *   vigência atual, renovação, reajuste, regime de cobrança por serviço,
 *   autorização de faturamento, regra de pagamento, impostos, código de
 *   serviço e documentos (referência em texto: o Storage é fechado ao
 *   Comercial no v1). Preço não fica no contrato: a tabela
 *   (`price_tables.contract_id`) é que aponta para ele.
 * - `contracts/{id}/aditivos/{numero}`: o histórico, imutável. Aditivo de
 *   prorrogação ou de preço com vigência nova prorroga o contrato vigente na
 *   mesma transação; aditivo de preço liga as tabelas do mesmo contrato.
 *
 * Contrato é de cliente: cadastro inexistente ou prospect é recusado. Toda
 * escrita é das Functions (saveContract e recordAditivo), com recibo de
 * idempotência e evento `contract.*` sem número do cliente nem valor (e o id
 * do contrato, que vai no evento, não pode conter o número do cliente).
 */

export const CONTRACTS_COLLECTION = "contracts";
export const ADITIVOS_SUBCOLLECTION = "aditivos";
export const CUSTOMERS_COLLECTION = "customers";
export const PRICE_TABLES_COLLECTION = "price_tables";

export const TIPOS_NUMERO_CONTRATO = ["contrato", "sistema_cliente", "outro"] as const;
/** A lista mora em events.ts (vai no evento da autorização); daqui é reexportada. */
export { TIPOS_AUTORIZACAO };
export const ACOES_CONTRATO = ["criar", "atualizar"] as const;

/** Tipos de aditivo que trazem vigência nova para o contrato. */
export const ADITIVOS_COM_VIGENCIA: readonly (typeof TIPOS_ADITIVO)[number][] = ["prorrogacao", "preco"];

// --- Entrada --------------------------------------------------------------------

/** Id de documento: letras, números, hífen e sublinhado (o id automático do Firestore também cabe). */
export const ID_DOCUMENTO = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/, "Id inválido: use letras, números, hífen ou sublinhado (até 60).");
const idDocumento = ID_DOCUMENTO;
const texto = (max: number) => z.string().trim().min(1, "Campo obrigatório.").max(max, `Até ${max} caracteres.`);
const textoOpcional = (max: number) => z.string().trim().max(max, `Até ${max} caracteres.`).nullable();
const data = z.string().trim().refine(dataValida, "Data inválida (AAAA-MM-DD).");
const dias = z.number().int("Dias inteiros.").min(0).max(3650);
const diaDoMes = z.number().int("Dia inteiro.").min(1).max(31);
const idempotencyKey = z.string().trim().min(1, "Chave de idempotência obrigatória.").max(200);

const documento = z.object({ nome: texto(200), referencia: texto(500) }).strict();

const numeroDoContrato = z.object({ tipo: z.enum(TIPOS_NUMERO_CONTRATO), numero: texto(80) }).strict();

const renovacao = z
  .object({
    tipo: z.enum(TIPOS_RENOVACAO),
    aviso_dias: dias.nullable().default(null),
    oposicao_ate_dias: dias.nullable().default(null),
  })
  .strict();

const reajuste = z
  .object({
    tipo: z.enum(TIPOS_REAJUSTE),
    indice: textoOpcional(40).default(null),
    data_base: z.string().trim().refine(mesDiaValido, "Data-base inválida (MM-DD).").nullable().default(null),
  })
  .strict();

const regimeDoServico = z.object({ servico: texto(120), regime: z.enum(REGIMES_COBRANCA) }).strict();

const autorizacao = z
  .object({ tipo: z.enum(TIPOS_AUTORIZACAO), prazo_perda_dias: dias.nullable().default(null) })
  .strict();

const faixa = z.object({ de: diaDoMes, ate: diaDoMes, dia: diaDoMes, mes: z.enum(MESES_PAGAMENTO) }).strict();

const pagamento = z
  .object({
    tipo: z.enum(TIPOS_PAGAMENTO),
    faixas: z.array(faixa).max(31).default([]),
    dias: dias.nullable().default(null),
    texto: textoOpcional(1000).default(null),
  })
  .strict();

const impostos = z
  .object({ inclusos: z.boolean().nullable().default(null), texto: textoOpcional(1000).default(null) })
  .strict();

/** Os dados do contrato, sem preço: `.strict()` recusa campo a mais (valor, preço...). */
export const CONTRATO_DADOS = z
  .object({
    customer_code: texto(80),
    nome: texto(160),
    numeros: z.array(numeroDoContrato).max(20).default([]),
    objeto: z.string().trim().max(4000).default(""),
    vigente_de: data,
    /** null: prazo indeterminado. */
    vigente_ate: data.nullable(),
    renovacao,
    reajuste,
    regimes: z.array(regimeDoServico).max(30).default([]),
    regime_padrao: z.enum(REGIMES_COBRANCA),
    autorizacao,
    pagamento,
    impostos: impostos.default({ inclusos: null, texto: null }),
    /** Código de serviço da LC 116 (ex.: "1602"). */
    codigo_servico: z.string().trim().regex(/^\d{3,5}$/, "Código de serviço: 3 a 5 algarismos (ex.: 1602).").nullable().default(null),
    documentos: z.array(documento).max(50).default([]),
    status: z.enum(STATUS_CONTRATO),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (dataValida(value.vigente_de) && dataValida(value.vigente_ate) && diasEntre(value.vigente_de, value.vigente_ate) < 0) {
      issue(["vigente_ate"], "O fim da vigência vem antes do início.");
    }
    if (value.renovacao.tipo !== "automatica" && value.renovacao.oposicao_ate_dias !== null) {
      issue(["renovacao", "oposicao_ate_dias"], "Prazo de oposição só existe na renovação automática.");
    }
    if (value.reajuste.tipo === "indice") {
      if (!value.reajuste.indice) issue(["reajuste", "indice"], "Informe o índice do reajuste (ex.: IPCA).");
      if (!value.reajuste.data_base) issue(["reajuste", "data_base"], "Informe a data-base do reajuste (MM-DD).");
    } else if (value.reajuste.indice !== null || value.reajuste.data_base !== null) {
      issue(["reajuste", "tipo"], "Índice e data-base só no reajuste por índice.");
    }
    const regra = value.pagamento;
    if (regra.tipo === "faixas_do_dia_da_nf") {
      const problema = problemaDasFaixas(regra.faixas);
      if (problema) issue(["pagamento", "faixas"], problema);
    } else if (regra.faixas.length > 0) {
      issue(["pagamento", "faixas"], "Faixas só na regra por faixas do dia da NF.");
    }
    if (regra.tipo === "dias_apos_nf" && regra.dias === null) issue(["pagamento", "dias"], "Informe os dias depois da NF.");
    if (regra.tipo !== "dias_apos_nf" && regra.dias !== null) issue(["pagamento", "dias"], "Dias só na regra de dias depois da NF.");
    if (regra.tipo === "texto" && !regra.texto) issue(["pagamento", "texto"], "Descreva a regra de pagamento.");
    const servicos = value.regimes.map((item) => item.servico.toLocaleLowerCase("pt-BR"));
    const repetido = servicos.find((servico, index) => servicos.indexOf(servico) !== index);
    if (repetido) issue(["regimes"], `Serviço repetido nos regimes: ${repetido}.`);
  });

export type ContratoDados = z.output<typeof CONTRATO_DADOS>;

/** Sem separadores e sem diferenciar maiúsculas: "CT-99.887/7" vira "ct998877". */
function semSeparadores(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Número do cliente com menos caracteres que isto não é procurado no id (evita falso positivo). */
const NUMERO_MINIMO_NO_ID = 4;
/** Algarismos seguidos do número que já o identificam. Com 5, o ano (4) não conta. */
const ALGARISMOS_QUE_IDENTIFICAM = /\d{5,}/g;

/**
 * Por que este id não serve para o contrato, ou null. O id é interno (ex.:
 * `<cliente>-2026`) e vai nos eventos (`contrato_id`, `entity_id`), que nunca
 * levam o número do contrato no cliente: o id não pode conter um dos
 * `numeros`, inteiro (sem separadores e sem diferenciar maiúsculas) ou pela
 * parte numérica com 5 ou mais algarismos seguidos.
 */
export function problemaDoIdDoContrato(id: string, numeros: readonly { numero: string }[]): string | null {
  const alvo = semSeparadores(id);
  const contem = numeros.some(({ numero }) => {
    const inteiro = semSeparadores(numero);
    if (inteiro.length >= NUMERO_MINIMO_NO_ID && alvo.includes(inteiro)) return true;
    return (numero.match(ALGARISMOS_QUE_IDENTIFICAM) ?? []).some((trecho) => alvo.includes(trecho));
  });
  if (!contem) return null;
  return "O id do contrato é interno (ex.: <cliente>-2026) e não leva o número do contrato no cliente: o id vai nos eventos.";
}

export const SAVE_CONTRACT_INPUT = z
  .object({
    idempotency_key: idempotencyKey,
    acao: z.enum(ACOES_CONTRATO),
    /** Criar: opcional (sem ele, id automático). Atualizar: obrigatório. */
    contrato_id: idDocumento.optional(),
    /** Atualizar: a edição que a pessoa leu. Muda a cada alteração gravada. */
    edicao: z.number().int().min(1).optional(),
    contrato: CONTRATO_DADOS,
  })
  .strict()
  .superRefine((value, ctx) => {
    const problemaDoId = value.contrato_id ? problemaDoIdDoContrato(value.contrato_id, value.contrato.numeros) : null;
    if (problemaDoId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contrato_id"], message: problemaDoId });
    if (value.acao === "atualizar") {
      if (!value.contrato_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contrato_id"], message: "Informe o contrato." });
      if (value.edicao === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edicao"], message: "Informe a edição lida do contrato." });
      }
    } else if (value.edicao !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edicao"], message: "Contrato novo não tem edição." });
    }
  });

/** Os dados do aditivo. Vigência nova só na prorrogação (obrigatória) e no preço (opcional). */
export const ADITIVO_DADOS = z
  .object({
    numero: z.number().int("Número do aditivo inteiro.").min(0).max(999),
    assinado_em: data.nullable().default(null),
    tipo: z.enum(TIPOS_ADITIVO),
    vigente_de: data.nullable().default(null),
    vigente_ate: data.nullable().default(null),
    tabela_ids: z.array(idDocumento).max(10).default([]),
    /** Sem documento localizado, null: o aditivo entra com a marca. */
    documento: documento.nullable().default(null),
    observacao: z.string().trim().max(2000).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const temVigencia = value.vigente_de !== null || value.vigente_ate !== null;
    if (temVigencia && (value.vigente_de === null || value.vigente_ate === null)) {
      issue(["vigente_ate"], "Vigência nova precisa de início e fim.");
    } else if (dataValida(value.vigente_de) && dataValida(value.vigente_ate) && diasEntre(value.vigente_de, value.vigente_ate) < 0) {
      issue(["vigente_ate"], "O fim da vigência vem antes do início.");
    }
    if (value.tipo === "prorrogacao" && !temVigencia) issue(["vigente_ate"], "Prorrogação precisa da vigência nova.");
    if (temVigencia && !ADITIVOS_COM_VIGENCIA.includes(value.tipo)) {
      issue(["tipo"], "Só aditivo de prorrogação ou de preço muda a vigência.");
    }
    if (value.tipo === "preco" && value.tabela_ids.length === 0) issue(["tabela_ids"], "Aditivo de preço liga ao menos uma tabela.");
    if (value.tipo !== "preco" && value.tabela_ids.length > 0) issue(["tabela_ids"], "Só aditivo de preço liga tabela.");
    if (new Set(value.tabela_ids).size !== value.tabela_ids.length) issue(["tabela_ids"], "Tabela repetida.");
  });

export type AditivoDados = z.output<typeof ADITIVO_DADOS>;

export const RECORD_ADITIVO_INPUT = z
  .object({ idempotency_key: idempotencyKey, contrato_id: idDocumento, aditivo: ADITIVO_DADOS })
  .strict();

/** Entrada pelo safeParse: erro é invalid-argument, com o campo, nunca "internal". */
export function parseEntrada<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  throw new HttpsError("invalid-argument", `${where}${issue?.message ?? "Entrada inválida."}`);
}

// --- Regras puras ----------------------------------------------------------------

/** Id do aditivo no histórico, `contracts/{id}/aditivos/{numero}`: o número, sem zero à esquerda ("1", "4", "12"). */
export function aditivoDocId(numero: number): string {
  return String(numero);
}

export type Vigencia = { de: string; ate: string | null };

/**
 * Vigência do contrato depois do aditivo. O aditivo de prorrogação ou de
 * preço com vigência nova só prorroga: muda quando o fim novo passa do atual.
 * No contrato sem fim (indeterminado), muda quando o aditivo começa no início
 * do contrato ou depois, e o contrato passa a ter prazo fixo. Aditivo antigo
 * registrado depois, como na carga do histórico, entra só no histórico.
 * Contrato encerrado não passa por aqui: o aditivo dele entra só no histórico
 * (registrarAditivo).
 */
export function vigenciaComAditivo(atual: Vigencia, aditivo: Pick<AditivoDados, "tipo" | "vigente_de" | "vigente_ate">): Vigencia & { alterada: boolean } {
  const { vigente_de: de, vigente_ate: ate } = aditivo;
  if (!ADITIVOS_COM_VIGENCIA.includes(aditivo.tipo) || de === null || ate === null) return { ...atual, alterada: false };
  const prorroga = atual.ate === null ? diasEntre(atual.de, de) >= 0 : diasEntre(atual.ate, ate) > 0;
  if (!prorroga) return { ...atual, alterada: false };
  return { de, ate, alterada: true };
}

/** Por que não cabe contrato neste cadastro, ou null. Contrato é de cliente. */
export function problemaDoCadastro(customerCode: string, registros: readonly DocumentData[], criando: boolean): string | null {
  if (registros.length === 0) {
    return `Cliente ${customerCode} não encontrado no cadastro. Contrato é de cliente cadastrado.`;
  }
  if (registros.some((registro) => isProspect(registro))) {
    return `${customerCode} ainda é prospect: contrato é de cliente. O prospect vira cliente no primeiro fechamento.`;
  }
  const ativo = registros.some((registro) => registro.archived !== true && registro.status !== "archived");
  if (criando && !ativo) return `${customerCode} está arquivado no cadastro.`;
  return null;
}

const CAMPOS_DO_CONTRATO = Object.keys(CONTRATO_DADOS._def.schema.shape) as (keyof ContratoDados)[];

/** Campos do contrato que mudam de um para o outro, na ordem do formulário. */
export function camposAlterados(antes: DocumentData, depois: ContratoDados): string[] {
  return CAMPOS_DO_CONTRATO.filter(
    (campo) => JSON.stringify(canonical(antes[campo] ?? null)) !== JSON.stringify(canonical(depois[campo] ?? null)),
  );
}

// --- Gravação ----------------------------------------------------------------------

async function lerCadastro(transaction: Transaction, db: Firestore, customerCode: string): Promise<DocumentData[]> {
  // O cadastro grava `code` e `customer_code` iguais; os dois valem para um
  // cadastro antigo que só tenha um deles (como no WMS, catalog-codes.ts).
  const customers = db.collection(CUSTOMERS_COLLECTION);
  const [byCode, byCustomerCode] = await Promise.all([
    transaction.get(customers.where("code", "==", customerCode)),
    transaction.get(customers.where("customer_code", "==", customerCode)),
  ]);
  const registros = new Map<string, DocumentData>();
  for (const row of [...byCode.docs, ...byCustomerCode.docs]) registros.set(row.id, row.data());
  return [...registros.values()];
}

export type SaveContractResult = {
  ok: true;
  contrato_id: string;
  edicao: number;
  criado: boolean;
  campos: string[];
  events: string[];
};

/** Cria ou atualiza o contrato (callable saveContract). */
export async function salvarContrato(db: Firestore, actor: ComercialActor, value: unknown) {
  const input = parseEntrada(SAVE_CONTRACT_INPUT, value);
  const contrato = input.contrato;
  const criando = input.acao === "criar";
  const scope = criando ? { acao: input.acao, customer_code: contrato.customer_code } : { contrato_id: input.contrato_id };

  return runIdempotent<SaveContractResult>(
    db,
    { kind: "contract_save", scope, idempotency_key: input.idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const contracts = db.collection(CONTRACTS_COLLECTION);
      const ref = input.contrato_id ? contracts.doc(input.contrato_id) : contracts.doc();

      // Leituras antes das escritas.
      const [snapshot, cadastro] = await Promise.all([
        transaction.get(ref),
        lerCadastro(transaction, db, contrato.customer_code),
      ]);
      const atual = snapshot.data();

      if (criando && snapshot.exists) {
        throw new HttpsError("already-exists", `O contrato ${ref.id} já existe. Para mudar, atualize a edição atual.`);
      }
      if (!criando) {
        if (!snapshot.exists || !atual) throw new HttpsError("not-found", `Contrato ${ref.id} não encontrado.`);
        if (atual.customer_code !== contrato.customer_code) {
          throw new HttpsError(
            "failed-precondition",
            "O cliente do contrato não muda: cadastre outro contrato para o outro cliente.",
          );
        }
        if (Number(atual.edicao) !== input.edicao) {
          throw new HttpsError(
            "failed-precondition",
            `O contrato mudou desde que foi aberto (edição ${atual.edicao}, não ${input.edicao}). Abra de novo para não perder a mudança.`,
          );
        }
      }
      const problema = problemaDoCadastro(contrato.customer_code, cadastro, criando);
      if (problema) throw new HttpsError("failed-precondition", problema);

      const campos = criando || !atual ? [] : camposAlterados(atual, contrato);
      if (!criando && campos.length === 0) {
        // Nada mudou: só o recibo, sem escrita no contrato nem evento.
        return {
          target_id: ref.id,
          result: { ok: true, contrato_id: ref.id, edicao: Number(atual?.edicao), criado: false, campos, events: [] },
        };
      }

      const edicao = criando ? 1 : Number(atual?.edicao) + 1;
      const quem = actorPayload(actor);
      const dados = compactValue(contrato) as Record<string, unknown>;
      if (criando) {
        transaction.create(ref, {
          ...dados,
          id: ref.id,
          edicao,
          created_at: FieldValue.serverTimestamp(),
          created_by: quem,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: quem,
        });
      } else {
        transaction.update(ref, { ...dados, edicao, updated_at: FieldValue.serverTimestamp(), updated_by: quem });
      }

      const event = criando
        ? createComercialEvent(transaction, db, {
            operation_id: operationId,
            type: "contract.created",
            entity_id: ref.id,
            customer_code: contrato.customer_code,
            payload: {
              contrato_id: ref.id,
              regime: contrato.regime_padrao,
              vigente_de: contrato.vigente_de,
              vigente_ate: contrato.vigente_ate,
            },
            actor,
          })
        : createComercialEvent(transaction, db, {
            operation_id: operationId,
            type: "contract.updated",
            entity_id: ref.id,
            customer_code: contrato.customer_code,
            payload: { contrato_id: ref.id, campos, edicao, status: contrato.status },
            actor,
          });

      return {
        target_id: ref.id,
        result: { ok: true, contrato_id: ref.id, edicao, criado: criando, campos, events: [event.id] },
      };
    },
  );
}

export type RecordAditivoResult = {
  ok: true;
  contrato_id: string;
  aditivo_id: string;
  edicao: number;
  vigencia_alterada: boolean;
  vigente_de: string;
  vigente_ate: string | null;
  events: string[];
};

/** Registra o aditivo no histórico do contrato (callable recordAditivo). */
export async function registrarAditivo(db: Firestore, actor: ComercialActor, value: unknown) {
  const input = parseEntrada(RECORD_ADITIVO_INPUT, value);
  const aditivo = input.aditivo;
  const aditivoId = aditivoDocId(aditivo.numero);

  return runIdempotent<RecordAditivoResult>(
    db,
    {
      kind: "contract_amendment",
      scope: { contrato_id: input.contrato_id, aditivo_id: aditivoId },
      idempotency_key: input.idempotency_key,
      input,
      actor,
    },
    async (transaction, { operationId }) => {
      const contratoRef = db.collection(CONTRACTS_COLLECTION).doc(input.contrato_id);
      const aditivoRef = contratoRef.collection(ADITIVOS_SUBCOLLECTION).doc(aditivoId);
      const tabelaRefs = aditivo.tabela_ids.map((id) => db.collection(PRICE_TABLES_COLLECTION).doc(id));

      // Leituras antes das escritas.
      const [contratoSnap, aditivoSnap, ...tabelas] = await Promise.all([
        transaction.get(contratoRef),
        transaction.get(aditivoRef),
        ...tabelaRefs.map((ref) => transaction.get(ref)),
      ]);
      const contrato = contratoSnap.data();
      if (!contratoSnap.exists || !contrato) throw new HttpsError("not-found", `Contrato ${input.contrato_id} não encontrado.`);
      if (aditivoSnap.exists) {
        throw new HttpsError(
          "already-exists",
          `O aditivo ${aditivoId} já está no histórico do contrato. Aditivo registrado não se altera.`,
        );
      }
      const customerCode = String(contrato.customer_code ?? "");
      for (const tabela of tabelas) {
        const dados = tabela.data();
        if (!tabela.exists || !dados) {
          throw new HttpsError("failed-precondition", `Tabela ${tabela.id} não encontrada. Carregue a tabela antes do aditivo.`);
        }
        if (dados.customer_code !== customerCode || dados.contract_id !== input.contrato_id) {
          throw new HttpsError(
            "failed-precondition",
            `A tabela ${tabela.id} não é deste contrato. O aditivo de preço liga só tabelas do mesmo cliente e contrato.`,
          );
        }
      }

      const anterior: { de: string; ate: string | null } = {
        de: String(contrato.vigente_de),
        ate: contrato.vigente_ate == null ? null : String(contrato.vigente_ate),
      };
      // Contrato encerrado não é prorrogado: o aditivo entra só no histórico.
      // Para prorrogar, reabra o contrato (saveContract, status vigente) antes.
      const encerrado = contrato.status === "encerrado";
      const vigencia = encerrado ? { ...anterior, alterada: false } : vigenciaComAditivo(anterior, aditivo);
      const edicaoAtual = Number(contrato.edicao);
      const edicao = vigencia.alterada ? edicaoAtual + 1 : edicaoAtual;
      const quem = actorPayload(actor);

      transaction.create(aditivoRef, {
        ...(compactValue(aditivo) as Record<string, unknown>),
        id: aditivoId,
        contrato_id: input.contrato_id,
        customer_code: customerCode,
        documento_localizado: aditivo.documento !== null,
        vigencia_alterada: vigencia.alterada,
        vigencia_anterior: vigencia.alterada ? anterior : null,
        registrado_em: FieldValue.serverTimestamp(),
        registrado_por: quem,
      });
      if (vigencia.alterada) {
        transaction.update(contratoRef, {
          vigente_de: vigencia.de,
          vigente_ate: vigencia.ate,
          edicao,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: quem,
        });
      }

      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "contract.amendment_added",
        entity_id: input.contrato_id,
        customer_code: customerCode,
        payload: {
          contrato_id: input.contrato_id,
          aditivo_id: aditivoId,
          tipo: aditivo.tipo,
          vigencia_alterada: vigencia.alterada,
          vigente_ate: vigencia.alterada && vigencia.ate !== null ? vigencia.ate : undefined,
          tabelas: aditivo.tabela_ids.length,
          documento_localizado: aditivo.documento !== null,
        },
        actor,
      });

      return {
        target_id: input.contrato_id,
        result: {
          ok: true,
          contrato_id: input.contrato_id,
          aditivo_id: aditivoId,
          edicao,
          vigencia_alterada: vigencia.alterada,
          vigente_de: vigencia.de,
          vigente_ate: vigencia.ate,
          events: [event.id],
        },
      };
    },
  );
}
