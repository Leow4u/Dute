import ComercialAutorizacoesPage from "@/pages/comercial/autorizacoes";

/**
 * Financeiro › Autorizações (Fase 7, parte 7.5c): os executados que esperam a
 * autorização, as autorizadas a faturar e o prazo vencido, só leitura. Quem
 * registra, cancela e perde por prazo é o Comercial.
 */
export default function FinanceiroAutorizacoesPage() {
  return <ComercialAutorizacoesPage somenteLeitura />;
}
