import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, MessageSquareWarning, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { generatedSkuNote, type SavedLineCodes } from "@/lib/product-match";
import {
  type AdvanceTaskPayload,
  type ExceptionPayload,
  type TaskQueueEntry,
  type WarehouseTask,
  EXCEPTION_EVENT_TYPE,
  fetchJson,
  getErrorMessage,
  getTaskTitle,
} from "@/lib/warehouse-ops/model";

/**
 * Ações da bancada WMS (avançar tarefa, registrar exceção, chegada avulsa)
 * e o estado do diálogo de exceção, compartilhados por Receber, Pedidos e
 * Qualidade. Os payloads são os de sempre: o backend valida papel, status
 * atual e idempotência; a tela só encadeia.
 */
export function useWarehouseTaskActions({
  findEntry,
}: {
  findEntry: (taskId: string) => TaskQueueEntry | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionTaskId, setExceptionTaskId] = useState<string>();
  const [exceptionNote, setExceptionNote] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
    queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
  };

  const advanceTask = useMutation<unknown, Error, AdvanceTaskPayload>({
    mutationFn: ({ id: taskId, operation, note }) => {
      const task = findEntry(taskId)?.task;
      return fetchJson(`/api/warehouse/tasks/${encodeURIComponent(taskId)}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_status: task?.status,
          operation,
          note,
          idempotency_key: `${taskId}:${task?.status ?? "unknown"}`,
        }),
      });
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "Tarefa avançada",
        description: "A bancada WMS foi atualizada com a próxima etapa.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui avançar a tarefa",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const registerException = useMutation<unknown, Error, ExceptionPayload>({
    mutationFn: ({ task, queue, note }) =>
      fetchJson(`/api/warehouse/tasks/${encodeURIComponent(task.id)}/exception`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note: note || task.blocked_reason || "Exceção registrada na bancada WMS.",
          severity:
            task.priority === "critical" || task.blocked_reason
              ? "critical"
              : "attention",
          source: "warehouse_ops",
          payload: {
            queue,
            event_type: EXCEPTION_EVENT_TYPE[queue],
            task_id: task.id,
            reference: task.reference,
            status: task.status,
            customer_request_id: task.customer_request_id,
            blocked_reason: task.blocked_reason,
            exception_count: task.exception_count,
          },
        }),
      }),
    onSuccess: () => {
      setExceptionOpen(false);
      setExceptionTaskId(undefined);
      setExceptionNote("");
      invalidate();
      toast({
        title: "Exceção registrada",
        description: "O evento operacional foi enviado para a memória da IA.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a exceção",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const createUnplannedReceipt = useMutation<unknown, Error, Record<string, unknown>>({
    mutationFn: (payload) =>
      fetchJson("/api/warehouse/receipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      invalidate();
      const generated = generatedSkuNote(
        (result as { items?: SavedLineCodes[] } | undefined)?.items,
      );
      toast({
        title: "Chegada avulsa registrada",
        description: [
          "A conferência foi criada no WMS sem lançar estoque ainda.",
          generated,
        ]
          .filter(Boolean)
          .join(" "),
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a chegada",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const exceptionEntry = exceptionTaskId ? findEntry(exceptionTaskId) : undefined;

  function openFor(task: WarehouseTask, suggestedNote?: string) {
    setExceptionTaskId(task.id);
    setExceptionNote(suggestedNote || task.blocked_reason || "");
    setExceptionOpen(true);
  }

  function onOpenChange(open: boolean) {
    setExceptionOpen(open);
    if (!open && !registerException.isPending) {
      setExceptionTaskId(undefined);
      setExceptionNote("");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, fallback?: TaskQueueEntry) {
    event.preventDefault();
    const entry = exceptionEntry ?? fallback;
    if (!entry) return;
    registerException.mutate({
      task: entry.task,
      queue: entry.queue.key,
      note: exceptionNote.trim(),
    });
  }

  return {
    advanceTask,
    registerException,
    createUnplannedReceipt,
    advancingTaskId: advanceTask.isPending ? advanceTask.variables?.id : undefined,
    registeringExceptionId: registerException.isPending
      ? registerException.variables?.task.id
      : undefined,
    exception: {
      open: exceptionOpen,
      entry: exceptionEntry,
      note: exceptionNote,
      setNote: setExceptionNote,
      openFor,
      onOpenChange,
      submit,
    },
  };
}

export function ExceptionDialog({
  open,
  taskEntry,
  note,
  isPending,
  onOpenChange,
  onNoteChange,
  onSubmit,
}: {
  open: boolean;
  taskEntry?: TaskQueueEntry;
  note: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const task = taskEntry?.task;
  const title = task ? getTaskTitle(task) : "Tarefa";
  const canSubmit = Boolean(task && (note.trim() || task.blocked_reason));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-5" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Registrar exceção</DialogTitle>
            <DialogDescription>
              {title} · {taskEntry?.queue.label ?? "Fila WMS"}
            </DialogDescription>
          </DialogHeader>

          {task?.blocked_reason ? (
            <Alert className="border-destructive/20 bg-destructive/10 text-destructive">
              <Ban className="size-4" />
              <AlertTitle>Bloqueio atual</AlertTitle>
              <AlertDescription>{task.blocked_reason}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="warehouse-exception-note">
              Motivo da exceção
            </label>
            <Textarea
              id="warehouse-exception-note"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Divergência, falta, avaria, documento pendente..."
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <MessageSquareWarning data-icon="inline-start" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
