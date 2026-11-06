import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * A leitura falhou e a tela não tem nada para mostrar: a falha no lugar da
 * lista, com a nova tentativa. Erro nunca vira vazio
 * (docs/plataforma/diagnostico-carregamento.md; mockup
 * docs/mockups/WmsCarregandoPedidosErro.dc.html).
 */
export function ErroNaLeitura({
  mensagem,
  tentando,
  onTentar,
  className,
}: {
  mensagem: string;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
        className,
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-destructive-soft text-destructive">
        <AlertCircle className="size-5" aria-hidden="true" />
      </span>
      <p className="flex-1 text-base font-semibold text-foreground">{mensagem}</p>
      <Button type="button" variant="outline" disabled={tentando} aria-busy={tentando || undefined} onClick={onTentar}>
        {tentando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {tentando ? "Tentando de novo…" : "Tentar de novo"}
      </Button>
    </div>
  );
}
