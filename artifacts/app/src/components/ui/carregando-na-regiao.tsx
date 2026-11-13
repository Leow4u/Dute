import { Clock3 } from "lucide-react";
import { useEffect } from "react";

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
 * calma e "Demorando mais que o normal", anunciado uma vez. A falha não é
 * daqui: quem lê mostra o `ErroNaLeitura` ou o `BlocoSemConexao`.
 *
 * A altura da linha fica reservada desde 0 ms, para o conteúdo de baixo não
 * pular quando o indicador entra.
 */
export function CarregandoNaRegiao({ rotulo, className }: { rotulo: string; className?: string }) {
  const espera = useEspera(true);
  const anunciar = useAnuncio();
  const marco = !espera.visivel ? null : espera.fase === "demorando" || espera.fase === "sem-resposta" ? "demorando" : "espera";

  // A espera que acabou (a lista chegou, ou passou à demora) retira o anúncio dela, se ele ainda esperava a vez.
  useEffect(() => {
    if (marco === "espera") return anunciar(rotulo.replace(/…$/, ""));
    if (marco === "demorando") return anunciar(DEMORANDO);
    return undefined;
  }, [marco, anunciar, rotulo]);

  return (
    <div data-carregando-na-regiao="" className={cn("flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2", className)}>
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
        </>
      ) : null}
    </div>
  );
}
