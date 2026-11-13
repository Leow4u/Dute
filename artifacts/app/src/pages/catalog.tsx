/**
 * Catálogo — Produtos e SKUs são duas visões do mesmo mestre (mesmo
 * cod_cliente, mesmas colunas). Uma rota só, com as telas existentes
 * renderizadas intactas sob abas. O Mapa do armazém saiu daqui em 16/10/2026:
 * vive em Estoque › Mapa, com as posições cadastradas e as caixas guardadas.
 */
import { Suspense } from "react";
import { useLocation } from "wouter";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { telaSobDemanda } from "@/lib/telas-no-aparelho";

// As abas chegam sob demanda e, para a equipe, ficam guardadas no aparelho junto com o Catálogo.
const Products = telaSobDemanda(() => import("./products"));
const Skus = telaSobDemanda(() => import("./skus"));

const CATALOG_TABS = [
  { value: "cadastro", label: "Cadastro", path: "/catalogo" },
  { value: "saldos", label: "SKUs e saldos", path: "/catalogo/saldos" },
] as const;

type CatalogTab = (typeof CATALOG_TABS)[number]["value"];

function tabFromLocation(location: string): CatalogTab {
  if (location.startsWith("/catalogo/saldos")) return "saldos";
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

      <Suspense fallback={<CarregandoTela titulo={CATALOG_TABS.find((item) => item.value === tab)?.label} />}>
        {tab === "cadastro" ? <Products /> : null}
        {tab === "saldos" ? <Skus /> : null}
      </Suspense>
    </div>
  );
}
