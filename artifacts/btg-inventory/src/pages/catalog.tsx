/**
 * Catálogo — Produtos e SKUs são duas visões do mesmo mestre (mesmo
 * cod_cliente, mesmas colunas). Uma rota só, com as telas existentes
 * renderizadas intactas sob abas; o Mapa do armazém é um pivô da coluna
 * "Localização" dos SKUs e vive aqui como terceira visão.
 */
import { Suspense, lazy } from "react";
import { useLocation } from "wouter";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Products = lazy(() => import("./products"));
const Skus = lazy(() => import("./skus"));
const Warehouse = lazy(() => import("./warehouse"));

const CATALOG_TABS = [
  { value: "cadastro", label: "Cadastro", path: "/catalogo" },
  { value: "saldos", label: "SKUs e saldos", path: "/catalogo/saldos" },
  { value: "mapa", label: "Mapa do armazém", path: "/catalogo/mapa" },
] as const;

type CatalogTab = (typeof CATALOG_TABS)[number]["value"];

function tabFromLocation(location: string): CatalogTab {
  if (location.startsWith("/catalogo/saldos")) return "saldos";
  if (location.startsWith("/catalogo/mapa")) return "mapa";
  return "cadastro";
}

export default function Catalog() {
  const [location, navigate] = useLocation();
  const tab = tabFromLocation(location);

  return (
    <div className="space-y-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const target = CATALOG_TABS.find((item) => item.value === value);
          if (target) navigate(target.path);
        }}
      >
        <TabsList>
          {CATALOG_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Suspense fallback={null}>
        {tab === "cadastro" ? <Products /> : null}
        {tab === "saldos" ? <Skus /> : null}
        {tab === "mapa" ? <Warehouse /> : null}
      </Suspense>
    </div>
  );
}
