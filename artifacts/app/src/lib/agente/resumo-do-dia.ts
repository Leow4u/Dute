import { templatesFor, type RoutineTemplate } from "../agent-routines";
import type { AlvoDoAgente, ModuloDoAgente } from "./cliente";

/**
 * O "Resumo do dia" (parte 5.5l, pergunta 35): o briefing do dia vira uma
 * rotina pronta por módulo, nos dias úteis às 7h. É um modelo da tela
 * Rotinas: nada é criado até a pessoa confirmar, e ela pode mudar o horário.
 * A resposta chega na conversa da rotina, pelo agente do núcleo.
 */

export const ID_DO_RESUMO_DO_DIA = "resumo-do-dia";

const PERGUNTA_DA_EQUIPE: Record<ModuloDoAgente, string> = {
  wms: "Resumo do dia da Armazenagem: pedidos para aprovar e atrasados, recebimentos e tarefas do armazém em aberto, e itens parados ou abaixo do mínimo. Comece pelo mais urgente.",
  comercial: "Resumo do dia do Comercial: orçamentos para enviar, para aprovar ou com resposta do cliente, e contratos e medições pendentes. Comece pelo mais urgente.",
  operacao: "Resumo do dia da Operação: as OS de hoje e a equipe, as demandas para planejar ou agendar e as OS em revisão. Comece pelo mais urgente.",
  financeiro: "Resumo do dia do Financeiro: o que está a faturar, as faturas vencidas e as que vencem na semana, e os pagamentos recebidos. Comece pelo mais urgente.",
};

const PERGUNTA_DO_CLIENTE = "Resumo do dia: meus pedidos em andamento, os envios a caminho, os itens abaixo do mínimo e as faturas a vencer. Comece pelo mais urgente.";

export function resumoDoDia(modulo: ModuloDoAgente, cliente: boolean): RoutineTemplate {
  return {
    id: ID_DO_RESUMO_DO_DIA,
    name: "Resumo do dia",
    hint: "",
    prompt: cliente ? PERGUNTA_DO_CLIENTE : PERGUNTA_DA_EQUIPE[modulo],
    frequency: "weekdays",
    days: [],
    time: "07:00",
  };
}

/**
 * Os modelos da tela Rotinas: no agente do WMS, os de sempre; no do núcleo,
 * o Resumo do dia do módulo primeiro, e na Armazenagem também os de sempre.
 */
export function modelosDoAgente(role: string | undefined, alvo: AlvoDoAgente): RoutineTemplate[] {
  if (alvo.tipo === "wms") return templatesFor(role);
  const resumo = resumoDoDia(alvo.modulo, role === "cliente");
  return alvo.modulo === "wms" ? [resumo, ...templatesFor(role)] : [resumo];
}
