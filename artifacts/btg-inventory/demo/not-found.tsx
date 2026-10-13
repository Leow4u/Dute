/*
 * DEMO: substitui src/pages/not-found. As telas que só existem na demo
 * (Kits, Eventos e Destinatários) caem aqui por não estarem nas rotas do App; as
 * outras continuam com o 404 de verdade.
 */
import { Suspense, type ComponentType } from "react";
import { useLocation } from "wouter";
import AppLayout from "../src/components/layout/app-layout";
import NotFound from "../src/pages/not-found";
import { DemoRecipients } from "./portal/destinatarios";
import { DemoEvents } from "./portal/eventos";
import { DemoKits } from "./portal/kits";

const PAGES: Record<string, ComponentType> = {
  "/portal/kits": DemoKits,
  "/portal/eventos": DemoEvents,
  "/portal/destinatarios": DemoRecipients,
};

export default function DemoPages() {
  const [location] = useLocation();
  const Page = PAGES[location];
  if (!Page) return <NotFound />;
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </AppLayout>
  );
}
