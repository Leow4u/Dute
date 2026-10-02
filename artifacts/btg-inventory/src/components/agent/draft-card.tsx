import { parseDraft } from "@/lib/agent-draft";

import { OrderDraftCard } from "./order-draft-card";
import { ShipmentDraftCard } from "./shipment-draft-card";

/**
 * Cartão do rascunho que o Agent Dute montou: pedido ou aviso de envio. A
 * pessoa confere, ajusta e envia no próprio cartão; o agente não envia nada.
 */
export function DraftCard({ value, messageId, sent }: { value: unknown; messageId?: string; sent?: unknown }) {
  const draft = parseDraft(value);
  if (!draft) return null;
  return draft.tipo === "pedido" ? (
    <OrderDraftCard draft={draft} messageId={messageId} sent={sent} />
  ) : (
    <ShipmentDraftCard draft={draft} messageId={messageId} sent={sent} />
  );
}
