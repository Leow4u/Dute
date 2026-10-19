import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { competenciaLabel, fmtBRL, fmtNum } from "@/lib/billing-format";
import type { InvoiceView } from "@/lib/invoice-view";
import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";

/**
 * A fatura como documento: é o que a cliente vê no portal e o que sai no
 * PDF (Imprimir → Salvar como PDF). Não há gerador de PDF no servidor; o
 * navegador imprime só a área .print-area (ver index.css).
 */

function lastDay(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  if (!year || !month) return "";
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function dateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function InvoiceDocument({
  competencia,
  view,
  customerName = LEGACY_CUSTOMER_CODE,
  issuedAt,
  draft,
}: {
  competencia: string;
  view: InvoiceView;
  customerName?: string;
  issuedAt?: string | null;
  draft?: boolean;
}) {
  const [year, month] = competencia.split("-");
  const issued = dateLabel(issuedAt);
  const adValorem = view.groups
    .flatMap((group) => group.lines)
    .find((line) => line.adValorem);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {draft
            ? "Prévia: os valores podem mudar até a emissão."
            : issued
              ? `Emitida em ${issued}.`
              : null}
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir / Salvar PDF
        </Button>
      </div>

      <article className="print-area mx-auto max-w-[820px] rounded-md bg-white p-8 text-sm text-slate-800 sm:p-10">
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
          <img src="/dutelog-logo.png" alt="Dutelog" className="h-8" />
          <div className="text-right text-xs leading-5 text-slate-500">
            <div className="text-lg font-semibold text-slate-800">
              Fatura de serviços logísticos
            </div>
            Competência {competenciaLabel(competencia).toLowerCase()}
            <br />
            Nº {competencia}
            {issued ? ` · emitida em ${issued}` : draft ? " · prévia, não emitida" : ""}
          </div>
        </header>

        <div className="my-5 grid grid-cols-1 gap-3 text-xs text-slate-500 sm:grid-cols-3">
          <div>
            Cliente
            <b className="block text-sm text-slate-800">{customerName}</b>
          </div>
          <div>
            Período
            <b className="block text-sm text-slate-800">
              01/{month}/{year} a {lastDay(competencia)}
            </b>
          </div>
          {adValorem ? (
            <div>
              Base do Ad Valorem
              <b className="block text-sm text-slate-800">{fmtBRL(adValorem.qtde)}</b>
            </div>
          ) : null}
        </div>

        {view.groups.length ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2 font-semibold">Serviço</th>
                <th className="py-1.5 pr-2 font-semibold">Unidade</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Qtde</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Valor unit.</th>
                <th className="py-1.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            {view.groups.map((group) => (
              <tbody key={group.key}>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={4} className="px-1.5 pb-1 pt-2">
                    {group.label}
                  </td>
                  <td className="px-1.5 pb-1 pt-2 text-right tabular-nums">{fmtBRL(group.total)}</td>
                </tr>
                {group.lines.map((line, index) => (
                  <tr key={`${group.key}-${index}`} className="border-b border-slate-100">
                    <td className="px-1.5 py-1.5">{line.item}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{line.unidade}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.adValorem ? fmtBRL(line.qtde) : fmtNum(line.qtde)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.adValorem ? `${fmtNum(line.valorUnit * 100)}%` : fmtBRL(line.valorUnit)}
                    </td>
                    <td className="px-1.5 py-1.5 text-right tabular-nums">{fmtBRL(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-slate-500">
            Nenhum serviço com quantidade nesta competência.
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <div className="flex min-w-[260px] justify-between border-t-2 border-slate-800 pt-2 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{fmtBRL(view.total)}</span>
          </div>
        </div>

        <footer className="mt-6 text-xs leading-5 text-slate-400">
          Somente serviços com quantidade no mês aparecem na fatura. Documento gerado pelo sistema
          Dutelog a partir do fechamento da competência; o mesmo conteúdo fica disponível para a
          cliente em Faturas no portal.
        </footer>
      </article>
    </div>
  );
}
