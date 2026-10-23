import { createContext, useContext } from "react";

/**
 * A tela aberta segue a v3 (docs/plataforma/fase-4-financeiro.md, parte 4.7).
 * O que abre em portal (diálogo, painel, menu, lista) fica fora do `.v3` da
 * tela no DOM, mas dentro dela no React: com isto, leva o `.v3` junto.
 * O shell de cada módulo dá o valor (ShellDoModulo, `conteudoV3`).
 */
export const NaV3 = createContext(false);

export function useNaV3(): boolean {
  return useContext(NaV3);
}
