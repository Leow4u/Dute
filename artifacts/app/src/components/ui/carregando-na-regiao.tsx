import { Clock3, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DEMORANDO } from "@/components/ui/carregando-tela";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/**
 * A região da tela que ainda lê (carregamento v2, seção 3 e momento 1), no
 * lugar do "Carregando…" solto e do ícone girando: antes de 300 ms nada
 * aparece; depois, a caixa de 24 px e o rótulo no gerúndio ("Carregando
 * anotações…"), com o anúncio na região do `Anunciador`; aos 10 s, a volta
 * calma e "Demorando mais que o normal", anunciado uma vez, com "Tentar de
 * novo" quando quem lê sabe ler de novo (`onTentar`; 44 px, "Tentando de
 * novo…" enquanto relê). Quando o dado chega e a região sai com o foco nela,
 * o foco vai a `focoAoSair`, nunca ao `body`. A falha não é daqui:
 * quem lê mostra o `ErroNaLeitura` ou o `BlocoSemConexao`.
 *
 * A altura da linha fica reservada desde 0 ms, para o conteúdo de baixo não
 * pular quando o indicador entra.
 */
export function CarregandoNaRegiao({
  rotulo,
  className,
  onTentar,
  focoAoSair,
}: {
  rotulo: string;
  className?: string;
  /** A nova leitura, a partir dos 10 s: a que ficou presa é cancelada e lida de novo por quem lê. */
  onTentar?: () => Promise<unknown>;
  /** O id de quem recebe o foco quando a região sai com ele dentro (o "Tentar de novo" que deu certo). */
  focoAoSair?: string;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const alvoDoFoco = useRef(focoAoSair);
  alvoDoFoco.current = focoAoSair;
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (!elemento || typeof document === "undefined" || !elemento.contains(document.activeElement)) return;
      if (alvoDoFoco.current) document.getElementById(alvoDoFoco.current)?.focus({ preventScroll: true });
    };
  }, []);
  const espera = useEspera(true);
  const [tentando, setTentando] = useState(false);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const tentar = () => {
    if (tentando || !onTentar) return;
    setTentando(true);
    void Promise.resolve()
      .then(onTentar)
      .catch(() => undefined)
      .finally(() => {
        if (montada.current) setTentando(false);
      });
  };
  const anunciar = useAnuncio();
  const marco = !espera.visivel ? null : espera.fase === "demorando" || espera.fase === "sem-resposta" ? "demorando" : "espera";

  // A espera que acabou (a lista chegou, ou passou à demora) retira o anúncio dela, se ele ainda esperava a vez.
  useEffect(() => {
    if (marco === "espera") return anunciar(rotulo.replace(/…$/, ""));
    if (marco === "demorando") return anunciar(DEMORANDO);
    return undefined;
  }, [marco, anunciar, rotulo]);

  return (
    <div ref={raiz} data-carregando-na-regiao="" className={cn("flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {espera.visivel ? (
        <>
          <span className="flex items-center gap-2.5">
            <Spinner tamanho={24} calmo={espera.calmo} className="text-foreground" />
            <span className="text-sm font-bold text-foreground">{rotulo}</span>
          </span>
          {marco === "demorando" ? (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-sm font-bold text-amber-soft-foreground">
              <Clock3 className="size-3.5" aria-hidden="true" />
              {DEMORANDO}
            </span>
          ) : null}
          {marco === "demorando" && onTentar ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              aria-busy={tentando || undefined}
              aria-disabled={tentando || undefined}
              onClick={tentar}
            >
              {tentando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
              {tentando ? "Tentando de novo…" : "Tentar de novo"}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
