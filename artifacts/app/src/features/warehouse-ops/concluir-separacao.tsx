import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CaixasDoPedido } from "@/lib/warehouse-ops/caixas-da-separacao";

/**
 * "Concluir separação" (separação com caixas, partes 2 e 3;
 * docs/mockups/WmsSepararConcluir.dc.html): com todas as linhas tratadas, o
 * pedido pede o "Número do lacre", um por pedido (decisão 5), e fecha a
 * separação e a embalagem numa chamada. O diálogo diz as caixas de onde o
 * pedido saiu: as inteiras, as abertas e as vazias. Os volumes da prancha
 * entram com a parte 4. Sem legenda.
 */

const numero = new Intl.NumberFormat("pt-BR");

export function ConcluirSeparacaoConteudo({
  resumo,
  caixas,
  lacre,
  confirmando = false,
  onLacre,
  onVoltar,
  onConfirmar,
}: {
  /** "BTG Pactual · 116 itens · 3.335 un. · Para quando Seg 16/11 11:36" */
  resumo: string;
  /** As caixas de onde o pedido saiu; sem a leitura delas, o diálogo não as conta. */
  caixas?: CaixasDoPedido | null;
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
      {caixas && caixas.inteiras + caixas.abertas + caixas.vazias > 0 ? (
        <dl className="grid grid-cols-3 gap-2">
          {(
            [
              ["Caixas inteiras", caixas.inteiras],
              ["Caixas abertas", caixas.abertas],
              ["Caixas vazias", caixas.vazias],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-border bg-card px-3 py-2">
              <dt className="text-xs font-medium text-muted-foreground">{rotulo}</dt>
              <dd className="text-lg font-extrabold tabular-nums text-foreground">{numero.format(valor)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
  numero: pedido,
  resumo,
  caixas,
  lacre,
  confirmando,
  onLacre,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  numero: string;
  resumo: string;
  caixas?: CaixasDoPedido | null;
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
          <DialogTitle>{pedido}: concluir separação</DialogTitle>
        </DialogHeader>
        <ConcluirSeparacaoConteudo resumo={resumo} caixas={caixas} lacre={lacre} confirmando={confirmando} onLacre={onLacre} onVoltar={onFechar} onConfirmar={onConfirmar} />
      </DialogContent>
    </Dialog>
  );
}
