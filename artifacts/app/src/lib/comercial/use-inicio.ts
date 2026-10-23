import { useQuery } from "@tanstack/react-query";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import {
  lerAlertasDeMedicao,
  lerAlertasDosContratos,
  lerAutorizacoesDoInicio,
  lerDevolvidos,
  lerOrcamentosParaAprovar,
  lerResumoDoComercial,
  type ResumoDoComercial,
} from "./inicio";
import { abreComercial } from "./navegacao";
import {
  pendenciasDoComercial,
  veAprovacoesNoInicio,
  veAutorizacoesNoInicio,
  veContratosNoInicio,
  veDevolvidosNoInicio,
  veMedicoesNoInicio,
} from "./pendencias";

export type InicioDoComercial = {
  itens: ItemDoInicio[];
  resumo: ResumoDoComercial | undefined;
  carregando: boolean;
  /** As fontes que não carregaram, em palavras ("contratos", "medições"). */
  falhas: string[];
};

const CINCO_MINUTOS = 5 * 60_000;
const UM_MINUTO = 60_000;

/**
 * As consultas do Início do Comercial, cada uma só para quem a vê. A mesma
 * chave serve à entrada por cards e aos contadores do menu (parte 2.4): a
 * leitura sai uma vez, e o minuto de validade evita repetir a consulta quando
 * o menu e o Início pedem juntos. `ligado` falso não consulta nada.
 */
export function useInicioDoComercial(
  role: ProfileRole | null | undefined,
  uid: string | null | undefined,
  ligado = true,
): InicioDoComercial {
  const veAprovacoes = ligado && veAprovacoesNoInicio(role);
  const veDevolvidos = ligado && veDevolvidosNoInicio(role) && Boolean(uid);
  const veContratos = ligado && veContratosNoInicio(role);
  const veAutorizacoes = ligado && veAutorizacoesNoInicio(role);
  const veMedicoes = ligado && veMedicoesNoInicio(role);
  const veResumo = ligado && abreComercial(role);

  const aprovacoes = useQuery({
    queryKey: ["comercial", "orcamentos", "para-aprovar"],
    queryFn: () => lerOrcamentosParaAprovar(),
    enabled: veAprovacoes,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });
  const devolvidos = useQuery({
    queryKey: ["comercial", "orcamentos", "devolvidos", uid],
    queryFn: () => lerDevolvidos(uid!),
    enabled: veDevolvidos,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });
  const contratos = useQuery({
    queryKey: ["comercial", "contratos", "inicio"],
    queryFn: () => lerAlertasDosContratos(),
    enabled: veContratos,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });
  const autorizacoes = useQuery({
    queryKey: ["comercial", "autorizacoes", "inicio"],
    queryFn: () => lerAutorizacoesDoInicio(),
    enabled: veAutorizacoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });
  const medicoes = useQuery({
    queryKey: ["comercial", "medicoes", "inicio"],
    queryFn: () => lerAlertasDeMedicao(),
    enabled: veMedicoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });
  const resumo = useQuery({
    queryKey: ["comercial", "resumo", "inicio"],
    queryFn: () => lerResumoDoComercial(),
    enabled: veResumo,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
  });

  const fontes = [
    { ve: veAprovacoes, consulta: aprovacoes, nome: "orçamentos para aprovar" },
    { ve: veDevolvidos, consulta: devolvidos, nome: "orçamentos devolvidos" },
    { ve: veContratos, consulta: contratos, nome: "contratos" },
    { ve: veAutorizacoes, consulta: autorizacoes, nome: "autorizações" },
    { ve: veMedicoes, consulta: medicoes, nome: "medições" },
    { ve: veResumo, consulta: resumo, nome: "orçamentos por etapa" },
  ];
  return {
    itens: pendenciasDoComercial({
      role,
      paraAprovar: aprovacoes.data,
      contratos: contratos.data,
      autorizacoes: autorizacoes.data,
      medicoes: medicoes.data,
      devolvidos: devolvidos.data,
      semResposta: resumo.data?.semResposta,
    }),
    resumo: resumo.data,
    carregando: fontes.some((fonte) => fonte.ve && fonte.consulta.isLoading),
    falhas: fontes.filter((fonte) => fonte.ve && fonte.consulta.isError).map((fonte) => fonte.nome),
  };
}
