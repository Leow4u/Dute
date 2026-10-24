import { useQuery } from "@tanstack/react-query";

import { OMIE_LIBERADA } from "../liberacao";
import type { ProfileRole } from "../modules";
import { chamarFinanceiro } from "./api";
import { baixasLidas, type BaixaDoFinanceiro } from "./baixas";
import { abreFinanceiro } from "./navegacao";

/**
 * As baixas abertas na Omie (parte 7.4h), pela callable listNfSettlements:
 * `nf_baixas` não abre pelo navegador. Só onde a Omie está liberada e para
 * quem abre o Financeiro. A rotina anda a cada 5 minutos; a tela lê de novo a
 * cada minuto e depois de cada ação.
 */

export const CHAVE_DAS_BAIXAS = ["financeiro", "baixas"] as const;

export type LeituraDasBaixas = { baixas: BaixaDoFinanceiro[] | undefined; carregando: boolean; falhas: string[] };

export function useBaixasDoFinanceiro(role: ProfileRole | null | undefined, ligado = true, omie: boolean = OMIE_LIBERADA): LeituraDasBaixas {
  const abre = ligado && omie && abreFinanceiro(role);
  const leitura = useQuery({
    queryKey: CHAVE_DAS_BAIXAS,
    queryFn: async () => {
      const lidas = baixasLidas(await chamarFinanceiro("listNfSettlements", {}));
      if (!lidas) throw new Error("Baixas ilegíveis.");
      return lidas;
    },
    enabled: abre,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // Fora da liberação, não há baixa: a lista vazia deixa o Início contar o resto.
  if (!abre) return { baixas: [], carregando: false, falhas: [] };
  return { baixas: leitura.data, carregando: leitura.isPending, falhas: leitura.isError ? ["baixas"] : [] };
}

/**
 * As baixas de uma NF que saiu pela Omie (parte 7.4i), todas as etapas, para
 * cada pagamento mostrar a dele. A NF registrada à mão não tem baixa e não
 * lê nada.
 */
export function useBaixasDaNf(role: ProfileRole | null | undefined, faturaId: string | null, pelaOmie: boolean, omie: boolean = OMIE_LIBERADA): LeituraDasBaixas {
  const abre = Boolean(faturaId) && pelaOmie && omie && abreFinanceiro(role);
  const leitura = useQuery({
    queryKey: [...CHAVE_DAS_BAIXAS, faturaId],
    queryFn: async () => {
      const lidas = baixasLidas(await chamarFinanceiro("listNfSettlements", { fatura_id: faturaId }));
      if (!lidas) throw new Error("Baixas ilegíveis.");
      return lidas;
    },
    enabled: abre,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  if (!abre) return { baixas: [], carregando: false, falhas: [] };
  return { baixas: leitura.data, carregando: leitura.isPending, falhas: leitura.isError ? ["baixas"] : [] };
}
