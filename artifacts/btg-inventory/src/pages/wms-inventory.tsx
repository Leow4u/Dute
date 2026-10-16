import { PackageSearch } from "lucide-react";
import { Link } from "wouter";

import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export default function WmsInventoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contagem"
        description="Abertura do estoque e contagens cíclicas por endereço"
        actions={
          <Button asChild variant="outline">
            <Link href="/estoque">
              <PackageSearch className="size-4" />
              Ver itens
            </Link>
          </Button>
        }
      />
      <CycleCountWorkspace />
    </div>
  );
}
