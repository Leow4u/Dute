import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";

import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { faltaDaConsulta, useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { juntarTentativas, novaTentativaDe, useLeitura, type NovaTentativa } from "@/lib/operacao/leitura";
import { warehouseBoxFromRecord, type WarehouseBox } from "@/lib/warehouse-boxes";

import { catalogoDaContagem, type NomeDoSku, type SaldoLido } from "./contagem-por-caixa";
import { fetchJson, type AnyRecord } from "./model";
import {
  bancadaDaPrateleira,
  linhaRecontada,
  produtosDoCliente,
  recontagensDasLinhas,
  type BancadaDaPrateleira,
  type GuardaLida,
  type LinhaRecontada,
  type ProdutoDoCatalogo,
  type Recontagem,
  type ReservaLida,
} from "./recontagem-por-caixa";
import { useEntradaDaAbertura, usePosicoesDoArmazem } from "./use-lista-de-separacao";

/**
 * As leituras da recontagem por caixa. A bancada lê ao vivo o que muda
 * enquanto a pessoa conta (as caixas, os saldos e as reservas da
 * prateleira, as guardas abertas e as recontagens da rodada): o que outra
 * pessoa grava aparece sem recarregar. O cadastro de Posições, as linhas da
 * abertura e o catálogo são as leituras do Mapa e da folha, com as mesmas
 * chaves. Toda consulta é por igualdade (sem índice composto) e pelo
 * cliente ativo: o `customer_code` é a fronteira.
 */

type Itens = { items?: AnyRecord[] };

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

const saldoLido = (_id: string, data: AnyRecord): SaldoLido => ({
  location_id: data.location_id,
  sku_code: data.sku_code,
  qty_on_hand: data.qty_on_hand,
  qty_reserved: data.qty_reserved,
  customer_code: data.customer_code,
  client_item_code: data.client_item_code,
  product_name: data.product_name,
  size: data.size,
});

const reservaLida = (_id: string, data: AnyRecord): ReservaLida => ({
  sku_code: data.sku_code,
  location_id: data.location_id,
  status: data.status,
  order_number: data.order_number,
  order_id: data.order_id,
  customer_code: data.customer_code,
});

const guardaLida = (id: string, data: AnyRecord): GuardaLida => ({
  id,
  status: data.status,
  customer_code: data.customer_code,
  source_location_id: data.source_location_id,
  destination_location_id: data.destination_location_id,
  receipt_number: data.receipt_number,
  box_code: data.box_code,
});

/** O catálogo, a mesma chave do Estoque, do Mapa e da folha: o nome dos produtos e o item fora da lista. */
function useCatalogo(ligado: boolean) {
  return useQuery({
    queryKey: ["estoque", "skus"],
    enabled: ligado,
    staleTime: 120_000,
    queryFn: () => fetchJson<Itens>("/api/skus?limit=2000"),
  });
}

/** As guardas abertas do cliente (as duas situações da guarda que ainda vai mexer na prateleira). */
function useGuardasAbertas(cliente: string | null) {
  const planejadas = useLeitura(
    cliente ? `putaway_tasks:${cliente}:planned` : null,
    (db) => query(collection(db, "putaway_tasks"), where("customer_code", "==", cliente), where("status", "==", "planned")),
    guardaLida,
  );
  const emAndamento = useLeitura(
    cliente ? `putaway_tasks:${cliente}:in_progress` : null,
    (db) => query(collection(db, "putaway_tasks"), where("customer_code", "==", cliente), where("status", "==", "in_progress")),
    guardaLida,
  );
  return { planejadas, emAndamento };
}

/** As recontagens da rodada do cliente (`cycle_counts` com o `round_id` dela), ao vivo. */
function useRecontagensDaRodada(cliente: string | null, rodada: string, catalogo: ReadonlyMap<string, NomeDoSku>) {
  const linhas = useLeitura<LinhaRecontada>(
    cliente ? `cycle_counts:${cliente}:${rodada}` : null,
    (db) => query(collection(db, "cycle_counts"), where("customer_code", "==", cliente), where("round_id", "==", rodada)),
    (id, data) => linhaRecontada(id, data),
  );
  // O nome sai da linha gravada; o catálogo completa o que ela não trouxe.
  const recontagens = useMemo<Recontagem[]>(
    () =>
      recontagensDasLinhas(
        (linhas.itens ?? []).map((linha) => (linha.nome === linha.sku && catalogo.has(linha.sku) ? { ...linha, nome: catalogo.get(linha.sku)!.nome || linha.sku } : linha)),
        cliente,
      ),
    [linhas.itens, catalogo, cliente],
  );
  return { linhas, recontagens };
}

export type LeituraDaBancada = {
  bancada: BancadaDaPrateleira | null;
  /** Os ids das recontagens que a leitura ao vivo já trouxe. */
  gravadas: ReadonlySet<string>;
  /** Os produtos do cliente, para o item fora da lista. */
  produtos: ProdutoDoCatalogo[];
  catalogo: ReadonlyMap<string, NomeDoSku>;
  /** Alguma leitura de que a bancada depende ainda não voltou. */
  carregando: boolean;
  /** A leitura de que a bancada depende falhou sem nada lido. */
  falhou: boolean;
  /** O catálogo falhou: o item fora da lista não tem como ser escolhido. */
  catalogoFalhou: boolean;
  /** A nova tentativa e a falta das leituras, para a faixa e o aviso da conexão. */
  leitura: NovaTentativa;
};

/**
 * A bancada de uma prateleira do cliente ativo: as caixas, os saldos e as
 * reservas dela, as guardas abertas e as recontagens da rodada, ao vivo.
 * Sem o cliente confirmado ou sem a prateleira, nada é lido.
 */
export function useBancadaDaPrateleira(cliente: string | null, posicao: string | null, rodada: string): LeituraDaBancada {
  const codigo = texto(cliente);
  const alvo = texto(posicao).toUpperCase();
  const ligado = Boolean(codigo && alvo);
  const doCliente = ligado ? codigo : null;

  const posicoes = usePosicoesDoArmazem(ligado);
  const abertura = useEntradaDaAbertura(doCliente);
  const catalogoLido = useCatalogo(ligado);
  const posicoesNaTela = useLeituraComFalha(posicoes);
  const aberturaNaTela = useLeituraComFalha(abertura);
  const catalogoNaTela = useLeituraComFalha(catalogoLido);

  const caixas = useLeitura<WarehouseBox>(
    ligado ? `warehouse_boxes:${codigo}:${alvo}` : null,
    (db) => query(collection(db, "warehouse_boxes"), where("customer_code", "==", codigo), where("location_id", "==", alvo)),
    (id, data) => warehouseBoxFromRecord({ id, ...data }),
  );
  const saldos = useLeitura<SaldoLido>(
    ligado ? `stock_balances:${codigo}:${alvo}` : null,
    (db) => query(collection(db, "stock_balances"), where("customer_code", "==", codigo), where("location_id", "==", alvo)),
    saldoLido,
  );
  const reservadas = useLeitura<ReservaLida>(
    ligado ? `stock_reservations:${codigo}:${alvo}:reserved` : null,
    (db) => query(collection(db, "stock_reservations"), where("customer_code", "==", codigo), where("location_id", "==", alvo), where("status", "==", "reserved")),
    reservaLida,
  );
  const separadas = useLeitura<ReservaLida>(
    ligado ? `stock_reservations:${codigo}:${alvo}:picked` : null,
    (db) => query(collection(db, "stock_reservations"), where("customer_code", "==", codigo), where("location_id", "==", alvo), where("status", "==", "picked")),
    reservaLida,
  );
  const guardas = useGuardasAbertas(doCliente);
  const catalogo = useMemo(() => catalogoDaContagem(catalogoLido.data?.items ?? []), [catalogoLido.data?.items]);
  const { linhas, recontagens } = useRecontagensDaRodada(doCliente, rodada, catalogo);

  const bancada = useMemo(
    () =>
      ligado
        ? bancadaDaPrateleira({
            cliente: codigo,
            posicao: alvo,
            posicoes: posicoes.data?.items ?? [],
            caixas: caixas.itens ?? [],
            abertura: abertura.data ?? [],
            saldos: saldos.itens ?? [],
            reservas: [...(reservadas.itens ?? []), ...(separadas.itens ?? [])],
            guardas: [...(guardas.planejadas.itens ?? []), ...(guardas.emAndamento.itens ?? [])],
            recontagens,
            rodada,
            catalogo,
          })
        : null,
    [ligado, codigo, alvo, posicoes.data?.items, caixas.itens, abertura.data, saldos.itens, reservadas.itens, separadas.itens, guardas.planejadas.itens, guardas.emAndamento.itens, recontagens, rodada, catalogo],
  );
  const produtos = useMemo(() => produtosDoCliente(catalogoLido.data?.items ?? [], codigo), [catalogoLido.data?.items, codigo]);
  const gravadas = useMemo(() => new Set(recontagens.map((recontagem) => recontagem.id)), [recontagens]);

  const queryClient = useQueryClient();
  const aoVivo = [caixas, saldos, reservadas, separadas, guardas.planejadas, guardas.emAndamento, linhas];
  const consultas = [posicoesNaTela, aberturaNaTela];
  const consultaFalhou = consultas.find((consulta) => consulta.isError && consulta.data === undefined);
  const leitura = juntarTentativas(novaTentativaDe(aoVivo), {
    tentando: false,
    tentar: () => {
      if (consultaFalhou) void relerDoZero(queryClient, [["warehouse-positions"], ["opening-inventory-lines"]]);
    },
    ...faltaDaConsulta(consultaFalhou ?? posicoesNaTela),
  });
  return {
    bancada,
    gravadas,
    produtos,
    catalogo,
    carregando: ligado && (consultas.some((consulta) => consulta.isLoading) || aoVivo.some((lida) => lida.itens === null && !lida.erro)),
    falhou: Boolean(consultaFalhou) || aoVivo.some((lida) => lida.erro && lida.itens === null),
    catalogoFalhou: catalogoNaTela.isError && catalogoNaTela.data === undefined,
    leitura,
  };
}

export type LeituraDaRodada = {
  recontagens: Recontagem[];
  guardas: GuardaLida[];
  /** As reservas separadas esperando a entrega, do cliente. */
  separadas: ReservaLida[];
  carregando: boolean;
  falhou: boolean;
  leitura: NovaTentativa;
};

/**
 * O que a rodada lê além da folha (useContagemPorCaixa): as recontagens da
 * rodada, as guardas abertas e as reservas separadas esperando a entrega do
 * cliente, ao vivo.
 */
export function useLeiturasDaRodada(cliente: string | null, rodada: string, catalogo: ReadonlyMap<string, NomeDoSku>): LeituraDaRodada {
  const codigo = texto(cliente);
  const doCliente = codigo || null;
  const guardas = useGuardasAbertas(doCliente);
  const separadas = useLeitura<ReservaLida>(
    doCliente ? `stock_reservations:${codigo}:picked` : null,
    (db) => query(collection(db, "stock_reservations"), where("customer_code", "==", codigo), where("status", "==", "picked")),
    reservaLida,
  );
  const { linhas, recontagens } = useRecontagensDaRodada(doCliente, rodada, catalogo);
  const aoVivo = [linhas, guardas.planejadas, guardas.emAndamento, separadas];
  return {
    recontagens,
    guardas: [...(guardas.planejadas.itens ?? []), ...(guardas.emAndamento.itens ?? [])],
    separadas: separadas.itens ?? [],
    carregando: Boolean(doCliente) && aoVivo.some((lida) => lida.itens === null && !lida.erro),
    falhou: aoVivo.some((lida) => lida.erro && lida.itens === null),
    leitura: novaTentativaDe(aoVivo),
  };
}
