import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { MOTIVO_DA_FALTA, type FaltaMarcada } from "@/lib/wms/caixas-do-recebimento";

/**
 * "Marcar falta" na linha da NF (docs/plataforma/recebimento-com-caixas.md,
 * decisão 17, parte 5d; mockup WmsRecebimentoFalta): o que a NF pede, o que
 * está nas caixas e a falta, o motivo (falta ou avaria) e o detalhe. A marca
 * vale para o que estava nas caixas; mudou, ela fica velha e a linha volta a
 * pedir a marca.
 */

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type Motivo = FaltaMarcada["reason"];

const MOTIVOS = [
  { value: "falta", label: MOTIVO_DA_FALTA.falta },
  { value: "avaria", label: MOTIVO_DA_FALTA.avaria },
] as const;

export type FaltaDaLinhaProps = {
  linha: WarehouseTaskItem;
  /** O que a NF pede, o que está nas caixas e a falta, como a tela viu. */
  nf: number;
  emCaixas: number;
  falta: number;
  enviando: boolean;
  onCancelar: () => void;
  onMarcar: (marca: { motivo: Motivo; detalhe: string }) => void;
};

/** O corpo do diálogo, com o motivo e o detalhe digitados. */
export function FaltaDaLinhaConteudo({
  linha,
  nf,
  emCaixas,
  falta,
  enviando,
  onCancelar,
  onMarcar,
  motivoInicial = "falta",
  detalheInicial = "",
}: FaltaDaLinhaProps & { motivoInicial?: Motivo; detalheInicial?: string }) {
  const [motivo, setMotivo] = useState<Motivo>(motivoInicial);
  const [detalhe, setDetalhe] = useState(detalheInicial);
  const codigos = [linha.client_item_code, linha.sku_code].filter(Boolean).join(" · ");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!enviando) onMarcar({ motivo, detalhe: detalhe.trim() });
      }}
    >
      <div>
        <p className="font-semibold text-foreground">{linha.product_name || linha.name || linha.sku_code}</p>
        {codigos ? <p className="text-sm text-muted-foreground">{codigos}</p> : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3.5">
        <div>
          <dt className="text-xs font-bold text-muted-foreground">NF</dt>
          <dd className="font-extrabold">{numero.format(nf)} un.</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-muted-foreground">Em caixas</dt>
          <dd className="font-extrabold">{numero.format(emCaixas)} un.</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-muted-foreground">Falta</dt>
          <dd className="font-extrabold">{numero.format(falta)} un.</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Motivo</span>
        <Segmented<Motivo> aria-label="Motivo" options={MOTIVOS} value={motivo} onChange={setMotivo} className="w-fit" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="falta-detalhe">Detalhe</Label>
        <Input id="falta-detalhe" maxLength={300} value={detalhe} onChange={(event) => setDetalhe(event.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          Marcar falta de {numero.format(falta)} un.
        </Button>
      </div>
    </form>
  );
}

export function FaltaDaLinha(props: Omit<FaltaDaLinhaProps, "linha"> & { linha: WarehouseTaskItem | null }) {
  const { linha } = props;
  return (
    <Dialog open={Boolean(linha)} onOpenChange={(aberto) => (aberto ? undefined : props.onCancelar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar falta · linha {linha?.line_number ?? ""}</DialogTitle>
        </DialogHeader>
        {linha ? <FaltaDaLinhaConteudo key={linha.id ?? String(linha.line_number)} {...props} linha={linha} /> : null}
      </DialogContent>
    </Dialog>
  );
}
