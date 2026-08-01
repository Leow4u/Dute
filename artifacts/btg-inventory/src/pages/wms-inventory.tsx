/** Dedicated WMS Inventário screen (opening + cycle count). */

import { ClipboardCheck } from "lucide-react";
import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";

export default function WmsInventoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
          <ClipboardCheck className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            Inventário do estoque
          </h1>
        </div>
      </div>
      <CycleCountWorkspace />
    </div>
  );
}
