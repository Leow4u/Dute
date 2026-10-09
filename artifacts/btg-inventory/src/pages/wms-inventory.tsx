import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";
import { PageHeader } from "@/components/ui/page-header";

export default function WmsInventoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contagem"
        description="A contagem de abertura do go-live e as contagens cíclicas por endereço"
      />
      <CycleCountWorkspace />
    </div>
  );
}
