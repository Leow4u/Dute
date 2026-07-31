/**
 * Faturamento — a Tabela de preços guarda a configuração que a competência
 * executa: um conceito só, uma rota só. As telas existentes renderizam
 * intactas sob abas.
 */
import { Suspense, lazy } from "react";
import { useLocation } from "wouter";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Billing = lazy(() => import("./billing"));
const PriceList = lazy(() => import("./price-list"));

const BILLING_TABS = [
  { value: "competencia", label: "Competência", path: "/faturamento" },
  { value: "tabela", label: "Tabela de preços", path: "/faturamento/tabela" },
] as const;

type BillingTab = (typeof BILLING_TABS)[number]["value"];

function tabFromLocation(location: string): BillingTab {
  return location.startsWith("/faturamento/tabela") ? "tabela" : "competencia";
}

export default function BillingHub() {
  const [location, navigate] = useLocation();
  const tab = tabFromLocation(location);

  return (
    <div className="space-y-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const target = BILLING_TABS.find((item) => item.value === value);
          if (target) navigate(target.path);
        }}
      >
        <TabsList>
          {BILLING_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Suspense fallback={null}>
        {tab === "competencia" ? <Billing /> : null}
        {tab === "tabela" ? <PriceList /> : null}
      </Suspense>
    </div>
  );
}
