import { chaveDaIntencao, type TentativaDeChamada } from "./envio";
import { VARIANTES, VARIANTE_PADRAO, classificarErro, dataHoraLocal, instanteComFuso } from "./montar";
import { COMERCIAL_ROLES } from "./navegacao";
import { dataHoraCurta, type EtapaDemanda, type ItemDaFila, type StatusOrcamento } from "./orcamentos";

/**
 * As ações depois do envio (parte 12b de docs/plataforma/fase-6-comercial.md):
 * o que o cliente respondeu e o que acontece com o serviço, na fila e na
 * montagem. Regras puras: as ações de cada etapa (por tipo de RV e papel), a
 * validação dos diálogos e o pedido de cada ação às callables advanceDemand
 * (fechar, perder, reabrir, registrar a execução, validar, recusar o aditivo)
 * e advanceQuote (revisar, descartar a RV seguinte), sempre com a etapa e a RV
 * (ou a situação e a edição) que a tela viu: o servidor recusa se mudou. A
 * direta que a Operação abriu e executou nasce o orçamento por saveQuote
 * (price_execution, parte 3.10d de docs/plataforma/fase-3-operacao.md).
 *
 * O servidor confere tudo de novo (functions/comercial, domain/demandas.ts e
 * domain/quotes.ts); aqui a tela só deixa de oferecer o que ele recusaria e
 * avisa o que falta antes de gravar.
 */

type Registro = Record<string, unknown>;

export type AcaoDepoisDoEnvio =
  | "fechar"
  | "perder"
  | "revisar"
  | "validar"
  | "recusar_aditivo"
  | "registrar_execucao"
  | "aditivo"
  | "orcar_execucao"
  | "orcar_da_operacao"
  | "reabrir"
  | "descartar_rv";

/** Os rótulos dos botões, na linguagem do pedido (sem legenda). */
export const ROTULO_DA_ACAO: Record<AcaoDepoisDoEnvio, string> = {
  fechar: "Fechado",
  perder: "Perdido",
  revisar: "Revisar",
  validar: "Validado",
  recusar_aditivo: "Recusar aditivo",
  registrar_execucao: "Registrar execução",
  aditivo: "Aditivo",
  orcar_execucao: "Orçar execução",
  orcar_da_operacao: "Orçar execução",
  reabrir: "Reabrir",
  descartar_rv: "Descartar RV",
};

/** O que as ações precisam saber do orçamento (a linha da fila já tem tudo isso). */
export type ItemParaAcoes = Pick<
  ItemDaFila,
  "numero" | "rv" | "etapa" | "tipoRv" | "status" | "edicao" | "revisaoDe" | "autorUid" | "escopoRv" | "executada" | "validada" | "semOrcamento" | "daOperacao"
>;

export type AcoesDaEtapa = { principal: AcaoDepoisDoEnvio | null; secundarias: AcaoDepoisDoEnvio[] };

const SEM_ACAO: AcoesDaEtapa = { principal: null, secundarias: [] };

/**
 * As ações da etapa em que o orçamento está.
 *
 * - Aguardando cliente: na proposta, Fechado (principal), Revisar e Perdido;
 *   na RV de execução, Validado e Revisar; no aditivo, Validado, Recusar
 *   aditivo e Revisar.
 * - Para planejar (fechada): Registrar execução, Aditivo e Perdido (que depois
 *   do fechamento só vale por cancelamento do cliente).
 * - Execução a orçar: com a RV fechada enviada, Orçar execução abre a RV de
 *   execução; Validado fica ao lado para a execução sem desvio (a RV fechada
 *   validada como está).
 * - Perdida: Reabrir. A cancelada e as etapas do faturamento não têm ação.
 * - Sem orçamento: só a direta que a Operação abriu, já em Execução a orçar,
 *   tem ação, Orçar execução (o orçamento nasce com o que ela executou). As
 *   outras ações pedem o orçamento.
 * - RV seguinte ainda não enviada (tem de onde voltar): Descartar RV. No "para
 *   aprovar", como a devolução, só do aprovador (owner) ou de quem montou.
 */
export function acoesDepoisDoEnvio(
  item: ItemParaAcoes,
  quem: { role: string | null | undefined; uid?: string | null },
): AcoesDaEtapa {
  if (!quem.role || !(COMERCIAL_ROLES as readonly string[]).includes(quem.role)) return SEM_ACAO;
  const { etapa, status } = item;
  if (item.semOrcamento) {
    return item.daOperacao && etapa === "execucao_a_orcar" ? { principal: "orcar_da_operacao", secundarias: [] } : SEM_ACAO;
  }
  if (etapa === "perdida") return { principal: "reabrir", secundarias: [] };
  if (etapa === "cancelada") return SEM_ACAO;
  const registro: AcaoDepoisDoEnvio[] = executaComAditivoEmNegociacao(item) ? ["registrar_execucao"] : [];

  if (status !== "enviado") {
    const autor = Boolean(quem.uid) && quem.uid === item.autorUid;
    const descarta = Boolean(item.revisaoDe) && !(status === "para_aprovar" && quem.role !== "owner" && !autor);
    // Perdido também no rascunho e no aprovado ainda não enviado (pergunta 10
    // do plano de implantação, parte 6.22): o servidor já aceitava.
    const perde = (status === "rascunho" || status === "aprovado") && (ETAPAS_QUE_PERDEM as readonly string[]).includes(etapa);
    const secundarias: AcaoDepoisDoEnvio[] = [
      ...(descarta ? (["descartar_rv"] as const) : []),
      ...registro,
      ...(perde ? (["perder"] as const) : []),
    ];
    return secundarias.length ? { principal: null, secundarias } : SEM_ACAO;
  }

  switch (etapa) {
    case "aguardando_cliente":
      if (item.tipoRv === "proposta") return { principal: "fechar", secundarias: ["revisar", "perder"] };
      if (item.tipoRv === "aditivo") return { principal: "validar", secundarias: ["recusar_aditivo", "revisar", ...registro] };
      return { principal: "validar", secundarias: ["revisar"] };
    case "para_planejar":
      return { principal: "registrar_execucao", secundarias: ["aditivo", "perder"] };
    case "execucao_a_orcar":
      return { principal: "orcar_execucao", secundarias: ["validar"] };
    default:
      return SEM_ACAO;
  }
}

/** Etapas em que o servidor aceita registrar a execução com o aditivo em negociação (problemaDoRegistroDaExecucao). */
const ETAPAS_DO_ADITIVO_EM_NEGOCIACAO: readonly EtapaDemanda[] = ["em_montagem", "para_aprovar", "para_enviar", "aguardando_cliente"];

/**
 * O aditivo ainda sem o sim do cliente, sobre a demanda fechada e ainda não
 * executada: o serviço não espera o aditivo, a execução se registra mesmo
 * assim (domain/demanda.ts, aditivoEmNegociacao).
 */
function executaComAditivoEmNegociacao(item: ItemParaAcoes): boolean {
  return (
    item.tipoRv === "aditivo" &&
    item.escopoRv !== null &&
    item.escopoRv !== item.rv &&
    !item.validada &&
    !item.executada &&
    ETAPAS_DO_ADITIVO_EM_NEGOCIACAO.includes(item.etapa)
  );
}

// --- Motivos -----------------------------------------------------------------------------------------

export type Motivo = { valor: string; rotulo: string };

/** Os motivos de perda de functions/comercial (domain/events.ts, MOTIVOS_PERDA), travados por depois-do-envio.test.ts. */
export const MOTIVOS_DE_PERDA: readonly Motivo[] = [
  { valor: "preco", rotulo: "Preço" },
  { valor: "prazo", rotulo: "Prazo" },
  { valor: "desistencia", rotulo: "Desistência" },
  { valor: "sem_resposta", rotulo: "Sem resposta" },
  { valor: "cancelado_cliente", rotulo: "Cancelado pelo cliente" },
  { valor: "prazo_faturamento", rotulo: "Prazo de faturamento" },
  { valor: "outro", rotulo: "Outro" },
];

/**
 * A perda por prazo de faturamento (Fase 7, parte 7.5a) só vale com o prazo do
 * contrato vencido: sai em ação própria, nunca na lista do Perdido.
 */
export const MOTIVO_PRAZO_DE_FATURAMENTO = "prazo_faturamento";

/**
 * "Revisar" com a RV esperando o cliente: ele pediu a mudança ou a Dutelog
 * corrige. Execução e aditivo são ações próprias (Orçar execução, Aditivo).
 */
export const MOTIVOS_DE_REVISAO: readonly Motivo[] = [
  { valor: "pedido_cliente", rotulo: "Pedido do cliente" },
  { valor: "correcao", rotulo: "Correção" },
];

/** Depois do fechamento (ou da execução, ou da validação) o único motivo de perda é o cancelamento pelo cliente. */
export function motivosDePerdaPermitidos(comprometida: boolean): readonly Motivo[] {
  const lista = MOTIVOS_DE_PERDA.filter((motivo) => motivo.valor !== MOTIVO_PRAZO_DE_FATURAMENTO);
  return comprometida ? lista.filter((motivo) => motivo.valor === "cancelado_cliente") : lista;
}

/**
 * A demanda já foi fechada, executada ou validada: a perda só vale por
 * cancelamento do cliente (demandaComprometida em functions/comercial).
 */
export function demandaComprometida(item: Pick<ItemDaFila, "escopoRv" | "executada" | "validada">): boolean {
  return item.escopoRv !== null || item.executada || item.validada;
}

/** As etapas em que a demanda ainda se perde (ETAPAS_QUE_PERDEM em functions/comercial): antes de faturar. */
export const ETAPAS_QUE_PERDEM = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
] as const satisfies readonly EtapaDemanda[];

// --- Validação dos diálogos ------------------------------------------------------------------

export type Problemas<Campo extends string> = Partial<Record<Campo, string>>;

/** Folga do relógio do aparelho, como no servidor (FOLGA_DO_RELOGIO_MS). */
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;
export const LINK_MAXIMO = 2000;
export const NOTA_MAXIMA = 1000;

export type FormDaResposta = {
  /** "AAAA-MM-DDTHH:mm" de São Paulo (campo de data e hora). */
  em: string;
  contatoId: string;
  link: string;
};

/**
 * Fechado, Validado e Recusar aditivo: quando o cliente respondeu (não é
 * depois de agora nem antes do envio da RV), quem respondeu (um contato do
 * cliente, exigido quando há contatos cadastrados) e o link do e-mail ou do
 * portal, se houver.
 */
export function problemasDaResposta(
  form: FormDaResposta,
  contexto: { agora: Date; envioEm: string | null; contatos: ReadonlyArray<{ id: string }> },
): Problemas<"em" | "contato" | "link"> {
  const problemas: Problemas<"em" | "contato" | "link"> = {};
  const instante = instanteComFuso(form.em);
  const quando = instante ? Date.parse(instante) : Number.NaN;
  if (Number.isNaN(quando)) {
    problemas.em = "Informe quando o cliente respondeu.";
  } else if (quando > contexto.agora.getTime() + FOLGA_DO_RELOGIO_MS) {
    problemas.em = "A resposta não pode ser depois de agora.";
  } else {
    const envio = contexto.envioEm ? Date.parse(contexto.envioEm) : Number.NaN;
    if (!Number.isNaN(envio) && quando < envio - FOLGA_DO_RELOGIO_MS) {
      problemas.em = `A resposta não pode ser antes do envio (${dataHoraCurta(contexto.envioEm)}).`;
    }
  }
  if (contexto.contatos.length > 0 && !contexto.contatos.some((contato) => contato.id === form.contatoId)) {
    problemas.contato = "Escolha o contato do cliente.";
  }
  const link = form.link.trim();
  if (link) {
    if (link.length > LINK_MAXIMO) problemas.link = `Use até ${LINK_MAXIMO} caracteres no link.`;
    else if (!/^https?:\/\/\S+$/i.test(link)) problemas.link = "Informe o link que começa com https://.";
  }
  return problemas;
}

/** Perdido: um motivo dos permitidos; "outro" pede a nota. */
export function problemasDaPerda(
  form: { motivo: string; nota: string },
  permitidos: readonly Motivo[],
): Problemas<"motivo" | "nota"> {
  const problemas: Problemas<"motivo" | "nota"> = {};
  if (!permitidos.some((motivo) => motivo.valor === form.motivo)) problemas.motivo = "Escolha o motivo.";
  const nota = form.nota.trim();
  if (nota.length > NOTA_MAXIMA) problemas.nota = `Use até ${NOTA_MAXIMA} caracteres na nota.`;
  else if (form.motivo === "outro" && !nota) problemas.nota = "Conte o motivo na nota.";
  return problemas;
}

/** Revisar: o pedido do cliente ou a correção. */
export function problemasDaRevisao(form: { motivo: string }): Problemas<"motivo"> {
  return MOTIVOS_DE_REVISAO.some((motivo) => motivo.valor === form.motivo) ? {} : { motivo: "Escolha o motivo." };
}

function dataReal(valor: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!partes) return false;
  const data = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  return data.toISOString().slice(0, 10) === valor.trim();
}

/** O período executado: as duas datas, o fim depois do início e até hoje ("AAAA-MM-DD"). */
export function problemasDaExecucao(form: { de: string; ate: string }, hoje: string): Problemas<"de" | "ate"> {
  const problemas: Problemas<"de" | "ate"> = {};
  if (!dataReal(form.de)) problemas.de = "Informe o início.";
  if (!dataReal(form.ate)) problemas.ate = "Informe o fim.";
  if (!problemas.de && !problemas.ate) {
    if (form.de > form.ate) problemas.ate = "O fim vem antes do início.";
    else if (form.ate > hoje) problemas.ate = "O fim não pode ser depois de hoje.";
  }
  return problemas;
}

// --- O formulário do diálogo ---------------------------------------------------------------------

/**
 * Que campos o diálogo da ação pede: a resposta do cliente, o motivo da
 * perda, o da revisão, o período, o contrato e a tabela, ou só a confirmação.
 */
export type CamposDoDialogo = "resposta" | "perda" | "revisao" | "execucao" | "contrato" | "confirmar";

export function camposDoDialogo(acao: AcaoDepoisDoEnvio): CamposDoDialogo {
  switch (acao) {
    case "fechar":
    case "validar":
    case "recusar_aditivo":
      return "resposta";
    case "perder":
      return "perda";
    case "revisar":
      return "revisao";
    case "registrar_execucao":
      return "execucao";
    case "orcar_da_operacao":
      return "contrato";
    default:
      return "confirmar";
  }
}

export type FormDoDialogo = FormDaResposta & { motivo: string; nota: string; de: string; ate: string; contratoId: string; variante: string };

/**
 * O diálogo abre com a hora de agora e o contato que fez o pedido (se ainda
 * for um contato do cliente); o motivo só vem escolhido quando é o único
 * possível (Perdido depois do fechamento); o contrato, com o vigente do
 * cliente (ou o da demanda), e a tabela Comercial.
 */
export function formInicialDoDialogo(
  acao: AcaoDepoisDoEnvio,
  contexto: {
    agora: Date;
    contatoId: string | null;
    contatos: ReadonlyArray<{ id: string }>;
    comprometida: boolean;
    /** O contrato que o diálogo sugere, se for um dos contratos que o cliente pode usar. */
    contratoId?: string | null;
    contratos?: ReadonlyArray<{ id: string }>;
  },
): FormDoDialogo {
  const permitidos = acao === "perder" ? motivosDePerdaPermitidos(contexto.comprometida) : [];
  return {
    em: dataHoraLocal(contexto.agora.toISOString()),
    contatoId: contexto.contatoId && contexto.contatos.some((contato) => contato.id === contexto.contatoId) ? contexto.contatoId : "",
    link: "",
    motivo: permitidos.length === 1 ? permitidos[0].valor : "",
    nota: "",
    de: "",
    ate: "",
    contratoId: contexto.contratoId && (contexto.contratos ?? []).some((contrato) => contrato.id === contexto.contratoId) ? contexto.contratoId : "",
    variante: VARIANTE_PADRAO,
  };
}

/** O contrato (vazio: sem contrato) é um dos do cliente, e a tabela é Comercial ou Noturna. */
export function problemasDoContrato(
  form: { contratoId: string; variante: string },
  contratos: ReadonlyArray<{ id: string }>,
): Problemas<"contrato" | "variante"> {
  const problemas: Problemas<"contrato" | "variante"> = {};
  if (form.contratoId && !contratos.some((contrato) => contrato.id === form.contratoId)) problemas.contrato = "Escolha um contrato do cliente.";
  if (!(VARIANTES as readonly string[]).includes(form.variante)) problemas.variante = "Escolha a tabela.";
  return problemas;
}

/** Os problemas do formulário da ação, por campo (vazio: pode gravar). */
export function problemasDoDialogo(
  acao: AcaoDepoisDoEnvio,
  form: FormDoDialogo,
  contexto: {
    agora: Date;
    hoje: string;
    envioEm: string | null;
    contatos: ReadonlyArray<{ id: string }>;
    comprometida: boolean;
    contratos?: ReadonlyArray<{ id: string }>;
  },
): Record<string, string> {
  switch (camposDoDialogo(acao)) {
    case "resposta":
      return problemasDaResposta(form, contexto);
    case "perda":
      return problemasDaPerda(form, motivosDePerdaPermitidos(contexto.comprometida));
    case "revisao":
      return problemasDaRevisao(form);
    case "execucao":
      return problemasDaExecucao(form, contexto.hoje);
    case "contrato":
      return problemasDoContrato(form, contexto.contratos ?? []);
    case "confirmar":
      return {};
  }
}

// --- O pedido de cada ação -------------------------------------------------------------------

export type ValoresDaAcao = {
  em?: string;
  contatoId?: string;
  link?: string;
  motivo?: string;
  nota?: string;
  de?: string;
  ate?: string;
  contratoId?: string;
  variante?: string;
};

export type PedidoDaAcao = {
  callable: "advanceDemand" | "advanceQuote" | "saveQuote";
  payload: Registro;
  /** O toast de sucesso. */
  sucesso: string;
  /** Depois de gravar, a tela leva à montagem da RV nova. */
  abreMontagem: boolean;
};

const ACAO_DA_DEMANDA = {
  fechar: "close",
  validar: "validate",
  recusar_aditivo: "refuse_addendum",
  perder: "lose",
  reabrir: "reopen",
  registrar_execucao: "register_execution",
} as const;

const SUCESSO: Record<AcaoDepoisDoEnvio, string> = {
  fechar: "Fechamento registrado",
  perder: "Orçamento marcado como perdido",
  revisar: "RV nova aberta",
  validar: "Validação registrada",
  recusar_aditivo: "Recusa do aditivo registrada",
  registrar_execucao: "Execução registrada",
  aditivo: "Aditivo aberto",
  orcar_execucao: "RV de execução aberta",
  orcar_da_operacao: "Orçamento de execução criado",
  reabrir: "Orçamento reaberto",
  descartar_rv: "RV descartada",
};

const MOTIVO_DA_REVISAO = { aditivo: "aditivo", orcar_execucao: "execucao" } as const;

/**
 * advanceDemand ou advanceQuote para a ação, com a etapa e a RV (ou a
 * situação e a edição) que a tela viu e a chave de idempotência da intenção.
 * Só vão os campos preenchidos; a hora da resposta vai com o fuso de São Paulo.
 */
export function pedidoDaAcao(
  acao: AcaoDepoisDoEnvio,
  item: Pick<ItemParaAcoes, "numero" | "rv" | "etapa" | "status" | "edicao">,
  valores: ValoresDaAcao,
  chave: string,
): PedidoDaAcao {
  const sucesso = SUCESSO[acao];
  if (acao === "orcar_da_operacao") {
    // A demanda e a execução já existem: o servidor confere que ainda não há orçamento.
    const payload: Registro = {
      action: "price_execution",
      request_id: chave,
      numero: item.numero,
      contrato_id: valores.contratoId || null,
      variante: valores.variante || VARIANTE_PADRAO,
    };
    return { callable: "saveQuote", payload, sucesso, abreMontagem: true };
  }
  if (acao === "revisar" || acao === "aditivo" || acao === "orcar_execucao" || acao === "descartar_rv") {
    const payload: Registro = {
      action: acao === "descartar_rv" ? "discard" : "revise",
      request_id: chave,
      numero: item.numero,
      expected_status: item.status as StatusOrcamento,
      expected_edicao: item.edicao,
    };
    if (acao === "revisar") payload.motivo = (valores.motivo ?? "").trim();
    if (acao === "aditivo" || acao === "orcar_execucao") payload.motivo = MOTIVO_DA_REVISAO[acao];
    return { callable: "advanceQuote", payload, sucesso, abreMontagem: acao !== "descartar_rv" };
  }

  const payload: Registro = {
    action: ACAO_DA_DEMANDA[acao],
    request_id: chave,
    numero: item.numero,
    expected_etapa: item.etapa,
    expected_rv: item.rv,
  };
  if (acao === "fechar" || acao === "validar" || acao === "recusar_aditivo") {
    const em = instanteComFuso(valores.em ?? "");
    if (em) payload.em = em;
    if (valores.contatoId) payload.contato_id = valores.contatoId;
    const link = (valores.link ?? "").trim();
    if (link) payload.link = link;
  }
  if (acao === "perder") {
    payload.motivo = (valores.motivo ?? "").trim();
    const nota = (valores.nota ?? "").trim();
    if (nota) payload.nota = nota;
  }
  if (acao === "registrar_execucao") {
    payload.executado_de = (valores.de ?? "").trim();
    payload.executado_ate = (valores.ate ?? "").trim();
  }
  return { callable: "advanceDemand", payload, sucesso, abreMontagem: false };
}

/**
 * "Orçar execução" da fila: a demanda direta (executada antes do orçamento)
 * nasce com a RV de execução (saveQuote create_execution). O servidor dá o
 * número e a tela abre a montagem.
 */
export function pedidoDeExecucaoDireta(
  entrada: { customerCode: string; contratoId: string | null; variante: string; de: string; ate: string },
  chave: string,
): PedidoDaAcao {
  return {
    callable: "saveQuote",
    payload: {
      action: "create_execution",
      request_id: chave,
      customer_code: entrada.customerCode,
      contrato_id: entrada.contratoId,
      variante: entrada.variante,
      executado_de: entrada.de.trim(),
      executado_ate: entrada.ate.trim(),
    },
    sucesso: "Orçamento de execução criado",
    abreMontagem: true,
  };
}

export type LinhaForaDaTabela = { item: string; unidade: string | null; quantidade: string };

/**
 * O que a Operação executou e a tabela não precifica, para o Comercial
 * lançar à mão na montagem: "Cofre 1 vb · Içamento pela fachada 1 vb".
 */
export function foraDaTabelaEmTexto(linhas: readonly LinhaForaDaTabela[] | null | undefined): string | null {
  if (!linhas?.length) return null;
  return linhas
    .map((linha) => [linha.item, linha.quantidade.replace(".", ","), linha.unidade?.toLocaleLowerCase("pt-BR")].filter(Boolean).join(" "))
    .join(" · ");
}

/**
 * A chave do pedido: clicar de novo no mesmo pedido (a resposta se perdeu)
 * leva a mesma chave e o servidor devolve o que já gravou; outro pedido
 * (outro orçamento, outra ação, outro valor), chave nova.
 */
export function chaveDoPedido(
  atual: TentativaDeChamada | null,
  pedido: Pick<PedidoDaAcao, "callable" | "payload">,
  nova: () => string,
): TentativaDeChamada {
  const assinatura = `${pedido.callable}:${JSON.stringify({ ...pedido.payload, request_id: null })}`;
  return chaveDaIntencao(atual, assinatura, nova);
}

const DEMANDA_MUDOU = /^A demanda \S+ mudou: está /;

/**
 * O erro da callable para a tela: a etapa ou a RV que mudou, a situação ou a
 * edição divergente e o orçamento que sumiu recarregam (a tela já é ao vivo:
 * fecha o diálogo e mostra o que o servidor tem); qualquer outra recusa só
 * mostra a mensagem e mantém o diálogo aberto.
 */
export function classificarErroDepoisDoEnvio(error: unknown): { mensagem: string; recarregar: boolean } {
  const base = classificarErro(error);
  const codigo = String((error as { codigo?: unknown; code?: unknown })?.codigo ?? (error as { code?: unknown })?.code ?? "").replace(
    /^functions\//,
    "",
  );
  const demandaMudou = codigo === "failed-precondition" && DEMANDA_MUDOU.test(base.mensagem);
  return { mensagem: base.mensagem, recarregar: base.recarregar || demandaMudou };
}
