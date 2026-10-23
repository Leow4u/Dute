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
import { useActiveCustomer } from "@/lib/active-customer-context";
import { templateStatusLabel } from "@/lib/operations";
import { cn } from "@/lib/utils";

/**
 * Seletor do cliente ativo na área interna. Recebimento, contagem, caixas,
 * etiquetas, documentos e notas do agente vão para o cliente escolhido, e a
 * lista de Itens mostra só os dele. Mapa, Início e Pedidos mostram todos.
 * Fica na barra preta do shell v3 da Armazenagem (parte 4.7), logo abaixo do
 * seletor de módulo, e no cabeçalho do celular. Sem legenda: o nome do
 * cliente e a troca.
 */
export function ActiveCustomerSwitcher({
  variant,
  canManageCustomers,
}: {
  variant: "v3" | "v3-cabecalho";
  canManageCustomers: boolean;
}) {
  const { options, active, setCode } = useActiveCustomer();
  const template = active.profile.template;
  const rotulo = `Cliente ativo: ${active.name}. Trocar cliente`;

  const trigger =
    variant === "v3" ? (
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80"
        aria-label={rotulo}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-v3-header-foreground/15 text-v3-header-foreground">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-v3-header-foreground/65">Cliente ativo</span>
          <span className="block truncate text-sm font-bold text-v3-header-foreground">{active.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-v3-header-foreground/70" aria-hidden="true" />
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger
        className="flex h-10 min-w-0 max-w-full items-center gap-2 rounded-lg px-1.5 text-sm font-bold text-v3-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80"
        aria-label={rotulo}
      >
        <Building2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{active.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align="start" side="bottom" collisionPadding={16} className="v3 w-[300px]">
        <DropdownMenuLabel className="text-sm font-semibold">Cliente ativo</DropdownMenuLabel>
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
