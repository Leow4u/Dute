import { useEffect, useRef, useState } from "react";

import { chamarNucleo } from "./api";
import { chaveDoPedido, type PedidoDeSugestao, type Sugestao, type SugestaoNaTela } from "./sugestao";

/** A espera depois da última mudança do plano, para não pedir a cada tecla. */
const ESPERA_MS = 600;

/**
 * A duração sugerida de cada OS do plano (parte 5.2b), pelo pedido de cada
 * uma. Pede só depois que o plano para de mudar e guarda a resposta pela chave
 * do pedido: voltar a um pedido já visto não pede de novo, e a resposta que
 * chega depois de o plano mudar fica guardada para quando ele voltar. A que
 * falha pode ser pedida de novo. Desligada (fora da liberação da memória),
 * não pede nada.
 */
export function useSugestoes(pedidos: ReadonlyArray<PedidoDeSugestao | null>, ligada: boolean): Array<SugestaoNaTela | null> {
  const chaves = pedidos.map((pedido) => (pedido ? chaveDoPedido(pedido) : null));
  const juntas = chaves.join("\n");
  const [vistas, setVistas] = useState<Record<string, SugestaoNaTela>>({});
  const pedidas = useRef(new Set<string>());
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ligada) return undefined;
    const timer = setTimeout(() => {
      pedidos.forEach((pedido, indice) => {
        const chave = chaves[indice];
        if (!pedido || !chave || pedidas.current.has(chave)) return;
        pedidas.current.add(chave);
        const guardar = (sugestao: SugestaoNaTela) => {
          if (montado.current) setVistas((atuais) => ({ ...atuais, [chave]: sugestao }));
        };
        guardar({ chave, estado: "carregando", sugestao: null });
        chamarNucleo<Sugestao>("suggestDuration", pedido)
          .then((sugestao) => guardar({ chave, estado: "pronto", sugestao }))
          .catch(() => {
            pedidas.current.delete(chave);
            guardar({ chave, estado: "erro", sugestao: null });
          });
      });
    }, ESPERA_MS);
    return () => clearTimeout(timer);
    // Os pedidos mudam só quando as chaves mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [juntas, ligada]);

  return chaves.map((chave) => (chave ? (vistas[chave] ?? null) : null));
}
