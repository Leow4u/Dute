import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";

import type { LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { falhaDasLeituras, type FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { firestore } from "@/lib/firebase";

import { catalogoDaContagem, contagemLida, contagensDoCliente, inicioDoDiaEmSaoPaulo, prateleirasDaContagem, type ContagemDoDia, type PrateleiraDaContagem } from "./contagem-por-caixa";
import { fetchJson, type AnyRecord } from "./model";
import { useCaixasDoCliente, useEntradaDaAbertura, usePosicoesDoArmazem } from "./use-lista-de-separacao";

/**
 * As leituras da contagem por caixa (a folha e o relatório "Caixas × saldo"),
 * todas as do Mapa e das Etiquetas, com as mesmas chaves: as posições, as
 * caixas do cliente, as linhas da abertura, os saldos por prateleira e o
 * catálogo. Nenhuma callable nova e nenhuma escrita. Sem o cliente ativo
 * confirmado (`null`), nada é lido: o `customer_code` é a fronteira.
 */

type Itens = { items?: AnyRecord[] };

/** As chaves que o "Tentar de novo" relê do zero (a leitura presa sem dado não recomeça sozinha). */
const CHAVES = [["warehouse-positions"], ["warehouse-boxes"], ["opening-inventory-lines"], ["stock-balances"], ["estoque", "skus"]] as const;

export type LeituraDaContagem = {
  prateleiras: PrateleiraDaContagem[];
  /** Alguma leitura de que a conta depende ainda não voltou. */
  carregando: boolean;
  /** A leitura de que a conta depende falhou sem nada lido: o aviso no lugar da tela, nunca o vazio. */
  falha: FalhaDasLeituras | null;
  /** O catálogo falhou sem nada lido: o nome do produto é o da caixa, ou o SKU. A tela diz. */
  catalogoFalhou: boolean;
  /** As leituras de que a conta depende, para a linha de estado sob o título. */
  leituras: LeituraDaLista[];
  /** Lê de novo o que ainda não chegou ou falhou: o "Tentar de novo" da demora e da falha. */
  tentar: () => Promise<unknown>;
};

export function useContagemPorCaixa(cliente: string | null): LeituraDaContagem {
  const codigo = String(cliente ?? "").trim();
  const ligado = Boolean(codigo);
  const posicoes = usePosicoesDoArmazem(ligado);
  const caixas = useCaixasDoCliente(ligado ? codigo : null);
  const abertura = useEntradaDaAbertura(ligado ? codigo : null);
  // O saldo de cada prateleira (a guarda por linha move o saldo sem registrar caixa): a mesma leitura do Mapa e do
  // Estoque, sem filtro (a consulta por cliente pediria um índice novo); a conta fica só com os saldos do cliente.
  const saldos = useQuery({
    queryKey: ["stock-balances", "estoque"],
    enabled: ligado,
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: () => fetchJson<Itens>("/api/stock-balances?limit=2000"),
  });
  // Os nomes do catálogo, a mesma chave do Estoque e do Mapa: o cache serve às três telas.
  const catalogo = useQuery({
    queryKey: ["estoque", "skus"],
    enabled: ligado,
    staleTime: 120_000,
    queryFn: () => fetchJson<Itens>("/api/skus?limit=2000"),
  });

  // A leitura que falhou sem nada lido fica na tela enquanto tenta de novo (as cópias): o aviso e o "Tentar de novo"
  // não somem com o foco nele, e a falta de conexão não vira o erro genérico na nova tentativa.
  const posicoesNaTela = useLeituraComFalha(posicoes);
  const caixasNaTela = useLeituraComFalha(caixas);
  const aberturaNaTela = useLeituraComFalha(abertura);
  const saldosNaTela = useLeituraComFalha(saldos);
  const catalogoNaTela = useLeituraComFalha(catalogo);

  const prateleiras = useMemo(
    () =>
      prateleirasDaContagem({
        cliente: codigo,
        posicoes: posicoes.data?.items ?? [],
        caixas: caixas.data ?? [],
        abertura: abertura.data ?? [],
        saldos: saldos.data?.items ?? [],
        catalogo: catalogoDaContagem(catalogo.data?.items ?? []),
      }),
    [codigo, posicoes.data?.items, caixas.data, abertura.data, saldos.data?.items, catalogo.data?.items],
  );

  const queryClient = useQueryClient();
  const essenciais = [posicoesNaTela, caixasNaTela, aberturaNaTela, saldosNaTela];
  return {
    prateleiras,
    carregando: essenciais.some((leitura) => leitura.isLoading),
    falha: falhaDasLeituras([
      [posicoes, posicoesNaTela],
      [caixas, caixasNaTela],
      [abertura, aberturaNaTela],
      [saldos, saldosNaTela],
    ]),
    catalogoFalhou: catalogoNaTela.isError && catalogoNaTela.data === undefined,
    leituras: essenciais,
    tentar: () => relerDoZero(queryClient, CHAVES),
  };
}

export type LeituraDasContagens = {
  contagens: ContagemDoDia[];
  carregando: boolean;
  /** A leitura falhou sem nada lido. */
  falha: FalhaDasLeituras | null;
  leitura: LeituraDaLista;
};

/**
 * As contagens gravadas hoje (`cycle_counts`), de todos os clientes, pela
 * hora: a tela mostra só as do cliente ativo. A consulta é por um campo só
 * (`occurred_at`), que dispensa índice composto; o dia começa à meia-noite de
 * São Paulo.
 */
export function useContagensDeHoje(cliente: string | null, agora: () => Date = () => new Date()): LeituraDasContagens {
  const codigo = String(cliente ?? "").trim();
  const inicio = inicioDoDiaEmSaoPaulo(agora());
  const consulta = useQuery({
    queryKey: ["cycle-counts", "hoje", inicio],
    enabled: Boolean(codigo),
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!firestore) throw new Error("Firebase não configurado.");
      const snapshot = await getDocs(query(collection(firestore, "cycle_counts"), where("occurred_at", ">=", inicio), orderBy("occurred_at", "desc"), limit(500)));
      return snapshot.docs.flatMap((registro) => contagemLida(registro.id, registro.data()) ?? []);
    },
  });
  const naTela = useLeituraComFalha(consulta);
  const contagens = useMemo(() => contagensDoCliente(consulta.data ?? [], codigo), [consulta.data, codigo]);
  return {
    contagens,
    carregando: naTela.isLoading,
    falha: falhaDasLeituras([[consulta, naTela]]),
    leitura: naTela,
  };
}
