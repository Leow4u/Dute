import { useEffect, useRef, useState } from "react";

import { chamarNucleo, type CallableDoNucleo } from "./api";

/** A espera depois da última mudança, para não pedir a cada tecla. */
const ESPERA_MS = 600;

/** A resposta do núcleo para o pedido de agora (pela chave): carregando, pronta ou com erro. */
export type RespostaNaTela<R> = { chave: string; estado: "carregando" | "pronto" | "erro"; resposta: R | null };

/**
 * As respostas de uma callable da memória (functions/core) para os pedidos da
 * tela. Pede só depois que os pedidos param de mudar e guarda a resposta pela
 * chave de cada um: voltar a um pedido já visto não pede de novo, e a resposta
 * que chega depois de o pedido mudar fica guardada para quando ele voltar. A
 * que falha pode ser pedida de novo. Desligada (fora da liberação da memória),
 * não pede nada.
 */
export function useRespostasDoNucleo<P extends Record<string, unknown>, R>(
  nome: CallableDoNucleo,
  pedidos: ReadonlyArray<P | null>,
  ligada: boolean,
): Array<RespostaNaTela<R> | null> {
  const chaves = pedidos.map((pedido) => (pedido ? JSON.stringify(pedido) : null));
  const juntas = chaves.join("\n");
  const [vistas, setVistas] = useState<Record<string, RespostaNaTela<R>>>({});
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
        const guardar = (resposta: RespostaNaTela<R>) => {
          if (montado.current) setVistas((atuais) => ({ ...atuais, [chave]: resposta }));
        };
        guardar({ chave, estado: "carregando", resposta: null });
        chamarNucleo<R>(nome, pedido)
          .then((resposta) => guardar({ chave, estado: "pronto", resposta }))
          .catch(() => {
            pedidas.current.delete(chave);
            guardar({ chave, estado: "erro", resposta: null });
          });
      });
    }, ESPERA_MS);
    return () => clearTimeout(timer);
    // Os pedidos mudam só quando as chaves mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [juntas, ligada, nome]);

  return chaves.map((chave) => (chave ? (vistas[chave] ?? null) : null));
}
