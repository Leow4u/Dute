/**
 * Faturamento — a Tabela de preços guarda a configuração que a competência
 * executa: um conceito só, uma rota só. As telas existentes renderizam
 * intactas sob abas.
 */
import { Suspense } from "react";
import { useLocation } from "wouter";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { useAppUser } from "@/lib/auth";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { nomeDaTela } from "@/lib/document-title";
import { SOMENTE_ARMAZENAGEM } from "@/lib/somente-armazenagem";
import { telaSobDemanda } from "@/lib/telas-no-aparelho";

// As abas chegam sob demanda e, para a equipe, ficam guardadas no aparelho junto com o Faturamento.
const Billing = telaSobDemanda("pages/billing", () => import("./billing"));
const PriceList = telaSobDemanda("pages/price-list", () => import("./price-list"));
const Contratos = telaSobDemanda("pages/comercial/contratos", () => import("./comercial/contratos"));

const BILLING_TABS = [
  { value: "competencia", label: "Fechamento do mês", path: "/faturamento" },
  { value: "tabela", label: "Tabela de preços", path: "/faturamento/tabela" },
  { value: "contratos", label: "Contratos e tabelas", path: "/faturamento/contratos" },
] as const;

type BillingTab = (typeof BILLING_TABS)[number]["value"];

function tabFromLocation(location: string): BillingTab {
  if (location.startsWith("/faturamento/contratos")) return "contratos";
  return location.startsWith("/faturamento/tabela") ? "tabela" : "competencia";
}

export default function BillingHub() {
  const [location, navigate] = useLocation();
  const { user } = useAppUser();
  const { code, isLoading } = useActiveCustomer();
  const role = user?.publicMetadata.role;
  // Mantém os papéis que já podem editar contratos e tabelas no backend.
  const podeManterContratos = SOMENTE_ARMAZENAGEM && (role === "owner" || role === "admin");
  const tabs = BILLING_TABS.filter((item) => item.value !== "contratos" || podeManterContratos);
  const tab = tabFromLocation(location);

  return (
    <div className="space-y-5">
      <PageHeader title="Faturamento" description="Fechamento do mês e tabela de preços do cliente ativo">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const target = tabs.find((item) => item.value === value);
            if (target) navigate(target.path);
          }}
        >
          <TabsList>
            {tabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {/* O mesmo nome da espera da rota: a tela não troca de nome no meio da espera. */}
      <Suspense fallback={<CarregandoTela titulo={nomeDaTela(location)} />}>
        {tab === "competencia" ? <Billing /> : null}
        {tab === "tabela" ? <PriceList /> : null}
        {tab === "contratos" && podeManterContratos ? (
          // A aba é do cliente ativo: enquanto ele lê, a espera da tela que abre, nunca a aba em branco (carregamento
          // v2, parte 13d).
          isLoading ? (
            <CarregandoTela titulo={nomeDaTela(location)} />
          ) : (
            <Contratos key={code} rotaBase="/faturamento/contratos" clienteCodigo={code} />
          )
        ) : null}
      </Suspense>
    </div>
  );
}
