import { normalizePath } from "./modules";

/**
 * As telas da Armazenagem que já seguem a v3 (docs/plataforma/fase-4-financeiro.md,
 * parte 4.7). O shell do WMS é v3 desde a parte 4.7a; o conteúdo de cada tela
 * entra no `.v3` quando ela é revista, uma por PR, na ordem da pergunta 18:
 * Início, Pedidos, Estoque e Receber, e depois as demais. As outras seguem
 * o docs/sistema-visual.md até a vez delas.
 */
export const TELAS_DO_WMS_NA_V3: readonly string[] = [
  // Parte 4.7b: o Início, no molde do Início dos outros módulos.
  "/dashboard",
  // Parte 4.7c: os Pedidos (aprovar, separar e entregar).
  "/pedidos",
];

/** A tela aberta já segue a v3 (o caminho exato ou uma tela dentro dele). */
export function telaDoWmsNaV3(location: string, telas: readonly string[] = TELAS_DO_WMS_NA_V3): boolean {
  const caminho = normalizePath(location.split(/[?#]/)[0] ?? "");
  return telas.some((tela) => caminho === tela || caminho.startsWith(`${tela}/`));
}
