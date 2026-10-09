import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Search, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FilterGroup, FilterPanel } from "@/components/ui/filter-panel";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, type ProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_TYPE_LABELS,
  buildDocumentRows,
  matchesDocumentFilters,
  type DocumentAudience,
  type DocumentKind,
  type DocumentRow,
  type KnowledgeState,
} from "@/lib/document-rows";
import { fileToBase64 } from "@/lib/file-base64";

/**
 * Documentos da operação BTG. Uma lista só: o que a Dutelog adicionou e as
 * NFs que a BTG anexou no aviso de chegada. É o arquivo da operação; a base
 * que o Agent Dute consulta é outra tela (Conhecimento), e um documento só
 * vai para lá por "Enviar para o Conhecimento".
 */

type UploadedFile = {
  file_url: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
};

// Espelha o backend (mutateManagedEntity): só estes publicam para a BTG.
const PUBLISHERS: ProfileRole[] = ["owner", "admin", "interno"];
// Espelha extractOperationalDocumentContent e approveDocumentKnowledge.
const KNOWLEDGE_SENDERS: ProfileRole[] = ["owner", "admin", "interno", "wms", "financeiro"];
const KNOWLEDGE_APPROVERS: ProfileRole[] = ["owner", "admin", "interno", "financeiro"];
// Quem lê os avisos de chegada (canReadOperations nas Firestore Rules).
const REQUEST_READERS: ProfileRole[] = ["owner", "admin", "interno", "wms", "suporte"];

const KIND_FILTERS: Array<{ value: DocumentKind | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "nf", label: "NF" },
  { value: "comprovante", label: "Comprovante" },
  { value: "contrato", label: "Contrato" },
  { value: "outros", label: "Outros" },
];

const AUDIENCE_FILTERS: Array<{ value: DocumentAudience | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "btg", label: "BTG vê" },
  { value: "internal", label: "Só Dutelog" },
  { value: "archived", label: "Arquivados" },
];

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação.");
  return payload as T;
}

const emptyForm = { title: "", documentType: "nf_entrada", reference: "", customerVisible: false };

export default function Documents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const canPublish = canAccessModule(role, PUBLISHERS);
  const canSend = canAccessModule(role, KNOWLEDGE_SENDERS);
  const canApprove = canAccessModule(role, KNOWLEDGE_APPROVERS);
  const isFinance = role === "financeiro";

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<DocumentKind | "all">("all");
  const [audience, setAudience] = useState<DocumentAudience | "all">("all");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const documents = useQuery({
    queryKey: ["operational-documents"],
    queryFn: async () =>
      (await apiJson<{ items?: Record<string, unknown>[] }>("/api/documents?limit=500")).items ?? [],
  });
  const requests = useQuery({
    queryKey: ["documents", "request-attachments"],
    queryFn: async () =>
      (await apiJson<{ items?: Record<string, unknown>[] }>("/api/customer-requests?limit=500")).items ?? [],
    enabled: canAccessModule(role, REQUEST_READERS),
  });

  const rows = useMemo(
    () => buildDocumentRows(documents.data ?? [], requests.data ?? []),
    [documents.data, requests.data],
  );
  const visible = useMemo(
    () => rows.filter((row) => matchesDocumentFilters(row, { search, kind, audience })),
    [audience, kind, rows, search],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
  const failure = (title: string) => (error: unknown) =>
    toast({ title, description: humanApiError(error, "Tente novamente em instantes."), variant: "destructive" });

  const add = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha o arquivo.");
      const title = form.title.trim() || file.name.replace(/\.[^.]+$/, "");
      const documentType = isFinance ? "fatura" : form.documentType;
      const entityType = isFinance ? "fatura" : "operacional";
      if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo grande demais. Use até 20 MB.");
      // O arquivo sobe pelo backend, que grava no Storage. O PUT na URL
      // assinada era recusado pelo Storage de produção.
      const target = await apiJson<UploadedFile>("/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({
          customer_code: "BTG Pactual",
          file_name: file.name,
          content_type: file.type || "application/octet-stream",
          data_base64: await fileToBase64(file),
          document_type: documentType,
          entity_type: entityType,
        }),
      });
      const shared = canPublish && form.customerVisible;
      return apiJson("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          customer_code: "BTG Pactual",
          title,
          file_name: target.file_name,
          document_type: documentType,
          entity_type: entityType,
          reference: form.reference.trim() || undefined,
          file_url: target.file_url,
          external_url: target.file_url,
          storage_path: target.storage_path,
          content_type: target.content_type,
          size_bytes: target.size_bytes,
          source: "storage_upload",
          ...(canPublish
            ? {
                customer_visible: shared,
                visibility: shared ? "customer" : "internal",
                status: shared ? "published" : "internal",
              }
            : {}),
        }),
      });
    },
    onSuccess: async () => {
      setAdding(false);
      setForm(emptyForm);
      setFile(null);
      await refresh();
      toast({ title: "Documento adicionado" });
    },
    onError: failure("Documento não adicionado"),
  });

  const setShared = useMutation({
    mutationFn: async ({ id, shared }: { id: string; shared: boolean }) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          customer_visible: shared,
          visibility: shared ? "customer" : "internal",
          status: shared ? "published" : "internal",
        }),
      }),
    onSuccess: async (_result, input) => {
      await refresh();
      toast({ title: input.shared ? "A BTG agora vê o documento" : "Documento só para a Dutelog" });
    },
    onError: failure("Visibilidade não alterada"),
  });

  const archive = useMutation({
    mutationFn: async (id: string) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Documento arquivado" });
    },
    onError: failure("Documento não arquivado"),
  });

  // "Enviar para o Conhecimento": extrai o texto e liga à base do Agent
  // Dute. Tipos sensíveis voltam "aguardando aprovação" (regra do backend);
  // aprovar é de uma pessoa, nunca automático.
  const sendToKnowledge = useMutation({
    mutationFn: async (id: string) =>
      apiJson<{ message?: string; content_extraction_status?: string; knowledge_status?: string }>(
        `/api/documents/${encodeURIComponent(id)}/extract`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: async (payload) => {
      await refresh();
      const reading =
        payload.content_extraction_status === "pending_ocr" ||
        payload.content_extraction_status === "pending_visual_ocr";
      toast({
        title: reading
          ? "Lendo o arquivo"
          : payload.knowledge_status === "pending_approval"
            ? "Aguardando aprovação para o Conhecimento"
            : payload.knowledge_status === "active"
              ? "Documento no Conhecimento do Agent Dute"
              : "Nada para levar ao Conhecimento",
        description: payload.message,
      });
    },
    onError: failure("Não foi enviado ao Conhecimento"),
  });

  const decideKnowledge = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}/knowledge/${approve ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: async (_payload, input) => {
      await refresh();
      toast({ title: input.approve ? "Aprovado para o Conhecimento" : "Recusado para o Conhecimento" });
    },
    onError: failure("Decisão não registrada"),
  });

  const loading = documents.isLoading || requests.isLoading;
  const filterSummary =
    [
      kind !== "all" ? KIND_FILTERS.find((option) => option.value === kind)?.label : null,
      audience !== "all" ? AUDIENCE_FILTERS.find((option) => option.value === audience)?.label : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        description="NFs, comprovantes e contratos da operação BTG"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar documento
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, NF ou pedido"
            className="pl-9"
          />
        </div>
        <FilterPanel summary={filterSummary}>
          <FilterGroup label="Tipo de documento">
            {KIND_FILTERS.map((option) => (
              <Chip key={option.value} selected={kind === option.value} onClick={() => setKind(option.value)}>
                {option.label}
              </Chip>
            ))}
          </FilterGroup>
          <span className="hidden h-6 w-px bg-border md:block" aria-hidden="true" />
          <FilterGroup label="Quem vê">
            {AUDIENCE_FILTERS.map((option) => (
              <Chip key={option.value} selected={audience === option.value} onClick={() => setAudience(option.value)}>
                {option.label}
              </Chip>
            ))}
          </FilterGroup>
        </FilterPanel>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Carregando documentos...</p>
        ) : documents.error ? (
          <p className="p-6 text-sm text-destructive">{humanApiError(documents.error, "Não foi possível carregar.")}</p>
        ) : visible.length ? (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                  <th className="px-5 py-2.5 font-semibold">Documento</th>
                  <th className="px-3 py-2.5 font-semibold">Tipo</th>
                  <th className="px-3 py-2.5 font-semibold">Vinculado a</th>
                  <th className="px-3 py-2.5 font-semibold">Quem vê</th>
                  <th className="px-3 py-2.5 font-semibold">Data</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <DocumentLine
                    key={row.key}
                    row={row}
                    canPublish={canPublish}
                    canSend={canSend}
                    canApprove={canApprove}
                    onSend={() => row.documentId && sendToKnowledge.mutate(row.documentId)}
                    onDecide={(approve) => row.documentId && decideKnowledge.mutate({ id: row.documentId, approve })}
                    onShare={(shared) => row.documentId && setShared.mutate({ id: row.documentId, shared })}
                    onArchive={() => row.documentId && archive.mutate(row.documentId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-border md:hidden">
            {visible.map((row) => (
              <DocumentCard
                key={row.key}
                row={row}
                canPublish={canPublish}
                canSend={canSend}
                canApprove={canApprove}
                onSend={() => row.documentId && sendToKnowledge.mutate(row.documentId)}
                onDecide={(approve) => row.documentId && decideKnowledge.mutate({ id: row.documentId, approve })}
                onShare={(shared) => row.documentId && setShared.mutate({ id: row.documentId, shared })}
                onArchive={() => row.documentId && archive.mutate(row.documentId)}
              />
            ))}
          </ul>
          </>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {rows.length ? "Nenhum documento neste filtro." : "Nenhum documento ainda. As NFs anexadas pela BTG no aviso de chegada aparecem aqui."}
          </p>
        )}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Adicionar documento</DialogTitle>
          </DialogHeader>
          <form
            id="document-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed border-border px-4 py-5 text-sm hover:bg-muted/40"
            >
              <UploadCloud className="h-5 w-5 text-primary" />
              {file ? (
                <span className="font-medium">{file.name}</span>
              ) : (
                <span>
                  <span className="font-semibold text-primary">Escolher arquivo</span> no computador ou celular
                </span>
              )}
              <span className="text-xs text-muted-foreground">PDF, imagem ou planilha até 20 MB</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,image/*,.xls,.xlsx,.csv,.doc,.docx"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                if (chosen && !form.title) {
                  setForm((state) => ({ ...state, title: chosen.name.replace(/\.[^.]+$/, "") }));
                }
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo</Label>
                {isFinance ? (
                  <Input value="Fatura" disabled />
                ) : (
                  <Select
                    value={form.documentType}
                    onValueChange={(documentType) => setForm((state) => ({ ...state, documentType }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-reference">Vinculado a (opcional)</Label>
                <Input
                  id="document-reference"
                  value={form.reference}
                  onChange={(event) => setForm((state) => ({ ...state, reference: event.target.value }))}
                  placeholder="Pedido, recebimento ou NF"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-title">Nome</Label>
              <Input
                id="document-title"
                value={form.title}
                onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
                placeholder="Ex.: NF 48213"
              />
            </div>
            {canPublish ? (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                <span>
                  <span className="block text-sm font-semibold">A BTG pode ver</span>
                  <span className="block text-xs text-muted-foreground">Aparece em Documentos no portal do cliente</span>
                </span>
                <Switch
                  checked={form.customerVisible}
                  onCheckedChange={(customerVisible) => setForm((state) => ({ ...state, customerVisible }))}
                />
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">Fica só para a Dutelog. Publicar para a BTG é com a coordenação.</p>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="document-form" disabled={add.isPending || !file}>
              {add.isPending ? "Enviando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const KNOWLEDGE_LABEL: Record<KnowledgeState, string> = {
  none: "",
  reading: "Lendo o arquivo para o Conhecimento",
  pending: "Aguardando aprovação para o Conhecimento",
  active: "No Conhecimento do Agent Dute",
  rejected: "Recusado para o Conhecimento",
};

type DocumentLineProps = {
  row: DocumentRow;
  canPublish: boolean;
  canSend: boolean;
  canApprove: boolean;
  onSend: () => void;
  onDecide: (approve: boolean) => void;
  onShare: (shared: boolean) => void;
  onArchive: () => void;
};

function audienceOf(row: DocumentRow) {
  if (row.audience === "archived") return { label: "Arquivado", tone: "bg-muted text-muted-foreground" };
  if (row.audience === "btg") {
    return { label: row.source === "request" ? "Enviado pela BTG" : "BTG vê", tone: "bg-info-soft text-info-soft-foreground" };
  }
  return { label: "Só Dutelog", tone: "bg-muted text-foreground" };
}

function knowledgeTone(state: KnowledgeState) {
  return state === "pending" ? "text-warning-soft-foreground" : state === "active" ? "text-primary" : "text-muted-foreground";
}

function DocumentActions({ row, canPublish, canSend, canApprove, onSend, onDecide, onShare, onArchive }: DocumentLineProps) {
  const manageable = row.source === "document" && row.audience !== "archived";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Ações de ${row.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {row.href ? (
          <DropdownMenuItem asChild>
            <a href={row.href} target="_blank" rel="noreferrer">
              Abrir
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>Sem arquivo anexado</DropdownMenuItem>
        )}
        {manageable && canSend && row.href && (row.knowledge === "none" || row.knowledge === "rejected") ? (
          <DropdownMenuItem onSelect={onSend}>Enviar para o Conhecimento</DropdownMenuItem>
        ) : null}
        {manageable && canApprove && row.knowledge === "pending" ? (
          <>
            <DropdownMenuItem onSelect={() => onDecide(true)}>Aprovar para o Conhecimento</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDecide(false)}>Recusar para o Conhecimento</DropdownMenuItem>
          </>
        ) : null}
        {manageable && canPublish ? (
          <DropdownMenuItem onSelect={() => onShare(row.audience !== "btg")}>
            {row.audience === "btg" ? "Ocultar da BTG" : "Mostrar para a BTG"}
          </DropdownMenuItem>
        ) : null}
        {manageable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={onArchive}>
              Arquivar
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocumentLine(props: DocumentLineProps) {
  const { row } = props;
  const date = row.date ? dateFormatter.format(row.date) : "—";
  const audience = audienceOf(row);
  return (
    <tr className={cn("border-b border-border/40 last:border-0", row.audience === "archived" && "text-muted-foreground")}>
      <td className="px-5 py-3">
        <div className="font-medium text-foreground">{row.title}</div>
        <div className="text-xs text-muted-foreground">{row.origin}</div>
        {KNOWLEDGE_LABEL[row.knowledge] ? (
          <div className={cn("mt-0.5 text-xs font-medium", knowledgeTone(row.knowledge))}>{KNOWLEDGE_LABEL[row.knowledge]}</div>
        ) : null}
      </td>
      <td className="px-3 py-3">{row.typeLabel}</td>
      <td className="px-3 py-3">{row.linkedTo || <span className="text-muted-foreground">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-3">
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", audience.tone)}>{audience.label}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{date}</td>
      <td className="px-3 py-3 text-right">
        <DocumentActions {...props} />
      </td>
    </tr>
  );
}

/** Abaixo de 768px a tabela vira esta lista: nome, origem, selo e data, com as mesmas ações. */
function DocumentCard(props: DocumentLineProps) {
  const { row } = props;
  const date = row.date ? dateFormatter.format(row.date) : "—";
  const audience = audienceOf(row);
  return (
    <li className={cn("flex items-start gap-2 px-4 py-3", row.audience === "archived" && "text-muted-foreground")}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{row.title}</div>
        <div className="text-xs text-muted-foreground">{row.origin}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={cn("rounded-md px-2 py-0.5 font-semibold", audience.tone)}>{audience.label}</span>
          <span>
            {row.typeLabel} · {date}
          </span>
        </div>
        {row.linkedTo ? <div className="mt-1 text-xs text-muted-foreground">{row.linkedTo}</div> : null}
        {KNOWLEDGE_LABEL[row.knowledge] ? (
          <div className={cn("mt-1 text-xs font-medium", knowledgeTone(row.knowledge))}>{KNOWLEDGE_LABEL[row.knowledge]}</div>
        ) : null}
      </div>
      <DocumentActions {...props} />
    </li>
  );
}
