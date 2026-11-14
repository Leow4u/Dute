import { useSyncExternalStore } from "react";

import { CARREGANDO } from "./carregando/tempo";

/**
 * A abertura do app (carregamento v2, momento 5, decisão P4 de 12/11/2026): o
 * `#abertura` do index.html, preto, fora do `#root`, com a marca, a palavra e
 * o trilho chanfrado. Ela é pintada antes do JavaScript e da fonte, e quem a
 * fecha é o AuthProvider, quando o perfil chega e as rotas param de esperar.
 * O desenho e os avisos de 3 s e de 10 s moram no index.html.
 */
export const ID_DA_ABERTURA = "abertura";

/**
 * Como a abertura sai: `completa` quando o trilho já estava à vista (o
 * segmento completa e tudo esmaece); `esmaece` com movimento reduzido (só
 * opacidade); `cedo` antes de 300 ms, quando o trilho nem apareceu.
 */
export type SaidaDaAbertura = "completa" | "esmaece" | "cedo";

/** A animação começa no quadro seguinte ao `data-fechando`: o prazo de reserva espera um pouco mais que ela. */
export const FOLGA_DA_SAIDA_MS = 100;

const ouvintes = new Set<() => void>();

function documentoAtual(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

function aberturaDo(documento: Document | undefined): HTMLElement | null {
  return documento?.getElementById(ID_DA_ABERTURA) ?? null;
}

/** A abertura está na tela e ainda não começou a sair. */
export function aberturaAberta(documento: Document | undefined = documentoAtual()): boolean {
  const abertura = aberturaDo(documento);
  return abertura !== null && !abertura.hasAttribute("data-fechando");
}

/** A abertura ainda está no documento: aberta ou esmaecendo por cima do app. */
export function aberturaNaTela(documento: Document | undefined = documentoAtual()): boolean {
  return aberturaDo(documento) !== null;
}

/** Solta o #root, inerte no index.html enquanto a abertura cobre a tela: o app recebe o foco e o leitor de tela. */
function soltarORoot(documento: Document | undefined): void {
  documento?.getElementById("root")?.removeAttribute("inert");
}

/**
 * O último aviso que a região de status da abertura disse ("Sem conexão",
 * "Demorando mais que o normal"; vazio quando ele saiu) e quando a região
 * mudou (`performance.now()`). O script do index.html marca na abertura
 * (`data-dito`, `data-dito-em`) e, quando ela sai, o #root guarda
 * (`data-abertura-disse`, `data-abertura-disse-em`).
 */
export interface FalaDaAbertura {
  texto: string;
  em: number;
}

function falaMarcada(elemento: Element | null | undefined, texto: string, em: string): FalaDaAbertura | null {
  const quando = Number(elemento?.getAttribute(em) ?? Number.NaN);
  if (!elemento || !Number.isFinite(quando)) return null;
  return { texto: elemento.getAttribute(texto) ?? "", em: quando };
}

/**
 * A última fala da abertura, com ela na tela ou depois que saiu: o
 * `Anunciador` do app espera os 2 s dela antes do primeiro anúncio (as duas
 * regiões falam a mesma pessoa, no máximo um aviso a cada 2 s).
 */
export function ultimaFalaDaAbertura(documento: Document | undefined = documentoAtual()): FalaDaAbertura | null {
  return (
    falaMarcada(aberturaDo(documento), "data-dito", "data-dito-em") ??
    falaMarcada(documento?.getElementById("root"), "data-abertura-disse", "data-abertura-disse-em")
  );
}

/**
 * A falta de conexão que o app acabou de perceber já foi dita: a abertura
 * está na tela (ela diz "Sem conexão" na região dela, e o #root inerte não
 * fala), ou saiu dizendo "Sem conexão" e a rede não voltou desde então. Uma
 * vez só: a falta seguinte é outra, e o `Anunciador` a diz.
 */
export function aberturaDisseSemConexao(documento: Document | undefined = documentoAtual()): boolean {
  if (aberturaNaTela(documento)) return true;
  const root = documento?.getElementById("root");
  if (root?.getAttribute("data-abertura-disse") !== "Sem conexão") return false;
  root.setAttribute("data-abertura-disse", "");
  return true;
}

/** Quando a abertura sai, o #root guarda a última fala dela; a rede que volta encerra a falta que ela disse. */
function guardarAFala(abertura: HTMLElement, documento: Document | undefined): void {
  const root = documento?.getElementById("root");
  const fala = falaMarcada(abertura, "data-dito", "data-dito-em");
  if (!root || !fala) return;
  root.setAttribute("data-abertura-disse", fala.texto);
  root.setAttribute("data-abertura-disse-em", String(fala.em));
  if (fala.texto !== "Sem conexão") return;
  documento?.defaultView?.addEventListener(
    "online",
    () => {
      if (root.getAttribute("data-abertura-disse") === "Sem conexão") root.setAttribute("data-abertura-disse", "");
    },
    { once: true },
  );
}

function avisar(): void {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function movimentoReduzido(janela: Window | null | undefined): boolean {
  try {
    return janela?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Como esta abertura sai agora. O `data-desde` é o instante em que o script
 * do index.html rodou, logo depois de a abertura entrar no documento: o
 * trilho aparece 300 ms depois dele.
 */
export function saidaDaAbertura(abertura: HTMLElement, agora: number, reduzido: boolean): SaidaDaAbertura {
  const marca = abertura.getAttribute("data-desde");
  const desde = marca === null || marca.trim() === "" ? Number.NaN : Number(marca);
  const comTrilho = !Number.isFinite(desde) || agora - desde >= CARREGANDO.atrasoMs;
  if (!comTrilho) return "cedo";
  return reduzido ? "esmaece" : "completa";
}

/** Quanto a saída leva: 200 ms do trilho que completa, quando completa, e os 260 ms do esmaecer. */
export function duracaoDaSaida(saida: SaidaDaAbertura): number {
  return (saida === "completa" ? CARREGANDO.aberturaCompletaMs : 0) + CARREGANDO.aberturaSaiMs;
}

/**
 * Fecha a abertura. Se o trilho já estava à vista, o segmento completa até o
 * canto chanfrado (200 ms) e a abertura esmaece em 260 ms, com a marca a
 * 0,96; antes de 300 ms, ou com movimento reduzido, ela só esmaece. Sai da
 * árvore de acessibilidade e do toque na hora, e do documento quando o
 * esmaecer termina. O #root deixa de ser inerte na hora. Idempotente:
 * chamar de novo não refaz nada, e sem a abertura (os testes, a demo) só
 * solta o #root.
 */
export function fecharAbertura(documento: Document | undefined = documentoAtual()): void {
  soltarORoot(documento);
  const abertura = aberturaDo(documento);
  if (!abertura || abertura.hasAttribute("data-fechando")) return;
  const janela = documento?.defaultView;
  const agora = janela?.performance?.now() ?? 0;
  guardarAFala(abertura, documento);
  const saida = saidaDaAbertura(abertura, agora, movimentoReduzido(janela));
  abertura.setAttribute("data-fechando", saida);
  abertura.setAttribute("aria-hidden", "true");
  abertura.setAttribute("inert", "");

  let prazo: ReturnType<typeof setTimeout> | undefined;
  const tirar = () => {
    clearTimeout(prazo);
    if (!abertura.isConnected) return;
    abertura.remove();
    avisar();
  };
  // Sai quando o esmaecer da própria abertura termina (os filhos também esmaecem, e o evento sobe).
  abertura.addEventListener("animationend", (evento) => {
    if (evento.target === abertura && evento.animationName === "abertura-esmaece") tirar();
  });
  // Sem o fim da animação (aba em segundo plano, CSS que não chegou), sai logo depois do tempo dela.
  prazo = setTimeout(tirar, duracaoDaSaida(saida) + FOLGA_DA_SAIDA_MS);
  avisar();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Se a abertura ainda está na tela, aberta ou esmaecendo. Enquanto ela está, a
 * cor da barra do navegador fica no preto dela e a `CarregandoTela` não
 * desenha nem anuncia nada: a abertura já diz "Abrindo a Dutelog" na região
 * de status dela, e nada do app aparece por baixo do preto que ainda esmaece.
 */
export function useAberturaNaTela(): boolean {
  return useSyncExternalStore(assinar, () => aberturaNaTela(), () => false);
}
