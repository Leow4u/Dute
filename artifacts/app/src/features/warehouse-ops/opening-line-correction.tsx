import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { openingLineTargets } from "@/lib/opening-line-correction";
import type { WarehouseBox } from "@/lib/warehouse-boxes";
import { fetchJson, formatNumber, getErrorMessage } from "@/lib/warehouse-ops/model";
import type { OpeningInventoryLine } from "./opening-inventory-status";

export function OpeningLineCorrection({
  line, lines, boxes, sessionId, customerCode, onClose,
}: {
  line: OpeningInventoryLine;
  lines: OpeningInventoryLine[];
  boxes: WarehouseBox[];
  sessionId: string;
  customerCode: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const targets = useMemo(
    () => openingLineTargets(boxes, line, customerCode, sessionId, lines),
    [boxes, line, customerCode, sessionId, lines],
  );
  const selected = targets.find((item) => item.box.code === target);
  const canMove = Boolean(selected && !selected.duplicateSku && reason.trim().length >= 3 && reason.trim().length <= 300);
  const move = useMutation({
    mutationFn: async () => {
      if (!canMove) throw new Error("Selecione a caixa física de destino e informe o motivo.");
      const body = { customer_code: customerCode, session_id: sessionId, target_box_code: target, reason: reason.trim() };
      const fingerprint = JSON.stringify(body);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      }
      return fetchJson(
        `/api/warehouse/opening-inventory/lines/${encodeURIComponent(line.id)}/move`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, idempotency_key: attempt.current.key }) },
      );
    },
    onSuccess: () => {
      for (const queryKey of ["opening-inventory-session", "warehouse-boxes", "warehouse-ops", "warehouse-positions", "ai-overview"]) {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      }
      toast({ title: "Caixa do lançamento corrigida", description: `${formatNumber(line.counted_qty)} unidade(s) vinculadas à caixa ${target}. SKU, fotos, custo e quantidade total preservados.` });
      onClose();
    },
    onError: (error) => toast({ title: "Não consegui corrigir a caixa", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !move.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Corrigir caixa do lançamento</DialogTitle>
          <DialogDescription>Selecione a caixa em que estas unidades já estão fisicamente. A correção preserva o cadastro e o total do estoque.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <div className="font-medium">{line.product_name || line.client_item_code || line.sku_code}</div>
            <div className="text-sm text-muted-foreground">{line.client_item_code} · {line.sku_code} · {formatNumber(line.counted_qty)} un.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 font-semibold">
              <span>{line.box_code} · {line.location_id}</span>
              <ArrowRight className="size-4" aria-hidden />
              <span>{selected ? `${selected.box.code} · ${selected.box.location_id}` : "Selecione o destino"}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="opening-correction-target">Caixa física de destino</Label>
            <Select value={target} onValueChange={setTarget} disabled={move.isPending}>
              <SelectTrigger id="opening-correction-target"><SelectValue placeholder="Escolha pela etiqueta da caixa" /></SelectTrigger>
              <SelectContent>
                {targets.map(({ box, duplicateSku }) => (
                  <SelectItem key={box.code} value={box.code} disabled={duplicateSku}>
                    {box.code} · {box.location_id}{duplicateSku ? " · já contém este SKU" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {targets.length ? "A linha inteira será corrigida. Nesta etapa, o destino não pode ter outro lançamento do mesmo SKU." : "Cadastre primeiro a caixa física de destino nesta sessão. Depois volte a Corrigir caixa."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="opening-correction-reason">Motivo da correção</Label>
            <Textarea id="opening-correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={move.isPending} placeholder="Ex.: lançamento feito na caixa anterior por engano" maxLength={300} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={move.isPending}>Voltar</Button>
          <Button type="button" onClick={() => move.mutate()} disabled={!canMove || move.isPending}>
            {move.isPending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : null}
            Confirmar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
