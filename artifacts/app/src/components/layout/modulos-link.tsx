import { LayoutGrid } from "lucide-react";
import { Link } from "wouter";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Volta para a tela de entrada, onde os cards dos módulos da pessoa
 * aparecem. Só entra no shell quando há mais de um módulo (podeTrocarDeModulo).
 */
export function ModulosLink({ variant }: { variant: "sidebar" | "collapsed" | "header" }) {
  if (variant === "collapsed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            aria-label="Módulos"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-sidebar-foreground/60 outline-none transition-colors duration-200 hover:bg-card hover:text-sidebar-foreground"
          >
            <LayoutGrid className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Módulos</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === "header") {
    return (
      <Link
        href="/"
        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-2 text-sm font-medium text-foreground outline-none transition-colors duration-200 hover:bg-muted"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        Módulos
      </Link>
    );
  }

  return (
    <Link
      href="/"
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium text-sidebar-foreground/70 outline-none transition-colors duration-200 hover:bg-card hover:text-sidebar-foreground",
      )}
    >
      <LayoutGrid className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Módulos</span>
    </Link>
  );
}
