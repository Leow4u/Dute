import { useEffect, useState } from "react";

/** No máximo um anúncio a cada 2 s. */
export const INTERVALO_DO_ANUNCIO_MS = 2_000;

type Falar = (texto: string) => void;

/** Os anunciadores na página; fala o último que montou (o App monta um só). */
const regioes: Falar[] = [];

function anunciar(texto: string) {
  regioes[regioes.length - 1]?.(texto);
}

/**
 * Fala pela região viva da tela, só para o leitor de tela, com até seis
 * palavras: a entrada na espera (aos 300 ms), o aviso de 10 s, a desistência,
 * a falta de conexão e o primeiro passo do Agent Dute. Os resultados das
 * ações saem pelo toast.
 */
export function useAnuncio(): (texto: string) => void {
  return anunciar;
}

/**
 * A região viva do carregamento (carregamento v2, seção 7): uma por tela,
 * montada desde o início no App, fora das rotas, para já estar na página
 * quando a primeira espera falar. Nunca `aria-live` na lista, no botão ou na
 * resposta do agente.
 *
 * No máximo um anúncio a cada 2 s. O que chega dentro do intervalo espera o
 * fim dele, e só o último vale: o leitor de tela não fica lendo frase velha.
 * O mesmo texto dentro do intervalo não repete; depois dele, entra como texto
 * novo e é falado de novo.
 */
export function Anunciador() {
  const [anuncio, setAnuncio] = useState<{ id: number; texto: string } | null>(null);

  useEffect(() => {
    let id = 0;
    let atual: string | null = null;
    let faladoEm = Number.NEGATIVE_INFINITY;
    let pendente: string | null = null;
    let espera: ReturnType<typeof setTimeout> | null = null;

    const dizer = (texto: string) => {
      id += 1;
      atual = texto;
      faladoEm = performance.now();
      setAnuncio({ id, texto });
    };

    const falar: Falar = (bruto) => {
      const texto = bruto.replace(/\s+/g, " ").trim();
      if (!texto) return;
      const instante = performance.now();
      const livreEm = faladoEm + INTERVALO_DO_ANUNCIO_MS;
      if (espera === null && instante >= livreEm) {
        dizer(texto);
        return;
      }
      pendente = texto === atual ? null : texto;
      if (espera === null && pendente !== null) {
        espera = setTimeout(() => {
          espera = null;
          const proximo = pendente;
          pendente = null;
          if (proximo !== null) dizer(proximo);
        }, livreEm - instante);
      }
    };

    regioes.push(falar);
    return () => {
      const posicao = regioes.indexOf(falar);
      if (posicao >= 0) regioes.splice(posicao, 1);
      if (espera !== null) clearTimeout(espera);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-anunciador="">
      {anuncio ? <span key={anuncio.id}>{anuncio.texto}</span> : null}
    </div>
  );
}
