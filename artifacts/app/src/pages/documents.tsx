import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, MoreHorizontal, Plus, Search, UploadCloud } from "lucide-react";

import { AvisoDeEspera } from "@/components/ui/aviso-de-espera";
import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Progresso, type ItemDoProgresso } from "@/components/ui/progresso";
import { Chip } from "@/components/ui/chip";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { Spinner } from "@/components/ui/spinner";
import { FilterGroup, FilterPanel } from "@/components/ui/filter-panel";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogCancelar,
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
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { CARREGANDO, relogioDaEspera } from "@/lib/carregando/tempo";
import { desfechoDoErro, useAcaoNaLinha, type AcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import { useEspera } from "@/lib/carregando/use-espera";
import { useFocoQueSegue } from "@/lib/carregando/use-foco-que-segue";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { canAccessModule, type ProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_TYPE_LABELS,
  buildDocumentRows,
  documentsListUrl,
  matchesDocumentFilters,
  type DocumentAudience,
  type DocumentKind,
  type DocumentRow,
  type KnowledgeState,
} from "@/lib/document-rows";
import { fileToBase64 } from "@/lib/file-base64";
import { useActiveCustomer } from "@/lib/active-customer-context";

/**
 * Documentos do cliente ativo. Uma lista só: o que a Dutelog adicionou e as
 * NFs que o cliente anexou no aviso de chegada. É o arquivo da operação; a base
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

// Espelha o backend (mutateManagedEntity): só estes publicam para o cliente.
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
  { value: "btg", label: "Cliente vê" },
  { value: "internal", label: "Só Dutelog" },
  { value: "archived", label: "Arquivados" },
];

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
  if (!response.ok) {
    // O código fica no erro: o prazo sem resposta (deadline-exceeded) vira o "Conferir".
    throw Object.assign(new Error(payload.message || "Não foi possível concluir a operação."), { status: response.status, ...(payload.code ? { code: payload.code } : {}) });
  }
  return payload as T;
}

/**
 * As etapas de "Adicionar documento" (carregamento v2, parte 11): o arquivo
 * sobe pelo backend (até 20 MB, numa chamada que desiste aos 70 s) e o
 * documento é cadastrado, em duas chamadas. A etapa anda com a resposta de
 * cada uma. Ficam no diálogo desde o repouso, pendentes, para nada entrar
 * empurrando o botão tocado.
 */
export const ETAPAS_DO_DOCUMENTO = ["Arquivo", "Cadastro"] as const;

/** As de antes feitas, a da vez andando enquanto a chamada dela espera (sem resposta e conferindo, pendente). */
export function etapasDoDocumento(etapa: number, andando = true): ItemDoProgresso[] {
  return ETAPAS_DO_DOCUMENTO.map((rotulo, indice) => ({
    rotulo,
    estado: indice + 1 < etapa ? "feito" : indice + 1 === etapa && andando ? "andamento" : "fila",
  }));
}

/** O arquivo que já subiu e para quem: só vale de novo para o mesmo arquivo, cliente e tipo. */
interface ArquivoEnviado {
  file: File;
  customerCode: string;
  documentType: string;
  entityType: string;
  target: UploadedFile;
}

const emptyForm = { title: "", documentType: "nf_entrada", reference: "", customerVisible: false };

/** As ações do menu de cada documento, cada uma com a espera dela na linha (carregamento v2, parte 13d). */
type AcaoDoDocumento = "conhecimento" | "aprovar" | "recusar" | "mostrar" | "ocultar" | "arquivar";

/** O que a lista relida mostra quando a ação valeu: o "Conferir" dos 70 s sem resposta relê e nunca reenvia. */
const VALEU: Record<AcaoDoDocumento, (row: DocumentRow) => boolean> = {
  conhecimento: (row) => row.knowledge !== "none" && row.knowledge !== "rejected",
  aprovar: (row) => row.knowledge === "active",
  recusar: (row) => row.knowledge === "rejected",
  mostrar: (row) => row.audience === "btg",
  ocultar: (row) => row.audience === "internal",
  arquivar: (row) => row.audience === "archived",
};

/** O gerúndio da ação, com o documento a partir dos 3 s ("Arquivando NF 48213…"; momento 4). */
function gerundioDa(acao: AcaoDoDocumento, documento?: string): string {
  const de = documento ? ` ${documento}` : "";
  switch (acao) {
    case "conhecimento":
      return `Enviando${de} para o Conhecimento…`;
    case "aprovar":
      return `Aprovando${de} para o Conhecimento…`;
    case "recusar":
      return `Recusando${de} para o Conhecimento…`;
    case "mostrar":
      return `Mostrando${de} para o cliente…`;
    case "ocultar":
      return `Ocultando${de} do cliente…`;
    case "arquivar":
      return `Arquivando${de}…`;
  }
}

export default function Documents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const canPublish = canAccessModule(role, PUBLISHERS);
  const canSend = canAccessModule(role, KNOWLEDGE_SENDERS);
  const canApprove = canAccessModule(role, KNOWLEDGE_APPROVERS);
  const isFinance = role === "financeiro";
  // O documento novo é do cliente ativo; a biblioteca lista todos.
  // O documento novo vai para o cliente ativo: enquanto ele lê, "Adicionar documento" espera (o código ainda seria o
  // do cliente padrão; o customer_code é a fronteira).
  const { code: customerCode, active: activeCustomer, isLoading: carregandoCliente } = useActiveCustomer();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<DocumentKind | "all">("all");
  const [audience, setAudience] = useState<DocumentAudience | "all">("all");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const documentsUrl = documentsListUrl(role);
  const documents = useQuery({
    queryKey: ["operational-documents", documentsUrl],
    queryFn: async () =>
      (await apiJson<{ items?: Record<string, unknown>[] }>(documentsUrl)).items ?? [],
  });
  const lerAvisos = canAccessModule(role, REQUEST_READERS);
  const requests = useQuery({
    queryKey: ["documents", "request-attachments"],
    queryFn: async () =>
      (await apiJson<{ items?: Record<string, unknown>[] }>("/api/customer-requests?limit=500")).items ?? [],
    enabled: lerAvisos,
  });
  // A primeira leitura tem a forma final (as linhas-fantasma) e a linha de estado; a falha sem nada lido fica na tela
  // enquanto a pessoa tenta de novo (as cópias), e a releitura que falha com a lista lida fica na linha de estado, sem
  // apagar a lista. Os avisos de chegada (as NFs do cliente) que falham não somem calados: o aviso fica acima da lista
  // (carregamento v2, parte 13d).
  const documentos = useLeituraComFalha(documents);
  const avisos = useLeituraComFalha(requests);
  const documentosFalharam = documentos.isError && documents.data === undefined;
  const avisosFalharam = lerAvisos && avisos.isError && requests.data === undefined;
  const lendo = !documentosFalharam && (documents.data === undefined || (lerAvisos && requests.data === undefined && !avisosFalharam));
  const leiturasDaLista = lerAvisos ? [documents, requests] : [documents];
  const idDaLinha = useId();
  const fantasmas = useEspera(lendo);

  const rows = useMemo(
    () => buildDocumentRows(documents.data ?? [], requests.data ?? []),
    [documents.data, requests.data],
  );
  const visible = useMemo(
    () => rows.filter((row) => matchesDocumentFilters(row, { search, kind, audience })),
    [audience, kind, rows, search],
  );
  const contagem = useContagemLembrada("documentos", "todos", lendo || documentosFalharam ? null : { linhas: rows.length });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["operational-documents"] });
  const failure = (title: string) => (error: unknown) =>
    toast({ title, description: humanApiError(error, "Tente novamente em instantes."), variant: "destructive" });

  // As etapas do envio e o fim no botão: o erro por 2 s, ou o "Conferir" do
  // prazo sem resposta. O arquivo que já subiu não sobe de novo na repetição,
  // mas só para o mesmo cliente: o customer_code é a fronteira, e o arquivo
  // mora na pasta do cliente que estava ativo quando subiu.
  const [etapaDoDocumento, setEtapaDoDocumento] = useState(0);
  const [fimDoDocumento, setFimDoDocumento] = useState<"erro" | "sem-resposta" | null>(null);
  const [conferindoDocumento, setConferindoDocumento] = useState(false);
  const arquivoEnviado = useRef<ArquivoEnviado | null>(null);
  useEffect(() => {
    // Outro cliente no menu: o arquivo do anterior não serve, e o fim do envio dele também não.
    arquivoEnviado.current = null;
    setFimDoDocumento(null);
    setEtapaDoDocumento(0);
  }, [customerCode]);
  const add = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha o arquivo.");
      const title = form.title.trim() || file.name.replace(/\.[^.]+$/, "");
      const documentType = isFinance ? "fatura" : form.documentType;
      const entityType = isFinance ? "fatura" : "operacional";
      if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo grande demais. Use até 20 MB.");
      setFimDoDocumento(null);
      setEtapaDoDocumento(1);
      // O arquivo sobe pelo backend, que grava no Storage. O PUT na URL
      // assinada era recusado pelo Storage de produção.
      const enviado = arquivoEnviado.current;
      const target =
        enviado && enviado.file === file && enviado.customerCode === customerCode && enviado.documentType === documentType && enviado.entityType === entityType
          ? enviado.target
          : await apiJson<UploadedFile>("/api/documents/upload", {
              method: "POST",
              body: JSON.stringify({
                customer_code: customerCode,
                file_name: file.name,
                content_type: file.type || "application/octet-stream",
                data_base64: await fileToBase64(file),
                document_type: documentType,
                entity_type: entityType,
              }),
            });
      arquivoEnviado.current = { file, customerCode, documentType, entityType, target };
      setEtapaDoDocumento(2);
      const shared = canPublish && form.customerVisible;
      return apiJson("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          customer_code: customerCode,
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
    onSuccess: () => adicionado(),
    onError: (error) => {
      if (desfechoDoErro(error) === "sem-resposta") {
        setFimDoDocumento("sem-resposta");
        return;
      }
      setFimDoDocumento("erro");
      failure("Documento não adicionado")(error);
    },
  });
  async function adicionado() {
    arquivoEnviado.current = null;
    setFimDoDocumento(null);
    setEtapaDoDocumento(0);
    setAdding(false);
    setForm(emptyForm);
    setFile(null);
    await refresh();
    toast({ title: "Documento adicionado" });
  }
  useEffect(() => {
    if (fimDoDocumento !== "erro") return undefined;
    const volta = setTimeout(() => setFimDoDocumento((atual) => (atual === "erro" ? null : atual)), CARREGANDO.erroVisivelMs);
    return () => clearTimeout(volta);
  }, [fimDoDocumento]);
  // Conferindo, o estado continua sem resposta: o botão diz "Conferindo…", e não o envio de novo.
  const estadoDoDocumento: EstadoDaAcao = add.isPending ? "andamento" : (fimDoDocumento ?? "repouso");
  const esperaDoDocumento = useEspera(add.isPending);
  const enviandoDocumento = add.isPending || conferindoDocumento;
  /** O "Conferir" do prazo sem resposta: relê a lista e nunca reenvia. Cadastrado por lá, segue o sucesso. */
  async function conferirDocumento() {
    if (conferindoDocumento) return;
    setConferindoDocumento(true);
    try {
      const lidos = (await apiJson<{ items?: Record<string, unknown>[] }>(documentsUrl)).items ?? [];
      const caminho = arquivoEnviado.current?.target.storage_path;
      if (caminho && lidos.some((documento) => documento.storage_path === caminho)) await adicionado();
      else setFimDoDocumento(null);
    } catch (error) {
      failure("Não consegui conferir o documento")(error);
    } finally {
      setConferindoDocumento(false);
    }
  }

  // As ações do menu de cada documento são por linha (carregamento v2, parte 13d; momento 4): a linha tocada mostra a
  // espera dela, as outras seguem livres, e o segundo toque na linha ocupada não grava de novo. As chamadas são as
  // de sempre. Aos 70 s sem resposta, "Conferir" relê a lista e nunca reenvia.
  const acoes = useAcaoNaLinha<string>();
  // O documento arquivado sai da lista ("Todos" não mostra os arquivados): o foco que estava no "⋯" dele vai à linha
  // de estado, nunca ao body.
  const focoQueSegue = useFocoQueSegue();
  /** O que a lista relida diz da ação: valeu ou não. */
  const conferirNaLista = (id: string, valeu: (row: DocumentRow) => boolean) => async () => {
    const lidos = (await apiJson<{ items?: Record<string, unknown>[] }>(documentsUrl)).items ?? [];
    const row = buildDocumentRows(lidos, []).find((item) => item.documentId === id);
    return Boolean(row && valeu(row));
  };
  /** O "Conferir" da linha sem resposta: relê a lista, e a ação que valeu segue o sucesso; a que não valeu volta. */
  const conferir = (row: DocumentRow, acao: AcaoDoDocumento) => {
    const id = row.documentId;
    if (!id) return;
    void acoes.executar(id, acao, () => Promise.resolve(), { releitura: refresh, conferir: conferirNaLista(id, VALEU[acao]) });
  };
  const naLinha = (
    row: DocumentRow,
    acao: AcaoDoDocumento,
    chamada: (id: string) => Promise<unknown>,
    deuCerto: (resultado: unknown) => void,
    titulo: string,
  ) => {
    const id = row.documentId;
    if (!id) return;
    void acoes.executar(
      id,
      acao,
      () =>
        chamada(id).then(
          (resultado) => {
            deuCerto(resultado);
            return resultado;
          },
          (erro: unknown) => {
            // Sem resposta no prazo, quem diz é a linha ("Sem confirmação do servidor" e "Conferir").
            if (desfechoDoErro(erro) !== "sem-resposta") failure(titulo)(erro);
            throw erro;
          },
        ),
      { releitura: refresh, conferir: conferirNaLista(id, VALEU[acao]) },
    );
  };

  const setShared = (row: DocumentRow, shared: boolean) =>
    naLinha(
      row,
      shared ? "mostrar" : "ocultar",
      (id) =>
        apiJson(`/api/documents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            customer_visible: shared,
            visibility: shared ? "customer" : "internal",
            status: shared ? "published" : "internal",
          }),
        }),
      () => toast({ title: shared ? "O cliente agora vê o documento" : "Documento só para a Dutelog" }),
      "Visibilidade não alterada",
    );

  const archive = (row: DocumentRow) =>
    naLinha(
      row,
      "arquivar",
      (id) => apiJson(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
      () => toast({ title: "Documento arquivado" }),
      "Documento não arquivado",
    );

  // "Enviar para o Conhecimento": extrai o texto e liga à base do Agent
  // Dute. Tipos sensíveis voltam "aguardando aprovação" (regra do backend);
  // aprovar é de uma pessoa, nunca automático.
  const sendToKnowledge = (row: DocumentRow) =>
    naLinha(
      row,
      "conhecimento",
      (id) =>
        apiJson<{ message?: string; content_extraction_status?: string; knowledge_status?: string }>(
          `/api/documents/${encodeURIComponent(id)}/extract`,
          { method: "POST", body: JSON.stringify({}) },
        ),
      (resultado) => {
        const payload = resultado as { message?: string; content_extraction_status?: string; knowledge_status?: string };
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
      "Não foi enviado ao Conhecimento",
    );

  const decideKnowledge = (row: DocumentRow, approve: boolean) =>
    naLinha(
      row,
      approve ? "aprovar" : "recusar",
      (id) =>
        apiJson(`/api/documents/${encodeURIComponent(id)}/knowledge/${approve ? "approve" : "reject"}`, {
          method: "POST",
          body: JSON.stringify({}),
        }),
      () => toast({ title: approve ? "Aprovado para o Conhecimento" : "Recusado para o Conhecimento" }),
      "Decisão não registrada",
    );

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
        description="NFs, comprovantes e contratos do cliente ativo"
        // A casa do estado da lista, sob o título: "Carregando documentos…" na primeira leitura, com as linhas-fantasma;
        // "Atualizado às" e a releitura que falha, sem apagar a lista (carregamento v2, parte 13d).
        estado={<LinhaDeEstado id={idDaLinha} leitura={leiturasDaLista} objeto="documentos" />}
        actions={
          <Button
            aria-disabled={carregandoCliente || undefined}
            className={cn(carregandoCliente && "opacity-45")}
            onClick={() => {
              if (!carregandoCliente) setAdding(true);
            }}
          >
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
        {documentosFalharam ? (
          <FalhaNaLeitura leitura={documents} erro={documentos.error} mensagem="Não consegui carregar os documentos." className="m-3" focoAoSair={idDaLinha} />
        ) : lendo ? (
          <DocumentosLendo visivel={fantasmas.visivel} linhas={contagem.linhas("linhas")} idDaLinha={idDaLinha} />
        ) : (
          <>
          {avisosFalharam ? (
            <FalhaNaLeitura leitura={requests} erro={avisos.error} mensagem="Não consegui carregar as NFs dos avisos de chegada." className="m-3" focoAoSair={idDaLinha} />
          ) : null}
          {visible.length ? (
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
                    acoes={acoes}
                    onConferir={(acao) => conferir(row, acao)}
                    focoQueSegue={focoQueSegue}
                    alvoDoFoco={idDaLinha}
                    onSend={() => sendToKnowledge(row)}
                    onDecide={(approve) => decideKnowledge(row, approve)}
                    onShare={(shared) => setShared(row, shared)}
                    onArchive={() => archive(row)}
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
                acoes={acoes}
                onConferir={(acao) => conferir(row, acao)}
                focoQueSegue={focoQueSegue}
                alvoDoFoco={idDaLinha}
                onSend={() => sendToKnowledge(row)}
                onDecide={(approve) => decideKnowledge(row, approve)}
                onShare={(shared) => setShared(row, shared)}
                onArchive={() => archive(row)}
              />
            ))}
          </ul>
          </>
        ) : rows.length ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhum documento neste filtro.</p>
        ) : avisosFalharam ? null : (
          // Sem os avisos de chegada lidos, "nenhum documento" seria um falso vazio: o aviso da falha já diz.
          <p className="p-6 text-sm text-muted-foreground">
            Nenhum documento ainda. As NFs anexadas pelo cliente no aviso de chegada aparecem aqui.
          </p>
        )}
          </>
        )}
      </section>

      <Dialog
        open={adding}
        // O envio que anda segura o diálogo.
        ocupado={enviandoDocumento}
        onOpenChange={setAdding}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Adicionar documento</DialogTitle>
            <DialogDescription>
              O documento fica com {activeCustomer.name}, o cliente ativo no menu.
            </DialogDescription>
          </DialogHeader>
          <form
            id="document-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (estadoDoDocumento === "sem-resposta") void conferirDocumento();
              else if (!enviandoDocumento && file && !carregandoCliente) add.mutate();
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
                  <span className="block text-sm font-semibold">O cliente pode ver</span>
                  <span className="block text-xs text-muted-foreground">Aparece em Documentos no portal do cliente</span>
                </span>
                <Switch
                  checked={form.customerVisible}
                  onCheckedChange={(customerVisible) => setForm((state) => ({ ...state, customerVisible }))}
                />
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">Fica só para a Dutelog. Publicar para o cliente é com a coordenação.</p>
            )}
          </form>
          <Progresso forma="etapas" titulo="Adicionando o documento" itens={etapasDoDocumento(etapaDoDocumento, add.isPending)} />
          <div data-lugar-do-aviso="" className="grid min-h-9 items-center">
            {add.isPending && esperaDoDocumento.calmo ? <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={esperaDoDocumento.decorridoMs} /> : null}
            {estadoDoDocumento === "sem-resposta" ? <AvisoDeEspera fase="sem-resposta" tipo="escrita" /> : null}
          </div>
          <DialogFooter>
            <DialogCancelar className="min-h-11" onClick={() => setAdding(false)} />
            <BotaoDeAcao
              type="submit"
              form="document-form"
              className="min-h-11"
              estado={conferindoDocumento ? "andamento" : estadoDoDocumento}
              rotulo="Adicionar"
              andamento={conferindoDocumento ? "Conferindo…" : "Adicionando…"}
              sucesso="Adicionado"
              erro="Não adicionado"
              bloqueado={estadoDoDocumento === "repouso" && (!file || carregandoCliente)}
            />
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
  /** A ação de cada linha (useAcaoNaLinha): a linha tocada espera, as outras seguem livres. */
  acoes: AcaoNaLinha<string>;
  /** O "Conferir" da linha sem resposta aos 70 s. */
  onConferir: (acao: AcaoDoDocumento) => void;
  /** Para onde vai o foco quando a linha sai da lista com ele dentro (useFocoQueSegue). */
  focoQueSegue: MutableRefObject<readonly string[] | null>;
  alvoDoFoco: string;
  onSend: () => void;
  onDecide: (approve: boolean) => void;
  onShare: (shared: boolean) => void;
  onArchive: () => void;
};

function audienceOf(row: DocumentRow) {
  if (row.audience === "archived") return { label: "Arquivado", tone: "bg-muted text-muted-foreground" };
  if (row.audience === "btg") {
    return { label: row.source === "request" ? "Enviado pelo cliente" : "Cliente vê", tone: "bg-info-soft text-info-soft-foreground" };
  }
  return { label: "Só Dutelog", tone: "bg-muted text-foreground" };
}

function knowledgeTone(state: KnowledgeState) {
  return state === "pending" ? "text-warning-soft-foreground" : state === "active" ? "text-primary" : "text-muted-foreground";
}

const ACOES_DO_DOCUMENTO: readonly AcaoDoDocumento[] = ["conhecimento", "aprovar", "recusar", "mostrar", "ocultar", "arquivar"];

/** A ação da linha que está na tela (em andamento, sem resposta ou com o motivo da falha), se houver. */
function acaoNaTela(acoes: AcaoNaLinha<string>, row: DocumentRow): { acao: AcaoDoDocumento; estado: EstadoDaAcao } | null {
  const id = row.documentId;
  if (!id) return null;
  for (const acao of ACOES_DO_DOCUMENTO) {
    const estado = acoes.estado(id, acao);
    if (estado !== "repouso") return { acao, estado };
  }
  const motivo = acoes.motivo(id);
  return motivo ? { acao: motivo.acao as AcaoDoDocumento, estado: "repouso" } : null;
}

function DocumentActions({ row, canPublish, canSend, canApprove, acoes, focoQueSegue, alvoDoFoco, onSend, onDecide, onShare, onArchive }: DocumentLineProps) {
  const manageable = row.source === "document" && row.audience !== "archived";
  // Ocupado não é desabilitado: o "⋯" da linha que grava fica na ordem do foco, com a caixa no lugar do ícone aos 300
  // ms, e não abre; o segundo toque não grava de novo.
  const ocupada = row.documentId ? acoes.ocupada(row.documentId) : false;
  const naTela = acaoNaTela(acoes, row);
  const andando = naTela?.estado === "andamento";
  const espera = useEspera(andando);
  const [aberto, setAberto] = useState(false);
  // A linha que sai com o foco no "⋯" (o documento arquivado) pede o foco para a linha de estado.
  const gatilho = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const elemento = gatilho.current;
    return () => {
      if (elemento && typeof document !== "undefined" && elemento === document.activeElement) focoQueSegue.current = [alvoDoFoco];
    };
  }, [alvoDoFoco, focoQueSegue]);
  return (
    <DropdownMenu open={aberto && !ocupada} onOpenChange={(abrir) => setAberto(abrir && !ocupada)}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={gatilho}
          variant="ghost"
          size="icon"
          aria-label={andando && naTela ? gerundioDa(naTela.acao, row.title) : `Ações de ${row.title}`}
          aria-disabled={ocupada || undefined}
          aria-busy={(andando && espera.visivel) || undefined}
          className={cn(ocupada && "hover:bg-transparent")}
        >
          {andando && espera.visivel ? <Spinner calmo={espera.calmo} /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
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
            {row.audience === "btg" ? "Ocultar do cliente" : "Mostrar para o cliente"}
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

/**
 * O apoio da linha cuja ação grava (carregamento v2, momento 4): aos 300 ms,
 * o gerúndio ("Arquivando…"); aos 3 s, com o documento ("Arquivando NF
 * 48213…"); aos 10 s, a demora com o relógio; sem resposta aos 70 s, o aviso e
 * "Conferir", que relê a lista e nunca reenvia; depois da falha, o motivo, até
 * a próxima ação na linha. O leitor de tela ouve a espera, a demora e a
 * desistência pelo Anunciador; o resultado, o toast diz. Não é região viva.
 */
function ApoioDaAcao({ row, acoes, onConferir }: { row: DocumentRow; acoes: AcaoNaLinha<string>; onConferir: (acao: AcaoDoDocumento) => void }) {
  const naTela = acaoNaTela(acoes, row);
  const andando = naTela?.estado === "andamento";
  const semResposta = naTela?.estado === "sem-resposta";
  const espera = useEspera(andando);
  const anunciar = useAnuncio();
  const marco = andando && espera.visivel ? (espera.fase === "demorando" ? "demorando" : "espera") : semResposta ? "sem-resposta" : null;
  const falado = naTela ? gerundioDa(naTela.acao, row.title).replace(/…$/, "") : "";
  useEffect(() => {
    if (marco === "espera") return anunciar(falado);
    if (marco === "demorando") return anunciar("Demorando mais que o normal");
    if (marco === "sem-resposta") return anunciar("Sem confirmação do servidor");
    return undefined;
  }, [marco, anunciar, falado]);
  if (!naTela || !row.documentId) return null;
  if (andando && espera.visivel) {
    if (espera.fase === "demorando" || espera.fase === "sem-resposta") {
      return (
        <div className="mt-0.5 text-xs font-bold text-amber-soft-foreground">
          <Clock3 className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          <span>Demorando mais que o normal</span>
          {" · "}
          <span className="tabular-nums">{relogioDaEspera(espera.decorridoMs)}</span>
        </div>
      );
    }
    return (
      <div className="mt-0.5 text-xs font-bold text-foreground">
        {espera.fase === "com-objeto" ? gerundioDa(naTela.acao, row.title) : gerundioDa(naTela.acao)}
      </div>
    );
  }
  if (semResposta) {
    return (
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold text-amber-soft-foreground">
        <span>Sem confirmação do servidor.</span>
        <Button type="button" variant="outline" size="sm" className="h-8 max-sm:min-h-11" onClick={() => onConferir(naTela.acao)}>
          Conferir
        </Button>
      </div>
    );
  }
  const motivo = acoes.motivo(row.documentId);
  if (motivo) return <div className="mt-0.5 text-xs font-bold text-destructive">{humanApiError(motivo.erro, "Tente novamente em instantes.")}</div>;
  return null;
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
        <ApoioDaAcao row={row} acoes={props.acoes} onConferir={props.onConferir} />
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
        <ApoioDaAcao row={row} acoes={props.acoes} onConferir={props.onConferir} />
      </div>
      <DocumentActions {...props} />
    </li>
  );
}

/**
 * A lista ainda lendo (carregamento v2, parte 13d; momento 2): a tabela com o
 * cabeçalho real e as linhas-fantasma (no celular, os cartões), na altura das
 * reais, que entram aos 300 ms com o brilho. Quem diz o que lê é a linha de
 * estado, que descreve a lista ocupada; os blocos ficam fora da árvore de
 * acessibilidade.
 */
function DocumentosLendo({ visivel, linhas, idDaLinha }: { visivel: boolean; linhas: number; idDaLinha: string }) {
  const brilho = visivel ? "carregando-com-brilho" : undefined;
  const fantasma = { "aria-hidden": true, "data-fantasmas": "", "data-visivel": visivel ? "" : undefined } as const;
  return (
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
          <tbody aria-busy="true" aria-describedby={idDaLinha}>
            {Array.from({ length: linhas }, (_, ordem) => (
              <tr key={ordem} {...fantasma} className="border-b border-border/40 last:border-0">
                <td className="px-5 py-3">
                  <span className="flex h-10 flex-col justify-center gap-1.5">
                    <Esqueleto forma="texto" className={cn("w-40", brilho)} />
                    <Esqueleto forma="texto" className={cn("h-2.5 w-28", brilho)} />
                  </span>
                </td>
                <td className="px-3 py-3"><Esqueleto forma="texto" className={cn("w-20", brilho)} /></td>
                <td className="px-3 py-3"><Esqueleto forma="texto" className={cn("w-24", brilho)} /></td>
                <td className="px-3 py-3"><Esqueleto forma="texto" className={cn("w-20", brilho)} /></td>
                <td className="px-3 py-3"><Esqueleto forma="texto" className={cn("w-14", brilho)} /></td>
                <td className="px-3 py-3"><Esqueleto forma="bloco" className={cn("ml-auto size-8", brilho)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden" aria-busy="true" aria-describedby={idDaLinha}>
        {Array.from({ length: linhas }, (_, ordem) => (
          // O cartão do celular, na anatomia do real: o nome, a origem, o selo com o tipo e a data, e o vínculo.
          <li key={ordem} {...fantasma} className="flex items-start gap-2 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="flex h-5 items-center"><Esqueleto forma="texto" className={cn("w-44", brilho)} /></span>
              <span className="flex h-4 items-center"><Esqueleto forma="texto" className={cn("h-2.5 w-28", brilho)} /></span>
              <span className="mt-2 flex h-5 items-center gap-2">
                <Esqueleto forma="bloco" className={cn("h-5 w-20", brilho)} />
                <Esqueleto forma="texto" className={cn("h-2.5 w-24", brilho)} />
              </span>
              <span className="mt-1 flex h-4 items-center"><Esqueleto forma="texto" className={cn("h-2.5 w-32", brilho)} /></span>
            </span>
            <Esqueleto forma="bloco" className={cn("size-10", brilho)} />
          </li>
        ))}
      </ul>
    </>
  );
}
