import { FERRAMENTAS_DA_ARMAZENAGEM } from "./agente-armazenagem.js";
import { FERRAMENTAS_DO_COMERCIAL } from "./agente-comercial.js";
import type { FerramentaDoAgente } from "./agente-ferramentas.js";
import { FERRAMENTAS_DO_FINANCEIRO } from "./agente-financeiro.js";
import { FERRAMENTAS_DA_OPERACAO } from "./agente-operacao.js";

/**
 * Todas as ferramentas de consulta do Agent Dute do núcleo (partes 5.5c e
 * 5.5d), por módulo. Quem recebe cada uma sai de ferramentasDoEscopo.
 */
export const FERRAMENTAS_DO_AGENTE: readonly FerramentaDoAgente[] = [
  ...FERRAMENTAS_DA_ARMAZENAGEM,
  ...FERRAMENTAS_DA_OPERACAO,
  ...FERRAMENTAS_DO_COMERCIAL,
  ...FERRAMENTAS_DO_FINANCEIRO,
];
