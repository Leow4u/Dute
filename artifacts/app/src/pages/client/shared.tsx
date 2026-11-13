import type { ReactNode } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { SearchX, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, useTentandoNoRelogio } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { Skeleton } from "@/components/ui/skeleton";
import { useEsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { ehFaltaDeConexao } from "@/lib/conexao";
import { cn } from "@/lib/utils";

type Numberish = number | string | null | undefined;

export type ClientOverview = {
  customer?: {
    name?: string;
    code?: string;
    document?: string;
    role?: string;
  };
  updated_at?: string | null;
  inventory?: InventorySummary;
  stock?: InventorySummary;
  billing?: BillingSummary;
  invoices?: BillingSummary | Invoice[];
  orders?: OrdersSummary;
  recent_orders?: Order[];
  requests?: RequestsSummary | ClientRequest[];
  recent_requests?: ClientRequest[];
  /** Pedidos: o acompanhamento publicado inteiro (client_order_tracking). */
  order_tracking?: Record<string, unknown>[];
  /** Faturas: todas as faturas da conta, não só as 6 do Início. */
  invoice_history?: Record<string, unknown>[];
  /** Pedidos: todas as solicitações, não só as recentes do Início. */
  request_history?: ClientRequest[];
  /** Documentos: o que a Dutelog publicou para a conta (client_documents). */
  document_history?: Record<string, unknown>[];
  agent_alerts?: AgentAlert[];
  alerts?: AgentAlert[];
  metrics?: Record<string, Numberish>;
  stock_by_category?: InventoryCategory[];
  wms?: WmsOverviewPayload;
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export type InventorySummary = {
  total_skus?: Numberish;
  total_pieces?: Numberish;
  total_pecas?: Numberish;
  available_pieces?: Numberish;
  reserved_pieces?: Numberish;
  low_stock_count?: Numberish;
  total_value?: Numberish;
  inventory_value?: Numberish;
  custo_total?: Numberish;
  by_category?: InventoryCategory[];
  top_items?: InventoryItem[];
  items?: InventoryItem[];
  /** A abertura deste cliente ainda trava pedido de saída. */
  outbound_blocked?: boolean;
};

export type InventoryCategory = {
  category?: string;
  categoria?: string;
  label?: string;
  total_pieces?: Numberish;
  total_pecas?: Numberish;
  qty_on_hand?: Numberish;
  value?: Numberish;
  total_value?: Numberish;
  total_cost?: Numberish;
  unit_cost?: Numberish;
  sku_count?: Numberish;
};

export type InventoryItem = {
  id?: string;
  sku_code?: string;
  sku?: string;
  cod_sku?: string;
  client_item_code?: string;
  cod_cliente?: string;
  product_name?: string;
  name?: string;
  produto?: string;
  category?: string;
  categoria?: string;
  qty_available?: Numberish;
  available_pieces?: Numberish;
  qty_reserved?: Numberish;
  reserved_pieces?: Numberish;
  /** Livre no RECEBIMENTO, ainda sem guarda: aparece, mas não entra em pedido (decisão 10). */
  qty_receiving?: Numberish;
  qty_on_hand?: Numberish;
  pieces?: Numberish;
  total_pieces?: Numberish;
  qtde?: Numberish;
  value?: Numberish;
  total_value?: Numberish;
  total_cost?: Numberish;
  unit_cost?: Numberish;
  location_id?: string;
  location?: string;
  localizacao?: string;
  primary_photo_url?: string | null;
  photo_urls?: string[];
};

export type BillingSummary = {
  current_total?: Numberish;
  open_total?: Numberish;
  overdue_total?: Numberish;
  open_count?: Numberish;
  due_soon_count?: Numberish;
  recent?: Invoice[];
  items?: Invoice[];
};

export type Invoice = {
  id?: string;
  competencia?: string;
  month?: string;
  status?: string;
  total?: Numberish;
  due_date?: string | null;
  vencimento?: string | null;
};

export type OrdersSummary = {
  open?: Numberish;
  pending?: Numberish;
  in_progress?: Numberish;
  shipped?: Numberish;
  recent?: Order[];
  items?: Order[];
};

export type Order = {
  id?: string;
  num_pedido?: string;
  order_number?: string;
  number?: string;
  status?: string;
  canal?: string;
  channel?: string;
  sku_code?: string;
  sku?: string;
  cod_sku?: string;
  client_item_code?: string;
  cod_cliente?: string;
  produto?: string;
  product?: string;
  product_name?: string;
  qtd_solic?: Numberish;
  requested_qty?: Numberish;
  quantity?: Numberish;
  qtd_sep?: Numberish;
  picked_qty?: Numberish;
  progress?: Numberish;
  data_solic?: string | null;
  requested_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RequestsSummary = {
  open?: Numberish;
  pending?: Numberish;
  recent?: ClientRequest[];
  items?: ClientRequest[];
};

export type ClientRequestItemObject = {
  sku_code?: string | null;
  sku?: string | null;
  cod_sku?: string | null;
  client_item_code?: string | null;
  cod_cliente?: string | null;
  product_name?: string | null;
  product?: string | null;
  name?: string | null;
  produto?: string | null;
  quantity?: Numberish;
  qty?: Numberish;
  qtd?: Numberish;
  qtde?: Numberish;
  requested_quantity?: Numberish;
  requested_qty?: Numberish;
  picked_quantity?: Numberish;
  picked_qty?: Numberish;
  expected_quantity?: Numberish;
  expected_qty?: Numberish;
  packed_quantity?: Numberish;
  packed_qty?: Numberish;
  status?: string | null;
  location?: string | null;
  localizacao?: string | null;
  location_id?: string | null;
  package_id?: string | null;
  package_label?: string | null;
  tracking_code?: string | null;
};

export type ClientRequestItem = string | ClientRequestItemObject;

export type ClientRequest = {
  id?: string;
  customer_code?: string;
  supplier?: string;
  invoice_number?: string;
  attachment_count?: Numberish;
  /** PED-0043 / ENV-0012: o número que as pessoas leem. */
  request_number?: string;
  protocol?: string;
  protocolo?: string;
  title?: string;
  titulo?: string;
  type?: string;
  tipo?: string;
  priority?: string;
  prioridade?: string;
  description?: string;
  descricao?: string;
  status?: string;
  quantity?: Numberish;
  quantity_total?: Numberish;
  items?: ClientRequestItem[];
  payload?: {
    items?: ClientRequestItem[];
    shipments?: ShipmentRecord[];
    packages?: PackageRecord[];
    volumes?: PackageRecord[];
    delivery_proofs?: DeliveryProof[];
    proofs?: DeliveryProof[];
    documents?: DeliveryProof[];
  } | null;
  order_id?: string | null;
  pedido_id?: string | null;
  order_number?: string | null;
  num_pedido?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  tracking_code?: string | null;
  proof_id?: string | null;
  document_id?: string | null;
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  shipments?: ShipmentRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
  created_at?: string | null;
  updated_at?: string | null;
  requested_by?: {
    name?: string;
    email?: string;
  };
};

export type AgentAlert = {
  id?: string;
  title?: string;
  titulo?: string;
  message?: string;
  description?: string;
  priority?: string;
  severity?: string;
  created_at?: string | null;
};

export type WmsOverviewPayload = {
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export type PackageRecord = {
  id?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  quantity?: Numberish;
  status?: string | null;
  location?: string | null;
  location_id?: string | null;
  package_id?: string | null;
  package_code?: string | null;
  package_label?: string | null;
  package_number?: string | number | null;
  tracking_code?: string | null;
  volume?: string | null;
  volume_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  shipment_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  blocked_reason?: string | null;
};

export type DeliveryProof = {
  id?: string | null;
  proof_id?: string | null;
  document_id?: string | null;
  shipment_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  file_name?: string | null;
  filename?: string | null;
  name?: string | null;
  title?: string | null;
  url?: string | null;
  href?: string | null;
  status?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ShipmentRecord = {
  id?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  status?: string | null;
  destination?: string | null;
  carrier?: string | null;
  tracking_code?: string | null;
  total_units?: Numberish;
  quantity?: Numberish;
  qty?: Numberish;
  due_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  items?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export const clientOverviewQueryKey = ["client-portal-overview"] as const;

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : text;

    throw new Error(message || `HTTP ${response.status}`);
  }

  return (payload ?? undefined) as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function useClientOverview() {
  return useQuery<ClientOverview, Error>({
    queryKey: clientOverviewQueryKey,
    queryFn: () => fetchJson<ClientOverview>("/api/client/overview"),
    staleTime: 60_000,
  });
}

export type CreateClientRequestItem = {
  sku_code?: string | null;
  client_item_code?: string | null;
  product_name?: string | null;
  product_registration?: "existing" | "new" | "unknown";
  location_id?: string | null;
  category?: string | null;
  barcode?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  unit_cost?: number | null;
  quantity: number;
  notes?: string | null;
};

export type ClientRequestAttachment = {
  file_name: string;
  file_url: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
};

export type CreateClientRequestPayload = {
  type: "retirada" | "recebimento" | "ajuste" | "suporte";
  priority?: string;
  title?: string;
  description?: string;
  destination?: string;
  due_at?: string;
  supplier?: string;
  invoice_number?: string;
  attachments?: ClientRequestAttachment[];
  items: CreateClientRequestItem[];
  /** Pedido enviado pelo cartão do Agent Dute (a mensagem que trouxe o rascunho). */
  agent_message_id?: string;
  /** A mesma na nova tentativa do mesmo pedido: o servidor devolve o que já gravou. */
  idempotency_key?: string;
};

export function createClientRequest(payload: CreateClientRequestPayload) {
  return fetchJson<ClientRequest>("/api/client/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

type ClientDataBoundaryProps = {
  children: (overview: ClientOverview) => ReactNode;
  /** O título da tela, à vista enquanto o portal lê: a tela nasce com o título dela (carregamento v2). */
  titulo?: string;
  /** A largura do conteúdo da tela ("max-w-6xl"), para a espera ter a forma dela. Sem ela, a do `ClientModuleShell`. */
  largura?: string;
};

/**
 * A leitura do portal que toda tela dele espera (carregamento v2, parte 13f).
 * Lendo, a forma da tela e, aos 300 ms, "Carregando o portal…" à vista, com
 * o anúncio (`ClientModuleLoading`). Sem nada lido, a falha fica no lugar da
 * tela, com "Tentar de novo"; a nova tentativa fica na falha, com "Tentando
 * de novo…" e o foco no botão, sem voltar ao esqueleto (`useLeituraComFalha`).
 * Sem rede e sem nada lido, o aviso da conexão ("Sem conexão." ou
 * "Reconectando…", momento 8).
 *
 * Com o portal já lido, a releitura que falha não apaga a tela (necessidade 8,
 * momento 7): sem rede, a faixa da conexão do topo já diz; com outra falha,
 * "Não foi possível atualizar o portal." fica escrita em cima da tela, sem
 * falar, com "Tentar de novo". A estrutura em volta da tela é sempre a mesma,
 * para a faixa entrar e sair sem montar a tela de novo.
 */
export function ClientDataBoundary({ children, titulo, largura }: ClientDataBoundaryProps) {
  const leitura = useClientOverview();
  const overview = useLeituraComFalha(leitura);
  // A nova tentativa no relógio da espera: "Tentando de novo…" só aos 300 ms, e pelo menos 500 ms. Só a da falha
  // na tela: a primeira leitura não conta, senão o aviso nasceria dizendo "Tentando de novo…".
  const tentando = useTentandoNoRelogio(leitura.isFetching && overview.isError && !overview.data);

  if (overview.isLoading) {
    return <ClientModuleLoading titulo={titulo} largura={largura} />;
  }

  if (overview.isError && !overview.data) {
    return (
      <ClientModuleError
        semConexao={ehFaltaDeConexao(overview.error)}
        tentando={ehFaltaDeConexao(overview.error) ? leitura.isFetching : tentando}
        onTentar={() => {
          void leitura.refetch();
        }}
      />
    );
  }

  const naoAtualizou = overview.isError && !ehFaltaDeConexao(overview.error);
  return (
    <div data-portal-lido="" className="flex h-full min-h-0 w-full flex-col">
      {naoAtualizou ? (
        <div className="shrink-0 px-4 pt-3 sm:px-6 lg:px-8">
          <FalhaNaSecao
            mensagem="Não foi possível atualizar o portal."
            alerta={false}
            tentando={leitura.isFetching}
            onTentar={() => leitura.refetch()}
            className={cn("mx-auto w-full rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3", largura ?? "max-w-7xl")}
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children(overview.data ?? {})}</div>
    </div>
  );
}

type ClientModuleShellProps = {
  overview: ClientOverview;
  eyebrow?: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ClientModuleShell({
  overview,
  eyebrow,
  title,
  description,
  headerAction,
  children,
  className,
}: ClientModuleShellProps) {
  const headerLabel = firstText(eyebrow, title) ?? "Modulo";

  // No celular a área inteira rola, com o título: preso, ele e a barra da
  // tela deixavam um terço da tela para a lista. No desktop o título fica e só
  // o conteúdo rola. O respiro de cima vai no título, não na área que rola:
  // nela, a barra presa (sticky) pararia 20px abaixo do topo.
  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent px-4 text-foreground sm:px-6 md:py-5 lg:px-8">
      <div
        data-testid="client-module-scroll"
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden overscroll-contain pb-5 md:overflow-visible md:pb-0",
          className,
        )}
      >
        <header
          aria-label={headerLabel}
          className="shrink-0 flex flex-col gap-4 border-b border-border/60 pb-5 pt-5 md:flex-row md:items-start md:justify-between md:pt-0"
        >
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {headerAction}
        </header>
        <div
          data-testid="client-module-content"
          className="shrink-0 md:min-h-0 md:flex-1 md:overflow-x-hidden md:overflow-y-auto md:overscroll-contain md:pr-1"
        >
          <div className="flex min-h-full flex-col gap-5 pb-1">{children}</div>
        </div>
      </div>
    </main>
  );
}

type ClientModuleLoadingProps = {
  /** O gerúndio do que a tela lê, com a reticência de um caractere: "Carregando eventos…". */
  rotulo?: string;
  /** As leituras que o "Tentar de novo" da demora lê de novo do zero; sem elas, a do portal. */
  chaves?: readonly QueryKey[];
  /** O título da tela que espera, à vista desde o começo. Sem ele, o bloco do título. */
  titulo?: string;
  /** A largura do conteúdo da tela que espera ("max-w-6xl"). */
  largura?: string;
};

/** O id da linha que diz que o portal lê, para a tela que espera apontar para ela (momento 2). */
const ID_DA_ESPERA_DO_PORTAL = "portal-lendo";

/**
 * O portal lendo (carregamento v2, parte 13f; o portal é tela de desenho fixo,
 * decisão 1 de 06/11/2026): a forma da tela, com o título dela, na largura
 * dela, e os blocos neutros, que entram aos 300 ms (o `#D9DDE3` fora da v3,
 * sempre `aria-hidden`); sob o título, a caixa de 24 px com o rótulo à vista e
 * o anúncio na região do `Anunciador` (`CarregandoNaRegiao`): aos 10 s, a
 * demora e "Tentar de novo", que lê de novo do zero; aos 70 s, "Sem resposta
 * do servidor.". Continua a espera da tela que abriu ("Abrindo Estoque…"),
 * sem anunciar de novo, e a passa adiante: a tela que chega e ainda lê o que é
 * dela ("Carregando eventos…") segue o mesmo relógio, sem o indicador sumir.
 *
 * A linha de estado nunca encolhe nem fica sob os blocos: os blocos é que
 * cabem no que sobra, sem rolar. Só o contêiner dos blocos fica `aria-busy`,
 * apontando para a linha; a linha fica fora dele (momento 2 e seção 7).
 */
export function ClientModuleLoading({
  rotulo = "Carregando o portal…",
  chaves = [clientOverviewQueryKey],
  titulo,
  largura = "max-w-7xl",
}: ClientModuleLoadingProps) {
  const queryClient = useQueryClient();
  const rota = useEsperaDaRota(true);
  const blocos = useEspera(true, { desde: rota?.inicio }).visivel;
  const entrada = cn("transition-opacity duration-150 motion-reduce:transition-none", blocos ? "opacity-100" : "opacity-0");
  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className={cn("mx-auto flex min-h-0 w-full flex-1 flex-col gap-5 overflow-auto overscroll-contain", largura)}>
        <div className="shrink-0 space-y-2 border-b border-border/60 pb-5">
          {titulo ? (
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
          ) : (
            <Skeleton className={cn("h-8 w-48", entrada)} />
          )}
          <Skeleton className={cn("h-4 w-full max-w-xl", entrada)} />
        </div>
        <CarregandoNaRegiao
          id={ID_DA_ESPERA_DO_PORTAL}
          rotulo={rotulo}
          continuaARota
          passaAdiante
          onTentar={() => void relerDoZero(queryClient, chaves)}
          className="shrink-0"
        />
        <div
          aria-busy="true"
          aria-describedby={ID_DA_ESPERA_DO_PORTAL}
          data-blocos-do-portal=""
          className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-hidden", entrada)}
        >
          <div className="grid shrink-0 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-32 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-80 shrink-0 rounded-lg" />
        </div>
      </div>
    </main>
  );
}

type ClientModuleErrorProps = {
  /** A falta de conexão (o aparelho sem rede ou o servidor sem resposta), sem nada lido. */
  semConexao: boolean;
  /** A nova tentativa à vista, já no relógio da espera (300 ms e o mínimo de 500 ms). */
  tentando: boolean;
  onTentar: () => void;
};

/**
 * O portal que não carregou, sem nada lido: a falha no lugar da tela, com a
 * nova tentativa (`ErroNaLeitura`), ou o aviso da conexão. "Tentar de novo"
 * tem 44 px, e, ocupado, fica `aria-disabled`, nunca `disabled`. A nova
 * tentativa que falha de novo antes de 300 ms não pisca o botão.
 */
function ClientModuleError({ semConexao, tentando, onTentar }: ClientModuleErrorProps) {
  return (
    <main className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        {semConexao ? (
          <BlocoSemConexao tentando={tentando} onTentar={onTentar} />
        ) : (
          <ErroNaLeitura mensagem="Não foi possível carregar o portal." tentando={tentando} onTentar={onTentar} />
        )}
      </div>
    </main>
  );
}

type ModulePanelProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
};

export function ModulePanel({
  title,
  description,
  icon: Icon,
  children,
  className,
}: ModulePanelProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {Icon ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type MetricCardProps = {
  label: string;
  value: ReactNode;
  description?: string;
  icon: LucideIcon;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

const metricToneClass = {
  neutral: "border-border bg-card text-foreground",
  info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  success: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  warning: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  danger: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
} as const;

export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "neutral",
}: MetricCardProps) {
  return (
    <Card className="min-h-[120px]">
      <CardContent className="flex h-full flex-col justify-between gap-3 p-5 md:p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-foreground/70">{label}</p>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-2xl border",
              metricToneClass[tone],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-normal text-foreground">
            {value}
          </div>
          {description ? (
            <p className="text-xs leading-5 text-foreground/65">
              {description}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type EmptyModuleStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
};

export function EmptyModuleState({
  title,
  description,
  icon: Icon = SearchX,
}: EmptyModuleStateProps) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", statusBadgeClass(status))}
    >
      {normalizeStatus(status)}
    </Badge>
  );
}

export function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^\d,.-]/g, "");
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function optionalNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

export function formatNumber(value: unknown) {
  return numberFormatter.format(toNumber(value));
}

export function formatMoney(value: unknown) {
  return moneyFormatter.format(toNumber(value));
}

export function formatDate(value?: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return dateFormatter.format(date);
}

export function formatPeriod(value?: string | null) {
  const text = firstText(value);
  if (!text) return "Sem competência";
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return text;
  return `${match[2]}/${match[1]}`;
}

export function normalizeStatus(status?: string | null) {
  const text = firstText(status);
  if (!text) return "Pendente";
  return text.replace(/_/g, " ");
}

export function normalizeSlug(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function statusBadgeClass(status?: string | null) {
  const normalized = normalizeSlug(status);

  if (
    [
      "entregue",
      "delivered",
      "resolvido",
      "resolved",
      "aprovado",
      "approved",
      "pago",
      "paid",
      "recebido",
      "received",
      "concluido",
      "completed",
      "closed",
      "emitido",
      "faturado",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-success-soft-border bg-success-soft text-success-soft-foreground";
  }

  if (
    [
      "atras",
      "venc",
      "cancel",
      "reject",
      "rejeit",
      "critico",
      "blocked",
      "bloque",
      "diverg",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
  }

  if (
    [
      "pend",
      "abert",
      "open",
      "submitted",
      "progress",
      "separ",
      "analise",
      "planned",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }

  return "border-border bg-card text-muted-foreground";
}

export function priorityLabel(priority?: string | null) {
  const normalized = normalizeSlug(priority || "normal");
  if (["critical", "critica", "critico"].includes(normalized)) return "Critica";
  if (["high", "alta", "alto"].includes(normalized)) return "Alta";
  if (["low", "baixa", "baixo"].includes(normalized)) return "Baixa";
  return "Normal";
}

export function priorityTone(priority?: string | null) {
  const normalized = normalizeSlug(priority || "normal");
  if (["critical", "critica", "critico"].includes(normalized)) return "danger";
  if (["high", "alta", "alto"].includes(normalized)) return "warning";
  if (["low", "baixa", "baixo"].includes(normalized)) return "neutral";
  return "info";
}

export function requestTypeLabel(type?: string | null) {
  const normalized = normalizeSlug(type || "retirada");
  const labels: Record<string, string> = {
    retirada: "Retirada",
    recebimento: "Recebimento",
    inventario: "Inventario",
    ajuste: "Ajuste de estoque",
    financeiro: "Financeiro",
    suporte: "Suporte operacional",
  };
  return labels[normalized] ?? normalizeStatus(type);
}

export function getInventory(overview: ClientOverview) {
  return overview.inventory ?? overview.stock ?? {};
}

export function getInventoryCategories(overview: ClientOverview) {
  const inventory = getInventory(overview);
  const categories = asList(inventory.by_category);
  return categories.length > 0
    ? categories
    : asList(overview.stock_by_category);
}

export function getInventoryItems(overview: ClientOverview) {
  const inventory = getInventory(overview);
  const items = asList(inventory.items);
  return items.length > 0 ? items : asList(inventory.top_items);
}

export function getBilling(overview: ClientOverview) {
  if (overview.billing) return overview.billing;
  return Array.isArray(overview.invoices) ? {} : (overview.invoices ?? {});
}

export function getInvoices(overview: ClientOverview) {
  const invoicesPayload = overview.invoices;
  const invoices = Array.isArray(invoicesPayload)
    ? invoicesPayload
    : [
        ...asList(overview.billing?.recent),
        ...asList(overview.billing?.items),
        ...asList(invoicesPayload?.recent),
        ...asList(invoicesPayload?.items),
      ];

  return uniqueBy(invoices, (invoice, index) =>
    firstText(
      invoice.id,
      invoice.competencia,
      invoice.month,
      `invoice-${index}`,
    ),
  );
}

/**
 * As faturas do histórico inteiro. `invoices` é o recorte do Início (as 6
 * mais recentes); a lista de Faturas, Documentos e a fatura aberta pelo
 * endereço olham tudo.
 */
export function getInvoiceHistory(overview: ClientOverview): Record<string, unknown>[] {
  return (overview.invoice_history ?? getInvoices(overview)) as Record<string, unknown>[];
}

/** A fatura da competência, no histórico inteiro. */
export function findInvoice(overview: ClientOverview, competencia: string): Record<string, unknown> | undefined {
  return getInvoiceHistory(overview).find((item) => firstText(item.competencia, item.id, item.month) === competencia);
}

export function getOrders(overview: ClientOverview) {
  return uniqueBy(
    [
      ...asList(overview.recent_orders),
      ...asList(overview.orders?.recent),
      ...asList(overview.orders?.items),
    ],
    (order, index) =>
      firstText(
        order.id,
        order.num_pedido,
        order.order_number,
        order.number,
        `order-${index}`,
      ),
  );
}

export function getRequests(overview: ClientOverview) {
  const requestPayload = overview.requests;
  const requests = Array.isArray(requestPayload)
    ? requestPayload
    : [
        ...asList(overview.recent_requests),
        ...asList(requestPayload?.recent),
        ...asList(requestPayload?.items),
      ];

  return uniqueBy(requests, (request, index) =>
    firstText(
      request.id,
      request.protocol,
      request.protocolo,
      request.order_id,
      request.pedido_id,
      `request-${index}`,
    ),
  );
}

export function getAlerts(overview: ClientOverview) {
  return uniqueBy(
    [...asList(overview.agent_alerts), ...asList(overview.alerts)],
    (alert, index) =>
      firstText(alert.id, alert.title, alert.titulo, `alert-${index}`),
  );
}

export function getShipments(overview: ClientOverview) {
  const requests = getRequests(overview);
  const requestShipments = requests.flatMap((request) => [
    ...asList(request.shipments),
    ...asList(request.payload?.shipments),
  ]);

  return uniqueBy(
    [
      ...asList(overview.shipments),
      ...asList(overview.wms?.shipments),
      ...requestShipments,
    ],
    (shipment, index) =>
      firstText(
        shipment.id,
        shipment.shipment_id,
        shipment.shipping_id,
        shipment.expedition_id,
        shipment.tracking_code,
        `shipment-${index}`,
      ),
  );
}

export function getPackages(overview: ClientOverview) {
  const shipments = getShipments(overview);
  const requests = getRequests(overview);

  return uniqueBy(
    [
      ...asList(overview.packages),
      ...asList(overview.volumes),
      ...asList(overview.wms?.packages),
      ...asList(overview.wms?.volumes),
      ...shipments.flatMap((shipment) => [
        ...asList(shipment.packages),
        ...asList(shipment.volumes),
        ...asList(shipment.items),
      ]),
      ...requests.flatMap((request) => [
        ...asList(request.packages),
        ...asList(request.volumes),
        ...asList(request.payload?.packages),
        ...asList(request.payload?.volumes),
      ]),
    ],
    (item, index) =>
      firstText(
        item.id,
        item.package_id,
        item.package_code,
        item.package_label,
        item.volume_id,
        item.volume,
        `package-${index}`,
      ),
  );
}

export function getDocuments(overview: ClientOverview) {
  const shipments = getShipments(overview);
  const requests = getRequests(overview);

  return uniqueBy(
    [
      ...asList(overview.documents),
      ...asList(overview.proofs),
      ...asList(overview.delivery_proofs),
      ...asList(overview.wms?.documents),
      ...asList(overview.wms?.proofs),
      ...asList(overview.wms?.delivery_proofs),
      ...shipments.flatMap((shipment) => [
        ...asList(shipment.documents),
        ...asList(shipment.proofs),
        ...asList(shipment.delivery_proofs),
      ]),
      ...requests.flatMap((request) => [
        ...asList(request.documents),
        ...asList(request.proofs),
        ...asList(request.delivery_proofs),
        ...asList(request.payload?.documents),
        ...asList(request.payload?.proofs),
        ...asList(request.payload?.delivery_proofs),
      ]),
    ],
    (document, index) =>
      firstText(
        document.id,
        document.document_id,
        document.proof_id,
        document.url,
        document.href,
        `document-${index}`,
      ),
  );
}

export function inventoryItemSku(item: InventoryItem) {
  return (
    firstText(item.sku_code, item.sku, item.cod_sku, item.client_item_code) ??
    "SKU"
  );
}

export function inventoryItemClientCode(item: InventoryItem) {
  return (
    firstText(item.client_item_code, item.cod_cliente) ?? "Sem cod. cliente"
  );
}

export function inventoryItemName(item: InventoryItem) {
  return (
    firstText(item.product_name, item.name, item.produto) ?? "Produto sem nome"
  );
}

export function inventoryItemAvailable(item: InventoryItem) {
  return firstNumber(
    item.qty_available,
    item.available_pieces,
    item.pieces,
    item.total_pieces,
    item.qtde,
  );
}

export function inventoryItemTotal(item: InventoryItem) {
  return firstNumber(
    item.qty_on_hand,
    item.pieces,
    item.total_pieces,
    item.qtde,
    item.qty_available,
  );
}

export function inventoryItemReserved(item: InventoryItem) {
  return firstNumber(item.qty_reserved, item.reserved_pieces);
}

/** O em recebimento da projeção; a projeção ainda sem o campo conta zero. */
export function inventoryItemReceiving(item: InventoryItem) {
  return Math.max(0, firstNumber(item.qty_receiving));
}

export function inventoryItemValue(item: InventoryItem) {
  return firstNumber(item.total_value, item.total_cost, item.value);
}

export function inventoryTotalValue(
  inventory: InventorySummary,
  items: InventoryItem[] = [],
) {
  const fromSummary = firstNumber(
    inventory.total_value,
    inventory.inventory_value,
    inventory.custo_total,
  );
  if (fromSummary > 0) return fromSummary;
  return items.reduce((sum, item) => sum + inventoryItemValue(item), 0);
}

export function inventoryItemPhoto(item: InventoryItem) {
  const primary = item.primary_photo_url;
  if (typeof primary === "string" && primary.trim()) return primary;
  const first = item.photo_urls?.[0];
  return typeof first === "string" && first.trim() ? first : null;
}

export function categoryLabel(category: InventoryCategory) {
  return (
    firstText(category.label, category.category, category.categoria) ??
    "Sem categoria"
  );
}

export function categoryPieces(category: InventoryCategory) {
  return firstNumber(
    category.total_pieces,
    category.total_pecas,
    category.qty_on_hand,
  );
}

export function categoryValue(category: InventoryCategory) {
  return firstNumber(category.total_value, category.total_cost, category.value);
}

export function orderReference(order: Order) {
  return (
    firstText(order.order_number, order.num_pedido, order.number, order.id) ??
    "Sem pedido"
  );
}

export function orderProduct(order: Order) {
  return (
    firstText(
      order.product_name,
      order.product,
      order.produto,
      order.client_item_code,
      order.cod_cliente,
    ) ?? "Itens do pedido"
  );
}

export function orderDate(order: Order) {
  return firstText(
    order.requested_at,
    order.data_solic,
    order.created_at,
    order.updated_at,
  );
}

export function orderRequestedQuantity(order: Order) {
  return firstNumber(order.requested_qty, order.qtd_solic, order.quantity);
}

export function orderPickedQuantity(order: Order) {
  return firstNumber(order.picked_qty, order.qtd_sep);
}

export function orderProgress(order: Order) {
  const explicit = optionalNumber(order.progress);
  if (explicit !== undefined) return clampPercent(explicit);

  const requested = orderRequestedQuantity(order);
  if (requested <= 0) return 0;
  return clampPercent(
    Math.round((orderPickedQuantity(order) / requested) * 100),
  );
}

export function requestReference(request: ClientRequest) {
  return (
    firstText(request.request_number, request.protocol, request.protocolo, request.id) ??
    "Sem protocolo"
  );
}

export function requestTitle(request: ClientRequest) {
  return (
    firstText(
      request.title,
      request.titulo,
      request.description,
      request.descricao,
      requestTypeLabel(request.type ?? request.tipo),
    ) ?? "Solicitacao"
  );
}

export function requestDate(request: ClientRequest) {
  return firstText(request.updated_at, request.created_at);
}

export function requestItems(request: ClientRequest) {
  const items = asList(request.items);
  return items.length > 0 ? items : asList(request.payload?.items);
}

export function requestQuantityTotal(request: ClientRequest) {
  const explicit = optionalNumber(request.quantity_total, request.quantity);
  if (explicit !== undefined) return explicit;

  return requestItems(request).reduce((sum, item) => {
    if (typeof item === "string") return sum;
    return (
      sum +
      firstNumber(
        item.quantity,
        item.qty,
        item.qtd,
        item.qtde,
        item.requested_quantity,
        item.requested_qty,
      )
    );
  }, 0);
}

export function documentLabel(document: DeliveryProof) {
  return (
    firstText(
      document.title,
      document.file_name,
      document.filename,
      document.name,
      document.document_id,
      document.proof_id,
      document.id,
    ) ?? "Documento"
  );
}

export function documentDate(document: DeliveryProof) {
  return firstText(
    document.signed_at,
    document.updated_at,
    document.created_at,
  );
}

export function documentUrl(document: DeliveryProof) {
  return firstText(document.url, document.href);
}

export function shipmentReference(shipment: ShipmentRecord) {
  return (
    firstText(
      shipment.order_number,
      shipment.tracking_code,
      shipment.shipment_id,
      shipment.shipping_id,
      shipment.expedition_id,
      shipment.id,
    ) ?? "Remessa"
  );
}

export function shipmentDate(shipment: ShipmentRecord) {
  return firstText(
    shipment.delivered_at,
    shipment.dispatched_at,
    shipment.due_at,
    shipment.updated_at,
    shipment.created_at,
  );
}

export function shipmentQuantity(shipment: ShipmentRecord) {
  return firstNumber(shipment.total_units, shipment.quantity, shipment.qty);
}

export function sortByDateDesc<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
) {
  return [...items].sort(
    (left, right) => dateValue(getDate(right)) - dateValue(getDate(left)),
  );
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : 0;
}

function asList<T>(value?: T[] | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueBy<T>(
  items: T[],
  getKey: (item: T, index: number) => string | undefined,
) {
  const seen = new Set<string>();
  const unique: T[] = [];

  items.forEach((item, index) => {
    const key = getKey(item, index) ?? `item-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return unique;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
