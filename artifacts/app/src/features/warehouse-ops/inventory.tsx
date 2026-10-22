/** Inventory workspaces: opening inventory + cycle count. */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ImagePlus,
  ListChecks,
  Boxes,
  MapPin,
  PackageOpen,
  PackageSearch,
  PlayCircle,
  Printer,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { OpeningLineCorrection } from "./opening-line-correction";
import { OpeningConferenceSummary } from "./opening-conference-summary";
import { ShelfPicker, eligibleShelfPositions, isCurrentShelfPreview } from "./shelf-picker";
import { ShelfVolumeSummary } from "./shelf-volume-summary";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { boxVolumeM3, formatVolumeM3 } from "@/lib/warehouse-volume";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import {
  conferenceAttempt, conferenceCanEditLine, conferenceSkus, conferenceStatusLabel, isConferencePending, isConferenceRevisionConflict,
  type MutationAttempt, type OpeningConferenceLine, type OpeningConferenceResult,
} from "@/lib/opening-conference";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { type CountMode, defaultCountMode } from "@/lib/opening-inventory";
import { labelsUrl } from "@/lib/warehouse-labels";
import {
  type BoxDraft,
  type SlottingCandidate,
  type BoxRefusal,
  type CreateBoxResult,
  type SuggestionResult,
  type WarehouseBox,
  boxDraftToPayload,
  emptyBoxDraft,
  formatBoxDimensions,
  formatBoxPlacement,
  occupiedPositions,
  resolveContentSkus,
  sessionBoxes,
  sortBoxes,
  tierLabel,
  warehouseBoxFromRecord,
} from "@/lib/warehouse-boxes";
import { cn } from "@/lib/utils";
import {
  type AnyRecord,
  coerceNumber,
  coerceText,
  formatCurrency,
  formatDeltaUnits,
  formatNumber,
  getErrorMessage,
  normalizeStatus,
  fetchJson,
} from "@/lib/warehouse-ops/model";
import {
  type ProductLookupItem,
  type ProductPhoto,
  productLookupFromRecord,
  uploadProductPhoto,
} from "@/features/warehouse-ops/shared";
import {
  type ReceiptDraftLine,
  emptyReceiptLine,
  findExistingProduct,
  mergeProductLookup,
  normalizeApiRows,
  sourcePhotos,
  sourceText,
} from "@/features/warehouse-ops/receiving";
import {
  CATALOG_GENEROS,
  CATALOG_GRUPOS,
  inferGeneroFromClientCode,
  inferGrupoFromProduto,
} from "@/lib/catalog-taxonomy";
import {
  type OpeningInventoryLine,
  type OpeningInventorySession,
  OpeningInventoryNotice,
  useOpeningInventorySession,
} from "@/features/warehouse-ops/opening-inventory-status";
import { customerRows } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { ProductPhotoStudio } from "./product-photo-studio";
import {
  CODE_MATCH_LABEL,
  findProductByAnyCode,
  findProductByBarcode,
} from "@/lib/product-match";
import { ProductIdentityCard, NewProductNotice } from "./product-identity";

export type CycleCountResult = {
  ok?: boolean;
  cycle_count_id?: string;
  movement_id?: string;
  qty_before?: number;
  qty_counted?: number;
  qty_reserved?: number;
  qty_available?: number;
  adjustment_delta?: number;
  adjustment_qty?: number;
  adjustment_type?: string;
  box_code?: string;
  /** SKU da linha; `sku_generated` quando o produto novo ganhou o SKU agora. */
  sku_code?: string;
  sku_generated?: boolean;
};

export type { OpeningInventoryLine, OpeningInventorySession };

/**
 * A Contagem tem duas abas: o inventário de abertura (uma vez por cliente,
 * para inicializar o estoque) e a contagem cíclica (a rotina). Sem abertura
 * concluída, abre na abertura; a pessoa pode trocar. O seletor saiu em
 * 08/10/2026 (PR 68) e voltou em 16/10, com a zeragem total: sem ele, a
 * abertura não tinha como ser concluída e o portal ficava preso em
 * "Inventário inicial em andamento".
 */
export function CycleCountWorkspace() {
  const { code: customerCode } = useActiveCustomer();
  const sessionQuery = useOpeningInventorySession();
  const [picked, setPicked] = useState<CountMode | null>(null);
  const settled = !sessionQuery.isLoading;
  const mode: CountMode | null =
    picked ??
    (settled
      ? defaultCountMode(
          sessionQuery.isError ? "completed" : sessionQuery.data?.status,
          sessionQuery.data?.opening_required,
        )
      : null);

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        value={mode ?? "opening"}
        onValueChange={(value) => setPicked(value as CountMode)}
      >
        <TabsList aria-label="Tipo de contagem">
          <TabsTrigger value="opening">
            <PackageOpen className="mr-2 size-4" />
            Inventário de abertura
          </TabsTrigger>
          <TabsTrigger value="cycle">
            <ListChecks className="mr-2 size-4" />
            Contagem cíclica
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === null ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : (
        <>
          <OpeningInventoryNotice session={sessionQuery.data} />
          {/* Trocar o cliente ativo recomeça a tela: caixa aberta e rascunho são do cliente anterior. */}
          {mode === "opening" ? (
            <OpeningInventoryWorkspace key={customerCode} />
          ) : (
            <ExistingCycleCountWorkspace key={customerCode} />
          )}
        </>
      )}
    </div>
  );
}

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * A abertura é lançada por caixa (docs/mapa-do-armazem-enderecamento-dirigido.md,
 * seção 5.2): a pessoa mede a caixa, o motor diz em que prateleira guardar,
 * a caixa nasce já na posição e cada produto lançado vai com o código dela.
 * O endereço deixou de ser digitado; é a posição da caixa aberta na tela.
 */
export function OpeningInventoryWorkspace() {
  // A abertura é do cliente ativo: sessão, caixas, produtos e linhas são dele.
  const {
    code: customerCode,
    active: activeCustomer,
    isLoading: customerLoading,
  } = useActiveCustomer();
  const skuPrefix = activeCustomer.profile.skuPrefix;
  // Sem sigla no cadastro publicado, as Functions recusam produto novo: a
  // tela avisa antes. Perfil ainda não publicado fica para as Functions dizerem.
  const missingSkuPrefix =
    !customerLoading && activeCustomer.profile.source === "published" && !skuPrefix;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [clientCode, setClientCode] = useState("");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [genero, setGenero] = useState("");
  const [grupo, setGrupo] = useState("");
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [createNew, setCreateNew] = useState(false);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductLookupItem>();
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [lineToRemove, setLineToRemove] = useState<OpeningInventoryLine>();
  const [lineToMove, setLineToMove] = useState<OpeningInventoryLine>();
  const [boxAcknowledged, setBoxAcknowledged] = useState(false);
  const [lineBoxFilter, setLineBoxFilter] = useState("all");
  // A caixa: medidas digitadas, sugestão do motor, recusa e a caixa aberta na tela.
  const [boxDraft, setBoxDraft] = useState<BoxDraft>(emptyBoxDraft);
  const [suggestion, setSuggestion] = useState<SuggestionResult>();
  const [suggestionContext, setSuggestionContext] = useState("");
  const [putawayMode, setPutawayMode] = useState<"suggested" | "manual">("suggested");
  const [manualLocation, setManualLocation] = useState("");
  const [manualSuggestion, setManualSuggestion] = useState<SuggestionResult>();
  const [manualSuggestionContext, setManualSuggestionContext] = useState("");
  const [previewError, setPreviewError] = useState<string>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<BoxRefusal>();
  const [refusing, setRefusing] = useState(false);
  const [refusalReason, setRefusalReason] = useState("");
  const [activeBox, setActiveBox] = useState<WarehouseBox>();
  const [boxToRemove, setBoxToRemove] = useState<WarehouseBox>();
  const [legacyBoxMode, setLegacyBoxMode] = useState(false);
  const [allowTilt, setAllowTilt] = useState(false);
  const [allowStacking, setAllowStacking] = useState(false);
  const [editingDraft, setEditingDraft] = useState<OpeningConferenceLine>();
  const [draftToRemove, setDraftToRemove] = useState<OpeningConferenceLine>();
  const [reviewBoxOpen, setReviewBoxOpen] = useState(false);
  const [pendingBoxSelection, setPendingBoxSelection] = useState<{ box?: WarehouseBox }>();
  const attempts = useRef(new Map<string, MutationAttempt>());
  const suggestionGeneration = useRef(0);

  useEffect(() => {
    const suggested = inferGeneroFromClientCode(clientCode);
    if (suggested) {
      setGenero((current) => current || suggested);
    }
  }, [clientCode]);

  useEffect(() => {
    const suggested = inferGrupoFromProduto(productName);
    if (suggested) {
      setGrupo((current) => current || suggested);
    }
  }, [productName]);

  const sessionQuery = useOpeningInventorySession();
  const lookupQuery = useQuery({
    queryKey: ["opening-inventory-product-lookup", customerCode],
    staleTime: 30_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      return mergeProductLookup(
        customerRows(normalizeApiRows(skusPayload), customerCode).map(productLookupFromRecord),
        customerRows(normalizeApiRows(productsPayload), customerCode).map(productLookupFromRecord),
      );
    },
  });
  const boxesQuery = useQuery({
    queryKey: ["warehouse-boxes", customerCode, "all-pages"],
    staleTime: 10_000,
    queryFn: async () =>
      (await fetchWarehouseRows<AnyRecord>(
        `/api/warehouse/boxes?customer_code=${encodeURIComponent(customerCode)}&limit=1000`,
      )).map(warehouseBoxFromRecord),
  });
  const positionsQuery = useQuery({
    queryKey: ["warehouse-positions", "all-pages"],
    staleTime: 30_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
  });
  const eligiblePositions = useMemo(
    () => eligibleShelfPositions(positionsQuery.data?.items ?? [], customerCode),
    [positionsQuery.data?.items, customerCode],
  );
  const lookupProducts = lookupQuery.data ?? [];
  const session = sessionQuery.data;
  const sessionLines = session?.lines ?? [];
  const visibleLines = lineBoxFilter === "all" ? sessionLines : sessionLines.filter((line) => line.box_code === lineBoxFilter);
  const sessionOpen = session?.status === "open";
  const storedBoxes = useMemo(() => sortBoxes(boxesQuery.data ?? []), [boxesQuery.data]);
  const boxesOfSession = useMemo(
    () => sessionBoxes(storedBoxes, session?.session_id),
    [session?.session_id, storedBoxes],
  );
  const occupied = occupiedPositions(storedBoxes);
  const selectedBox = activeBox
    ? storedBoxes.find((box) => box.code === activeBox.code) ?? activeBox
    : undefined;
  const conferenceQuery = useQuery({
    queryKey: ["opening-conference-box", customerCode, session?.session_id, selectedBox?.code],
    enabled: Boolean(selectedBox && session?.session_id),
    staleTime: 0,
    queryFn: () => fetchJson<OpeningConferenceResult>(
      `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(selectedBox!.code)}/read`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ customer_code: customerCode, session_id: session?.session_id }) },
    ),
  });
  const currentBox = conferenceQuery.data?.box ? warehouseBoxFromRecord(conferenceQuery.data.box) : selectedBox;
  const conferenceLines = conferenceQuery.data?.lines ?? [];
  useEffect(() => {
    suggestionGeneration.current += 1;
    setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
    setExcluded([]);
    setRefusal(undefined);
    setPutawayMode("suggested");
    setManualLocation("");
  }, [customerCode, currentBox?.code, currentBox?.conference_revision]);

  const isDraftBox = currentBox?.status === "counting" || currentBox?.status === "committing";
  const canEnterProduct = Boolean(currentBox &&
    ((!currentBox.opening_closed && (currentBox.status === "counting" || currentBox.status === "stored")) ||
      (currentBox.status === "committing" && editingDraft)));
  const pendingBoxes = boxesOfSession.filter(isConferencePending);
  const formDirty = Boolean(clientCode.trim() || productName.trim() || countedQty.trim() || photos.length);
  const locationId = currentBox?.location_id ?? "";
  const boxPayload = useMemo(() => boxDraftToPayload(boxDraft), [boxDraft]);
  const contentSkus = useMemo(
    () => currentBox?.status === "reviewed"
      ? conferenceSkus(conferenceLines, lookupProducts)
      : resolveContentSkus(boxDraft.content, lookupProducts),
    [boxDraft.content, lookupProducts, currentBox?.status, conferenceLines],
  );
  const slottingContextKey = JSON.stringify({
    customerCode, sessionId: session?.session_id, boxCode: currentBox?.code,
    revision: currentBox?.conference_revision, status: currentBox?.status,
    boxPayload, contentSkus, allowTilt, allowStacking,
  });
  const slottingContextRef = useRef(slottingContextKey);
  slottingContextRef.current = slottingContextKey;
  const automaticSuggestion = suggestionContext === slottingContextKey ? suggestion : undefined;
  const activeSuggestion = putawayMode === "manual"
    ? positionsQuery.isSuccess && manualSuggestionContext === slottingContextKey && manualSuggestion?.position?.code === manualLocation &&
      eligiblePositions.some((position) => position.code === manualLocation)
      ? manualSuggestion : undefined
    : automaticSuggestion;
  const activePosition = positionsQuery.data?.items.find((position) =>
    position.code === (putawayMode === "manual" ? manualLocation : activeSuggestion?.position?.code),
  );

  // O SKU não se digita (é gerado na sigla do cliente): o campo de código
  // acha o produto pelo código do cliente, pelo SKU ou pelo de barras, e o
  // código de barras sozinho também acha (lib/product-match.ts).
  const codeMatch = useMemo(
    () => findProductByAnyCode(lookupProducts, clientCode),
    [clientCode, lookupProducts],
  );
  const barcodeMatch = useMemo(
    () => findProductByBarcode(lookupProducts, barcode),
    [barcode, lookupProducts],
  );
  const identityConflict = Boolean(
    codeMatch && barcodeMatch && codeMatch.product.id !== barcodeMatch.id,
  );
  const existingProduct = identityConflict
    ? undefined
    : codeMatch?.product ?? barcodeMatch;
  const existingMatchLabel = codeMatch
    ? CODE_MATCH_LABEL[codeMatch.field]
    : barcodeMatch
      ? CODE_MATCH_LABEL.barcode
      : "";
  const parsedCount = Number(countedQty);
  const parsedCost = Number(unitCost);
  const hasIdentity = Boolean(clientCode.trim());
  const newProductComplete =
    Boolean(productName.trim()) &&
    Boolean(category.trim()) &&
    Boolean(genero.trim()) &&
    Boolean(grupo.trim()) &&
    Number.isFinite(parsedCost) &&
    parsedCost > 0 &&
    photos.length > 0;
  const taxonomyComplete = Boolean(genero.trim()) && Boolean(grupo.trim());
  const selectedProductCost =
    Number.isFinite(parsedCost) && parsedCost > 0
      ? parsedCost
      : selectedProduct?.unitCost ?? 0;
  const canSubmit =
    sessionOpen &&
    hasIdentity &&
    lookupQuery.isSuccess &&
    !identityConflict &&
    canEnterProduct &&
    conferenceQuery.isSuccess &&
    !conferenceQuery.isFetching &&
    boxAcknowledged &&
    countedQty.trim() !== "" &&
    Number.isFinite(parsedCount) &&
    parsedCount > 0 &&
    !photoUploading &&
    taxonomyComplete &&
    ((Boolean(selectedProduct?.hasSku) && selectedProductCost > 0) ||
      (createNew && newProductComplete && !missingSkuPrefix)) &&
    !(selectedProduct && createNew);

  const startSession = useMutation<OpeningInventorySession, Error>({
    mutationFn: () =>
      fetchJson<OpeningInventorySession>(
        "/api/warehouse/opening-inventory/session",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            customer_code: customerCode,
            reference: `Inventário de abertura ${new Date().toLocaleDateString("pt-BR")}`,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setCompleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      toast({
        title: "Inventário de abertura iniciado",
        description: "Separe os produtos na caixa de destino e comece a conferência.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui iniciar o inventário",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const completeSession = useMutation<OpeningInventorySession, Error>({
    mutationFn: () =>
      fetchJson<OpeningInventorySession>(
        "/api/warehouse/opening-inventory/session/complete",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            customer_code: customerCode,
            session_id: session?.session_id,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setActiveBox(undefined);
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      toast({
        title: "Inventário de abertura concluído",
        description: "A sessão foi fechada e permanece disponível para auditoria.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui concluir a sessão",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const suggestPosition = useMutation<SuggestionResult, Error, { exclude: string[]; generation: number; contextKey: string; location_id?: string }>({
    mutationFn: ({ exclude, location_id }) => {
      if (!boxPayload) {
        throw new Error("Informe comprimento, largura e altura da caixa em centímetros.");
      }
      return fetchJson<SuggestionResult>("/api/warehouse/boxes/suggest", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          customer_code: customerCode,
          ...boxPayload,
          sku_codes: contentSkus,
          allow_tilt: allowTilt,
          allow_stacking: allowStacking,
          opening_inventory: true,
          exclude,
          ...(location_id ? { location_id } : {}),
        }),
      });
    },
    onSuccess: (result, variables) => {
      if (!isCurrentShelfPreview(variables, {
        generation: suggestionGeneration.current, contextKey: slottingContextRef.current,
      })) return;
      setPreviewError(undefined);
      if (variables.location_id) {
        if (result.position?.code !== variables.location_id) {
          setManualSuggestion(undefined);
          setPreviewError("A prévia não corresponde à prateleira selecionada. Confira novamente.");
          return;
        }
        setManualSuggestion(result);
        setManualSuggestionContext(variables.contextKey);
      } else {
        setSuggestion(result);
        setSuggestionContext(variables.contextKey);
      }
    },
    onError: (error, variables) => {
      if (!isCurrentShelfPreview(variables, {
        generation: suggestionGeneration.current, contextKey: slottingContextRef.current,
      })) return;
      setPreviewError(getErrorMessage(error));
      if (variables.location_id) setManualSuggestion(undefined);
      else {
        setSuggestion(undefined);
        setSuggestionContext("");
      }
      toast({
        title: variables.location_id ? "Não consegui validar esta prateleira" : "Não consegui sugerir a posição",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const createBox = useMutation<CreateBoxResult, Error, { candidate: SlottingCandidate }>({
    mutationFn: ({ candidate }) => {
      if (!boxPayload) {
        throw new Error("Informe comprimento, largura e altura da caixa em centímetros.");
      }
      return fetchJson<CreateBoxResult>("/api/warehouse/boxes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          customer_code: customerCode,
          session_id: session?.session_id,
          ...boxPayload,
          location_id: candidate.code,
          allow_tilt: allowTilt,
          allow_stacking: allowStacking,
          orientation: candidate.placement.orientation,
          support_box_code: candidate.placement.support_box_code ?? null,
          suggestion: automaticSuggestion
            ? {
                position: automaticSuggestion.position?.code ?? null,
                reason: automaticSuggestion.position?.reason ?? automaticSuggestion.rejected ?? null,
                alternatives: automaticSuggestion.alternatives.map((item) => item.code),
              }
            : undefined,
          refusal,
          idempotency_key: crypto.randomUUID(),
        }),
      });
    },
    onSuccess: (result) => {
      const box = warehouseBoxFromRecord(result.box);
      setActiveBox(box);
      setLegacyBoxMode(false);
      setBoxAcknowledged(false);
      setBoxDraft(emptyBoxDraft());
      setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
      setExcluded([]);
      setRefusal(undefined);
      setRefusing(false);
      setRefusalReason("");
      queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-positions"] });
      toast({
        title: `Caixa ${box.code} guardada em ${box.location_id}`,
        description: "Caixa física cadastrada. Use Corrigir caixa para vincular os lançamentos existentes.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui guardar a caixa",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const removeBox = useMutation<unknown, Error, WarehouseBox>({
    mutationFn: (box) =>
      fetchJson(`/api/warehouse/boxes/${encodeURIComponent(box.code)}/remove`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ customer_code: customerCode }),
      }),
    onSuccess: (_result, box) => {
      setBoxToRemove(undefined);
      queryClient.invalidateQueries({ queryKey: ["opening-conference-box"] });
      setActiveBox((current) => (current?.code === box.code ? undefined : current));
      queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      toast({
        title: `Caixa ${box.code} removida`,
        description: `A posição ${box.location_id} voltou a ter o espaço dela livre.`,
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui remover a caixa",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  function withAttempt(operation: string, body: Record<string, unknown>) {
    const attempt = conferenceAttempt(attempts.current.get(operation), operation, body, () => crypto.randomUUID());
    attempts.current.set(operation, attempt);
    return { ...attempt.payload, idempotency_key: attempt.key };
  }

  function conferenceBody() {
    if (!currentBox || !session?.session_id) throw new Error("Selecione uma caixa desta sessão.");
    return { customer_code: customerCode, session_id: session.session_id, box_code: currentBox.code, expected_revision: currentBox.conference_revision ?? 0 };
  }

  function discardRejectedRevision(operation: string, error: unknown) {
    if (isConferenceRevisionConflict(getErrorMessage(error))) attempts.current.delete(operation);
  }

  async function refreshConference() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["opening-conference-box"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] }),
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] }),
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-product-lookup"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-positions"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] }),
    ]);
  }

  function resetProductForm() {
    setClientCode(""); setProductName(""); setCategory(""); setGenero(""); setGrupo("");
    setBarcode(""); setBrand(""); setSize(""); setColor(""); setCountedQty(""); setUnitCost("");
    setReference(""); setPhotos([]); setCreateNew(false); setSelectedProduct(undefined);
    setEditingDraft(undefined); setBoxAcknowledged(false);
  }

  function activateBox(box?: WarehouseBox) {
    resetProductForm();
    setActiveBox(box);
    setLineBoxFilter(box?.code ?? "all");
    setLegacyBoxMode(false);
    setBoxDraft(emptyBoxDraft());
    setAllowTilt(false);
    setAllowStacking(false);
    setPutawayMode("suggested");
    setManualLocation("");
    setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
    setExcluded([]);
    setRefusal(undefined);
    suggestionGeneration.current += 1;
  }

  function requestBoxSelection(box?: WarehouseBox) {
    if (formDirty) setPendingBoxSelection({ box });
    else activateBox(box);
  }

  const createConference = useMutation<OpeningConferenceResult, Error>({
    mutationFn: () => fetchJson<OpeningConferenceResult>("/api/warehouse/opening-inventory/boxes", {
      method: "POST", headers: JSON_HEADERS,
      body: JSON.stringify(withAttempt("create-conference", { customer_code: customerCode, session_id: session?.session_id })),
    }),
    onSuccess: async (result) => {
      attempts.current.delete("create-conference");
      activateBox(warehouseBoxFromRecord(result.box));
      await refreshConference();
      toast({ title: `Caixa ${coerceText(result.box.code)} em conferência`, description: "Separe os produtos nesta caixa de destino e conte cada tamanho." });
    },
    onError: (error) => toast({ title: "Não consegui iniciar a caixa", description: getErrorMessage(error), variant: "destructive" }),
  });

  const changeConferenceState = useMutation<OpeningConferenceResult, Error, "review" | "reopen" | "release">({
    mutationFn: (action) => fetchJson<OpeningConferenceResult>(
      `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(currentBox!.code)}/state`,
      { method: "POST", headers: JSON_HEADERS,
        body: JSON.stringify(withAttempt("conference-state", { ...conferenceBody(), action })) },
    ),
    onSuccess: async () => {
      attempts.current.delete("conference-state");
      attempts.current.delete("store-conference");
      setReviewBoxOpen(false);
      resetProductForm();
      setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
      suggestionGeneration.current += 1;
      await refreshConference();
    },
    onError: async (error) => {
      discardRejectedRevision("conference-state", error);
      await refreshConference();
      toast({ title: "Não consegui alterar a conferência", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const removeConferenceLine = useMutation<unknown, Error, OpeningConferenceLine>({
    mutationFn: (line) => fetchJson(
      `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(currentBox!.code)}/lines/${encodeURIComponent(line.id)}/remove`,
      { method: "POST", headers: JSON_HEADERS,
        body: JSON.stringify(withAttempt("remove-conference-line", { ...conferenceBody(), line_id: line.id })) },
    ),
    onSuccess: async () => {
      attempts.current.delete("remove-conference-line");
      if (editingDraft?.id === draftToRemove?.id) resetProductForm();
      setDraftToRemove(undefined);
      await refreshConference();
    },
    onError: async (error) => {
      discardRejectedRevision("remove-conference-line", error);
      await refreshConference();
      toast({ title: "Não consegui remover o rascunho", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const storeConference = useMutation<OpeningConferenceResult, Error, SlottingCandidate>({
    mutationFn: (candidate) => {
      if (!boxPayload || currentBox?.status !== "reviewed") throw new Error("Revise a caixa e informe suas medidas antes de guardar.");
      return fetchJson<OpeningConferenceResult>(
        `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(currentBox.code)}/store`,
        { method: "POST", headers: JSON_HEADERS,
          body: JSON.stringify(withAttempt("store-conference", {
            ...conferenceBody(), ...boxPayload, location_id: candidate.code,
            allow_tilt: allowTilt, allow_stacking: allowStacking, orientation: candidate.placement.orientation,
            support_box_code: candidate.placement.support_box_code ?? null,
            suggestion: automaticSuggestion ? { position: automaticSuggestion.position?.code, reason: automaticSuggestion.position?.reason,
              alternatives: automaticSuggestion.alternatives.map((alternative) => alternative.code) } : undefined,
            refusal,
          })) },
      );
    },
    onSuccess: async (result) => {
      attempts.current.delete("store-conference");
      setActiveBox(warehouseBoxFromRecord(result.box));
      setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
      await refreshConference();
      toast({ title: `Caixa ${coerceText(result.box.code)} guardada em ${coerceText(result.box.location_id)}`, description: "Conferência concluída. Imprima a etiqueta e comece a próxima caixa." });
    },
    onError: async (error) => {
      discardRejectedRevision("store-conference", error);
      await refreshConference();
      toast({ title: "A guarda precisa de conferência", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const resumeConference = useMutation<OpeningConferenceResult, Error>({
    mutationFn: () => fetchJson<OpeningConferenceResult>(
      `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(currentBox!.code)}/resume`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(conferenceBody()) },
    ),
    onSuccess: async (result) => {
      setActiveBox(warehouseBoxFromRecord(result.box));
      resetProductForm();
      await refreshConference();
      toast({ title: "Guarda concluída", description: "A caixa está armazenada e pode ser etiquetada." });
    },
    onError: async (error) => {
      await refreshConference();
      toast({ title: "Há itens pendentes na guarda", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  function editConferenceLine(line: OpeningConferenceLine) {
    if (!currentBox || !conferenceCanEditLine(currentBox, line)) return;
    resetProductForm();
    const product = lookupProducts.find((item) => item.skuCode === line.sku_code);
    if (product) applyProduct(product);
    setClientCode(line.client_item_code || line.sku_code || "");
    setProductName(line.product_name || "");
    setCategory(line.category || "");
    setGenero(line.genero || "");
    setGrupo(line.grupo || "");
    setBarcode(line.barcode || "");
    setBrand(line.brand || "");
    setSize(line.size || "");
    setColor(line.color || "");
    setCountedQty(String(line.counted_qty));
    setUnitCost(String(line.unit_cost));
    setReference(line.reference || "");
    setPhotos(sourcePhotos(line as unknown as AnyRecord));
    setCreateNew(line.product_registration === "new");
    setEditingDraft(line);
    setBoxAcknowledged(false);
  }

  const recordOpeningLine = useMutation<CycleCountResult, Error>({
    mutationFn: () => {
      if (!currentBox || !boxAcknowledged || !canEnterProduct) throw new Error("Confira a etiqueta da caixa física antes de lançar o produto.");
      const body = {
          mode: "opening",
          session_id: session?.session_id,
          customer_code: customerCode,
          ...(isDraftBox ? { line_id: editingDraft?.id, expected_revision: currentBox.conference_revision ?? 0 } : {}),
          // Produto novo não leva SKU: as Functions geram na sigla do cliente.
          sku_code: selectedProduct?.skuCode || undefined,
          client_item_code: selectedProduct?.clientCode || clientCode.trim(),
          product_name: selectedProduct?.productName || productName.trim(),
          product_registration: selectedProduct ? "existing" : "new",
          category:
            category.trim() ||
            sourceText(selectedProduct?.source ?? {}, "category", "categoria") ||
            undefined,
          genero:
            genero.trim() ||
            sourceText(selectedProduct?.source ?? {}, "genero") ||
            undefined,
          grupo:
            grupo.trim() ||
            sourceText(selectedProduct?.source ?? {}, "grupo") ||
            undefined,
          barcode: barcode.trim() || undefined,
          brand: brand.trim() || undefined,
          size: size.trim() || undefined,
          color: color.trim() || undefined,
          photo_urls: photos.map((photo) => photo.fileUrl),
          photo_storage_paths: photos.map((photo) => photo.storagePath),
          location_id: currentBox.location_id,
          box_code: currentBox.code,
          counted_qty: parsedCount,
          unit_cost: unitCost.trim()
            ? parsedCost
            : selectedProduct?.unitCost || undefined,
          reason: "Inventário físico de abertura do estoque",
          reference: reference.trim() || session?.session_id,
          occurred_at: new Date().toISOString(),
      };
      return fetchJson<CycleCountResult>(
        isDraftBox ? `/api/warehouse/opening-inventory/boxes/${encodeURIComponent(currentBox.code)}/lines` : "/api/warehouse/cycle-counts",
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(withAttempt("record-opening-line", body)) },
      );
    },
    onSuccess: async (result) => {
      attempts.current.delete("record-opening-line");
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-product-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: isDraftBox ? "Produto salvo na conferência" : result.sku_generated
          ? `Produto cadastrado: SKU ${result.sku_code}`
          : "Produto contado e publicado",
        description: isDraftBox ? `Caixa ${currentBox?.code}. Revise os itens antes de guardar.` : `${formatNumber(result.qty_counted)} unidade(s) na caixa ${result.box_code ?? currentBox?.code ?? ""}, posição ${currentBox?.location_id ?? ""}.`,
      });
      resetProductForm();
      await refreshConference();
    },
    onError: async (error) => {
      discardRejectedRevision("record-opening-line", error);
      await refreshConference();
      toast({
        title: "Não consegui salvar a contagem",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const removeOpeningLine = useMutation<unknown, Error, OpeningInventoryLine>({
    mutationFn: (line) =>
      fetchJson(
        `/api/warehouse/opening-inventory/lines/${encodeURIComponent(line.id)}/remove`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            customer_code: customerCode,
            session_id: session?.session_id,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setLineToRemove(undefined);
      queryClient.invalidateQueries({ queryKey: ["opening-conference-box"] });
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      queryClient.invalidateQueries({
        queryKey: ["opening-inventory-product-lookup"],
      });
      queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      toast({
        title: "Linha removida para correção",
        description: "O saldo foi estornado com trilha de auditoria. Faça o lançamento correto.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui remover a linha",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  function applyProduct(product: ProductLookupItem) {
    setClientCode(product.clientCode || product.skuCode);
    setProductName(product.productName);
    setCategory(sourceText(product.source, "category", "categoria"));
    setGenero(
      sourceText(product.source, "genero") ||
        inferGeneroFromClientCode(product.clientCode) ||
        "",
    );
    setGrupo(
      sourceText(product.source, "grupo") ||
        inferGrupoFromProduto(product.productName) ||
        "",
    );
    setBarcode(sourceText(product.source, "barcode"));
    setBrand(sourceText(product.source, "brand", "marca"));
    setSize(sourceText(product.source, "size", "tamanho"));
    setColor(sourceText(product.source, "color", "cor"));
    setUnitCost(product.unitCost > 0 ? String(product.unitCost) : "");
    setPhotos(sourcePhotos(product.source));
    setCreateNew(false);
    setSelectedProduct(product);
  }

  async function addOpeningPhotos(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 4);
    if (!selected.length) return;
    setPhotoUploading(true);
    try {
      const clientItemCode = clientCode.trim() || `abertura-${Date.now()}`;
      const uploaded = await Promise.all(
        selected.map((file) => uploadProductPhoto(file, clientItemCode, customerCode)),
      );
      setPhotos((current) => [...current, ...uploaded].slice(0, 8));
    } catch (error) {
      toast({
        title: "Não consegui anexar a foto",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setPhotoUploading(false);
    }
  }

  function updateBoxDraft(field: keyof BoxDraft, value: string) {
    setBoxDraft((current) => ({ ...current, [field]: value }));
    suggestionGeneration.current += 1;
    setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined);
    setExcluded([]);
    setRefusal(undefined);
  }

  /** "Não cabe aqui": guarda o motivo, tira a prateleira da próxima rodada e pergunta de novo. */
  function refuseSuggestedPosition() {
    const code = automaticSuggestion?.position?.code;
    const reason = refusalReason.trim();
    if (!code || !reason) return;
    const nextExcluded = excluded.includes(code) ? excluded : [...excluded, code];
    setRefusal({ position: code, reason });
    setSuggestion(undefined);
    setSuggestionContext("");
    setExcluded(nextExcluded);
    setRefusing(false);
    setRefusalReason("");
    suggestPosition.mutate({ exclude: nextExcluded, generation: suggestionGeneration.current, contextKey: slottingContextKey });
  }

  const conferenceBusy = createConference.isPending || changeConferenceState.isPending ||
    removeConferenceLine.isPending || storeConference.isPending || resumeConference.isPending ||
    recordOpeningLine.isPending || conferenceQuery.isFetching;
  const boxBusy = suggestPosition.isPending || createBox.isPending || conferenceBusy;
  function choosePutawayMode(mode: "suggested" | "manual") {
    suggestionGeneration.current += 1;
    setPutawayMode(mode);
    setManualSuggestion(undefined);
    setPreviewError(undefined);
    setRefusing(false);
  }

  function previewManualPosition(code: string) {
    setManualLocation(code);
    setManualSuggestion(undefined);
    setPreviewError(undefined);
    suggestionGeneration.current += 1;
    if (!boxPayload || !eligiblePositions.some((position) => position.code === code)) return;
    suggestPosition.mutate({
      exclude: excluded, generation: suggestionGeneration.current,
      contextKey: slottingContextKey, location_id: code,
    });
  }

  function confirmPosition(candidate: SlottingCandidate) {
    if (!activeSuggestion || boxBusy) return;
    if (putawayMode === "manual" && candidate.code !== manualLocation) return;
    if (currentBox) storeConference.mutate(candidate);
    else createBox.mutate({ candidate });
  }
  const reviewLines = currentBox?.status === "stored" ? sessionLines.filter((line) => line.box_code === currentBox.code) : conferenceLines;

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden rounded-lg border-border/80 bg-card">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <PackageOpen className="size-5" />
              </div>
              <div>
                <CardTitle>Inventário de abertura</CardTitle>
                <CardDescription className="mt-1">
                  Separe os produtos na caixa de destino, conte, revise e confirme onde guardar.
                </CardDescription>
              </div>
            </div>
            {session?.status === "not_started" ? (
              <Button
                type="button"
                onClick={() => startSession.mutate()}
                disabled={startSession.isPending}
              >
                {startSession.isPending ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <PlayCircle data-icon="inline-start" />
                )}
                Iniciar contagem
              </Button>
            ) : (
              <Badge
                variant="outline"
                className={cn(
                  "w-fit",
                  sessionOpen
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-card",
                )}
              >
                {sessionOpen ? "sessão em andamento" : "sessão concluída"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {sessionQuery.isLoading ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : sessionQuery.isError ? (
            <Alert variant="destructive" className="bg-destructive/10">
              <AlertCircle className="size-4" />
              <AlertTitle>Não foi possível carregar o inventário</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-3">
                <span>{getErrorMessage(sessionQuery.error)}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => sessionQuery.refetch()}
                >
                  <RefreshCw data-icon="inline-start" />
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          ) : !sessionOpen ? (
            <Empty className="min-h-72 rounded-lg border border-dashed border-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardCheck className="size-5" />
                </EmptyMedia>
                <EmptyTitle>
                  {session?.status === "completed"
                    ? "Inventário de abertura encerrado"
                    : "Inicie a sessão para conferir a primeira caixa"}
                </EmptyTitle>
                <EmptyDescription>
                  {session?.status === "completed"
                    ? "Novas entradas agora devem ser feitas pelo fluxo de Recebimento."
                    : "A sessão cria a trilha de auditoria para todas as contagens iniciais."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-6">
              {!currentBox && !legacyBoxMode ? (
                <div className="space-y-4 rounded-lg border border-border p-5">
                  <h3 className="text-lg font-semibold">Nova caixa de destino</h3>
                  <p className="text-sm text-muted-foreground">Separe aqui os produtos que ficarão juntos. Modelos e tamanhos continuam identificados por seus próprios códigos.</p>
                  <Button type="button" onClick={() => createConference.mutate()} disabled={boxBusy}>
                    {createConference.isPending ? <RefreshCw data-icon="inline-start" className="animate-spin" /> : <Boxes data-icon="inline-start" />}
                    Iniciar conferência da caixa
                  </Button>
                  <div className="border-t border-border pt-3">
                    <Button type="button" variant="outline" onClick={() => setLegacyBoxMode(true)} disabled={boxBusy}>Cadastrar caixa já armazenada</Button>
                    <p className="mt-2 text-sm text-muted-foreground">Para corrigir o vínculo de lançamentos que já foram feitos.</p>
                  </div>
                </div>
              ) : null}
              {currentBox ? (
                <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">Caixa de destino {currentBox.code}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{conferenceStatusLabel(currentBox)}{currentBox.location_id ? ` · ${currentBox.location_id}` : ""}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatNumber(isConferencePending(currentBox) ? currentBox.draft_line_count : currentBox.line_count)} linhas · {formatNumber(isConferencePending(currentBox) ? currentBox.draft_unit_count : currentBox.unit_count)} un.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {currentBox.status === "stored" ? <Button type="button" variant="outline" onClick={() => navigate(labelsUrl({ boxes: [currentBox.code] }))} disabled={conferenceBusy}><Printer data-icon="inline-start" />Imprimir etiqueta</Button> : null}
                      <Button type="button" variant="outline" onClick={() => requestBoxSelection()} disabled={conferenceBusy || photoUploading}>Trocar caixa</Button>
                      {currentBox.status === "stored" ? (
                        <Button type="button" variant="outline" disabled={conferenceBusy || photoUploading || formDirty}
                          onClick={() => currentBox.opening_closed ? changeConferenceState.mutate("reopen") : setReviewBoxOpen(true)}>
                          {currentBox.opening_closed ? "Reabrir para ajustar" : "Revisar e fechar caixa"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {conferenceQuery.isError ? <Alert variant="destructive"><AlertTitle>Não consegui carregar a conferência</AlertTitle><AlertDescription><Button type="button" variant="outline" onClick={() => conferenceQuery.refetch()}>Tentar novamente</Button></AlertDescription></Alert> : null}
                  {currentBox.status === "stored" && currentBox.opening_closed ? <p className="text-sm">Caixa fechada. Para continuar contando, inicie a próxima caixa.</p> : null}
                </div>
              ) : null}
              {currentBox && isConferencePending(currentBox) && conferenceQuery.isSuccess ? (
                <OpeningConferenceSummary
                  box={currentBox}
                  lines={conferenceLines}
                  busy={conferenceBusy || photoUploading || formDirty}
                  onEdit={editConferenceLine}
                  onRemove={setDraftToRemove}
                  onReview={() => setReviewBoxOpen(true)}
                  onReopen={() => changeConferenceState.mutate("reopen")}
                  onResume={() => resumeConference.mutate()}
                />
              ) : null}
              {currentBox?.status === "committing" && conferenceLines.every((line) => line.status === "pending" || line.status === "failed") ? (
                <Button type="button" variant="outline" onClick={() => changeConferenceState.mutate("release")} disabled={conferenceBusy || formDirty}>Voltar à conferência</Button>
              ) : null}
              {((!currentBox && legacyBoxMode) || currentBox?.status === "reviewed") ? (
                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
                      <Boxes className="size-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{currentBox ? `Guardar caixa ${currentBox.code}` : "Cadastrar caixa já armazenada"}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Meça a caixa fechada. Confirme a orientação e a posição física antes de guardar.
                      </p>
                      {!currentBox ? <Button type="button" variant="ghost" onClick={() => setLegacyBoxMode(false)} disabled={boxBusy}>Voltar à nova conferência</Button> : null}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="box-length">Comprimento (cm)</Label>
                      <Input id="box-length" inputMode="decimal" value={boxDraft.length_cm} onChange={(event) => updateBoxDraft("length_cm", event.target.value)} placeholder="50" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="box-width">Largura (cm)</Label>
                      <Input id="box-width" inputMode="decimal" value={boxDraft.width_cm} onChange={(event) => updateBoxDraft("width_cm", event.target.value)} placeholder="50" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="box-height">Altura (cm)</Label>
                      <Input id="box-height" inputMode="decimal" value={boxDraft.height_cm} onChange={(event) => updateBoxDraft("height_cm", event.target.value)} placeholder="35" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="box-weight">Peso (kg)</Label>
                      <Input id="box-weight" inputMode="decimal" value={boxDraft.weight_kg} onChange={(event) => updateBoxDraft("weight_kg", event.target.value)} placeholder="Opcional" />
                    </div>
                  </div>
                  {boxPayload ? <p className="text-sm text-muted-foreground">Volume da caixa: {formatVolumeM3(boxVolumeM3(boxPayload))}</p> : null}
                  {!currentBox ? <div className="space-y-2">
                    <Label htmlFor="box-content">Produto de referência para a posição (opcional)</Label>
                    <Input id="box-content" value={boxDraft.content} onChange={(event) => updateBoxDraft("content", event.target.value)} placeholder="Cód. cliente ou SKU; separe por vírgula" />
                    <p className="text-xs text-muted-foreground">
                      Informe um código já cadastrado para priorizar a posição desse produto.
                    </p>
                  </div> : <p className="text-sm text-muted-foreground">{conferenceLines.length} linhas conferidas. A sugestão usa os produtos identificados nesta caixa.</p>}

                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Checkbox id="box-allow-tilt" checked={allowTilt} disabled={boxBusy} onCheckedChange={(checked) => {
                      setAllowTilt(checked === true); suggestionGeneration.current += 1; setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined); setExcluded([]); setRefusal(undefined);
                    }} />
                    <Label htmlFor="box-allow-tilt" className="leading-6">Pode virar esta caixa de lado</Label>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Checkbox id="box-allow-stacking" checked={allowStacking} disabled={boxBusy} onCheckedChange={(checked) => {
                      setAllowStacking(checked === true); suggestionGeneration.current += 1; setSuggestion(undefined); setManualSuggestion(undefined); setPreviewError(undefined); setExcluded([]); setRefusal(undefined);
                    }} />
                    <Label htmlFor="box-allow-stacking" className="leading-6">Pode empilhar esta caixa sobre outra que suporte seu peso</Label>
                  </div>
                  <div className="@container space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Guardar em</div>
                    <div className="grid gap-2 @sm:grid-cols-2" role="group" aria-label="Escolha da prateleira">
                      <Button type="button" variant={putawayMode === "suggested" ? "default" : "outline"} aria-pressed={putawayMode === "suggested"}
                        onClick={() => choosePutawayMode("suggested")} disabled={boxBusy}>
                        Sugestão do sistema
                      </Button>
                      <Button type="button" variant={putawayMode === "manual" ? "default" : "outline"} aria-pressed={putawayMode === "manual"}
                        onClick={() => choosePutawayMode("manual")} disabled={boxBusy}>
                        Escolher prateleira
                      </Button>
                    </div>
                    {putawayMode === "manual" ? (
                      <div className="space-y-3">
                        {automaticSuggestion?.position ? <p className="text-sm text-muted-foreground">Sugestão atual: {automaticSuggestion.position.code}</p> : null}
                        {positionsQuery.isError ? (
                          <Alert variant="destructive">
                            <AlertTitle>Não consegui carregar as prateleiras</AlertTitle>
                            <AlertDescription>
                              <Button type="button" variant="outline" onClick={() => positionsQuery.refetch()}>Tentar novamente</Button>
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <ShelfPicker
                            positions={eligiblePositions}
                            value={manualLocation}
                            onSelect={previewManualPosition}
                            disabled={!boxPayload || boxBusy || positionsQuery.isFetching}
                            loading={positionsQuery.isLoading}
                          />
                        )}
                      </div>
                    ) : null}
                    {previewError ? (
                      <Alert variant="destructive">
                        <AlertTitle>{putawayMode === "manual" ? "Prateleira não validada" : "Não consegui consultar a posição"}</AlertTitle>
                        <AlertDescription>{previewError}</AlertDescription>
                      </Alert>
                    ) : null}
                    {suggestPosition.isPending ? (
                      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="size-4 animate-spin" />
                        {putawayMode === "manual" ? "Conferindo o encaixe nesta prateleira…" : "Consultando a sugestão…"}
                      </div>
                    ) : null}
                    {activePosition && positionsQuery.isSuccess && !positionsQuery.isFetching && boxesQuery.isSuccess && !boxesQuery.isFetching ? (
                      <ShelfVolumeSummary position={activePosition} boxes={storedBoxes} incomingBox={boxPayload ?? undefined} unconfirmed={sessionOpen} />
                    ) : null}
                    {activeSuggestion?.position ? (
                      <>
                        <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                              <MapPin className="size-5 shrink-0 text-primary" />
                              {activeSuggestion.position.code}
                            </div>
                            {putawayMode === "suggested" ? <p className="mt-1 text-sm text-muted-foreground">{activeSuggestion.position.reason}</p> : null}
                            {activeSuggestion.position.model_fit === false ? (
                              <p className="mt-2 text-sm text-muted-foreground">O cálculo não confirmou o encaixe. A posição escolhida fica registrada.</p>
                            ) : (
                              <p className="mt-2 text-sm font-medium">{formatBoxPlacement(activeSuggestion.position.placement)}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {putawayMode === "suggested" ? <Badge variant="outline">{tierLabel(activeSuggestion.position.tier)}</Badge> : null}
                              {refusal ? <Badge variant="outline">{refusal.position} recusada</Badge> : null}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 @sm:items-end">
                            <Button type="button" onClick={() => confirmPosition(activeSuggestion.position!)} disabled={boxBusy}>
                              {createBox.isPending || storeConference.isPending ? <RefreshCw data-icon="inline-start" className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
                              Confirmar guarda em {activeSuggestion.position.code}
                            </Button>
                            {putawayMode === "suggested" ? (
                              <Button type="button" variant="outline" onClick={() => setRefusing((current) => !current)} disabled={boxBusy}>
                                Não cabe aqui
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {putawayMode === "suggested" && activeSuggestion.alternatives.length ? (
                          <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3 text-xs text-muted-foreground">
                            <span>Se preferir:</span>
                            {activeSuggestion.alternatives.map((alternative) => (
                              <Button key={alternative.code} type="button" size="sm" variant="outline" className="h-auto flex-col items-start py-2"
                                title={`${alternative.reason} ${formatBoxPlacement(alternative.placement)}`}
                                onClick={() => confirmPosition(alternative)} disabled={boxBusy}>
                                <span>Guardar em {alternative.code}</span>
                                <span className="text-xs font-normal">{formatBoxPlacement(alternative.placement)}</span>
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        {putawayMode === "suggested" && refusing ? (
                          <div className="space-y-2 border-t border-primary/10 pt-3">
                            <Label htmlFor="box-refusal">Por que {activeSuggestion.position.code} não serve?</Label>
                            <Textarea id="box-refusal" rows={2} value={refusalReason} onChange={(event) => setRefusalReason(event.target.value)}
                              placeholder="Ex.: prateleira ocupada por material fora do sistema" />
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" onClick={refuseSuggestedPosition} disabled={!refusalReason.trim() || boxBusy}>Pedir outra posição</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setRefusing(false)} disabled={boxBusy}>Cancelar</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">A recusa vale para esta caixa e fica registrada com o motivo.</p>
                          </div>
                        ) : null}
                      </>
                    ) : activeSuggestion ? (
                      <Alert variant="destructive" className="bg-destructive/10">
                        <AlertTriangle className="size-4" />
                        <AlertTitle>Nenhuma prateleira serve para esta caixa</AlertTitle>
                        <AlertDescription>
                          {activeSuggestion.rejected}
                          {activeSuggestion.checked > 0 ? " Escolha a prateleira onde a caixa está." : ""}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {!activeSuggestion?.position && !suggestPosition.isPending ? (
                      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          {boxPayload ? formatBoxDimensions(boxPayload) : "Informe os três lados para conferir a posição."}
                        </p>
                        <Button type="button" variant="outline"
                          onClick={() => putawayMode === "manual" ? previewManualPosition(manualLocation)
                            : suggestPosition.mutate({ exclude: excluded, generation: suggestionGeneration.current, contextKey: slottingContextKey })}
                          disabled={!boxPayload || boxBusy || (putawayMode === "manual" && (!positionsQuery.isSuccess || !eligiblePositions.some((position) => position.code === manualLocation)))}>
                          <MapPin data-icon="inline-start" />
                          {putawayMode === "manual" ? "Conferir prateleira" : "Onde guardar?"}
                        </Button>
                      </div>
                    ) : null}
                    {putawayMode === "suggested" && activeSuggestion ? (
                      <div className="text-xs text-muted-foreground">{formatNumber(activeSuggestion.checked)} prateleira(s) da zona conferidas.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {currentBox && canEnterProduct ? (
                <form
                  className="space-y-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSubmit && !recordOpeningLine.isPending) {
                      recordOpeningLine.mutate();
                    }
                  }}
                >
                  <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.5fr]">
                    <div className="space-y-2">
                      <Label htmlFor="opening-client-code">Cód. cliente</Label>
                      <Input
                        id="opening-client-code"
                        value={clientCode}
                        onChange={(event) => {
                          setClientCode(event.target.value);
                          setCreateNew(false);
                          setSelectedProduct(undefined);
                        }}
                        placeholder="Também acha por SKU ou cód. de barras"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="opening-sku">SKU</Label>
                      {/* O SKU não se digita: é o do cadastro achado ou o gerado ao salvar. */}
                      <Input
                        id="opening-sku"
                        value={selectedProduct?.skuCode ?? existingProduct?.skuCode ?? ""}
                        readOnly
                        tabIndex={-1}
                        className="bg-muted"
                        placeholder={
                          isDraftBox ? (skuPrefix ? `Gerado ao guardar (${skuPrefix}-…)` : "Gerado ao guardar a caixa") : (skuPrefix ? `Gerado ao salvar (${skuPrefix}-…)` : "Gerado ao salvar")
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="opening-product">Produto</Label>
                      <Input
                        id="opening-product"
                        value={productName}
                        onChange={(event) => setProductName(event.target.value)}
                        placeholder="Descrição clara do produto"
                      />
                    </div>
                  </div>

                  {lookupQuery.isLoading || lookupQuery.isFetching ? (
                    <Alert className="border-border bg-card">
                      <RefreshCw className="size-4 animate-spin" />
                      <AlertTitle>Verificando o catálogo</AlertTitle>
                      <AlertDescription>
                        Aguarde a confirmação antes de cadastrar o produto.
                      </AlertDescription>
                    </Alert>
                  ) : lookupQuery.isError ? (
                    <Alert variant="destructive" className="bg-destructive/10">
                      <AlertCircle className="size-4" />
                      <AlertTitle>Catálogo indisponível</AlertTitle>
                      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                          O cadastro de produto novo foi bloqueado para evitar duplicidade.
                        </span>
                        <Button type="button" variant="outline" onClick={() => lookupQuery.refetch()}>
                          <RefreshCw data-icon="inline-start" />
                          Tentar novamente
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : identityConflict ? (
                    <Alert variant="destructive" className="bg-destructive/10">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Códigos pertencem a cadastros diferentes</AlertTitle>
                      <AlertDescription>
                        {`O código ${clientCode.trim()} é de ${codeMatch?.product.productName ?? "um cadastro"} e o código de barras ${barcode.trim()} é de ${barcodeMatch?.productName ?? "outro"}. Revise os dois antes de continuar.`}
                      </AlertDescription>
                    </Alert>
                  ) : existingProduct && !existingProduct.hasSku ? (
                    <NewProductNotice
                      confirmed={createNew}
                      disabled={missingSkuPrefix}
                      title="Código sem SKU"
                      note={missingSkuPrefix
                        ? `Cadastre a sigla do SKU de ${activeCustomer.name} em Configurações › Clientes antes de cadastrar produto novo: o SKU é gerado com ela.`
                        : `O lançamento anterior foi cancelado e o cartão do produto ficou sem SKU. O Estoque lista o SKU, então o código some da busca. ${isDraftBox ? "SKU gerado ao guardar a caixa." : "SKU gerado ao salvar."}`}
                      onToggle={() => setCreateNew((current) => !current)}
                    />
                  ) : existingProduct ? (
                    <ProductIdentityCard
                      product={existingProduct}
                      matchLabel={existingMatchLabel}
                      selected={selectedProduct?.id === existingProduct.id}
                      onSelect={() => applyProduct(existingProduct)}
                    />
                  ) : hasIdentity && lookupQuery.isSuccess ? (
                    <NewProductNotice
                      confirmed={createNew}
                      disabled={missingSkuPrefix}
                      note={missingSkuPrefix
                        ? `Cadastre a sigla do SKU de ${activeCustomer.name} em Configurações › Clientes antes de cadastrar produto novo: o SKU é gerado com ela.`
                        : isDraftBox ? "SKU gerado ao guardar a caixa." : "SKU gerado ao salvar."}
                      onToggle={() => setCreateNew((current) => !current)}
                    />
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Categoria</Label>
                      <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Obrigatória para novo" />
                    </div>
                    <div className="space-y-2">
                      <Label>Gênero</Label>
                      <Select value={genero || undefined} onValueChange={setGenero}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o gênero" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATALOG_GENEROS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Grupo</Label>
                      <Select value={grupo || undefined} onValueChange={setGrupo}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o grupo" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATALOG_GRUPOS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Marca</Label>
                      <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Marca" />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Tamanho</Label>
                      <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="Tamanho" />
                    </div>
                    <div className="space-y-2">
                      <Label>Cor</Label>
                      <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="Cor" />
                    </div>
                    <div className="space-y-2">
                      <Label>Código de barras</Label>
                      <Input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Opcional" />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="opening-position">Posição da caixa</Label>
                      <Input id="opening-position" value={`${currentBox.location_id || "A definir após conferência"} · ${currentBox.code}`} readOnly className="bg-muted" />
                    </div>
                    <div className="space-y-2">
                      <Label>Contagem física</Label>
                      <Input value={countedQty} onChange={(event) => setCountedQty(event.target.value)} type="number" min="0" step="1" placeholder="0" />
                    </div>
                    <div className="space-y-2">
                      <Label>Custo unitário</Label>
                      <Input value={unitCost} onChange={(event) => setUnitCost(event.target.value)} type="number" min="0" step="0.01" placeholder="R$ 0,00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Referência</Label>
                      <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Etiqueta, lote ou observação" />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Fotos do produto</div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Use a câmera do celular ou anexe imagens existentes.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        disabled={photoUploading}
                        onClick={() => photoInputRef.current?.click()}
                      >
                        {photoUploading ? <RefreshCw className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                        {photoUploading ? "Enviando..." : "Adicionar foto"}
                      </Button>
                      {/* Fora do layout e do foco: ativar um input sr-only pode deslocar os painéis com overflow. */}
                      <input
                        ref={photoInputRef}
                        id="opening-product-photo"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        hidden
                        disabled={photoUploading}
                        onChange={(event) => {
                          void addOpeningPhotos(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                    {photos.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {photos.map((photo, index) => (
                          <div key={photo.storagePath} className="relative size-24 overflow-hidden rounded-md border border-border bg-muted">
                            <img src={photo.fileUrl} alt={`Foto ${index + 1} do produto`} className="size-full object-cover" />
                            <button type="button" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-card" aria-label={`Remover foto ${index + 1}`} onClick={() => setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                        Produto novo precisa de ao menos uma foto.
                      </div>
                    )}
                    {photos.length ? <div className="mt-3">
                      <ProductPhotoStudio key={`${customerCode}:${clientCode}`} photos={photos} customerCode={customerCode} productName={productName} category={category} context={{ description: productName, gender: genero, group: grupo, size, color, brand }} disabled={photoUploading || recordOpeningLine.isPending}
                        onApprove={(generated, primaryUrl) => setPhotos((current) => {
                          const merged = [...current, ...generated];
                          return primaryUrl ? [...merged.filter((photo) => photo.fileUrl === primaryUrl), ...merged.filter((photo) => photo.fileUrl !== primaryUrl)] : merged;
                        })} />
                    </div> : null}
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <Checkbox
                      id="opening-confirm-box"
                      checked={boxAcknowledged}
                      onCheckedChange={(checked) => setBoxAcknowledged(checked === true)}
                      disabled={recordOpeningLine.isPending}
                    />
                    <Label htmlFor="opening-confirm-box" className="text-base leading-6">
                      {isDraftBox ? "Confirmo: este produto está na caixa de destino " : "Conferi a etiqueta: este produto está na caixa "}{currentBox.code}{currentBox.location_id ? ` · ${currentBox.location_id}` : ""}
                    </Label>
                  </div>
                  <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {isDraftBox ? "A contagem fica salva nesta caixa. O estoque será publicado ao confirmar a guarda." : `A contagem será publicada na caixa ${currentBox.code}, posição ${currentBox.location_id}.`}
                    </p>
                    <Button type="submit" disabled={!canSubmit || recordOpeningLine.isPending}>
                      {recordOpeningLine.isPending ? <RefreshCw data-icon="inline-start" className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
                      {editingDraft ? "Salvar correção" : isDraftBox ? "Salvar na conferência" : `Confirmar em ${currentBox.code}`}
                    </Button>
                  </div>
                  {formDirty ? <Button type="button" variant="outline" onClick={resetProductForm} disabled={conferenceBusy || photoUploading}>{editingDraft ? "Cancelar edição" : "Limpar campos"}</Button> : null}
                </form>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card className="min-w-0 rounded-lg border-border/80 bg-card">
          <CardHeader>
            <CardTitle className="text-base">Progresso da abertura</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Lançamentos publicados</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(session?.line_count)}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Unidades publicadas</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(session?.unit_count)}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Caixas</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(boxesOfSession.length)}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-3" title="Prateleiras com ao menos uma caixa guardada: a base da cobrança por posição.">
                <div className="text-xs text-muted-foreground">Posições ocupadas</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(occupied)}</div>
              </div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Valor controlado</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{formatCurrency(coerceNumber(session?.total_cost))}</div>
            </div>
            {pendingBoxes.length ? <Alert><AlertTitle>{pendingBoxes.length} caixa(s) por concluir</AlertTitle><AlertDescription>Conclua a guarda ou remova as caixas vazias antes de encerrar o inventário.</AlertDescription></Alert> : null}
            {sessionOpen ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={
                  !session?.line_count ||
                  pendingBoxes.length > 0 || boxesQuery.isLoading || boxesQuery.isError || conferenceBusy ||
                  completeSession.isPending ||
                  removeOpeningLine.isPending
                }
                onClick={() => setCompleteDialogOpen(true)}
              >
                <CheckCircle2 data-icon="inline-start" />
                Concluir inventário
              </Button>
            ) : null}

            <div className="border-t border-border/70 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Caixas desta sessão
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Selecione a caixa pela etiqueta física.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {boxesOfSession.length ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(labelsUrl({ boxes: boxesOfSession.filter((box) => box.status === "stored").map((box) => box.code) }))}
                      disabled={!boxesOfSession.some((box) => box.status === "stored")}
                      title="Etiquetas das caixas guardadas desta sessão, dez por folha A4"
                    >
                      <Printer data-icon="inline-start" />
                      Etiquetas
                    </Button>
                  ) : null}
                  <Badge variant="outline">{formatNumber(boxesOfSession.length)}</Badge>
                </div>
              </div>
              {boxesQuery.isError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Não consegui carregar as caixas: {getErrorMessage(boxesQuery.error)}
                </div>
              ) : boxesOfSession.length ? (
                <div
                  role="region"
                  aria-label="Caixas desta sessão"
                  tabIndex={0}
                  className="h-[220px] min-w-0 overflow-y-auto pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <div className="space-y-2">
                    {boxesOfSession.map((box) => {
                      const open = currentBox?.code === box.code;
                      return (
                        <div
                          key={box.code}
                          className={cn(
                            "min-w-0 space-y-3 rounded-md border p-3",
                            open ? "border-primary/40 bg-primary/5" : "border-border bg-card",
                          )}
                        >
                          <div className="min-w-0 [overflow-wrap:anywhere]">
                            <div className="text-sm font-medium text-foreground">
                              {box.code} <span className="text-muted-foreground">· {box.location_id}</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{conferenceStatusLabel(box)}</div>
                            {box.length_m > 0 ? <div className="mt-1 text-xs text-muted-foreground">{formatBoxDimensions(box)}</div> : null}
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatNumber(isConferencePending(box) ? box.draft_line_count : box.line_count)} linhas · {formatNumber(isConferencePending(box) ? box.draft_unit_count : box.unit_count)} un.
                            </div>
                          </div>
                          {sessionOpen ? (
                            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                              <Button
                                type="button"
                                size="sm"
                                variant={open ? "default" : "outline"}
                                className="flex-1"
                                onClick={() => requestBoxSelection(box)}
                                disabled={open || conferenceBusy || photoUploading}
                              >
                                {open ? "Selecionada" : "Abrir"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground"
                                onClick={() => navigate(labelsUrl({ boxes: [box.code] }))}
                                disabled={box.status !== "stored"}
                                aria-label={`Imprimir etiqueta da caixa ${box.code}`}
                                title="Imprimir etiqueta"
                              >
                                <Printer className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => setBoxToRemove(box)}
                                disabled={box.line_count > 0 || (box.draft_line_count ?? 0) > 0 || box.status === "committing" || removeBox.isPending || conferenceBusy || (open && formDirty)}
                                aria-label={`Remover caixa ${box.code}`}
                                title={box.line_count > 0 || (box.draft_line_count ?? 0) > 0 ? "Remova ou corrija os itens antes de excluir a caixa" : "Remover caixa vazia"}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                  Nenhuma caixa nesta sessão.
                </div>
              )}
            </div>

            <div className="border-t border-border/70 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Linhas conferidas
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Revise antes de encerrar a abertura.
                  </div>
                </div>
                <Badge variant="outline">{formatNumber(visibleLines.length)}</Badge>
              </div>

              <Select value={lineBoxFilter} onValueChange={setLineBoxFilter}>
                <SelectTrigger className="mb-3" aria-label="Filtrar lançamentos por caixa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as caixas</SelectItem>
                  {boxesOfSession.map((box) => <SelectItem key={box.code} value={box.code}>{box.code} · {box.location_id}</SelectItem>)}
                </SelectContent>
              </Select>
              {visibleLines.length ? (
                <div
                  role="region"
                  aria-label="Lançamentos conferidos"
                  tabIndex={0}
                  className="h-[300px] min-w-0 overflow-y-auto pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <div className="space-y-2">
                    {visibleLines.map((line) => (
                      <div
                        key={line.id}
                        className="min-w-0 space-y-3 rounded-md border border-border bg-card p-3"
                      >
                        <div className="min-w-0 [overflow-wrap:anywhere]">
                          <div className="text-sm font-medium leading-snug text-foreground">
                            {line.product_name || line.client_item_code || line.sku_code}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {line.client_item_code || "Sem cód. cliente"}
                            {line.sku_code ? ` · ${line.sku_code}` : ""}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatNumber(line.counted_qty)} un.</span>
                            <span>{line.location_id || "Sem endereço"}</span>
                            {line.box_code ? <span>{line.box_code}</span> : null}
                            <span>
                              {formatCurrency(
                                coerceNumber(line.total_cost) ||
                                  coerceNumber(line.counted_qty) *
                                    coerceNumber(line.unit_cost),
                              )}
                            </span>
                          </div>
                        </div>
                        {sessionOpen ? (
                          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                            {line.box_code ? (
                              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setLineToMove(line)} disabled={removeOpeningLine.isPending}>
                                Corrigir caixa
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setLineToRemove(line)}
                              disabled={removeOpeningLine.isPending}
                              aria-label={`Remover ${line.product_name || line.client_item_code || line.sku_code}`}
                              title="Remover para corrigir"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                  Nenhum lançamento neste filtro.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Alert className="border-primary/20 bg-primary/5">
          <Sparkles className="size-4 text-primary" />
          <AlertTitle>Agent Dute acompanha a abertura</AlertTitle>
          <AlertDescription>
            Conferências, correções e guardas ficam registradas com o responsável.
          </AlertDescription>
        </Alert>
      </div>

      <Dialog open={Boolean(pendingBoxSelection)} onOpenChange={(open) => { if (!open) setPendingBoxSelection(undefined); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Trocar de caixa?</DialogTitle><DialogDescription>Há um produto preenchido que ainda não foi salvo. Os itens já salvos na conferência serão mantidos.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingBoxSelection(undefined)}>Continuar preenchendo</Button>
            <Button type="button" onClick={() => { activateBox(pendingBoxSelection?.box); setPendingBoxSelection(undefined); }}>Descartar preenchimento e trocar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewBoxOpen} onOpenChange={(open) => { if (!changeConferenceState.isPending) setReviewBoxOpen(open); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Conferir e fechar {currentBox?.code}</DialogTitle>
            <DialogDescription>Confira este resumo com o conteúdo da caixa física antes de fechar.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {reviewLines.map((line) => <div key={line.id} className="flex justify-between gap-3 rounded-md border border-border p-3">
                <span>{line.product_name || line.client_item_code || line.sku_code}<span className="block text-sm text-muted-foreground">{line.client_item_code} · {line.sku_code || "SKU ao guardar"}</span></span>
                <span className="whitespace-nowrap font-semibold">{formatNumber(line.counted_qty)} un.</span>
              </div>)}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewBoxOpen(false)} disabled={conferenceBusy}>Voltar à contagem</Button>
            <Button type="button" onClick={() => changeConferenceState.mutate("review")} disabled={conferenceBusy || !reviewLines.length}>Conferido, fechar caixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(draftToRemove)} onOpenChange={(open) => { if (!open && !removeConferenceLine.isPending) setDraftToRemove(undefined); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remover item da conferência?</DialogTitle><DialogDescription>{draftToRemove?.product_name || draftToRemove?.client_item_code} · {formatNumber(draftToRemove?.counted_qty)} un. Este rascunho ainda não foi publicado no estoque.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraftToRemove(undefined)} disabled={removeConferenceLine.isPending}>Manter</Button>
            <Button type="button" variant="destructive" onClick={() => { if (draftToRemove) removeConferenceLine.mutate(draftToRemove); }} disabled={removeConferenceLine.isPending}>Remover rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lineToMove && session?.session_id ? (
        <OpeningLineCorrection
          key={lineToMove.id}
          line={lineToMove}
          lines={sessionLines}
          boxes={boxesOfSession}
          sessionId={session.session_id}
          customerCode={customerCode}
          onClose={() => setLineToMove(undefined)}
        />
      ) : null}

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Concluir o inventário de abertura?</DialogTitle>
            <DialogDescription>
              Confirme somente depois que todos os produtos físicos tiverem sido
              contados. Esta sessão será encerrada e as próximas entradas deverão
              ser feitas em WMS &gt; Recebimento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Produtos</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {formatNumber(session?.line_count)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Unidades</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {formatNumber(session?.unit_count)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Caixas</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {formatNumber(boxesOfSession.length)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompleteDialogOpen(false)}
              disabled={completeSession.isPending}
            >
              Continuar contando
            </Button>
            <Button
              type="button"
              onClick={() => completeSession.mutate()}
              disabled={
                !session?.line_count ||
                  pendingBoxes.length > 0 || boxesQuery.isLoading || boxesQuery.isError || conferenceBusy ||
                completeSession.isPending ||
                removeOpeningLine.isPending
              }
            >
              {completeSession.isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckCircle2 data-icon="inline-start" />
              )}
              Confirmar encerramento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(lineToRemove)}
        onOpenChange={(open) => {
          if (!open && !removeOpeningLine.isPending) setLineToRemove(undefined);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Remover esta linha para corrigir?</DialogTitle>
            <DialogDescription>
              O saldo lançado será estornado com registro permanente no ledger.
              Depois, você poderá contar e lançar o produto novamente com os dados corretos.
            </DialogDescription>
          </DialogHeader>
          {lineToRemove ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="font-medium text-foreground">
                {lineToRemove.product_name ||
                  lineToRemove.client_item_code ||
                  lineToRemove.sku_code}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {lineToRemove.client_item_code || "Sem cód. cliente"}
                {lineToRemove.sku_code ? ` · ${lineToRemove.sku_code}` : ""}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {formatNumber(lineToRemove.counted_qty)} unidade(s)
                </Badge>
                <Badge variant="outline">
                  {lineToRemove.location_id || "Sem endereço"}
                </Badge>
                {lineToRemove.box_code ? (
                  <Badge variant="outline">{lineToRemove.box_code}</Badge>
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLineToRemove(undefined)}
              disabled={removeOpeningLine.isPending}
            >
              Manter linha
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (lineToRemove) removeOpeningLine.mutate(lineToRemove);
              }}
              disabled={!lineToRemove || removeOpeningLine.isPending}
            >
              {removeOpeningLine.isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              Remover para corrigir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(boxToRemove)}
        onOpenChange={(open) => {
          if (!open && !removeBox.isPending) setBoxToRemove(undefined);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Remover a caixa {boxToRemove?.code}?</DialogTitle>
            <DialogDescription>
              Só caixa vazia pode ser removida. A posição {boxToRemove?.location_id} volta a ter o espaço dela livre e a remoção fica registrada na timeline.
            </DialogDescription>
          </DialogHeader>
          {boxToRemove ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {formatBoxDimensions(boxToRemove)} · {formatNumber(boxToRemove.line_count)} produto(s)
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBoxToRemove(undefined)}
              disabled={removeBox.isPending}
            >
              Manter caixa
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (boxToRemove) removeBox.mutate(boxToRemove);
              }}
              disabled={!boxToRemove || removeBox.isPending}
            >
              {removeBox.isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              Remover caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExistingCycleCountWorkspace() {
  const { code: customerCode } = useActiveCustomer();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clientCode, setClientCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [productName, setProductName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const lookupQuery = useQuery({
    queryKey: ["cycle-count-product-lookup", customerCode],
    staleTime: 60_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      const skus = customerRows(normalizeApiRows(skusPayload), customerCode).map(productLookupFromRecord);
      const products = customerRows(normalizeApiRows(productsPayload), customerCode).map(productLookupFromRecord);
      return mergeProductLookup(skus, products);
    },
  });

  const lookupProducts = lookupQuery.data ?? [];
  const draftLine = useMemo<ReceiptDraftLine>(
    () => ({
      sku: skuCode,
      clientCode,
      product: productName,
      category: "",
      barcode: "",
      brand: "",
      size: "",
      color: "",
      photos: [],
      photoUploading: false,
      quantity: countedQty || "0",
      unitCost,
      location: locationId,
      createNew: false,
    }),
    [clientCode, countedQty, locationId, productName, skuCode, unitCost],
  );
  const existingProduct = useMemo(
    () => findExistingProduct(draftLine, lookupProducts),
    [draftLine, lookupProducts],
  );
  const parsedCount = Number(countedQty);
  const hasCount = countedQty.trim() !== "" && Number.isFinite(parsedCount);
  const canSubmit =
    Boolean(existingProduct) &&
    Boolean(locationId.trim()) &&
    hasCount &&
    parsedCount >= 0 &&
    reason.trim().length >= 3;

  const cycleCount = useMutation<CycleCountResult, Error>({
    mutationFn: () =>
      fetchJson<CycleCountResult>("/api/warehouse/cycle-counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_code: customerCode,
          sku_code: existingProduct?.skuCode || skuCode.trim(),
          client_item_code: existingProduct?.clientCode || clientCode.trim(),
          product_name: existingProduct?.productName || productName.trim(),
          location_id: locationId.trim(),
          counted_qty: parsedCount,
          unit_cost: unitCost.trim()
            ? Number(unitCost)
            : existingProduct?.unitCost || undefined,
          reason: reason.trim(),
          reference: reference.trim() || undefined,
          occurred_at: new Date().toISOString(),
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title:
          result.adjustment_delta === 0
            ? "Contagem registrada"
            : "Estoque ajustado",
        description:
          result.adjustment_delta === 0
            ? "A contagem não encontrou divergência física."
            : `Diferença registrada: ${formatDeltaUnits(result.adjustment_delta)}.`,
      });
      setCountedQty("");
      setReason("");
      setReference("");
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a contagem",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  function applyProduct(product: ProductLookupItem) {
    setClientCode(product.clientCode);
    setSkuCode(product.skuCode);
    setProductName(product.productName);
    setUnitCost(product.unitCost > 0 ? String(product.unitCost) : "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || cycleCount.isPending) return;
    cycleCount.mutate();
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden rounded-lg border-border/80 bg-card">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Registrar contagem</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Conte um item num endereço; a diferença vira ajuste com evento.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">
              ajuste auditado
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.4fr]">
              <div className="space-y-2">
                <Label htmlFor="cycle-client-code">Cód. cliente</Label>
                <Input
                  id="cycle-client-code"
                  value={clientCode}
                  onChange={(event) => setClientCode(event.target.value)}
                  placeholder="Ex.: C.0659.001.U"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-sku-code">SKU interno</Label>
                <Input
                  id="cycle-sku-code"
                  value={skuCode}
                  onChange={(event) => setSkuCode(event.target.value)}
                  placeholder="Ex.: BTG-000123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-product-name">Produto</Label>
                <Input
                  id="cycle-product-name"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="Nome do produto"
                />
              </div>
            </div>

            {existingProduct ? (
              <ProductIdentityCard product={existingProduct} onSelect={() => applyProduct(existingProduct)} />
            ) : clientCode.trim() || skuCode.trim() || productName.trim() ? (
              <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                <AlertTriangle className="size-4" />
                <AlertTitle>Produto ainda não localizado</AlertTitle>
                <AlertDescription>
                  A contagem ajusta apenas produtos já cadastrados e com saldo
                  físico criado. Se for produto novo, use Receber.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="cycle-location">Endereço contado</Label>
                <Input
                  id="cycle-location"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  placeholder="Rua / prateleira / caixa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-count">Contagem física</Label>
                <Input
                  id="cycle-count"
                  value={countedQty}
                  onChange={(event) => setCountedQty(event.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-unit-cost">Custo unitário</Label>
                <Input
                  id="cycle-unit-cost"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-reference">Referência</Label>
                <Input
                  id="cycle-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Auditoria, foto, inventário..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle-reason">Motivo do ajuste</Label>
              <Textarea
                id="cycle-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: contagem cíclica da rua A, divergência apurada na conferência física."
              />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Confirmação operacional
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  O saldo atual será lido no backend dentro da transação. Se a
                  contagem for menor que uma reserva ativa, o ajuste será bloqueado.
                </p>
              </div>
              <Button type="submit" disabled={!canSubmit || cycleCount.isPending}>
                {cycleCount.isPending ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <CheckCircle2 data-icon="inline-start" />
                )}
                Registrar contagem
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/80 bg-card">
          <CardHeader>
            <CardTitle className="text-base">Regra operacional</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border border-border bg-card p-3">
              <strong className="text-foreground">Produto novo</strong>
              <p className="mt-1">Use Receber para criar cadastro e conferência.</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <strong className="text-foreground">Divergência</strong>
              <p className="mt-1">A diferença gera movimento e evento para o Agent Dute.</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <strong className="text-foreground">Reserva ativa</strong>
              <p className="mt-1">O sistema bloqueia contagem menor que itens reservados.</p>
            </div>
          </CardContent>
        </Card>

        <Alert className="border-primary/20 bg-primary/5">
          <Sparkles className="size-4 text-primary" />
          <AlertTitle>Memória do Agent Dute</AlertTitle>
          <AlertDescription>
            Cada contagem vira evento operacional. Divergências aparecem como
            atenção para investigação e histórico do cliente.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

