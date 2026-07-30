import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Link2,
  Plus,
  Search,
  Sparkles,
  UploadCloud,
  Workflow,
  X,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ApiList<T> = {
  items?: T[];
  data?: T[];
};

type Customer = {
  id?: string;
  code?: string;
  name?: string;
  status?: string;
};

type OperationalDocument = {
  id?: string;
  customer_code?: string;
  title?: string;
  file_name?: string;
  document_type?: string;
  entity_type?: string;
  entity_id?: string;
  status?: string;
  visibility?: string;
  customer_visible?: boolean;
  file_url?: string;
  external_url?: string;
  storage_path?: string;
  content_type?: string;
  size_bytes?: number;
  reference?: string;
  notes?: string;
  competencia?: string;
  ai_summary?: string;
  ai_tags?: string[];
  ai_status?: string;
  ai_confidence?: number;
  ai_reviewed_at?: unknown;
  extracted_fields?: Record<string, unknown>;
  review_notes?: string;
  content_extraction_status?: string;
  content_extracted_at?: unknown;
  content_excerpt?: string;
  content_char_count?: number;
  content_source?: string;
  knowledge_id?: string;
  knowledge_status?: string;
  knowledge_requires_approval?: boolean;
  knowledge_review_note?: string;
  knowledge_approved_by?: string;
  knowledge_approved_at?: unknown;
  knowledge_rejected_by?: string;
  knowledge_rejected_at?: unknown;
  operational_action_status?: string;
  operational_action_type?: string;
  operational_action_id?: string;
  operational_target_type?: string;
  operational_target_id?: string;
  operational_target_number?: string;
  operational_action_note?: string;
  archived?: boolean;
  updated_at?: unknown;
  created_at?: unknown;
};

type UploadTarget = {
  ok?: boolean;
  upload_url: string;
  upload_headers?: Record<string, string>;
  file_url: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
};

type DocumentForm = {
  customer_code: string;
  title: string;
  file_name: string;
  document_type: string;
  entity_type: string;
  entity_id: string;
  reference: string;
  external_url: string;
  competencia: string;
  customer_visible: string;
  status: string;
  notes: string;
};

const emptyForm: DocumentForm = {
  customer_code: "BTG Pactual",
  title: "",
  file_name: "",
  document_type: "nf_entrada",
  entity_type: "recebimento",
  entity_id: "",
  reference: "",
  external_url: "",
  competencia: "",
  customer_visible: "true",
  status: "published",
  notes: "",
};

const documentTypeLabels: Record<string, string> = {
  nf_entrada: "NF de entrada",
  comprovante_entrega: "Comprovante de entrega",
  romaneio: "Romaneio",
  fatura: "Fatura",
  foto_avaria: "Foto de avaria",
  contrato: "Contrato",
  operacional: "Operacional",
  outro: "Outro",
};

const entityLabels: Record<string, string> = {
  recebimento: "Recebimento",
  pedido: "Pedido",
  expedicao: "Expedição",
  fatura: "Fatura",
  excecao: "Exceção",
  produto: "Produto",
  sku: "SKU",
  operacional: "Operacional",
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível concluir a operação.");
  }
  return payload as T;
}

function listFromPayload<T>(payload: ApiList<T> | T[]): T[] {
  if (Array.isArray(payload)) return payload;
  return payload.items ?? payload.data ?? [];
}

function compactPayload<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== ""),
  );
}

function documentTitle(document: OperationalDocument) {
  return String(document.title ?? document.file_name ?? document.id ?? "").trim();
}

function documentHref(document: OperationalDocument) {
  return String(document.file_url ?? document.external_url ?? "").trim();
}

function customerCode(customer: Customer) {
  return String(customer.code ?? customer.id ?? "").trim();
}

function labelFrom(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "").trim();
  return map[key] ?? (key || "Não informado");
}

function statusBadge(document: OperationalDocument) {
  if (document.archived || document.status === "archived") return "Arquivado";
  if (document.customer_visible === false || document.visibility === "internal") {
    return "Interno";
  }
  if (document.status === "pending_review") return "Revisão";
  return "Portal";
}

function reviewedByAgent(document: OperationalDocument) {
  return String(document.ai_status ?? "").startsWith("reviewed");
}

function contentKnowledgeBadge(document: OperationalDocument) {
  const status = String(document.content_extraction_status ?? "");
  const knowledgeStatus = String(document.knowledge_status ?? "");
  if (knowledgeStatus === "pending_approval") return "Aguardando aprovação";
  if (knowledgeStatus === "rejected") return "Knowledge rejeitada";
  if (knowledgeStatus === "active" && document.knowledge_id) {
    return "Base Agent Dute";
  }
  if (
    status === "extracted_text" &&
    document.content_source === "storage_visual_ocr"
  ) {
    return "OCR visual extraído";
  }
  if (status === "extracted_text") return "Conteúdo extraído";
  if (status === "pending_ocr" || status === "pending_visual_ocr") {
    return "Aguardando OCR visual";
  }
  if (status === "unavailable") return "Sem conteúdo";
  if (document.knowledge_id) return "Base Agent Dute";
  return "";
}

function knowledgeBadgeClass(document: OperationalDocument) {
  const knowledgeStatus = String(document.knowledge_status ?? "");
  if (knowledgeStatus === "pending_approval") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (knowledgeStatus === "rejected") {
    return "border-red-200 bg-red-50 text-red-600";
  }
  if (
    document.content_extraction_status === "pending_ocr" ||
    document.content_extraction_status === "pending_visual_ocr"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (document.knowledge_id) return "border-blue-200 bg-blue-50 text-blue-500";
  return "border-border text-muted-foreground";
}

function operationalActionBadge(document: OperationalDocument) {
  const status = String(document.operational_action_status ?? "");
  if (status === "applied") {
    return document.operational_target_number
      ? `Ação aplicada: ${document.operational_target_number}`
      : "Ação aplicada";
  }
  if (status === "pending") return "Ação operacional pendente";
  if (status === "rejected") return "Ação operacional rejeitada";
  return "";
}

function operationalActionBadgeClass(document: OperationalDocument) {
  const status = String(document.operational_action_status ?? "");
  if (status === "applied") return "border-blue-200 bg-blue-50 text-blue-500";
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-600";
  return "border-border text-muted-foreground";
}

export default function Documents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<DocumentForm>(emptyForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");

  const documentsQuery = useQuery({
    queryKey: ["operational-documents"],
    queryFn: async () =>
      listFromPayload<OperationalDocument>(
        await apiJson<ApiList<OperationalDocument> | OperationalDocument[]>(
          "/api/documents?limit=500",
        ),
      ),
  });

  const customersQuery = useQuery({
    queryKey: ["documents-customers"],
    queryFn: async () =>
      listFromPayload<Customer>(
        await apiJson<ApiList<Customer> | Customer[]>("/api/customers?limit=100"),
      ),
  });

  const documents = useMemo(
    () =>
      [...(documentsQuery.data ?? [])].sort((a, b) =>
        documentTitle(a).localeCompare(documentTitle(b), "pt-BR"),
      ),
    [documentsQuery.data],
  );

  const activeCustomers = useMemo(
    () =>
      (customersQuery.data ?? []).filter(
        (customer) => customer.status !== "archived" && customerCode(customer),
      ),
    [customersQuery.data],
  );

  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return documents.filter((document) => {
      const visible =
        visibilityFilter === "all" ||
        (visibilityFilter === "client" &&
          document.customer_visible !== false &&
          document.visibility !== "internal" &&
          !document.archived) ||
        (visibilityFilter === "internal" &&
          (document.customer_visible === false ||
            document.visibility === "internal")) ||
        (visibilityFilter === "archived" &&
          (document.archived || document.status === "archived"));
      const type =
        typeFilter === "all" || document.document_type === typeFilter;
      const haystack = [
        document.id,
        document.title,
        document.file_name,
        document.reference,
        document.entity_id,
        document.customer_code,
        document.ai_summary,
        document.ai_tags?.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return visible && type && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [documents, search, typeFilter, visibilityFilter]);

  const metrics = useMemo(() => {
    const active = documents.filter(
      (document) => !document.archived && document.status !== "archived",
    );
    return {
      total: active.length,
      client: active.filter(
        (document) =>
          document.customer_visible !== false && document.visibility !== "internal",
      ).length,
      internal: active.filter(
        (document) =>
          document.customer_visible === false || document.visibility === "internal",
      ).length,
      reviewed: active.filter(reviewedByAgent).length,
      knowledge: active.filter(
        (document) => document.knowledge_status === "active" && document.knowledge_id,
      ).length,
      pendingKnowledge: active.filter(
        (document) => document.knowledge_status === "pending_approval",
      ).length,
      operationalActions: active.filter(
        (document) => document.operational_action_status,
      ).length,
    };
  }, [documents]);

  const createDocument = useMutation({
    mutationFn: async (extraData: Record<string, unknown> = {}) =>
      apiJson("/api/documents", {
        method: "POST",
        body: JSON.stringify(
          compactPayload({
            ...form,
            ...extraData,
            customer_visible: form.customer_visible === "true",
            visibility: form.customer_visible === "true" ? "customer" : "internal",
            file_name:
              String(extraData.file_name ?? "") ||
              form.file_name ||
              selectedFile?.name ||
              form.title,
          }),
        ),
      }),
    onSuccess: () => {
      toast({ title: "Documento registrado" });
      setForm((current) => ({
        ...emptyForm,
        customer_code: current.customer_code,
      }));
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível registrar",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const updateDocument = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({ title: "Documento atualizado" });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível atualizar",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const archiveDocument = useMutation({
    mutationFn: async (id: string) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast({ title: "Documento arquivado" });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível arquivar",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const reviewDocument = useMutation({
    mutationFn: async (id: string) =>
      apiJson(`/api/documents/${encodeURIComponent(id)}/review`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      toast({ title: "Documento revisado pelo Agent Dute" });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível revisar",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const extractDocument = useMutation({
    mutationFn: async (id: string) =>
      apiJson<{
        message?: string;
        content_extraction_status?: string;
        knowledge_status?: string;
        knowledge_requires_approval?: boolean;
      }>(
        `/api/documents/${encodeURIComponent(id)}/extract`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    onSuccess: (payload) => {
      const pending =
        payload.content_extraction_status === "pending_ocr" ||
        payload.content_extraction_status === "pending_visual_ocr";
      const pendingApproval =
        payload.knowledge_status === "pending_approval" ||
        payload.knowledge_requires_approval;
      toast({
        title: pending
          ? "Documento aguardando OCR visual"
          : pendingApproval
            ? "Extraído, aguardando aprovação"
          : "Conteúdo ligado ao Agent Dute",
        description: payload.message,
      });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível extrair",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const decideKnowledge = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject";
    }) =>
      apiJson<{ message?: string; knowledge_status?: string }>(
        `/api/documents/${encodeURIComponent(id)}/knowledge/${action}`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    onSuccess: (payload) => {
      toast({
        title:
          payload.knowledge_status === "active"
            ? "Knowledge aprovada"
            : "Knowledge rejeitada",
        description: payload.message,
      });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível decidir a knowledge",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const applyOperationalAction = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "stage" | "create_receiving";
    }) =>
      apiJson<{
        message?: string;
        target_number?: string;
        status?: string;
      }>(`/api/documents/${encodeURIComponent(id)}/operational-action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: (payload) => {
      toast({
        title: payload.target_number
          ? `Recebimento ${payload.target_number} criado`
          : "Ação operacional criada",
        description: payload.message,
      });
      queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
    },
    onError: (error) =>
      toast({
        title: "Não foi possível gerar ação",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  async function uploadSelectedFile() {
    if (!selectedFile) return {};
    const target = await apiJson<UploadTarget>("/api/documents/upload-target", {
      method: "POST",
      body: JSON.stringify({
        customer_code: form.customer_code,
        file_name: form.file_name || selectedFile.name,
        content_type: selectedFile.type || "application/octet-stream",
        size_bytes: selectedFile.size,
        document_type: form.document_type,
        entity_type: form.entity_type,
        entity_id: form.entity_id,
      }),
    });
    const uploadResponse = await fetch(target.upload_url, {
      method: "PUT",
      headers: {
        ...(target.upload_headers ?? {}),
      },
      body: selectedFile,
    });
    if (!uploadResponse.ok) {
      throw new Error("Não foi possível enviar o arquivo para o Storage.");
    }
    return {
      file_url: target.file_url,
      external_url: target.file_url,
      storage_path: target.storage_path,
      file_name: target.file_name,
      content_type: target.content_type,
      size_bytes: target.size_bytes,
      source: "storage_upload",
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "Informe o título do documento", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const uploadData = await uploadSelectedFile();
      createDocument.mutate(uploadData, {
        onSettled: () => setIsUploading(false),
      });
    } catch (error) {
      setIsUploading(false);
      toast({
        title: "Não foi possível anexar",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  function patchDocument(id: string | undefined, data: Record<string, unknown>) {
    if (!id) return;
    updateDocument.mutate({ id, data });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-blue-100 bg-blue-50 text-blue-500">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-[34px] font-semibold tracking-normal text-foreground">
              Documentos operacionais
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              NFs, romaneios, comprovantes, fotos e evidências vinculadas ao WMS,
              pedidos, faturas e exceções.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="w-fit rounded-full px-4 py-2">
          Base controlada por Function
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {[
          ["Documentos ativos", metrics.total],
          ["Visíveis ao cliente", metrics.client],
          ["Uso interno", metrics.internal],
          ["Revisados pelo Agent Dute", metrics.reviewed],
          ["Knowledge aprovada", metrics.knowledge],
          ["Aguardando aprovação", metrics.pendingKnowledge],
          ["Com ação operacional", metrics.operationalActions],
        ].map(([label, value]) => (
          <Card key={label} className="rounded-[24px] border-border/60 bg-white/75 shadow-sm">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-4 text-3xl font-semibold text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="rounded-[28px] border-border/60 bg-white/80 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="h-5 w-5 text-blue-500" />
              Publicar documento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select
                  value={form.customer_code}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, customer_code: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(activeCustomers.length
                      ? activeCustomers
                      : [{ code: "BTG Pactual", name: "BTG Pactual" }]
                    ).map((customer) => (
                      <SelectItem key={customerCode(customer)} value={customerCode(customer)}>
                        {customer.name ?? customerCode(customer)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={form.document_type}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, document_type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(documentTypeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Visibilidade</Label>
                  <Select
                    value={form.customer_visible}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, customer_visible: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Liberado no portal</SelectItem>
                      <SelectItem value="false">Somente Dutelog</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Ex.: NF 1234 - recebimento fornecedor"
                />
              </div>

              <div className="space-y-2">
                <Label>Nome do arquivo</Label>
                <Input
                  value={form.file_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, file_name: event.target.value }))
                  }
                  placeholder="Ex.: nf-1234.pdf"
                />
              </div>

              <div className="space-y-2">
                <Label>Arquivo local</Label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-[22px] border border-dashed border-border bg-white/65 px-4 py-5 text-center transition hover:bg-white">
                  <UploadCloud className="mb-2 h-5 w-5 text-blue-500" />
                  <span className="text-sm font-medium text-foreground">
                    Selecionar arquivo para anexar
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    PDF, imagem, planilha ou documento até 30 MB
                  </span>
                  <input
                    type="file"
                    className="sr-only"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.xls,.doc,.docx,.zip,image/*,application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setSelectedFile(file);
                      if (file) {
                        setForm((current) => ({
                          ...current,
                          file_name: current.file_name || file.name,
                          title: current.title || file.name.replace(/\.[^.]+$/, ""),
                        }));
                      }
                    }}
                  />
                </label>
                {selectedFile ? (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setSelectedFile(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Link do documento</Label>
                <Input
                  value={form.external_url}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      external_url: event.target.value,
                    }))
                  }
                  placeholder="Opcional quando houver arquivo local"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-2">
                  <Label>Vínculo</Label>
                  <Select
                    value={form.entity_type}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, entity_type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(entityLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>ID vinculado</Label>
                  <Input
                    value={form.entity_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        entity_id: event.target.value,
                      }))
                    }
                    placeholder="Pedido, recebimento, fatura..."
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-2">
                  <Label>Referência</Label>
                  <Input
                    value={form.reference}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reference: event.target.value,
                      }))
                    }
                    placeholder="NF, romaneio ou OS"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Competência</Label>
                  <Input
                    value={form.competencia}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        competencia: event.target.value,
                      }))
                    }
                    placeholder="2026-07"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Contexto operacional, divergência, responsável ou validação."
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={createDocument.isPending || isUploading}
              >
                <FileCheck2 className="mr-2 h-4 w-4" />
                {isUploading
                  ? selectedFile
                    ? "Enviando arquivo..."
                    : "Registrando..."
                  : "Registrar documento"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/60 bg-white/80 shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <CardTitle className="text-lg">Biblioteca operacional</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-full pl-9 sm:w-[260px]"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar documento"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-full sm:w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {Object.entries(documentTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toda visibilidade</SelectItem>
                    <SelectItem value="client">Portal</SelectItem>
                    <SelectItem value="internal">Interno</SelectItem>
                    <SelectItem value="archived">Arquivados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vínculo</TableHead>
                  <TableHead>Visibilidade</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((document) => {
                  const href = documentHref(document);
                  const id = String(document.id ?? "");
                  const visible =
                    document.customer_visible !== false &&
                    document.visibility !== "internal" &&
                    !document.archived &&
                    document.status !== "archived";
                  const waitingKnowledgeApproval =
                    document.knowledge_status === "pending_approval";
                  const hasOperationalAction = Boolean(
                    document.operational_action_status,
                  );
                  const canCreateReceiving =
                    document.document_type === "nf_entrada" &&
                    document.knowledge_status !== "pending_approval" &&
                    document.operational_action_status !== "applied";

                  return (
                    <TableRow key={id}>
                      <TableCell className="min-w-[260px]">
                        <div className="font-medium text-foreground">
                          {documentTitle(document)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{document.customer_code ?? "Sem cliente"}</span>
                          {document.reference ? <span>{document.reference}</span> : null}
                          {reviewedByAgent(document) ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-blue-200 bg-blue-50 text-blue-500"
                            >
                              Agent Dute revisou
                            </Badge>
                          ) : null}
                          {contentKnowledgeBadge(document) ? (
                            <Badge
                              variant="outline"
                              className={cn("rounded-full", knowledgeBadgeClass(document))}
                            >
                              {contentKnowledgeBadge(document)}
                            </Badge>
                          ) : null}
                          {operationalActionBadge(document) ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                operationalActionBadgeClass(document),
                              )}
                            >
                              {operationalActionBadge(document)}
                            </Badge>
                          ) : null}
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                            >
                              <Link2 className="h-3 w-3" />
                              abrir
                            </a>
                          ) : null}
                        </div>
                        {document.ai_summary ? (
                          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
                            {document.ai_summary}
                          </p>
                        ) : null}
                        {document.content_excerpt ? (
                          <div className="mt-2 max-w-xl rounded-2xl border border-border/70 bg-white/65 p-3 text-xs leading-5 text-muted-foreground">
                            <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                              <BookOpenCheck className="h-3.5 w-3.5 text-blue-500" />
                              {document.knowledge_status === "pending_approval"
                                ? "Trecho extraído para validação humana"
                                : "Trecho disponível para o Agent Dute"}
                            </div>
                            {document.content_excerpt.slice(0, 260)}
                            {document.content_excerpt.length > 260 ? "..." : ""}
                          </div>
                        ) : null}
                        {document.ai_tags?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {document.ai_tags.slice(0, 4).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {labelFrom(documentTypeLabels, document.document_type)}
                      </TableCell>
                      <TableCell>
                        <div>{labelFrom(entityLabels, document.entity_type)}</div>
                        <div className="text-xs text-muted-foreground">
                          {document.entity_id || "Sem vínculo"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            visible
                              ? "border-blue-200 bg-blue-50 text-blue-500"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {statusBadge(document)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={reviewDocument.isPending}
                            onClick={() => reviewDocument.mutate(id)}
                          >
                            <Sparkles className="mr-2 h-4 w-4" />
                            {reviewedByAgent(document) ? "Revisar de novo" : "Revisar IA"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={extractDocument.isPending}
                            onClick={() => extractDocument.mutate(id)}
                          >
                            <BookOpenCheck className="mr-2 h-4 w-4" />
                            Conhecimento
                          </Button>
                          {!hasOperationalAction ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={applyOperationalAction.isPending}
                              onClick={() =>
                                applyOperationalAction.mutate({
                                  id,
                                  action: "stage",
                                })
                              }
                            >
                              <Workflow className="mr-2 h-4 w-4" />
                              Gerar ação
                            </Button>
                          ) : null}
                          {canCreateReceiving ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={applyOperationalAction.isPending}
                              onClick={() =>
                                applyOperationalAction.mutate({
                                  id,
                                  action: "create_receiving",
                                })
                              }
                            >
                              <Workflow className="mr-2 h-4 w-4 text-blue-500" />
                              Criar recebimento
                            </Button>
                          ) : null}
                          {waitingKnowledgeApproval ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={decideKnowledge.isPending}
                                onClick={() =>
                                  decideKnowledge.mutate({
                                    id,
                                    action: "approve",
                                  })
                                }
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4 text-blue-500" />
                                Aprovar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={decideKnowledge.isPending}
                                onClick={() =>
                                  decideKnowledge.mutate({
                                    id,
                                    action: "reject",
                                  })
                                }
                              >
                                <XCircle className="mr-2 h-4 w-4 text-red-500" />
                                Rejeitar
                              </Button>
                            </>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updateDocument.isPending}
                            onClick={() =>
                              patchDocument(id, {
                                customer_visible: !visible,
                                visibility: visible ? "internal" : "customer",
                                status: visible ? "internal" : "published",
                              })
                            }
                          >
                            {visible ? (
                              <EyeOff className="mr-2 h-4 w-4" />
                            ) : (
                              <Eye className="mr-2 h-4 w-4" />
                            )}
                            {visible ? "Ocultar" : "Publicar"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={archiveDocument.isPending}
                            onClick={() => archiveDocument.mutate(id)}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Arquivar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!filteredDocuments.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                      Nenhum documento encontrado para os filtros atuais.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
