import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  query,
} from "firebase/firestore";
import {
  BrainCircuit,
  Database,
  Download,
  FileCheck2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/firebase";
import { cn } from "@/lib/utils";

const knowledgeCollection = "ai_agent_knowledge";
const textChunkCollection = "ai_agent_knowledge_chunks";
const fileCollection = "ai_agent_knowledge_files";
const fileChunkCollection = "ai_agent_knowledge_file_chunks";
const maxUploadBytes = 8 * 1024 * 1024;
const fileChunkSize = 320_000;
const textChunkSize = 4_000;

type FirestoreTimestampLike = {
  toDate?: () => Date;
  seconds?: number;
};

type KnowledgeDocument = {
  id: string;
  title?: string;
  document_type?: string;
  customer_code?: string;
  source_file_name?: string;
  summary?: string;
  status?: string;
  pages?: number;
  chunk_count?: number;
  sha256?: string;
  ingested_at?: string | FirestoreTimestampLike | null;
  created_at?: string | FirestoreTimestampLike | null;
  updated_at?: string | FirestoreTimestampLike | null;
  extraction_status?: string;
  file_available?: boolean;
  file_storage_mode?: string;
  download_file_id?: string;
  content_type?: string;
  size_bytes?: number;
};

type KnowledgeFile = {
  id: string;
  knowledge_id?: string;
  file_name?: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
  chunk_count?: number;
  storage_mode?: string;
  created_at?: string | FirestoreTimestampLike | null;
};

type KnowledgeFileChunk = {
  id: string;
  knowledge_id?: string;
  chunk_index?: number;
  data_base64?: string;
};

type UploadFormState = {
  title: string;
  customer_code: string;
  document_type: string;
  notes: string;
};

const initialForm: UploadFormState = {
  title: "",
  customer_code: "BTG Pactual",
  document_type: "documento_operacional",
  notes: "",
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value === "object" && value !== null) {
    const typed = value as FirestoreTimestampLike;
    if (typeof typed.toDate === "function") return typed.toDate().getTime();
    if (typeof typed.seconds === "number") return typed.seconds * 1000;
  }
  return 0;
}

function formatDate(value: unknown) {
  const millis = toMillis(value);
  if (!millis) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(millis));
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "Tamanho não informado";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDocId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160)
    .toLowerCase();
}

function titleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function base64ToBlob(chunks: KnowledgeFileChunk[], contentType?: string) {
  const binary = atob(
    chunks
      .sort((a, b) => asNumber(a.chunk_index) - asNumber(b.chunk_index))
      .map((chunk) => chunk.data_base64 ?? "")
      .join(""),
  );
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], {
    type: contentType || "application/octet-stream",
  });
}

function textChunks(text: string) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += textChunkSize) {
    chunks.push(text.slice(index, index + textChunkSize));
  }
  return chunks;
}

function fileBase64Chunks(base64: string) {
  const chunks: string[] = [];
  for (let index = 0; index < base64.length; index += fileChunkSize) {
    chunks.push(base64.slice(index, index + fileChunkSize));
  }
  return chunks;
}

function isTextLike(file: File) {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|json)$/i.test(file.name)
  );
}

function documentTypeLabel(type?: string) {
  const value = String(type ?? "").replace(/_/g, " ");
  if (!value) return "Documento";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractionLabel(status?: string) {
  if (status === "processed") return "Consultável";
  if (status === "pending_processing") return "Aguardando extração";
  return "Indexado";
}

function sortDocuments(items: KnowledgeDocument[]) {
  return [...items].sort(
    (a, b) =>
      toMillis(b.ingested_at ?? b.created_at ?? b.updated_at) -
      toMillis(a.ingested_at ?? a.created_at ?? a.updated_at),
  );
}

async function commitInBatches(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  size = 10,
) {
  if (!firestore) throw new Error("Firestore não configurado.");
  for (let index = 0; index < operations.length; index += size) {
    const batch = writeBatch(firestore);
    operations.slice(index, index + size).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function emitKnowledgeEvent(input: {
  id: string;
  title: string;
  customer_code: string;
  file_name: string;
  extraction_status: string;
}) {
  await fetch("/api/ai/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "knowledge.uploaded",
      title: "Conhecimento adicionado ao Agent Dute",
      description: `${input.title} foi anexado à base de conhecimento.`,
      severity:
        input.extraction_status === "processed" ? "info" : "attention",
      entity_type: "conhecimento",
      entity_id: input.id,
      customer_code: input.customer_code,
      payload: {
        file_name: input.file_name,
        extraction_status: input.extraction_status,
      },
    }),
  }).catch(() => undefined);
}

export default function AgentKnowledge() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UploadFormState>(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ["agent-knowledge-documents"],
    queryFn: async (): Promise<KnowledgeDocument[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, knowledgeCollection));
      return sortDocuments(
        snapshot.docs.map(
          (item) =>
            ({
              id: item.id,
              ...item.data(),
            }) as KnowledgeDocument,
        ),
      );
    },
  });

  const files = useQuery({
    queryKey: ["agent-knowledge-files"],
    queryFn: async (): Promise<KnowledgeFile[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, fileCollection));
      return snapshot.docs.map(
        (item) =>
          ({
            id: item.id,
            ...item.data(),
          }) as KnowledgeFile,
      );
    },
  });

  const filesByKnowledge = useMemo(() => {
    return new Map(
      (files.data ?? []).map((item) => [item.knowledge_id ?? item.id, item]),
    );
  }, [files.data]);

  const summary = useMemo(() => {
    const items = documents.data ?? [];
    return {
      total: items.length,
      consultable: items.filter(
        (item) =>
          item.extraction_status === "processed" ||
          asNumber(item.chunk_count) > 0,
      ).length,
      chunks: items.reduce((sum, item) => sum + asNumber(item.chunk_count), 0),
      files: files.data?.length ?? 0,
    };
  }, [documents.data, files.data]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!firestore) throw new Error("Firestore não configurado.");
      const db = firestore;
      if (!file) throw new Error("Selecione um arquivo.");
      if (file.size > maxUploadBytes) {
        throw new Error("Arquivo acima do limite atual de 8 MB.");
      }

      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const baseId = safeDocId(`${titleFromFile(file)}_${hash.slice(0, 16)}`);
      const knowledgeId = baseId || `knowledge_${Date.now()}`;
      const title = form.title.trim() || titleFromFile(file);
      const base64 = arrayBufferToBase64(buffer);
      const fileChunks = fileBase64Chunks(base64);
      const nowIso = new Date().toISOString();
      const readableText = isTextLike(file) ? await file.text() : "";
      const chunks = readableText ? textChunks(readableText) : [];
      const extractionStatus = readableText
        ? "processed"
        : "pending_processing";

      await setDoc(
        doc(firestore, knowledgeCollection, knowledgeId),
        {
          id: knowledgeId,
          title,
          document_type: form.document_type,
          customer_code: form.customer_code.trim() || "BTG Pactual",
          source_file_name: file.name,
          summary:
            form.notes.trim() ||
            (readableText
              ? readableText.slice(0, 700)
              : "Arquivo anexado para processamento de conhecimento."),
          status: "active",
          sha256: hash,
          chunk_count: chunks.length,
          pages: null,
          extraction_status: extractionStatus,
          file_available: true,
          file_storage_mode: "firestore_chunks",
          download_file_id: knowledgeId,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          ingested_at: nowIso,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      await setDoc(
        doc(firestore, fileCollection, knowledgeId),
        {
          id: knowledgeId,
          knowledge_id: knowledgeId,
          file_name: file.name,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          sha256: hash,
          chunk_count: fileChunks.length,
          storage_mode: "firestore_chunks",
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      await commitInBatches(
        fileChunks.map((chunk, index) => (batch) => {
          batch.set(
              doc(
                db,
                fileChunkCollection,
                `${knowledgeId}_${String(index + 1).padStart(4, "0")}`,
              ),
            {
              id: `${knowledgeId}_${String(index + 1).padStart(4, "0")}`,
              knowledge_id: knowledgeId,
              chunk_index: index,
              data_base64: chunk,
              created_at: serverTimestamp(),
            },
          );
        }),
      );

      if (chunks.length) {
        await commitInBatches(
          chunks.map((chunk, index) => (batch) => {
            batch.set(
              doc(
                db,
                textChunkCollection,
                `${knowledgeId}_${String(index + 1).padStart(4, "0")}`,
              ),
              {
                id: `${knowledgeId}_${String(index + 1).padStart(4, "0")}`,
                knowledge_id: knowledgeId,
                chunk_index: index,
                text: chunk,
                source_file_name: file.name,
                title,
                customer_code: form.customer_code.trim() || "BTG Pactual",
                document_type: form.document_type,
                created_at: serverTimestamp(),
              },
            );
          }),
          50,
        );
      }

      await emitKnowledgeEvent({
        id: knowledgeId,
        title,
        customer_code: form.customer_code.trim() || "BTG Pactual",
        file_name: file.name,
        extraction_status: extractionStatus,
      });
    },
    onSuccess: async () => {
      setForm(initialForm);
      setFile(null);
      await queryClient.invalidateQueries({
        queryKey: ["agent-knowledge-documents"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["agent-knowledge-files"],
      });
      await queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({ title: "Conhecimento anexado ao Agent Dute" });
    },
    onError: (error) => {
      toast({
        title: "Falha ao anexar conhecimento",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    },
  });

  async function downloadFile(item: KnowledgeDocument) {
    if (!firestore) return;
    const fileId = item.download_file_id ?? item.id;
    const linkedFile = filesByKnowledge.get(fileId) ?? filesByKnowledge.get(item.id);
    if (!linkedFile) {
      toast({
        title: "Arquivo fonte indisponível",
        description: "O texto do documento existe na base, mas o PDF original ainda não foi anexado.",
        variant: "destructive",
      });
      return;
    }

    setDownloadingId(item.id);
    try {
      const snapshot = await getDocs(
        query(
          collection(firestore, fileChunkCollection),
          where("knowledge_id", "==", linkedFile.id),
        ),
      );
      const chunks = snapshot.docs.map(
        (chunk) =>
          ({
            id: chunk.id,
            ...chunk.data(),
          }) as KnowledgeFileChunk,
      );
      if (!chunks.length) throw new Error("Arquivo sem chunks gravados.");

      const blob = base64ToBlob(chunks, linkedFile.content_type);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = linkedFile.file_name ?? item.source_file_name ?? `${item.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Falha ao baixar documento",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    upload.mutate();
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[20px] border border-white/60 bg-white/72 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[40px]">
              <BrainCircuit className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                Conhecimento
              </h1>
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            documents.refetch();
            files.refetch();
          }}
          disabled={documents.isFetching || files.isFetching}
        >
          <RefreshCw
            className={cn(
              "h-4 w-4",
              (documents.isFetching || files.isFetching) && "animate-spin",
            )}
          />
          Atualizar
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5 md:p-6">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Documentos</p>
              <p className="text-2xl font-semibold">{summary.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5 md:p-6">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Consultáveis</p>
              <p className="text-2xl font-semibold">{summary.consultable}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5 md:p-6">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Trechos</p>
              <p className="text-2xl font-semibold">{summary.chunks}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5 md:p-6">
            <FileCheck2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Arquivos fonte</p>
              <p className="text-2xl font-semibold">{summary.files}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          {documents.isLoading ? (
            <Card>
              <CardContent className="flex min-h-[240px] items-center justify-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Carregando base de conhecimento...
                </span>
              </CardContent>
            </Card>
          ) : documents.data?.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {documents.data.map((item) => {
                const linkedFile =
                  filesByKnowledge.get(item.download_file_id ?? item.id) ??
                  filesByKnowledge.get(item.id);
                const canDownload = Boolean(linkedFile);
                const consultable = asNumber(item.chunk_count) > 0;

                return (
                  <Card key={item.id} className="overflow-hidden">
                    <CardHeader className="border-b border-border/60 bg-white/35">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <CardTitle className="line-clamp-2 text-base leading-6">
                            {item.title ?? item.source_file_name ?? "Documento"}
                          </CardTitle>
                          <CardDescription className="mt-2">
                            {item.source_file_name ?? item.id}
                          </CardDescription>
                        </div>
                        <Badge
                          variant={consultable ? "default" : "outline"}
                          className="shrink-0"
                        >
                          {extractionLabel(item.extraction_status)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-5">
                      <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
                        {item.summary ??
                          "Documento ativo na base de conhecimento do Agent Dute."}
                      </p>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl border border-border/70 bg-white/55 p-3">
                          <p className="text-xs text-muted-foreground">Cliente</p>
                          <p className="mt-1 font-medium">
                            {item.customer_code ?? "BTG Pactual"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-white/55 p-3">
                          <p className="text-xs text-muted-foreground">Tipo</p>
                          <p className="mt-1 font-medium">
                            {documentTypeLabel(item.document_type)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-white/55 p-3">
                          <p className="text-xs text-muted-foreground">Páginas</p>
                          <p className="mt-1 font-medium">
                            {asNumber(item.pages) || "N/D"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-white/55 p-3">
                          <p className="text-xs text-muted-foreground">Trechos</p>
                          <p className="mt-1 font-medium">
                            {asNumber(item.chunk_count)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(item.ingested_at ?? item.created_at)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canDownload || downloadingId === item.id}
                          onClick={() => downloadFile(item)}
                        >
                          {downloadingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          Baixar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Empty className="min-h-[320px] rounded-[24px] border border-dashed border-border bg-white/45">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText className="h-5 w-5" />
                </EmptyMedia>
                <EmptyTitle>Sem documentos na base</EmptyTitle>
                <EmptyDescription>
                  Os documentos reais adicionados ao Agent Dute aparecerão aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UploadCloud className="h-4 w-4 text-primary" />
              Anexar conhecimento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="knowledge-file">Arquivo</Label>
                <Input
                  id="knowledge-file"
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/*"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {file ? (
                  <p className="text-xs text-muted-foreground">
                    {file.name} · {formatBytes(file.size)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="knowledge-title">Título</Label>
                <Input
                  id="knowledge-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder={file ? titleFromFile(file) : "Nome do documento"}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="knowledge-customer">Cliente</Label>
                  <Input
                    id="knowledge-customer"
                    value={form.customer_code}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        customer_code: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={form.document_type}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        document_type: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contrato_assinado">
                        Contrato assinado
                      </SelectItem>
                      <SelectItem value="proposta_comercial">
                        Proposta comercial
                      </SelectItem>
                      <SelectItem value="documento_operacional">
                        Documento operacional
                      </SelectItem>
                      <SelectItem value="regra_cliente">
                        Regra do cliente
                      </SelectItem>
                      <SelectItem value="procedimento">
                        Procedimento
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="knowledge-notes">Resumo</Label>
                <Textarea
                  id="knowledge-notes"
                  value={form.notes}
                  rows={5}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Resumo operacional ou orientação para o Agent Dute"
                />
              </div>
              <Alert className="border-primary/15 bg-primary/5">
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Base governada</AlertTitle>
                <AlertDescription>
                  O Agent Dute usa os trechos indexados desta coleção como contexto operacional.
                </AlertDescription>
              </Alert>
              <Button
                type="submit"
                className="w-full"
                disabled={!file || upload.isPending}
              >
                {upload.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                Anexar ao Agent Dute
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
