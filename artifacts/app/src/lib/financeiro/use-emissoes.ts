import { useQuery } from "@tanstack/react-query";

import { useLeituraComFalha } from "../carregando/use-leitura-com-falha";
import { OMIE_LIBERADA } from "../liberacao";
import type { ProfileRole } from "../modules";
import { SEM_NOVA_TENTATIVA, type NovaTentativa } from "../operacao/leitura";
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

export type LeituraDasEmissoes = {
  emissoes: EmissaoDoFinanceiro[] | undefined;
  carregando: boolean;
  falhas: string[];
  /** A nova tentativa (parte 13g): relê, e a falha fica na tela até a resposta. */
  releitura: NovaTentativa;
};

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
  // A nova tentativa sem dado volta o react-query a "pending": a falha fica na tela até a resposta.
  const comFalha = useLeituraComFalha(leitura);
  if (!abre) return { emissoes: [], carregando: false, falhas: [], releitura: SEM_NOVA_TENTATIVA };
  return {
    emissoes: comFalha.data,
    carregando: comFalha.isPending && !comFalha.isError,
    falhas: comFalha.isError ? ["emissões"] : [],
    releitura: { tentando: comFalha.isError && comFalha.isFetching, tentar: () => void leitura.refetch() },
  };
}
