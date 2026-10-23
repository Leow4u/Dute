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
 * ações à direita. Sem ícone em caixa, sem segundo título. Dentro do `.v3`
 * (a tela do WMS que já passou para a v3, parte 4.7), o título segue a v3.
 */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground in-[.v3]:text-3xl in-[.v3]:font-extrabold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
