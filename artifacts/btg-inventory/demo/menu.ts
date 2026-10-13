/* DEMO: põe Kits e Destinatários no menu do portal, logo depois de Estoque. */
import { BookUser, Gift, type LucideIcon } from "lucide-react";
import { APP_MODULES, type AppModule } from "../src/lib/modules";

function pageLike(base: AppModule, id: string, label: string, href: string, icon: LucideIcon): AppModule {
  return {
    ...base,
    id,
    label,
    href,
    icon,
    routes: base.routes.slice(0, 1).map((route) => ({ ...route, id: `${id}-page`, label, href, icon })),
  };
}

export function installDemoMenu() {
  if (APP_MODULES.some((module) => module.id === "client-kits")) return;
  const base = APP_MODULES.find((module) => module.id === "client-inventory");
  if (!base) return;
  const at = APP_MODULES.indexOf(base) + 1;
  APP_MODULES.splice(
    at,
    0,
    pageLike(base, "client-kits", "Kits", "/portal/kits", Gift),
    pageLike(base, "client-recipients", "Destinatários", "/portal/destinatarios", BookUser),
  );
}
