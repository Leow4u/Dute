import { Check, ChevronsUpDown, LayoutGrid, type LucideIcon } from "lucide-react";
import { Link } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpcaoDeModulo } from "@/lib/seletor-de-modulo";
import { cn } from "@/lib/utils";

/**
 * O nome do módulo aberto, no topo do shell, é o seletor (lib/seletor-de-modulo.ts).
 * - "v3": barra lateral preta do Comercial e da Operação;
 * - "v3-cabecalho": cabeçalho preto do celular;
 * - "wms" e "wms-compacto": barra clara do WMS, aberta e recolhida.
 * Sem opções (um módulo só), a v3 mostra só o nome e o WMS não mostra nada.
 */
export type VarianteDoSeletor = "v3" | "v3-cabecalho" | "wms" | "wms-compacto";

const GATILHO: Record<VarianteDoSeletor, string> = {
  v3: "flex h-11 w-full items-center gap-2.5 rounded-lg border border-v3-header-foreground/15 bg-v3-header-foreground/5 px-3 text-left text-base font-extrabold text-v3-header-foreground outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
  "v3-cabecalho":
    "flex h-11 min-w-0 items-center gap-2 rounded-lg px-1 text-left text-xl font-extrabold tracking-tight text-v3-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
  wms: "flex h-11 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card px-3 text-left text-sm font-bold text-sidebar-foreground outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring",
  "wms-compacto":
    "flex h-11 w-11 items-center justify-center rounded-xl text-sidebar-foreground/70 outline-none transition-colors hover:bg-card hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
};

const SO_NOME: Partial<Record<VarianteDoSeletor, string>> = {
  v3: "flex h-11 items-center gap-2.5 px-3 text-base font-extrabold text-v3-header-foreground",
  "v3-cabecalho": "flex h-11 min-w-0 items-center gap-2 px-1 text-xl font-extrabold tracking-tight text-v3-header-foreground",
};

export function SeletorDeModulo({
  atual,
  opcoes,
  variante,
}: {
  atual: { label: string; icon: LucideIcon };
  opcoes: readonly OpcaoDeModulo[];
  variante: VarianteDoSeletor;
}) {
  const Icone = atual.icon;
  const v3 = variante === "v3" || variante === "v3-cabecalho";
  if (!opcoes.length) {
    const classe = SO_NOME[variante];
    if (!classe) return null;
    return (
      <p className={classe}>
        {variante === "v3" ? <Icone className="size-5 shrink-0" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate">{atual.label}</span>
      </p>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={GATILHO[variante]} aria-label={variante === "wms-compacto" ? `Módulo: ${atual.label}` : undefined}>
        {variante === "v3-cabecalho" ? null : <Icone className="size-5 shrink-0" aria-hidden="true" />}
        {variante === "wms-compacto" ? null : <span className="min-w-0 flex-1 truncate">{atual.label}</span>}
        {variante === "wms-compacto" ? null : <ChevronsUpDown className="size-4 shrink-0 opacity-70" aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={variante === "wms-compacto" ? "right" : "bottom"}
        collisionPadding={16}
        className={cn("w-64 p-1", v3 && "v3")}
      >
        {opcoes.map((opcao) => {
          const IconeDaOpcao = opcao.icon;
          return (
            <DropdownMenuItem key={opcao.key} asChild>
              <Link
                href={opcao.href}
                aria-current={opcao.atual ? "page" : undefined}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm font-bold",
                  opcao.atual && "bg-accent text-accent-foreground",
                )}
              >
                <IconeDaOpcao className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{opcao.label}</span>
                {opcao.atual ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm font-bold">
            <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
            <span>Todos os módulos</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
