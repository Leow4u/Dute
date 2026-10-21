import { Link, useLocation } from "wouter";

import { TELAS_DO_COMERCIAL, abasVisiveis } from "@/lib/comercial/navegacao";
import { isRouteActive } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Barra de abas do Comercial (Orçamentos · Contratos · Autorizações ·
 * Medições), como em docs/mockups/ComFila.dc.html e ComContrato.dc.html. Só
 * aparecem as abas que já têm tela (lib/comercial/navegacao.ts); sem nenhuma,
 * a barra não existe. Fica dentro de um contêiner .v3.
 */
export function AbasDoComercial({ telas = TELAS_DO_COMERCIAL }: { telas?: readonly string[] }) {
  const [location] = useLocation();
  const abas = abasVisiveis(telas);
  if (!abas.length) return null;
  return (
    <nav aria-label="Comercial" className="inline-flex flex-wrap gap-0.5 self-start rounded-lg bg-muted p-1">
      {abas.map((aba) => {
        const atual = [aba.href, ...(aba.tambem ?? [])].some((href) => isRouteActive(location, href, true));
        return (
          <Link
            key={aba.id}
            href={aba.href}
            aria-current={atual ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md border px-3.5 text-sm font-bold transition-colors",
              atual
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {aba.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
