import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Loader2, Paperclip, Plus, X } from "lucide-react";

import { InvoiceDrop, InvoiceReview } from "@/components/agent/invoice-reading";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  SHIPMENT_STEPS,
  pendingCodeItem,
  shipmentLineProblem,
  fillIfEmpty,
  parsePastedItems,
  splitShipments,
  stageIndex,
  type InvoiceDraftLine,
  type InvoiceReading,
  type ShipmentView,
} from "@/lib/shipments";
import { takeDraft, type ShipmentDraft } from "@/lib/agent-draft";
import { ATTACHMENT_LIMIT_HINT, isAcceptedAttachment, prepareAttachment, uploadAttachment } from "@/lib/shipment-files";
import { cn } from "@/lib/utils";

import {
  ClientDataBoundary,
  clientOverviewQueryKey,
  createClientRequest,
  firstText,
  getInventoryItems,
  getRequests,
  inventoryItemClientCode,
  inventoryItemName,
  inventoryItemSku,
  type ClientOverview,
  type ClientRequestAttachment,
  type InventoryItem,
} from "./shared";

/**
 * Envios para a Dutelog: a BTG comprou de um fornecedor que vai entregar no
 * armazém da Dutelog e avisa para a equipe se programar. O aviso não mexe no
 * estoque; só a conferência física na chegada lança saldo.
 */

const integer = new Intl.NumberFormat("pt-BR");

export function ClienteEnvios() {
  const [, navigate] = useLocation();
  const wantsDraft = new URLSearchParams(useSearch()).get("rascunho") === "1";
  // Rascunho do Agent Dute: abre o aviso já preenchido; quem envia é a pessoa.
  const [initial] = useState(() => (wantsDraft ? takeDraft("envio") : null));
  const [creating, setCreating] = useState(Boolean(initial));
  useEffect(() => {
    if (wantsDraft) navigate("/portal/recebimentos", { replace: true });
  }, [wantsDraft, navigate]);
  return (
    <ClientDataBoundary>
      {(overview) =>
        creating ? (
          <ShipmentForm overview={overview} initial={initial} onClose={() => setCreating(false)} />
        ) : (
          <ShipmentList overview={overview} onCreate={() => setCreating(true)} />
        )
      }
    </ClientDataBoundary>
  );
}

function Page({ title, subtitle, action, children }: { title: string; subtitle: string; action: ReactNode; children: ReactNode }) {
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
        <PageHeader title={title} description={subtitle} actions={action} />
        {children}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ lista

function ShipmentList({ overview, onCreate }: { overview: ClientOverview; onCreate: () => void }) {
  const { onTheWay, history } = splitShipments(getRequests(overview) as Record<string, unknown>[]);
  return (
    <Page
      title="Envios para a Dutelog"
      subtitle="Mercadoria que o seu fornecedor vai entregar no armazém da Dutelog. Avise para a equipe se programar."
      action={
        <Button type="button" className="rounded-xl" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Avisar um envio
        </Button>
      }
    >
      <Section label={`A caminho${onTheWay.length ? ` · ${onTheWay.length}` : ""}`}>
        {onTheWay.length ? (
          onTheWay.map((view) => <OnTheWayCard key={view.id} view={view} />)
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-card px-5 py-6 text-sm text-muted-foreground">
            Nenhum envio a caminho. Comprou de um fornecedor que vai entregar na Dutelog? Use "Avisar um envio".
          </p>
        )}
      </Section>
      {history.length ? (
        <Section label="Chegaram, recusados e cancelados">
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {history.map((view) => (
              <li key={view.id} className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-3 text-sm last:border-0">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {view.number ? <span className="mr-2 font-semibold">{view.number}</span> : null}
                    {view.title}
                  </span>
                  <span className={cn("block text-xs", view.stage === "rejected" ? "text-destructive-soft-foreground" : "text-muted-foreground")}>
                    {view.detail}
                  </span>
                </span>
                <HistoryBadge view={view} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

function HistoryBadge({ view }: { view: ShipmentView }) {
  if (view.stage === "rejected") return <span className="shrink-0 text-sm font-semibold text-destructive-soft-foreground">Recusado</span>;
  if (view.stage === "cancelled") return <span className="shrink-0 text-sm text-muted-foreground">Cancelado</span>;
  if (!view.received) return <span className="shrink-0 text-sm font-semibold text-success-soft-foreground">Chegou</span>;
  return (
    <span
      className={cn(
        "shrink-0 text-sm font-semibold",
        view.received.tone === "ok" ? "text-success-soft-foreground" : "text-warning-soft-foreground",
      )}
    >
      {view.received.label}
    </span>
  );
}

function OnTheWayCard({ view }: { view: ShipmentView }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancel = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/client/shipments/${encodeURIComponent(view.id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Não foi possível cancelar o aviso.");
      }
    },
    onSuccess: () => {
      setConfirming(false);
      toast({ title: "Aviso cancelado", description: "A Dutelog não vai mais esperar este envio." });
      void queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey });
    },
    onError: (error) => {
      toast({ title: "Não foi possível cancelar", description: error instanceof Error ? error.message : "", variant: "destructive" });
    },
  });
  const step = stageIndex(view.stage);
  return (
    <article className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-semibold">
          {view.number ? <span className="mr-2">{view.number}</span> : null}
          <span className={view.number ? "font-normal text-foreground/80" : undefined}>{view.title}</span>
        </h3>
        <span className="text-sm text-muted-foreground">
          {view.arrival ? (
            <>
              chega <b className="font-semibold text-foreground">{view.arrival}</b>
            </>
          ) : (
            "sem data prevista"
          )}
        </span>
      </div>
      <ol className="mt-3 flex max-w-xl items-start" aria-label={`Etapa: ${SHIPMENT_STEPS[step]}`}>
        {SHIPMENT_STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label} className="flex flex-1 flex-col last:flex-none">
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full border-2",
                    done && "border-primary bg-primary",
                    current && "border-primary bg-card ring-4 ring-primary/15",
                    !done && !current && "border-border bg-card",
                  )}
                />
                {index < SHIPMENT_STEPS.length - 1 ? (
                  <span className={cn("h-0.5 flex-1", done ? "bg-primary" : "bg-border")} />
                ) : null}
              </div>
              <span
                className={cn(
                  "mt-1 pr-2 text-xs",
                  current ? "font-semibold text-primary" : done ? "text-foreground/70" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {view.summary ? <span>{view.summary}</span> : null}
        {view.attachments ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" />
            {view.attachments === 1 ? "1 anexo" : `${view.attachments} anexos`}
          </span>
        ) : null}
        <span>{view.detail}</span>
        {view.canCancel ? (
          confirming ? (
            <span className="ml-auto inline-flex items-center gap-2">
              Cancelar este aviso?
              <Button type="button" size="sm" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {cancel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Cancelar aviso
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Manter
              </Button>
            </span>
          ) : (
            <button type="button" className="ml-auto font-medium text-primary hover:underline" onClick={() => setConfirming(true)}>
              Cancelar aviso
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}

// -------------------------------------------------------------- formulário

type Line = { id: string; code: string; name: string; quantity: string; supplierCode?: string };

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

let lineSeq = 0;
function newLine(code = "", quantity = ""): Line {
  lineSeq += 1;
  return { id: `l${lineSeq}`, code, name: "", quantity };
}

function catalogIndex(items: InventoryItem[]) {
  const byCode = new Map<string, InventoryItem>();
  for (const item of items) {
    const client = normalized(inventoryItemClientCode(item));
    const sku = normalized(inventoryItemSku(item));
    if (client) byCode.set(client, item);
    if (sku && !byCode.has(sku)) byCode.set(sku, item);
  }
  return byCode;
}

function ShipmentForm({ overview, initial, onClose }: { overview: ClientOverview; initial?: ShipmentDraft | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState(initial?.fornecedor ?? "");
  const [invoice, setInvoice] = useState(initial?.nota_fiscal ?? "");
  const [arrival, setArrival] = useState(initial?.chegada ?? "");
  const [notes, setNotes] = useState(initial?.observacoes ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<Line[]>(() =>
    initial?.linhas.length
      ? initial.linhas.map((line) => ({ ...newLine(line.codigo ?? "", String(line.quantidade)), name: line.nome ?? "" }))
      : [newLine()],
  );
  const [pasting, setPasting] = useState(false);
  const [invoiceReading, setInvoiceReading] = useState<InvoiceReading | null>(null);
  const [reading, setReading] = useState(false);
  // Reduzindo scan grande no navegador antes de subir.
  const [preparing, setPreparing] = useState(false);
  // Arquivo que o Agent Dute já leu com sucesso.
  const [readFile, setReadFile] = useState<File | null>(null);
  // Arquivo já enviado ao ler a nota não sobe de novo ao enviar o aviso.
  const uploaded = useRef(new Map<File, ClientRequestAttachment>());
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const draftId = useMemo(() => `envio-${Date.now()}`, []);
  const customerCode = firstText(overview.customer?.code);
  const catalogItems = useMemo(
    () => getInventoryItems(overview).filter((item) => inventoryItemSku(item) !== "SKU"),
    [overview],
  );
  const catalog = useMemo(() => catalogIndex(catalogItems), [catalogItems]);
  const knownSuppliers = useMemo(
    () =>
      [...new Set((getRequests(overview) as Record<string, unknown>[]).map((request) => firstText(request.supplier)).filter(Boolean))] as string[],
    [overview],
  );

  const resolved = lines.map((line) => {
    const match = catalog.get(normalized(line.code));
    return { line, match, quantity: Number(line.quantity.replace(",", ".")) || 0 };
  });
  const filled = resolved.filter(({ line }) => line.code.trim() || line.name.trim() || line.quantity.trim());
  const pieces = filled.reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);
  const newProducts = filled.filter((entry) => entry.line.code.trim() && !entry.match).length;
  const pendingCodes = filled.filter((entry) => !entry.line.code.trim() && !entry.match).length;
  const codes = filled.map(({ line, match }) => normalized(match ? inventoryItemClientCode(match) : line.code)).filter(Boolean);
  const duplicates = new Set(codes.filter((code, index) => codes.indexOf(code) !== index));

  function update(id: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function problem() {
    if (!supplier.trim()) return "Informe o fornecedor.";
    if (!filled.length) return "Adicione ao menos um item.";
    for (const [index, { line, match, quantity }] of filled.entries()) {
      const issue = shipmentLineProblem(index, { code: line.code, name: line.name, quantity, inStock: Boolean(match) });
      if (issue) return issue;
    }
    if (duplicates.size) return "Há códigos repetidos. Junte as quantidades numa linha só.";
    return null;
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!customerCode) throw new Error("Conta do cliente não identificada.");
      const attachments: ClientRequestAttachment[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Enviando anexo ${index + 1} de ${files.length}…`);
        const cached = uploaded.current.get(file);
        attachments.push(cached ?? (await uploadAttachment(file, draftId)));
      }
      setProgress("Registrando o aviso…");
      return createClientRequest({
        type: "recebimento",
        priority: "normal",
        title: `Envio de ${supplier.trim()}`,
        description: notes.trim() || "Envio de fornecedor avisado pelo cliente.",
        destination: "Recebimento Dutelog",
        // Só o dia: meio-dia em São Paulo, para não virar o dia anterior.
        due_at: arrival ? new Date(`${arrival}T12:00:00-03:00`).toISOString() : undefined,
        supplier: supplier.trim(),
        invoice_number: invoice.trim() || undefined,
        attachments,
        items: filled.map(({ line, match, quantity }) =>
          !match && !line.code.trim()
            ? pendingCodeItem({ name: line.name, quantity, supplierCode: line.supplierCode })
            : {
                sku_code: match ? inventoryItemSku(match) : line.code.trim(),
                client_item_code: match ? inventoryItemClientCode(match) : line.code.trim(),
                product_name: match ? inventoryItemName(match) : line.name.trim(),
                product_registration: match ? "existing" : "new",
                location_id: null,
                quantity,
              },
        ),
      });
    },
    onSuccess: () => {
      setProgress(null);
      toast({ title: "Envio avisado à Dutelog", description: "A equipe vai confirmar e se programar para a chegada." });
      void queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey });
      onClose();
    },
    onError: (error) => {
      setProgress(null);
      toast({
        title: "Não foi possível enviar o aviso",
        description: error instanceof Error ? error.message : "Revise e tente de novo.",
        variant: "destructive",
      });
    },
  });

  function submit() {
    const issue = problem();
    if (issue) {
      toast({ title: "Falta pouco", description: issue, variant: "destructive" });
      return;
    }
    send.mutate();
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const chosen = [...list].filter(isAcceptedAttachment);
    let left = list.length - chosen.length;
    // Scan de celular passa de 9 MB; é reduzido aqui antes de subir, para
    // ninguém precisar reescanear a nota.
    setPreparing(true);
    const accepted: File[] = [];
    try {
      for (const file of chosen) {
        try {
          accepted.push(await prepareAttachment(file));
        } catch (error) {
          left += 1;
          console.warn("envios: anexo recusado", { name: file.name, error });
        }
      }
    } finally {
      setPreparing(false);
    }
    setFiles((current) => [...current, ...accepted].slice(0, 8));
    if (left > 0) {
      toast({
        title: "Alguns arquivos ficaram de fora",
        description: `Use PDF ou imagem, ${ATTACHMENT_LIMIT_HINT} cada e 8 no total.`,
        variant: "destructive",
      });
    }
    // A primeira nota anexada já vai para o Agent Dute: a pessoa não precisa
    // preencher fornecedor, NF e itens à mão.
    const first = accepted[0];
    if (first && !readableFile && !reading) void readInvoice(first);
  }

  function addLines(incoming: Array<{ code: string; quantity: number; name?: string; supplierCode?: string }>) {
    setLines((current) => {
      const kept = current.filter((line) => line.code.trim() || line.name.trim() || line.quantity.trim());
      const next = kept.map((line) => ({ ...line }));
      for (const item of incoming) {
        const existing = item.code ? next.find((line) => normalized(line.code) === normalized(item.code)) : undefined;
        if (existing) existing.quantity = String((Number(existing.quantity) || 0) + item.quantity);
        else next.push({ ...newLine(item.code, String(item.quantity)), name: item.name ?? "", supplierCode: item.supplierCode });
      }
      return next.length ? next : [newLine()];
    });
  }

  function addPasted(pasted: Array<{ code: string; quantity: number }>) {
    addLines(pasted);
    setPasting(false);
  }

  const readableFile = files.find((file) => file.type === "application/pdf" || file.type.startsWith("image/"));

  async function readInvoice(file: File) {
    if (!customerCode) return;
    setReading(true);
    try {
      const attachment = uploaded.current.get(file) ?? (await uploadAttachment(file, draftId));
      uploaded.current.set(file, attachment);
      const response = await fetch("/api/client/shipments/read-invoice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: attachment.storage_path, content_type: file.type }),
      });
      const payload = (await response.json().catch(() => null)) as (InvoiceReading & { message?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.message || "Não consegui ler a nota agora.");
      // Fornecedor, NF e observações entram já; só onde ainda está vazio.
      setSupplier((current) => fillIfEmpty(current, payload.supplier));
      setInvoice((current) => fillIfEmpty(current, payload.invoice_number));
      setNotes((current) => fillIfEmpty(current, payload.notes));
      setReadFile(file);
      if (!payload.items?.length) {
        toast({ title: "Não encontrei itens nesta nota", description: "Os itens você preenche ou cola da planilha." });
        return;
      }
      setInvoiceReading(payload);
    } catch (error) {
      toast({
        title: "Não consegui ler a nota",
        description: error instanceof Error ? error.message : "Tente de novo ou preencha à mão.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  }

  function applyInvoice(selected: InvoiceDraftLine[]) {
    addLines(
      selected.map((line) => ({
        code: line.code.trim(),
        name: line.name.trim(),
        quantity: Number(line.quantity.replace(",", ".")) || 0,
        supplierCode: line.supplierCode,
      })),
    );
    setInvoiceReading(null);
  }

  const busy = send.isPending;
  return (
    <Page
      title="Avisar um envio"
      subtitle="Preencha o que souber e envie. A Dutelog confirma e se programa para a chegada."
      action={
        <Button type="button" variant="outline" className="rounded-xl" onClick={onClose} disabled={busy}>
          <X className="h-4 w-4" />
          Cancelar
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <InvoiceDrop
            files={files}
            readableFile={readableFile}
            reading={reading}
            preparing={preparing}
            read={Boolean(readableFile && readFile === readableFile)}
            disabled={busy}
            onPick={() => fileInput.current?.click()}
            onDrop={(list) => void addFiles(list)}
            onRead={() => readableFile && void readInvoice(readableFile)}
            onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_170px]">
              <Field label="Fornecedor">
                <input
                  className={inputClass}
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="Quem vai entregar"
                  list="envio-fornecedores"
                />
                <datalist id="envio-fornecedores">
                  {knownSuppliers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field label="NF ou pedido (opcional)">
                <input className={inputClass} value={invoice} onChange={(event) => setInvoice(event.target.value)} />
              </Field>
              <Field label="Chega em">
                <input type="date" className={inputClass} value={arrival} onChange={(event) => setArrival(event.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Observações (opcional)">
                <textarea
                  className={cn(inputClass, "min-h-[64px] resize-y")}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Transportadora, volumes, contato…"
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Itens</h2>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setPasting(true)}>
                  <ClipboardPaste className="h-4 w-4" />
                  Colar da planilha
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setLines((current) => [...current, newLine()])}>
                  <Plus className="h-4 w-4" />
                  Adicionar item
                </Button>
              </div>
            </div>
            <datalist id="envio-codigos">
              {catalogItems.slice(0, 2000).map((item) => (
                <option key={inventoryItemClientCode(item) || inventoryItemSku(item)} value={inventoryItemClientCode(item) || inventoryItemSku(item)}>
                  {inventoryItemName(item)}
                </option>
              ))}
            </datalist>
            <div className="hidden grid-cols-[190px_minmax(0,1fr)_96px_118px_28px] gap-2 border-b border-border/60 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
              <span>Código</span>
              <span>Produto</span>
              <span className="text-right">Peças</span>
              <span />
              <span />
            </div>
            {resolved.map(({ line, match }) => {
              const code = normalized(match ? inventoryItemClientCode(match) : line.code);
              return (
                <div
                  key={line.id}
                  className="grid grid-cols-[1fr_96px_28px] items-center gap-2 border-b border-border/40 py-2 sm:grid-cols-[190px_minmax(0,1fr)_96px_118px_28px]"
                >
                  <input
                    className={cn(inputClass, "py-1.5", duplicates.has(code) && "border-warning")}
                    value={line.code}
                    onChange={(event) => update(line.id, { code: event.target.value })}
                    placeholder="Código (se souber)"
                    list="envio-codigos"
                    aria-label="Código do item"
                  />
                  {match ? (
                    <span className="col-span-3 truncate text-sm sm:col-span-1">{inventoryItemName(match)}</span>
                  ) : (
                    <input
                      className={cn(inputClass, "col-span-3 py-1.5 sm:col-span-1")}
                      value={line.name}
                      onChange={(event) => update(line.id, { name: event.target.value })}
                      placeholder={line.code.trim() ? "Nome do produto novo" : "Produto"}
                      aria-label="Nome do produto"
                    />
                  )}
                  <input
                    className={cn(inputClass, "py-1.5 text-right")}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) => update(line.id, { quantity: event.target.value.replace(/[^\d.,]/g, "") })}
                    placeholder="0"
                    aria-label="Peças"
                  />
                  <span className="hidden sm:block">
                    {line.code.trim() ? (
                      match ? (
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-soft-foreground">já no estoque</span>
                      ) : (
                        <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info-soft-foreground">produto novo</span>
                      )
                    ) : line.name.trim() ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-soft-foreground">código a definir</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label="Remover item"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                    onClick={() => setLines((current) => (current.length > 1 ? current.filter((entry) => entry.id !== line.id) : [newLine()]))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {duplicates.size ? (
              <p className="mt-2 text-xs text-warning-soft-foreground">Há códigos repetidos. Junte as quantidades numa linha só.</p>
            ) : null}
          </section>
        </div>

        <aside className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-2">
          <h2 className="font-semibold">Resumo</h2>
          <dl className="mt-2 text-sm">
            <SummaryRow label="Fornecedor" value={supplier.trim() || "—"} />
            <SummaryRow label="Chega em" value={arrival ? new Date(`${arrival}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "—"} />
            <SummaryRow label="Itens" value={integer.format(filled.length)} />
            <SummaryRow label="Peças" value={integer.format(pieces)} />
            {newProducts ? <SummaryRow label="Produtos novos" value={integer.format(newProducts)} /> : null}
            {pendingCodes ? <SummaryRow label="Código a definir" value={integer.format(pendingCodes)} /> : null}
          </dl>
          <Button type="button" className="mt-4 w-full rounded-xl" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {progress ?? "Enviar aviso"}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            O estoque só muda depois da conferência física na Dutelog.
            {pendingCodes ? " Itens sem código: a equipe define pela etiqueta na chegada." : ""}
          </p>
        </aside>
      </div>

      <PasteDialog open={pasting} onOpenChange={setPasting} catalog={catalog} onAdd={addPasted} />
      {invoiceReading ? (
        <InvoiceReview
          reading={invoiceReading}
          codeListId="envio-codigos"
          lookup={(code) => {
            const match = catalog.get(normalized(code));
            return match ? { clientCode: inventoryItemClientCode(match), name: inventoryItemName(match) } : null;
          }}
          onCancel={() => setInvoiceReading(null)}
          onUse={(lines) => applyInvoice(lines)}
        />
      ) : null}
    </Page>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-foreground/80">{label}</span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-muted-foreground">
      <dt>{label}</dt>
      <dd className="truncate font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function PasteDialog({
  open,
  onOpenChange,
  catalog,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: Map<string, InventoryItem>;
  onAdd: (lines: Array<{ code: string; quantity: number }>) => void;
}) {
  const [value, setValue] = useState("");
  const parsed = parsePastedItems(value);
  const known = parsed.lines.filter((line) => catalog.has(normalized(line.code))).length;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setValue("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Colar itens da planilha</DialogTitle>
          <DialogDescription>
            No Excel ou na nota, selecione as colunas <b>código</b> e <b>quantidade</b>, copie (Ctrl+C) e cole aqui (Ctrl+V). Uma linha por item.
          </DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={"A.01.0114.004.G\t300\nA.01.0114.004.GG\t200"}
          className="h-40 w-full resize-none rounded-xl border border-border p-3 font-mono text-xs leading-6 outline-none focus:border-primary/50"
        />
        <p className="text-sm text-muted-foreground">
          {parsed.lines.length ? (
            <span className="text-success-soft-foreground">
              {parsed.lines.length} {parsed.lines.length === 1 ? "linha reconhecida" : "linhas reconhecidas"} · {known} já no estoque
              {parsed.lines.length - known ? ` · ${parsed.lines.length - known} produto(s) novo(s), vai pedir o nome` : ""}
            </span>
          ) : (
            "Cole as linhas para ver o que foi reconhecido."
          )}
          {parsed.ignored ? ` · ${parsed.ignored} linha(s) ignorada(s)` : ""}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!parsed.lines.length} onClick={() => { onAdd(parsed.lines); setValue(""); }}>
            Adicionar {parsed.lines.length || ""} {parsed.lines.length === 1 ? "item" : "itens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
