import { FERRAMENTAS_DA_ARMAZENAGEM } from "./agente-armazenagem.js";
import { FERRAMENTAS_DO_COMERCIAL } from "./agente-comercial.js";
import { FERRAMENTAS_COMUNS } from "./agente-comuns.js";
import type { FerramentaDoAgente } from "./agente-ferramentas.js";
import { FERRAMENTAS_DO_FINANCEIRO } from "./agente-financeiro.js";
import { FERRAMENTAS_DA_OPERACAO } from "./agente-operacao.js";

/**
 * Todas as ferramentas do Agent Dute do núcleo (partes 5.5c a 5.5e), por
 * módulo, e as comuns a todos. Quem recebe cada uma sai de ferramentasDoEscopo.
 */
export const FERRAMENTAS_DO_AGENTE: readonly FerramentaDoAgente[] = [
  ...FERRAMENTAS_COMUNS,
  ...FERRAMENTAS_DA_ARMAZENAGEM,
  ...FERRAMENTAS_DA_OPERACAO,
  ...FERRAMENTAS_DO_COMERCIAL,
  ...FERRAMENTAS_DO_FINANCEIRO,
];
