import { Link } from "wouter";
import { ArrowLeft, Download } from "lucide-react";

import { ComprovanteDocumento } from "@/components/portal/comprovante-documento";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, FaixaAoVivo, useTentandoNoRelogio } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import type { ComprovanteDaOs } from "@/lib/portal/comprovante";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/**
 * Portal › Minhas OS › Comprovante (parte 4.3d): a barra de cima, que não sai
 * no PDF, e o papel. Os dados chegam por props (pages/client/comprovante.tsx).
 * Sem legenda; uma ação: "Baixar PDF", a impressão do navegador.
 *
 * No carregamento v2 (parte 13f): lendo, a caixa e "Carregando o
 * comprovante…" aos 300 ms; a falha com "Tentar de novo"; o "Baixar PDF" espera
 * os endereços da assinatura e das fotos (travado no código, nunca disabled)
 * até a desistência dos 70 s, e a imagem que não veio fica dita, na barra e no
 * papel, nunca some.
 */

export type EstadoDoComprovante = "carregando" | "sem_comprovante" | "erro" | "pronto";

/** A leitura das imagens do papel (a assinatura e as fotos do final). */
export type FotosDoComprovante = {
  lendo: boolean;
  /** Os caminhos que não vieram. */
  falharam: readonly string[];
  tentando: boolean;
  onTentar: () => void;
};

function textoDaFalha(quantas: number) {
  return quantas === 1 ? "Uma imagem do comprovante não carregou." : `${quantas} imagens do comprovante não carregaram.`;
}

export function ComprovanteView({
  estado,
  numero,
  comprovante,
  urls,
  onBaixar,
  leitura,
  fotos,
}: {
  estado: EstadoDoComprovante;
  numero: string;
  comprovante: ComprovanteDaOs | null;
  urls: Readonly<Record<string, string>>;
  onBaixar: () => void;
  /** A nova tentativa da leitura da OS, e o que falta: a conexão (com a hora do lido) ou o servidor (parte 13j). */
  leitura?: { tentando: boolean; onTentar: () => void; falta?: "conexao" | "servidor" | null; lidaEm?: number | null };
  fotos?: FotosDoComprovante;
}) {
  const mensagem =
    estado === "carregando" || estado === "erro"
      ? null
      : estado === "sem_comprovante" || !comprovante
        ? `A OS ${numero} ainda não tem comprovante.`
        : null;
  const pronto = estado === "pronto" && Boolean(comprovante);
  // As imagens ainda chegando: o PDF sairia sem elas. A trava tem prazo: aos 70 s, a desistência da espera, o PDF
  // volta a sair com o que chegou, e a região diz que o servidor não respondeu, com "Tentar de novo".
  const lendoAsFotos = pronto && Boolean(fotos?.lendo);
  const desistiu = useEspera(lendoAsFotos).fase === "sem-resposta";
  // A nova tentativa no relógio: a que falha de novo antes de 300 ms não pisca o botão.
  const tentandoOComprovante = useTentandoNoRelogio(Boolean(leitura?.tentando));
  const esperaAsFotos = lendoAsFotos && !desistiu;
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
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {lendoAsFotos ? <CarregandoNaRegiao rotulo="Carregando as fotos…" onTentar={fotos?.onTentar} /> : null}
          <Button
            type="button"
            onClick={() => {
              if (!esperaAsFotos) onBaixar();
            }}
            disabled={!pronto}
            aria-disabled={esperaAsFotos || undefined}
            className={cn(esperaAsFotos && "opacity-45 hover:bg-primary")}
          >
            <Download aria-hidden="true" />
            Baixar PDF
          </Button>
        </div>
      </div>
      {pronto && fotos?.falharam.length ? (
        <FalhaNaSecao
          mensagem={textoDaFalha(fotos.falharam.length)}
          tentando={fotos.tentando}
          onTentar={fotos.onTentar}
          className="no-print rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3"
        />
      ) : null}
      {/* A OS lida sem conexão, com o comprovante ou sem ele: o que a tela diz pode ser velho, e a faixa diz de quando é. */}
      {(estado === "pronto" || estado === "sem_comprovante") && leitura ? (
        <FaixaAoVivo
          leitura={{ tentando: leitura.tentando, tentar: leitura.onTentar, falta: leitura.falta, lidaEm: leitura.lidaEm }}
          objeto={pronto ? "comprovante" : "OS"}
          className="no-print"
        />
      ) : null}
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo="Carregando o comprovante…" continuaARota onTentar={leitura?.onTentar} className="rounded-lg border border-border bg-card px-5 py-7" />
      ) : estado === "erro" ? (
        leitura?.falta === "conexao" ? (
          <BlocoSemConexao tentando={leitura.tentando} onTentar={leitura.onTentar} />
        ) : leitura ? (
          <ErroNaLeitura mensagem="Não foi possível carregar o comprovante." tentando={tentandoOComprovante} onTentar={leitura.onTentar} />
        ) : (
          <p role="alert" className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
            Não foi possível carregar o comprovante.
          </p>
        )
      ) : mensagem ? (
        <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">{mensagem}</p>
      ) : comprovante ? (
        // O papel tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela.
        <div className="overflow-x-auto rounded-lg border border-border">
          <ComprovanteDocumento comprovante={comprovante} urls={urls} faltando={fotos?.falharam} />
        </div>
      ) : null}
    </div>
  );
}
