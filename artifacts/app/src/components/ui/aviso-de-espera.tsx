import { useEffect } from "react";
import { CircleAlert, Clock3, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { estimativaDaEspera, relogioDaEspera } from "@/lib/carregando/tempo";
import { cn } from "@/lib/utils";

/** O aviso de 10 s, o mesmo da leitura e da linha. */
export const DEMORANDO_MAIS = "Demorando mais que o normal";
/** A desistência da escrita aos 70 s: o servidor pode ter gravado ou não. */
export const SEM_CONFIRMACAO_DO_SERVIDOR = "Sem confirmação do servidor";
/** A desistência da leitura aos 70 s, a mesma do `ErroNaLeitura`. */
export const SEM_RESPOSTA_DO_SERVIDOR = "Sem resposta do servidor.";

export interface AvisoDeEsperaProps {
  /** `demorando` aos 10 s; `sem-resposta` na desistência, aos 70 s. */
  fase: "demorando" | "sem-resposta";
  /** Na leitura, repetir é seguro ("Tentar de novo"); na escrita, repetir duplicaria: só o aviso, e aos 70 s o "Conferir", que relê. */
  tipo: "leitura" | "escrita";
  /** Há quanto tempo a espera começou (o `decorridoMs` do `useEspera`): o "0:12", só visual. */
  desdeMs?: number;
  /** Quanto falta, quando o total é conhecido (os bytes das fotos): "cerca de 20 s", arredondado para cima. */
  restanteMs?: number;
  /** "Tentar de novo" ou "Conferir" já estão relendo. */
  tentando?: boolean;
  onTentar?: () => void;
  onConferir?: () => void;
  className?: string;
}

/**
 * O aviso da espera longa (carregamento v2, seção 9 e momento 6), no lugar
 * da espera muda depois de 10 s e do `deadline-exceeded` cru em inglês.
 *
 * - Aos 10 s, a pílula âmbar "Demorando mais que o normal · 0:12" (o relógio
 *   anda a cada segundo, fora de região viva), com a estimativa quando o
 *   total é conhecido ("· cerca de 20 s"). Na leitura vem com "Tentar de
 *   novo"; na escrita, só o aviso.
 * - Aos 70 s, na escrita, "Sem confirmação do servidor" e "Conferir", que
 *   relê e nunca reenvia; na leitura, "Sem resposta do servidor." e "Tentar
 *   de novo".
 *
 * Os botões têm 44 px. O Anunciador fala o aviso e a desistência, uma vez
 * cada; o relógio nunca.
 */
export function AvisoDeEspera({ fase, tipo, desdeMs, restanteMs, tentando = false, onTentar, onConferir, className }: AvisoDeEsperaProps) {
  const anunciar = useAnuncio();
  const desistencia = tipo === "escrita" ? SEM_CONFIRMACAO_DO_SERVIDOR : SEM_RESPOSTA_DO_SERVIDOR;
  // A espera que acaba (o aviso sai da tela) antes da vez do anúncio o tira da fila do Anunciador.
  useEffect(() => {
    const retirar = anunciar(fase === "demorando" ? DEMORANDO_MAIS : desistencia);
    return retirar;
  }, [fase, desistencia, anunciar]);

  const estimativa = fase === "demorando" && restanteMs !== undefined ? estimativaDaEspera(restanteMs) : null;
  const acao =
    fase === "sem-resposta" && tipo === "escrita"
      ? onConferir
        ? { rotulo: "Conferir", andamento: "Conferindo…", fazer: onConferir }
        : null
      : tipo === "leitura" && onTentar
        ? { rotulo: "Tentar de novo", andamento: "Tentando de novo…", fazer: onTentar }
        : null;

  return (
    <div data-aviso-de-espera={fase} className={cn("flex flex-wrap items-center gap-3", className)}>
      {fase === "demorando" ? (
        <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-warning-soft-border bg-warning-soft px-3 py-1.5 text-sm font-bold text-amber-soft-foreground">
          <Clock3 className="size-4 flex-none" aria-hidden="true" />
          {/* Os pedaços com o "·" antes de cada um (index.css): quando a pílula quebra, o do começo da linha some. */}
          <span className="carregando-aviso-itens">
            <span>
              <span>{DEMORANDO_MAIS}</span>
              {desdeMs !== undefined ? <span className="font-extrabold tabular-nums">{relogioDaEspera(desdeMs)}</span> : null}
              {estimativa ? <span>{estimativa}</span> : null}
            </span>
          </span>
        </span>
      ) : (
        <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-bold text-foreground">
          <CircleAlert className="size-4" aria-hidden="true" />
          {desistencia}
        </span>
      )}
      {acao ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-busy={tentando || undefined}
          aria-disabled={tentando || undefined}
          onClick={() => {
            if (!tentando) acao.fazer();
          }}
        >
          {tentando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
          {tentando ? acao.andamento : acao.rotulo}
        </Button>
      ) : null}
    </div>
  );
}
