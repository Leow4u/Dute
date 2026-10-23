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
 * - "v3": barra lateral preta de cada módulo (a Armazenagem desde a parte 4.7a);
 * - "v3-cabecalho": cabeçalho preto do celular.
 * Sem opções (um módulo só), mostra só o nome.
 */
export type VarianteDoSeletor = "v3" | "v3-cabecalho";

const GATILHO: Record<VarianteDoSeletor, string> = {
  v3: "flex h-11 w-full items-center gap-2.5 rounded-lg border border-v3-header-foreground/15 bg-v3-header-foreground/5 px-3 text-left text-base font-extrabold text-v3-header-foreground outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
  "v3-cabecalho":
    "flex h-11 min-w-0 items-center gap-2 rounded-lg px-1 text-left text-xl font-extrabold tracking-tight text-v3-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
};

const SO_NOME: Record<VarianteDoSeletor, string> = {
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
  if (!opcoes.length) {
    return (
      <p className={SO_NOME[variante]}>
        {variante === "v3" ? <Icone className="size-5 shrink-0" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate">{atual.label}</span>
      </p>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={GATILHO[variante]}>
        {variante === "v3-cabecalho" ? null : <Icone className="size-5 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{atual.label}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        collisionPadding={16}
        className="v3 w-64 p-1"
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
