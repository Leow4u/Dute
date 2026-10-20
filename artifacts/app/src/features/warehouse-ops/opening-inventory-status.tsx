/**
 * Sessão do inventário de abertura e o aviso que as telas internas mostram
 * enquanto ela está pendente ou em curso. Fica fora de `inventory.tsx` para
 * que Estoque › Itens e o formulário de SKU leiam o estado sem carregar os
 * dois formulários de contagem.
 */

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageOpen } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  openingInventoryNotice,
  type OpeningInventorySummary,
} from "@/lib/opening-inventory";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/warehouse-ops/model";
import { useActiveCustomer } from "@/lib/active-customer-context";

export type OpeningInventoryLine = {
  id: string;
  client_item_code?: string;
  sku_code?: string;
  product_name?: string;
  category?: string;
  genero?: string;
  grupo?: string;
  location_id?: string;
  /** Caixa em que o produto foi guardado (CX-000001); vazio nas linhas antigas. */
  box_code?: string;
  counted_qty?: number;
  unit_cost?: number;
  total_cost?: number;
};

export type OpeningInventorySession = OpeningInventorySummary & {
  ok?: boolean;
  id?: string;
  session_id?: string;
  total_cost?: number;
  started_at?: string;
  completed_at?: string;
  lines?: OpeningInventoryLine[];
};

/** A mesma chave que as mutações do inventário invalidam. */
export const OPENING_INVENTORY_SESSION_KEY = ["opening-inventory-session"];

/** Sessão de abertura do cliente ativo (cada cliente tem a sua). */
export function useOpeningInventorySession() {
  const { code } = useActiveCustomer();
  return useQuery<OpeningInventorySession>({
    queryKey: [...OPENING_INVENTORY_SESSION_KEY, code],
    queryFn: () =>
      fetchJson<OpeningInventorySession>(
        `/api/warehouse/opening-inventory/session/${encodeURIComponent(code)}`,
      ),
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Faixa de estado da abertura: atenção quando ainda não começou, informação
 * enquanto a contagem anda. Sem sessão ou depois da conclusão, não aparece.
 */
export function OpeningInventoryNotice({
  session,
  actions,
  className,
}: {
  session: OpeningInventorySummary | undefined;
  actions?: ReactNode;
  className?: string;
}) {
  const notice = openingInventoryNotice(session);
  if (!notice) return null;
  const Icon = notice.tone === "warning" ? AlertTriangle : PackageOpen;
  return (
    <Alert
      className={cn(
        notice.tone === "warning"
          ? "border-warning-soft-border bg-warning-soft text-warning-soft-foreground [&>svg]:text-warning-soft-foreground"
          : "border-info-soft-border bg-info-soft text-info-soft-foreground [&>svg]:text-info-soft-foreground",
        className,
      )}
    >
      <Icon className="size-4" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription
        className={cn(
          "flex flex-col gap-3",
          actions && "sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <span>{notice.description}</span>
        {actions ? <span className="flex flex-wrap gap-2">{actions}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
