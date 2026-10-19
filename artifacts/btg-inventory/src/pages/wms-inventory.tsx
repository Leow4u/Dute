import { PackageSearch } from "lucide-react";
import { Link } from "wouter";

import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useActiveCustomer } from "@/lib/active-customer-context";

export default function WmsInventoryPage() {
  // A contagem é do cliente ativo no menu: sessão, caixas e produtos são dele.
  const { active } = useActiveCustomer();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Contagem · ${active.name}`}
        description="Abertura do estoque e contagens cíclicas por endereço, do cliente ativo no menu"
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
