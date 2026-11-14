import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";

import { NfDocumento } from "@/components/financeiro/nf-documento";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { SEM_NOVA_TENTATIVA, type NovaTentativa } from "@/lib/operacao/leitura";
import { cn } from "@/lib/utils";
import type { DemonstrativoDaNf } from "@/lib/financeiro/nf-documento";

/**
 * A via comercial da NF para imprimir (parte 4.2d): a barra de cima (que não
 * sai na impressão) e o papel. Os dados chegam por props
 * (pages/financeiro/nf.tsx). Sem legenda; uma ação: "Imprimir".
 */

export type EstadoDaVia = "carregando" | "nao_encontrada" | "erro" | "pronto";

export function NfView({
  estado,
  documento,
  voltar,
  onImprimir,
  leitura = SEM_NOVA_TENTATIVA,
}: {
  estado: EstadoDaVia;
  documento: DemonstrativoDaNf | null;
  /** A lista com a NF aberta no painel. */
  voltar: string;
  onImprimir: () => void;
  /** A nova tentativa das leituras da NF (parte 13g). */
  leitura?: NovaTentativa;
}) {
  const caixa = "rounded-lg border border-border bg-card px-5 py-7";
  const mensagem = estado === "carregando" || estado === "erro" ? null : estado === "nao_encontrada" || !documento ? "NF não encontrada" : null;
  const pronto = estado === "pronto" && Boolean(documento) && !mensagem;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={voltar}>
            <ArrowLeft aria-hidden="true" />
            Faturas
          </Link>
        </Button>
        <h1 className="text-xl font-bold tracking-tight">{documento ? `Via comercial da ${documento.titulo}` : "Via comercial"}</h1>
        <Button type="button" className="ml-auto" onClick={onImprimir} disabled={!pronto}>
          <Printer aria-hidden="true" />
          Imprimir
        </Button>
      </div>
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo="Carregando a NF…" continuaARota onTentar={leitura.tentar} className={caixa} />
      ) : estado === "erro" ? (
        <FalhaNaSecao mensagem="Não foi possível carregar a NF." tentando={leitura.tentando} onTentar={leitura.tentar} className={caixa} />
      ) : mensagem ? (
        <p className={cn(caixa, "text-center text-sm font-semibold text-muted-foreground")}>{mensagem}</p>
      ) : documento ? (
        // O papel tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela.
        <div className="overflow-x-auto rounded-lg border border-border">
          <NfDocumento documento={documento} />
        </div>
      ) : null}
    </div>
  );
}
