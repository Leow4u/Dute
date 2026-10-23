import { ReturnWorkspace } from "@/features/warehouse-ops/exceptions";
import { RetornosDaOperacao } from "@/features/warehouse-ops/order-returns";
import { PageHeader } from "@/components/ui/page-header";

export default function WmsReturnsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Devoluções" />
      <RetornosDaOperacao />
      <ReturnWorkspace />
    </div>
  );
}
