import { useCallback, useRef } from "react";

/**
 * O toque duplo no mesmo botão do celular (parte 3.8b). Registrado o toque,
 * o botão já vira a próxima ação ("Entrada" vira "Saída", a etapa vira a
 * seguinte), e o segundo toque registrava a próxima no mesmo segundo, sem
 * volta: a saída paga a diária do freelancer, e a etapa de verdade passava a
 * ser recusada como já registrada. O segundo toque do mesmo botão dentro de
 * um segundo é ignorado.
 */
export const INTERVALO_DO_TOQUE_MS = 1_000;

export function toqueRepetido(ultimo: number | undefined, agora: number, intervalo = INTERVALO_DO_TOQUE_MS): boolean {
  return ultimo !== undefined && agora >= ultimo && agora - ultimo < intervalo;
}

/** Faz a ação do botão (pela chave dele) só se não for o segundo toque logo depois do primeiro. */
export function useToqueUnico(agora: () => Date): (chave: string, acao: () => void) => void {
  const ultimos = useRef(new Map<string, number>());
  return useCallback(
    (chave: string, acao: () => void) => {
      const instante = agora().getTime();
      if (toqueRepetido(ultimos.current.get(chave), instante)) return;
      ultimos.current.set(chave, instante);
      acao();
    },
    [agora],
  );
}
