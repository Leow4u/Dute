/** Dedicated WMS Devoluções screen. */

import { RotateCcw } from "lucide-react";
import { ReturnWorkspace } from "@/features/warehouse-ops/exceptions";

export default function WmsReturnsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-card/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
          <RotateCcw className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            Devoluções
          </h1>
        </div>
      </div>
      <ReturnWorkspace />
    </div>
  );
}
