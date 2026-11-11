import { useListBillingUsers } from "@workspace/api-client-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { MODULOS_CONTRATAVEIS, MODULO_ROTULO } from "@workspace/dominio";

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
import { GaleriaDeClientes } from "@/components/clientes/galeria-de-clientes";
import { ClienteNaoEncontrado, PaginaDoCliente } from "@/components/clientes/pagina-do-cliente";
import { Codigo } from "@/components/clientes/partes";
import { usePessoasDoCliente } from "@/components/pessoas/do-cliente";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErroNaLeitura } from "@/components/ui/erro-na-leitura";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  buildCustomerRows,
  customerCodeFromSearch,
  customerDocumentId,
  customerFormProblem,
  customerFormWith,
  customerHref,
  customerPayload,
  emptyCustomerForm,
  portalStatusFor,
  toggleContractedModule,
  zoneOccupancy,
  type CustomerFilter,
  type CustomerForm,
  type CustomerRow,
  type PersonRecord,
} from "@/lib/customer-registry";
import {
  OPERATION_TEMPLATES,
  canonicalSkuPrefix,
  operationTemplate,
  packForCustomer,
  skuExample,
  suggestSkuPrefix,
  templateStatusLabel,
  type OperationTemplateKey,
} from "@/lib/operations";
import { CUSTOMERS_QUERY_KEY, useCustomerRecords } from "@/lib/customer-records";
import { comercialLiberado, PLATAFORMA_LIBERADA } from "@/lib/liberacao";
import { CLIENT_PROFILES_QUERY_KEY } from "@/lib/active-customer-context";
import { humanApiError } from "@/lib/permissions";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { buildShelves } from "@/lib/warehouse-map";
import type { AnyRecord } from "@/lib/warehouse-ops/model";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import SettingsCustomerNotifications, { useContatosDeAviso } from "./settings-customer-notifications";

/**
 * Configurações › Clientes: cada cliente nasce de um modelo de operação
 * (código, lib/operations). O que o modelo define vive em código; o que muda
 * por contrato entra no pacote do cliente, também em código. Aqui só se
 * escolhe o modelo, a sigla do SKU e o portal
 * (docs/multicliente-modelos-de-operacao.md).
 *
 * A galeria de cartões e a página de cada cliente, com `?cliente=<código>`
 * (docs/mockups/ConfigClientes.dc.html e ConfigCliente.dc.html, aprovadas em
 * 11/11/2026). As leituras são as de antes, mais as do Mapa para a ocupação
 * (as mesmas chaves: o que uma tela leu, a outra aproveita). Cada seção da
 * página grava o cadastro inteiro com o que ela mudou, pela mesma rota.
 */

// As chaves do Mapa (pages/warehouse-map.tsx): a mesma leitura, o mesmo cache.
const POSITIONS_KEY = ["warehouse-positions", "all-pages"];
const BOXES_KEY = ["warehouse-boxes", "all", "all-pages"];

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação.");
  return payload as T;
}

function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function SettingsCustomers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const openCode = customerCodeFromSearch(useSearch());
  const [filtro, setFiltro] = useState<CustomerFilter>("todos");
  const [busca, setBusca] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm());
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [archiving, setArchiving] = useState<CustomerRow | null>(null);
  // O cadastro de contatos continua disponível quando só as telas do
  // Comercial estão pausadas; fora dos projetos liberados, a callable não atende.
  const contactsEnabled = comercialLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const topo = useRef<HTMLDivElement>(null);

  // A mesma leitura de Pessoas e acessos (lib/customer-records.ts).
  const customers = useCustomerRecords();
  const positions = useQuery({
    queryKey: POSITIONS_KEY,
    staleTime: 30_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
  });
  const users = useListBillingUsers();

  const rows = useMemo(
    () =>
      buildCustomerRows(
        customers.data ?? [],
        positions.data?.items ?? [],
        (users.data?.items ?? []) as unknown as PersonRecord[],
      ),
    [customers.data, positions.data, users.data],
  );
  const row = openCode ? (rows.find((item) => item.code === openCode) ?? null) : null;
  const comZona = Boolean(row?.zone && row.zone.positions > 0);
  // As pessoas do portal na página do cliente, com o convite já com o cliente.
  const pessoasDoCliente = usePessoasDoCliente(row);

  // A ocupação por rua só na página de um cliente com zona: a leitura do Mapa.
  const boxes = useQuery({
    queryKey: BOXES_KEY,
    enabled: comZona,
    staleTime: 10_000,
    queryFn: async () => (await fetchWarehouseRows<AnyRecord>("/api/warehouse/boxes?limit=5000")).map(warehouseBoxFromRecord),
  });
  const occupancy = useMemo(
    () => (row && comZona && boxes.data ? zoneOccupancy(buildShelves(positions.data?.items ?? [], boxes.data), row.code) : null),
    [boxes.data, comZona, positions.data, row],
  );

  const contatos = useContatosDeAviso(contactsEnabled && row && !row.archived ? row.code : null);
  const contatosAtivos =
    !contactsEnabled || !row || row.archived
      ? undefined
      : contatos.leitura.itens === null
        ? null
        : contatos.lista.filter((contato) => contato.ativo).length;

  // Abrir outro cliente (ou voltar à galeria) começa do topo da tela.
  useEffect(() => {
    topo.current?.scrollIntoView?.({ block: "start" });
  }, [openCode]);

  const template = operationTemplate(form.operation_template) ?? OPERATION_TEMPLATES[0];
  // O pacote só vale no modelo dele, como na página do cliente (resolveOperationProfile).
  const pack = packForCustomer(form.code);
  const appliedPack = pack && pack.template === form.operation_template ? pack : null;
  const templateWithoutPortal = template.portal === null;

  const openCreate = () => {
    setForm(emptyCustomerForm());
    setPrefixTouched(false);
    setCreating(true);
  };

  const update = (patch: Partial<CustomerForm>) => setForm((state) => ({ ...state, ...patch }));

  const onNameChange = (name: string) => {
    // No cadastro novo a sigla acompanha o nome até a pessoa mexer nela.
    update(prefixTouched ? { name } : { name, sku_prefix: suggestSkuPrefix(name) });
  };

  const onTemplateChange = (operation_template: OperationTemplateKey) => {
    update({
      operation_template,
      portal_status: portalStatusFor(operation_template, form.portal_status),
    });
  };

  // O seletor de cliente ativo lê client_profiles, que o cadastro publica.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CLIENT_PROFILES_QUERY_KEY }),
    ]);

  const create = useMutation({
    mutationFn: async () => {
      const problem = customerFormProblem(form, "create");
      if (problem) throw new Error(problem);
      await apiJson("/api/customers", {
        method: "POST",
        body: JSON.stringify(customerPayload(form, "create", { modules: PLATAFORMA_LIBERADA })),
      });
      return form.code.trim();
    },
    onSuccess: async (code) => {
      setCreating(false);
      await invalidate();
      toast({ title: "Cliente cadastrado" });
      // O cliente novo já abre na página dele.
      navigate(customerHref(code));
    },
    onError: (error) =>
      toast({
        title: "Cliente não salvo",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  /** Uma seção da página grava: o cadastro de agora com o que ela mudou. */
  const saveSection = async (target: CustomerRow, patch: Partial<CustomerForm>) => {
    const next = customerFormWith(target.customer, patch);
    const problem = customerFormProblem(next, "edit");
    if (problem) throw new Error(problem);
    try {
      await apiJson(`/api/customers/${encodeURIComponent(customerDocumentId(target.customer))}`, {
        method: "PATCH",
        body: JSON.stringify(customerPayload(next, "edit", { modules: PLATAFORMA_LIBERADA })),
      });
    } catch (error) {
      throw new Error(humanApiError(error, "Não foi possível salvar. Tente novamente em instantes."));
    }
    await invalidate();
    toast({ title: "Dados do cliente salvos" });
  };

  const archive = useMutation({
    mutationFn: (target: CustomerRow) =>
      apiJson(`/api/customers/${encodeURIComponent(customerDocumentId(target.customer))}`, { method: "DELETE" }),
    onSuccess: async (_result, target) => {
      setArchiving(null);
      await invalidate();
      toast({ title: `${target.name} arquivado`, description: "O portal do cliente foi desligado." });
    },
    onError: (error) =>
      toast({
        title: "Cliente não arquivado",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  const estado = customers.isLoading ? "carregando" : customers.isError ? "erro" : "pronto";
  const zonas = positions.isSuccess ? "pronto" : positions.isError ? "erro" : "carregando";
  const erroDaLeitura = customers.isError ? humanApiError(customers.error, "Não foi possível carregar os clientes.") : null;

  return (
    <div ref={topo} className="scroll-mt-10">
      {openCode === null ? (
        <GaleriaDeClientes
          estado={estado}
          erro={erroDaLeitura}
          tentando={customers.isFetching}
          onTentar={() => void customers.refetch()}
          rows={rows}
          filtro={filtro}
          onFiltro={setFiltro}
          busca={busca}
          onBusca={setBusca}
          zonas={zonas}
          comModulos={PLATAFORMA_LIBERADA}
          onNovo={openCreate}
        />
      ) : estado === "carregando" ? (
        <p role="status" className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-5 py-6 text-sm font-semibold text-muted-foreground">
          <Spinner />
          Carregando clientes…
        </p>
      ) : estado === "erro" ? (
        <ErroNaLeitura mensagem={erroDaLeitura ?? "Não foi possível carregar os clientes."} tentando={customers.isFetching} onTentar={() => void customers.refetch()} />
      ) : row ? (
        <PaginaDoCliente
          key={row.code}
          row={row}
          zonas={zonas}
          comModulos={PLATAFORMA_LIBERADA}
          ocupacao={{
            estado: positions.isError || boxes.isError ? "erro" : occupancy ? "pronto" : "carregando",
            aisles: occupancy?.aisles ?? [],
            boxes: occupancy?.boxes ?? 0,
            tentando: positions.isFetching || boxes.isFetching,
            onTentar: () => {
              void queryClient.invalidateQueries({ queryKey: POSITIONS_KEY });
              void queryClient.invalidateQueries({ queryKey: BOXES_KEY });
            },
          }}
          contatosAtivos={contatosAtivos}
          avisos={
            contatosAtivos !== undefined ? <SettingsCustomerNotifications customer={{ code: row.code, name: row.name }} contatos={contatos} /> : null
          }
          onSalvar={(patch) => saveSection(row, patch)}
          onArquivar={() => setArchiving(row)}
          pessoas={pessoasDoCliente}
        />
      ) : (
        <ClienteNaoEncontrado />
      )}

      {pessoasDoCliente.dialogos}

      <Dialog open={creating} onOpenChange={(open) => !open && !create.isPending && setCreating(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_240px]">
            <form
              id="customer-form"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-name" label="Nome exibido">
                  <Input
                    id="c-name"
                    required
                    value={form.name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder="Itaú Unibanco"
                  />
                </FormField>
                <FormField id="c-code" label="Código operacional">
                  <Input
                    id="c-code"
                    required
                    value={form.code}
                    onChange={(event) => update({ code: event.target.value })}
                    placeholder="Itaú"
                  />
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="c-prefix" label="Sigla do SKU" hint={`SKU gerado: ${skuExample(form.sku_prefix)}`}>
                  <Input
                    id="c-prefix"
                    required
                    value={form.sku_prefix}
                    maxLength={6}
                    className="font-mono uppercase"
                    onChange={(event) => {
                      setPrefixTouched(true);
                      update({ sku_prefix: canonicalSkuPrefix(event.target.value) });
                    }}
                    placeholder="ITAU"
                  />
                </FormField>
                <FormField id="c-template" label="Modelo de operação">
                  <Select
                    value={form.operation_template}
                    onValueChange={(value) => onTemplateChange(value as OperationTemplateKey)}
                  >
                    <SelectTrigger id="c-template">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATION_TEMPLATES.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                          {item.status === "building" ? " (em construção)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="c-portal" label="Portal do cliente">
                  <Select
                    value={form.portal_status}
                    disabled={templateWithoutPortal}
                    onValueChange={(value) => update({ portal_status: value === "inactive" ? "inactive" : "active" })}
                  >
                    <SelectTrigger id="c-portal">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Sem portal</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              {PLATAFORMA_LIBERADA ? (
                <fieldset className="min-w-0 space-y-1.5">
                  <legend className="text-sm font-medium leading-none">Módulos contratados</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                    {MODULOS_CONTRATAVEIS.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.modules.includes(key)}
                          onCheckedChange={(checked) =>
                            update({ modules: toggleContractedModule(form.modules, key, checked === true) })
                          }
                        />
                        {MODULO_ROTULO[key]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <dl className="min-w-0 space-y-1.5">
                <dt className="text-sm font-medium leading-none">Pacote de código do cliente</dt>
                <dd className="text-sm">{appliedPack ? <Codigo>{appliedPack.file}</Codigo> : "Nenhum"}</dd>
              </dl>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-legal" label="Razão social">
                  <Input id="c-legal" value={form.legal_name} onChange={(event) => update({ legal_name: event.target.value })} />
                </FormField>
                <FormField id="c-doc" label="CNPJ">
                  <Input id="c-doc" value={form.document} onChange={(event) => update({ document: event.target.value })} />
                </FormField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-contact" label="Contato principal">
                  <Input
                    id="c-contact"
                    value={form.primary_contact_name}
                    onChange={(event) => update({ primary_contact_name: event.target.value })}
                    placeholder="Nome"
                  />
                </FormField>
                <FormField id="c-email" label="E-mail do contato">
                  <Input
                    id="c-email"
                    type="email"
                    value={form.primary_contact_email}
                    onChange={(event) => update({ primary_contact_email: event.target.value })}
                    placeholder="nome@empresa.com.br"
                  />
                </FormField>
              </div>
              <FormField id="c-notes" label="Observações internas">
                <Textarea
                  id="c-notes"
                  value={form.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                />
              </FormField>
            </form>

            <aside className="h-fit space-y-3 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm">
              <div>
                <div className="font-semibold">O que o modelo {template.label} define</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{templateStatusLabel(template)}</div>
              </div>
              <dl className="space-y-2">
                {template.defines.map((item) => (
                  <div key={item.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs leading-5">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="min-w-0">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="customer-form" disabled={create.isPending}>
              {create.isPending ? "Salvando..." : "Criar cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && !archive.isPending && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O cadastro sai da lista e o portal do cliente é desligado. Estoque, pedidos, faturas e
              eventos continuam no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (archiving) archive.mutate(archiving);
              }}
            >
              {archive.isPending ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
