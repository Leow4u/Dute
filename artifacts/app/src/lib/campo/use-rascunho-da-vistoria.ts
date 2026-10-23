import { useCallback, useEffect, useState } from "react";

import { apagarRascunho, guardarRascunho, lerRascunho, rascunhoInicial, type RascunhoDaVistoria } from "./vistoria";

/**
 * O rascunho da vistoria no aparelho (parte 3.11b): lido ao abrir a OS,
 * guardado a cada mudança e apagado quando a vistoria já foi ao Comercial (a
 * OS está revisada). Quem usa monta um por OS (`key` com o número).
 */
export function useRascunhoDaVistoria(numero: string, enviada: boolean): [RascunhoDaVistoria, (muda: (atual: RascunhoDaVistoria) => RascunhoDaVistoria) => void] {
  const [rascunho, setRascunho] = useState<RascunhoDaVistoria>(() => lerRascunho(numero) ?? rascunhoInicial());
  useEffect(() => {
    if (enviada) apagarRascunho(numero);
    else guardarRascunho(numero, rascunho);
  }, [numero, rascunho, enviada]);
  const mudar = useCallback((muda: (atual: RascunhoDaVistoria) => RascunhoDaVistoria) => setRascunho((atual) => muda(atual)), []);
  return [rascunho, mudar];
}
