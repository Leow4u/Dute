import { useId } from "react";
import { getGetBillingPeriodQueryKey, useGetBillingPeriod } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { InvoiceDocument } from "@/components/billing/invoice-document";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { CABECALHO_DO_CLIENTE } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { currentCompetencia } from "@/lib/billing-format";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { buildInvoiceView } from "@/lib/invoice-view";

function competenciaFromUrl() {
  if (typeof window === "undefined") return currentCompetencia();
  const value = new URLSearchParams(window.location.search).get("competencia");
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentCompetencia();
}

/**
 * A fatura da competência como a cliente vai ver. Aberta = prévia com o
 * cálculo da emissão; emitida = snapshot congelado.
 */
export default function BillingInvoice() {
  const competencia = competenciaFromUrl();
  // A fatura do cliente ativo, como no Fechamento do mês (pages/billing.tsx).
  const { code: cliente, isLoading: carregandoCliente, recarregar } = useActiveCustomer();
  const chave = [...getGetBillingPeriodQueryKey(competencia), cliente];
  const leitura = useGetBillingPeriod(competencia, {
    query: { queryKey: chave, enabled: !carregandoCliente },
    request: { headers: { [CABECALHO_DO_CLIENTE]: cliente } },
  });
  const qc = useQueryClient();
  // "Tentar de novo" da demora (10 s): a leitura presa é cancelada e lida de novo (o react-query não recomeça a leitura
  // sem dado). Com o cliente ativo ainda lendo, quem lê de novo é a lista dos clientes, nunca a fatura do cliente padrão.
  const tentarDeNovo = () =>
    carregandoCliente
      ? Promise.resolve(recarregar?.())
      : qc.cancelQueries({ queryKey: chave }).then(() => leitura.refetch());
  // A falha fica na tela enquanto a pessoa tenta de novo (o react-query a voltaria a "carregando"), e só a leitura
  // sem nada lido a mostra: a releitura que falha com a fatura na tela não a apaga (carregamento v2, parte 13d).
  const comFalha = useLeituraComFalha(leitura);
  // Enquanto o cliente ativo lê, o `code` ainda é o do cliente padrão: a fatura dele nunca entra na tela.
  const data = carregandoCliente ? undefined : leitura.data;
  const idDaVolta = useId();
  const period = data as unknown as
    | { status?: string; emitido_em?: string | null }
    | undefined;

  return (
    <div className="space-y-4">
      <Link
        id={idDaVolta}
        href={`/faturamento?competencia=${competencia}`}
        className="no-print inline-flex items-center gap-2 text-sm text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Fechamento do mês
      </Link>
      {comFalha.isError && data === undefined ? (
        <FalhaNaLeitura leitura={leitura} erro={comFalha.error} mensagem="Não consegui carregar a fatura." className="no-print" focoAoSair={idDaVolta} />
      ) : !data ? (
        // A espera em bloco: nada antes de 300 ms, depois a caixa e "Carregando a fatura…", com o anúncio.
        <CarregandoNaRegiao rotulo="Carregando a fatura…" className="no-print" onTentar={tentarDeNovo} focoAoSair={idDaVolta} />
      ) : (
        <InvoiceDocument
          competencia={competencia}
          view={buildInvoiceView(data as unknown as Record<string, unknown>)}
          issuedAt={period?.emitido_em ?? null}
          draft={(period?.status ?? "aberto") === "aberto"}
        />
      )}
    </div>
  );
}
