import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Cancelar a vistoria (pergunta 58, canvas de 26/10/2026, item 1): a
 * coordenação (owner, admin e interno) cancela a vistoria aberta, agendada
 * ou em execução que não deu certo no local, com o motivo obrigatório. A OS
 * fica Cancelada, e a demanda pode ter outra vistoria. Só apresentação; o
 * envio está em pages/operacao/os.tsx.
 */
export function CancelarVistoriaView({
  motivo,
  onMotivo,
  problema,
  erro,
  ocupado,
  onVoltar,
  onCancelar,
}: {
  motivo: string;
  onMotivo: (motivo: string) => void;
  problema: string | null;
  erro: string | null;
  ocupado: boolean;
  onVoltar: () => void;
  onCancelar: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4 rounded-lg border border-foreground bg-card p-5">
      <h2 id={`${id}-titulo`} className="text-base font-semibold text-foreground">
        Cancelar vistoria
      </h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-motivo`}>Motivo</Label>
        <textarea
          id={`${id}-motivo`}
          rows={2}
          maxLength={200}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground"
          value={motivo}
          onChange={(event) => onMotivo(event.target.value)}
        />
      </div>
      {problema || erro ? (
        <p role="alert" className="text-sm text-destructive">
          {problema ?? erro}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onVoltar} disabled={ocupado}>
          Voltar
        </Button>
        <Button type="button" onClick={onCancelar} disabled={ocupado}>
          Cancelar vistoria
        </Button>
      </div>
    </section>
  );
}
