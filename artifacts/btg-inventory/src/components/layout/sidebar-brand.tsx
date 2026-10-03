import { cn } from "@/lib/utils";

/**
 * Logo no topo da barra lateral. Aberta, o logo completo; recolhida, só o
 * "D" (o mesmo ícone do app no celular), em vez do logo espremido. As duas
 * imagens ficam sempre na página, já carregadas: ao recolher, uma some e a
 * outra aparece no lugar do D do logo, junto com a barra estreitando, sem
 * nada para baixar.
 */
export function SidebarBrand({ basePath, collapsed }: { basePath: string; collapsed: boolean }) {
  return (
    <span className="relative flex h-9 min-w-8 items-center">
      <img
        src={`${basePath}/dutelog-logo.png`}
        alt={collapsed ? "" : "Dutelog Soluções Logísticas"}
        aria-hidden={collapsed ? "true" : undefined}
        className={cn(
          "h-9 w-auto object-contain transition-[max-width,opacity] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "max-w-0 opacity-0" : "max-w-[168px] opacity-100",
        )}
      />
      <img
        src={`${basePath}/dutelog-mark-180.png`}
        alt={collapsed ? "Dutelog" : ""}
        aria-hidden={collapsed ? undefined : "true"}
        className={cn(
          "pointer-events-none absolute left-0 top-1/2 h-8 w-8 -translate-y-1/2 object-contain transition-opacity duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
}
