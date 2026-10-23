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

/**
 * As consultas do Início do Comercial, cada uma só para quem a vê. A mesma
 * chave serve à entrada por cards e aos contadores do menu (parte 2.4): a
 * leitura sai uma vez.
 */
export function useInicioDoComercial(role: ProfileRole | null | undefined, uid: string | null | undefined): InicioDoComercial {
  const veAprovacoes = veAprovacoesNoInicio(role);
  const veDevolvidos = veDevolvidosNoInicio(role) && Boolean(uid);
  const veContratos = veContratosNoInicio(role);
  const veAutorizacoes = veAutorizacoesNoInicio(role);
  const veMedicoes = veMedicoesNoInicio(role);
  const veResumo = abreComercial(role);

  const aprovacoes = useQuery({
    queryKey: ["comercial", "orcamentos", "para-aprovar"],
    queryFn: () => lerOrcamentosParaAprovar(),
    enabled: veAprovacoes,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const devolvidos = useQuery({
    queryKey: ["comercial", "orcamentos", "devolvidos", uid],
    queryFn: () => lerDevolvidos(uid!),
    enabled: veDevolvidos,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const contratos = useQuery({
    queryKey: ["comercial", "contratos", "inicio"],
    queryFn: () => lerAlertasDosContratos(),
    enabled: veContratos,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
  });
  const autorizacoes = useQuery({
    queryKey: ["comercial", "autorizacoes", "inicio"],
    queryFn: () => lerAutorizacoesDoInicio(),
    enabled: veAutorizacoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
  });
  const medicoes = useQuery({
    queryKey: ["comercial", "medicoes", "inicio"],
    queryFn: () => lerAlertasDeMedicao(),
    enabled: veMedicoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
  });
  const resumo = useQuery({
    queryKey: ["comercial", "resumo", "inicio"],
    queryFn: () => lerResumoDoComercial(),
    enabled: veResumo,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
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
