import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { InvoiceDocument } from "@/components/billing/invoice-document";
import { buildInvoiceView } from "@/lib/invoice-view";

import { ClientDataBoundary, EmptyModuleState, firstText, getInvoices } from "./shared";
import { FileX } from "lucide-react";
import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";

function competenciaFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("competencia") ?? "";
}

/** A fatura emitida, como documento para ler, imprimir ou salvar em PDF. */
export function ClienteFatura() {
  const competencia = competenciaFromUrl();
  return (
    <ClientDataBoundary>
      {(overview) => {
        const invoice = getInvoices(overview).find(
          (item) => firstText(item.competencia, item.id, item.month) === competencia,
        ) as Record<string, unknown> | undefined;
        return (
          <div className="space-y-4">
            <Link href="/portal/faturas" className="no-print inline-flex items-center gap-2 text-sm text-primary">
              <ArrowLeft className="h-4 w-4" />
              Faturas
            </Link>
            {invoice ? (
              <InvoiceDocument
                competencia={competencia}
                view={buildInvoiceView(invoice)}
                customerName={firstText(invoice.customer_name, invoice.customer_code, LEGACY_CUSTOMER_CODE)}
                issuedAt={firstText(invoice.emitido_em, invoice.issued_at) ?? null}
              />
            ) : (
              <EmptyModuleState
                title="Fatura não encontrada"
                description="Esta competência ainda não foi emitida ou não pertence à sua conta."
                icon={FileX}
              />
            )}
          </div>
        );
      }}
    </ClientDataBoundary>
  );
}
