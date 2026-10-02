import { useMemo } from "react";

import { AgentScreen } from "@/components/agent/agent-screen";
import { AGENT_PATH, daySuggestions, type Suggestion } from "@/lib/agent-chat";
import { homeOrders, invoiceLines, orderTitle, ORDER_STEPS } from "@/lib/client-home";

import { ClientDataBoundary, getInventoryItems, getInvoices, getRequests, toNumber, type ClientOverview } from "./shared";

/** Agent Dute no portal: a tela única do agente, com sugestões do dia da conta. */

function suggestionsFor(overview: ClientOverview, now: Date): Suggestion[] {
  const requests = getRequests(overview) as Record<string, unknown>[];
  const active = homeOrders(requests).find(({ progress }) => !progress.rejected && progress.step < 4);
  const belowMinimum = (getInventoryItems(overview) as Record<string, unknown>[]).filter((item) => {
    const minimum = item.estoque_minimo;
    if (typeof minimum !== "number" || !Number.isFinite(minimum)) return false;
    const available = toNumber(item.qty_available ?? item.available ?? item.qty_on_hand);
    return available > 0 && available <= minimum;
  }).length;
  const lastIssued = invoiceLines(getInvoices(overview) as Record<string, unknown>[], now).find(
    (line) => line.amount !== undefined,
  );
  return daySuggestions(
    {
      activeOrder: active ? { title: orderTitle(active.request), stage: ORDER_STEPS[active.progress.step] } : null,
      belowMinimum,
      lastInvoice: lastIssued ? { label: lastIssued.label, detail: lastIssued.detail } : null,
    },
    now,
  );
}

export function ClienteAssistente() {
  return <ClientDataBoundary>{(overview) => <ClientAgent overview={overview} />}</ClientDataBoundary>;
}

function ClientAgent({ overview }: { overview: ClientOverview }) {
  const suggestions = useMemo(() => suggestionsFor(overview, new Date()), [overview]);
  return (
    <AgentScreen
      basePath={AGENT_PATH}
      suggestions={suggestions}
      intro="Eu consulto o estoque, os pedidos, as entregas e as faturas na Dutelog, em tempo real."
      placeholder="Pergunte sobre estoque, pedidos, entregas ou faturas…"
    />
  );
}
