import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useActiveCustomer } from "./active-customer-context";
import { relerDoZero } from "./carregando/reler-do-zero";
import { useLeituraComFalha } from "./carregando/use-leitura-com-falha";
import { semConexaoNaLeitura, type LeituraNaTela } from "./conexao";
import { playbooksKey } from "./agent-playbooks";
import { CHAVE_DAS_ANOTACOES, chaveNoAlvo, clienteDoNucleo } from "./agente/cliente";
import { revisaODoAgente } from "./agente/navegacao";
import { buildHomeInbox, type HomeAgentDecisions, type HomeInbox, type HomeRequest } from "./home-inbox";
import { MEMORIA_LIBERADA } from "./liberacao";
import { ALERTA_PARADO_ROLES, alertaLido, type AlertaProposto } from "./memoria/alertas";
import { canAccessModule, COORDINATION_NAV_ROLES, WMS_ROLES, type ProfileRole } from "./modules";
import type { WarehouseOpsResponse } from "./warehouse-ops/model";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Falha ao carregar dados.");
  }
  return response.json() as Promise<T>;
}

export type InicioDoWms = HomeInbox & {
  carregando: boolean;
  /** As fontes que não carregaram, em palavras ("armazém", "solicitações"). */
  falhas: string[];
  /**
   * Sem rede: a hora da leitura que está na tela, ou `null` quando ainda não
   * há nada lido (decisão 2 do celular). Sem falta de conexão, `null`.
   */
  semConexao: { lidaEm: number | null } | null;
  /** O armazém foi lido: sem ele, os números do dia não são afirmados (nem o zero). */
  armazemLido: boolean;
  /** Toda fonte que falhou já tinha sido lida: foi a releitura que falhou, e o aviso não fala (momento 7). */
  falhaSoNaReleitura: boolean;
  relendo: boolean;
  /** Relê todas as fontes, também a presa e a que falhou (o "Tentar de novo"); a promessa acaba com elas. */
  reler: () => Promise<void>;
};

/**
 * As leituras do Início do WMS (o armazém, as solicitações do portal, onde
 * a memória roda, os alertas de itens parados para aprovar e, para quem as
 * decide com o agente do núcleo, as anotações e os playbooks para aprovar do
 * cliente ativo). A entrada usa as mesmas chaves para o contador do card: a
 * leitura sai uma vez. `ligado` falso não consulta nada.
 */
export function useInicioDoWms(role: ProfileRole | null | undefined, ligado = true): InicioDoWms {
  const seesWarehouse = ligado && canAccessModule(role, WMS_ROLES);
  const seesRequests = ligado && canAccessModule(role, COORDINATION_NAV_ROLES);
  const seesAlerts = ligado && MEMORIA_LIBERADA && canAccessModule(role, ALERTA_PARADO_ROLES);
  const decidesAgent = ligado && revisaODoAgente(role);
  const { code } = useActiveCustomer();
  const queryClient = useQueryClient();
  const agente = useMemo(() => clienteDoNucleo("wms", code), [code]);
  const leituraDoArmazem = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    enabled: seesWarehouse,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const leituraDasSolicitacoes = useQuery({
    queryKey: ["customer-requests", "home"],
    queryFn: () => fetchJson<{ items?: HomeRequest[] }>("/api/customer-requests?limit=200"),
    enabled: seesRequests,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  // A mesma chave da tela Estoque › Alertas: a decisão lá atualiza o Início.
  const leituraDosAlertas = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => fetchJson<{ items?: Record<string, unknown>[] }>("/api/stock-alerts"),
    enabled: seesAlerts,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  // As mesmas chaves do Conhecimento e do painel do agente: a decisão lá atualiza o Início.
  const leituraDasAnotacoes = useQuery({
    queryKey: chaveNoAlvo(agente, CHAVE_DAS_ANOTACOES),
    queryFn: () => agente.anotacoes.listar(),
    enabled: decidesAgent,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  const leituraDosPlaybooks = useQuery({
    queryKey: chaveNoAlvo(agente, playbooksKey),
    queryFn: () => agente.playbooks.listar(),
    enabled: decidesAgent,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  // A fonte que falhou sem nada lido fica na falha enquanto é relida (o "Tentar de novo" e o intervalo de cada uma):
  // o react-query 5 a voltaria a "carregando", e o aviso com o botão sairia da tela com o foco nele, a cada minuto.
  const ops = useLeituraComFalha(leituraDoArmazem);
  const requests = useLeituraComFalha(leituraDasSolicitacoes);
  const alerts = useLeituraComFalha(leituraDosAlertas);
  const notes = useLeituraComFalha(leituraDasAnotacoes);
  const playbooks = useLeituraComFalha(leituraDosPlaybooks);
  const agentDecisions: HomeAgentDecisions | undefined = decidesAgent
    ? {
        notes: (notes.data?.notes ?? []).filter((nota) => nota.status === "pending").map((nota) => nota.text),
        playbooks: (playbooks.data?.playbooks ?? []).filter((playbook) => playbook.status === "pending").map((playbook) => playbook.title),
      }
    : undefined;
  const stockAlerts = (alerts.data?.items ?? [])
    .map(alertaLido)
    .filter((alerta): alerta is AlertaProposto => alerta !== null)
    .map((alerta) => ({ id: alerta.id, customer_code: alerta.customerCode, itens: alerta.itens.length }));
  const inbox = buildHomeInbox({ role, ops: ops.data, requests: requests.data?.items, stockAlerts, agentDecisions });
  // As anotações e os playbooks leem o Firestore direto, fora de lib/cloud-api.ts:
  // só as leituras de /api/* dizem que faltou conexão.
  const leiturasDaApi = [seesWarehouse ? ops : null, seesRequests ? requests : null, seesAlerts ? alerts : null].filter(
    (leitura): leitura is NonNullable<typeof leitura> => leitura !== null,
  ) as LeituraNaTela[];
  return {
    ...inbox,
    semConexao: semConexaoNaLeitura(...leiturasDaApi),
    armazemLido: seesWarehouse && ops.data !== undefined,
    falhaSoNaReleitura: [
      seesWarehouse ? ops : null,
      seesRequests ? requests : null,
      seesAlerts ? alerts : null,
      decidesAgent ? notes : null,
      decidesAgent ? playbooks : null,
    ].every((leitura) => !leitura || !leitura.isError || leitura.data !== undefined),
    relendo:
      ops.isFetching || requests.isFetching || alerts.isFetching || (decidesAgent && (notes.isFetching || playbooks.isFetching)),
    // Também as anotações e os playbooks do Agent Dute: a fonte que falhou é a que precisa ser relida.
    reler: () =>
      relerDoZero(queryClient, [
        ["warehouse-ops"],
        ["customer-requests", "home"],
        ["stock-alerts"],
        ...(decidesAgent ? [chaveNoAlvo(agente, CHAVE_DAS_ANOTACOES), chaveNoAlvo(agente, playbooksKey)] : []),
      ]),
    carregando:
      (seesWarehouse && ops.isLoading) || (seesRequests && requests.isLoading) || (seesAlerts && alerts.isLoading) || (decidesAgent && (notes.isLoading || playbooks.isLoading)),
    falhas: [
      seesWarehouse && ops.isError ? "armazém" : null,
      seesRequests && requests.isError ? "solicitações" : null,
      seesAlerts && alerts.isError ? "alertas" : null,
      decidesAgent && (notes.isError || playbooks.isError) ? "Agent Dute" : null,
    ].filter((fonte): fonte is string => Boolean(fonte)),
  };
}
