/**
 * As datas de entrada do estoque de um SKU, para quem olha
 * (docs/plataforma/fifo-por-data.md, seções 3.3 e 3.4, partes 5 e 6; telas
 * em docs/mockups/PortalEstoqueDatas.dc.html e WmsItemDatas.dc.html).
 *
 * A conta é a do pedido (domain/datas-do-saldo.ts): o que sobra numa
 * prateleira são as entradas mais recentes nela, e o que as entradas não
 * cobrem fica sem data. Aqui ela vira o que as telas mostram:
 *
 * - `datas`, o que o cliente vê: uma linha por dia, somando as prateleiras,
 *   sem prateleira nem caixa. O sem data vem primeiro (é o mais antigo),
 *   depois do dia mais antigo ao mais novo. O RECEBIMENTO e a EXPEDICAO não
 *   entram: o RECEBIMENTO segue como "Em recebimento", sem data.
 * - `locais`, o que a equipe vê: uma linha por prateleira, com as datas
 *   dela, na ordem em que o pedido as usa (a de data livre mais antiga
 *   primeiro); depois o RECEBIMENTO e a EXPEDICAO, com a quantidade e sem
 *   data.
 *
 * As datas são das peças físicas (o reservado inclusive): somadas, dão o
 * saldo do local. Nada é gravado.
 */

import type { DocumentData, Firestore } from "firebase-admin/firestore";

import { areaDePassagem } from "./areas-de-passagem.js";
import {
  chaveDoLocal,
  datasDoSaldo,
  entradasDoRazao,
  ordenarCandidatos,
  type DataDoSaldo,
  type Dia,
  type Entrada,
  type SaldoDoLocal,
} from "./datas-do-saldo.js";
import { openingInventorySessionDocumentId, skuBalancesQuery } from "./operations.js";

/** Peças de um dia: `desde` é o dia "AAAA-MM-DD" em São Paulo; null é sem data. */
export type DataDoEstoque = { desde: Dia; pecas: number };

/** Um local com o saldo dele e as datas; a área de passagem vem sem datas. */
export type LocalDoEstoque = { local: string; pecas: number; datas: DataDoEstoque[] };

export type DatasDoEstoque = {
  /** Por dia, só das prateleiras: o que o cliente vê. */
  datas: DataDoEstoque[];
  /** Por local, na ordem do pedido: o que a equipe vê. */
  locais: LocalDoEstoque[];
};

/** As datas do SKU a partir dos saldos dele e das ENTRADAs do razão por local (entradasDoRazao). */
export function datasDoEstoque(
  saldos: readonly SaldoDoLocal[],
  entradas: ReadonlyMap<string, readonly Entrada[]> = new Map(),
): DatasDoEstoque {
  const somados = new Map<string, { qty_on_hand: number; qty_reserved: number }>();
  for (const saldo of Array.isArray(saldos) ? saldos : []) {
    const local = chaveDoLocal(saldo?.location_id);
    if (!local) continue;
    const doLocal = somados.get(local) ?? { qty_on_hand: 0, qty_reserved: 0 };
    doLocal.qty_on_hand += quantidade(saldo?.qty_on_hand);
    doLocal.qty_reserved += quantidade(saldo?.qty_reserved);
    somados.set(local, doLocal);
  }

  const prateleiras: Array<LocalDoEstoque & { livres: DataDoSaldo[] }> = [];
  const passagem: LocalDoEstoque[] = [];
  for (const [local, saldo] of somados) {
    if (saldo.qty_on_hand <= 0) continue;
    if (areaDePassagem(local) !== null) {
      passagem.push({ local, pecas: saldo.qty_on_hand, datas: [] });
      continue;
    }
    const { fisicas, livres } = datasDoSaldo(saldo, entradas.get(local) ?? []);
    prateleiras.push({ local, pecas: saldo.qty_on_hand, datas: fisicas.map(daParte), livres });
  }

  const naOrdemDoPedido = ordenarCandidatos(
    prateleiras,
    new Map(prateleiras.map((prateleira) => [prateleira.local, prateleira.livres])),
    (prateleira) => prateleira.local,
  );

  const porDia = new Map<Dia, number>();
  for (const prateleira of prateleiras) {
    for (const data of prateleira.datas) porDia.set(data.desde, (porDia.get(data.desde) ?? 0) + data.pecas);
  }

  return {
    datas: [...porDia]
      .map(([desde, pecas]) => ({ desde, pecas }))
      .sort((a, b) => (a.desde === b.desde ? 0 : a.desde === null ? -1 : b.desde === null ? 1 : a.desde < b.desde ? -1 : 1)),
    locais: [
      ...naOrdemDoPedido.map(({ local, pecas, datas }) => ({ local, pecas, datas })),
      ...passagem.sort((a, b) => a.local.localeCompare(b.local)),
    ],
  };
}

/**
 * Lê os saldos do SKU do cliente e as ENTRADAs do razão dele e devolve as
 * datas. Mesmas consultas do pedido (só igualdades, sem índice composto); a
 * sessão de abertura só é lida quando alguma ENTRADA veio dela.
 */
export async function lerDatasDoEstoque(db: Firestore, customerCode: string, skuCode: string): Promise<DatasDoEstoque> {
  const [saldos, movimentos] = await Promise.all([
    skuBalancesQuery(db, customerCode, skuCode).get(),
    db
      .collection("movements")
      .where("customer_code", "==", customerCode)
      .where("sku_code", "==", skuCode)
      .where("tipo_mov", "==", "ENTRADA")
      .get(),
  ]);
  const entradas = movimentos.docs.map((doc) => doc.data());
  const sessao = db.collection("opening_inventory_sessions").doc(openingInventorySessionDocumentId(customerCode));
  const abertura: DocumentData | undefined = entradas.some((entrada) => texto(entrada.opening_inventory_session_id))
    ? (await sessao.get()).data()
    : undefined;
  return datasDoEstoque(
    saldos.docs.map((doc) => doc.data()),
    entradasDoRazao(entradas, { id: sessao.id, started_at: abertura?.started_at }),
  );
}

function daParte(parte: DataDoSaldo): DataDoEstoque {
  return { desde: parte.dia, pecas: parte.quantidade };
}

function quantidade(valor: unknown): number {
  const lido = Number(valor ?? 0);
  return Number.isFinite(lido) ? Math.max(0, lido) : 0;
}

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}
