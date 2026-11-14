import { AlertTriangle, BookOpenCheck, ClipboardList, Hourglass, NotebookPen, PackageCheck, Sparkles, Truck, type LucideIcon } from "lucide-react";

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
  "agent-notes": NotebookPen,
  "agent-playbooks": BookOpenCheck,
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

/**
 * Os números do dia. `skus` nulo: o total não foi lido (o painel); com
 * `skusLendo`, ainda lê, e a linha mostra o bloco, nunca o zero. `lido`
 * falso: o armazém não foi lido (a leitura falhou), e os quatro números do
 * dia ficam "—", nunca o zero do resumo vazio.
 */
export type HojeNoArmazem = HomeSummary & { skus: number | null; skusLendo?: boolean; lido?: boolean };
