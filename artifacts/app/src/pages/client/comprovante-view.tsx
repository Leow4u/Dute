import { Link } from "wouter";
import { ArrowLeft, Download } from "lucide-react";

import { ComprovanteDocumento } from "@/components/portal/comprovante-documento";
import { Button } from "@/components/ui/button";
import type { ComprovanteDaOs } from "@/lib/portal/comprovante";

/**
 * Portal › Minhas OS › Comprovante (parte 4.3d): a barra de cima, que não sai
 * no PDF, e o papel. Os dados chegam por props (pages/client/comprovante.tsx).
 * Sem legenda; uma ação: "Baixar PDF", a impressão do navegador.
 */

export type EstadoDoComprovante = "carregando" | "sem_comprovante" | "erro" | "pronto";

export function ComprovanteView({
  estado,
  numero,
  comprovante,
  urls,
  onBaixar,
}: {
  estado: EstadoDoComprovante;
  numero: string;
  comprovante: ComprovanteDaOs | null;
  urls: Readonly<Record<string, string>>;
  onBaixar: () => void;
}) {
  const mensagem =
    estado === "carregando"
      ? "Carregando"
      : estado === "erro"
        ? "Não foi possível carregar o comprovante."
        : estado === "sem_comprovante" || !comprovante
          ? `A OS ${numero} ainda não tem comprovante.`
          : null;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 text-foreground md:px-8">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/portal/servicos?os=${encodeURIComponent(numero)}`}>
            <ArrowLeft aria-hidden="true" />
            Minhas OS
          </Link>
        </Button>
        <h1 className="text-xl font-bold tracking-tight">Comprovante da OS {numero}</h1>
        <Button type="button" className="ml-auto" onClick={onBaixar} disabled={!comprovante || Boolean(mensagem)}>
          <Download aria-hidden="true" />
          Baixar PDF
        </Button>
      </div>
      {mensagem ? (
        <p role={estado === "erro" ? "alert" : undefined} className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
          {mensagem}
        </p>
      ) : comprovante ? (
        // O papel tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela.
        <div className="overflow-x-auto rounded-lg border border-border">
          <ComprovanteDocumento comprovante={comprovante} urls={urls} />
        </div>
      ) : null}
    </div>
  );
}
