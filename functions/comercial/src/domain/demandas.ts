import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { cadastroPeloCodigo, idDeDocumentoValido, parseEntrada, type CadastroEncontrado } from "./cadastro.js";
import { CONTRACTS_COLLECTION } from "./contratos.js";
import { customerStage, entityIdDoCadastro } from "./customer-identity.js";
import {
  ETAPAS_DEMANDA,
  MOTIVOS_PERDA,
  destinoDaValidacao,
  demandaExecutada,
  escopoDasLinhas,
  etapaDaDemanda,
  problemaDaPerda,
  problemaDaRecusaDoAditivo,
  problemaDoRegistroDaExecucao,
  problemaDaValidacao,
  reaberturaAbreRv,
  rotuloDaEtapa,
  rotuloDoOrcamento,
  rvFechada,
  segundosDesde,
  validacaoDaDemanda,
  type EtapaDemanda,
  type MotivoPerda,
  type OrigemDoEscopo,
  type StatusOrcamento,
  type TipoRv,
} from "./demanda.js";
import { createComercialEvent } from "./events.js";
import { runIdempotent, type ComercialActor } from "./operations.js";
import type { ComercialProfile } from "./profile.js";
import {
  FOLGA_DO_RELOGIO_MS,
  actorOf,
  assertComercialCaller,
  conferirNaoFuturo,
  conferirPeriodoExecutado,
  conteudo,
  dataDaEntrada,
  demandRef,
  instanteComFuso,
  lerContato,
  linhasGravadas,
  linkDaEntrada,
  marcosComEtapa,
  quoteRef,
  revisaoRef,
  rvEnviadaParaVoltar,
  rvRestaurada,
  rvSeguinte,
  texto,
  textoOuNull,
  type Dados,
  type QuoteOptions,
} from "./quotes.js";

/**
 * A demanda depois do envio (docs/plataforma/fase-6-comercial.md, parte 10):
 * a callable advanceDemand com o que o cliente responde e o que acontece com
 * o serviço.
 *
 * - close: o cliente fechou a proposta enviada. A resposta fica na RV
 *   congelada (resposta_cliente), as linhas dela viram o escopo da demanda,
 *   sem preço, e o prospect vira cliente na mesma transação (sem sigla,
 *   módulos nem projeções: nada liga no WMS).
 * - lose: perdida, com motivo da lista, de qualquer etapa antes de faturar;
 *   depois do fechamento, só "cancelado_cliente".
 * - reopen: perdida volta à etapa de antes; a proposta enviada e recusada
 *   volta a ser montada numa RV nova.
 * - register_execution: o período executado, de "para planejar" para
 *   "execução a orçar"; também com um aditivo em negociação, que não segura
 *   o serviço.
 * - validate: o cliente validou a RV de execução ou de aditivo enviada (ou a
 *   RV fechada, quando a execução não teve desvio). Leva a "aguardando
 *   autorização" quando o contrato exige o "pode faturar" do cliente, ou a
 *   "a faturar".
 * - refuse_addendum: o cliente recusou o aditivo enviado. A resposta fica na
 *   RV do aditivo e o orçamento volta à RV do escopo fechado, com a etapa
 *   dela ("para planejar" ou "execução a orçar").
 *
 * Por que uma callable própria, e não ações no advanceQuote: estas ações
 * mudam a demanda e registram a resposta do cliente, não a situação do
 * orçamento; a tela confere a etapa e a RV que viu (expected_etapa e
 * expected_rv), não a situação e a edição; cada ação tem a sua entrada; e a
 * Operação vai registrar a execução na Fase 3 sem ganhar as ações do
 * orçamento.
 *
 * Como no advanceQuote: requireComercialCaller na callable, safeParse, a
 * etapa e a RV conferidas na transação, leituras antes das escritas, recibo
 * e evento na mesma transação, e evento sem valor, nome, e-mail ou telefone.
 */

// --- Entrada -------------------------------------------------------------------------

const requestId = z.string().trim().min(1, "Informe o request_id.").max(200, "request_id longo demais.");
const numeroServico = z.string().trim().regex(/^\d{5,8}$/, "Número do orçamento inválido.");
const idDocumento = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,120}$/, "Id inválido.")
  .refine(idDeDocumentoValido, "Id inválido.");

const conferencia = {
  request_id: requestId,
  numero: numeroServico,
  /** A etapa e a RV que a tela viu. */
  expected_etapa: z.enum(ETAPAS_DEMANDA),
  expected_rv: z.number().int().min(0).max(99),
};

/** A resposta do cliente: quando (com a hora), quem (um contato do cliente) e o link do e-mail ou do portal. */
const resposta = {
  em: instanteComFuso("Respondido em").optional(),
  contato_id: idDocumento.nullable().optional(),
  link: linkDaEntrada,
};

const Fechar = z.object({ action: z.literal("close"), ...conferencia, ...resposta }).strict();
const Validar = z.object({ action: z.literal("validate"), ...conferencia, ...resposta }).strict();
const Perder = z
  .object({
    action: z.literal("lose"),
    ...conferencia,
    motivo: z.enum(MOTIVOS_PERDA),
    nota: z.string().trim().max(1000, "Use até 1000 caracteres na nota.").nullable().optional(),
  })
  .strict();
const Reabrir = z.object({ action: z.literal("reopen"), ...conferencia }).strict();
const RegistrarExecucao = z
  .object({ action: z.literal("register_execution"), ...conferencia, executado_de: dataDaEntrada, executado_ate: dataDaEntrada })
  .strict();
const RecusarAditivo = z.object({ action: z.literal("refuse_addendum"), ...conferencia, ...resposta }).strict();

export const AdvanceDemandInput = z.discriminatedUnion("action", [Fechar, Validar, Perder, Reabrir, RegistrarExecucao, RecusarAditivo]);
export type AdvanceDemandInput = z.infer<typeof AdvanceDemandInput>;

export type AdvanceDemandResult = {
  ok: true;
  numero: string;
  rotulo: string;
  rv: number;
  edicao: number;
  status: StatusOrcamento;
  etapa: EtapaDemanda;
  /** A ação já estava feita: só devolve o estado atual. */
  ja_feito: boolean;
  events: string[];
};

// --- Apoio -----------------------------------------------------------------------------

type Contexto = {
  transaction: Transaction;
  db: Firestore;
  operationId: string;
  actor: ComercialActor;
  caller: ComercialProfile;
  numero: string;
  demanda: Dados;
  quote: Dados;
  instante: Date;
  iso: string;
};

type Trabalho = { target_id: string; result: AdvanceDemandResult };

/** O escopo veio desta origem, nesta RV, e a demanda já saiu de "aguardando cliente". */
function escopoJaGravado(demanda: Dados, input: AdvanceDemandInput, origem: OrigemDoEscopo): boolean {
  return (
    input.expected_etapa === "aguardando_cliente" &&
    rvFechada(demanda) === input.expected_rv &&
    demanda.escopo_origem === origem &&
    demanda.etapa !== "aguardando_cliente"
  );
}

/**
 * A ação já foi feita sobre o que a tela viu: repetir só devolve o estado.
 * Cada ação se reconhece pelo que só ela grava (o escopo do fechamento, o do
 * aditivo, a validação, a perda, a reabertura, o registro da execução, a
 * recusa): uma não passa pela outra.
 */
function acaoDaDemandaJaFeita(input: AdvanceDemandInput, demanda: Dados): boolean {
  switch (input.action) {
    case "close":
      return escopoJaGravado(demanda, input, "fechamento");
    case "validate":
      return validacaoDaDemanda(demanda)?.rv === input.expected_rv || escopoJaGravado(demanda, input, "aditivo");
    case "lose": {
      const perda = demanda.perda as { motivo?: unknown; etapa_antes?: unknown; rv?: unknown } | null | undefined;
      return Boolean(perda) && perda?.etapa_antes === input.expected_etapa && perda?.motivo === input.motivo && perda?.rv === input.expected_rv;
    }
    case "reopen": {
      const anteriores = Array.isArray(demanda.perdas_anteriores) ? (demanda.perdas_anteriores as Array<{ rv?: unknown }>) : [];
      return input.expected_etapa === "perdida" && !demanda.perda && anteriores.at(-1)?.rv === input.expected_rv;
    }
    case "register_execution": {
      const registro = demanda.registro_execucao as { etapa_antes?: unknown; rv?: unknown } | null | undefined;
      return demandaExecutada(demanda) && registro?.etapa_antes === input.expected_etapa && registro?.rv === input.expected_rv;
    }
    case "refuse_addendum": {
      const recusas = Array.isArray(demanda.aditivos_recusados) ? (demanda.aditivos_recusados as Array<{ rv?: unknown }>) : [];
      return input.expected_etapa === "aguardando_cliente" && recusas.some((recusa) => recusa.rv === input.expected_rv);
    }
  }
}

function comum(contexto: Contexto) {
  return {
    operation_id: contexto.operationId,
    entity_id: contexto.numero,
    customer_code: texto(contexto.demanda.customer_code),
    actor: contexto.actor,
    occurred_at: contexto.iso,
  };
}

/** A demanda com a etapa nova: marco, etapa_desde e o evento demand.stage_changed. */
function mudarEtapa(contexto: Contexto, patch: Record<string, unknown>, etapaDepois: EtapaDemanda, events: string[]): void {
  const etapaAntes = contexto.demanda.etapa as EtapaDemanda;
  if (etapaDepois === etapaAntes) return;
  patch.etapa = etapaDepois;
  patch.etapa_desde = contexto.iso;
  patch.marcos = marcosComEtapa(contexto.demanda, etapaDepois, { em: contexto.iso, por_uid: contexto.caller.uid });
  events.push(
    createComercialEvent(contexto.transaction, contexto.db, {
      ...comum(contexto),
      type: "demand.stage_changed",
      payload: {
        numero: contexto.numero,
        etapa_antes: etapaAntes,
        etapa_depois: etapaDepois,
        segundos_desde_anterior: segundosDesde(contexto.demanda.etapa_desde, contexto.instante),
      },
    }).id,
  );
}

function gravarDemanda(contexto: Contexto, patch: Record<string, unknown>): void {
  contexto.transaction.update(demandRef(contexto.db, contexto.numero), {
    ...patch,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: contexto.caller.uid,
  });
}

function resultado(contexto: Contexto, etapa: EtapaDemanda, events: string[], quote: Dados = contexto.quote): Trabalho {
  const rv = Number(quote.rv ?? 0);
  return {
    target_id: contexto.numero,
    result: {
      ok: true,
      numero: contexto.numero,
      rotulo: rotuloDoOrcamento(contexto.numero, rv),
      rv,
      edicao: Number(quote.edicao),
      status: quote.status as StatusOrcamento,
      etapa,
      ja_feito: false,
      events,
    },
  };
}

/**
 * O prospect vira cliente no primeiro fechamento, na mesma transação: só o
 * estágio muda. Nada de sigla, módulos ou projeção (client_profiles): o WMS
 * continua sem ligar nada até Configurações › Clientes.
 */
function virarCliente(contexto: Contexto, cadastro: CadastroEncontrado, events: string[]): boolean {
  if (customerStage(cadastro.data.stage) !== "prospect") return false;
  contexto.transaction.update(cadastro.ref, {
    stage: "cliente",
    stage_changed_at: FieldValue.serverTimestamp(),
    updated_by: contexto.caller.uid,
    updated_at: FieldValue.serverTimestamp(),
  });
  events.push(
    createComercialEvent(contexto.transaction, contexto.db, {
      ...comum(contexto),
      type: "commercial_customer.became_client",
      entity_id: entityIdDoCadastro(cadastro.id),
      payload: { numero: contexto.numero },
    }).id,
  );
  return true;
}

/**
 * Onde a RV congelada guarda a resposta do cliente: `resposta_cliente` é a
 * resposta à RV como foi enviada (fechado, na proposta; validada, na
 * execução e no aditivo). A RV fechada validada sem desvio depois da
 * execução já tem o "fechado": a validação vai em `validacao_cliente`.
 */
type CampoDaResposta = "resposta_cliente" | "validacao_cliente";

/**
 * A RV congelada que recebe a resposta do cliente: tem de existir, estar
 * enviada e ainda sem essa resposta. A resposta não vem antes do envio (além
 * da folga do relógio): a linha do tempo fica em ordem.
 */
function revisaoParaResponder(
  snapshot: DocumentSnapshot,
  numero: string,
  rv: number,
  campo: CampoDaResposta,
  resposta: { em: string; rotulo: string },
): void {
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", `A RV ${rotuloDoOrcamento(numero, rv)} não foi congelada no envio. Envie antes de registrar a resposta.`);
  }
  const enviadoEm = snapshot.get("enviado_em");
  if (!enviadoEm) {
    throw new HttpsError("failed-precondition", `A RV ${rotuloDoOrcamento(numero, rv)} ainda não foi enviada ao cliente.`);
  }
  if (snapshot.get(campo)) {
    throw new HttpsError("failed-precondition", `A RV ${rotuloDoOrcamento(numero, rv)} já tem essa resposta do cliente.`);
  }
  if (Date.parse(resposta.em) < Date.parse(String(enviadoEm)) - FOLGA_DO_RELOGIO_MS) {
    throw new HttpsError(
      "invalid-argument",
      `${resposta.rotulo} não pode ser antes do envio da ${rotuloDoOrcamento(numero, rv)} ao cliente.`,
    );
  }
}

type RespostaEntrada = { em?: string; contato_id?: string | null; link?: string | null };

function respostaDoCliente(
  tipo: "fechado" | "validada" | "recusada",
  entrada: RespostaEntrada,
  contexto: Contexto,
  contatoId: string | null,
) {
  return {
    tipo,
    em: entrada.em ?? contexto.iso,
    contato_id: contatoId,
    link: entrada.link ?? null,
    registrada_por: contexto.caller.uid,
    registrada_em: contexto.iso,
  };
}

// --- Ações -----------------------------------------------------------------------------

/** O cliente fechou a proposta enviada: escopo sem preço, resposta na RV e o prospect vira cliente. */
async function fechar(contexto: Contexto, input: z.infer<typeof Fechar>): Promise<Trabalho> {
  const { transaction, db, numero, demanda, quote } = contexto;
  const rv = Number(quote.rv ?? 0);
  const code = texto(demanda.customer_code);
  if (quote.status !== "enviado" || demanda.etapa !== "aguardando_cliente") {
    throw new HttpsError("failed-precondition", "O cliente fecha a proposta enviada, que espera a resposta dele.");
  }
  if (quote.tipo_rv !== "proposta") {
    throw new HttpsError("failed-precondition", "A RV de execução ou de aditivo não se fecha: o cliente a valida (validate).");
  }
  if (rvFechada(demanda) !== null) throw new HttpsError("failed-precondition", `A demanda ${numero} já foi fechada.`);

  // Leituras.
  const revisao = await transaction.get(revisaoRef(db, numero, rv));
  revisaoParaResponder(revisao, numero, rv, "resposta_cliente", { em: input.em ?? contexto.iso, rotulo: "Fechado em" });
  const contato = input.contato_id ? await lerContato(transaction, db, input.contato_id, code) : null;
  const cadastro = await cadastroPeloCodigo(transaction, db, code);

  // Escritas.
  const events: string[] = [];
  transaction.update(revisao.ref, { resposta_cliente: respostaDoCliente("fechado", input, contexto, contato?.contato_id ?? null) });
  const patch: Record<string, unknown> = {
    escopo_rv: rv,
    escopo_origem: "fechamento" satisfies OrigemDoEscopo,
    escopo: escopoDasLinhas(linhasGravadas(revisao.get("linhas"))),
  };
  const etapaDepois = etapaDaDemanda({ ...demanda, ...patch }, { status: "enviado", tipo_rv: String(quote.tipo_rv), rv });
  const virouCliente = virarCliente(contexto, cadastro, events);
  events.unshift(
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "demand.won",
      payload: { numero, rv, virou_cliente: virouCliente, segundos_desde_anterior: segundosDesde(demanda.etapa_desde, contexto.instante) },
    }).id,
  );
  mudarEtapa(contexto, patch, etapaDepois, events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, etapaDepois, events);
}

/** Perdida, com motivo: de qualquer etapa antes de faturar; depois do fechamento, só cancelado pelo cliente. */
function perder(contexto: Contexto, input: z.infer<typeof Perder>): Trabalho {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const nota = input.nota?.trim() || null;
  const problema = problemaDaPerda(input.motivo as MotivoPerda, { ...demanda, etapa: etapaAntes }, nota);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const rv = Number(quote.rv ?? 0);

  const events: string[] = [
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "demand.lost",
      payload: {
        numero,
        rv,
        etapa_antes: etapaAntes,
        motivo: input.motivo,
        segundos_desde_anterior: segundosDesde(demanda.etapa_desde, contexto.instante),
      },
    }).id,
  ];
  const patch: Record<string, unknown> = {
    perda: { motivo: input.motivo, nota, etapa_antes: etapaAntes, rv, em: iso, por_uid: caller.uid },
  };
  mudarEtapa(contexto, patch, "perdida", events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, "perdida", events);
}

/**
 * Perdida → a etapa de antes. Se a RV atual já foi enviada e o cliente não
 * tinha dito sim, abre a RV seguinte (a enviada não muda); a demanda fechada
 * e cancelada volta com a mesma RV.
 */
function reabrir(contexto: Contexto): Trabalho {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  if (demanda.cancelamento) throw new HttpsError("failed-precondition", `A demanda ${numero} está cancelada.`);
  if (!demanda.perda || demanda.etapa !== "perdida") throw new HttpsError("failed-precondition", `A demanda ${numero} não está perdida.`);

  const events: string[] = [];
  const perda = demanda.perda as Dados;
  const anteriores = Array.isArray(demanda.perdas_anteriores) ? demanda.perdas_anteriores : [];
  const patch: Record<string, unknown> = {
    perda: null,
    perdas_anteriores: [...anteriores, { ...perda, reaberta_em: iso, reaberta_por: caller.uid }],
  };
  const abreRv = reaberturaAbreRv(demanda, { status: String(quote.status) });
  let quoteDepois: Dados = quote;
  if (abreRv) {
    const seguinte = rvSeguinte(numero, quote, "reabertura", { uid: caller.uid, iso });
    transaction.update(quoteRef(db, numero), seguinte.patch);
    quoteDepois = { ...quote, ...seguinte.patch };
  }
  const rv = Number(quoteDepois.rv ?? 0);
  const etapaDepois = etapaDaDemanda(
    { ...demanda, perda: null },
    { status: String(quoteDepois.status), tipo_rv: String(quoteDepois.tipo_rv), rv },
  );
  events.push(
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "demand.reopened",
      payload: { numero, rv, etapa_antes: "perdida", etapa_depois: etapaDepois, rv_aberta: abreRv },
    }).id,
  );
  if (abreRv) {
    events.push(
      createComercialEvent(transaction, db, {
        ...comum(contexto),
        type: "quote.revised",
        payload: {
          numero,
          rv,
          rv_anterior: Number(quote.rv ?? 0),
          tipo_rv: quoteDepois.tipo_rv as TipoRv,
          motivo: "reabertura",
          edicao: Number(quoteDepois.edicao),
          etapa_antes: "perdida",
          etapa_depois: etapaDepois,
        },
      }).id,
    );
  }
  mudarEtapa(contexto, patch, etapaDepois, events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, etapaDepois, events, quoteDepois);
}

/**
 * O período executado: de "para planejar" para "execução a orçar". Com um
 * aditivo em negociação, a execução fica registrada e a etapa segue a do
 * aditivo; recusado o aditivo, a demanda volta à execução a orçar.
 */
function registrarExecucao(contexto: Contexto, input: z.infer<typeof RegistrarExecucao>): Trabalho {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const rv = Number(quote.rv ?? 0);
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const problema = problemaDoRegistroDaExecucao({ ...demanda, etapa: etapaAntes }, { tipo_rv: String(quote.tipo_rv), rv });
  if (problema) throw new HttpsError("failed-precondition", problema);
  conferirPeriodoExecutado(input.executado_de, input.executado_ate, contexto.instante);
  const patch: Record<string, unknown> = {
    executado_de: input.executado_de,
    executado_ate: input.executado_ate,
    registro_execucao: { etapa_antes: etapaAntes, rv, em: iso, por_uid: caller.uid },
  };
  const etapaDepois = etapaDaDemanda({ ...demanda, ...patch }, { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv });
  const events = [
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "demand.execution_registered",
      payload: { numero, executado_de: input.executado_de, executado_ate: input.executado_ate },
    }).id,
  ];
  mudarEtapa(contexto, patch, etapaDepois, events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, etapaDepois, events);
}

/**
 * O cliente validou a RV de execução ou de aditivo enviada (ou a RV fechada,
 * sem desvio na execução). O aditivo validado antes da execução amplia o
 * escopo e volta a "para planejar"; depois da execução, a validação leva a
 * "aguardando autorização" (contrato com pedido e aceite, ou portal) ou a "a
 * faturar" (marcada medicao_pendente no contrato por medição mensal).
 */
async function validar(contexto: Contexto, input: z.infer<typeof Validar>): Promise<Trabalho> {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const rv = Number(quote.rv ?? 0);
  const code = texto(demanda.customer_code);
  const problema = problemaDaValidacao(
    { ...demanda, etapa: demanda.etapa as EtapaDemanda },
    { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv },
  );
  if (problema) throw new HttpsError("failed-precondition", problema);

  // Leituras.
  const semDesvio = rvFechada(demanda) === rv;
  const campo: CampoDaResposta = semDesvio ? "validacao_cliente" : "resposta_cliente";
  const revisao = await transaction.get(revisaoRef(db, numero, rv));
  revisaoParaResponder(revisao, numero, rv, campo, { em: input.em ?? iso, rotulo: "Validado em" });
  const contato = input.contato_id ? await lerContato(transaction, db, input.contato_id, code) : null;
  const contratoId = textoOuNull(demanda.contrato_id);
  let autorizacao: unknown = null;
  if (contratoId) {
    const contrato = await transaction.get(db.collection(CONTRACTS_COLLECTION).doc(contratoId));
    if (!contrato.exists) throw new HttpsError("failed-precondition", `O contrato ${contratoId} da demanda não existe mais.`);
    autorizacao = (contrato.get("autorizacao") as { tipo?: unknown } | undefined)?.tipo ?? null;
  }
  const cadastro = await cadastroPeloCodigo(transaction, db, code);

  // Escritas.
  const events: string[] = [];
  transaction.update(revisao.ref, { [campo]: respostaDoCliente("validada", input, contexto, contato?.contato_id ?? null) });
  const patch: Record<string, unknown> = {};
  const destino = destinoDaValidacao({ cobranca: demanda.cobranca, autorizacao });
  const aditivoAntesDaExecucao = quote.tipo_rv === "aditivo" && !demandaExecutada(demanda);
  if (aditivoAntesDaExecucao) {
    // O aditivo validado antes da execução amplia o escopo: a demanda volta a "para planejar" com ele.
    patch.escopo_rv = rv;
    patch.escopo_origem = "aditivo" satisfies OrigemDoEscopo;
    patch.escopo = escopoDasLinhas(linhasGravadas(revisao.get("linhas")));
  } else {
    patch.validacao = {
      rv,
      etapa: destino.etapa,
      autorizacao: typeof autorizacao === "string" ? autorizacao : null,
      em: input.em ?? iso,
      por_uid: caller.uid,
    };
    patch.medicao_pendente = destino.medicao_pendente;
  }
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const etapaDepois = etapaDaDemanda({ ...demanda, ...patch }, { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv });
  // A demanda direta nunca teve fechamento: a validação é o primeiro sim do cliente.
  const virouCliente = virarCliente(contexto, cadastro, events);
  events.unshift(
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "quote.validated",
      payload: {
        numero,
        rv,
        tipo_rv: quote.tipo_rv as TipoRv,
        etapa_antes: etapaAntes,
        etapa_depois: etapaDepois,
        autorizacao_exigida: aditivoAntesDaExecucao ? false : destino.autorizacao_exigida,
        medicao_pendente: aditivoAntesDaExecucao ? false : destino.medicao_pendente,
        virou_cliente: virouCliente,
      },
    }).id,
  );
  mudarEtapa(contexto, patch, etapaDepois, events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, etapaDepois, events);
}

/**
 * O cliente recusou o aditivo enviado: a resposta fica na RV do aditivo
 * (resposta_cliente "recusada") e o orçamento volta à RV do escopo fechado,
 * como ela está em `revisoes/{escopo_rv}`. A demanda volta à etapa do escopo
 * ("para planejar", ou "execução a orçar" se a execução já foi registrada).
 * A RV seguinte não reusa o número do aditivo, que o cliente recebeu.
 */
async function recusarAditivo(contexto: Contexto, input: z.infer<typeof RecusarAditivo>): Promise<Trabalho> {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const rv = Number(quote.rv ?? 0);
  const code = texto(demanda.customer_code);
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const problema = problemaDaRecusaDoAditivo(
    { ...demanda, etapa: etapaAntes },
    { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv },
  );
  if (problema) throw new HttpsError("failed-precondition", problema);
  const escopoRv = rvFechada(demanda) as number;

  // Leituras.
  const [revisao, escopoSnap] = await transaction.getAll(revisaoRef(db, numero, rv), revisaoRef(db, numero, escopoRv));
  revisaoParaResponder(revisao, numero, rv, "resposta_cliente", { em: input.em ?? iso, rotulo: "Recusado em" });
  const escopo = rvEnviadaParaVoltar(escopoSnap, numero, escopoRv);
  const contato = input.contato_id ? await lerContato(transaction, db, input.contato_id, code) : null;

  // Escritas.
  transaction.update(revisao.ref, { resposta_cliente: respostaDoCliente("recusada", input, contexto, contato?.contato_id ?? null) });
  const restaurada = rvRestaurada(numero, quote, escopo, [rv], { uid: caller.uid, iso });
  transaction.update(quoteRef(db, numero), restaurada.patch);
  const recusas = Array.isArray(demanda.aditivos_recusados) ? demanda.aditivos_recusados : [];
  const patch: Record<string, unknown> = {
    aditivos_recusados: [...recusas, { rv, em: input.em ?? iso, por_uid: caller.uid, registrada_em: iso }],
  };
  const quoteDepois: Dados = { ...quote, ...restaurada.patch };
  const etapaDepois = etapaDaDemanda(
    { ...demanda, ...patch },
    { status: "enviado", tipo_rv: restaurada.tipo_rv, rv: restaurada.rv },
  );
  const events = [
    createComercialEvent(transaction, db, {
      ...comum(contexto),
      type: "quote.refused",
      payload: {
        numero,
        rv,
        tipo_rv: quote.tipo_rv as TipoRv,
        rv_restaurada: restaurada.rv,
        etapa_antes: etapaAntes,
        etapa_depois: etapaDepois,
        segundos_desde_anterior: segundosDesde(demanda.etapa_desde, contexto.instante),
      },
    }).id,
  ];
  mudarEtapa(contexto, patch, etapaDepois, events);
  gravarDemanda(contexto, patch);
  return resultado(contexto, etapaDepois, events, quoteDepois);
}

// --- Callable ----------------------------------------------------------------------------

/**
 * Callable advanceDemand: fechar (close), perder (lose), reabrir (reopen),
 * registrar a execução (register_execution), validar (validate) e registrar
 * a recusa do aditivo (refuse_addendum), conferindo a etapa e a RV que a tela
 * viu.
 */
export async function advanceDemandFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<AdvanceDemandResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(AdvanceDemandInput, data);
  const agora = opcoes.agora ?? (() => new Date());
  if (input.action === "close" || input.action === "validate" || input.action === "refuse_addendum") {
    const rotulo = { close: "Fechado em", validate: "Validado em", refuse_addendum: "Recusado em" }[input.action];
    conferirNaoFuturo(input.em, agora(), rotulo);
  }
  const actor = actorOf(caller);
  const numero = input.numero;

  return runIdempotent<AdvanceDemandResult>(
    db,
    { kind: `demand_${input.action}`, scope: { numero }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();

      // Leituras (cada ação lê o resto antes de escrever).
      const [demandaSnap, quoteSnap] = await transaction.getAll(demandRef(db, numero), quoteRef(db, numero));
      if (!demandaSnap.exists || !quoteSnap.exists) throw new HttpsError("not-found", `Demanda ${numero} não encontrada.`);
      const demanda = demandaSnap.data() ?? {};
      const quote = quoteSnap.data() ?? {};
      const contexto: Contexto = { transaction, db, operationId, actor, caller, numero, demanda, quote, instante, iso };

      if (acaoDaDemandaJaFeita(input, demanda)) {
        return { target_id: numero, result: { ...resultado(contexto, demanda.etapa as EtapaDemanda, []).result, ja_feito: true } };
      }
      const etapa = demanda.etapa as EtapaDemanda;
      const rv = Number(quote.rv ?? 0);
      if (etapa !== input.expected_etapa || rv !== input.expected_rv) {
        throw new HttpsError(
          "failed-precondition",
          `A demanda ${numero} mudou: está ${rotuloDaEtapa(etapa)}, na ${rotuloDoOrcamento(numero, rv)}. Abra de novo.`,
        );
      }
      switch (input.action) {
        case "close":
          return fechar(contexto, input);
        case "lose":
          return perder(contexto, input);
        case "reopen":
          return reabrir(contexto);
        case "register_execution":
          return registrarExecucao(contexto, input);
        case "validate":
          return validar(contexto, input);
        case "refuse_addendum":
          return recusarAditivo(contexto, input);
      }
    },
  );
}
