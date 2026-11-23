import { areaDePassagem, nomeComTamanho } from "@workspace/dominio";

import { belongsToCustomer } from "@/lib/active-customer";
import { boxNeedsRelabel, type WarehouseBox } from "@/lib/warehouse-boxes";

import type { LinhaDeEntrada } from "./caixas-da-separacao";
import {
  horaEmTexto,
  prateleirasDaContagem,
  resumoDaPrateleira,
  ruaDoCodigo,
  textoDaDiferenca,
  type NomeDoSku,
  type PosicaoDaContagem,
  type PrateleiraDaContagem,
  type SaldoLido,
} from "./contagem-por-caixa";

/**
 * A recontagem por caixa (diagnóstico da Contagem cíclica, seção 6, item 4;
 * pranchas docs/mockups/WmsContagemRodada, WmsContagemPrateleira e
 * WmsContagemCelular .dc.html, aprovadas em 17/11/2026): a bancada da
 * prateleira, caixa a caixa, e a rodada por prateleira. A conta do esperado
 * é a da folha (contagem-por-caixa.ts, pela regra do domínio, saldo-da-
 * caixa.ts), a mesma do servidor (functions/wms, domain/box-recount.ts), que
 * grava pela callable `recountWarehouseBox`. Funções puras, sem Firestore.
 *
 * A rodada, enquanto a coleção dela não existe (PR seguinte), é a da
 * recontagem geral, com um `round_id` fixo (decisão do Leonardo em
 * 17/11/2026, nas respostas ao PR 625): a recontagem leva vários dias, e o
 * progresso não volta a "por contar" na virada do dia; a caixa já recontada
 * nela, em qualquer dia, não cede peça ao item fora da lista de outra caixa
 * da prateleira (a regra do servidor).
 */

const numero = new Intl.NumberFormat("pt-BR");

/** O teto da contagem, o mesmo do servidor (functions/wms, cycle-count-input.ts). */
export const CONTAGEM_MAXIMA = 100_000;
/** Quantos itens fora da lista uma caixa aceita (box-recount.ts). */
export const FORA_DA_LISTA_MAXIMO = 20;

export const ROTA_DA_RODADA = "/estoque/contagem/rodada";
export const ROTA_DA_PRATELEIRA = "/estoque/contagem/prateleira";

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function chave(valor: unknown): string {
  return texto(valor).toUpperCase();
}

function quantidade(valor: unknown): number {
  const lido = Number(valor ?? 0);
  return Number.isFinite(lido) ? lido : 0;
}

function plural(quantos: number, singular: string, varios: string): string {
  return `${numero.format(quantos)} ${quantos === 1 ? singular : varios}`;
}

// ------------------------------------------------------------------ a rodada

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

/** O alcance da rodada (decisão de 17/11/2026): toda prateleira com caixa, as de uma rua ou as com caixa que tem o item. */
export type AlcanceDaRodada = { tipo: "geral" } | { tipo: "rua"; rua: string } | { tipo: "item"; sku: string; nome: string };

/** Quando e quem: o começo e o fim da rodada, ou uma recontagem. */
export type Momento = { quando: string; quem: string };

/**
 * Uma rodada de recontagem: o id que vai como `round_id`, o nome que a tela
 * mostra, o alcance e, no registro (`count_rounds`, rodadas-da-contagem.ts),
 * o começo e o fim.
 */
export type RodadaDaRecontagem = { id: string; titulo: string; alcance: AlcanceDaRodada; inicio: Momento | null; fim?: Momento | null };

/**
 * A recontagem geral das caixas da BTG, começada em 17/11/2026 antes do
 * registro da rodada, com o id fixo: enquanto o documento dela não existe,
 * as recontagens com esse id valem como a rodada aberta, e o começo é o da
 * primeira recontagem; "Concluir contagem" cria o documento (functions/wms,
 * count-rounds.ts).
 */
export const RODADA_DA_RECONTAGEM_GERAL: RodadaDaRecontagem = { id: "recontagem-geral-2026-11-17", titulo: "Recontagem geral · 17/11/2026", alcance: { tipo: "geral" }, inicio: null };

/**
 * A prateleira está no alcance da rodada: por rua, é da rua; por item, alguma
 * caixa dela (guardada, a caminho ou esvaziada nesta rodada) tem o item
 * (`sku_codes`), e a prateleira se conta inteira (decisão de 18/11/2026).
 * `caixas` pode ser a lista do cliente: a função separa as da prateleira.
 */
export function prateleiraNoAlcance(alcance: AlcanceDaRodada, posicao: string, rua: string, caixas: readonly WarehouseBox[], rodada: string): boolean {
  if (alcance.tipo === "geral") return true;
  if (alcance.tipo === "rua") return chave(rua) === chave(alcance.rua);
  const alvo = chave(posicao);
  const sku = chave(alcance.sku);
  return caixas.some(
    (caixa) => chave(caixa.location_id) === alvo && (caixa.status === "stored" || caixa.status === "committing" || esvaziadaNaRodada(caixa, rodada)) && caixa.sku_codes.some((code) => chave(code) === sku),
  );
}

/** "17/11", no horário de São Paulo; "" sem instante válido. */
export function dataCurta(instante: string | null | undefined): string {
  const data = new Date(String(instante ?? ""));
  return instante && !Number.isNaN(data.getTime()) ? DATA_CURTA.format(data) : "";
}

/** "09:11" no mesmo dia de `agora`, em São Paulo; "17/11 09:11" em outro dia; "—" sem instante válido. */
export function quandoEmTexto(instante: string, agora: Date): string {
  const data = new Date(instante);
  if (!instante || Number.isNaN(data.getTime())) return "—";
  const hora = horaEmTexto(instante);
  return DIA_EM_SAO_PAULO.format(data) === DIA_EM_SAO_PAULO.format(agora) ? hora : `${dataCurta(instante)} ${hora}`;
}

// ------------------------------------------------- a recontagem gravada

/** De onde veio a peça a mais (o fora da lista e a sobra), como a resposta e o `cycle_counts` dizem. */
export type OrigemDaPeca = { tipo: "solto"; qty: number } | { tipo: "caixa"; caixa: string; qty: number } | { tipo: "entrada"; qty: number };

/** As origens como o servidor grava (`origins`: `loose`, `box`, `entry`). */
export function origensLidas(valor: unknown): OrigemDaPeca[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((origem): OrigemDaPeca[] => {
    if (!origem || typeof origem !== "object") return [];
    const dado = origem as Record<string, unknown>;
    const qty = quantidade(dado.qty);
    if (qty <= 0) return [];
    if (dado.kind === "loose") return [{ tipo: "solto", qty }];
    if (dado.kind === "entry") return [{ tipo: "entrada", qty }];
    if (dado.kind === "box" && chave(dado.box_code)) return [{ tipo: "caixa", caixa: chave(dado.box_code), qty }];
    return [];
  });
}

/** "1 do saldo sem caixa", "2 de CX-000014" ou "entrada de 2 em A-03". */
export function textoDaOrigem(origem: OrigemDaPeca, posicao: string): string {
  if (origem.tipo === "solto") return `${numero.format(origem.qty)} do saldo sem caixa`;
  if (origem.tipo === "caixa") return `${numero.format(origem.qty)} de ${origem.caixa}`;
  return `entrada de ${numero.format(origem.qty)} em ${posicao}`;
}

/** Um item de uma recontagem: o esperado na caixa, o contado e, na peça a mais, de onde ela veio. */
export type ItemRecontado = {
  sku: string;
  codigo: string;
  nome: string;
  esperado: number;
  contado: number;
  diferenca: number;
  foraDaLista: boolean;
  origens: OrigemDaPeca[];
};

/** Uma caixa recontada: uma chamada de `recountWarehouseBox`. */
export type Recontagem = {
  id: string;
  caixa: string;
  posicao: string;
  rodada: string | null;
  /** O instante ISO da recontagem (a hora do servidor). */
  quando: string;
  quem: string;
  esperado: number;
  contado: number;
  diferenca: number;
  /** Contado zero em tudo: a caixa saiu da prateleira. */
  vazia: boolean;
  itens: ItemRecontado[];
};

/** Uma linha de `cycle_counts` gravada pela recontagem por caixa (`mode: "box"`). */
export type LinhaRecontada = ItemRecontado & {
  id: string;
  cliente: string;
  recontagem: string;
  caixa: string;
  posicao: string;
  rodada: string | null;
  quem: string;
  quando: string;
};

function nomeDoItem(sku: string, dado: { product_name?: unknown; client_item_code?: unknown; size?: unknown }, catalogo: ReadonlyMap<string, NomeDoSku>) {
  const doCatalogo = catalogo.get(sku);
  const nome = texto(dado.product_name) || doCatalogo?.nome || "";
  const codigo = texto(dado.client_item_code) || doCatalogo?.codigo || "";
  const tamanho = texto(dado.size) || doCatalogo?.tamanho || null;
  return { codigo, nome: nomeComTamanho({ nome, codigo, tamanho }) || sku };
}

/** A linha como o servidor grava (box-recount.ts); sem a recontagem, a caixa, a prateleira ou o SKU não serve. */
export function linhaRecontada(id: string, data: Record<string, unknown>, catalogo: ReadonlyMap<string, NomeDoSku> = new Map()): LinhaRecontada | null {
  const recontagem = texto(data.box_recount_id);
  const caixa = chave(data.box_code);
  const posicao = chave(data.location_id);
  const sku = chave(data.sku_code);
  if (!recontagem || !caixa || !posicao || !sku) return null;
  const actor = data.actor && typeof data.actor === "object" ? (data.actor as Record<string, unknown>) : {};
  const esperado = quantidade(data.qty_before);
  const contado = quantidade(data.counted_qty);
  return {
    id,
    cliente: texto(data.customer_code),
    recontagem,
    caixa,
    posicao,
    rodada: texto(data.round_id) || null,
    sku,
    ...nomeDoItem(sku, data, catalogo),
    esperado,
    contado,
    diferenca: data.adjustment_delta == null ? contado - esperado : quantidade(data.adjustment_delta),
    foraDaLista: data.out_of_list === true,
    origens: origensLidas(data.origins),
    quem: texto(actor.name) || texto(actor.email) || "—",
    quando: texto(data.occurred_at),
  };
}

function somaDe(itens: readonly ItemRecontado[]) {
  const esperado = itens.reduce((soma, item) => soma + item.esperado, 0);
  const contado = itens.reduce((soma, item) => soma + item.contado, 0);
  return { esperado, contado, diferenca: contado - esperado, vazia: contado === 0 };
}

/** Os itens da lista primeiro, na ordem em que vieram; os fora da lista depois. */
function emOrdem<T extends { foraDaLista: boolean }>(itens: readonly T[]): T[] {
  return [...itens.filter((item) => !item.foraDaLista), ...itens.filter((item) => item.foraDaLista)];
}

/** As recontagens das linhas do cliente, a mais recente primeiro: uma por chamada (`box_recount_id`). */
export function recontagensDasLinhas(linhas: readonly LinhaRecontada[], cliente: string | null | undefined): Recontagem[] {
  const dono = texto(cliente);
  const porRecontagem = new Map<string, LinhaRecontada[]>();
  for (const linha of linhas) {
    if (!dono || linha.cliente !== dono) continue;
    porRecontagem.set(linha.recontagem, [...(porRecontagem.get(linha.recontagem) ?? []), linha]);
  }
  return [...porRecontagem]
    .map(([id, doGrupo]): Recontagem => {
      const primeira = doGrupo[0]!;
      const itens = emOrdem(doGrupo).map(({ sku, codigo, nome, esperado, contado, diferenca, foraDaLista, origens }) => ({ sku, codigo, nome, esperado, contado, diferenca, foraDaLista, origens }));
      return {
        id,
        caixa: primeira.caixa,
        posicao: primeira.posicao,
        rodada: primeira.rodada,
        quando: doGrupo.reduce((maior, linha) => (linha.quando > maior ? linha.quando : maior), ""),
        quem: primeira.quem,
        ...somaDe(itens),
        itens,
      };
    })
    .sort((esquerda, direita) => direita.quando.localeCompare(esquerda.quando) || esquerda.id.localeCompare(direita.id));
}

/** A resposta de `recountWarehouseBox` (functions/wms, box-recount.ts), no que a tela usa. */
export type RespostaDaRecontagem = {
  ok?: boolean;
  box_recount_id: string;
  box_code: string;
  location_id: string;
  round_id?: string;
  status?: string;
  expected_units?: number;
  counted_units?: number;
  difference_units?: number;
  emptied?: boolean;
  lines?: Array<{
    sku_code: string;
    client_item_code?: string;
    product_name?: string;
    size?: string;
    out_of_list?: boolean;
    expected?: number;
    counted?: number;
    difference?: number;
    shelf_delta?: number;
    origins?: unknown;
  }>;
  /** A contagem anterior desta caixa: quem e quando. */
  previous_recount?: { recount_id?: string; at?: string; by_name?: string };
};

/** A resposta como uma recontagem, para a caixa confirmada aparecer antes da leitura voltar. */
export function recontagemDaResposta(
  resposta: RespostaDaRecontagem,
  { quem, quando, catalogo = new Map() }: { quem: string; quando: string; catalogo?: ReadonlyMap<string, NomeDoSku> },
): Recontagem {
  const itens = emOrdem(
    (resposta.lines ?? []).map((linha): ItemRecontado => {
      const sku = chave(linha.sku_code);
      const esperado = quantidade(linha.expected);
      const contado = quantidade(linha.counted);
      return {
        sku,
        ...nomeDoItem(sku, linha, catalogo),
        esperado,
        contado,
        diferenca: linha.difference == null ? contado - esperado : quantidade(linha.difference),
        foraDaLista: linha.out_of_list === true,
        origens: origensLidas(linha.origins),
      };
    }),
  );
  return {
    id: texto(resposta.box_recount_id),
    caixa: chave(resposta.box_code),
    posicao: chave(resposta.location_id),
    rodada: texto(resposta.round_id) || null,
    quando,
    quem,
    ...somaDe(itens),
    itens,
  };
}

/**
 * A recontagem da caixa contada vazia, pelo registro da caixa. A caixa
 * guardada sem nada na lista (o saldo zero em todos os itens: a que cede a
 * última peça ao fora da lista de outra, que fica guardada assim até alguém
 * contá-la vazia, decisão de 17/11/2026, ou a da abertura que perdeu as
 * linhas no "Remover para corrigir" ou no acerto) se reconta com a lista
 * vazia, e o servidor não grava linha em `cycle_counts`, porque não há item:
 * o registro fica na caixa, esvaziada com o id, quando e quem da recontagem
 * (functions/wms, box-recount.ts). Na rodada, ela vale a recontagem vazia,
 * sem diferença. Só a caixa que a rodada esvaziou e cuja última recontagem
 * não tem linha em `lidas`; a guardada de novo (o desfazer da separação a
 * devolve) espera outra contagem. A mesma regra do fechamento
 * (count-rounds.ts, linhasDasCaixasContadasVazias).
 */
export function recontagensDasCaixasContadasVazias(caixas: readonly WarehouseBox[], lidas: readonly Recontagem[], rodada: string): Recontagem[] {
  const comLinha = new Set(lidas.map((recontagem) => recontagem.id));
  return caixas.flatMap((caixa): Recontagem[] => {
    const id = texto(caixa.last_recount_id);
    const quando = texto(caixa.last_recounted_at);
    if (!esvaziadaNaRodada(caixa, rodada) || !id || !quando || comLinha.has(id)) return [];
    return [{ id, caixa: chave(caixa.code), posicao: chave(caixa.location_id), rodada, quando, quem: texto(caixa.last_recounted_by) || "—", esperado: 0, contado: 0, diferenca: 0, vazia: true, itens: [] }];
  });
}

/** A última recontagem de cada caixa. */
export function ultimaDeCadaCaixa(recontagens: readonly Recontagem[]): Map<string, Recontagem> {
  const ultima = new Map<string, Recontagem>();
  for (const recontagem of recontagens) {
    const atual = ultima.get(recontagem.caixa);
    if (!atual || recontagem.quando > atual.quando || (recontagem.quando === atual.quando && recontagem.id > atual.id)) ultima.set(recontagem.caixa, recontagem);
  }
  return ultima;
}

// ------------------------------------------------- o que a prateleira tem

/** Uma reserva da prateleira (`stock_reservations`), no que a bancada diz. */
export type ReservaLida = { sku_code?: unknown; location_id?: unknown; status?: unknown; order_number?: unknown; order_id?: unknown; customer_code?: unknown };

/** Uma tarefa de guarda (`putaway_tasks`), no que a recontagem confere. */
export type GuardaLida = {
  id?: unknown;
  status?: unknown;
  customer_code?: unknown;
  source_location_id?: unknown;
  destination_location_id?: unknown;
  receipt_number?: unknown;
  box_code?: unknown;
};

/** A guarda que ainda vai mexer na prateleira (area-putaway.ts e box-recount.ts). */
const GUARDA_ABERTA = new Set(["planned", "in_progress"]);

export function guardaAberta(guarda: GuardaLida): boolean {
  return GUARDA_ABERTA.has(texto(guarda.status).toLowerCase());
}

/** A guarda aberta chegando à prateleira ou saindo dela. */
export function guardaDaPrateleira(guarda: GuardaLida, posicao: string): boolean {
  const alvo = chave(posicao);
  return guardaAberta(guarda) && (chave(guarda.destination_location_id) === alvo || chave(guarda.source_location_id) === alvo);
}

/**
 * O que impede recontar a prateleira inteira, como o servidor recusa
 * (BOX_RECOUNT_PUTAWAY_OPEN): a caixa a caminho dela ou a guarda aberta
 * chegando ou saindo. Null quando nada impede.
 */
export function bloqueioDaPrateleira(posicao: string, caixas: readonly WarehouseBox[], guardas: readonly GuardaLida[]): string | null {
  const alvo = chave(posicao);
  const aCaminho = caixas.find((caixa) => caixa.status === "committing" && chave(caixa.location_id) === alvo);
  if (aCaminho) return `caixa a caminho · ${aCaminho.code}`;
  const guarda = guardas.find((candidata) => guardaDaPrateleira(candidata, alvo));
  if (!guarda) return null;
  const qual = texto(guarda.receipt_number) || chave(guarda.box_code);
  return qual ? `guarda aberta · ${qual}` : "guarda aberta";
}

/** Os pedidos de cada SKU da prateleira: os com reserva e os separados esperando a entrega (`picked`). */
function pedidosDaPrateleira(reservas: readonly ReservaLida[], posicao: string): Map<string, { reservados: string[]; separados: string[] }> {
  const alvo = chave(posicao);
  const porSku = new Map<string, { reservados: Set<string>; separados: Set<string> }>();
  for (const reserva of reservas) {
    if (chave(reserva.location_id) !== alvo) continue;
    const status = texto(reserva.status).toLowerCase();
    if (status !== "reserved" && status !== "picked") continue;
    const sku = chave(reserva.sku_code);
    const pedido = texto(reserva.order_number) || texto(reserva.order_id);
    if (!sku || !pedido) continue;
    const doSku = porSku.get(sku) ?? { reservados: new Set<string>(), separados: new Set<string>() };
    (status === "picked" ? doSku.separados : doSku.reservados).add(pedido);
    porSku.set(sku, doSku);
  }
  return new Map(
    [...porSku].map(([sku, pedidos]) => [
      sku,
      {
        reservados: [...pedidos.reservados].sort((esquerda, direita) => esquerda.localeCompare(direita, "pt-BR", { numeric: true })),
        separados: [...pedidos.separados].sort((esquerda, direita) => esquerda.localeCompare(direita, "pt-BR", { numeric: true })),
      },
    ]),
  );
}

// ------------------------------------------------------------- a bancada

/** Um item da lista da caixa: o que a pessoa conta. */
export type ItemParaContar = {
  sku: string;
  codigo: string;
  nome: string;
  /** O saldo da caixa (a entrada menos o retirado mais os ajustes): sempre maior que zero. */
  esperado: number;
  entrou: number;
  saiu: number;
  /** A reserva do SKU na prateleira. */
  reservado: number;
  /** Os pedidos com reserva do SKU na prateleira. */
  pedidos: string[];
  /** Os pedidos com o SKU separado esperando a entrega: o servidor recusa a caixa até a entrega. */
  separados: string[];
};

export type EstadoDaCaixa = "por_contar" | "confirmada" | "a_caminho" | "vazia";

export type CaixaDaBancada = {
  code: string;
  estado: EstadoDaCaixa;
  /** Quando a caixa foi guardada. */
  guardadaEm: string | null;
  /** O que a caixa tem, com o esperado maior que zero: a lista que o servidor confere. */
  itens: ItemParaContar[];
  esperado: number;
  /** A última recontagem da caixa nesta rodada. */
  recontagem: Recontagem | null;
  /** A última recontagem gravada na caixa, de qualquer rodada: a tela confere se outra pessoa contou no meio. */
  ultimaRecontagem: string | null;
  /**
   * A caixa aberta cuja etiqueta não é a do saldo de agora (`boxNeedsRelabel`,
   * "Etiquetas para trocar"): a recontagem com diferença deixa a caixa assim
   * até a etiqueta nova ser impressa e registrada.
   */
  etiquetaParaTrocar: boolean;
};

export type BancadaDaPrateleira = {
  posicao: string;
  rua: string;
  cadastrada: boolean;
  caixas: CaixaDaBancada[];
  /** Os produtos das caixas guardadas. */
  itens: number;
  /** A soma do saldo do razão na prateleira. */
  saldo: number;
  /** A soma do esperado das caixas guardadas. */
  nasCaixas: number;
  reservadas: number;
  /** A caixa a caminho ou a guarda aberta: a prateleira não se reconta até ela concluir. */
  bloqueio: string | null;
  /** As caixas da rodada: as guardadas e as que a rodada esvaziou. */
  total: number;
  confirmadas: number;
  esperadasConfirmadas: number;
  contadasConfirmadas: number;
  diferencaConfirmadas: number;
};

export type DadosDaBancada = {
  cliente: string | null | undefined;
  posicao: string;
  posicoes: readonly PosicaoDaContagem[];
  /** As caixas do cliente na prateleira, de qualquer status. */
  caixas: readonly WarehouseBox[];
  abertura: readonly LinhaDeEntrada[];
  /** Os saldos da prateleira. */
  saldos: readonly SaldoLido[];
  reservas: readonly ReservaLida[];
  guardas: readonly GuardaLida[];
  /** As recontagens da rodada. */
  recontagens: readonly Recontagem[];
  rodada: string;
  catalogo?: ReadonlyMap<string, NomeDoSku>;
};

/** A caixa que a recontagem desta rodada esvaziou: fora da prateleira, mas parte da rodada dela. */
function esvaziadaNaRodada(caixa: WarehouseBox, rodada: string): boolean {
  return caixa.status === "emptied" && Boolean(rodada) && caixa.last_recount_round_id === rodada;
}

/**
 * A bancada de uma prateleira: as caixas guardadas, cada uma com a lista do
 * que tem (o esperado maior que zero, como o servidor confere), a reserva e
 * os pedidos de cada item, e a recontagem desta rodada; a caixa a caminho; e
 * a caixa que a rodada esvaziou. Null sem o cliente ou sem a prateleira.
 */
export function bancadaDaPrateleira(dados: DadosDaBancada): BancadaDaPrateleira | null {
  const dono = texto(dados.cliente);
  const alvo = chave(dados.posicao);
  if (!dono || !alvo) return null;
  const daPrateleira = dados.caixas.filter((caixa) => belongsToCustomer(caixa, dono) && chave(caixa.location_id) === alvo);
  const prateleira: PrateleiraDaContagem | undefined = prateleirasDaContagem({
    cliente: dono,
    posicoes: dados.posicoes,
    caixas: daPrateleira,
    abertura: dados.abertura,
    saldos: dados.saldos.filter((saldo) => chave(saldo.location_id) === alvo),
    catalogo: dados.catalogo,
  }).find((candidata) => candidata.posicao === alvo);
  const vazias = daPrateleira.filter((caixa) => esvaziadaNaRodada(caixa, dados.rodada));
  if (!prateleira && !vazias.length) return null;

  const pedidos = pedidosDaPrateleira(dados.reservas, alvo);
  // A caixa contada vazia não tem linha: a recontagem dela vem do registro da caixa.
  const recontagens = [...dados.recontagens, ...recontagensDasCaixasContadasVazias(daPrateleira, dados.recontagens, dados.rodada)];
  const daRodada = ultimaDeCadaCaixa(recontagens.filter((recontagem) => recontagem.posicao === alvo));
  const porCodigo = new Map(daPrateleira.map((caixa) => [caixa.code, caixa]));

  const caixas: CaixaDaBancada[] = (prateleira?.caixas ?? []).map((caixa) => {
    const registro = porCodigo.get(caixa.code);
    const itens = caixa.linhas
      .filter((linha) => linha.esperado > 0)
      .map((linha): ItemParaContar => ({
        sku: linha.sku,
        codigo: linha.codigo,
        nome: linha.nome,
        esperado: linha.esperado,
        entrou: linha.entrou ?? 0,
        saiu: linha.saiu ?? 0,
        reservado: linha.reserva,
        pedidos: pedidos.get(linha.sku)?.reservados ?? [],
        separados: pedidos.get(linha.sku)?.separados ?? [],
      }));
    const recontagem = caixa.aCaminho ? null : (daRodada.get(caixa.code) ?? null);
    return {
      code: caixa.code,
      estado: caixa.aCaminho ? "a_caminho" : recontagem ? "confirmada" : "por_contar",
      guardadaEm: registro?.stored_at ?? null,
      itens,
      esperado: itens.reduce((soma, item) => soma + item.esperado, 0),
      recontagem,
      ultimaRecontagem: registro?.last_recount_id ?? null,
      etiquetaParaTrocar: !caixa.aCaminho && Boolean(registro && boxNeedsRelabel(registro)),
    };
  });
  for (const caixa of vazias) {
    caixas.push({
      code: caixa.code,
      estado: "vazia",
      guardadaEm: caixa.stored_at,
      itens: [],
      esperado: 0,
      recontagem: daRodada.get(caixa.code) ?? null,
      ultimaRecontagem: caixa.last_recount_id ?? null,
      // A caixa vazia sai da prateleira: não leva etiqueta.
      etiquetaParaTrocar: false,
    });
  }
  caixas.sort((esquerda, direita) => esquerda.code.localeCompare(direita.code, "pt-BR", { numeric: true }));

  return {
    posicao: alvo,
    rua: prateleira?.rua ?? "",
    cadastrada: prateleira?.cadastrada ?? false,
    caixas,
    // Os produtos que as caixas guardadas têm (o esperado maior que zero), não os que só passaram por elas.
    itens: new Set(caixas.filter((caixa) => caixa.estado !== "a_caminho").flatMap((caixa) => caixa.itens.map((item) => item.sku))).size,
    saldo: prateleira?.saldo ?? 0,
    nasCaixas: prateleira?.unidades ?? 0,
    reservadas: dados.saldos.filter((saldo) => chave(saldo.location_id) === alvo).reduce((soma, saldo) => soma + Math.max(0, quantidade(saldo.qty_reserved)), 0),
    bloqueio: bloqueioDaPrateleira(alvo, daPrateleira, dados.guardas),
    ...totaisDasCaixas(caixas),
  };
}

/** O progresso da rodada na prateleira: as caixas (menos a a caminho), as confirmadas e o que elas somam. */
function totaisDasCaixas(caixas: readonly CaixaDaBancada[]) {
  const daRodada = caixas.filter((caixa) => caixa.estado !== "a_caminho");
  const confirmadas = daRodada.filter((caixa) => caixa.recontagem);
  return {
    total: daRodada.length,
    confirmadas: confirmadas.length,
    esperadasConfirmadas: confirmadas.reduce((soma, caixa) => soma + (caixa.recontagem?.esperado ?? 0), 0),
    contadasConfirmadas: confirmadas.reduce((soma, caixa) => soma + (caixa.recontagem?.contado ?? 0), 0),
    diferencaConfirmadas: confirmadas.reduce((soma, caixa) => soma + (caixa.recontagem?.diferenca ?? 0), 0),
  };
}

/**
 * A bancada com as recontagens que esta tela acabou de gravar e a leitura
 * ao vivo ainda não trouxe (a resposta da callable): a caixa sai confirmada
 * na hora, com a origem da peça a mais. A recontagem que a leitura já trouxe
 * (o mesmo id) não entra de novo.
 */
export function comRecontagensLocais(bancada: BancadaDaPrateleira | null, locais: readonly Recontagem[], gravadas: ReadonlySet<string>): BancadaDaPrateleira | null {
  if (!bancada) return bancada;
  const pendentes = new Map(locais.filter((local) => !gravadas.has(local.id) && local.posicao === bancada.posicao).map((local) => [local.caixa, local]));
  if (!pendentes.size) return bancada;
  const caixas = bancada.caixas.map((caixa): CaixaDaBancada => {
    const local = pendentes.get(caixa.code);
    if (!local || caixa.estado === "a_caminho") return caixa;
    // A recontagem com diferença muda o saldo da caixa (o servidor grava o `balance_at`): a etiqueta fica para trocar.
    return local.vazia
      ? { ...caixa, estado: "vazia", itens: [], esperado: 0, recontagem: local, ultimaRecontagem: local.id, etiquetaParaTrocar: false }
      : { ...caixa, estado: "confirmada", recontagem: local, ultimaRecontagem: local.id, etiquetaParaTrocar: caixa.etiquetaParaTrocar || temDiferenca(local) };
  });
  return { ...bancada, caixas, ...totaisDasCaixas(caixas) };
}

/** A próxima caixa por contar depois de uma (e, sem ela, a primeira): a que abre depois de confirmar. */
export function proximaPorContar(bancada: Pick<BancadaDaPrateleira, "caixas">, depoisDe: string): string | null {
  const livre = (caixa: CaixaDaBancada) => caixa.estado === "por_contar" && caixa.code !== depoisDe && !separadosDaCaixa(caixa).length;
  const indice = bancada.caixas.findIndex((caixa) => caixa.code === depoisDe);
  return (bancada.caixas.slice(indice + 1).find(livre) ?? bancada.caixas.find(livre))?.code ?? null;
}

/** Os pedidos separados esperando a entrega nos itens da caixa: o servidor recusa recontá-la até a entrega. */
/**
 * A caixa confirmada com diferença cuja etiqueta ainda não foi trocada: ganha
 * "Imprimir etiqueta" (decisão do Leonardo em 18/11/2026). A confirmada sem
 * diferença e a esvaziada não.
 */
export function pedeEtiquetaNova(caixa: Pick<CaixaDaBancada, "estado" | "recontagem" | "etiquetaParaTrocar">): boolean {
  return caixa.estado === "confirmada" && Boolean(caixa.recontagem && temDiferenca(caixa.recontagem)) && caixa.etiquetaParaTrocar;
}

/** As caixas da prateleira que pedem etiqueta nova, por código: "Etiquetas para trocar" no topo da bancada. */
export function caixasComEtiquetaNova(bancada: Pick<BancadaDaPrateleira, "caixas">): string[] {
  return bancada.caixas.filter(pedeEtiquetaNova).map((caixa) => caixa.code);
}

export function separadosDaCaixa(caixa: Pick<CaixaDaBancada, "itens">): string[] {
  return [...new Set(caixa.itens.flatMap((item) => item.separados))];
}

// ------------------------------------------------------------- os textos

/** "Rua A · 7 caixas · 5 itens"; sem rua, só as caixas e os itens. */
export function resumoDaBancada(bancada: Pick<BancadaDaPrateleira, "rua" | "total" | "itens">): string {
  return [bancada.rua ? `Rua ${bancada.rua}` : "", plural(bancada.total, "caixa", "caixas"), plural(bancada.itens, "item", "itens")].filter(Boolean).join(" · ");
}

/** "2 de 7 caixas" (o resto da frase, "confirmadas", vem do lado). */
export function textoDoProgresso(bancada: Pick<BancadaDaPrateleira, "confirmadas" | "total">): string {
  return `${numero.format(bancada.confirmadas)} de ${plural(bancada.total, "caixa", "caixas")}`;
}

/** "−5 un.", "+2 un." ou "0 un." */
export function unidadesComSinal(diferenca: number): string {
  return `${textoDaDiferenca(diferenca)} un.`;
}

/**
 * A caixa fechada numa linha: o nome do único item, ou quantos itens ela
 * tem. A confirmada diz o que foi contado nela, como o selo.
 */
export function tituloDaCaixa(caixa: Pick<CaixaDaBancada, "itens" | "recontagem" | "estado">): string {
  const contados = caixa.recontagem?.itens.filter((item) => item.esperado > 0 || item.contado > 0).map((item) => item.nome) ?? [];
  const itens = caixa.recontagem && contados.length ? contados : caixa.itens.length ? caixa.itens.map((item) => item.nome) : (caixa.recontagem?.itens.map((item) => item.nome) ?? []);
  if (itens.length === 1) return itens[0]!;
  if (itens.length > 1) return plural(itens.length, "item", "itens");
  return "sem itens";
}

/** "20 reservadas · PED-0002" de todos os itens da caixa; "" sem reserva. */
export function textoDaReserva(itens: readonly Pick<ItemParaContar, "reservado" | "pedidos" | "separados">[]): string {
  const reservado = itens.reduce((soma, item) => soma + item.reservado, 0);
  if (reservado <= 0) return "";
  const pedidos = [...new Set(itens.flatMap((item) => [...item.pedidos, ...item.separados]))];
  return [plural(reservado, "reservada", "reservadas"), ...pedidos].join(" · ");
}

/** "60 esperadas · 20 reservadas · PED-0002": a linha da caixa fechada. */
export function textoDaCaixaFechada(caixa: CaixaDaBancada): string {
  const esperado = caixa.recontagem ? caixa.recontagem.esperado : caixa.esperado;
  return [plural(esperado, "esperada", "esperadas"), textoDaReserva(caixa.itens)].filter(Boolean).join(" · ");
}

/**
 * A recontagem mudou algum item da caixa: a diferença de um item, mesmo que
 * outro a compense no total (M −2 e GG +2 somam zero, e a etiqueta da caixa
 * fica velha do mesmo jeito).
 */
export function temDiferenca(recontagem: Pick<Recontagem, "diferenca" | "itens">): boolean {
  return recontagem.diferenca !== 0 || recontagem.itens.some((item) => item.diferenca !== 0);
}

/**
 * "confirmada 09:11 · 55 · −5", "confirmada 09:02 · 60 · sem diferença" ou,
 * na caixa esvaziada, "confirmada 09:15 · vazia · −60"; com itens trocados
 * que somam zero, "com diferença"; em outro dia que não o de `agora`, com o
 * dia: "confirmada 17/11 09:11 · 55 · −5".
 */
export function seloDaRecontagem(recontagem: Pick<Recontagem, "quando" | "contado" | "diferenca" | "vazia" | "itens">, agora: Date): string {
  const quanto = recontagem.vazia ? "vazia" : numero.format(recontagem.contado);
  const diferenca = !temDiferenca(recontagem) ? "sem diferença" : recontagem.diferenca === 0 ? "com diferença" : textoDaDiferenca(recontagem.diferenca);
  return `confirmada ${quandoEmTexto(recontagem.quando, agora)} · ${quanto} · ${diferenca}`;
}

/** Os itens que mudaram na recontagem: a diferença e, na peça a mais, de onde ela veio. */
export function itensComDiferenca(recontagem: Pick<Recontagem, "itens" | "posicao">): Array<{ sku: string; nome: string; texto: string; diferenca: number }> {
  return recontagem.itens
    .filter((item) => item.diferenca !== 0 || item.foraDaLista)
    .map((item) => ({
      sku: item.sku,
      nome: item.nome,
      diferenca: item.diferenca,
      texto: [textoDaDiferenca(item.diferenca), item.foraDaLista ? "fora da lista" : "", ...item.origens.map((origem) => textoDaOrigem(origem, recontagem.posicao))].filter(Boolean).join(" · "),
    }));
}

/** "entrou 60 · saiu 0": a conta do esperado de um item. */
export function textoDaConta(item: Pick<ItemParaContar, "entrou" | "saiu">): string {
  return `entrou ${numero.format(item.entrou)} · saiu ${numero.format(item.saiu)}`;
}

/** "saldo da prateleira 445 · caixas 445 · reservadas 20": a prateleira no rodapé da bancada. */
export function textoDaPrateleiraNaBancada(bancada: Pick<BancadaDaPrateleira, "saldo" | "nasCaixas" | "reservadas">): string {
  return [`saldo da prateleira ${numero.format(bancada.saldo)}`, `caixas ${numero.format(bancada.nasCaixas)}`, bancada.reservadas ? `reservadas ${numero.format(bancada.reservadas)}` : ""]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------- o que se digita

/** O texto do campo com só os algarismos (o leitor e o teclado numérico do celular mandam outras coisas). */
export function soAlgarismos(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 6);
}

/** A quantidade digitada, ou null com o campo vazio. */
export function quantidadeDigitada(valor: string | undefined): number | null {
  const limpo = soAlgarismos(valor ?? "");
  return limpo ? Number(limpo) : null;
}

/** O que está errado na quantidade digitada; null quando ela serve (ou o campo está vazio). */
export function problemaDaQuantidade(valor: string | undefined, foraDaLista: boolean): string | null {
  const qty = quantidadeDigitada(valor);
  if (qty === null) return null;
  if (qty > CONTAGEM_MAXIMA) return `Até ${numero.format(CONTAGEM_MAXIMA)} un.`;
  if (foraDaLista && qty < 1) return "1 un. ou mais";
  return null;
}

/** Um item fora da lista que a pessoa acrescentou à caixa. */
export type ItemForaDaLista = { sku: string; codigo: string; nome: string; contado: string };

/** O que a pessoa digitou na caixa em contagem. */
export type ContagemDigitada = {
  /** O contado de cada item da lista, por SKU, como está no campo. */
  contados: Readonly<Record<string, string>>;
  foraDaLista: readonly ItemForaDaLista[];
};

/** A entrada de `recountWarehouseBox` (functions/wms, box-recount.ts), sem campo vazio. */
export type EntradaDaRecontagem = {
  customer_code: string;
  box_code: string;
  location_id: string;
  lines: Array<{ sku_code: string; counted_qty: number }>;
  extra_lines?: Array<{ sku_code: string; counted_qty: number }>;
  round_id: string;
};

/** A diferença de um item enquanto a pessoa digita; null com o campo vazio. */
export function diferencaDigitada(esperado: number, valor: string | undefined): number | null {
  const contado = quantidadeDigitada(valor);
  return contado === null ? null : contado - esperado;
}

/**
 * Tudo contado e nada fora da regra: a caixa pode ser confirmada. A caixa
 * sem nada na lista e sem item fora da lista se confirma vazia.
 */
export function contagemCompleta(caixa: Pick<CaixaDaBancada, "itens">, digitado: ContagemDigitada): boolean {
  const lista = caixa.itens.every((item) => quantidadeDigitada(digitado.contados[item.sku]) !== null && !problemaDaQuantidade(digitado.contados[item.sku], false));
  const fora = digitado.foraDaLista.every((item) => quantidadeDigitada(item.contado) !== null && !problemaDaQuantidade(item.contado, true));
  return lista && fora && digitado.foraDaLista.length <= FORA_DA_LISTA_MAXIMO;
}

/** Tudo contado em zero, sem item fora da lista: confirmar esvazia a caixa. */
export function contagemVazia(caixa: Pick<CaixaDaBancada, "itens">, digitado: ContagemDigitada): boolean {
  return !digitado.foraDaLista.length && caixa.itens.every((item) => quantidadeDigitada(digitado.contados[item.sku]) === 0);
}

/** "Caixa vazia": todos os itens em zero e nenhum fora da lista. */
export function contagemDaCaixaVazia(caixa: Pick<CaixaDaBancada, "itens">): ContagemDigitada {
  return { contados: Object.fromEntries(caixa.itens.map((item) => [item.sku, "0"])), foraDaLista: [] };
}

/** A contagem vazia do começo: os campos em branco. */
export const CONTAGEM_EM_BRANCO: ContagemDigitada = { contados: {}, foraDaLista: [] };

/**
 * A entrada da callable para a caixa: todos os itens da lista, com o
 * contado, e os fora da lista, sem campo vazio (o SDK do Firebase troca o
 * `undefined` por `null`, e o servidor recusa). Null se faltar contar algo.
 */
export function entradaDaRecontagem(
  { cliente, posicao, rodada }: { cliente: string; posicao: string; rodada: string },
  caixa: Pick<CaixaDaBancada, "code" | "itens">,
  digitado: ContagemDigitada,
): EntradaDaRecontagem | null {
  if (!contagemCompleta(caixa, digitado)) return null;
  const lines = caixa.itens.map((item) => ({ sku_code: item.sku, counted_qty: quantidadeDigitada(digitado.contados[item.sku]) ?? 0 }));
  const extra = digitado.foraDaLista.map((item) => ({ sku_code: item.sku, counted_qty: quantidadeDigitada(item.contado) ?? 0 }));
  return {
    customer_code: cliente,
    box_code: caixa.code,
    location_id: chave(posicao),
    lines,
    ...(extra.length ? { extra_lines: extra } : {}),
    round_id: rodada,
  };
}

// ------------------------------------------------------- o item fora da lista

/** Um produto do catálogo do cliente, para o item fora da lista. */
export type ProdutoDoCatalogo = { sku: string; codigo: string; nome: string; barras: string };

/** Os produtos do cliente nas linhas de `/api/skus` (o arquivado também: o servidor o reativa). */
export function produtosDoCliente(rows: ReadonlyArray<Record<string, unknown>>, cliente: string | null | undefined): ProdutoDoCatalogo[] {
  const dono = texto(cliente);
  if (!dono) return [];
  const vistos = new Set<string>();
  const produtos: ProdutoDoCatalogo[] = [];
  for (const row of rows) {
    if (!belongsToCustomer(row as { customer_code?: unknown }, dono)) continue;
    const sku = chave(row.cod_btg) || chave(row.sku_code) || chave(row.id);
    if (!sku || vistos.has(sku)) continue;
    vistos.add(sku);
    const codigo = texto(row.cod_cliente) || texto(row.client_item_code);
    const nome = nomeComTamanho({ nome: texto(row.produto) || texto(row.product_name) || texto(row.nome), codigo, tamanho: texto(row.tamanho) || texto(row.size) || null }) || sku;
    produtos.push({ sku, codigo, nome, barras: texto(row.barcode) || texto(row.codigo_barras) || texto(row.ean) });
  }
  return produtos.sort((esquerda, direita) => esquerda.nome.localeCompare(direita.nome, "pt-BR", { numeric: true }) || esquerda.sku.localeCompare(direita.sku));
}

function semAcento(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/**
 * A busca do item fora da lista: pelo código do cliente, pelo SKU, pelo
 * código de barras ou pelas palavras do nome. O código igual vem primeiro.
 * Os SKUs de `fora` (a lista da caixa e o que já entrou) não aparecem.
 */
export function buscarProdutos(produtos: readonly ProdutoDoCatalogo[], termo: string, fora: ReadonlySet<string>, limite = 8): ProdutoDoCatalogo[] {
  const busca = semAcento(termo.trim());
  if (!busca) return [];
  const palavras = busca.split(/\s+/).filter(Boolean);
  const achados = produtos.filter((produto) => {
    if (fora.has(produto.sku)) return false;
    const codigos = [produto.sku, semAcento(produto.codigo), produto.barras].filter(Boolean);
    if (codigos.some((codigo) => codigo.includes(busca))) return true;
    const nome = semAcento(produto.nome);
    return palavras.every((palavra) => nome.includes(palavra));
  });
  const exato = (produto: ProdutoDoCatalogo) => [produto.sku, semAcento(produto.codigo), produto.barras].includes(busca);
  return [...achados.filter(exato), ...achados.filter((produto) => !exato(produto))].slice(0, limite);
}

// ------------------------------------------------------------- a rodada

export type EstadoDaPrateleiraNaRodada = "por_contar" | "em_contagem" | "contada" | "contada_antes";

export type PrateleiraDaRodada = {
  posicao: string;
  rua: string;
  /** "3 caixas · 2 itens · 11 un." */
  resumo: string;
  estado: EstadoDaPrateleiraNaRodada;
  total: number;
  confirmadas: number;
  /** A recontagem mais recente da prateleira nesta rodada. */
  ultima: Pick<Recontagem, "quando" | "quem"> | null;
  /** As caixas com diferença e a diferença líquida, nesta rodada. */
  comDiferenca: number;
  diferenca: number;
  /** As caixas que a rodada esvaziou. */
  vazias: number;
  /** Na prateleira já recontada em outra rodada: o dia da recontagem mais recente. */
  contadaEm: string | null;
  /** A guarda aberta, a caixa a caminho ou o pedido separado esperando a entrega. */
  bloqueio: string | null;
};

export type RuaDaRodada = { rua: string; prateleiras: PrateleiraDaRodada[] };

export type RodadaDaContagem = {
  /** O id da rodada (o `round_id`). */
  rodada: string;
  /** "Recontagem geral · 17/11/2026" */
  titulo: string;
  /** A primeira recontagem da rodada: quando e quem. */
  comeco: Pick<Recontagem, "quando" | "quem"> | null;
  prateleiras: number;
  prateleirasContadas: number;
  caixas: number;
  caixasConfirmadas: number;
  caixasComDiferenca: number;
  diferenca: number;
  ruas: RuaDaRodada[];
  /** A prateleira em contagem mais recente, ou a primeira por contar. */
  continuar: string | null;
  /** O alcance da rodada. */
  alcance: AlcanceDaRodada;
  /** A rodada concluída: quando e quem (o registro). */
  concluida: Momento | null;
};

export type DadosDaRodada = {
  cliente: string | null | undefined;
  /** As prateleiras da contagem do cliente (contagem-por-caixa.ts). */
  prateleiras: readonly PrateleiraDaContagem[];
  /** As caixas do cliente, de qualquer status. */
  caixas: readonly WarehouseBox[];
  recontagens: readonly Recontagem[];
  guardas: readonly GuardaLida[];
  reservas: readonly ReservaLida[];
  rodada: RodadaDaRecontagem;
  agora: Date;
};

/** O pedido separado esperando a entrega numa prateleira: "em separação · PED-0002". */
function separacaoDaPrateleira(reservas: readonly ReservaLida[], posicao: string): string | null {
  const separados = new Set<string>();
  for (const pedidos of pedidosDaPrateleira(reservas, posicao).values()) for (const pedido of pedidos.separados) separados.add(pedido);
  if (!separados.size) return null;
  return `em separação · ${[...separados].sort((esquerda, direita) => esquerda.localeCompare(direita, "pt-BR", { numeric: true })).join(", ")}`;
}

/** O instante em milissegundos; NaN sem instante válido. */
function instanteDe(valor: string | null | undefined): number {
  return valor ? new Date(valor).getTime() : Number.NaN;
}

/**
 * As caixas da rodada concluída como estavam no fechamento (o "Ver" das
 * anteriores; achado de 19/11/2026: depois da recontagem geral, o Mover levou
 * caixas recontadas para outras prateleiras, e o "Ver" as mostrava sem
 * recontagem onde estão hoje). A caixa recontada na rodada fica na prateleira
 * da última recontagem dela; a que a rodada não recontou, onde estava no
 * fechamento: a de hoje ou, movida depois dele, a de onde o último mover a
 * tirou (`moved_from_location_id`). Entram a caixa guardada no fechamento
 * (guardada antes dele e, se vazia hoje, esvaziada depois) e a que a rodada
 * esvaziou; a guardada depois do fechamento e a esvaziada antes dele, não.
 */
function caixasNoFechamento(caixas: readonly WarehouseBox[], ultimas: ReadonlyMap<string, Recontagem>, rodada: string, fechamento: string): WarehouseBox[] {
  const fim = instanteDe(fechamento);
  const depois = (instante: string | null | undefined) => instanteDe(instante) > fim;
  return caixas.flatMap((caixa): WarehouseBox[] => {
    const recontagem = ultimas.get(caixa.code);
    const vaziaNoFechamento = caixa.status === "emptied" && !depois(caixa.emptied_at);
    if (recontagem) {
      return [{ ...caixa, location_id: recontagem.posicao, status: vaziaNoFechamento ? "emptied" : "stored", ...(vaziaNoFechamento ? { last_recount_round_id: rodada } : {}) }];
    }
    if (vaziaNoFechamento) return esvaziadaNaRodada(caixa, rodada) ? [caixa] : [];
    if ((caixa.status !== "stored" && caixa.status !== "emptied") || depois(caixa.stored_at)) return [];
    return [
      {
        ...caixa,
        status: "stored",
        location_id: depois(caixa.moved_at) ? caixa.moved_from_location_id || caixa.location_id : caixa.location_id,
        // A recontagem de outra rodada, depois do fechamento, não é a "contada antes" desta.
        last_recounted_at: depois(caixa.last_recounted_at) ? null : caixa.last_recounted_at,
      },
    ];
  });
}

/** O que a linha da rodada usa da prateleira: onde fica, a rua e, para o resumo, o que ela tem. */
type ConteudoDaPrateleira = Pick<PrateleiraDaContagem, "posicao" | "rua" | "guardadas" | "aCaminho" | "itens" | "unidades">;

/**
 * As prateleiras da rodada concluída, das caixas como estavam no fechamento
 * (caixasNoFechamento: as guardadas e as que a rodada esvaziou, por
 * prateleira), na ordem de caminhada de hoje; a que a folha de hoje não tem
 * vem depois, em ordem. O que cada caixa guardada tem é o da folha de hoje, a
 * mesma conta da rodada aberta; a que não está mais guardada leva o que a
 * rodada contou nela, e a não recontada, nada.
 */
function prateleirasNoFechamento(
  guardadasPorLocal: ReadonlyMap<string, readonly WarehouseBox[]>,
  vaziasPorLocal: ReadonlyMap<string, readonly WarehouseBox[]>,
  hoje: readonly PrateleiraDaContagem[],
  ultimas: ReadonlyMap<string, Recontagem>,
): ConteudoDaPrateleira[] {
  const daFolha = new Map(hoje.flatMap((prateleira) => prateleira.caixas.filter((caixa) => !caixa.aCaminho).map((caixa) => [caixa.code, caixa] as const)));
  const ruas = new Map(hoje.map((prateleira) => [prateleira.posicao, prateleira.rua] as const));
  const comCaixa = new Set([...guardadasPorLocal.keys(), ...vaziasPorLocal.keys()].filter(Boolean));
  const foraDaFolha = [...comCaixa].filter((local) => !ruas.has(local)).sort((esquerda, direita) => esquerda.localeCompare(direita, "pt-BR", { numeric: true }));
  return [...hoje.map((prateleira) => prateleira.posicao).filter((local) => comCaixa.has(local)), ...foraDaFolha].map((local) => {
    const guardadas = guardadasPorLocal.get(local) ?? [];
    const itens = new Set<string>();
    let unidades = 0;
    for (const caixa of guardadas) {
      const conteudo = daFolha.get(caixa.code);
      if (conteudo) {
        for (const linha of conteudo.linhas) itens.add(linha.sku);
        unidades += conteudo.esperado;
        continue;
      }
      const recontagem = ultimas.get(caixa.code);
      for (const item of recontagem?.itens ?? []) if (item.contado > 0) itens.add(item.sku);
      unidades += recontagem?.contado ?? 0;
    }
    return { posicao: local, rua: ruas.get(local) ?? ruaDoCodigo(local), guardadas: guardadas.length, aCaminho: 0, itens: itens.size, unidades };
  });
}

/**
 * A rodada por prateleira: as prateleiras com caixa, por rua, na ordem de
 * caminhada, cada uma com o estado nesta rodada (por contar, em contagem,
 * contada) e o que impede recontá-la; e os números da rodada. A rodada
 * aberta usa as caixas como estão hoje, porque a bancada grava nela; a
 * concluída (o "Ver" das anteriores), como estavam no fechamento, sem o que
 * impede recontar hoje.
 */
export function rodadaDaContagem(dados: DadosDaRodada): RodadaDaContagem {
  const dono = texto(dados.cliente);
  const doCliente = dados.caixas.filter((caixa) => Boolean(dono) && belongsToCustomer(caixa, dono));
  const lidas = dados.recontagens.filter((recontagem) => recontagem.rodada === dados.rodada.id);
  // A caixa contada vazia não tem linha: a recontagem dela vem do registro da caixa.
  const recontagens = [...lidas, ...recontagensDasCaixasContadasVazias(doCliente, lidas, dados.rodada.id)];
  const ultimas = ultimaDeCadaCaixa(recontagens);
  const fechamento = dados.rodada.fim?.quando ?? null;
  const caixas = fechamento ? caixasNoFechamento(doCliente, ultimas, dados.rodada.id, fechamento) : doCliente;
  const vaziasPorLocal = new Map<string, WarehouseBox[]>();
  for (const caixa of caixas) {
    if (!esvaziadaNaRodada(caixa, dados.rodada.id)) continue;
    const local = chave(caixa.location_id);
    vaziasPorLocal.set(local, [...(vaziasPorLocal.get(local) ?? []), caixa]);
  }
  const guardadasPorLocal = new Map<string, WarehouseBox[]>();
  for (const caixa of caixas) {
    if (caixa.status !== "stored") continue;
    const local = chave(caixa.location_id);
    guardadasPorLocal.set(local, [...(guardadasPorLocal.get(local) ?? []), caixa]);
  }
  const prateleirasDaRodada: readonly ConteudoDaPrateleira[] = fechamento ? prateleirasNoFechamento(guardadasPorLocal, vaziasPorLocal, dados.prateleiras, ultimas) : dados.prateleiras;

  const linhas: PrateleiraDaRodada[] = [];
  for (const prateleira of prateleirasDaRodada) {
    const vazias = vaziasPorLocal.get(prateleira.posicao) ?? [];
    if (!prateleira.guardadas && !prateleira.aCaminho && !vazias.length) continue;
    if (!prateleiraNoAlcance(dados.rodada.alcance, prateleira.posicao, prateleira.rua, caixas, dados.rodada.id)) continue;
    const guardadas = guardadasPorLocal.get(prateleira.posicao) ?? [];
    const daRodada = [...guardadas, ...vazias];
    const confirmadas = daRodada.flatMap((caixa) => {
      const recontagem = ultimas.get(caixa.code);
      return recontagem && recontagem.posicao === prateleira.posicao ? [recontagem] : [];
    });
    const total = daRodada.length;
    const ultima = confirmadas.reduce<Recontagem | null>((maior, recontagem) => (!maior || recontagem.quando > maior.quando ? recontagem : maior), null);
    const antes = guardadas.length && guardadas.every((caixa) => caixa.last_recounted_at) ? guardadas.reduce((maior, caixa) => ((caixa.last_recounted_at ?? "") > maior ? (caixa.last_recounted_at ?? "") : maior), "") : "";
    const estado: EstadoDaPrateleiraNaRodada = confirmadas.length && confirmadas.length >= total ? "contada" : confirmadas.length ? "em_contagem" : antes ? "contada_antes" : "por_contar";
    linhas.push({
      posicao: prateleira.posicao,
      rua: prateleira.rua,
      resumo: vazias.length && !prateleira.guardadas ? `${plural(vazias.length, "caixa vazia", "caixas vazias")} · 0 un.` : resumoDaPrateleira(prateleira),
      estado,
      total,
      confirmadas: confirmadas.length,
      ultima: ultima ? { quando: ultima.quando, quem: ultima.quem } : null,
      comDiferenca: confirmadas.filter(temDiferenca).length,
      diferenca: confirmadas.reduce((soma, recontagem) => soma + recontagem.diferenca, 0),
      vazias: vazias.length,
      contadaEm: estado === "contada_antes" ? dataCurta(antes) : null,
      // A rodada concluída não se reconta: o que impede recontar hoje não é dela.
      bloqueio: fechamento ? null : (bloqueioDaPrateleira(prateleira.posicao, doCliente, dados.guardas) ?? separacaoDaPrateleira(dados.reservas, prateleira.posicao)),
    });
  }

  const ruas: RuaDaRodada[] = [];
  for (const linha of linhas) {
    const rua = ruas.find((candidata) => candidata.rua === linha.rua);
    if (rua) rua.prateleiras.push(linha);
    else ruas.push({ rua: linha.rua, prateleiras: [linha] });
  }
  const emContagem = linhas.filter((linha) => linha.estado === "em_contagem").sort((esquerda, direita) => (direita.ultima?.quando ?? "").localeCompare(esquerda.ultima?.quando ?? ""));
  const porContar = linhas.find((linha) => linha.estado === "por_contar" && !linha.bloqueio) ?? linhas.find((linha) => linha.estado === "por_contar");
  const comeco = recontagens.reduce<Recontagem | null>((menor, recontagem) => (!menor || recontagem.quando < menor.quando ? recontagem : menor), null);
  const confirmadas = linhas.reduce((soma, linha) => soma + linha.confirmadas, 0);
  return {
    rodada: dados.rodada.id,
    titulo: dados.rodada.titulo,
    // O começo é o do registro da rodada; a recontagem geral sem documento fica com o da primeira recontagem.
    comeco: dados.rodada.inicio ?? (comeco ? { quando: comeco.quando, quem: comeco.quem } : null),
    prateleiras: linhas.length,
    prateleirasContadas: linhas.filter((linha) => linha.estado === "contada").length,
    caixas: linhas.reduce((soma, linha) => soma + linha.total, 0),
    caixasConfirmadas: confirmadas,
    caixasComDiferenca: linhas.reduce((soma, linha) => soma + linha.comDiferenca, 0),
    diferenca: linhas.reduce((soma, linha) => soma + linha.diferenca, 0),
    ruas,
    continuar: emContagem[0]?.posicao ?? porContar?.posicao ?? null,
    alcance: dados.rodada.alcance,
    concluida: dados.rodada.fim ?? null,
  };
}

/** "começou 08:10 · Guilherme Dantas"; em outro dia que não o de `agora`, "começou 17/11 08:10 · Guilherme Dantas". */
export function textoDoComeco(comeco: Pick<Recontagem, "quando" | "quem">, agora: Date): string {
  return [`começou ${quandoEmTexto(comeco.quando, agora)}`, comeco.quem].filter(Boolean).join(" · ");
}

/** "15 prateleiras · 2 contadas · 1 em contagem": o que a rua tem nesta rodada. */
export function resumoDaRua(rua: RuaDaRodada): string {
  const contadas = rua.prateleiras.filter((prateleira) => prateleira.estado === "contada").length;
  const emContagem = rua.prateleiras.filter((prateleira) => prateleira.estado === "em_contagem").length;
  const partes = [plural(rua.prateleiras.length, "prateleira", "prateleiras")];
  if (contadas) partes.push(plural(contadas, "contada", "contadas"));
  if (emContagem) partes.push(`${numero.format(emContagem)} em contagem`);
  if (!contadas && !emContagem) partes.push("por contar");
  return partes.join(" · ");
}

/**
 * O selo da prateleira na rodada: "contada 08:41 · 1 diferença · −3 un." (em
 * outro dia que não o de `agora`, "contada 17/11 08:41 · …"), "em contagem ·
 * Guilherme · 2 de 7 caixas" ou, na recontada em outra rodada, "contada 16/11".
 */
export function seloDaPrateleira(prateleira: PrateleiraDaRodada, agora: Date): string {
  if (prateleira.estado === "contada" && prateleira.ultima) {
    const diferencas = prateleira.comDiferenca
      ? [plural(prateleira.comDiferenca, "diferença", "diferenças"), unidadesComSinal(prateleira.diferenca)]
      : [prateleira.vazias ? `${plural(prateleira.vazias, "caixa vazia saiu", "caixas vazias saíram")}` : "sem diferença"];
    return [`contada ${quandoEmTexto(prateleira.ultima.quando, agora)}`, ...diferencas].join(" · ");
  }
  if (prateleira.estado === "em_contagem" && prateleira.ultima) {
    return `em contagem · ${prateleira.ultima.quem} · ${numero.format(prateleira.confirmadas)} de ${plural(prateleira.total, "caixa", "caixas")}`;
  }
  if (prateleira.estado === "contada_antes" && prateleira.contadaEm) return `contada ${prateleira.contadaEm}`;
  return "";
}

/** A ação da linha da prateleira: "Abrir" a em contagem, "Ver" a contada, "Contar" as outras. */
export function acaoDaPrateleira(prateleira: Pick<PrateleiraDaRodada, "estado">): string {
  if (prateleira.estado === "em_contagem") return "Abrir";
  if (prateleira.estado === "contada") return "Ver";
  return "Contar";
}

/** O endereço da bancada de uma prateleira. */
export function hrefDaPrateleira(posicao: string): string {
  return `${ROTA_DA_PRATELEIRA}?posicao=${encodeURIComponent(chave(posicao))}`;
}

/**
 * "Contar este item", na ficha do item (18/11/2026): o item guardado numa
 * prateleira só vai à bancada dela; em várias, ou em nenhuma (só áreas de
 * passagem, ou saldo zero), vai à rodada, onde se escolhe a prateleira.
 */
export function contarOItem(locais: ReadonlyArray<{ id: string; qty: number }>): { href: string; rotulo: string } {
  const prateleiras = [...new Set(locais.filter((local) => local.qty > 0 && areaDePassagem(local.id) === null).map((local) => chave(local.id)))];
  if (prateleiras.length === 1) return { href: hrefDaPrateleira(prateleiras[0]!), rotulo: `Contar em ${prateleiras[0]}` };
  return { href: ROTA_DA_RODADA, rotulo: "Contagem por caixa" };
}

/** A prateleira da busca (`?posicao=a-03`), em maiúsculas; sem ela, null. */
export function posicaoDaBusca(busca: string): string | null {
  return chave(new URLSearchParams(busca).get("posicao")) || null;
}
