import { useLayoutEffect, useRef, type ReactNode } from "react";

import { lugarDaSecao, segurarOFocoQueSai } from "@/lib/foco-de-volta";

/** O primeiro dos ids que está na tela. */
function primeiroNaTela(alvos: readonly string[]): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const alvo of alvos) {
    const elemento = document.getElementById(alvo);
    if (elemento) return elemento;
  }
  return null;
}

/**
 * O pedaço da tela que sai com o foco dentro (carregamento v2, seção 7: o
 * foco nunca cai no `body`). A ação que dá certo tira o botão da tela
 * ("Iniciar conferência da caixa" vira a bancada, "Carregar mapa inicial" vira
 * a tabela): o foco vai ao `alvo`, o id do que entrou no lugar (com vários, ao
 * primeiro que está na tela) e, sem ele, ao título da seção ou da página. É a
 * `segurarOFocoQueSai` (lib/foco-de-volta.ts) dita na tela: o destino é lido
 * depois da saída, quando o novo já entrou, e o foco que não caiu fica onde
 * está. Não muda o desenho (`display: contents`).
 */
export function SaiComOFoco({ alvo, children }: { alvo: string | readonly string[]; children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const destino = useRef<readonly string[]>([]);
  destino.current = typeof alvo === "string" ? [alvo] : alvo;
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (!elemento || !elemento.contains(elemento.ownerDocument.activeElement)) return;
      // O título da seção é lido agora, com o pedaço ainda na tela; o alvo, depois da saída.
      const secao = lugarDaSecao(elemento);
      segurarOFocoQueSai(elemento, () => primeiroNaTela(destino.current) ?? secao);
    };
  }, []);
  return (
    <div ref={raiz} className="contents">
      {children}
    </div>
  );
}
