import { useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from "react";

/**
 * O foco que segue o que entrou no lugar (carregamento v2, seção 7: o foco
 * nunca cai no `body`). A ação que dá certo tira o botão da tela ("Iniciar
 * conferência da caixa" vira a bancada, "Carregar mapa inicial" vira a
 * tabela). Quem sai com o foco dentro (`SaiComOFoco`) marca para onde ele vai,
 * e a tela, no mesmo desenho em que o novo entrou, leva o foco ao alvo (`id`;
 * com vários, ao primeiro que está na tela). O pedido vale só para esse
 * desenho: sem o alvo na tela, ele sai, para o foco não pular depois para
 * onde a pessoa não está.
 *
 * Chame na tela cujo estado tira o pedaço que sai: é o desenho dela que leva
 * o foco.
 */
export function useFocoQueSegue(): MutableRefObject<readonly string[] | null> {
  const pendente = useRef<readonly string[] | null>(null);
  useLayoutEffect(() => {
    const alvos = pendente.current;
    if (!alvos || typeof document === "undefined") return;
    pendente.current = null;
    for (const alvo of alvos) {
      const elemento = document.getElementById(alvo);
      if (elemento) {
        elemento.focus({ preventScroll: true });
        return;
      }
    }
  });
  return pendente;
}

/**
 * O pedaço da tela que sai com o foco dentro: na saída, pede o foco para o
 * `alvo` (o id do que entra no lugar; com vários, o primeiro que estiver na
 * tela). Não muda o desenho (`display: contents`).
 */
export function SaiComOFoco({
  alvo,
  pedido,
  children,
}: {
  alvo: string | readonly string[];
  pedido: MutableRefObject<readonly string[] | null>;
  children: ReactNode;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const destino = useRef<readonly string[]>([]);
  destino.current = typeof alvo === "string" ? [alvo] : alvo;
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (elemento && typeof document !== "undefined" && elemento.contains(document.activeElement)) pedido.current = destino.current;
    };
  }, [pedido]);
  return (
    <div ref={raiz} className="contents">
      {children}
    </div>
  );
}
