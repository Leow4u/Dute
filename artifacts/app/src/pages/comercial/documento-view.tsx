import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";

import { OrcamentoDocumento } from "@/components/comercial/orcamento-documento";
import { Button } from "@/components/ui/button";
import type { DocumentoDoOrcamento } from "@/lib/comercial/documento";

/**
 * O documento A4 do orçamento (docs/mockups/ComDocumento.dc.html), só a
 * apresentação: a barra de cima (que não sai na impressão) e o papel. Os
 * dados chegam por props (pages/comercial/documento.tsx). Sem legenda; uma
 * ação: "Imprimir / Salvar PDF".
 */

export type DocumentoViewProps = {
  estado: "carregando" | "nao_encontrado" | "erro" | "pronto";
  documento: DocumentoDoOrcamento | null;
  /** A montagem do orçamento, para voltar. */
  voltarHref: string | null;
  onImprimir: () => void;
};

export function DocumentoView({ estado, documento, voltarHref, onImprimir }: DocumentoViewProps) {
  const mensagem =
    estado === "carregando"
      ? "Carregando..."
      : estado === "erro"
        ? "Não foi possível carregar o orçamento."
        : estado === "nao_encontrado" || !documento
          ? "Orçamento não encontrado"
          : null;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <div className="no-print flex flex-wrap items-center gap-3">
        {voltarHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={voltarHref}>
              <ArrowLeft aria-hidden="true" />
              Orçamento
            </Link>
          </Button>
        ) : null}
        {documento ? <h1 className="text-xl font-extrabold tabular-nums tracking-tight">{documento.titulo}</h1> : null}
        <Button type="button" className="ml-auto" onClick={onImprimir} disabled={!documento || Boolean(mensagem)}>
          <Printer aria-hidden="true" />
          Imprimir / Salvar PDF
        </Button>
      </div>
      {mensagem ? (
        <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">{mensagem}</p>
      ) : documento ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <OrcamentoDocumento documento={documento} />
        </div>
      ) : null}
    </div>
  );
}
