import ComercialContratosPage from "@/pages/comercial/contratos";

/**
 * Financeiro › Contratos (Fase 7, parte 7.5c): os contratos do Comercial, só
 * leitura. O Financeiro lê a vigência, as condições de pagamento e faturamento,
 * as tabelas e os aditivos sem editar nada; quem grava é o Comercial.
 */
export default function FinanceiroContratosPage() {
  return <ComercialContratosPage somenteLeitura />;
}
