import * as React from "react";

import type { Espera } from "@/lib/carregando/use-espera";

/**
 * O estado do diálogo em ação (carregamento v2, parte 13a), compartilhado
 * entre a raiz do diálogo, o conteúdo, os botões e os avisos de dentro dele.
 * Mora aqui, fora do `dialog.tsx`, para o `BotaoDeAcao` e os avisos o lerem
 * sem importar o diálogo.
 */
export interface DialogoEmAcaoValor {
  /** A ação segura o diálogo: o X e o Cancelar ficam `aria-disabled`. */
  ocupado: boolean;
  /** O X e o Cancelar esmaecem: aos 300 ms da ação, com o gerúndio do confirmar, e pelo menos 500 ms. */
  esmaecido: boolean;
  /** A espera da ação, para o aviso dos 10 s e a saída dos 70 s; `null` parada. */
  espera: Espera | null;
  /** Já há um aviso da espera ou um progresso no diálogo (a operação longa tem o dela): o rodapé não repete. */
  avisoProprio: boolean;
  /** Na hora do evento: a ação segura o diálogo (o X e o Cancelar, que dizem isso pelo aria-disabled). */
  segura: () => boolean;
  /**
   * Na hora do Esc e do toque fora: a ação segura o diálogo, ou o confirmar
   * foi tocado há menos de 300 ms e a ação ainda não chegou à tela.
   */
  seguraNoToque: () => boolean;
  /** O toque aceito no confirmar: segura o diálogo até a ação chegar à tela. */
  marcarToque: () => void;
  /** O aviso da espera ou o progresso que mora no diálogo se registra; devolve quem o tira. */
  registrarAviso: () => () => void;
}

export const DialogoEmAcao = React.createContext<DialogoEmAcaoValor | null>(null);

/** O estado do diálogo em ação de quem está dentro dele; `null` fora de um diálogo. */
export function useDialogoEmAcao() {
  return React.useContext(DialogoEmAcao);
}

/**
 * O aviso da espera ou o progresso da operação longa, dentro de um diálogo,
 * avisa que está na tela: o rodapé do diálogo não repete o aviso dos 10 s, e
 * a saída dos 70 s fica com quem tem o aviso próprio. Fora de um diálogo, nada.
 */
export function useAvisoProprioNoDialogo(ligado = true) {
  const registrar = useDialogoEmAcao()?.registrarAviso;
  React.useLayoutEffect(() => {
    if (!ligado || !registrar) return undefined;
    return registrar();
  }, [ligado, registrar]);
}
