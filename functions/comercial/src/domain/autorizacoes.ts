import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  CLIENT_AUTHORIZATIONS_COLLECTION,
  MARCAS_AUTORIZACAO,
  TIPOS_AUTORIZACAO_CLIENTE,
  chaveDoNumeroDoCliente,
  completarTomador,
  documentoDaAutorizacao,
  lerTomador,
  marcasDaAutorizacao,
  numerosDaAutorizacao,
  problemaDaDemandaParaAutorizar,
  problemaDoTipoDaAutorizacao,
  saldoDaAutorizacao,
  statusDaAutorizacao,
  valorDaAutorizacao,
  type DemandaCitada,
  type MarcaAutorizacao,
  type OutraAutorizacao,
  type StatusAutorizacao,
  type TipoAutorizacaoCliente,
  type TomadorDaEntrada,
} from "./autorizacao.js";
import { cadastroPeloCodigo, idDeDocumentoValido, parseEntrada } from "./cadastro.js";
import { CONTRACTS_COLLECTION } from "./contratos.js";
import {
  autorizacoesDaDemanda,
  dataDeHoje,
  emissaoNfDaDemanda,
  etapaDaDemanda,
  rotuloDaEtapa,
  rotuloDoOrcamento,
  segundosDesde,
  validacaoDaDemanda,
  type EtapaDemanda,
} from "./demanda.js";
import { centavosDaLinha, somarCentavos } from "./dinheiro.js";
import { createComercialEvent } from "./events.js";
import { MEDICOES_COLLECTION } from "./medicao.js";
import { digest, runIdempotent, type ComercialActor } from "./operations.js";
import { comercialAccessProblem } from "./platform-roles.js";
import type { ComercialProfile } from "./profile.js";
import {
  actorOf,
  conteudo,
  dataDaEntrada,
  demandRef,
  linkDaEntrada,
  marcosComEtapa,
  quoteRef,
  revisaoRef,
  texto,
  textoOuNull,
  type Dados,
  type QuoteOptions,
} from "./quotes.js";

/**
 * A callable recordAuthorization (docs/plataforma/fase-6-comercial.md,
 * "Autorização de faturamento"; parte 15): registrar e cancelar o "pode
 * faturar" do cliente em `client_authorizations`.
 *
 * - record: a autorização (pedido e aceite, portal ou outro) de uma ou
 *   várias demandas do mesmo cliente, que esperam a autorização ou, no
 *   complemento, já estão a faturar por outra. O tipo é o que o contrato
 *   pedia na validação; a medição aprovada vem da medição mensal. Cada
 *   demanda cita a RV que o cliente autorizou (a validada, se não vier); o
 *   valor de cada uma é o total da RV como foi enviada, lido pelo servidor.
 *   O tomador mascarado do e-mail se completa com a raiz do cadastro. As
 *   demandas vão a "a faturar", com o id em `autorizacao_ids`.
 * - cancel: a autorização registrada por engano. As demandas sem outra
 *   autorização voltam a "aguardando autorização"; a que já foi usada no
 *   faturamento (NF, portal ou Omie, Fase 7) não se cancela.
 *
 * Quem chama: owner, admin, comercial e o financeiro (pergunta 4: registra,
 * sem editar itens nem preço). O financeiro entra só aqui: a callable pede
 * `{ financeiro: true }` e as outras continuam negando.
 *
 * Como as outras: safeParse, o estado conferido na transação, leituras antes
 * das escritas, recibo e evento na mesma transação, e evento sem valor, sem o
 * pedido, o aceite, o tomador nem o centro de custo.
 */

// --- Entrada -------------------------------------------------------------------------

const requestId = z.string().trim().min(1, "Informe o request_id.").max(200, "request_id longo demais.");
const numeroServico = z.string().trim().regex(/^\d{5,8}$/, "Número da demanda inválido.");
const codigoCliente = z.string().trim().min(1, "Informe o cliente.").max(200);
const idAutorizacao = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,120}$/, "Autorização inválida.")
  .refine(idDeDocumentoValido, "Autorização inválida.");
/** Texto opcional: vazio vira null. */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((value) => value || null);
/** Pedido e aceite como o cliente escreve: letras, números, espaço, ponto, barra, hífen e sublinhado. */
const numeroDoCliente = (rotulo: string) =>
  textoOpcional(60).refine(
    (value) => value === null || /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,59}$/.test(value),
    `${rotulo}: letras, números, espaço, ponto, barra e hífen.`,
  );
/** Valor da autorização em reais, texto decimal com ponto e até 2 casas (o app converte a vírgula). */
const valor = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,2})?$/, "Valor: decimal com ponto e até 2 casas (ex.: 20748.80).");

const DemandaDaAutorizacao = z
  .object({
    numero: numeroServico,
    /** A RV que o cliente cita; sem ela, a validada. */
    rv: z.number().int().min(0).max(99).optional(),
  })
  .strict();

const Registrar = z
  .object({
    action: z.literal("record"),
    request_id: requestId,
    customer_code: codigoCliente,
    tipo: z.enum(TIPOS_AUTORIZACAO_CLIENTE),
    pedido: numeroDoCliente("Pedido"),
    aceite: numeroDoCliente("Aceite"),
    recebida_em: dataDaEntrada,
    valor,
    demandas: z.array(DemandaDaAutorizacao).min(1, "Escolha ao menos uma demanda.").max(50, "Até 50 demandas por autorização."),
    /** CNPJ do tomador, inteiro (pode ser de filial) ou com a raiz mascarada como no e-mail do cliente. */
    tomador_documento: z.string().trim().max(30).nullable().optional(),
    codigo_servico: z
      .string()
      .trim()
      .regex(/^\d{3,5}$/, "Código de serviço: 3 a 5 algarismos (ex.: 1602).")
      .nullable()
      .optional(),
    centro_custo: textoOpcional(60),
    ref_cliente: textoOpcional(80),
    escopo: textoOpcional(300),
    email_link: linkDaEntrada,
    documento: z
      .object({
        nome: z.string().trim().min(1, "Informe o nome do documento.").max(200),
        referencia: z.string().trim().min(1, "Informe onde está o documento.").max(500),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (value.tipo === "pedido_aceite") {
      if (!value.pedido) issue("pedido", "Autorização por pedido e aceite: informe o pedido.");
      if (!value.aceite) issue("aceite", "Autorização por pedido e aceite: informe o aceite.");
    }
    if (value.tipo === "portal" && !value.pedido) issue("pedido", "Autorização pelo portal: informe o pedido do portal.");
    if (value.tipo === "medicao_aprovada") issue("tipo", "A medição aprovada se registra na medição mensal, não aqui.");
    if (!value.pedido && !value.email_link && !value.documento) {
      issue("documento", "Registre a prova da autorização: o pedido, o link do e-mail ou o documento.");
    }
    const numeros = value.demandas.map((demanda) => demanda.numero);
    const repetida = numeros.find((numero, indice) => numeros.indexOf(numero) !== indice);
    if (repetida) issue("demandas", `A demanda ${repetida} aparece duas vezes.`);
  });

const Cancelar = z
  .object({
    action: z.literal("cancel"),
    request_id: requestId,
    autorizacao_id: idAutorizacao,
    motivo: z.string().trim().min(3, "Diga por que a autorização é cancelada.").max(500, "Use até 500 caracteres no motivo."),
  })
  .strict();

export type RecordAuthorizationInput = z.infer<typeof Registrar> | z.infer<typeof Cancelar>;

/** A entrada pela ação: cada uma com o seu schema e a sua mensagem (o registro tem regras entre campos). */
export function lerEntradaDaAutorizacao(data: unknown): RecordAuthorizationInput {
  const action = data && typeof data === "object" ? (data as { action?: unknown }).action : undefined;
  if (action === "record") return parseEntrada(Registrar, data);
  if (action === "cancel") return parseEntrada(Cancelar, data);
  throw new HttpsError("invalid-argument", "Ação inválida: use record ou cancel.");
}

export type DemandaAutorizada = { numero: string; rv: number; rotulo: string; valor_cents: number; etapa: EtapaDemanda };

export type RecordAuthorizationResult = {
  ok: true;
  autorizacao_id: string;
  status: StatusAutorizacao;
  customer_code: string;
  valor_cents: number;
  /** Soma dos totais das RVs citadas. */
  soma_cents: number;
  /** O que faltava autorizar nas demandas (a soma menos as outras autorizações ativas delas), ou null. */
  saldo_cents: number | null;
  marcas: MarcaAutorizacao[];
  demandas: DemandaAutorizada[];
  /** A ação já estava feita (cancelar a cancelada): só devolve o estado. */
  ja_feito: boolean;
  events: string[];
};

// --- Apoio -----------------------------------------------------------------------------

/** Defesa em profundidade (os testes chamam o domínio direto): o Comercial e o financeiro. */
export function assertAuthorizationCaller(caller: ComercialProfile): void {
  const problem = comercialAccessProblem(caller.role, { financeiro: true });
  if (problem) throw new HttpsError("permission-denied", problem);
}

function autorizacaoRef(db: Firestore, id: string): DocumentReference {
  return db.collection(CLIENT_AUTHORIZATIONS_COLLECTION).doc(id);
}

/** Id interno da autorização, da operação: nunca o número do pedido ou do aceite (vai nos eventos). */
function idDaAutorizacao(operationId: string): string {
  return `aut_${digest({ operationId, colecao: CLIENT_AUTHORIZATIONS_COLLECTION }, 20)}`;
}

type TomadorLido = Exclude<TomadorDaEntrada, { tipo: "invalido" }>;

/** O tomador da entrada (inteiro ou mascarado), ou null quando não veio. Inválido é invalid-argument. */
function tomadorDaEntrada(valor: string | null | undefined): TomadorLido | null {
  const tomador = lerTomador(valor);
  if (tomador?.tipo === "invalido") {
    throw new HttpsError(
      "invalid-argument",
      "CNPJ do tomador inválido: confira os 14 caracteres e os dígitos verificadores (a raiz mascarada, como 11.222.XXX/0001-81, vale).",
    );
  }
  return tomador;
}

/** O CNPJ do tomador sem máscara (14 caracteres): o mascarado se completa com a raiz do cadastro. */
function cnpjDoTomador(tomador: TomadorLido | null, documentoDoCadastro: unknown): string | null {
  if (!tomador) return null;
  if (tomador.tipo === "inteiro") return tomador.cnpj;
  const completo = completarTomador(tomador.mascara, documentoDoCadastro);
  if ("problema" in completo) throw new HttpsError("invalid-argument", completo.problema);
  return completo.cnpj;
}

/** Centavos do valor informado ("20748.80" → 2074880), sem float. */
function centavosDoValor(valorEmReais: string): number {
  const centavos = centavosDaLinha("1", valorEmReais);
  if (centavos <= 0) throw new HttpsError("invalid-argument", "O valor da autorização precisa ser maior que zero.");
  return centavos;
}

function centavosGravados(valor: unknown, onde: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new HttpsError("failed-precondition", `${onde} está sem total válido.`);
  }
  return valor;
}

type DemandaLida = { numero: string; ref: DocumentReference; demanda: Dados; quote: Dados };

type Mudanca = {
  transaction: Transaction;
  db: Firestore;
  operationId: string;
  actor: ComercialActor;
  caller: ComercialProfile;
  instante: Date;
  iso: string;
};

/**
 * Grava a demanda com as autorizações novas e, se a etapa muda, o marco, a
 * etapa_desde e o evento demand.stage_changed (sufixo com o número: várias
 * demandas na mesma operação).
 */
function gravarAutorizacoesDaDemanda(
  mudanca: Mudanca,
  lida: DemandaLida,
  autorizacaoIds: string[],
  events: string[],
  extra: Record<string, unknown> = {},
): EtapaDemanda {
  const { transaction, db, operationId, actor, caller, iso, instante } = mudanca;
  const { numero, demanda, quote } = lida;
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const etapaDepois = etapaDaDemanda(
    { ...demanda, autorizacao_ids: autorizacaoIds },
    { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv: Number(quote.rv ?? 0) },
  );
  const patch: Record<string, unknown> = {
    autorizacao_ids: autorizacaoIds,
    ...extra,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: caller.uid,
  };
  // O id único da medição aprovada, do formato antigo, já está em autorizacao_ids pela leitura.
  if ("autorizacao_id" in demanda) patch.autorizacao_id = FieldValue.delete();
  if (etapaDepois !== etapaAntes) {
    patch.etapa = etapaDepois;
    patch.etapa_desde = iso;
    patch.marcos = marcosComEtapa(demanda, etapaDepois, { em: iso, por_uid: caller.uid });
    events.push(
      createComercialEvent(transaction, db, {
        operation_id: operationId,
        suffix: `demand.stage_changed:${numero}`,
        type: "demand.stage_changed",
        entity_id: numero,
        customer_code: texto(demanda.customer_code),
        actor,
        occurred_at: iso,
        payload: {
          numero,
          etapa_antes: etapaAntes,
          etapa_depois: etapaDepois,
          segundos_desde_anterior: segundosDesde(demanda.etapa_desde, instante),
        },
      }).id,
    );
  }
  transaction.update(lida.ref, patch);
  return etapaDepois;
}

/** As outras autorizações ativas das demandas (o complemento), cada uma uma vez. */
async function outrasAutorizacoes(transaction: Transaction, db: Firestore, lidas: readonly DemandaLida[]): Promise<OutraAutorizacao[]> {
  const ids = [...new Set(lidas.flatMap((lida) => autorizacoesDaDemanda(lida.demanda)))];
  if (!ids.length) return [];
  const snaps = await transaction.getAll(...ids.map((id) => autorizacaoRef(db, id)));
  return snaps
    .filter((snap) => snap.exists && statusDaAutorizacao(snap.data() ?? {}) === "registrada")
    .map((snap) => {
      const dados = snap.data() ?? {};
      const valor = valorDaAutorizacao(dados);
      if (valor === null) throw new HttpsError("failed-precondition", `A autorização ${snap.id} está sem valor válido.`);
      return { valor_cents: valor, demanda_numeros: numerosDaAutorizacao(dados) };
    });
}

async function lerDemandas(transaction: Transaction, db: Firestore, numeros: readonly string[]): Promise<DemandaLida[]> {
  if (!numeros.length) throw new HttpsError("failed-precondition", "A autorização não tem demandas.");
  const snaps = await transaction.getAll(...numeros.flatMap((numero) => [demandRef(db, numero), quoteRef(db, numero)]));
  return numeros.map((numero, indice) => {
    const [demandaSnap, quoteSnap] = [snaps[indice * 2], snaps[indice * 2 + 1]];
    if (!demandaSnap.exists || !quoteSnap.exists) throw new HttpsError("not-found", `Demanda ${numero} não encontrada.`);
    return { numero, ref: demandaSnap.ref, demanda: demandaSnap.data() ?? {}, quote: quoteSnap.data() ?? {} };
  });
}

/** As marcas gravadas na autorização, só as da lista e na ordem dela. */
function marcasGravadas(valor: unknown): MarcaAutorizacao[] {
  return Array.isArray(valor) ? MARCAS_AUTORIZACAO.filter((marca) => valor.includes(marca)) : [];
}

function demandasGravadas(valor: unknown): Array<{ numero: string; rv: number; rotulo: string; valor_cents: number }> {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((item): item is Dados => Boolean(item) && typeof item === "object")
    .map((item) => ({
      numero: texto(item.numero),
      rv: Number(item.rv ?? 0),
      rotulo: texto(item.rotulo),
      valor_cents: Number(item.valor_cents ?? 0),
    }));
}

// --- Ações -----------------------------------------------------------------------------

type Registro = z.infer<typeof Registrar>;
type Cancelamento = z.infer<typeof Cancelar>;
type Trabalho = { target_id: string; result: RecordAuthorizationResult };

async function registrar(mudanca: Mudanca, input: Registro, entrada: { valor_cents: number; tomador: TomadorLido | null }): Promise<Trabalho> {
  const { transaction, db, operationId, actor, caller, iso } = mudanca;
  const code = input.customer_code;
  const numeros = input.demandas.map((demanda) => demanda.numero);

  // Leituras: as demandas e os orçamentos, as RVs citadas, o cadastro, o contrato, a autorização
  // repetida e as outras autorizações ativas das demandas.
  const lidas = await lerDemandas(transaction, db, numeros);
  const citadas = lidas.map((lida, indice) => {
    const problema =
      problemaDaDemandaParaAutorizar(lida.numero, { ...lida.demanda, etapa: lida.demanda.etapa as EtapaDemanda }, code) ??
      problemaDoTipoDaAutorizacao(input.tipo, lida.numero, lida.demanda);
    if (problema) throw new HttpsError("failed-precondition", problema);
    // Reservada pela emissão, a demanda não muda no Comercial (demanda.ts): a fatura nasce das autorizações dela.
    if (emissaoNfDaDemanda(lida.demanda)) {
      throw new HttpsError("failed-precondition", `A demanda ${lida.numero} está na emissão da NFS-e pela Omie: a autorização dela espera a emissão terminar.`);
    }
    const validada = validacaoDaDemanda(lida.demanda)?.rv ?? null;
    const rv = input.demandas[indice].rv ?? validada;
    if (rv === null) throw new HttpsError("failed-precondition", `A demanda ${lida.numero} não tem RV validada: informe a RV que o cliente autorizou.`);
    return { lida, rv, rv_validada: validada };
  });
  const revisoes = await transaction.getAll(...citadas.map(({ lida, rv }) => revisaoRef(db, lida.numero, rv)));
  const demandas: Array<DemandaCitada & { numero: string; rotulo: string }> = citadas.map(({ lida, rv, rv_validada }, indice) => {
    const revisao = revisoes[indice];
    const rotulo = rotuloDoOrcamento(lida.numero, rv);
    if (!revisao.exists || !revisao.get("enviado_em")) {
      throw new HttpsError("failed-precondition", `A ${rotulo} não foi enviada ao cliente: a autorização cita uma RV enviada.`);
    }
    return { numero: lida.numero, rotulo, rv, rv_validada, valor_cents: centavosGravados(revisao.get("total_cents"), `A ${rotulo}`) };
  });
  const contratos = [...new Set(lidas.map((lida) => textoOuNull(lida.demanda.contrato_id)))];
  if (contratos.length > 1) {
    throw new HttpsError("failed-precondition", "As demandas são de contratos diferentes: registre uma autorização por contrato.");
  }
  const contratoId = contratos[0] ?? null;
  const cadastro = await cadastroPeloCodigo(transaction, db, code);
  const tomador = cnpjDoTomador(entrada.tomador, cadastro.data.document);
  let codigoServicoDoContrato: string | null = null;
  if (contratoId) {
    const contrato = await transaction.get(db.collection(CONTRACTS_COLLECTION).doc(contratoId));
    if (!contrato.exists) throw new HttpsError("failed-precondition", `O contrato ${contratoId} das demandas não existe mais.`);
    codigoServicoDoContrato = textoOuNull(contrato.get("codigo_servico"));
  }
  const chave = input.pedido && input.aceite ? `${chaveDoNumeroDoCliente(input.pedido)}|${chaveDoNumeroDoCliente(input.aceite)}` : null;
  if (chave) {
    const repetidas = await transaction.get(
      db.collection(CLIENT_AUTHORIZATIONS_COLLECTION).where("customer_code", "==", code).where("chave_pedido_aceite", "==", chave),
    );
    const ativa = repetidas.docs.find((row) => row.get("status") === "registrada");
    if (ativa) {
      throw new HttpsError("already-exists", `Este pedido e aceite já estão registrados para o cliente (autorização ${ativa.id}).`);
    }
  }
  const outras = await outrasAutorizacoes(transaction, db, lidas);

  // Escritas.
  const id = idDaAutorizacao(operationId);
  const somaCents = somarCentavos(demandas.map((demanda) => demanda.valor_cents));
  const saldoCents = saldoDaAutorizacao(numeros, somaCents, outras);
  const marcas = marcasDaAutorizacao({
    valor_cents: entrada.valor_cents,
    demandas,
    saldo_cents: saldoCents,
    tomador_documento: tomador,
    documento_do_cadastro: cadastro.data.document,
  });
  const tipo: TipoAutorizacaoCliente = input.tipo;
  // O mesmo documento da medição aprovada (documentoDaAutorizacao): um formato só.
  transaction.create(autorizacaoRef(db, id), {
    ...documentoDaAutorizacao({
      id,
      customer_code: code,
      contrato_id: contratoId,
      tipo,
      origem: "manual",
      pedido: input.pedido,
      aceite: input.aceite,
      chave_pedido_aceite: chave,
      recebida_em: input.recebida_em,
      valor_cents: entrada.valor_cents,
      soma_cents: somaCents,
      saldo_cents: saldoCents,
      demandas: demandas.map(({ numero, rv, rotulo, valor_cents }) => ({ numero, rv, rotulo, valor_cents })),
      demanda_numeros: numeros,
      tomador_documento: tomador,
      codigo_servico: input.codigo_servico ?? codigoServicoDoContrato,
      centro_custo: input.centro_custo,
      ref_cliente: input.ref_cliente,
      escopo: input.escopo,
      email_link: input.email_link ?? null,
      documento: input.documento ?? null,
      marcas,
      registrada_por: caller.uid,
      registrada_por_papel: caller.role,
      registrada_em: iso,
      operation_id: operationId,
    }),
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  const events: string[] = [];
  const etapas = lidas.map((lida) => gravarAutorizacoesDaDemanda(mudanca, lida, [...autorizacoesDaDemanda(lida.demanda), id], events));
  const aFaturar = lidas.filter((lida, indice) => lida.demanda.etapa !== etapas[indice]).map((lida) => lida.numero);
  events.unshift(
    createComercialEvent(transaction, db, {
      operation_id: operationId,
      type: "client_authorization.recorded",
      entity_id: id,
      customer_code: code,
      actor,
      occurred_at: iso,
      payload: { autorizacao_id: id, tipo, contrato_id: contratoId, demandas: numeros, a_faturar: aFaturar, marcas },
    }).id,
  );
  return {
    target_id: id,
    result: {
      ok: true,
      autorizacao_id: id,
      status: "registrada",
      customer_code: code,
      valor_cents: entrada.valor_cents,
      soma_cents: somaCents,
      saldo_cents: saldoCents,
      marcas,
      demandas: demandas.map(({ numero, rv, rotulo, valor_cents }, indice) => ({ numero, rv, rotulo, valor_cents, etapa: etapas[indice] })),
      ja_feito: false,
      events,
    },
  };
}

async function cancelar(mudanca: Mudanca, input: Cancelamento): Promise<Trabalho> {
  const { transaction, db, operationId, actor, caller, iso } = mudanca;
  const id = input.autorizacao_id;

  // Leituras: a autorização, as demandas e os orçamentos.
  const snapshot = await transaction.get(autorizacaoRef(db, id));
  if (!snapshot.exists) throw new HttpsError("not-found", `Autorização ${id} não encontrada.`);
  const autorizacao = snapshot.data() ?? {};
  // Os números vêm de demanda_numeros (ou, no formato antigo da medição, de demandas); o valor, a RV e o
  // rótulo de cada um, de `demandas` quando a autorização cita a RV (a medição aprovada não cita).
  const gravadas = demandasGravadas(autorizacao.demandas);
  const citadas = numerosDaAutorizacao(autorizacao).map(
    (numero) => gravadas.find((gravada) => gravada.numero === numero) ?? { numero, rv: 0, rotulo: numero, valor_cents: 0 },
  );
  const status = statusDaAutorizacao(autorizacao);
  const daMedicao = autorizacao.tipo === "medicao_aprovada";
  const resultado = (status: StatusAutorizacao, etapas: readonly EtapaDemanda[], events: string[], jaFeito: boolean): Trabalho => ({
    target_id: id,
    result: {
      ok: true,
      autorizacao_id: id,
      status,
      customer_code: texto(autorizacao.customer_code),
      valor_cents: valorDaAutorizacao(autorizacao) ?? 0,
      soma_cents: Number(autorizacao.soma_cents ?? 0),
      saldo_cents: typeof autorizacao.saldo_cents === "number" ? autorizacao.saldo_cents : null,
      marcas: marcasGravadas(autorizacao.marcas),
      demandas: citadas.map((citada, indice) => ({ ...citada, etapa: etapas[indice] })),
      ja_feito: jaFeito,
      events,
    },
  });
  // A medição aprovada sem demanda também se cancela: não há demanda a devolver.
  const lidas = citadas.length
    ? await lerDemandas(
        transaction,
        db,
        citadas.map((citada) => citada.numero),
      )
    : [];
  // A medição faturada como um item próprio (pergunta 64): a emissão pela Omie reserva a própria medição.
  const medicaoId = daMedicao ? textoOuNull(autorizacao.medicao_id) : null;
  const medicao = medicaoId ? ((await transaction.get(db.collection(MEDICOES_COLLECTION).doc(medicaoId))).data() ?? null) : null;
  if (status === "cancelada") {
    return resultado("cancelada", lidas.map((lida) => lida.demanda.etapa as EtapaDemanda), [], true);
  }
  if (status !== "registrada") throw new HttpsError("failed-precondition", `A autorização ${id} não está registrada.`);
  const usada =
    (Array.isArray(autorizacao.nf_ids) && autorizacao.nf_ids.length > 0) || Boolean(autorizacao.enviada_portal_em) || Boolean(autorizacao.omie_lancada_em);
  if (usada) {
    throw new HttpsError("failed-precondition", "Esta autorização já foi usada no faturamento (NF, portal ou Omie): não se cancela.");
  }
  if (medicao && emissaoNfDaDemanda(medicao)) {
    throw new HttpsError("failed-precondition", "A medição está na emissão da NFS-e pela Omie: a autorização dela não se cancela.");
  }
  for (const lida of lidas) {
    const etapa = lida.demanda.etapa as EtapaDemanda;
    if (etapa !== "a_faturar" && etapa !== "aguardando_autorizacao") {
      throw new HttpsError("failed-precondition", `A demanda ${lida.numero} está ${rotuloDaEtapa(etapa)}: a autorização dela não se cancela.`);
    }
    if (emissaoNfDaDemanda(lida.demanda)) {
      throw new HttpsError("failed-precondition", `A demanda ${lida.numero} está na emissão da NFS-e pela Omie: a autorização dela não se cancela.`);
    }
  }

  // Escritas.
  const events: string[] = [];
  // Só a demanda que fica sem nenhuma outra autorização volta a esperar a medição.
  const semOutra = lidas.map((lida) => autorizacoesDaDemanda(lida.demanda).filter((outra) => outra !== id).length === 0);
  const etapas = lidas.map((lida, indice) =>
    gravarAutorizacoesDaDemanda(
      mudanca,
      lida,
      autorizacoesDaDemanda(lida.demanda).filter((outra) => outra !== id),
      events,
      daMedicao && semOutra[indice] ? { medicao_pendente: true } : {},
    ),
  );
  const devolvidas = lidas.filter((lida, indice) => (daMedicao && semOutra[indice]) || lida.demanda.etapa !== etapas[indice]).map((lida) => lida.numero);
  transaction.update(snapshot.ref, {
    status: "cancelada" satisfies StatusAutorizacao,
    cancelada_por: caller.uid,
    cancelada_em: iso,
    motivo_cancelamento: input.motivo,
    updated_at: FieldValue.serverTimestamp(),
  });
  events.unshift(
    createComercialEvent(transaction, db, {
      operation_id: operationId,
      type: "client_authorization.cancelled",
      entity_id: id,
      customer_code: texto(autorizacao.customer_code),
      actor,
      occurred_at: iso,
      payload: {
        autorizacao_id: id,
        tipo: autorizacao.tipo as TipoAutorizacaoCliente,
        contrato_id: textoOuNull(autorizacao.contrato_id),
        demandas: citadas.map((citada) => citada.numero),
        devolvidas,
        marcas: marcasGravadas(autorizacao.marcas),
        ...(daMedicao && textoOuNull(autorizacao.medicao_id) ? { medicao_id: textoOuNull(autorizacao.medicao_id) as string } : {}),
      },
    }).id,
  );
  return resultado("cancelada", etapas, events, false);
}

// --- Callable ----------------------------------------------------------------------------

/**
 * Callable recordAuthorization: registrar (record) e cancelar (cancel) a
 * autorização de faturamento do cliente.
 */
export async function recordAuthorizationFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<RecordAuthorizationResult & { replayed?: true }> {
  assertAuthorizationCaller(caller);
  const input = lerEntradaDaAutorizacao(data);
  const agora = opcoes.agora ?? (() => new Date());
  const actor = actorOf(caller);

  if (input.action === "cancel") {
    return runIdempotent<RecordAuthorizationResult>(
      db,
      { kind: "authorization_cancel", scope: { autorizacao_id: input.autorizacao_id }, idempotency_key: input.request_id, input: conteudo(input), actor },
      async (transaction, { operationId }) => {
        const instante = agora();
        return cancelar({ transaction, db, operationId, actor, caller, instante, iso: instante.toISOString() }, input);
      },
    );
  }

  // Fora da transação: o que só depende da entrada.
  if (input.recebida_em > dataDeHoje(agora())) {
    throw new HttpsError("invalid-argument", "Recebida em não pode ser depois de hoje.");
  }
  const entrada = { valor_cents: centavosDoValor(input.valor), tomador: tomadorDaEntrada(input.tomador_documento) };
  return runIdempotent<RecordAuthorizationResult>(
    db,
    { kind: "authorization_record", scope: { customer_code: input.customer_code }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      return registrar({ transaction, db, operationId, actor, caller, instante, iso: instante.toISOString() }, input, entrada);
    },
  );
}
