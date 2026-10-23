import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Reabrir a OS revisada (parte 3.10b): só owner e admin. A OS volta a Em
 * execução, com a revisão e a conclusão guardadas no histórico dela; a
 * demanda direta volta a Para planejar (reopenServiceOrder, parte 3.10a).
 * Só apresentação; o envio está em pages/operacao/os.tsx.
 */
export function ReabrirView({
  motivo,
  onMotivo,
  problema,
  erro,
  ocupado,
  onCancelar,
  onReabrir,
}: {
  motivo: string;
  onMotivo: (motivo: string) => void;
  problema: string | null;
  erro: string | null;
  ocupado: boolean;
  onCancelar: () => void;
  onReabrir: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4 rounded-lg border border-foreground bg-card p-5">
      <h2 id={`${id}-titulo`} className="text-base font-semibold text-foreground">
        Reabrir OS
      </h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-motivo`}>Motivo</Label>
        <textarea id={`${id}-motivo`} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground" value={motivo} onChange={(event) => onMotivo(event.target.value)} />
      </div>
      {problema || erro ? (
        <p role="alert" className="text-sm text-destructive">
          {problema ?? erro}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button type="button" onClick={onReabrir} disabled={ocupado}>
          Reabrir OS
        </Button>
      </div>
    </section>
  );
}
