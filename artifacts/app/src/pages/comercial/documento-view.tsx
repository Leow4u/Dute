import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";

import { OrcamentoDocumento } from "@/components/comercial/orcamento-documento";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FaixaAoVivo, FalhaAoVivo } from "@/components/ui/erro-na-leitura";
import { SEM_NOVA_TENTATIVA, type NovaTentativa } from "@/lib/comercial/leitura";
import { cn } from "@/lib/utils";
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
  /** Para onde voltar: a montagem do orçamento ou a aprovação (lib/comercial/documento.ts, voltarDoDocumento). */
  voltar: { href: string; rotulo: string } | null;
  onImprimir: () => void;
  /** A nova tentativa das leituras do documento (parte 13g). */
  leitura?: NovaTentativa;
};

export function DocumentoView({ estado, documento, voltar, onImprimir, leitura = SEM_NOVA_TENTATIVA }: DocumentoViewProps) {
  const caixa = "rounded-lg border border-border bg-card px-5 py-7";
  const mensagem = estado === "carregando" || estado === "erro" ? null : estado === "nao_encontrado" || !documento ? "Orçamento não encontrado" : null;
  const pronto = estado === "pronto" && Boolean(documento) && !mensagem;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <div className="no-print flex flex-wrap items-center gap-3">
        {voltar ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={voltar.href}>
              <ArrowLeft aria-hidden="true" />
              {voltar.rotulo}
            </Link>
          </Button>
        ) : null}
        {documento ? <h1 className="text-xl font-extrabold tabular-nums tracking-tight">{documento.titulo}</h1> : null}
        <Button type="button" className="ml-auto" onClick={onImprimir} disabled={!pronto}>
          <Printer aria-hidden="true" />
          Imprimir / Salvar PDF
        </Button>
      </div>
      {pronto ? <FaixaAoVivo leitura={leitura} className="no-print" /> : null}
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo="Carregando o orçamento…" continuaARota onTentar={leitura.tentar} className={caixa} />
      ) : estado === "erro" ? (
        <FalhaAoVivo leitura={leitura} mensagem="Não foi possível carregar o orçamento." className={caixa} />
      ) : mensagem ? (
        <p className={cn(caixa, "text-center text-sm font-bold text-muted-foreground")}>{mensagem}</p>
      ) : documento ? (
        // O papel tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela.
        <div className="overflow-x-auto rounded-lg border border-border">
          <OrcamentoDocumento documento={documento} />
        </div>
      ) : null}
    </div>
  );
}
