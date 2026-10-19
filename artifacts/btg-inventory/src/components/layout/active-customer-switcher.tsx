import { Link } from "wouter";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { templateStatusLabel } from "@/lib/operations";
import { cn } from "@/lib/utils";

/**
 * Seletor do cliente ativo na área interna. Recebimento, contagem, caixas,
 * etiquetas, documentos e notas do agente vão para o cliente escolhido, e a
 * lista de Itens mostra só os dele. Mapa, Início e Pedidos mostram todos.
 */
export function ActiveCustomerSwitcher({
  variant,
  canManageCustomers,
}: {
  variant: "sidebar" | "compact" | "header";
  canManageCustomers: boolean;
}) {
  const { options, active, setCode } = useActiveCustomer();
  const template = active.profile.template;

  const trigger =
    variant === "sidebar" ? (
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-card px-3 py-2 text-left outline-none transition-colors duration-200 hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Cliente ativo: ${active.name}. Trocar cliente`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info-soft-foreground">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">Cliente ativo</span>
          <span className="block truncate text-sm font-semibold text-sidebar-foreground">{active.name}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
    ) : variant === "header" ? (
      <DropdownMenuTrigger
        className="flex min-w-0 max-w-[45vw] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Cliente ativo: ${active.name}. Trocar cliente`}
      >
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{active.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Cliente ativo: ${active.name}. Trocar cliente`}
          >
            <Building2 className="h-4 w-4" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Cliente ativo: {active.name}</TooltipContent>
      </Tooltip>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        align="start"
        side={variant === "compact" ? "right" : "bottom"}
        className="w-[300px]"
      >
        <DropdownMenuLabel className="space-y-0.5">
          <div className="text-sm font-semibold">Cliente ativo</div>
          <div className="text-xs font-normal leading-5 text-muted-foreground">
            Recebimento, contagem, caixas, etiquetas e documentos vão para ele. Mapa, Início e Pedidos mostram
            todos.
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const selected = option.code === active.code;
          return (
            <DropdownMenuItem
              key={option.code}
              className="flex cursor-pointer items-start gap-2 py-2"
              onSelect={() => setCode(option.code)}
            >
              <Check className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{option.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {option.profile.template.label}
                  {option.profile.template.status === "building" ? " · em construção" : ""}
                  {option.paused ? " · pausado" : ""}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">
          Modelo de {active.name}: {template.label} ({templateStatusLabel(template).toLowerCase()})
          {active.profile.pack ? ` · pacote ${active.profile.pack.key}` : ""}
        </div>
        {canManageCustomers ? (
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/clientes" className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Cadastrar ou editar clientes
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
