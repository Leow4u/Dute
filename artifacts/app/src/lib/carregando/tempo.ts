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
  /** O objeto entra no apoio da linha: "Aprovando pedido 1042…". Na abertura, sem rede, o "Sem conexão". */
  objetoNaLinhaMs: 3_000,
  /** O movimento decorativo para: o brilho do esqueleto, as barras e a trilha do agente. */
  movimentoMaxMs: 5_000,
  /** O aviso "Demorando mais que o normal" e a volta calma do indicador (2 s por volta). */
  demoraMs: 10_000,
  /** A desistência: "Sem resposta do servidor." na leitura, "Conferir" na escrita. O chat do Agent Dute e a foto por IA esperam 180 s. */
  desisteMs: 70_000,
  /**
   * O prazo do chat do Agent Dute, o mesmo `timeoutSeconds` (180 s) das
   * functions dele: "Sem resposta do Agent Dute" e "Tentar de novo". Na tela,
   * conta da última notícia do servidor; o `.stream()` da callable não tem
   * prazo próprio, e o stream que fecha sem o resultado é o prazo esgotado.
   */
  desisteDoAgenteMs: 180_000,
  /** Sem um byte novo da foto que sobe por esse tempo, a estimativa ("cerca de 20 s") sai do aviso: a conta não vale com a foto parada. */
  estimativaSemByteMs: 10_000,
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
  /**
   * O texto que sai da linha de estado some nesse tempo, e só então o novo
   * entra: a troca em sequência, nunca sobreposta (o mesmo do rótulo do botão).
   */
  trocaSaiMs: 80,
  /**
   * O texto novo entra nesse tempo, depois do que sai; só quando ele acabou
   * de entrar a camada que saiu deixa a árvore (ela já está invisível e sem
   * toque desde o fim da saída).
   */
  trocaEntraMs: 150,
  /**
   * A saída de um indicador e da espera da linha de estado ("Carregando
   * pedidos…" na chegada, "Atualizando…", a caixa do Atualizar): só então o
   * que vem depois entra.
   */
  saidaMs: 180,
  /** A barra do topo do cartão que voltou a ler completa por scaleX nesse tempo, em tinta (momento 7, caso 3)... */
  barraFimMs: 200,
  /** ...e então esmaece nesse, e sai. */
  barraSomeMs: 150,
  /** A contagem que muda (3 → 2) rola 8 px nesse tempo. */
  contaMs: 160,
  /** O segmento da foto que sobe enche por scaleX nesse tempo, a cada evento de bytes, e nunca volta. */
  segmentoMs: 200,
  /** O fio entre duas etapas enche nesse tempo, quando a de antes termina. */
  fioMs: 300,
  /**
   * A abertura do app (o `#abertura` do index.html) esmaece nesse tempo
   * quando o perfil chega, com a marca recuando a 0,96 (`fecharAbertura`).
   */
  aberturaSaiMs: 260,
  /** Antes de esmaecer, o segmento vermelho completa o trilho até o canto chanfrado, se o trilho já estava à vista. */
  aberturaCompletaMs: 200,
  /** Quando o trilho completa, o segmento que varria some nesse tempo. */
  aberturaSegmentoSaiMs: 60,
  /** A marca (que recua a 0,96) e a palavra saem nesse tempo, enquanto o preto abre nos 260 ms. */
  aberturaMarcaSaiMs: 200,
  /**
   * O dado que chega no lugar das linhas-fantasma (momento 2): cada linha
   * real entra por opacidade nesse tempo, subindo 4 px (no reduzido, só a
   * opacidade)...
   */
  chegadaMs: 150,
  /** ...em cascata, uma linha a cada 30 ms... */
  passoMs: 30,
  /** ...em até seis linhas: da sétima em diante, junto com a sexta. */
  linhasNaCascata: 6,
  /**
   * A histerese da conexão (momento 8): o aparelho sem rede há esse tempo é
   * "Sem conexão". Antes, e com o aparelho conectado, é "Reconectando…".
   */
  semRedeMs: 3_000,
  /** Cada aviso da conexão ("Reconectando…", "Sem conexão") fica pelo menos isso antes de dar lugar a outro. */
  avisoMinimoMs: 2_000,
  /** A primeira releitura sozinha enquanto reconecta; as seguintes dobram (2, 4, 8 e 16 s) até o teto. */
  releituraMs: 2_000,
  /** O teto da espera entre as releituras sozinhas: depois dos 16 s, a cada 30 s. */
  releituraMaxMs: 30_000,
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

/**
 * A estimativa do que falta, arredondada para cima ("cerca de 20 s"), no
 * aviso de demora da operação com o total conhecido (as fotos). Até um
 * minuto, de 5 em 5 s; depois, em minutos.
 */
export function estimativaDaEspera(restanteMs: number): string | null {
  if (!Number.isFinite(restanteMs) || restanteMs <= 0) return null;
  const segundos = Math.ceil(restanteMs / 1_000);
  if (segundos <= 60) return `cerca de ${Math.max(5, Math.ceil(segundos / 5) * 5)} s`;
  return `cerca de ${Math.ceil(segundos / 60)} min`;
}
