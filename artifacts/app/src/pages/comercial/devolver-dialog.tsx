import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Devolver para a montagem (advanceQuote return): a nota para quem montou.
 * O aprovador precisa escrever a nota; quem montou e puxa de volta, não
 * (functions/comercial, quotes.ts). Usado na montagem e na tela de aprovar.
 */
export function DevolverDialog({
  aberto,
  ocupado,
  notaObrigatoria,
  onCancelar,
  onDevolver,
}: {
  aberto: boolean;
  ocupado: boolean;
  notaObrigatoria: boolean;
  onCancelar: () => void;
  onDevolver: (nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  useEffect(() => {
    if (aberto) setNota("");
  }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (!notaObrigatoria || nota.trim()) onDevolver(nota);
          }}
        >
          <DialogHeader>
            <DialogTitle>Devolver para montagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="devolver-nota">Nota</Label>
            <Textarea id="devolver-nota" rows={4} value={nota} onChange={(evento) => setNota(evento.target.value)} maxLength={1000} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || (notaObrigatoria && !nota.trim())}>
              {ocupado ? "Devolvendo..." : "Devolver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
