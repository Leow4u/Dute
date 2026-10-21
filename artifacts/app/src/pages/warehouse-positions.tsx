import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Pencil, Plus, Printer, Rows3, Trash2, Users } from "lucide-react";
import { useLocation } from "wouter";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { zoneCustomers } from "@/lib/customer-registry";
import { normalizeProfileRole } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/warehouse-ops/model";
import { labelsUrl } from "@/lib/warehouse-labels";
import {
  POSITION_STATUS_LABELS,
  REFERENCE_BOX,
  aislesOf,
  boxCapacity,
  canEditPositions,
  formatCentimeters,
  formatKilos,
  formatMeters,
  parseDecimal,
  positionCode,
  sortPositions,
  summarizeZones,
  type PositionStatus,
  type WarehousePosition,
} from "@/lib/warehouse-positions";

/**
 * Estoque › Posições: o cadastro das prateleiras do galpão (mapa do armazém),
 * com medidas úteis, sequência de caminhada e zona por cliente. É a base do
 * endereçamento dirigido. O mapa inicial (ruas A, B e C, medidas de
 * 16/10/2026) vem do backend e só entra com o cadastro vazio; depois disso
 * tudo muda por aqui: editar prateleira, cadastrar rua nova, remover.
 */

type Customer = { id?: string; code?: string; name?: string; status?: string; sku_prefix?: string };
type PositionsResponse = { items?: WarehousePosition[] };
type SaveResult = { ok: true; created: string[]; updated: string[] };

const POSITIONS_KEY = ["warehouse-positions"];
const NO_CUSTOMER = "__sem_cliente__";
const ALL = "__todas__";
const INITIAL_LAYOUT_SIZE = 43;

type FormState = {
  aisle: string;
  shelf: string;
  length: string;
  depth: string;
  height: string;
  maxWeight: string;
  sequence: string;
  customer: string;
  status: PositionStatus;
  notes: string;
};

const EMPTY_FORM: FormState = {
  aisle: "",
  shelf: "",
  length: "",
  depth: "",
  height: "",
  maxWeight: "",
  sequence: "",
  customer: NO_CUSTOMER,
  status: "active",
  notes: "",
};

type AisleFormState = {
  aisle: string;
  shelves: string;
  length: string;
  depth: string;
  height: string;
  maxWeight: string;
  customer: string;
};

const EMPTY_AISLE_FORM: AisleFormState = {
  aisle: "",
  shelves: "",
  length: "1,80",
  depth: "0,75",
  height: "0,90",
  maxWeight: "",
  customer: NO_CUSTOMER,
};

function postJson<T>(url: string, body?: unknown) {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** fetchJson devolve o corpo do erro como texto; as Functions mandam { message }. */
function errorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (parsed?.message) return parsed.message;
  } catch {
    // texto puro
  }
  return raw || fallback;
}

function formFromPosition(position: WarehousePosition): FormState {
  return {
    aisle: position.aisle,
    shelf: String(position.shelf),
    length: String(position.length_m).replace(".", ","),
    depth: String(position.depth_m).replace(".", ","),
    height: String(position.height_m).replace(".", ","),
    maxWeight: position.max_weight_kg == null ? "" : String(position.max_weight_kg).replace(".", ","),
    sequence: position.sequence == null ? "" : String(position.sequence),
    customer: position.customer_code || NO_CUSTOMER,
    status: (position.status as PositionStatus) || "active",
    notes: position.notes ?? "",
  };
}

type PositionPayload = {
  aisle: string;
  shelf: number;
  length_m: number;
  depth_m: number;
  height_m: number;
  max_weight_kg: number | null;
  sequence?: number;
  customer_code: string | null;
  status: PositionStatus;
  notes: string | null;
};

function payloadFromForm(form: FormState): { payload?: PositionPayload; error?: string } {
  const aisle = form.aisle.trim().toUpperCase();
  const shelf = Number(form.shelf);
  const length = parseDecimal(form.length);
  const depth = parseDecimal(form.depth);
  const height = parseDecimal(form.height);
  if (!aisle) return { error: "Informe a rua." };
  if (!Number.isInteger(shelf) || shelf < 1) return { error: "Informe o número da prateleira." };
  if (!length || length <= 0 || !depth || depth <= 0 || !height || height <= 0) {
    return { error: "Informe comprimento, largura e altura em metros (ex.: 1,80)." };
  }
  const maxWeight = form.maxWeight.trim() ? parseDecimal(form.maxWeight) : null;
  if (form.maxWeight.trim() && (maxWeight == null || maxWeight < 0)) return { error: "Peso máximo inválido." };
  const sequence = form.sequence.trim() ? Number(form.sequence) : undefined;
  if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 1)) return { error: "Sequência inválida." };
  return {
    payload: {
      aisle,
      shelf,
      length_m: length,
      depth_m: depth,
      height_m: height,
      max_weight_kg: maxWeight,
      ...(sequence !== undefined ? { sequence } : {}),
      customer_code: form.customer === NO_CUSTOMER ? null : form.customer,
      status: form.status,
      notes: form.notes.trim() || null,
    },
  };
}

function payloadFromPosition(position: WarehousePosition, customerCode: string | null): PositionPayload {
  return {
    aisle: position.aisle,
    shelf: Number(position.shelf),
    length_m: position.length_m,
    depth_m: position.depth_m,
    height_m: position.height_m,
    max_weight_kg: position.max_weight_kg ?? null,
    ...(position.sequence != null ? { sequence: Number(position.sequence) } : {}),
    customer_code: customerCode,
    status: (position.status as PositionStatus) || "active",
    notes: position.notes ?? null,
  };
}

function statusBadge(status: string | undefined) {
  const key = (status as PositionStatus) || "active";
  const label = POSITION_STATUS_LABELS[key] ?? String(status ?? "ativa");
  const variant = key === "blocked" ? "destructive" : key === "review" ? "secondary" : "outline";
  return <Badge variant={variant}>{label}</Badge>;
}

function CapacityHint({ form }: { form: Pick<FormState, "length" | "depth" | "height"> }) {
  const length = parseDecimal(form.length) ?? 0;
  const depth = parseDecimal(form.depth) ?? 0;
  const height = parseDecimal(form.height) ?? 0;
  const capacity = boxCapacity({ length_m: length, depth_m: depth, height_m: height }, REFERENCE_BOX);
  const box = `${formatCentimeters(REFERENCE_BOX.length_m)} × ${formatCentimeters(REFERENCE_BOX.width_m)} × ${formatCentimeters(REFERENCE_BOX.height_m)} cm`;
  return (
    <p className="text-xs text-muted-foreground">
      {capacity.total > 0
        ? `Cabem ${capacity.total} caixas de ${box}: ${capacity.columns} na frente × ${capacity.rows} na profundidade × ${capacity.layers} na altura.`
        : `Com estas medidas não cabe nenhuma caixa de ${box}.`}
    </p>
  );
}

function CustomerSelect({
  id,
  value,
  onChange,
  customers,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  customers: Customer[];
}) {
  const known = customers.map((customer) => customer.code).filter((code): code is string => Boolean(code));
  const extra = value !== NO_CUSTOMER && !known.includes(value) ? [value] : [];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Sem cliente" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CUSTOMER}>Sem cliente (livre)</SelectItem>
        {[...known, ...extra].map((code) => (
          <SelectItem key={code} value={code}>
            {customers.find((customer) => customer.code === code)?.name || code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function WarehousePositionsPage() {
  const { user } = useAppUser();
  const canEdit = canEditPositions(normalizeProfileRole(user?.publicMetadata.role));
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const positionsQuery = useQuery<PositionsResponse>({
    queryKey: POSITIONS_KEY,
    queryFn: () => fetchJson<PositionsResponse>("/api/warehouse/positions?limit=2000"),
  });
  const customersQuery = useQuery<{ items?: Customer[] }>({
    queryKey: ["warehouse-positions", "customers"],
    queryFn: () => fetchJson<{ items?: Customer[] }>("/api/customers?limit=500"),
    staleTime: 60_000,
  });
  const customers = useMemo(() => zoneCustomers(customersQuery.data?.items ?? []), [customersQuery.data]);
  const positions = useMemo(() => sortPositions(positionsQuery.data?.items ?? []), [positionsQuery.data]);
  const aisles = useMemo(() => aislesOf(positions), [positions]);
  const zones = useMemo(() => summarizeZones(positions), [positions]);

  const [aisleFilter, setAisleFilter] = useState(ALL);
  const [zoneFilter, setZoneFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<WarehousePosition | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [aisleForm, setAisleForm] = useState<AisleFormState>(EMPTY_AISLE_FORM);
  const [aisleOpen, setAisleOpen] = useState(false);
  const [zoneAisle, setZoneAisle] = useState("");
  const [zoneCustomer, setZoneCustomer] = useState(NO_CUSTOMER);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [removing, setRemoving] = useState<WarehousePosition | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: POSITIONS_KEY });

  const save = useMutation<SaveResult, Error, PositionPayload[]>({
    mutationFn: (list) => postJson<SaveResult>("/api/warehouse/positions", { positions: list }),
    onSuccess: (result) => {
      refresh();
      setFormOpen(false);
      setZoneOpen(false);
      const total = result.created.length + result.updated.length;
      toast({
        title: total === 1 ? `Posição ${[...result.created, ...result.updated][0]} salva` : `${total} posições salvas`,
      });
    },
    onError: (error) => toast({ title: "Não foi possível salvar", description: errorMessage(error, ""), variant: "destructive" }),
  });

  const seed = useMutation<SaveResult, Error>({
    mutationFn: () => postJson<SaveResult>("/api/warehouse/positions/seed"),
    onSuccess: (result) => {
      refresh();
      toast({ title: `Mapa inicial carregado: ${result.created.length} prateleiras` });
    },
    onError: (error) => toast({ title: "Mapa inicial não carregado", description: errorMessage(error, ""), variant: "destructive" }),
  });

  const createAisle = useMutation<SaveResult, Error, Record<string, unknown>>({
    mutationFn: (body) => postJson<SaveResult>("/api/warehouse/positions/aisles", body),
    onSuccess: (result) => {
      refresh();
      setAisleOpen(false);
      setAisleForm(EMPTY_AISLE_FORM);
      toast({ title: `Rua cadastrada: ${result.created.length} prateleiras` });
    },
    onError: (error) => toast({ title: "Rua não cadastrada", description: errorMessage(error, ""), variant: "destructive" }),
  });

  const remove = useMutation<{ ok: true; code: string }, Error, string>({
    mutationFn: (code) => postJson(`/api/warehouse/positions/${encodeURIComponent(code)}/remove`),
    onSuccess: (result) => {
      refresh();
      setRemoving(null);
      toast({ title: `Posição ${result.code} removida` });
    },
    onError: (error) => toast({ title: "Posição não removida", description: errorMessage(error, ""), variant: "destructive" }),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, aisle: aisleFilter === ALL ? "" : aisleFilter });
    setFormOpen(true);
  };
  const openEdit = (position: WarehousePosition) => {
    setEditing(position);
    setForm(formFromPosition(position));
    setFormOpen(true);
  };
  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    const { payload, error } = payloadFromForm(form);
    if (!payload) {
      toast({ title: error ?? "Confira os campos.", variant: "destructive" });
      return;
    }
    save.mutate([payload]);
  };
  const submitAisle = (event: FormEvent) => {
    event.preventDefault();
    const aisle = aisleForm.aisle.trim().toUpperCase();
    const shelves = Number(aisleForm.shelves);
    const length = parseDecimal(aisleForm.length);
    const depth = parseDecimal(aisleForm.depth);
    const height = parseDecimal(aisleForm.height);
    if (!aisle || !Number.isInteger(shelves) || shelves < 1) {
      toast({ title: "Informe a rua e quantas prateleiras ela tem.", variant: "destructive" });
      return;
    }
    if (!length || !depth || !height) {
      toast({ title: "Informe comprimento, largura e altura em metros.", variant: "destructive" });
      return;
    }
    createAisle.mutate({
      aisle,
      shelves,
      length_m: length,
      depth_m: depth,
      height_m: height,
      max_weight_kg: aisleForm.maxWeight.trim() ? parseDecimal(aisleForm.maxWeight) : null,
      customer_code: aisleForm.customer === NO_CUSTOMER ? null : aisleForm.customer,
    });
  };
  const submitZone = (event: FormEvent) => {
    event.preventDefault();
    const targets = positions.filter((position) => position.aisle === zoneAisle);
    if (!targets.length) {
      toast({ title: "Escolha uma rua.", variant: "destructive" });
      return;
    }
    const customerCode = zoneCustomer === NO_CUSTOMER ? null : zoneCustomer;
    save.mutate(targets.map((position) => payloadFromPosition(position, customerCode)));
  };

  const filtered = positions.filter((position) => {
    if (aisleFilter !== ALL && position.aisle !== aisleFilter) return false;
    const zone = position.customer_code?.trim() || NO_CUSTOMER;
    if (zoneFilter !== ALL && zone !== zoneFilter) return false;
    if (statusFilter !== ALL && (position.status || "active") !== statusFilter) return false;
    const term = search.trim().toUpperCase();
    if (term && !position.code.toUpperCase().includes(term)) return false;
    return true;
  });

  const loading = positionsQuery.isLoading;
  // Erro de leitura não é mapa vazio: sem isso a tela oferecia carregar o mapa inicial junto com o erro.
  const empty = !loading && !positionsQuery.isError && positions.length === 0;
  const busy = save.isPending || seed.isPending || createAisle.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Posições"
        description="Prateleiras do galpão com medidas úteis, sequência de caminhada e zona por cliente. É a base do mapa e do endereçamento dirigido."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate(labelsUrl({ positions: filtered.map((position) => position.code) }))}
              disabled={loading || filtered.length === 0}
              title="Etiquetas das posições filtradas, dez por folha A4"
            >
              <Printer className="size-4" />
              Imprimir etiquetas
            </Button>
          {canEdit ? (
            <>
              <Button variant="outline" onClick={() => setZoneOpen(true)} disabled={empty || busy}>
                <Users className="size-4" />
                Zona da rua
              </Button>
              <Button variant="outline" onClick={() => setAisleOpen(true)} disabled={busy}>
                <Rows3 className="size-4" />
                Nova rua
              </Button>
              <Button onClick={openNew} disabled={busy}>
                <Plus className="size-4" />
                Nova posição
              </Button>
            </>
          ) : null}
          </>
        }
      />

      {positionsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar as posições</AlertTitle>
          <AlertDescription>{errorMessage(positionsQuery.error, "Tente de novo em instantes.")}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <Skeleton className="h-64 w-full rounded-lg" /> : null}

      {empty ? (
        <Alert className="border-info-soft-border bg-info-soft text-info-soft-foreground [&>svg]:text-info-soft-foreground">
          <LayoutGrid className="size-4" />
          <AlertTitle>Nenhuma posição cadastrada</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              O mapa inicial tem {INITIAL_LAYOUT_SIZE} prateleiras, com as medidas levantadas em 16/10/2026: ruas A (15), B (16) e C (12).
              Se o galpão mudar depois, edite as posições ou cadastre uma rua nova.
            </span>
            {canEdit ? (
              <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
                <LayoutGrid className="size-4" />
                Carregar mapa inicial
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !empty ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label htmlFor="positions-search">Buscar</Label>
                <Input
                  id="positions-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Código, ex.: B-05"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="positions-aisle">Rua</Label>
                <Select value={aisleFilter} onValueChange={setAisleFilter}>
                  <SelectTrigger id="positions-aisle" className="w-full sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    {aisles.map((aisle) => (
                      <SelectItem key={aisle} value={aisle}>
                        Rua {aisle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="positions-zone">Zona</Label>
                <Select value={zoneFilter} onValueChange={setZoneFilter}>
                  <SelectTrigger id="positions-zone" className="w-full sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    {zones.map((zone) => (
                      <SelectItem key={zone.customer_code ?? NO_CUSTOMER} value={zone.customer_code ?? NO_CUSTOMER}>
                        {zone.customer_code ?? "Sem cliente (livres)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="positions-status">Situação</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger id="positions-status" className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    {(Object.keys(POSITION_STATUS_LABELS) as PositionStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {POSITION_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[880px] whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Rua</TableHead>
                    <TableHead>Prat.</TableHead>
                    <TableHead>Comprimento</TableHead>
                    <TableHead>Largura</TableHead>
                    <TableHead>Altura</TableHead>
                    <TableHead>Peso máx.</TableHead>
                    <TableHead>Seq.</TableHead>
                    <TableHead>Zona</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Observações</TableHead>
                    {canEdit ? <TableHead className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((position) => (
                    <TableRow key={position.code}>
                      <TableCell className="font-semibold">{position.code}</TableCell>
                      <TableCell>{position.aisle}</TableCell>
                      <TableCell>{position.shelf}</TableCell>
                      <TableCell>{formatMeters(position.length_m)}</TableCell>
                      <TableCell>{formatMeters(position.depth_m)}</TableCell>
                      <TableCell>{formatMeters(position.height_m)}</TableCell>
                      <TableCell>{formatKilos(position.max_weight_kg)}</TableCell>
                      <TableCell>{position.sequence ?? "—"}</TableCell>
                      <TableCell className={cn(!position.customer_code && "text-muted-foreground")}>
                        {position.customer_code || "sem cliente"}
                      </TableCell>
                      <TableCell>{statusBadge(position.status)}</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground" title={position.notes ?? undefined}>
                        {position.notes || ""}
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" aria-label={`Editar ${position.code}`} onClick={() => openEdit(position)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Remover ${position.code}`} onClick={() => setRemoving(position)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canEdit ? 12 : 11} className="py-8 text-center text-muted-foreground">
                        Nenhuma posição com esses filtros.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
              {filtered.length} de {positions.length} posições, na sequência de caminhada.
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Zonas por cliente</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {zones.map((zone) => (
                  <li key={zone.customer_code ?? NO_CUSTOMER} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <span className={cn("min-w-0 truncate", !zone.customer_code && "text-muted-foreground")}>
                      {zone.customer_code ?? "Sem cliente (livres)"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {zone.positions} prat. · rua {zone.aisles.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Quando a zona de um cliente encher, a guarda para e avisa. Coordenação amplia a zona atribuindo prateleiras livres.
                Nunca transborda sozinho para outra zona.
              </p>
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Como ler as medidas</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Comprimento é a frente da prateleira, ocupada caixa a caixa. Largura é a profundidade. Altura é o vão livre: caixa em
                cima de caixa só quando ela permite. Com a caixa de referência de {formatCentimeters(REFERENCE_BOX.length_m)} ×{" "}
                {formatCentimeters(REFERENCE_BOX.width_m)} × {formatCentimeters(REFERENCE_BOX.height_m)} cm, uma prateleira de 1,80 ×
                0,75 × 0,65 m recebe 3 caixas.
              </p>
            </section>
          </aside>
        </div>
      ) : null}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={submitForm} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? `Editar posição ${editing.code}` : "Nova posição"}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {editing
                  ? "Alterar medida recalcula a capacidade; as caixas já guardadas não se movem."
                  : `O código é montado como rua e prateleira: ${positionCode(form.aisle || "A", Number(form.shelf) || 1)}.`}
              </p>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-aisle">Rua</Label>
                <Input id="pos-aisle" value={form.aisle} onChange={(event) => setForm({ ...form, aisle: event.target.value })} placeholder="A" maxLength={4} disabled={Boolean(editing)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-shelf">Prateleira</Label>
                <Input id="pos-shelf" type="number" min={1} step={1} inputMode="numeric" value={form.shelf} onChange={(event) => setForm({ ...form, shelf: event.target.value })} placeholder="1" disabled={Boolean(editing)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-length">Comprimento (m)</Label>
                <Input id="pos-length" inputMode="decimal" value={form.length} onChange={(event) => setForm({ ...form, length: event.target.value })} placeholder="1,80" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-depth">Largura (m)</Label>
                <Input id="pos-depth" inputMode="decimal" value={form.depth} onChange={(event) => setForm({ ...form, depth: event.target.value })} placeholder="0,75" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-height">Altura (m)</Label>
                <Input id="pos-height" inputMode="decimal" value={form.height} onChange={(event) => setForm({ ...form, height: event.target.value })} placeholder="0,65" />
              </div>
            </div>
            <CapacityHint form={form} />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-weight">Peso máximo (kg, opcional)</Label>
                <Input id="pos-weight" inputMode="decimal" value={form.maxWeight} onChange={(event) => setForm({ ...form, maxWeight: event.target.value })} placeholder="sem limite" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-sequence">Sequência de caminhada</Label>
                <Input id="pos-sequence" type="number" min={1} step={1} inputMode="numeric" value={form.sequence} onChange={(event) => setForm({ ...form, sequence: event.target.value })} placeholder="automática" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-customer">Zona (cliente)</Label>
                <CustomerSelect id="pos-customer" value={form.customer} onChange={(customer) => setForm({ ...form, customer })} customers={customers} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-status">Situação</Label>
                <Select value={form.status} onValueChange={(status) => setForm({ ...form, status: status as PositionStatus })}>
                  <SelectTrigger id="pos-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(POSITION_STATUS_LABELS) as PositionStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {POSITION_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pos-notes">Observações</Label>
              <Textarea id="pos-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} maxLength={500} placeholder="Ex.: prateleira avariada, medida a confirmar" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {editing ? "Salvar posição" : "Cadastrar posição"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={aisleOpen} onOpenChange={setAisleOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitAisle} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Nova rua</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Cadastra todas as prateleiras da rua de uma vez, com as mesmas medidas. Depois ajuste as que forem diferentes.
              </p>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-code">Rua</Label>
                <Input id="aisle-code" value={aisleForm.aisle} onChange={(event) => setAisleForm({ ...aisleForm, aisle: event.target.value })} placeholder="D" maxLength={4} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-shelves">Quantas prateleiras</Label>
                <Input id="aisle-shelves" type="number" min={1} max={200} step={1} inputMode="numeric" value={aisleForm.shelves} onChange={(event) => setAisleForm({ ...aisleForm, shelves: event.target.value })} placeholder="16" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-length">Comprimento (m)</Label>
                <Input id="aisle-length" inputMode="decimal" value={aisleForm.length} onChange={(event) => setAisleForm({ ...aisleForm, length: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-depth">Largura (m)</Label>
                <Input id="aisle-depth" inputMode="decimal" value={aisleForm.depth} onChange={(event) => setAisleForm({ ...aisleForm, depth: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-height">Altura (m)</Label>
                <Input id="aisle-height" inputMode="decimal" value={aisleForm.height} onChange={(event) => setAisleForm({ ...aisleForm, height: event.target.value })} />
              </div>
            </div>
            <CapacityHint form={aisleForm} />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-weight">Peso máximo (kg, opcional)</Label>
                <Input id="aisle-weight" inputMode="decimal" value={aisleForm.maxWeight} onChange={(event) => setAisleForm({ ...aisleForm, maxWeight: event.target.value })} placeholder="sem limite" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aisle-customer">Zona (cliente)</Label>
                <CustomerSelect id="aisle-customer" value={aisleForm.customer} onChange={(customer) => setAisleForm({ ...aisleForm, customer })} customers={customers} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAisleOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createAisle.isPending}>
                Cadastrar rua
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitZone} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Zona da rua</DialogTitle>
              <p className="text-sm text-muted-foreground">Atribui todas as prateleiras de uma rua a um cliente, ou as deixa livres.</p>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <Label htmlFor="zone-aisle">Rua</Label>
              <Select value={zoneAisle} onValueChange={setZoneAisle}>
                <SelectTrigger id="zone-aisle">
                  <SelectValue placeholder="Escolha a rua" />
                </SelectTrigger>
                <SelectContent>
                  {aisles.map((aisle) => (
                    <SelectItem key={aisle} value={aisle}>
                      Rua {aisle} · {positions.filter((position) => position.aisle === aisle).length} prateleiras
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="zone-customer">Cliente</Label>
              <CustomerSelect id="zone-customer" value={zoneCustomer} onChange={setZoneCustomer} customers={customers} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setZoneOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending || !zoneAisle}>
                Aplicar à rua
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => (!open ? setRemoving(null) : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a posição {removing?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só é possível remover prateleira sem saldo. Com caixa guardada, mova antes. A remoção fica registrada nos eventos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing.code)} disabled={remove.isPending}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
