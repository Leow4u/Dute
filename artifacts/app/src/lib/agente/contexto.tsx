import { createContext, useContext, type ReactNode } from "react";

import { CLIENTE_DO_WMS, type ClienteDoAgente } from "./cliente";

/**
 * O cliente do Agent Dute da tela (parte 5.5i). Sem provedor, é o agente do
 * WMS, como antes; a página do agente do núcleo põe o dela em volta.
 */
const ContextoDoAgente = createContext<ClienteDoAgente>(CLIENTE_DO_WMS);

export function ProvedorDoAgente({ cliente, children }: { cliente: ClienteDoAgente; children: ReactNode }) {
  return <ContextoDoAgente.Provider value={cliente}>{children}</ContextoDoAgente.Provider>;
}

export function useClienteDoAgente(): ClienteDoAgente {
  return useContext(ContextoDoAgente);
}
