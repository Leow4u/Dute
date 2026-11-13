import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import { cancelarRecebimento, idDoRecebimento, montarCancelamento, opcoesDeRecebimentoOriginal, type CancelarRecebimentoInput, type MotivoDoCancelamento } from "@/lib/wms/cancelar-recebimento";

export type CancelarRecebimentoDialogProps = {
  task: WarehouseTask | null;
  receipts: WarehouseTask[];
  customerCode: string;
  onOpenChange: (open: boolean) => void;
  onCancelled: (receiptId: string) => void;
};

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Uma sessão por cliente/chegada: resposta de uma sessão anterior não altera a nova. */
export function CancelarRecebimentoDialog(props: CancelarRecebimentoDialogProps) {
  if (!props.task) return null;
  return <SessaoDeCancelamento key={`${props.customerCode}:${props.task.id}`} {...props} task={props.task} />;
}

function SessaoDeCancelamento({ task, receipts, customerCode, onOpenChange, onCancelled }: CancelarRecebimentoDialogProps & { task: WarehouseTask }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState<MotivoDoCancelamento>("duplicate");
  const [originalId, setOriginalId] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mounted = useRef(true);
  const attempt = useRef<{ signature: string; input: CancelarRecebimentoInput } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const options = opcoesDeRecebimentoOriginal(task, receipts, customerCode);
  const titulo = task.receipt_number || task.title || idDoRecebimento(task);
  const summary = [titulo, task.invoice_number ? `NF ${task.invoice_number}` : null, `${numero.format(Number(task.quantity ?? task.total_units) || 0)} unidades`].filter(Boolean).join(" · ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    let input: CancelarRecebimentoInput;
    try {
      if (reason === "duplicate" && !options.some((candidate) => idDoRecebimento(candidate) === originalId)) throw new Error("Selecione o recebimento original.");
      const candidate = montarCancelamento({ task, customerCode, reason, note, originalId, key: "" });
      const signature = JSON.stringify(candidate);
      if (attempt.current?.signature !== signature) attempt.current = { signature, input: { ...candidate, idempotency_key: crypto.randomUUID() } };
      input = attempt.current.input;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confira o motivo do cancelamento.");
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await cancelarRecebimento(input);
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      if (!mounted.current) return;
      toast({ title: "Recebimento cancelado", description: titulo });
      onCancelled(result.receipt_id);
      onOpenChange(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não foi possível cancelar o recebimento.");
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function close(open: boolean) { if (!busy.current) onOpenChange(open); }

  // O cancelamento segura o diálogo (o jeito único da parte 13a): nem o Esc, nem o toque fora, nem o X fecham, e o
  // "Voltar" fica ocupado, não desabilitado; o confirmar é o BotaoDeAcao, com o foco nele (carregamento v2, parte 13c).
  return (
    <Dialog open ocupado={pending} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl"><Ban className="size-6 text-muted-foreground" aria-hidden="true" />Cancelar recebimento?</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { void submit(event); }} className="space-y-5" aria-busy={pending}>
          <div className="space-y-2">
            <Label htmlFor="cancelar-motivo">Motivo</Label>
            <select id="cancelar-motivo" className={selectClass} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value as MotivoDoCancelamento); setError(""); }}>
              <option value="duplicate">Duplicado</option>
              <option value="mistake">Lançamento incorreto</option>
              <option value="other">Outro</option>
            </select>
          </div>
          {reason === "duplicate" ? <div className="space-y-2">
            <Label htmlFor="cancelar-original">Recebimento original</Label>
            <select id="cancelar-original" className={selectClass} value={originalId} disabled={pending} aria-required="true" onChange={(event) => { setOriginalId(event.target.value); setError(""); }}>
              <option value="">Selecione o recebimento</option>
              {options.map((candidate) => <option key={candidate.id} value={idDoRecebimento(candidate)}>{[
                candidate.receipt_number || candidate.title || idDoRecebimento(candidate),
                candidate.invoice_number ? `NF ${candidate.invoice_number}` : null,
                `${numero.format(Number(candidate.quantity ?? candidate.total_units) || 0)} un.`,
              ].filter(Boolean).join(" · ")}</option>)}
            </select>
            {!options.length ? <p className="text-sm text-muted-foreground">Nenhum outro recebimento disponível para este cliente.</p> : null}
          </div> : null}
          <div className="space-y-2">
            <Label htmlFor="cancelar-observacao">Observação</Label>
            <Textarea id="cancelar-observacao" value={note} maxLength={500} aria-required={reason === "other"} disabled={pending} onChange={(event) => { setNote(event.target.value); setError(""); }} />
          </div>
          <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            <p>Este recebimento sai da fila e permanece no histórico.</p>
            {reason === "duplicate" ? <p>O recebimento original será mantido.</p> : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2">
            <DialogCancelar onClick={() => close(false)}>Voltar</DialogCancelar>
            <BotaoDeAcao type="submit" estado={pending ? "andamento" : "repouso"} rotulo="Cancelar recebimento" andamento="Cancelando…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
