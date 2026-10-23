import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";

import { AgentScreen } from "@/components/agent/agent-screen";
import { useActiveCustomer } from "@/lib/active-customer-context";
import type { Suggestion } from "@/lib/agent-chat";
import { clienteDoNucleo, type ClienteDoAgente, type ModuloDoAgente } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { rotaDoAgente } from "@/lib/agente/navegacao";

/**
 * O Agent Dute no shell de cada módulo (parte 5.5j): a mesma tela de
 * conversa, falando com o agente do núcleo no módulo do shell e no cliente
 * ativo. Trocar o cliente fecha a conversa aberta, que era do outro. Sem
 * legenda: as sugestões são só as perguntas.
 */

const pergunta = (prompt: string): Suggestion => ({ prompt, hint: "" });

export const SUGESTOES_DO_MODULO: Record<Exclude<ModuloDoAgente, "wms">, Suggestion[]> = {
  comercial: [
    pergunta("Quais orçamentos deste cliente estão em aberto?"),
    pergunta("Quais orçamentos foram aprovados neste mês?"),
    pergunta("Há orçamentos parecidos com a última demanda?"),
    pergunta("Quanto custa a montagem na LPU?"),
  ],
  operacao: [
    pergunta("Quais OS estão agendadas para hoje?"),
    pergunta("Quais demandas estão para planejar?"),
    pergunta("Como está a agenda da semana?"),
    pergunta("Quanto tempo leva cada item na montagem?"),
  ],
  financeiro: [
    pergunta("Quais faturas estão vencidas?"),
    pergunta("Quanto há a receber neste mês?"),
    pergunta("Quais faturas foram pagas nesta semana?"),
    pergunta("Qual foi a última fatura deste cliente?"),
  ],
};

export const PERGUNTE_AO_AGENTE = "Pergunte ao Agent Dute…";

/**
 * O agente do núcleo no cliente ativo; a troca do cliente volta para a
 * conversa nova. Desligado (o /agente fora da liberação), nada muda.
 */
export function useAgenteDoClienteAtivo(modulo: ModuloDoAgente, ligado = true): ClienteDoAgente {
  const { code } = useActiveCustomer();
  const [, navigate] = useLocation();
  const anterior = useRef(code);
  useEffect(() => {
    if (anterior.current === code) return;
    anterior.current = code;
    if (ligado) navigate(rotaDoAgente(modulo));
  }, [code, ligado, modulo, navigate]);
  return useMemo(() => clienteDoNucleo(modulo, code), [modulo, code]);
}

export function AgenteNoModulo({ modulo }: { modulo: Exclude<ModuloDoAgente, "wms"> }) {
  const cliente = useAgenteDoClienteAtivo(modulo);
  return (
    <ProvedorDoAgente cliente={cliente}>
      <AgentScreen basePath={rotaDoAgente(modulo)} suggestions={SUGESTOES_DO_MODULO[modulo]} placeholder={PERGUNTE_AO_AGENTE} aviso={null} whatsapp={false} />
    </ProvedorDoAgente>
  );
}

export function AgenteDoComercial() {
  return <AgenteNoModulo modulo="comercial" />;
}

export function AgenteDaOperacao() {
  return <AgenteNoModulo modulo="operacao" />;
}

export function AgenteDoFinanceiro() {
  return <AgenteNoModulo modulo="financeiro" />;
}
