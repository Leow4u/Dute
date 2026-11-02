/**
 * FIFO por data (docs/plataforma/fifo-por-data.md, seções 3.1 e 3.2, parte 4):
 * de que dia são as peças de cada local e em que ordem o pedido percorre os
 * locais.
 *
 * A conta: pelo FIFO, o que sobra num local são as entradas mais recentes
 * nele. Ela pega o saldo físico do local (qty_on_hand) e as ENTRADAs do razão
 * nele, da mais nova para a mais antiga, e atribui quantidade a cada dia até
 * cobrir o saldo. O que as entradas não cobrem fica sem data (dia null): é o
 * que já estava no local antes da entrada mais antiga que o razão conhece, e
 * por isso conta como o mais antigo dele. O total sempre fecha com o saldo. O
 * reservado sai das datas mais antigas; o que sobra são as datas livres.
 *
 * Conta toda ENTRADA do local, de qualquer origem: Receber, guarda, abertura,
 * devolução, ajuste, contagem para mais e a volta do cancelado (a lista de
 * origens dos parados não vale aqui). O dia é o de São Paulo do created_at do
 * movimento, a hora do servidor; o campo data, que a movimentação manual e a
 * API deixam digitar, não conta. A ENTRADA da contagem de abertura vale um dia
 * só por cliente, o do started_at da sessão dele. O local é o location_id como
 * o alocador o compara, só sem o espaço das pontas (chaveDoLocal).
 *
 * A ordem do pedido: primeiro o local com data livre, do dia livre mais antigo
 * ao mais novo; depois o local sem data livre; no empate, o location_id, como
 * antes. Sem data nenhuma, a ordem é a de location_id. O pedido não se divide
 * para seguir a data: o alocador continua enchendo um local por vez e só passa
 * ao seguinte quando ele não basta (pergunta 2). O razão só é lido para o SKU
 * em que a ordem pode mudar (skusQuePrecisamDasDatas).
 *
 * Funções puras, sem Firestore, que nunca lançam erro. Os casos estão em
 * datas-do-saldo.casos.json, ao lado.
 */

import { areaDePassagem } from "./areas-de-passagem.js";

/** O dia "AAAA-MM-DD" no calendário de São Paulo; null quando não se sabe. */
export type Dia = string | null;

/** Uma ENTRADA do razão num local: o dia dela e a quantidade. */
export type Entrada = { dia: Dia; quantidade: number };

/** Uma parte do saldo de um local: quantas peças são de um dia. */
export type DataDoSaldo = { dia: Dia; quantidade: number };

export type DatasDoSaldo = {
  /** O saldo físico por dia: o sem data primeiro (é o mais antigo), depois do dia mais antigo ao mais novo. */
  fisicas: DataDoSaldo[];
  /** O físico sem o reservado, que sai das datas mais antigas. */
  livres: DataDoSaldo[];
};

export type SaldoDoLocal = { location_id?: unknown; qty_on_hand?: unknown; qty_reserved?: unknown };

/** Um item do pedido: o SKU e o local, quando o cliente pede um. */
export type ItemDoPedido = { sku_code?: unknown; location_id?: unknown };

/** A sessão de abertura do cliente: o id dela e o started_at. */
export type Abertura = { id?: unknown; started_at?: unknown };

/** Listas por local (ou por SKU), num Map ou num objeto. */
type PorChave<T> = ReadonlyMap<string, readonly T[]> | Readonly<Record<string, readonly T[]>>;

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Data, com ou sem hora, escrita sem fuso: vale o dia escrito, como o legado
// de billing.ts. Com fuso (ou Z), é um instante e vale o dia dele em São Paulo.
const SEM_FUSO = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

const CALENDARIO_DE_SAO_PAULO = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * O dia de São Paulo de um instante: Timestamp do Firestore (o created_at do
 * servidor), Date, milissegundos ou texto ISO. Null quando não é data.
 */
export function diaDeSaoPaulo(instante: unknown): Dia {
  try {
    if (typeof instante === "string") {
      const escrito = instante.trim();
      const semFuso = SEM_FUSO.exec(escrito);
      return semFuso ? diaValido(semFuso[1]!) : diaDoInstante(Date.parse(escrito));
    }
    return diaDoInstante(milissegundos(instante));
  } catch {
    return null;
  }
}

/**
 * O local como o alocador o compara: o location_id sem o espaço das pontas.
 * Maiúscula e acento contam: "a-01", que a movimentação manual grava como foi
 * digitado, é outro saldo que "A-01", e cada movimento grava o location_id do
 * saldo que mexe. Juntar os dois daria a um a data do outro.
 */
export function chaveDoLocal(local: unknown): string {
  return texto(local);
}

/** As datas físicas e as livres do saldo de um local (seção 3.1). */
export function datasDoSaldo(saldo: SaldoDoLocal, entradas: readonly Entrada[] = []): DatasDoSaldo {
  let semData = quantidade(saldo?.qty_on_hand);
  const porDia = new Map<string, number>();
  const datadas = lista(entradas)
    .map((entrada) => ({ dia: diaDaEntrada(entrada), quantidade: quantidade(entrada?.quantidade) }))
    .filter((entrada): entrada is { dia: string; quantidade: number } => entrada.dia !== null && entrada.quantidade > 0)
    // Da mais nova para a mais antiga: o que sobra são as mais recentes.
    .sort((a, b) => (a.dia === b.dia ? 0 : a.dia < b.dia ? 1 : -1));
  for (const entrada of datadas) {
    if (semData <= 0) break;
    const parte = Math.min(semData, entrada.quantidade);
    porDia.set(entrada.dia, (porDia.get(entrada.dia) ?? 0) + parte);
    semData -= parte;
  }
  const fisicas: DataDoSaldo[] = [
    ...(semData > 0 ? [{ dia: null, quantidade: semData }] : []),
    ...[...porDia.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dia, pecas]) => ({ dia, quantidade: pecas })),
  ];
  return { fisicas, livres: tirarDasMaisAntigas(fisicas, quantidade(saldo?.qty_reserved)) };
}

/** O dia livre mais antigo; null quando nada do livre tem data. */
export function diaLivreMaisAntigo(livres: readonly DataDoSaldo[] = []): Dia {
  let maisAntigo: Dia = null;
  for (const parte of lista(livres)) {
    const dia = diaDaEntrada(parte);
    if (dia !== null && quantidade(parte?.quantidade) > 0 && (maisAntigo === null || dia < maisAntigo)) maisAntigo = dia;
  }
  return maisAntigo;
}

/**
 * Os candidatos do pedido na ordem da seção 3.2: o local com data livre antes
 * do sem data, o dia livre mais antigo primeiro e, no empate, o location_id
 * (localeCompare, como o alocador já ordenava). `datasLivres` é por local.
 */
export function ordenarCandidatos<T>(
  candidatos: readonly T[],
  datasLivres: PorChave<DataDoSaldo>,
  localDe: (candidato: T) => unknown = (candidato) => (candidato as { location_id?: unknown } | null)?.location_id,
): T[] {
  const porLocal = porChave(datasLivres, chaveDoLocal);
  return lista(candidatos)
    .map((candidato, posicao) => {
      const local = chaveDoLocal(localDe(candidato));
      return { candidato, posicao, local, dia: diaLivreMaisAntigo(porLocal.get(local) ?? []) };
    })
    .sort((a, b) => {
      if (a.dia !== b.dia) {
        if (a.dia === null) return 1;
        if (b.dia === null) return -1;
        return a.dia < b.dia ? -1 : 1;
      }
      return a.local.localeCompare(b.local) || a.posicao - b.posicao;
    })
    .map((item) => item.candidato);
}

/**
 * As datas livres de cada local, com as ENTRADAs dele. Dois saldos no mesmo
 * local somam: as ENTRADAs são do local e explicam os dois.
 */
export function datasLivresPorLocal(
  saldos: readonly SaldoDoLocal[],
  entradas: PorChave<Entrada>,
): Map<string, DataDoSaldo[]> {
  const entradasPorLocal = porChave(entradas, chaveDoLocal);
  const somados = new Map<string, { qty_on_hand: number; qty_reserved: number }>();
  for (const saldo of lista(saldos)) {
    const local = chaveDoLocal(saldo?.location_id);
    if (!local) continue;
    const doLocal = somados.get(local) ?? { qty_on_hand: 0, qty_reserved: 0 };
    doLocal.qty_on_hand += quantidade(saldo?.qty_on_hand);
    doLocal.qty_reserved += quantidade(saldo?.qty_reserved);
    somados.set(local, doLocal);
  }
  return new Map(
    [...somados].map(([local, saldo]) => [local, datasDoSaldo(saldo, entradasPorLocal.get(local) ?? []).livres]),
  );
}

/** A ordem só pode mudar com livre em dois ou mais locais: só então vale ler o razão. */
export function precisaDasDatas(saldos: readonly SaldoDoLocal[]): boolean {
  return lista(saldos).filter((saldo) => numero(saldo?.qty_on_hand) - numero(saldo?.qty_reserved) > 0).length >= 2;
}

/**
 * Os SKUs do pedido cujo razão o alocador lê, dentro da transação: o SKU com
 * algum item sem local pedido (o item que pede o local reserva nele) e livre
 * em duas ou mais prateleiras. O RECEBIMENTO e a EXPEDICAO não contam, porque
 * não atendem pedido (areas-de-passagem.ts). Os outros SKUs seguem a ordem de
 * location_id sem ler nada. Na ordem dos itens, sem repetir.
 */
export function skusQuePrecisamDasDatas(itens: readonly ItemDoPedido[], saldosPorSku: PorChave<SaldoDoLocal>): string[] {
  const saldos = porChave(saldosPorSku, texto);
  const vistos = new Set<string>();
  const skus: string[] = [];
  for (const item of lista(itens)) {
    const sku = texto(item?.sku_code);
    if (!sku || texto(item?.location_id) || vistos.has(sku)) continue;
    vistos.add(sku);
    const prateleiras = (saldos.get(sku) ?? []).filter((saldo) => areaDePassagem(saldo?.location_id) === null);
    if (precisaDasDatas(prateleiras)) skus.push(sku);
  }
  return skus;
}

/**
 * As ENTRADAs do razão de um SKU por local (chaveDoLocal). O dia é o
 * do created_at em São Paulo; a ENTRADA da abertura do cliente (com o
 * opening_inventory_session_id da sessão) vale o dia do started_at dela, e,
 * sem started_at válido, o do created_at. O que não é ENTRADA, ou não tem
 * local ou quantidade, fica de fora.
 */
export function entradasDoRazao(movimentos: readonly unknown[], abertura: Abertura = {}): Map<string, Entrada[]> {
  const sessao = texto(abertura?.id);
  const diaDaAbertura = sessao ? diaDeSaoPaulo(abertura?.started_at) : null;
  const porLocal = new Map<string, Entrada[]>();
  for (const valor of lista(movimentos)) {
    if (!valor || typeof valor !== "object") continue;
    const movimento = valor as Record<string, unknown>;
    if (movimento.tipo_mov !== "ENTRADA") continue;
    const local = chaveDoLocal(movimento.location_id);
    const pecas = quantidade(movimento.quantity ?? movimento.qtde);
    if (!local || pecas <= 0) continue;
    const daAbertura = diaDaAbertura !== null && texto(movimento.opening_inventory_session_id) === sessao;
    const doLocal = porLocal.get(local) ?? [];
    doLocal.push({ dia: daAbertura ? diaDaAbertura : diaDeSaoPaulo(movimento.created_at), quantidade: pecas });
    porLocal.set(local, doLocal);
  }
  return porLocal;
}

function tirarDasMaisAntigas(fisicas: readonly DataDoSaldo[], reservado: number): DataDoSaldo[] {
  let falta = reservado;
  const livres: DataDoSaldo[] = [];
  for (const parte of fisicas) {
    const tirado = Math.min(falta, parte.quantidade);
    falta -= tirado;
    if (parte.quantidade - tirado > 0) livres.push({ dia: parte.dia, quantidade: parte.quantidade - tirado });
  }
  return livres;
}

function diaDaEntrada(entrada: { dia?: unknown } | null | undefined): Dia {
  return typeof entrada?.dia === "string" ? diaValido(entrada.dia.trim()) : null;
}

function diaValido(dia: string): Dia {
  const partes = DIA.exec(dia);
  if (!partes) return null;
  const [ano, mes, diaDoMes] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const data = new Date(Date.UTC(ano, mes - 1, diaDoMes));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === diaDoMes ? dia : null;
}

function diaDoInstante(ms: number): Dia {
  if (!Number.isFinite(ms)) return null;
  const data = new Date(ms);
  if (Number.isNaN(data.getTime())) return null;
  const partes = Object.fromEntries(CALENDARIO_DE_SAO_PAULO.formatToParts(data).map((parte) => [parte.type, parte.value]));
  return diaValido(`${partes.year}-${partes.month}-${partes.day}`);
}

/** Os milissegundos de um Timestamp do Firestore (ou do JSON dele), de um Date ou de um número. */
function milissegundos(instante: unknown): number {
  if (instante instanceof Date) return instante.getTime();
  if (typeof instante === "number") return instante;
  if (!instante || typeof instante !== "object") return Number.NaN;
  const valor = instante as Record<string, unknown>;
  if (typeof valor.toMillis === "function") return Number((valor.toMillis as () => unknown).call(valor));
  if (typeof valor.toDate === "function") {
    const data = (valor.toDate as () => unknown).call(valor);
    return data instanceof Date ? data.getTime() : Number.NaN;
  }
  const segundos = valor.seconds ?? valor._seconds;
  if (typeof segundos !== "number") return Number.NaN;
  const nanos = valor.nanoseconds ?? valor._nanoseconds;
  return segundos * 1000 + (typeof nanos === "number" ? nanos / 1e6 : 0);
}

/** As listas pela chave (`chave`); as de duas chaves que viram uma só se juntam. */
function porChave<T>(valores: PorChave<T>, chave: (valor: unknown) => string): Map<string, readonly T[]> {
  const pares: Array<[string, readonly T[]]> =
    valores instanceof Map ? [...valores.entries()] : Object.entries((valores ?? {}) as Record<string, readonly T[]>);
  const juntas = new Map<string, readonly T[]>();
  for (const [valor, itens] of pares) {
    const chaveDoValor = chave(valor);
    juntas.set(chaveDoValor, [...(juntas.get(chaveDoValor) ?? []), ...lista(itens)]);
  }
  return juntas;
}

function lista<T>(valor: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(valor) ? valor : [];
}

/** O número como o alocador o lê (o number() de operations.ts). */
function numero(valor: unknown): number {
  const lido = Number(valor ?? 0);
  return Number.isFinite(lido) ? lido : 0;
}

/** Quantidade de peças: o número, e zero quando não é positivo. */
function quantidade(valor: unknown): number {
  return Math.max(0, numero(valor));
}

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}
