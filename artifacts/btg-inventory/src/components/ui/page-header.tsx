import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Ações da página, à direita do título (no máximo um botão primário). */
  actions?: ReactNode;
  /** Abas ou filtros que ficam logo abaixo do título. */
  children?: ReactNode;
  className?: string;
};

/**
 * O cabeçalho de página de todas as telas: título em 24px, texto de apoio e
 * ações à direita. Sem ícone em caixa, sem segundo título.
 */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
