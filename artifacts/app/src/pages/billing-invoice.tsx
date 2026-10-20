import { useGetBillingPeriod } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { InvoiceDocument } from "@/components/billing/invoice-document";
import { currentCompetencia } from "@/lib/billing-format";
import { buildInvoiceView } from "@/lib/invoice-view";
import { humanApiError } from "@/lib/permissions";

function competenciaFromUrl() {
  if (typeof window === "undefined") return currentCompetencia();
  const value = new URLSearchParams(window.location.search).get("competencia");
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentCompetencia();
}

/**
 * A fatura da competência como a cliente vai ver. Aberta = prévia com o
 * cálculo da emissão; emitida = snapshot congelado.
 */
export default function BillingInvoice() {
  const competencia = competenciaFromUrl();
  const { data, isLoading, error } = useGetBillingPeriod(competencia);
  const period = data as unknown as
    | { status?: string; emitido_em?: string | null }
    | undefined;

  return (
    <div className="space-y-4">
      <Link
        href={`/faturamento?competencia=${competencia}`}
        className="no-print inline-flex items-center gap-2 text-sm text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Fechamento do mês
      </Link>
      {error ? (
        <p className="text-sm text-destructive">
          {humanApiError(error, "Não consegui carregar a fatura.")}
        </p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando fatura...</p>
      ) : (
        <InvoiceDocument
          competencia={competencia}
          view={buildInvoiceView(data as unknown as Record<string, unknown>)}
          issuedAt={period?.emitido_em ?? null}
          draft={(period?.status ?? "aberto") === "aberto"}
        />
      )}
    </div>
  );
}
