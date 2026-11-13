import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Ações da página, à direita do título (no máximo um botão primário). */
  actions?: ReactNode;
  /**
   * A linha de estado da lista, sob o título (carregamento v2, seção 5.3):
   * a `LinhaDeEstado`, com os 24 px sempre reservados.
   */
  estado?: ReactNode;
  /** Abas ou filtros que ficam logo abaixo do título. */
  children?: ReactNode;
  className?: string;
};

/**
 * O cabeçalho de página de todas as telas: título em 24px, texto de apoio e
 * ações à direita. Sem ícone em caixa, sem segundo título. Dentro do `.v3`
 * (a tela do WMS que já passou para a v3, parte 4.7), o título segue a v3.
 *
 * Com a linha de estado (`estado`), ela fica sob o título, a 6 px no
 * computador e a 2 px no celular, numa fila só dela, da largura do cabeçalho,
 * sempre abaixo das ações: nunca corre por baixo delas, nem quando a coluna
 * do título é estreita, nem quando as ações quebram em duas linhas. As ações
 * entram 6 px na folga entre as filas (os 40 px delas contra os 36 do título)
 * e são pintadas por cima do toque estendido do "Tentar de novo", que nunca
 * rouba o toque delas.
 */
export function PageHeader({ title, description, actions, estado, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
          estado ? "sm:grid sm:grid-cols-[minmax(min-content,1fr)_auto] sm:gap-x-3 sm:gap-y-1.5" : undefined,
        )}
      >
        <div className={cn("min-w-0", estado ? "sm:col-start-1 sm:row-start-1" : undefined)}>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground in-[.v3]:text-3xl in-[.v3]:font-extrabold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {estado ? <div className="-mt-2.5 min-w-0 sm:col-span-full sm:row-start-2 sm:mt-0">{estado}</div> : null}
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-2",
              estado ? "relative sm:col-start-2 sm:row-start-1 sm:-mb-1.5 sm:self-start" : undefined,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
