import { useQuery } from "@tanstack/react-query";

import { OMIE_LIBERADA } from "../liberacao";
import type { ProfileRole } from "../modules";
import { chamarFinanceiro } from "./api";
import { emissoesLidas, type EmissaoDoFinanceiro } from "./emissoes";
import { abreFinanceiro } from "./navegacao";

/**
 * As emissões da NFS-e pela Omie (parte 7.4f), pela callable listNfEmissions:
 * `nf_emissoes` não abre pelo navegador. Só onde a Omie está liberada e para
 * quem abre o Financeiro. A rotina anda a cada 5 minutos; a tela lê de novo a
 * cada minuto e depois de cada ação.
 */

export const CHAVE_DAS_EMISSOES = ["financeiro", "emissoes"] as const;

export type LeituraDasEmissoes = { emissoes: EmissaoDoFinanceiro[] | undefined; carregando: boolean; falhas: string[] };

export function useEmissoesDoFinanceiro(role: ProfileRole | null | undefined, ligado = true, omie: boolean = OMIE_LIBERADA): LeituraDasEmissoes {
  const abre = ligado && omie && abreFinanceiro(role);
  const leitura = useQuery({
    queryKey: CHAVE_DAS_EMISSOES,
    queryFn: async () => {
      const lidas = emissoesLidas(await chamarFinanceiro("listNfEmissions", {}));
      if (!lidas) throw new Error("Emissões ilegíveis.");
      return lidas;
    },
    enabled: abre,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // Fora da liberação, não há emissão: a lista vazia deixa o Início contar o resto.
  if (!abre) return { emissoes: [], carregando: false, falhas: [] };
  return { emissoes: leitura.data, carregando: leitura.isPending, falhas: leitura.isError ? ["emissões"] : [] };
}
