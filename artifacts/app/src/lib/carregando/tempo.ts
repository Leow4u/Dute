/**
 * O relógio da espera (carregamento v2, aprovado em 12/11/2026): uma regra só
 * para a leitura, a ação, a linha, a abertura, o Agent Dute e o leitor de
 * tela. Em até 100 ms o toque responde; aos 300 ms entra o indicador, que fica
 * pelo menos 500 ms; aos 3 s o objeto entra na linha ("Aprovando pedido
 * 1042…"); aos 5 s o movimento decorativo para; aos 10 s vêm o aviso
 * "Demorando mais que o normal" e a volta calma; aos 70 s, a saída: "Tentar de
 * novo" na leitura, "Conferir" na escrita.
 *
 * Os mesmos tempos estão nos tokens `--carregando-t-*` do index.css, para quem
 * anima; lib/carregando/tokens.test.ts confere que os dois dizem o mesmo.
 */
export const CARREGANDO = {
  /** Antes disso nada aparece nem é anunciado. */
  atrasoMs: 300,
  /** O tempo mínimo na tela do indicador sozinho e do "em andamento" da ação. O dado não espera. */
  minimoMs: 500,
  /** O objeto entra no apoio da linha: "Aprovando pedido 1042…". */
  objetoNaLinhaMs: 3_000,
  /** O movimento decorativo para: o brilho do esqueleto, as barras e a trilha do agente. */
  movimentoMaxMs: 5_000,
  /** O aviso "Demorando mais que o normal" e a volta calma do indicador (2 s por volta). */
  demoraMs: 10_000,
  /** A desistência: "Sem resposta do servidor." na leitura, "Conferir" na escrita. O chat do Agent Dute e a foto por IA esperam 180 s. */
  desisteMs: 70_000,
  /** "Aprovado" fica pelo menos isso na tela, e até a releitura da lista chegar. */
  sucessoVisivelMs: 1_000,
  /** A lista não tira nem põe linha se alguém tocou nela nesse intervalo. */
  dedoMs: 700,
} as const;

/**
 * Onde a espera está: `oculta` até 300 ms; `andamento` com o indicador;
 * `com-objeto` a partir de 3 s; `demorando` a partir de 10 s; `sem-resposta`
 * na desistência.
 */
export type FaseDaEspera = "oculta" | "andamento" | "com-objeto" | "demorando" | "sem-resposta";

/** A fase de uma espera que começou há `decorridoMs`. */
export function faseDaEspera(decorridoMs: number, desisteMs: number = CARREGANDO.desisteMs): FaseDaEspera {
  if (decorridoMs >= desisteMs) return "sem-resposta";
  if (decorridoMs >= CARREGANDO.demoraMs) return "demorando";
  if (decorridoMs >= CARREGANDO.objetoNaLinhaMs) return "com-objeto";
  if (decorridoMs >= CARREGANDO.atrasoMs) return "andamento";
  return "oculta";
}

/**
 * Se o indicador pode sair agora: o que nunca apareceu (`apareceuEm` nulo) sai
 * na hora; o que apareceu fica pelo menos o mínimo de 500 ms, para não piscar.
 */
export function podeEsconder(apareceuEm: number | null, agora: number): boolean {
  return apareceuEm === null || agora - apareceuEm >= CARREGANDO.minimoMs;
}
