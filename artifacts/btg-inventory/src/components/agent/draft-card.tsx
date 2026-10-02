import { parseDraft, parseRoutineDraft } from "@/lib/agent-draft";

import { OrderDraftCard } from "./order-draft-card";
import { RoutineDraftCard } from "./routine-draft-card";
import { ShipmentDraftCard } from "./shipment-draft-card";

/**
 * Cartão do rascunho que o Agent Dute montou: pedido, aviso de envio ou
 * rotina. A pessoa confere, ajusta e confirma no próprio cartão; o agente não
 * envia nem cria nada.
 */
export function DraftCard({ value, messageId, sent }: { value: unknown; messageId?: string; sent?: unknown }) {
  const routine = parseRoutineDraft(value);
  if (routine) return <RoutineDraftCard draft={routine} messageId={messageId} sent={sent} />;
  const draft = parseDraft(value);
  if (!draft) return null;
  return draft.tipo === "pedido" ? (
    <OrderDraftCard draft={draft} messageId={messageId} sent={sent} />
  ) : (
    <ShipmentDraftCard draft={draft} messageId={messageId} sent={sent} />
  );
}
