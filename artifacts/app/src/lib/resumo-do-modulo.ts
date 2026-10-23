import { isNavRouteActive, type AppModule } from "./modules";

/**
 * Os contadores da entrada e do menu de cada módulo (docs/plataforma/plano-de-implantacao.md,
 * parte 2.4) saem da mesma lista do "Precisa de você" do Início do módulo:
 * não há segunda regra de contagem. Vermelho só quando um item é crítico.
 */

type ItemContado = { tone: string; title: string; href: string };

/** O número ao lado de um item do menu do módulo; vermelho só no alerta. */
export type ContadorDoItem = { n: number; alerta?: boolean };

export type ResumoDoModulo = {
  /** Quantas linhas o "Precisa de você" do módulo tem. */
  total: number;
  /** Alguma é crítica. */
  alerta: boolean;
  /** O título da primeira linha (a mais urgente), para o card. */
  primeira: string | null;
};

export function resumoDoModulo(itens: readonly ItemContado[]): ResumoDoModulo {
  return {
    total: itens.length,
    alerta: itens.some((item) => item.tone === "critical"),
    primeira: itens[0]?.title ?? null,
  };
}

function caminho(href: string): string {
  const fim = href.search(/[?#]/);
  return fim === -1 ? href : href.slice(0, fim);
}

/**
 * Contador de cada item do menu do módulo: o Início conta todas as linhas;
 * cada outra tela conta as linhas cuja ação leva a ela. Item sem linha fica
 * sem contador.
 */
export function contadoresDoMenu(
  itens: readonly ItemContado[],
  menu: readonly AppModule[],
  inicioId: string,
): Record<string, ContadorDoItem> {
  const contadores: Record<string, ContadorDoItem> = {};
  const somar = (id: string, item: ItemContado) => {
    const atual = contadores[id] ?? { n: 0, alerta: false };
    contadores[id] = { n: atual.n + 1, alerta: Boolean(atual.alerta) || item.tone === "critical" };
  };
  for (const item of itens) {
    somar(inicioId, item);
    const destino = caminho(item.href);
    const tela = menu.find((modulo) => modulo.id !== inicioId && modulo.routes.some((route) => isNavRouteActive(destino, route)));
    if (tela) somar(tela.id, item);
  }
  return contadores;
}
