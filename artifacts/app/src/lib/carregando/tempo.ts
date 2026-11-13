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
  /** "Não aprovado" fica isso no botão antes de ele voltar a "Aprovar"; o motivo fica na linha. */
  erroVisivelMs: 2_000,
  /** A lista não tira nem põe linha se alguém tocou nela nesse intervalo. */
  dedoMs: 700,
  /** O mais que a saída (e a chegada) espera o dedo sair da lista. */
  dedoMaxMs: 3_000,
  /** A linha que sai esmaece (opacidade e −6 px) nesse tempo, antes de deixar a lista. */
  saiLinhaMs: 200,
  /** As linhas de baixo sobem por FLIP (só transform) nesse tempo. */
  refluiMs: 240,
  /** A linha que chega a um grupo entra nesse tempo: opacidade e 4 px; no reduzido, só opacidade. */
  chegaLinhaMs: 240,
  /**
   * A que chega espera o cartão chegar antes de entrar: começa 60 ms antes do
   * fim do refluxo, e nunca aparece fora do cartão que ainda anda. No
   * reduzido, que não desliza, entra na hora.
   */
  chegaEsperaMs: 180,
  /** O realce da linha que chegou ao grupo (a aprovada em "Para separar"). */
  destaqueMs: 1_000,
  /** A contagem que muda (3 → 2) rola 8 px nesse tempo. */
  contaMs: 160,
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

/**
 * O relógio da demora, só visual ("Demorando mais que o normal · 0:12"): os
 * minutos e os segundos desde o começo da espera. Nunca fica em região viva.
 */
export function relogioDaEspera(decorridoMs: number): string {
  const segundos = Number.isFinite(decorridoMs) ? Math.max(0, Math.floor(decorridoMs / 1_000)) : 0;
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}
