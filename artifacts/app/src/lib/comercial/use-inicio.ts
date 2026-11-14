import { useQuery, useQueryClient } from "@tanstack/react-query";

import { relerDoZero } from "../carregando/reler-do-zero";
import { useLeituraComFalha } from "../carregando/use-leitura-com-falha";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import {
  lerAditivosAFazer,
  lerVistoriasAUsar,
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
  veAditivosNoInicio,
  veVistoriasNoInicio,
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
  /** Alguma fonte lê agora. */
  relendo?: boolean;
  /** Relê as fontes, também a presa e a que falhou (o "Tentar de novo"); a promessa acaba com elas. */
  reler?: () => Promise<void>;
  /** Toda fonte que falhou já tinha sido lida: a releitura falhou, e o aviso não fala (momento 7). */
  falhaSoNaReleitura?: boolean;
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
  const veAditivos = ligado && veAditivosNoInicio(role);
  const veVistorias = ligado && veVistoriasNoInicio(role);
  const queryClient = useQueryClient();

  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const aprovacoes = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "orcamentos", "para-aprovar"],
    queryFn: () => lerOrcamentosParaAprovar(),
    enabled: veAprovacoes,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );
  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const devolvidos = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "orcamentos", "devolvidos", uid],
    queryFn: () => lerDevolvidos(uid!),
    enabled: veDevolvidos,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );
  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const contratos = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "contratos", "inicio"],
    queryFn: () => lerAlertasDosContratos(),
    enabled: veContratos,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );
  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const autorizacoes = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "autorizacoes", "inicio"],
    queryFn: () => lerAutorizacoesDoInicio(),
    enabled: veAutorizacoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );
  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const medicoes = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "medicoes", "inicio"],
    queryFn: () => lerAlertasDeMedicao(),
    enabled: veMedicoes,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );
  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const resumo = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "resumo", "inicio"],
    queryFn: () => lerResumoDoComercial(),
    enabled: veResumo,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );

  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const aditivos = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "aditivos-da-operacao", "inicio"],
    queryFn: () => lerAditivosAFazer(),
    enabled: veAditivos,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );

  // A fonte que falhou sem nada lido fica na falha enquanto é relida: o aviso e o botão não saem da tela.
  const vistorias = useLeituraComFalha(
    useQuery({
    queryKey: ["comercial", "vistorias-da-operacao", "inicio"],
    queryFn: () => lerVistoriasAUsar(),
    enabled: veVistorias,
    refetchInterval: CINCO_MINUTOS,
    refetchOnWindowFocus: false,
    staleTime: UM_MINUTO,
    }),
  );

  const fontes = [
    { ve: veAprovacoes, consulta: aprovacoes, nome: "orçamentos para aprovar", chave: ["comercial", "orcamentos", "para-aprovar"] },
    { ve: veDevolvidos, consulta: devolvidos, nome: "orçamentos devolvidos", chave: ["comercial", "orcamentos", "devolvidos", uid] },
    { ve: veContratos, consulta: contratos, nome: "contratos", chave: ["comercial", "contratos", "inicio"] },
    { ve: veAutorizacoes, consulta: autorizacoes, nome: "autorizações", chave: ["comercial", "autorizacoes", "inicio"] },
    { ve: veMedicoes, consulta: medicoes, nome: "medições", chave: ["comercial", "medicoes", "inicio"] },
    { ve: veResumo, consulta: resumo, nome: "orçamentos por etapa", chave: ["comercial", "resumo", "inicio"] },
    { ve: veAditivos, consulta: aditivos, nome: "aditivos da Operação", chave: ["comercial", "aditivos-da-operacao", "inicio"] },
    { ve: veVistorias, consulta: vistorias, nome: "vistorias da Operação", chave: ["comercial", "vistorias-da-operacao", "inicio"] },
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
      aditivos: aditivos.data,
      vistorias: vistorias.data,
    }),
    resumo: resumo.data,
    carregando: fontes.some((fonte) => fonte.ve && fonte.consulta.isLoading),
    falhas: fontes.filter((fonte) => fonte.ve && fonte.consulta.isError).map((fonte) => fonte.nome),
    relendo: fontes.some((fonte) => fonte.ve && fonte.consulta.isFetching),
    reler: () => relerDoZero(queryClient, fontes.filter((fonte) => fonte.ve).map((fonte) => fonte.chave)),
    falhaSoNaReleitura: fontes.every((fonte) => !fonte.ve || !fonte.consulta.isError || fonte.consulta.data !== undefined),
  };
}
