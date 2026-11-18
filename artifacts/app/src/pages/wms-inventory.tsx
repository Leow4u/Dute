import { useEffect } from "react";
import { Boxes, PackageSearch, Printer, Scale } from "lucide-react";
import { Link, useLocation } from "wouter";

import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";
import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { ROTA_DO_RELATORIO_CAIXAS_SALDO, hrefDaFolha } from "@/lib/warehouse-ops/contagem-por-caixa";
import { ROTA_DA_RODADA } from "@/lib/warehouse-ops/recontagem-por-caixa";

/** A entrada da Contagem, para onde esta tela volta quando a sessão de abertura conclui. */
const ROTA_DA_CONTAGEM = "/wms/contagem";

/**
 * A tela da abertura e da cíclica (as abas), em /wms/contagem/abertura desde
 * 18/11/2026: a entrada da Contagem manda para cá o cliente com a abertura
 * pendente ou em curso. Com a sessão concluída (também logo depois de
 * "Confirmar encerramento"), volta para a entrada; a sessão que falha fica
 * aqui, com o "Tentar de novo" da abertura.
 */
export default function WmsInventoryPage() {
  // A contagem é do cliente ativo no menu: sessão, caixas e produtos são dele.
  const { active } = useActiveCustomer();
  const sessao = useOpeningInventorySession();
  const [, navegar] = useLocation();
  const concluida = sessao.data?.status === "completed";
  useEffect(() => {
    if (concluida) navegar(ROTA_DA_CONTAGEM, { replace: true });
  }, [concluida, navegar]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Contagem · ${active.name}`}
        description="Abertura do estoque e contagens cíclicas por endereço, do cliente ativo no menu"
        actions={
          <>
            {/* A recontagem caixa a caixa: a rodada por prateleira e a bancada (contagem por caixa, seção 6, item 4). */}
            <Button asChild>
              <Link href={ROTA_DA_RODADA}>
                <Boxes className="size-4" />
                Contagem por caixa
              </Link>
            </Button>
            {/* A folha por rua e a regra de ouro por prateleira, só leitura (contagem por caixa, seção 6, item 1). */}
            <Button asChild variant="outline">
              <Link href={hrefDaFolha()}>
                <Printer className="size-4" />
                Folha de contagem
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={ROTA_DO_RELATORIO_CAIXAS_SALDO}>
                <Scale className="size-4" />
                Caixas × saldo
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/estoque">
                <PackageSearch className="size-4" />
                Ver itens
              </Link>
            </Button>
          </>
        }
      />
      <CycleCountWorkspace />
    </div>
  );
}
