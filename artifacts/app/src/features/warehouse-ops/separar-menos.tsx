import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MOTIVOS_DA_DIFERENCA, diferencaValida } from "@/lib/warehouse-ops/separacao";

/**
 * "Separar menos" (separação com caixas, parte 5; decisão 14 de 10/11/2026;
 * docs/mockups/WmsSepararMenos.dc.html): quem opera registra na linha o que
 * separou a menos, com o motivo e, se quiser, o detalhe. O pedido com
 * diferença só conclui com a coordenação. Sem legenda.
 */

export type DiferencaDaLinha = {
  /** A linha da separação (pick_lines). */
  id: string;
  nome: string;
  posicao: string;
  pedido: number;
  separado: number;
  motivo: string;
  detalhe: string;
};

const numero = new Intl.NumberFormat("pt-BR");

/** O separado fica entre zero e o pedido. */
function entreZeroEOPedido(valor: number, pedido: number) {
  return Math.max(0, Math.min(pedido, Math.floor(Number.isFinite(valor) ? valor : 0)));
}

export function SepararMenosConteudo({
  diferenca,
  registrando = false,
  onMudar,
  onVoltar,
  onRegistrar,
}: {
  diferenca: DiferencaDaLinha;
  registrando?: boolean;
  onMudar: (diferenca: DiferencaDaLinha) => void;
  onVoltar: () => void;
  onRegistrar: () => void;
}) {
  const mudar = (valor: number) => onMudar({ ...diferenca, separado: entreZeroEOPedido(valor, diferenca.pedido) });
  return (
    <div className="grid gap-4">
      <p className="text-sm font-medium text-muted-foreground">
        {[diferenca.nome, diferenca.posicao || null, `pedido ${numero.format(diferenca.pedido)} un.`].filter(Boolean).join(" · ")}
      </p>
      <div className="grid max-w-[180px] gap-2">
        <span id="separar-menos-separado" className="text-sm font-medium leading-none">
          Separado
        </span>
        <div role="group" aria-labelledby="separar-menos-separado" className="flex h-11 items-stretch overflow-hidden rounded-lg border border-input bg-background">
          <Button type="button" variant="ghost" className="h-full rounded-none px-3" aria-label="Menos um" disabled={diferenca.separado <= 0} onClick={() => mudar(diferenca.separado - 1)}>
            <Minus className="size-4" aria-hidden="true" />
          </Button>
          <input
            aria-label={`Separado de ${diferenca.nome}`}
            inputMode="numeric"
            value={String(diferenca.separado)}
            onChange={(event) => mudar(Number(event.target.value.replace(/\D/g, "") || 0))}
            className="w-0 flex-1 border-x border-input bg-background text-center font-bold tabular-nums"
          />
          <Button
            type="button"
            variant="ghost"
            className="h-full rounded-none px-3"
            aria-label="Mais um"
            disabled={diferenca.separado >= diferenca.pedido - 1}
            onClick={() => mudar(diferenca.separado + 1)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium leading-none">Motivo da diferença</legend>
        <div className="flex flex-wrap gap-2">
          {MOTIVOS_DA_DIFERENCA.map((motivo) => (
            <label
              key={motivo.valor}
              className={cn(
                "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-input px-3.5 text-sm font-semibold",
                diferenca.motivo === motivo.valor && "border-foreground bg-muted",
              )}
            >
              <input
                type="radio"
                name="separar-menos-motivo"
                value={motivo.valor}
                checked={diferenca.motivo === motivo.valor}
                onChange={() => onMudar({ ...diferenca, motivo: motivo.valor })}
              />
              {motivo.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor="separar-menos-detalhe">Detalhe</Label>
        <Input id="separar-menos-detalhe" value={diferenca.detalhe} maxLength={300} onChange={(event) => onMudar({ ...diferenca, detalhe: event.target.value })} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="button" disabled={registrando || !diferencaValida(diferenca.pedido, diferenca.separado, diferenca.motivo)} onClick={onRegistrar}>
          {registrando ? "Registrando..." : "Registrar diferença"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function SepararMenosDialog({
  diferenca,
  registrando,
  onMudar,
  onFechar,
  onRegistrar,
}: {
  /** A linha aberta no diálogo; null fecha. */
  diferenca: DiferencaDaLinha | null;
  registrando?: boolean;
  onMudar: (diferenca: DiferencaDaLinha) => void;
  onFechar: () => void;
  onRegistrar: () => void;
}) {
  return (
    <Dialog open={Boolean(diferenca)} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Separar menos</DialogTitle>
        </DialogHeader>
        {diferenca ? <SepararMenosConteudo diferenca={diferenca} registrando={registrando} onMudar={onMudar} onVoltar={onFechar} onRegistrar={onRegistrar} /> : null}
      </DialogContent>
    </Dialog>
  );
}
