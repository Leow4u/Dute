import { AlertTriangle, ClipboardList, Hourglass, PackageCheck, Sparkles, Truck, type LucideIcon } from "lucide-react";

import type { HomeInboxItem, HomeSummary } from "./home-inbox";
import type { ItemDoInicio } from "./inicio-do-modulo";

/**
 * O Início da Armazenagem na v3 (docs/plataforma/fase-4-financeiro.md, parte
 * 4.7b): os itens do "Precisa de você" do WMS (lib/home-inbox.ts) com o ícone
 * de cada um, no formato do Início dos outros módulos, e os números do dia.
 */

const ICONE_DO_ITEM: Record<string, LucideIcon> = {
  triage: ClipboardList,
  "to-pick": ClipboardList,
  "to-ship": Truck,
  receipts: PackageCheck,
  agent: Sparkles,
  "stock-alerts": Hourglass,
};

const ICONE_DO_TOM: Record<HomeInboxItem["tone"], LucideIcon> = {
  critical: AlertTriangle,
  attention: ClipboardList,
  info: Truck,
  agent: Sparkles,
};

export function itensDoInicioDoWms(items: readonly HomeInboxItem[]): ItemDoInicio[] {
  return items.map((item) => ({ ...item, icon: ICONE_DO_ITEM[item.id] ?? ICONE_DO_TOM[item.tone] }));
}

export type HojeNoArmazem = HomeSummary & { skus: number };
