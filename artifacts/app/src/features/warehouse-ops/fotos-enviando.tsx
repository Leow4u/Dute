import { useCallback, useMemo, useState } from "react";

import { ProgressoDasFotos } from "@/components/ui/progresso-das-fotos";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEnvioDeFotos, type EnvioDeFotos, type OpcoesDoEnvio } from "@/lib/carregando/use-envio-de-fotos";
import { FOTOS_POR_VEZ } from "@/lib/envio-de-fotos";

/** O limite do catálogo: um produto fica com até 8 fotos. */
export const FOTOS_POR_PRODUTO = 8;

/** Quando a escolha passou do que sobe de cada vez. */
export const SO_QUATRO_POR_VEZ = `Só ${FOTOS_POR_VEZ} fotos sobem por vez.`;
/** Quando a escolha passou do que cabe no produto. */
export const ATE_OITO_POR_PRODUTO = `Até ${FOTOS_POR_PRODUTO} fotos por produto.`;

export interface FotosDoProduto<T> extends EnvioDeFotos<T> {
  /** O aviso da escolha que passou do limite; some na escolha seguinte. */
  aviso: string | null;
  /**
   * Leva as fotos escolhidas: no máximo 4 de cada vez (como antes) e no
   * máximo as `vagas` que o produto ainda tem. O que passou do limite não
   * sobe, e a tela diz por quê.
   */
  escolher: (arquivos: readonly File[], vagas?: number) => void;
}

/**
 * As fotos do produto no WMS (Receber, Contagem e a ficha do item;
 * carregamento v2, parte 11): compactadas e uma de cada vez, com a contagem e
 * os bytes, a que falha com o próprio "Tentar de novo", e o limite de 4 por
 * escolha dito na tela e pelo Anunciador, no lugar do corte calado.
 */
export function useFotosDoProduto<T>(opcoes: OpcoesDoEnvio<T>): FotosDoProduto<T> {
  const envio = useEnvioDeFotos(opcoes);
  const [aviso, setAviso] = useState<string | null>(null);
  const anunciar = useAnuncio();
  const { enviar } = envio;
  const escolher = useCallback(
    (arquivos: readonly File[], vagas: number = FOTOS_POR_VEZ) => {
      const cabem = Math.max(0, Math.min(FOTOS_POR_VEZ, Math.floor(vagas)));
      const levadas = arquivos.slice(0, cabem);
      const corte = arquivos.length > levadas.length ? (cabem < FOTOS_POR_VEZ ? ATE_OITO_POR_PRODUTO : SO_QUATRO_POR_VEZ) : null;
      setAviso(corte);
      enviar(levadas);
      // O corte também é falado, depois do começo ("Enviando 4 fotos"); sem nenhuma levada, é o único anúncio.
      if (corte) anunciar(corte);
    },
    [enviar, anunciar],
  );
  return useMemo(() => ({ ...envio, aviso, escolher }), [envio, aviso, escolher]);
}

/** O progresso das fotos do produto, com o aviso da escolha que passou do limite. */
export function ProgressoDasFotosDoProduto<T>({ fotos, className }: { fotos: FotosDoProduto<T>; className?: string }) {
  return <ProgressoDasFotos fotos={fotos} aviso={fotos.aviso} className={className} />;
}
