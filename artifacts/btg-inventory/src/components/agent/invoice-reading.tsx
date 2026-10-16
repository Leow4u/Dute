import { useState } from "react";
import { CheckCircle2, FileText, Loader2, Paperclip, RotateCw, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATTACHMENT_LIMIT_HINT } from "@/lib/shipment-files";
import { invoiceDraft, type InvoiceDraftLine, type InvoiceReading } from "@/lib/shipments";
import { cn } from "@/lib/utils";

/**
 * Leitura da nota pelo Agent Dute, a mesma em Envios para a Dutelog (portal)
 * e em Receber > Chegada avulsa (operação): a zona de anexo que dispara a
 * leitura e o diálogo em que a pessoa confere os itens lidos antes de usar.
 * A IA só preenche; quem decide é quem está na tela.
 */

/**
 * Topo do formulário: a nota vem primeiro. Ao anexar, o Agent Dute lê e
 * preenche fornecedor, NF, observações e itens; a pessoa só confere.
 */
export function InvoiceDrop({
  files,
  readableFile,
  reading,
  preparing,
  read,
  disabled,
  onPick,
  onDrop,
  onRead,
  onRemove,
}: {
  files: File[];
  readableFile: File | undefined;
  reading: boolean;
  preparing: boolean;
  read: boolean;
  disabled: boolean;
  onPick: () => void;
  onDrop: (files: FileList | null) => void;
  onRead: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section
      className="rounded-lg border-[1.5px] border-dashed border-agent-soft-border bg-agent-soft p-5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-agent shadow-sm">
          {reading || preparing ? <Loader2 className="h-5 w-5 animate-spin" /> : read ? <CheckCircle2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-agent-strong">
            {preparing ? "Preparando o arquivo…" : reading ? "Lendo a nota…" : read ? "Nota lida pelo Agent Dute" : "Comece pela nota fiscal ou pedido"}
          </h2>
          <p className="text-sm text-agent">
            {preparing
              ? "Scan grande é reduzido aqui mesmo antes de subir."
              : reading
                ? "O Agent Dute está preenchendo fornecedor, NF, observações e itens."
                : read
                  ? "Confira os dados abaixo antes de enviar. A leitura automática pode errar."
                  : "Anexe em PDF ou foto e o Agent Dute preenche o resto. Sem nota? Preencha abaixo."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {readableFile && !reading ? (
            <Button type="button" size="sm" variant="outline" className="rounded-lg border-agent-soft-border bg-card" disabled={disabled} onClick={onRead}>
              {read ? <RotateCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {read ? "Ler de novo" : "Ler nota"}
            </Button>
          ) : null}
          <Button type="button" size="sm" className="rounded-lg bg-agent text-agent-foreground hover:bg-agent-hover" disabled={disabled || reading || preparing} onClick={onPick}>
            <Paperclip className="h-4 w-4" />
            {files.length ? "Anexar outro" : "Anexar nota"}
          </Button>
        </div>
      </div>
      {files.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-card px-2 py-1 text-xs text-foreground">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
              <button type="button" aria-label={`Remover ${file.name}`} disabled={reading || preparing} onClick={() => onRemove(index)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-agent-muted">ou arraste o arquivo para cá · {ATTACHMENT_LIMIT_HINT}, scan grande é reduzido aqui</p>
      )}
    </section>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50";

/** Produto já cadastrado para o código que está na linha. */
export type InvoiceCatalogMatch = { clientCode: string; name: string };

function normalizedCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Itens lidos da nota, para conferir antes de usar. Os textos têm o padrão
 * do portal (o código a definir fica para a Dutelog na conferência); o
 * Receber passa os seus, porque ali quem lê a etiqueta é o próprio operador.
 */
export function InvoiceReview({
  reading,
  lookup,
  codeListId,
  codeLabel = "Código da BTG",
  intro = "Confira a quantidade e, se souber, o código da BTG. Sem código, a Dutelog define na conferência pela etiqueta.",
  pendingCodeHint = "código a definir · a Dutelog confere pela etiqueta",
  onCancel,
  onUse,
}: {
  reading: InvoiceReading;
  lookup: (code: string) => InvoiceCatalogMatch | null;
  /** id de um <datalist> com os códigos conhecidos, para autocompletar. */
  codeListId?: string;
  codeLabel?: string;
  intro?: string;
  pendingCodeHint?: string;
  onCancel: () => void;
  onUse: (lines: InvoiceDraftLine[]) => void;
}) {
  const [draft, setDraft] = useState(() => invoiceDraft(reading));
  const selected = draft.filter((line) => line.include);
  const update = (key: string, patch: Partial<InvoiceDraftLine>) =>
    setDraft((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const title = [reading.supplier, reading.invoice_number && `NF ${reading.invoice_number}`].filter(Boolean).join(" · ");
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-agent-accent" />
            Itens lidos da nota
          </DialogTitle>
          <DialogDescription>
            {title ? `${title} · ` : ""}
            {draft.length} {draft.length === 1 ? "item" : "itens"}. {intro} A leitura automática pode errar.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 text-left font-semibold">Na nota</th>
                <th className="px-2 py-2 text-left font-semibold">{codeLabel}</th>
                <th className="w-24 px-2 py-2 text-right font-semibold">Peças</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((line) => {
                const match = line.code.trim() ? lookup(line.code) : null;
                return (
                  <tr key={line.key} className={cn("border-t border-border/60", !line.include && "opacity-45")}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={line.include} aria-label="Usar este item" onChange={(event) => update(line.key, { include: event.target.checked })} />
                    </td>
                    <td className="max-w-[300px] px-2 py-2">
                      <span className="line-clamp-2">{line.invoiceText}</span>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={cn(inputClass, "py-1")}
                        value={line.code}
                        list={codeListId}
                        placeholder="Código (se souber)"
                        onChange={(event) => update(line.key, { code: event.target.value })}
                      />
                      <span className="mt-1 block text-xs">
                        {match ? (
                          <span className="text-success-soft-foreground">
                            já no estoque · {match.name}
                            {line.matchedBy === "nome" && normalizedCode(line.code) === normalizedCode(match.clientCode) ? " · achado pelo nome, confira" : ""}
                          </span>
                        ) : line.code.trim() ? (
                          <span className="text-info-soft-foreground">produto novo · {line.name}</span>
                        ) : (
                          <span className="text-warning-soft-foreground">{pendingCodeHint}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={cn(inputClass, "py-1 text-right")}
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(event) => update(line.key, { quantity: event.target.value.replace(/[^\d.,]/g, "") })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={!selected.length} onClick={() => onUse(selected)}>
            Usar {selected.length} {selected.length === 1 ? "item" : "itens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
