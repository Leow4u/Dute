import { ReturnWorkspace } from "@/features/warehouse-ops/exceptions";
import { RetornosDaOperacao } from "@/features/warehouse-ops/order-returns";
import { PageHeader } from "@/components/ui/page-header";
import { useAppUser } from "@/lib/auth";
import { canOperateWarehouse } from "@/lib/permissions";

export default function WmsReturnsPage() {
  // O suporte consulta os retornos; registrar e dar destino é de quem opera o armazém.
  const { user } = useAppUser();
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Devoluções" />
      <RetornosDaOperacao somenteConsulta={!operador} />
      {operador ? <ReturnWorkspace /> : null}
    </div>
  );
}
