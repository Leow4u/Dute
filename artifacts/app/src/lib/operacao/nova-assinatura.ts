import { useEffect, useRef, useState } from "react";

import type { Leitura } from "./leitura";

export interface NovaAssinatura {
  /** A chave da leitura, com a vez da nova tentativa; nula sem leitura. */
  chave: string | null;
  /** Assina de novo; a promessa acaba quando a nova assinatura responde (o dado ou a falha). */
  tentar: () => Promise<void>;
  /** Anota a leitura de agora e diz se a falha está na tela: a de agora, ou a de antes enquanto tenta de novo. */
  falhou: (leitura: Leitura<unknown>) => boolean;
}

/**
 * A nova tentativa de uma leitura ao vivo (`useLeitura`), que não se refaz
 * sozinha depois de recusada (carregamento v2, parte 13c): a vez entra na
 * chave e assina de novo. A falha fica na tela enquanto a nova assinatura não
 * responde (o "Tentando de novo…" da `FalhaNaLeitura`), e a promessa de
 * `tentar` acaba na resposta. A falha é da `base` em que aconteceu: com a base
 * nova (outro pedido aberto), a leitura começa sem falha, na espera.
 */
export function useNovaAssinatura(base: string | null): NovaAssinatura {
  const [vez, setVez] = useState(0);
  const [falhaDe, setFalhaDe] = useState<string | null>(null);
  const esperando = useRef<(() => void) | null>(null);
  const ultima = useRef<{ base: string | null; leitura: Leitura<unknown> }>({ base: null, leitura: { itens: null, erro: false } });
  useEffect(() => {
    const { base: daLeitura, leitura } = ultima.current;
    if (leitura.erro) setFalhaDe(daLeitura);
    else if (leitura.itens !== null) setFalhaDe(null);
    if ((leitura.erro || leitura.itens !== null) && esperando.current) {
      esperando.current();
      esperando.current = null;
    }
  });
  return {
    chave: base === null ? null : `${base}#${vez}`,
    tentar: () =>
      new Promise<void>((pronto) => {
        esperando.current = pronto;
        setVez((atual) => atual + 1);
      }),
    falhou: (leitura) => {
      ultima.current = { base, leitura };
      return leitura.erro || (base !== null && falhaDe === base && leitura.itens === null);
    },
  };
}
