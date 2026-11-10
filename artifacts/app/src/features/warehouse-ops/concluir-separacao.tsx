import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Concluir separação" (separação com caixas, parte 2;
 * docs/mockups/WmsSepararConcluir.dc.html): com todas as linhas tratadas, o
 * pedido pede o "Número do lacre", um por pedido (decisão 5), e fecha a
 * separação e a embalagem numa chamada. Os volumes e as caixas da prancha
 * entram com as partes 3 e 4. Sem legenda.
 */

export function ConcluirSeparacaoConteudo({
  resumo,
  lacre,
  confirmando = false,
  onLacre,
  onVoltar,
  onConfirmar,
}: {
  /** "BTG Pactual · 116 itens · 3.335 un. · Para quando Seg 16/11 11:36" */
  resumo: string;
  lacre: string;
  confirmando?: boolean;
  onLacre: (lacre: string) => void;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (lacre.trim() && !confirmando) onConfirmar();
      }}
    >
      {resumo ? <p className="text-sm font-medium text-muted-foreground">{resumo}</p> : null}
      <div className="grid max-w-[260px] gap-2">
        <Label htmlFor="concluir-separacao-lacre">Número do lacre</Label>
        <Input id="concluir-separacao-lacre" value={lacre} maxLength={60} onChange={(event) => onLacre(event.target.value)} autoFocus />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="submit" disabled={!lacre.trim() || confirmando}>
          {confirmando ? "Registrando..." : "Confirmar separação"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConcluirSeparacaoDialog({
  aberto,
  numero,
  resumo,
  lacre,
  confirmando,
  onLacre,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  numero: string;
  resumo: string;
  lacre: string;
  confirmando?: boolean;
  onLacre: (lacre: string) => void;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{numero}: concluir separação</DialogTitle>
        </DialogHeader>
        <ConcluirSeparacaoConteudo resumo={resumo} lacre={lacre} confirmando={confirmando} onLacre={onLacre} onVoltar={onFechar} onConfirmar={onConfirmar} />
      </DialogContent>
    </Dialog>
  );
}
