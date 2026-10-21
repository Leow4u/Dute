import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LinhaAutorizada } from "@/lib/comercial/autorizacoes";

/**
 * Cancelar a autorização registrada por engano (recordAuthorization, cancel):
 * pede o motivo; as demandas sem outra autorização voltam a aguardar. A
 * gravação, com a chave de idempotência, é da página. O diálogo abre fora do
 * contêiner da tela (portal), então leva a classe .v3.
 */
export function CancelarAutorizacaoDialog({
  autorizacao,
  ocupado,
  erro,
  onVoltar,
  onConfirmar,
}: {
  autorizacao: LinhaAutorizada | null;
  ocupado: boolean;
  erro: string | null;
  onVoltar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const id = autorizacao?.id ?? null;
  useEffect(() => {
    setMotivo("");
  }, [id]);
  return (
    <Dialog
      open={autorizacao !== null}
      onOpenChange={(aberto) => {
        if (!aberto && !ocupado) onVoltar();
      }}
    >
      <DialogContent className="v3 max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar autorização</DialogTitle>
          {autorizacao ? (
            <DialogDescription>
              {[autorizacao.pedido, autorizacao.cliente, autorizacao.demandas.join(", ")].filter(Boolean).join(" · ")}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {autorizacao?.daMedicao ? (
          <p className="text-sm font-bold text-muted-foreground">
            A medição segue aprovada e a autorização não se refaz por aqui: as demandas voltam a esperar a medição.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="aut-motivo">Motivo</Label>
          <Textarea id="aut-motivo" rows={3} value={motivo} onChange={(evento) => setMotivo(evento.target.value)} disabled={ocupado} />
        </div>
        {erro ? (
          <p role="alert" className="text-sm font-bold text-destructive">
            {erro}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onVoltar} disabled={ocupado}>
            Voltar
          </Button>
          <Button type="button" variant="destructive" onClick={() => onConfirmar(motivo)} disabled={ocupado}>
            Cancelar autorização
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
