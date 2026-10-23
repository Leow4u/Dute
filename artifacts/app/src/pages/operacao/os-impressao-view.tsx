import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";

import { OsDocumento } from "@/components/operacao/os-documento";
import { Button } from "@/components/ui/button";
import { hrefDaFichaDaOs } from "@/lib/operacao/navegacao";
import type { DocumentoDaOs } from "@/lib/operacao/os-documento";

/**
 * A OS impressa, via operacional (parte 3.9d; docs/mockups/OSImpressao.dc.html):
 * a barra de cima (que não sai na impressão) e o papel. Os dados chegam por
 * props (pages/operacao/os-impressao.tsx). Sem legenda; uma ação: "Imprimir".
 */

export type EstadoDaImpressao = "carregando" | "nao_encontrada" | "erro" | "pronto";

export function OsImpressaoView({
  estado,
  numero,
  documento,
  urlDaAssinatura,
  onImprimir,
}: {
  estado: EstadoDaImpressao;
  numero: string;
  documento: DocumentoDaOs | null;
  urlDaAssinatura: string | null;
  onImprimir: () => void;
}) {
  const mensagem =
    estado === "carregando" ? "Carregando" : estado === "erro" ? "Não foi possível carregar a OS." : estado === "nao_encontrada" || !documento ? `OS ${numero} não encontrada` : null;
  return (
    <div className="flex flex-col gap-5 text-foreground">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={hrefDaFichaDaOs(numero)}>
            <ArrowLeft aria-hidden="true" />
            OS {numero}
          </Link>
        </Button>
        <h1 className="text-xl font-bold tracking-tight">Imprimir OS {numero}</h1>
        <Button type="button" className="ml-auto" onClick={onImprimir} disabled={!documento || Boolean(mensagem)}>
          <Printer aria-hidden="true" />
          Imprimir
        </Button>
      </div>
      {mensagem ? (
        <p role={estado === "erro" ? "alert" : undefined} className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
          {mensagem}
        </p>
      ) : documento ? (
        // O papel tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela.
        <div className="overflow-x-auto rounded-lg border border-border">
          <OsDocumento documento={documento} urlDaAssinatura={urlDaAssinatura} />
        </div>
      ) : null}
    </div>
  );
}
