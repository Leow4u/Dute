import { useEffect } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useAberturaAberta } from "@/lib/abertura";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** "Abrindo Faturamento…"; sem o nome da tela, a entrada: "Abrindo a Dutelog…". */
export function rotuloDaCarregandoTela(titulo?: string | null): string {
  const nome = titulo?.trim();
  return nome ? `Abrindo ${nome}…` : "Abrindo a Dutelog…";
}

/**
 * A tela que ainda abre (carregamento v2, seção 9): o arquivo da tela que
 * chega pela rede, o perfil que ainda não veio, a rota que espera o cliente.
 * Antes de 300 ms nada aparece; depois, a caixa de 40 px e "Abrindo
 * Faturamento…", com o anúncio na região do `Anunciador`. Depois de 10 s, a
 * volta fica calma. No lugar do "Carregando..." solto e do branco dos
 * `fallback={null}`.
 *
 * Enquanto a abertura do index.html cobre a tela, nada é anunciado: ela já
 * diz "Abrindo a Dutelog". A área reserva a altura da tela, para o conteúdo
 * não pular quando chegar.
 */
export function CarregandoTela({ titulo, className }: { titulo?: string | null; className?: string }) {
  const espera = useEspera(true);
  const anunciar = useAnuncio();
  const aberturaAberta = useAberturaAberta();
  const rotulo = rotuloDaCarregandoTela(titulo);

  useEffect(() => {
    if (espera.visivel && !aberturaAberta) anunciar(rotulo);
  }, [espera.visivel, aberturaAberta, anunciar, rotulo]);

  return (
    <div
      data-carregando-tela=""
      className={cn("flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 text-center", className)}
    >
      {espera.visivel ? (
        <>
          <Spinner tamanho={40} calmo={espera.calmo} className="text-foreground" />
          <p className="text-base font-bold text-foreground">{rotulo}</p>
        </>
      ) : null}
    </div>
  );
}
