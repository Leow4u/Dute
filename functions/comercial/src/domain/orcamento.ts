import { CASAS_DA_QUANTIDADE, CASAS_DO_PRECO, ErroDinheiro, centavosDaLinha, lerDecimal, somarCentavos } from "./dinheiro.js";
import { MARCAS_ORCAMENTO, ORIGENS_LINHA, STATUS_ORCAMENTO } from "./events.js";
import { canApproveQuote, comercialAccessProblem, type PlatformRole } from "./platform-roles.js";
import { vigenciaContem, type PrecoDaTabela } from "./tabelas.js";

/**
 * O orçamento no domínio, sem Firestore (docs/plataforma/fase-6-comercial.md,
 * "Decisões"; parte 9): o preço de cada linha, os totais, as marcas da
 * aprovação e as transições da RV em curso.
 *
 * - O servidor sempre recalcula: o app manda quantidade e item e, na linha
 *   alterada, avulsa ou de ajuste, preço e motivo. Preço da tabela, código,
 *   descrição, total da linha e totais saem daqui (dinheiro.ts).
 * - Linha "tabela" com outro preço vira "alterado", com o preço da tabela ao
 *   lado, e pede motivo. "avulso" é item fora da tabela, com preço e motivo.
 *   "ajuste" é negativo, com motivo. O total nunca fica negativo.
 * - Armazenagem não se orça (a cobrança é do WMS).
 */

export { MARCAS_ORCAMENTO, ORIGENS_LINHA, STATUS_ORCAMENTO };

export type OrigemLinha = (typeof ORIGENS_LINHA)[number];
export type MarcaOrcamento = (typeof MARCAS_ORCAMENTO)[number];
export type StatusDoOrcamento = (typeof STATUS_ORCAMENTO)[number];

export const QUOTES_COLLECTION = "quotes";
export const REVISOES_SUBCOLLECTION = "revisoes";
export const QUOTE_SCHEMA_VERSION = 1;
/** A variante em que o orçamento abre quando o app não diz outra. */
export const VARIANTE_PADRAO = "Comercial";
/** Descrição da linha de ajuste quando o app não manda uma. */
export const DESCRICAO_DO_AJUSTE = "Ajuste comercial";

export class ErroOrcamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroOrcamento";
  }
}

// --- Preço das linhas -------------------------------------------------------------

/** A linha como o app manda (já validada no formato pelo schema da callable). */
export type LinhaEntrada = {
  id?: string;
  origem: OrigemLinha;
  lpu_item_id?: string | null;
  quantidade: string;
  preco?: string | null;
  motivo?: string | null;
  descricao?: string | null;
  item?: string | null;
  servico?: string | null;
  unidade?: string | null;
  origem_local?: string | null;
  destino_local?: string | null;
};

/** O item do catálogo (`lpu_items`), sem preço. */
export type ItemDoCatalogo = {
  id: string;
  item: string;
  descricao: string;
  servico: string;
  unidade: string;
  orcavel: boolean;
  ativo: boolean;
};

export type ContextoDePreco = {
  /** A tabela da data-base, ou null (sem tabela: só item avulso e ajuste). */
  tabela: { id: string; precos: Record<string, PrecoDaTabela> } | null;
  /** Os itens do catálogo que as linhas citam. */
  itens: ReadonlyMap<string, ItemDoCatalogo>;
  /** Id da linha nova, pela posição. */
  novoId: (indice: number) => string;
};

export type LinhaDoOrcamento = {
  /** Fica o mesmo em todas as RVs e vai para a OS. */
  id: string;
  lpu_item_id: string | null;
  /** O código do cliente (DTL-…), da tabela. */
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  quantidade: string;
  /** Preço unitário em texto decimal exato. */
  preco: string;
  /** O preço da tabela, ao lado do alterado; null no avulso e no ajuste. */
  preco_tabela: string | null;
  origem: OrigemLinha;
  motivo: string | null;
  origem_local: string | null;
  destino_local: string | null;
  total_cents: number;
  /** Na duplicação: o preço que a linha tinha no orçamento de origem, quando a tabela de hoje o mudou. */
  preco_anterior: string | null;
};

export type ContagemPorOrigem = Record<OrigemLinha, number>;

export type Precificado = {
  linhas: LinhaDoOrcamento[];
  subtotal_cents: number;
  ajustes_cents: number;
  total_cents: number;
  por_origem: ContagemPorOrigem;
};

const MOTIVO_MAXIMO = 300;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

function textoOuNull(valor: unknown): string | null {
  return texto(valor) || null;
}

/** O valor exato de um decimal, para comparar "45.5" e "45.50". */
function valorExato(valor: string, casas: number, campo: string): { coeficiente: bigint; casas: number } {
  return lerDecimal(valor, casas, campo);
}

/** Dois preços em texto são o mesmo número ("45.5", "45.50" e "045.5000"). */
export function mesmoPreco(a: string, b: string): boolean {
  const x = valorExato(a, CASAS_DO_PRECO, "preço");
  const y = valorExato(b, CASAS_DO_PRECO, "preço");
  const casas = Math.max(x.casas, y.casas);
  return x.coeficiente * 10n ** BigInt(casas - x.casas) === y.coeficiente * 10n ** BigInt(casas - y.casas);
}

function contagemVazia(): ContagemPorOrigem {
  return { tabela: 0, alterado: 0, avulso: 0, ajuste: 0 };
}

/** Conta as linhas por origem (vai nos eventos, sem o preço). */
export function linhasPorOrigem(linhas: readonly { origem: string }[]): ContagemPorOrigem {
  const contagem = contagemVazia();
  for (const linha of linhas) {
    if ((ORIGENS_LINHA as readonly string[]).includes(linha.origem)) contagem[linha.origem as OrigemLinha] += 1;
  }
  return contagem;
}

/**
 * Preço, código, descrição e total de cada linha, e os totais do orçamento.
 * Recusa (ErroOrcamento, com o número da linha) o que foge das regras.
 */
export function precificarLinhas(entradas: readonly LinhaEntrada[], contexto: ContextoDePreco): Precificado {
  const vistos = new Set<string>();
  const linhas = entradas.map((entrada, indice) => {
    const numero = indice + 1;
    const falha = (mensagem: string) => new ErroOrcamento(`Linha ${numero}: ${mensagem}`);
    try {
      const linha = precificarLinha(entrada, contexto, indice, falha);
      if (vistos.has(linha.id)) throw falha(`id ${linha.id} repetido.`);
      vistos.add(linha.id);
      return linha;
    } catch (error) {
      if (error instanceof ErroDinheiro) throw falha(error.message);
      throw error;
    }
  });

  const subtotal = somarCentavos(linhas.filter((linha) => linha.origem !== "ajuste").map((linha) => linha.total_cents));
  const ajustes = somarCentavos(linhas.filter((linha) => linha.origem === "ajuste").map((linha) => linha.total_cents));
  const total = somarCentavos([subtotal, ajustes]);
  if (total < 0) {
    throw new ErroOrcamento("O total não pode ficar negativo: o ajuste passa do valor dos itens.");
  }
  return { linhas, subtotal_cents: subtotal, ajustes_cents: ajustes, total_cents: total, por_origem: linhasPorOrigem(linhas) };
}

function quantidadeConferida(quantidade: string, falha: (mensagem: string) => ErroOrcamento): string {
  const valor = lerDecimal(quantidade, CASAS_DA_QUANTIDADE, "quantidade");
  if (valor.coeficiente <= 0n) throw falha("a quantidade deve ser maior que zero.");
  return quantidade;
}

function motivoConferido(motivo: unknown, falha: (mensagem: string) => ErroOrcamento, rotulo: string): string {
  const valor = texto(motivo);
  if (!valor) throw falha(`${rotulo} pede um motivo.`);
  if (valor.length > MOTIVO_MAXIMO) throw falha(`o motivo aceita até ${MOTIVO_MAXIMO} caracteres.`);
  return valor;
}

function precoInformado(preco: unknown, falha: (mensagem: string) => ErroOrcamento, rotulo: string): string {
  if (preco === undefined || preco === null || preco === "") throw falha(`${rotulo} pede o preço.`);
  lerDecimal(preco, CASAS_DO_PRECO, "preço");
  return preco as string;
}

function itemConferido(
  id: string,
  contexto: ContextoDePreco,
  falha: (mensagem: string) => ErroOrcamento,
): ItemDoCatalogo {
  const item = contexto.itens.get(id);
  if (!item) throw falha(`o item ${id} não está no catálogo.`);
  if (!item.orcavel) throw falha("armazenagem não passa por orçamento (a cobrança é do WMS).");
  if (!item.ativo) throw falha(`o item ${item.item} está inativo no catálogo.`);
  return item;
}

function precificarLinha(
  entrada: LinhaEntrada,
  contexto: ContextoDePreco,
  indice: number,
  falha: (mensagem: string) => ErroOrcamento,
): LinhaDoOrcamento {
  const id = entrada.id ?? contexto.novoId(indice);
  const quantidade = quantidadeConferida(entrada.quantidade, falha);
  const lugares = {
    origem_local: entrada.origem_local ?? null,
    destino_local: entrada.destino_local ?? null,
  };
  const lpuItemId = textoOuNull(entrada.lpu_item_id);

  if (entrada.origem === "tabela" || entrada.origem === "alterado") {
    if (!lpuItemId) throw falha("informe o item do catálogo.");
    const item = itemConferido(lpuItemId, contexto, falha);
    if (!contexto.tabela) throw falha("o orçamento está sem tabela; use item avulso.");
    if (!Object.prototype.hasOwnProperty.call(contexto.tabela.precos, lpuItemId)) {
      throw falha(`o item ${item.item} está fora da tabela; use item avulso.`);
    }
    const daTabela = contexto.tabela.precos[lpuItemId];
    const informado = entrada.preco ?? null;
    if (entrada.origem === "alterado" && (informado === null || informado === "")) {
      throw falha("a linha alterada pede o preço.");
    }
    const alterado = informado !== null && informado !== "" && !mesmoPreco(precoInformado(informado, falha, "a linha"), daTabela.preco);
    const preco = alterado ? (informado as string) : daTabela.preco;
    return {
      id,
      lpu_item_id: lpuItemId,
      codigo: daTabela.codigo || null,
      item: item.item,
      descricao: texto(daTabela.descricao_cliente) || item.descricao || item.item,
      servico: item.servico || null,
      unidade: item.unidade || null,
      quantidade,
      preco,
      preco_tabela: daTabela.preco,
      origem: alterado ? "alterado" : "tabela",
      motivo: alterado ? motivoConferido(entrada.motivo, falha, "o preço diferente da tabela") : null,
      ...lugares,
      total_cents: centavosDaLinha(quantidade, preco),
      preco_anterior: null,
    };
  }

  if (entrada.origem === "avulso") {
    const preco = precoInformado(entrada.preco, falha, "o item avulso");
    const motivo = motivoConferido(entrada.motivo, falha, "o item avulso");
    const descricao = texto(entrada.descricao);
    if (descricao.length < 2) throw falha("o item avulso pede a descrição.");
    let item: ItemDoCatalogo | null = null;
    if (lpuItemId) {
      item = itemConferido(lpuItemId, contexto, falha);
      if (contexto.tabela && Object.prototype.hasOwnProperty.call(contexto.tabela.precos, lpuItemId)) {
        throw falha("o item está na tabela; use a linha da tabela (com outro preço e motivo, se for o caso).");
      }
    }
    return {
      id,
      lpu_item_id: lpuItemId,
      codigo: null,
      item: item?.item ?? (texto(entrada.item) || descricao),
      descricao,
      servico: item?.servico ?? textoOuNull(entrada.servico),
      unidade: item?.unidade ?? textoOuNull(entrada.unidade),
      quantidade,
      preco,
      preco_tabela: null,
      origem: "avulso",
      motivo,
      ...lugares,
      total_cents: centavosDaLinha(quantidade, preco),
      preco_anterior: null,
    };
  }

  // Ajuste: negativo, com motivo, sem item do catálogo.
  if (lpuItemId) throw falha("o ajuste não tem item do catálogo.");
  const preco = precoInformado(entrada.preco, falha, "o ajuste");
  const motivo = motivoConferido(entrada.motivo, falha, "o ajuste");
  const total = centavosDaLinha(quantidade, preco, { ajuste: true });
  if (total >= 0) throw falha("o ajuste é desconto: o valor fica negativo.");
  const descricao = texto(entrada.descricao) || DESCRICAO_DO_AJUSTE;
  return {
    id,
    lpu_item_id: null,
    codigo: null,
    item: descricao,
    descricao,
    servico: null,
    unidade: null,
    quantidade,
    preco,
    preco_tabela: null,
    origem: "ajuste",
    motivo,
    ...lugares,
    total_cents: total,
    preco_anterior: null,
  };
}

// --- Linhas gravadas numa tabela nova -----------------------------------------------------

/** A linha gravada de volta como entrada: a de tabela perde o preço, que a tabela dá de novo. */
export function entradaDaLinha(linha: LinhaDoOrcamento, comId: boolean): LinhaEntrada {
  return {
    ...(comId ? { id: linha.id } : {}),
    origem: linha.origem,
    lpu_item_id: linha.lpu_item_id,
    quantidade: linha.quantidade,
    preco: linha.origem === "tabela" ? undefined : linha.preco,
    motivo: linha.motivo,
    descricao: linha.origem === "tabela" || linha.origem === "alterado" ? undefined : linha.descricao,
    item: linha.origem === "avulso" ? linha.item : undefined,
    servico: linha.origem === "avulso" ? linha.servico : undefined,
    unidade: linha.origem === "avulso" ? linha.unidade : undefined,
    origem_local: linha.origem_local,
    destino_local: linha.destino_local,
  };
}

/** Por que a linha de tabela virou avulsa: o item saiu da tabela ou do catálogo ativo. */
export type CausaDoAvulso = "fora_da_tabela" | "fora_do_catalogo";

/**
 * As linhas gravadas como entrada para precificar numa tabela que não é a
 * delas (duplicar, ou trocar contrato ou variante sem mandar as linhas). Nada
 * é recusado por causa da troca:
 * - item que está na tabela nova: linha de tabela com o preço dela, inclusive
 *   o avulso de item que entrou na tabela; a alterada continua com o preço que
 *   tinha (e volta a ser de tabela se for o mesmo);
 * - linha de tabela cujo item não está na tabela nova (ou sem tabela): avulsa,
 *   com o preço que tinha e o motivo da troca, guardando o item;
 * - item que não está mais no catálogo ativo: avulsa sem o item, com o preço
 *   que tinha (a de tabela leva o motivo da troca; a avulsa, o dela);
 * - avulso sem item, avulso de item fora da tabela e ajuste ficam como estão.
 */
export function entradasNaTabelaNova(
  linhas: readonly LinhaDoOrcamento[],
  contexto: { tabela: { precos: Record<string, PrecoDaTabela> } | null; itens: ReadonlyMap<string, ItemDoCatalogo> },
  opcoes: { comId: boolean; motivo: (causa: CausaDoAvulso) => string },
): LinhaEntrada[] {
  return linhas.map((linha) => {
    const entrada = entradaDaLinha(linha, opcoes.comId);
    if (linha.origem === "ajuste" || !linha.lpu_item_id) return entrada;
    const item = contexto.itens.get(linha.lpu_item_id);
    const noCatalogo = item !== undefined && item.ativo && item.orcavel;
    const naTabela =
      noCatalogo && contexto.tabela !== null && Object.prototype.hasOwnProperty.call(contexto.tabela.precos, linha.lpu_item_id);
    if (naTabela) {
      if (linha.origem !== "avulso") return entrada;
      return {
        ...(opcoes.comId ? { id: linha.id } : {}),
        origem: "tabela",
        lpu_item_id: linha.lpu_item_id,
        quantidade: linha.quantidade,
        origem_local: linha.origem_local,
        destino_local: linha.destino_local,
      };
    }
    if (linha.origem === "avulso") return noCatalogo ? entrada : { ...entrada, lpu_item_id: null };
    return {
      ...entrada,
      origem: "avulso",
      lpu_item_id: noCatalogo ? linha.lpu_item_id : null,
      preco: linha.preco,
      motivo: opcoes.motivo(noCatalogo ? "fora_da_tabela" : "fora_do_catalogo"),
      descricao: linha.descricao,
      item: linha.item,
      servico: linha.servico,
      unidade: linha.unidade,
    };
  });
}

// --- Marcas ----------------------------------------------------------------------------

/**
 * O que a aprovação precisa ver: preço alterado, item avulso, ajuste, tabela
 * vencida, sem tabela e o número legado. Na ordem de MARCAS_ORCAMENTO.
 *
 * "Tabela vencida" é a tabela do orçamento que não cobre a data-base dele
 * ("sem tabela na data-base"): encerrada antes dela por uma carga
 * retroativa, por exemplo. A tabela encerrada por outra depois da data-base
 * continua certa para o orçamento (vale a da data-base) e não marca.
 */
export function marcasDoOrcamento(input: {
  linhas: readonly { origem: string }[];
  tabela: { vigente_de: string; vigente_ate: string | null } | null;
  data_base: string;
  numero_legado: string | null;
}): MarcaOrcamento[] {
  const origens = new Set(input.linhas.map((linha) => linha.origem));
  const marcas = new Set<MarcaOrcamento>();
  if (origens.has("alterado")) marcas.add("preco_alterado");
  if (origens.has("avulso")) marcas.add("item_avulso");
  if (origens.has("ajuste")) marcas.add("ajuste");
  if (input.tabela) {
    if (!vigenciaContem(input.tabela, input.data_base)) marcas.add("tabela_vencida");
  } else {
    marcas.add("sem_tabela");
  }
  if (input.numero_legado) marcas.add("legado");
  return MARCAS_ORCAMENTO.filter((marca) => marcas.has(marca));
}

// --- Transições -------------------------------------------------------------------------

export const ACOES_ORCAMENTO = ["submit", "return", "approve", "edit"] as const;
export type AcaoOrcamento = (typeof ACOES_ORCAMENTO)[number];

/** De onde cada ação sai e aonde chega (a RV em curso; a mesma RV em todas). */
export const TRANSICOES: Record<AcaoOrcamento, { de: readonly StatusDoOrcamento[]; para: StatusDoOrcamento }> = {
  submit: { de: ["rascunho"], para: "para_aprovar" },
  return: { de: ["para_aprovar"], para: "rascunho" },
  approve: { de: ["para_aprovar", "rascunho"], para: "aprovado" },
  edit: { de: ["aprovado"], para: "rascunho" },
};

const ROTULO_STATUS: Record<StatusDoOrcamento, string> = {
  rascunho: "em rascunho",
  para_aprovar: "para aprovar",
  aprovado: "aprovado",
  enviado: "enviado",
};

export type ProblemaDaAcao = { codigo: "permission-denied" | "failed-precondition"; mensagem: string };

/**
 * Por que a pessoa não pode fazer a ação no orçamento como ele está, ou null.
 *
 * - owner, admin e comercial montam, enviam para aprovação e editam o
 *   aprovado (volta ao rascunho na mesma RV).
 * - Só o owner aprova; do rascunho, só o orçamento que ele mesmo montou.
 * - Devolve o aprovador (com nota) ou quem montou (puxa de volta).
 */
export function problemaDaAcao(
  acao: AcaoOrcamento,
  quem: { uid: string; role: PlatformRole },
  orcamento: { status: StatusDoOrcamento; autor_uid: string | null },
): ProblemaDaAcao | null {
  const semAcesso = comercialAccessProblem(quem.role);
  if (semAcesso) return { codigo: "permission-denied", mensagem: semAcesso };
  const aprovador = canApproveQuote(quem.role);
  const autor = orcamento.autor_uid !== null && orcamento.autor_uid === quem.uid;
  if (acao === "approve" && !aprovador) {
    return { codigo: "permission-denied", mensagem: "Só o aprovador (owner) aprova o orçamento." };
  }
  if (acao === "return" && !aprovador && !autor) {
    return { codigo: "permission-denied", mensagem: "Devolve o aprovador ou quem montou o orçamento." };
  }
  const transicao = TRANSICOES[acao];
  if (!transicao.de.includes(orcamento.status)) {
    return {
      codigo: "failed-precondition",
      mensagem: `O orçamento está ${ROTULO_STATUS[orcamento.status]}: esta ação vale com ele ${transicao.de.map((status) => ROTULO_STATUS[status]).join(" ou ")}.`,
    };
  }
  if (acao === "approve" && orcamento.status === "rascunho" && !autor) {
    return {
      codigo: "failed-precondition",
      mensagem: "Do rascunho, o owner só aprova o orçamento que ele mesmo montou; os outros chegam por \"Enviar para aprovação\".",
    };
  }
  return null;
}

/**
 * A ação já foi feita sobre o que a tela viu: o orçamento já está onde a ação
 * leva, com a mesma edição. Repetir só devolve o estado atual.
 */
export function acaoJaFeita(
  acao: AcaoOrcamento,
  atual: { status: StatusDoOrcamento; edicao: number; aprovacao: { edicao: number } | null },
  esperado: { status: StatusDoOrcamento; edicao: number },
): boolean {
  if (acao === "approve") {
    return atual.status === "aprovado" && atual.aprovacao?.edicao === esperado.edicao;
  }
  const transicao = TRANSICOES[acao];
  return transicao.de.includes(esperado.status) && atual.status === transicao.para && atual.edicao === esperado.edicao;
}

/** O que falta para enviar para aprovação (ou aprovar): cliente, Para, título e uma linha. */
export function pendenciasParaAprovar(
  demanda: { customer_code?: unknown; solicitante?: unknown; titulo?: unknown },
  orcamento: { linhas?: readonly unknown[] },
): string[] {
  const faltam: string[] = [];
  const solicitante = demanda.solicitante as { contato_id?: unknown } | null | undefined;
  if (!texto(demanda.customer_code)) faltam.push("cliente");
  if (!texto(solicitante?.contato_id)) faltam.push("Para");
  if (!texto(demanda.titulo)) faltam.push("título");
  if (!orcamento.linhas?.length) faltam.push("uma linha");
  return faltam;
}
