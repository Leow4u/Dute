import { useQuery } from "@tanstack/react-query";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import { chamarRh } from "./api";
import { exportacoesLidas, type ExportacaoNaLista } from "./exportacao";
import { fichaLida, painelLido, type FichaDoRh, type PainelDoRh } from "./ficha";
import { itensDoInicioDoRh } from "./inicio";
import { abreRh } from "./navegacao";

/**
 * As leituras do RH, pelas callables (o banco `rh` é fechado ao navegador):
 * o painel (Início, Pessoas, a entrada e o menu) e a ficha de uma pessoa.
 * Só para quem abre o RH; para os outros papéis, nada é pedido. Depois de
 * cada gravação, a tela invalida a chave e lê de novo.
 */

const UM_MINUTO = 60_000;

export const CHAVE_DO_PAINEL = ["rh", "painel"] as const;
export const chaveDaFicha = (colaboradorId: string) => ["rh", "ficha", colaboradorId] as const;

async function lerPainel(): Promise<PainelDoRh> {
  const painel = painelLido(await chamarRh("getRhPanel", {}));
  if (!painel) throw new Error("Painel do RH ilegível.");
  return painel;
}

export type PainelDoRhNaTela = { painel: PainelDoRh | undefined; carregando: boolean; falhas: string[] };

export function usePainelDoRh(role: ProfileRole | null | undefined, ligado = true): PainelDoRhNaTela {
  const abre = ligado && abreRh(role);
  const leitura = useQuery({
    queryKey: CHAVE_DO_PAINEL,
    queryFn: lerPainel,
    enabled: abre,
    staleTime: UM_MINUTO,
    refetchInterval: 5 * UM_MINUTO,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  if (!abre) return { painel: undefined, carregando: false, falhas: [] };
  return { painel: leitura.data, carregando: leitura.isPending, falhas: leitura.isError ? ["pessoas e vencimentos"] : [] };
}

export type InicioDoRh = PainelDoRhNaTela & { itens: ItemDoInicio[] };

/** O "Precisa de você" do RH (lib/rh/inicio.ts), da mesma leitura das telas. `ligado` falso não pede nada. */
export function useInicioDoRh(role: ProfileRole | null | undefined, ligado = true): InicioDoRh {
  const leitura = usePainelDoRh(role, ligado);
  return { ...leitura, itens: leitura.painel && !leitura.falhas.length ? itensDoInicioDoRh(leitura.painel.vencimentos) : [] };
}

export type FichaNaTela = { ficha: FichaDoRh | undefined; carregando: boolean; erro: string | null };

export function useFichaDoRh(role: ProfileRole | null | undefined, colaboradorId: string | null): FichaNaTela {
  const abre = abreRh(role) && Boolean(colaboradorId);
  const leitura = useQuery({
    queryKey: chaveDaFicha(colaboradorId ?? ""),
    queryFn: async () => {
      const ficha = fichaLida(await chamarRh("getRhFicha", { colaborador_id: colaboradorId }));
      if (!ficha) throw new Error("Ficha ilegível.");
      return ficha;
    },
    enabled: abre,
    staleTime: UM_MINUTO,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  if (!abre) return { ficha: undefined, carregando: false, erro: null };
  return { ficha: leitura.data, carregando: leitura.isPending, erro: leitura.isError ? (leitura.error as Error).message : null };
}

export const CHAVE_DAS_EXPORTACOES = ["rh", "exportacoes"] as const;

export type ExportacoesNaTela = { exportacoes: ExportacaoNaLista[] | undefined; carregando: boolean; erro: string | null };

/** As versões mais novas da exportação para a contabilidade (parte 8.3). */
export function useExportacoesDoRh(role: ProfileRole | null | undefined): ExportacoesNaTela {
  const abre = abreRh(role);
  const leitura = useQuery({
    queryKey: CHAVE_DAS_EXPORTACOES,
    queryFn: async () => {
      const lidas = exportacoesLidas(await chamarRh("listRhExports", {}));
      if (!lidas) throw new Error("Exportações ilegíveis.");
      return lidas;
    },
    enabled: abre,
    staleTime: UM_MINUTO,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  if (!abre) return { exportacoes: undefined, carregando: false, erro: null };
  return { exportacoes: leitura.data, carregando: leitura.isPending, erro: leitura.isError ? (leitura.error as Error).message : null };
}
