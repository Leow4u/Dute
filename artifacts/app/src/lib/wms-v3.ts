import { AGENTE_LIBERADO } from "./liberacao";
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
  // Parte 4.7d: o Estoque (os itens com a ficha e o histórico).
  "/estoque",
  // Parte 4.7e: o Receber (conferir e guardar as chegadas).
  "/wms/receber",
  // Parte 5.4e: os Alertas de itens parados, tela nova já na v3.
  "/estoque/alertas",
  // Separação com caixas, parte 1b: a lista de separação para imprimir, tela nova já na v3.
  "/pedidos/lista",
  // Separação com caixas, parte 2: a bancada do pedido, tela nova já na v3.
  "/pedidos/separar",
];

/**
 * O painel do Agent Dute na v3 (04/11/2026): só com a liberação do agente do
 * núcleo, onde ele é o painel novo. Fora dela, o painel antigo segue o
 * visual do WMS.
 */
export const TELAS_DO_AGENTE_NA_V3: readonly string[] = ["/agente/painel"];

/**
 * A tela aberta já segue a v3: o caminho exato, sem a busca. As telas dentro
 * de outra (Estoque › Mapa, Posições e Etiquetas) entram cada uma por si.
 */
export function telaDoWmsNaV3(location: string, telas: readonly string[] = TELAS_DO_WMS_NA_V3, agenteLiberado: boolean = AGENTE_LIBERADO): boolean {
  const caminho = normalizePath(location);
  return telas.includes(caminho) || (agenteLiberado && TELAS_DO_AGENTE_NA_V3.includes(caminho));
}
