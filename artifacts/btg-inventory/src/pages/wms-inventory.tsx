/** Dedicated WMS Inventário screen (opening + cycle count). */

import { ClipboardCheck } from "lucide-react";
import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";

export default function WmsInventoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
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
