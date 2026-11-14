import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  MoreHorizontal,
  Package,
  Printer,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

import { Badge, badgeVariants } from "@/components/ui/badge";
import { BarraDeEspera } from "@/components/ui/barra-de-espera";
import { BotaoDeAcao, CaixaDeAlerta, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BlocoSemConexao, ErroNaLeitura } from "@/components/ui/erro-na-leitura";
import { BotaoAtualizar, LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { AvisoDeEspera } from "@/components/ui/aviso-de-espera";
import { Progresso, type ItemDoProgresso } from "@/components/ui/progresso";
import { semConexaoNaLeitura } from "@/lib/conexao";
import { PageHeader } from "@/components/ui/page-header";
import { LinhaDaFila, QueueGroup, QueueRow, type CarregandoDoGrupo, type QueueTone } from "@/components/ui/queue-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  OpeningInventoryNotice,
  useOpeningInventorySession,
} from "@/features/warehouse-ops/opening-inventory-status";
import {
  CancelarPedidoView,
  motivoValido,
  pedidoCancelavel,
  voltasDoPedido,
} from "@/features/warehouse-ops/cancel-order";
import { FormularioDaEntregaView } from "@/features/warehouse-ops/order-delivery";
import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";
import {
  Dialog,
  DialogCancelar,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useContagemLembrada, type ContagensDaLista } from "@/lib/carregando/contagem-lembrada";
import { resumoDaLista } from "@/lib/carregando/resumo-da-lista";
import { CARREGANDO, relogioDaEspera } from "@/lib/carregando/tempo";
import { desfechoDoErro, useAcaoNaLinha, type AcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import { useFalhaNaReleituraAutomatica } from "@/lib/carregando/use-leitura-com-falha";
import { useAtualizarLista } from "@/lib/carregando/use-atualizar-lista";
import { useEspera } from "@/lib/carregando/use-espera";
import { usePalcoSemSaltos } from "@/lib/carregando/palco-sem-saltos";
import { useListaSemSaltos } from "@/lib/carregando/use-lista-sem-saltos";
import { OPERACAO_LIBERADO } from "@/lib/liberacao";
import { chamarOperacao, novaChave } from "@/lib/operacao/api";
import { hojeIso } from "@/lib/operacao/fila";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { SaiComOFoco } from "@/lib/carregando/use-foco-que-segue";
import {
  buildOrderQueue,
  chaveDaPrincipal,
  isAwaitingDecision,
  linhaDoParaQuando,
  ordersGroupEmpty,
  paraQuandoDoPedido,
} from "@/lib/order-queue";
import { useItemPhotos } from "@/lib/use-item-photos";
import { Esqueleto } from "@/components/ui/esqueleto";
import { labelsUrl } from "@/lib/warehouse-labels";
import { etiquetasParaTrocar, textoDeEtiquetasParaTrocar } from "@/lib/warehouse-ops/caixas-da-separacao";
import { hrefDaListaDeSeparacao, resumoDoGrupo } from "@/lib/warehouse-ops/lista-de-separacao";
import { hrefDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import { hrefDaBancada, seloDaSeparacao, separacaoComecou } from "@/lib/warehouse-ops/separacao";
import { useCaixasDoCliente, useListaDeSeparacao } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { textoDeVolumes } from "@/lib/warehouse-ops/volumes-do-pedido";
import { canDecideRequests, canOperateWarehouse, humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { erroDaResposta } from "@/lib/erro-da-resposta";
import {
  type LineConfirmationMap,
  type WarehouseOpsResponse,
  type WarehouseTask,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
} from "@/lib/warehouse-ops/model";
import {
  entregaDoPedido,
  faltaAbrirNaOperacao,
  formularioDaEntrega,
  naOperacao,
  pedidoDaEntrega,
  problemasDaEntrega,
  resumoDaEntrega,
  saidaPelaEntrega,
  type EntregaDoPedido,
  type FormularioDaEntrega,
} from "@/lib/warehouse-ops/entrega";
import { groupWarehouseOrders, queueTasks, type OrderGroup } from "@/lib/warehouse-ops/orders";
import {
  buildBalanceValidation,
  formatRequestAge,
  requestSummary,
  requestTitle,
  type CustomerRequest,
  type StockBalance,
} from "./customer-requests";

const numberFormatter = new Intl.NumberFormat("pt-BR");

/**
 * As etapas da entrega pela Dutelog (carregamento v2, parte 11 e momento 6):
 * o pedido em "Para entregar" sai (quem levou e a placa) e é entregue, em
 * duas chamadas. A etapa anda com a resposta de cada uma. Ficam no diálogo
 * desde o repouso, pendentes, para nada entrar empurrando o botão tocado.
 */
export const ETAPAS_DA_ENTREGA = ["Saída", "Entrega"] as const;

/**
 * Onde as etapas da entrega estão, pela etapa da vez (1 ou 2; 0 em repouso):
 * as de antes feitas, a da vez andando enquanto a chamada dela espera (sem
 * resposta, e conferindo, ela fica pendente), as de depois pendentes.
 */
export function etapasDaEntrega(etapa: number, andando = true): ItemDoProgresso[] {
  return ETAPAS_DA_ENTREGA.map((rotulo, indice) => ({
    rotulo,
    estado: indice + 1 < etapa ? "feito" : indice + 1 === etapa && andando ? "andamento" : "fila",
  }));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw erroDaResposta(response.status, await response.text().catch(() => ""));
  return response.json() as Promise<T>;
}

/** Padrões da entrega própria lembrados entre pedidos (só conveniência). */
function remembered(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(`wms-pedidos:${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(`wms-pedidos:${key}`, value);
  } catch {
    // storage indisponível não pode travar a operação
  }
}

function orderUnits(order: OrderGroup) {
  const task = order.pick ?? order.pack ?? order.ship;
  return (
    Number(task?.quantity ?? 0) ||
    (task?.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
  );
}

function orderItems(order: OrderGroup) {
  return order.pick?.items ?? order.pack?.items ?? order.ship?.items ?? [];
}

/** "116 itens · 3.335 un. · 42 volumes · lacre 88231": a linha do pedido e o diálogo de cancelar. */
export function orderMeta(order: OrderGroup) {
  const items = orderItems(order);
  const units = orderUnits(order);
  const seal = order.ship?.seal_code ?? order.pack?.seal_code;
  const volumes = Number(order.ship?.package_count ?? order.pack?.package_count ?? 0) || 0;
  return [
    items.length ? `${items.length} ${items.length === 1 ? "item" : "itens"}` : null,
    units ? `${numberFormatter.format(units)} un.` : null,
    volumes ? textoDeVolumes(volumes) : null,
    seal ? `lacre ${seal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Os volumes do pedido já separado (separação com caixas, parte 4d): onde vê-los e de onde saem as etiquetas e o romaneio. */
export type VolumesDoPedidoNaFila = { verHref: string; etiquetasHref: string; romaneioHref: string };

export function volumesDoPedidoNaFila(order: OrderGroup): VolumesDoPedidoNaFila | undefined {
  if (!order.ship) return undefined;
  const pedido = order.orderId ?? order.key;
  return { verHref: hrefDaBancada(order.key), etiquetasHref: labelsUrl({ order: pedido, volumes: "all" }), romaneioHref: hrefDoRomaneio(pedido) };
}

type DialogState =
  | { kind: "reject"; request: CustomerRequest }
  | { kind: "deliver"; order: OrderGroup }
  | { kind: "entrega"; order: OrderGroup; orderId: string }
  | { kind: "cancel"; order: OrderGroup; orderId: string }
  | null;

/** As duas ações de "Para aprovar": cada linha tem o próprio estado (carregamento v2, momento 4). */
type AcaoDaSolicitacao = "aprovar" | "recusar";

const ROTA_DA_ACAO: Record<AcaoDaSolicitacao, "approve" | "reject"> = { aprovar: "approve", recusar: "reject" };

/**
 * O título no meio da frase ("Aprovando pedido 1042…"): a primeira palavra
 * comum perde a maiúscula; a sigla e o número (PED-0043) ficam como estão.
 */
export function noMeioDaFrase(titulo: string): string {
  return /^\p{Lu}\p{Ll}/u.test(titulo) ? titulo.charAt(0).toLocaleLowerCase("pt-BR") + titulo.slice(1) : titulo;
}

/**
 * O Recusar do diálogo fica travado sem o motivo (de 3 letras) no repouso e
 * também no "Não recusado", quando o botão volta a responder; e pela outra
 * ação da linha. Em andamento e no sucesso o botão já se trava, e o
 * "Conferir" (sem resposta) só relê, sem o motivo.
 */
function recusaTravada(estado: EstadoDaAcao, ocupada: boolean, motivo: string): boolean {
  if (estado === "repouso") return ocupada || motivo.trim().length < 3;
  return estado === "erro" && motivo.trim().length < 3;
}

/** O anúncio do leitor de tela tem até seis palavras. */
function seisPalavras(texto: string): string {
  return texto.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
}

/** Os pedidos de saída que ainda não saíram: a entrega de cada um (parte 4.5c). */
const PEDIDOS_EM_ABERTO = ["PENDENTE", "SEPARACAO", "EM_EXPEDICAO"];

export default function Pedidos() {
  const { user } = useAppUser();
  const decider = canDecideRequests(user?.publicMetadata.role);
  // O suporte consulta: sem separar, entregar, tratar nem definir a entrega.
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  const openingSession = useOpeningInventorySession();
  const { active: cliente, isLoading: clienteCarregando, falhou: clienteFalhou, codeProvavel } = useActiveCustomer();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"open" | "delivered">("open");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [driver, setDriver] = useState(() => remembered("motorista", "Equipe Dutelog"));
  const [plate, setPlate] = useState(() => remembered("placa", ""));
  const [receivedBy, setReceivedBy] = useState("");
  // "Tratar": a tarefa bloqueada do pedido abre aqui mesmo, num painel.
  const [treating, setTreating] = useState<OrderGroup | null>(null);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});
  // A entrega do pedido (parte 4.5c): só com a Operação liberada, que abre a demanda da entrega pela Dutelog.
  const [entregaForm, setEntregaForm] = useState<FormularioDaEntrega | null>(null);
  const [entregaTentou, setEntregaTentou] = useState(false);
  const [entregaErro, setEntregaErro] = useState<string | null>(null);
  const chaveDaEntrega = useRef<string | null>(null);
  // Cancelar pedido (pergunta 59): a coordenação, com o motivo.
  const [cancelReason, setCancelReason] = useState("");
  const chaveDoCancelamento = useRef<string | null>(null);
  // A linha que abriu o diálogo (a recusa, a entrega, o Entregue, o cancelamento) e o controle que estava com o foco:
  // o diálogo que fecha devolve o foco a ela ou, se ela saiu, à seguinte, e nunca ao corpo.
  const linhaDoDialogo = useRef<{ chave: string; abridor: Element | null } | null>(null);
  const lembrarDaLinha = (chave: string) => {
    linhaDoDialogo.current = { chave, abridor: typeof document === "undefined" ? null : document.activeElement };
  };
  // A leitura ao vivo das entregas que falha não se refaz sozinha: "Tentar de novo", na linha, assina de novo, e a
  // falha fica até a nova responder (`useLeitura`; carregamento v2, partes 13c e 13g). Quando ela chega, o foco vai à
  // entrega da linha.
  const [tentandoEntregas, setTentandoEntregas] = useState(false);
  const entregas = useLeitura(
    OPERACAO_LIBERADO ? "orders:em_aberto" : null,
    (db) => query(collection(db, "orders"), where("status", "in", PEDIDOS_EM_ABERTO)),
    (id, data) => ({ id, entrega: entregaDoPedido(data) }),
  );
  const entregasFalharam = entregas.erro;
  const entregaPorPedido = useMemo(() => new Map((entregas.itens ?? []).map((item) => [item.id, item.entrega])), [entregas.itens]);
  const entregaDe = (order: OrderGroup): EntregaDoPedido | null => (order.orderId ? entregaPorPedido.get(order.orderId) ?? null : null);

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests"],
    queryFn: () =>
      fetchJson<{ items: CustomerRequest[] }>("/api/customer-requests?limit=200"),
    enabled: decider,
    refetchInterval: 60_000,
  });
  const balances = useQuery({
    queryKey: ["stock-balances", "customer-requests"],
    queryFn: () =>
      fetchJson<{ items: StockBalance[] }>("/api/stock-balances?limit=500"),
    enabled: decider,
    refetchInterval: 120_000,
    retry: 1,
  });

  // Aprovar e recusar por linha (carregamento v2, momento 4): aprovar a 1042
  // deixa as outras livres, e a linha decidida fica na fila enquanto o botão
  // diz "Aprovado" (1 s e até a releitura chegar).
  const linhas = useAcaoNaLinha<string>();
  // O toast do sucesso sai uma vez por decisão, venha da resposta ou do "Conferir".
  const avisadas = useRef(new Set<string>());
  // As solicitações aprovadas nesta tela: o pedido delas chega a "Para separar" com o realce.
  const aprovadasAqui = useRef(new Set<string>());
  const queue = useMemo(
    () => buildOrderQueue({ requests: requests.data?.items, ops: ops.data, segurar: linhas.ocupada }),
    [ops.data, requests.data?.items, linhas],
  );
  // A falha sem nada lido fica na tela durante a releitura automática (o intervalo de 60 s): o aviso, o "Tentar de
  // novo" e o foco nele. Só a nova tentativa que a pessoa pede volta às linhas-fantasma.
  const opsNaTela = useFalhaNaReleituraAutomatica(ops);
  const requestsNaTela = useFalhaNaReleituraAutomatica(requests);
  const loading = opsNaTela.isLoading || (decider && requestsNaTela.isLoading);
  // A linha decidida sai sem salto (carregamento v2, momento 4): depois do
  // "Aprovado", esmaece e as de baixo sobem; sob o dedo, espera até 3 s. O
  // pedido só entra em "Para separar" quando a linha dele deixou "Para
  // aprovar": nunca nos dois grupos ao mesmo tempo. O palco da tela leva
  // junto o cartão, os títulos e os grupos de baixo, e a saída e a chegada
  // refluem de uma vez. Só o pedido aprovado nesta tela chega com o realce; o
  // que chega pela releitura ou pelo tempo real, sem sinal (momento 7).
  // A primeira leitura com dado entra de uma vez, também a que vem depois de
  // uma falha ou sem rede: ela não chega, aparece.
  const palco = usePalcoSemSaltos();
  const lida = Boolean(ops.data) && (!decider || Boolean(requests.data));
  // A linha que sai é desenhada com o dado que ainda houver; sem ele, fica a última imagem dela.
  const solicitacoes = useMemo(() => new Map((requests.data?.items ?? []).map((request) => [request.id, request])), [requests.data?.items]);
  const pedidos = useMemo(
    () => new Map([...queue.pick, ...queue.deliver, ...queue.delivered].map((order) => [order.key, order])),
    [queue.pick, queue.deliver, queue.delivered],
  );
  const chavesParaAprovar = useMemo(() => (decider ? queue.approve.map((request) => request.id) : []), [decider, queue.approve]);
  const paraAprovar = useListaSemSaltos(chavesParaAprovar, { pronta: lida, palco });
  const naFilaDeAprovar = useMemo(() => new Set(paraAprovar.chaves), [paraAprovar.chaves]);
  const chavesParaSeparar = useMemo(
    () => queue.pick.filter((order) => !order.requestId || !naFilaDeAprovar.has(order.requestId)).map((order) => order.key),
    [queue.pick, naFilaDeAprovar],
  );
  const aprovadoAqui = (key: string) => {
    const requestId = pedidos.get(key)?.requestId;
    return Boolean(requestId && aprovadasAqui.current.has(requestId));
  };
  const paraSeparar = useListaSemSaltos(chavesParaSeparar, { pronta: lida, palco, realcar: aprovadoAqui });
  // Do mesmo jeito, o pedido separado só entra em "Para entregar" quando a linha dele deixou "Para separar";
  // e o entregue (ou o que a releitura tirou) sai dela sem salto.
  const naFilaDeSeparar = useMemo(() => new Set(paraSeparar.chaves), [paraSeparar.chaves]);
  const chavesParaEntregar = useMemo(
    () => queue.deliver.filter((order) => !naFilaDeSeparar.has(order.key)).map((order) => order.key),
    [queue.deliver, naFilaDeSeparar],
  );
  const paraEntregar = useListaSemSaltos(chavesParaEntregar, { pronta: lida, palco });
  const entries = useMemo(() => queueEntries(normalizeQueues(ops.data?.queues)), [ops.data?.queues]);
  const actions = useWarehouseTaskActions({
    findEntry: (taskId) => entries.find((entry) => entry.task.id === taskId),
  });
  const treatingTask = treating
    ? [treating.pick, treating.pack, treating.ship].find((task) => task?.blocked_reason) ??
      (treating.stage === "separar" ? treating.pick : treating.ship)
    : undefined;
  // Procura pelo id: depois de avançar, a tarefa vem atualizada do servidor.
  const treatingEntry = treatingTask
    ? entries.find((entry) => entry.task.id === treatingTask.id)
    : undefined;

  const releitura = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-balances"] }),
    ]);
  const refreshAll = () => {
    void releitura();
  };
  /**
   * Fecha o diálogo da ação que terminou, e só ele. Com a ação por linha, a
   * recusa de uma solicitação pode abrir o diálogo dela enquanto a entrega
   * ou o cancelamento ainda grava, e o fim deles não a fecha.
   */
  const fecharDialogo = (kind: NonNullable<DialogState>["kind"]) =>
    setDialog((atual) => (atual?.kind === kind ? null : atual));

  const onError = (error: unknown) =>
    toast({
      title: "Não consegui atualizar o pedido",
      description: humanApiError(error, "Tente novamente em instantes."),
      variant: "destructive",
    });

  /** O retorno da decisão que valeu: o toast, uma vez, e a recusa fecha o diálogo dela. */
  const decisaoValeu = (request: CustomerRequest, acao: AcaoDaSolicitacao) => {
    const marca = `${request.id}:${acao}`;
    if (avisadas.current.has(marca)) return;
    avisadas.current.add(marca);
    if (acao === "aprovar") {
      aprovadasAqui.current.add(request.id);
      toast({ title: `${requestTitle(request)} aprovado` });
      return;
    }
    toast({ title: "Solicitação recusada." });
    setDialog((atual) => (atual?.kind === "reject" && atual.request.id === request.id ? null : atual));
  };

  /** O "Conferir" dos 70 s: relê a solicitação e nunca reenvia. */
  const conferirDecisao = async (request: CustomerRequest, acao: AcaoDaSolicitacao) => {
    const atual = await fetchJson<CustomerRequest>(`/api/customer-requests/${encodeURIComponent(request.id)}`);
    const status = String(atual.status ?? "").toLowerCase();
    const valeu = acao === "aprovar" ? status === "approved" || status === "closed" : status === "rejected";
    if (valeu) decisaoValeu(request, acao);
    // Decidida por outra pessoa: a lista se atualiza, e a linha sai.
    else if (!isAwaitingDecision(atual.status)) refreshAll();
    return valeu;
  };

  /**
   * Aprovar ou recusar pela callable de sempre, com a chave de idempotência
   * da tentativa que a linha dá: a mesma depois do "Conferir" e quando o
   * resultado ficou incerto. A linha ocupada não chama de novo.
   */
  const decidir = (request: CustomerRequest, acao: AcaoDaSolicitacao, reason?: string) => {
    const expected = String(request.status || "open").toLowerCase();
    void linhas.executar(
      request.id,
      acao,
      (chave) =>
        fetchJson(`/api/customer-requests/${encodeURIComponent(request.id)}/${ROTA_DA_ACAO[acao]}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_status: expected, reason, idempotency_key: chave }),
        }).then(
          (resultado) => {
            decisaoValeu(request, acao);
            return resultado;
          },
          (erro: unknown) => {
            // Sem resposta, a linha fica com o "Conferir"; o resto, o toast também diz.
            if (desfechoDoErro(erro) !== "sem-resposta") onError(erro);
            throw erro;
          },
        ),
      { conferir: () => conferirDecisao(request, acao), releitura },
    );
  };

  // Mesmas chamadas da antiga tela "Separar e enviar": cada etapa do WMS
  // continua gravada no backend; a tela só encadeia.
  const advance = async (
    taskUid: string,
    expectedStatus: string,
    operation?: Record<string, unknown>,
  ) =>
    fetchJson(`/api/warehouse/tasks/${encodeURIComponent(taskUid)}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_status: expectedStatus,
        operation,
        idempotency_key: `${taskUid}:${expectedStatus}`,
      }),
    });

  const salvarEntrega = useMutation({
    mutationFn: async ({ orderId, form }: { orderId: string; form: FormularioDaEntrega }) => {
      chaveDaEntrega.current ??= novaChave();
      await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedidoDaEntrega(form, orderId, chaveDaEntrega.current)),
      });
      // A entrega pela Dutelog vira demanda e OS na Operação; a retirada pelo cliente, não.
      if (form.modo !== "dutelog") return null;
      return chamarOperacao<{ numero: string }>("openStorageDemand", { idempotency_key: chaveDaEntrega.current, order_id: orderId });
    },
    onSuccess: (aberta) => {
      chaveDaEntrega.current = null;
      fecharDialogo("entrega");
      toast({ title: aberta ? `Demanda ${aberta.numero} aberta na Operação` : "Entrega salva" });
      refreshAll();
    },
    onError: (error: Error) => setEntregaErro(humanApiError(error, "Tente novamente em instantes.")),
  });

  const cancelar = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => {
      chaveDoCancelamento.current ??= novaChave();
      return fetchJson(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, idempotency_key: chaveDoCancelamento.current }),
      });
    },
    onSuccess: () => {
      chaveDoCancelamento.current = null;
      toast({ title: "Pedido cancelado" });
      fecharDialogo("cancel");
      setCancelReason("");
      refreshAll();
    },
    onError,
  });

  const abrirCancelamento = (order: OrderGroup) => {
    if (!order.orderId) return;
    chaveDoCancelamento.current = null;
    setCancelReason("");
    lembrarDaLinha(order.key);
    setDialog({ kind: "cancel", order, orderId: order.orderId });
  };
  // O "⋯" do pedido ainda no armazém, só para quem decide (owner, admin e interno).
  const menuDo = (order: OrderGroup) =>
    decider && pedidoCancelavel(order) ? (
      <MenuDoPedido order={order} disabled={busy} onCancelar={() => abrirCancelamento(order)} />
    ) : undefined;

  const abrirEntrega = (order: OrderGroup) => {
    if (!order.orderId) return;
    chaveDaEntrega.current = null;
    setEntregaForm(formularioDaEntrega(entregaDe(order), hojeIso()));
    setEntregaTentou(false);
    setEntregaErro(null);
    lembrarDaLinha(order.key);
    setDialog({ kind: "entrega", order, orderId: order.orderId });
  };

  // A entrega anda em etapas (a saída e a entrega), e o fim fica no botão:
  // o erro por 2 s, ou o "Conferir" do prazo sem resposta, que relê a fila.
  // O fim é do pedido daquele diálogo: abrir a entrega de outro começa do zero.
  const [etapaDaEntrega, setEtapaDaEntrega] = useState(0);
  const [fimDaEntrega, setFimDaEntrega] = useState<"erro" | "sem-resposta" | null>(null);
  const [conferindoEntrega, setConferindoEntrega] = useState(false);
  const zerarEntrega = () => {
    setFimDaEntrega(null);
    setEtapaDaEntrega(0);
  };
  const entregou = () => {
    toast({ title: "Entrega confirmada. Estoque baixado." });
    setFimDaEntrega(null);
    setEtapaDaEntrega(0);
    fecharDialogo("deliver");
    setReceivedBy("");
    refreshAll();
  };
  const deliver = useMutation({
    mutationFn: async ({ order }: { order: OrderGroup }) => {
      const shipUid = String(order.ship?.id ?? "");
      if (!shipUid) throw new Error("Pedido sem expedição criada.");
      setFimDaEntrega(null);
      if (order.stage === "enviar") {
        setEtapaDaEntrega(1);
        remember("motorista", driver.trim());
        remember("placa", plate.trim());
        await advance(shipUid, "ready_to_dispatch", {
          carrier: "Dutelog",
          driver_name: driver.trim(),
          vehicle_plate: plate.trim(),
        });
      }
      setEtapaDaEntrega(2);
      await advance(shipUid, "dispatched", {
        proof_reference: receivedBy.trim() || "Entrega própria Dutelog",
        delivery_notes: "Recebido pelo cliente.",
      });
    },
    onSuccess: entregou,
    onError: (error) => {
      // Sem resposta no prazo, a etapa pode ter valido: "Conferir" relê, e a chave de cada etapa é a mesma.
      if (desfechoDoErro(error) === "sem-resposta") {
        setFimDaEntrega("sem-resposta");
        return;
      }
      setFimDaEntrega("erro");
      onError(error);
    },
  });
  useEffect(() => {
    if (fimDaEntrega !== "erro") return undefined;
    const volta = setTimeout(() => setFimDaEntrega((atual) => (atual === "erro" ? null : atual)), CARREGANDO.erroVisivelMs);
    return () => clearTimeout(volta);
  }, [fimDaEntrega]);
  // Conferindo, o estado continua sem resposta: o botão diz "Conferindo…", e não a entrega de novo.
  const estadoDaEntrega: EstadoDaAcao = deliver.isPending ? "andamento" : (fimDaEntrega ?? "repouso");
  const entregaOcupada = estadoDaEntrega === "andamento" || conferindoEntrega;
  const esperaDaEntrega = useEspera(deliver.isPending);
  /**
   * O "Conferir" do prazo sem resposta: relê a fila e nunca reenvia. Entregue
   * por lá, segue o sucesso. Cancelado por outra pessoa enquanto esperava, o
   * diálogo fecha e diz que a entrega não valeu. No resto (ainda para
   * entregar, ou fora da fila), volta a "Confirmar entrega": a nova tentativa
   * leva a mesma chave de cada etapa, e a que já valeu devolve o recibo.
   */
  const conferirEntrega = async (order: OrderGroup) => {
    if (conferindoEntrega) return;
    setConferindoEntrega(true);
    try {
      const lida = await queryClient.fetchQuery({ queryKey: ["warehouse-ops"], queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"), staleTime: 0 });
      const saida = queueTasks(lida, "expedition").find((tarefa) => String(tarefa.id) === String(order.ship?.id ?? ""));
      const status = String(saida?.status ?? "");
      if (status === "delivered") {
        entregou();
      } else if (status === "cancelled" || status === "canceled") {
        zerarEntrega();
        fecharDialogo("deliver");
        toast({ title: "Entrega não confirmada", description: "O pedido foi cancelado.", variant: "destructive" });
        refreshAll();
      } else {
        setFimDaEntrega(null);
      }
    } catch (error) {
      onError(error);
    } finally {
      setConferindoEntrega(false);
    }
  };

  /**
   * Fecha o diálogo. A entrega que ficou sem resposta não passa para o pedido
   * seguinte: o fim dela sai, e a fila relê para a linha dizer onde o pedido
   * está.
   */
  const fecharEntregaOuDialogo = () => {
    if (dialog?.kind === "deliver") {
      if (fimDaEntrega === "sem-resposta") refreshAll();
      zerarEntrega();
    }
    setDialog(null);
  };

  // Aprovar e recusar ficam de fora: cada linha de "Para aprovar" tem o próprio estado.
  const busy = deliver.isPending || salvarEntrega.isPending || cancelar.isPending;
  /** A ação do diálogo aberto que ainda grava: nada fecha o diálogo até ela acabar (parte 13a). */
  const dialogoOcupado =
    (dialog?.kind === "deliver" && entregaOcupada) ||
    (dialog?.kind === "cancel" && cancelar.isPending) ||
    (dialog?.kind === "entrega" && salvarEntrega.isPending) ||
    (dialog?.kind === "reject" && linhas.estado(dialog.request.id, "recusar") === "andamento");
  /**
   * O diálogo devolve o foco à linha que o abriu (2.4.3), no lugar do corpo
   * da página, onde o Radix o poria sem DialogTrigger. Com a linha ainda na
   * fila, ao controle que o abriu ou à ação dela; quando a releitura a tirar
   * depois, a fila leva o foco à seguinte. Se ela já saiu (entregue,
   * cancelado), à ação da seguinte ou ao título do grupo de onde ela saiu por
   * último: o pedido que passou de "Para separar" a "Para entregar" volta em
   * "Para entregar".
   */
  const devolverFocoDoDialogo = (evento: Event) => {
    const aberto = linhaDoDialogo.current;
    linhaDoDialogo.current = null;
    if (!aberto) return;
    const filas = [paraAprovar, paraSeparar, paraEntregar];
    const ultimaSaida = filas
      .map((fila) => fila.saida(aberto.chave))
      .reduce<{ foco: HTMLElement | null; em: number } | null>((ultima, saida) => (saida && (!ultima || saida.em > ultima.em) ? saida : ultima), null);
    const destino = filas.map((fila) => fila.focoNaLinha(aberto.chave, aberto.abridor)).find(Boolean) ?? ultimaSaida?.foco;
    if (!destino) return;
    evento.preventDefault();
    destino.focus();
  };
  // O diálogo que sai (200 ms) mostra o que mostrava, com a mesma largura: o
  // fim não esvazia o cartão nem tira o botão que tem o foco (que cairia no
  // body até o diálogo sair). O seguinte que abre toma o lugar.
  const [dialogoNaTela, setDialogoNaTela] = useState<DialogState>(null);
  if (dialog !== null && dialog !== dialogoNaTela) setDialogoNaTela(dialog);
  const dialogoVisivel = dialog ?? dialogoNaTela;
  // A tabela do cancelamento pede um diálogo mais largo.
  const larguraDoDialogo = cn("sm:max-w-[440px]", dialogoVisivel?.kind === "cancel" && "sm:max-w-[560px]");

  /** A entrega do pedido na linha e a ação de definir (ou abrir na Operação), com a Operação liberada. */
  const daEntrega = (order: OrderGroup) => {
    if (!OPERACAO_LIBERADO || !order.orderId) return {};
    // Antes de ler as entregas, a linha não oferece "Entrega" (o formulário abriria vazio sobre a entrega que já
    // existe); a leitura que falhou diz, e não some (carregamento v2, parte 13c; o diagnóstico, 4.3).
    if (entregas.itens === null) {
      if (!entregasFalharam) return {};
      return {
        detail: "Não consegui carregar a entrega.",
        secondary: operador ? (
          <SaiComOFoco alvo={`entrega-${order.key}`}>
            <BotaoDeAcao
              variant="outline"
              estado={tentandoEntregas ? "andamento" : "repouso"}
              rotulo="Tentar de novo"
              andamento="Tentando de novo…"
              onClick={() => {
                setTentandoEntregas(true);
                void entregas.tentar().finally(() => setTentandoEntregas(false));
              }}
            />
          </SaiComOFoco>
        ) : undefined,
      };
    }
    const entrega = entregaDe(order);
    const resumo = entrega ? [resumoDaEntrega(entrega), naOperacao(entrega)].filter(Boolean).join(" · ") : null;
    return {
      detail: resumo,
      secondary: operador ? (
        <Button id={`entrega-${order.key}`} type="button" variant="outline" disabled={busy} onClick={() => abrirEntrega(order)}>
          {faltaAbrirNaOperacao(entrega) ? "Abrir na Operação" : entrega ? "Alterar entrega" : "Entrega"}
        </Button>
      ) : undefined,
    };
  };
  // Na v3, só a primeira linha da fila tem a ação principal; as outras são
  // secundárias. É a primeira na tela: quando ela sai, a nova primeira herda.
  const naTela = {
    approve: paraAprovar.chaves.map((id) => ({ id })),
    pick: paraSeparar.chaves.map((key) => ({ key })),
    deliver: paraEntregar.chaves.map((key) => ({ key })),
  };
  const principal = chaveDaPrincipal(naTela, decider);
  const variante = (chave: string) => (principal === chave ? "default" : "outline");
  const openCount =
    (decider ? paraAprovar.chaves.length : 0) + paraSeparar.chaves.length + paraEntregar.chaves.length;
  // A leitura falhou sem nada para mostrar: a tela diz isso, em vez de
  // "Nenhum pedido para…" (docs/plataforma/diagnostico-carregamento.md,
  // decisão 6 de 06/11/2026). Com a lista já lida, a falha de uma atualização
  // não a apaga.
  const semLeitura = (opsNaTela.isError && !ops.data) || (decider && requestsNaTela.isError && !requests.data);
  // Sem rede, a lista que já estava fica, com a hora da leitura; sem nada
  // lido, o aviso (decisão 2 do celular).
  const semRede = semConexaoNaLeitura(ops, ...(decider ? [requests] : []));
  const relendo = ops.isFetching || requests.isFetching;
  // A linha de estado sob o título e o Atualizar (carregamento v2, parte 7b):
  // a releitura automática de 60 s não mostra nada; o Atualizar só mostra a
  // espera quando a pessoa toca nele; a volta do app ao primeiro plano relê
  // com a barra no topo do primeiro cartão. Os saldos da validação relêem
  // junto do toque.
  const leiturasDaLista = decider ? [opsNaTela, requestsNaTela] : [opsNaTela];
  const atualizarLista = useAtualizarLista(leiturasDaLista, () => void queryClient.invalidateQueries({ queryKey: ["stock-balances"] }));
  const barraDoTopo = <BarraDeEspera lugar="topo" ativa={atualizarLista.voltando} resultado="fim" />;

  // A lista com a forma final na primeira leitura (carregamento v2, momento 2, decisão P3): os títulos reais
  // desde 0 ms, com o bloco no lugar do número; as linhas-fantasma na altura da última contagem lida deste
  // cliente; o contêiner aria-busy, descrito pela linha de estado. Na chegada, as linhas reais entram em
  // cascata, e o Anunciador diz o resumo (só se disse "Carregando pedidos").
  // A leitura que falhou sem dado não espera a outra: o aviso entra no lugar da lista na hora.
  const lendo = loading && !semLeitura;
  const idDaLinha = useId();
  // A contagem lembrada é do cliente que a tela vai operar: na abertura, antes de a lista dos clientes chegar, o
  // escolhido neste aparelho. Só grava com o cliente confirmado (nem lendo, nem com a lista dos clientes que falhou),
  // e só os grupos que quem vê tem: "Para aprovar" fica com a contagem de quem decide.
  const contagensLidas: ContagensDaLista | null =
    lida && !clienteCarregando && !clienteFalhou
      ? {
          ...(decider ? { aprovar: chavesParaAprovar.length } : {}),
          separar: chavesParaSeparar.length,
          entregar: chavesParaEntregar.length,
          entregues: queue.delivered.length,
        }
      : null;
  const contagem = useContagemLembrada("pedidos", codeProvavel ?? cliente.code, contagensLidas);
  const fantasmas = (grupo: string, acoes: 0 | 1 | 2, ordem: number, forma: Pick<CarregandoDoGrupo, "atalho" | "acoesAbaixo"> = {}) =>
    lendo ? { linhas: contagem.linhas(grupo), acoes, ordem, ...forma } : undefined;
  const resumo =
    view === "delivered"
      ? resumoDaLista([{ quantos: queue.delivered.length, um: "entregue", varios: "entregues" }], "Nenhuma entrega recente")
      : resumoDaLista(
          [
            ...(decider ? [{ quantos: chavesParaAprovar.length, um: "para aprovar" }] : []),
            { quantos: chavesParaSeparar.length, um: "para separar" },
            { quantos: chavesParaEntregar.length, um: "para entregar" },
          ],
          "Nenhum pedido em aberto",
        );
  const naCascata = { separar: decider ? paraAprovar.chaves.length : 0, entregar: (decider ? paraAprovar.chaves.length : 0) + paraSeparar.chaves.length };
  const listaOcupada = lendo ? { "aria-busy": true, "aria-describedby": idDaLinha } : {};

  return (
    <div ref={palco.ref} className="mx-auto flex max-w-5xl flex-col gap-6 pb-24">
      <PageHeader
        title="Pedidos"
        estado={<LinhaDeEstado id={idDaLinha} leitura={leiturasDaLista} objeto="pedidos" pedidaPelaPessoa={atualizarLista.voltando} resumo={resumo} />}
        actions={
          <>
            <Segmented<"open" | "delivered">
              value={view}
              onChange={setView}
              aria-label="Pedidos em aberto ou entregues"
              cheioNoCelular
              options={[
                // Lendo, o bloco; sem nada lido (a falha, a falta de conexão), o "—": nunca o rótulo só, como se não houvesse pedido.
                { value: "open", label: "Em aberto", count: lendo ? null : semLeitura || (semRede && semRede.lidaEm === null) ? "falhou" : openCount },
                { value: "delivered", label: "Entregues" },
              ]}
            />
            <BotaoAtualizar atualizando={atualizarLista.atualizando} travado={loading} onAtualizar={atualizarLista.atualizar} />
          </>
        }
      />

      <OpeningInventoryNotice
        session={openingSession.data}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/wms/contagem">Continuar contagem</Link>
          </Button>
        }
      />

      {/* A falta com a lista lida fica na linha de estado, sob o título; a primeira leitura, também, com a lista
          na forma final, com as linhas-fantasma. */}
      {!lendo && semRede && semRede.lidaEm === null ? (
        <BlocoSemConexao tentando={relendo} onTentar={refreshAll} focoAoSair={idDaLinha} />
      ) : !lendo && semLeitura ? (
        <ErroNaLeitura
          mensagem="Não consegui carregar os pedidos."
          tentando={relendo}
          onTentar={refreshAll}
          focoAoSair={idDaLinha}
        />
      ) : view === "delivered" ? (
        <div className="flex flex-col gap-6" {...listaOcupada}>
          <QueueGroup
            title="Entregues"
            count={lendo ? null : queue.delivered.length}
            empty="Nenhuma entrega recente."
            barraDoTopo={barraDoTopo}
            carregando={fantasmas("entregues", 0, 0)}
          >
            {queue.delivered.map((order) => (
              <OrderRow key={order.key} order={order} icon={Check} tone="done" />
            ))}
          </QueueGroup>
          <Link href="/orders" className="px-1 text-sm text-primary hover:underline">
            Ver histórico completo de pedidos
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6" {...listaOcupada}>
          {decider ? (
            <QueueGroup
              title="Para aprovar"
              count={lendo ? null : paraAprovar.chaves.length}
              carregando={fantasmas("aprovar", 2, 0)}
              rolarContagem
              contagemNaArvore={paraAprovar.quantasFicam}
              semSaltos
              listaRef={paraAprovar.ref}
              tituloRef={paraAprovar.titulo}
              barraDoTopo={barraDoTopo}
              empty={
                <>
                  {ordersGroupEmpty("approve")}{" "}
                  <Link href="/solicitacoes" className="font-semibold text-primary-texto hover:underline">
                    Ver solicitações
                  </Link>
                </>
              }
            >
              {paraAprovar.chaves.map((id) => {
                const request = solicitacoes.get(id);
                return (
                  <LinhaDaFila key={id} lista={paraAprovar} chave={id}>
                    {request ? (
                      <LinhaParaAprovar
                        request={request}
                        validation={buildBalanceValidation(request, balances.data?.items, balances.isLoading, Boolean(balances.error))}
                        linhas={linhas}
                        variant={variante(`approve:${request.id}`)}
                        onAprovar={() => decidir(request, "aprovar")}
                        onRecusar={() => {
                          // Sem resposta, o Recusar é o "Conferir": relê, sem abrir o diálogo.
                          if (linhas.estado(request.id, "recusar") === "sem-resposta") {
                            decidir(request, "recusar");
                            return;
                          }
                          setRejectReason("");
                          lembrarDaLinha(request.id);
                          setDialog({ kind: "reject", request });
                        }}
                      />
                    ) : null}
                  </LinhaDaFila>
                );
              })}
            </QueueGroup>
          ) : null}

          <QueueGroup
            title="Para separar"
            count={lendo ? null : paraSeparar.chaves.length}
            carregando={fantasmas("separar", operador ? 1 : 0, decider ? 1 : 0, { acoesAbaixo: true })}
            cascata={naCascata.separar}
            rolarContagem
            contagemNaArvore={paraSeparar.quantasFicam}
            semSaltos
            listaRef={paraSeparar.ref}
            tituloRef={paraSeparar.titulo}
            barraDoTopo={decider ? undefined : barraDoTopo}
            empty={ordersGroupEmpty("pick")}
          >
            {paraSeparar.chaves.map((key) => {
              const order = pedidos.get(key);
              return (
                <LinhaDaFila key={key} lista={paraSeparar} chave={key}>
                  {order ? (
                    <OrderRow
                      order={order}
                      icon={Package}
                      tone="pick"
                      paraQuando={paraQuandoDoPedido(order, requests.data?.items)}
                      lerParaQuando={!decider}
                      // O pedido por separar abre com os itens; o que já está em separação, fechado (a bancada mostra).
                      defaultOpen={!separacaoComecou(order.pick, order.pick?.items ?? [])}
                      listaHref={hrefDaListaDeSeparacao(order.key)}
                      onTreat={operador ? () => setTreating(order) : undefined}
                      {...daEntrega(order)}
                      menu={menuDo(order)}
                      // "Separar" abre a bancada do pedido; com a separação começada, "Continuar" (parte 2).
                      action={
                        operador ? (
                          <Button asChild variant={variante(`pick:${order.key}`)} data-foco-da-linha="">
                            <Link href={hrefDaBancada(order.key)}>{separacaoComecou(order.pick, order.pick?.items ?? []) ? "Continuar" : "Separar"}</Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : null}
                </LinhaDaFila>
              );
            })}
          </QueueGroup>

          <QueueGroup
            title="Para entregar"
            count={lendo ? null : paraEntregar.chaves.length}
            carregando={fantasmas("entregar", operador ? 1 : 0, decider ? 2 : 1, { atalho: true, acoesAbaixo: true })}
            cascata={naCascata.entregar}
            rolarContagem
            contagemNaArvore={paraEntregar.quantasFicam}
            semSaltos
            listaRef={paraEntregar.ref}
            tituloRef={paraEntregar.titulo}
            empty={ordersGroupEmpty("deliver")}
          >
            {paraEntregar.chaves.map((key) => {
              const order = pedidos.get(key);
              return (
                <LinhaDaFila key={key} lista={paraEntregar} chave={key}>
                  {order ? (
                    <OrderRow
                      order={order}
                      icon={Truck}
                      tone="deliver"
                      paraQuando={paraQuandoDoPedido(order, requests.data?.items)}
                      lerParaQuando={!decider}
                      onTreat={operador ? () => setTreating(order) : undefined}
                      {...(order.stage === "enviar" ? daEntrega(order) : {})}
                      volumes={volumesDoPedidoNaFila(order)}
                      menu={menuDo(order)}
                      action={
                        operador ? (
                          <Button
                            type="button"
                            variant={variante(`deliver:${order.key}`)}
                            disabled={busy}
                            data-foco-da-linha=""
                            onClick={() => {
                              setReceivedBy("");
                              // Na retirada pelo cliente, quem leva e a placa vêm da entrega do pedido.
                              const saida = saidaPelaEntrega(entregaDe(order));
                              if (saida) {
                                setDriver(saida.motorista);
                                setPlate(saida.placa);
                              }
                              lembrarDaLinha(order.key);
                              zerarEntrega();
                              setDialog({ kind: "deliver", order });
                            }}
                          >
                            <Check className="size-4" />
                            Entregue
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : null}
                </LinhaDaFila>
              );
            })}
          </QueueGroup>
        </div>
      )}

      <Dialog
        open={dialog !== null}
        // A ação que grava segura o diálogo: a entrega que anda (ou confere), o
        // cancelamento, a entrega que salva e a recusa em andamento.
        ocupado={dialogoOcupado}
        onOpenChange={(open) => {
          if (!open) fecharEntregaOuDialogo();
        }}
      >
        <DialogContent className={larguraDoDialogo} aria-describedby={undefined} onCloseAutoFocus={devolverFocoDoDialogo}>
          {dialogoVisivel?.kind === "reject" ? (
            <>
              <DialogHeader>
                <DialogTitle>Recusar solicitação</DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="motivo-da-recusa">Motivo</Label>
                <Textarea
                  id="motivo-da-recusa"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter>
                <DialogCancelar onClick={() => setDialog(null)}>Voltar</DialogCancelar>
                <BotaoDeAcao
                  variant="destructive"
                  estado={linhas.estado(dialogoVisivel.request.id, "recusar")}
                  rotulo="Recusar"
                  andamento="Recusando…"
                  sucesso="Recusado"
                  erro="Não recusado"
                  bloqueado={recusaTravada(
                    linhas.estado(dialogoVisivel.request.id, "recusar"),
                    linhas.ocupada(dialogoVisivel.request.id),
                    rejectReason,
                  )}
                  onClick={() => decidir(dialogoVisivel.request, "recusar", rejectReason.trim())}
                />
              </DialogFooter>
            </>
          ) : dialogoVisivel?.kind === "deliver" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialogoVisivel.order.orderNumber}: entregue</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                {dialogoVisivel.order.stage === "enviar" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="motorista">Quem levou</Label>
                      <Input
                        id="motorista"
                        value={driver}
                        onChange={(event) => setDriver(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="placa">Placa</Label>
                      <Input
                        id="placa"
                        value={plate}
                        onChange={(event) => setPlate(event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="recebido">Quem recebeu (opcional)</Label>
                  <Input
                    id="recebido"
                    value={receivedBy}
                    onChange={(event) => setReceivedBy(event.target.value)}
                  />
                </div>
              </div>
              {dialogoVisivel.order.stage === "enviar" ? (
                <Progresso
                  forma="etapas"
                  titulo="Confirmando a entrega"
                  itens={etapasDaEntrega(etapaDaEntrega, deliver.isPending)}
                />
              ) : null}
              <div data-lugar-do-aviso="" className="grid min-h-9 items-center">
                {deliver.isPending && esperaDaEntrega.calmo ? (
                  <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={esperaDaEntrega.decorridoMs} />
                ) : null}
                {estadoDaEntrega === "sem-resposta" ? <AvisoDeEspera fase="sem-resposta" tipo="escrita" /> : null}
              </div>
              <DialogFooter>
                <DialogCancelar className="min-h-11" onClick={fecharEntregaOuDialogo}>
                  Voltar
                </DialogCancelar>
                <BotaoDeAcao
                  className="min-h-11"
                  estado={conferindoEntrega ? "andamento" : estadoDaEntrega}
                  rotulo="Confirmar entrega"
                  andamento={conferindoEntrega ? "Conferindo…" : "Confirmando…"}
                  sucesso="Entregue"
                  erro="Não confirmada"
                  bloqueado={
                    estadoDaEntrega === "repouso" &&
                    (busy || (dialogoVisivel.order.stage === "enviar" && (!driver.trim() || !plate.trim())))
                  }
                  onClick={() => {
                    if (conferindoEntrega) return;
                    if (estadoDaEntrega === "sem-resposta") void conferirEntrega(dialogoVisivel.order);
                    else deliver.mutate({ order: dialogoVisivel.order });
                  }}
                />
              </DialogFooter>
            </>
          ) : dialogoVisivel?.kind === "cancel" ? (
            <>
              <DialogHeader>
                <DialogTitle>Cancelar pedido {dialogoVisivel.order.orderNumber}</DialogTitle>
                <p className="text-sm font-medium text-muted-foreground">
                  {[cliente.name, orderMeta(dialogoVisivel.order)].filter(Boolean).join(" · ")}
                </p>
              </DialogHeader>
              <CancelarPedidoView
                motivo={cancelReason}
                voltas={voltasDoPedido(dialogoVisivel.order)}
                onMotivo={(motivo) => {
                  setCancelReason(motivo);
                  chaveDoCancelamento.current = null;
                }}
              />
              <DialogFooter>
                <DialogCancelar onClick={() => setDialog(null)}>Voltar</DialogCancelar>
                <BotaoDeAcao
                  variant="destructive"
                  estado={cancelar.isPending ? "andamento" : "repouso"}
                  rotulo="Cancelar pedido"
                  andamento="Cancelando…"
                  bloqueado={!cancelar.isPending && (!motivoValido(cancelReason) || busy)}
                  onClick={() => cancelar.mutate({ orderId: dialogoVisivel.orderId, reason: cancelReason.trim() })}
                />
              </DialogFooter>
            </>
          ) : dialogoVisivel?.kind === "entrega" && entregaForm ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialogoVisivel.order.orderNumber}: entrega</DialogTitle>
              </DialogHeader>
              <form
                id="entrega-do-pedido"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setEntregaTentou(true);
                  if (Object.keys(problemasDaEntrega(entregaForm, new Date())).length) return;
                  setEntregaErro(null);
                  salvarEntrega.mutate({ orderId: dialogoVisivel.orderId, form: entregaForm });
                }}
              >
                <FormularioDaEntregaView
                  form={entregaForm}
                  problemas={entregaTentou ? problemasDaEntrega(entregaForm, new Date()) : {}}
                  onForm={(form) => {
                    setEntregaForm(form);
                    setEntregaErro(null);
                    chaveDaEntrega.current = null;
                  }}
                />
              </form>
              {entregaErro ? (
                <p role="alert" className="text-sm text-destructive">
                  {entregaErro}
                </p>
              ) : null}
              <DialogFooter>
                <DialogCancelar onClick={() => setDialog(null)}>Voltar</DialogCancelar>
                <BotaoDeAcao
                  type="submit"
                  form="entrega-do-pedido"
                  estado={salvarEntrega.isPending ? "andamento" : "repouso"}
                  rotulo={entregaForm.modo === "dutelog" ? "Salvar e abrir na Operação" : "Salvar entrega"}
                  andamento="Salvando…"
                  bloqueado={!salvarEntrega.isPending && busy}
                />
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={treating !== null} onOpenChange={(open) => !open && setTreating(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background p-4 sm:max-w-xl sm:p-5" aria-describedby={undefined}>
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>{treating ? `Tratar ${treating.orderNumber}` : "Tratar pedido"}</SheetTitle>
          </SheetHeader>
          <TaskDetailPanel
            entry={treatingEntry}
            alerts={ops.data?.alerts ?? []}
            lineConfirmations={lineConfirmations}
            advancingTaskId={actions.advancingTaskId}
            registeringExceptionId={actions.registeringExceptionId}
            onLineConfirmationChange={(taskId, rowId, resolution) =>
              setLineConfirmations((current) => ({
                ...current,
                [lineConfirmationKey(taskId, rowId)]: resolution,
              }))
            }
            onAdvance={(id, operation, note) => actions.advanceTask.mutate({ id, operation, note })}
            onOpenException={actions.exception.openFor}
          />
        </SheetContent>
      </Sheet>

      <ExceptionDialog
        open={actions.exception.open}
        taskEntry={actions.exception.entry ?? treatingEntry}
        note={actions.exception.note}
        isPending={actions.registerException.isPending}
        onOpenChange={actions.exception.onOpenChange}
        onNoteChange={actions.exception.setNote}
        onSubmit={(event) => actions.exception.submit(event, treatingEntry)}
      />
    </div>
  );
}

const SELO = cn(badgeVariants({ variant: "outline" }), "gap-1");

/**
 * A linha de "Para aprovar" com a ação por linha (carregamento v2, momento 4;
 * a prancha aprovada em 12/11/2026). O Aprovar vai a "Aprovando…", com a
 * barra na borda de baixo, e o Recusar da linha fica aria-disabled; as outras
 * linhas seguem livres. Aos 3 s o apoio diz o objeto ("Aprovando pedido
 * 1042…"); aos 10 s, a demora com o relógio, sem "Tentar de novo" (repetir
 * duplicaria); aos 70 s, o selo "Sem confirmação" e o "Conferir", que relê. O
 * erro fica na linha, com o selo e o motivo, até a próxima ação.
 */
function LinhaParaAprovar({
  request,
  validation,
  linhas,
  variant,
  onAprovar,
  onRecusar,
}: {
  request: CustomerRequest;
  validation: ReturnType<typeof buildBalanceValidation>;
  linhas: AcaoNaLinha<string>;
  variant: "default" | "outline";
  onAprovar: () => void;
  onRecusar: () => void;
}) {
  const aprovar = linhas.estado(request.id, "aprovar");
  const recusar = linhas.estado(request.id, "recusar");
  const ocupada = linhas.ocupada(request.id);
  const motivo = linhas.motivo(request.id);
  const andando: AcaoDaSolicitacao | null = aprovar === "andamento" ? "aprovar" : recusar === "andamento" ? "recusar" : null;
  const semResposta = aprovar === "sem-resposta" || recusar === "sem-resposta";
  const espera = useEspera(andando !== null);
  const titulo = requestTitle(request);
  const emAndamento = andando ? `${andando === "aprovar" ? "Aprovando" : "Recusando"} ${noMeioDaFrase(titulo)}` : null;

  // O leitor de tela ouve a entrada na espera (aos 300 ms), a demora e a
  // desistência, pelo Anunciador da tela; o resultado, o toast diz. A espera
  // que acaba antes da vez do anúncio dela o tira da fila: ninguém ouve
  // "Aprovando pedido 1042" depois do "Aprovado".
  const anunciar = useAnuncio();
  const marco = andando && espera.visivel ? (espera.fase === "demorando" ? "demorando" : "espera") : semResposta ? "sem-resposta" : null;
  const anuncioDaEspera = emAndamento ? seisPalavras(emAndamento) : null;
  useEffect(() => {
    if (marco === "espera" && anuncioDaEspera) return anunciar(anuncioDaEspera);
    if (marco === "demorando") return anunciar("Demorando mais que o normal");
    if (marco === "sem-resposta") return anunciar("Sem confirmação do servidor");
    return undefined;
  }, [marco, anuncioDaEspera, anunciar]);

  // No lugar do meta da linha: aos 3 s o objeto ("Aprovando pedido 1042…"); aos 10 s, a demora com o relógio;
  // depois do erro, o motivo, até a próxima ação.
  const apoioEmAndamento = emAndamento && espera.fase === "com-objeto" ? `${emAndamento}…` : undefined;
  const aviso =
    andando && espera.fase === "demorando" ? (
      // Em linha, para quebrar como texto no celular.
      <span className="font-bold text-amber-soft-foreground">
        <Clock3 className="mr-1.5 inline size-3.5 align-middle" aria-hidden="true" />
        <span>Demorando mais que o normal</span>
        {" · "}
        <span className="tabular-nums">{relogioDaEspera(espera.decorridoMs)}</span>
      </span>
    ) : motivo && !apoioEmAndamento ? (
      <span className="font-bold text-destructive">{humanApiError(motivo.erro, "Tente novamente em instantes.")}</span>
    ) : undefined;

  const selo = semResposta ? (
    <span className={cn(SELO, "border-warning-soft-border bg-warning-soft text-amber-soft-foreground")}>
      <Clock3 className="size-3.5" aria-hidden="true" />
      Sem confirmação
    </span>
  ) : motivo ? (
    <span className={cn(SELO, "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground")}>
      <CaixaDeAlerta className="size-3.5" />
      {motivo.acao === "aprovar" ? "Não aprovado" : "Não recusado"}
    </span>
  ) : undefined;

  const resultado = aprovar === "sucesso" || recusar === "sucesso" ? "ok" : aprovar === "erro" || recusar === "erro" ? "erro" : undefined;
  // A linha ocupada mantém os botões, mesmo que a releitura mude a validação do saldo.
  const comAcoes = validation.canApprove || ocupada;

  return (
    <div className="relative">
      <QueueRow
        icon={ClipboardCheck}
        tone="approve"
        title={titulo}
        badge={selo}
        meta={requestSummary(request)}
        ocupada={andando !== null}
        apoioEmAndamento={apoioEmAndamento}
        aviso={aviso}
        detail={linhaDoParaQuando(request.due_at)}
        age={formatRequestAge(request.created_at)}
        note={
          comAcoes ? undefined : (
            <>
              <AlertTriangle className="size-3.5" />
              {validation.detail}
            </>
          )
        }
        actions={
          comAcoes ? (
            <>
              <BotaoDeAcao
                variant="outline"
                className="text-destructive hover:text-destructive"
                estado={recusar}
                rotulo="Recusar"
                andamento="Recusando…"
                sucesso="Recusado"
                erro="Não recusado"
                bloqueado={ocupada && recusar === "repouso"}
                onClick={onRecusar}
              />
              <BotaoDeAcao
                variant={variant}
                data-foco-da-linha=""
                estado={aprovar}
                icone={<Check className="size-4" />}
                rotulo="Aprovar"
                andamento="Aprovando…"
                sucesso="Aprovado"
                erro="Não aprovado"
                bloqueado={ocupada && aprovar === "repouso"}
                onClick={onAprovar}
              />
            </>
          ) : (
            <Button asChild variant="outline">
              <Link href={`/solicitacoes?id=${encodeURIComponent(request.id)}`}>Ver itens</Link>
            </Button>
          )
        }
      />
      <BarraDeEspera lugar="linha" ativa={andando !== null} resultado={resultado} />
    </div>
  );
}

/**
 * O "Para quando" da linha do pedido. A coordenação já tem o da lista das
 * solicitações; quem só separa não lê essa lista, e o prazo vem da
 * solicitação que originou o pedido, lida pelo id (docs/mockups/WmsSepararLista.dc.html).
 */
function useParaQuandoDoPedido(order: Pick<OrderGroup, "requestId">, daFila: string | undefined, ler: boolean): string | undefined {
  const requestId = !daFila && ler ? order.requestId : undefined;
  const solicitacao = useDocumento(
    requestId ? `customer_requests/${requestId}:para-quando` : null,
    (db) => doc(db, "customer_requests", requestId ?? "-"),
    (_id, data) => ({ dueAt: data.due_at as unknown }),
  );
  return daFila ?? (solicitacao.item ? linhaDoParaQuando(solicitacao.item.dueAt) : undefined);
}

/** A linha do pedido em separação ou entrega. Exportada para o teste (pedidos.lista.test.tsx). */
export function OrderRow({
  order,
  icon,
  tone,
  action,
  secondary,
  menu,
  detail,
  paraQuando: paraQuandoDaFila,
  lerParaQuando = false,
  defaultOpen = false,
  onTreat,
  listaHref,
  volumes,
}: {
  order: OrderGroup;
  icon: LucideIcon;
  tone: QueueTone;
  action?: ReactNode;
  /** A ação de definir a entrega (parte 4.5c), ao lado da principal. */
  secondary?: ReactNode;
  /** O "⋯" do pedido (Cancelar pedido, pergunta 59), depois das ações. */
  menu?: ReactNode;
  /** A entrega do pedido em uma linha. */
  detail?: ReactNode;
  /** "Para quando Qui 05/11 09:00", a data que o cliente pediu, antes da entrega. */
  paraQuando?: string;
  /** Quem não lê a lista das solicitações (o armazém) lê o prazo da solicitação do pedido, pelo id. */
  lerParaQuando?: boolean;
  defaultOpen?: boolean;
  onTreat?: () => void;
  /** A lista de separação do pedido para imprimir (separação com caixas, parte 1b). */
  listaHref?: string;
  /**
   * O pedido já separado (docs/mockups/WmsSepararParaEntregar.dc.html): "Ver
   * volumes" no lugar de "Ver itens", e "Etiquetas dos volumes" e "Romaneio"
   * antes das ações. No celular, os dois ficam atrás de "Ver volumes".
   */
  volumes?: VolumesDoPedidoNaFila;
}) {
  const acoes = action || secondary ? (
    <>
      {secondary}
      {action}
    </>
  ) : null;
  const [open, setOpen] = useState(defaultOpen);
  const items = orderItems(order);
  const blocked = Boolean(order.blockedReason || order.exceptionCount);
  const meta = orderMeta(order);
  const paraQuando = useParaQuandoDoPedido(order, paraQuandoDaFila, lerParaQuando);
  // O selo só no pedido ainda para separar: depois de concluída, a separação não é mais notícia.
  const selo = order.stage === "separar" ? seloDaSeparacao(order.pick, items) : null;
  // "Imprimir lista" (docs/mockups/WmsSepararLista.dc.html): no computador, um botão antes das ações do pedido.
  const imprimir =
    listaHref && items.length ? (
      <Button asChild variant="outline">
        <Link href={listaHref}>
          <Printer className="size-4" aria-hidden="true" />
          Imprimir lista
        </Link>
      </Button>
    ) : null;

  return (
    <div className={cn(blocked && "bg-destructive-soft/40")}>
      <QueueRow
        icon={icon}
        tone={tone}
        title={order.orderNumber}
        // "em separação desde 12/11 · 2 de 5 itens" (docs/mockups/WmsSepararParaEntregar.dc.html).
        badge={
          selo ? (
            <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
              {selo}
            </Badge>
          ) : undefined
        }
        meta={meta || "—"}
        note={
          blocked ? (
            <span className="flex items-center gap-1.5 text-destructive-soft-foreground">
              <AlertTriangle className="size-3.5" />
              {order.blockedReason ??
                `${order.exceptionCount} ${order.exceptionCount === 1 ? "exceção" : "exceções"}`}
              {onTreat ? (
                <button type="button" onClick={onTreat} className="font-medium underline">
                  Tratar
                </button>
              ) : null}
            </span>
          ) : undefined
        }
        detail={paraQuando && detail ? <>{paraQuando} · {detail}</> : paraQuando ?? detail}
        // O pedido já separado mostra os volumes, e não os itens.
        onToggle={items.length && !volumes ? () => setOpen((value) => !value) : undefined}
        open={open}
        // No celular os botões vêm depois dos itens: o atalho fica ao lado de "Esconder itens"
        // (docs/mockups/WmsSepararListaCelular.dc.html).
        aoLadoDoToggle={
          volumes ? (
            <Link href={volumes.verHref} className="inline-flex items-center gap-1 text-xs font-medium text-primary-texto">
              <ChevronRight className="size-3.5" aria-hidden="true" />
              Ver volumes
            </Link>
          ) : listaHref && items.length ? (
            <Link href={listaHref} className="text-xs font-medium text-foreground underline underline-offset-2 sm:hidden">
              Imprimir lista
            </Link>
          ) : undefined
        }
        actions={
          imprimir || volumes || acoes || menu ? (
            <>
              {imprimir}
              {volumes ? (
                <>
                  <Button asChild variant="outline">
                    <Link href={volumes.etiquetasHref}>Etiquetas dos volumes</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={volumes.romaneioHref}>
                      <Printer className="size-4" aria-hidden="true" />
                      Romaneio
                    </Link>
                  </Button>
                </>
              ) : null}
              {acoes}
              {menu}
            </>
          ) : null
        }
        actionsClassName={volumes ? "hidden sm:flex sm:flex-wrap sm:justify-end" : "hidden sm:flex"}
      />
      {/* A caixa só aparece enquanto o pedido está para separar: depois, o item já saiu dela. */}
      {open && items.length && !volumes ? <ItemList items={items} cliente={order.stage === "separar" ? order.pick?.customer_code : undefined} /> : null}
      {/* No celular os botões vêm depois da lista do que separar. */}
      {acoes || menu ? (
        <div className="flex gap-2 px-4 pb-4 pt-3 sm:hidden">
          {acoes ? <div className="flex flex-1 gap-2 [&>*]:flex-1">{acoes}</div> : null}
          {menu}
        </div>
      ) : null}
      {/* As caixas que o pedido abriu e que ainda estão com a etiqueta velha: a última linha do pedido. */}
      {volumes ? <EtiquetasDeCaixaDoPedido items={items} cliente={order.pick?.customer_code ?? order.ship?.customer_code} pedido={order.orderId ?? order.key} /> : null}
    </div>
  );
}

/**
 * "5 etiquetas de caixa para trocar" (docs/mockups/WmsSepararParaEntregar
 * .dc.html): as caixas que o pedido abriu e cuja etiqueta não é a do saldo de
 * agora, com "Imprimir". Sem caixa para trocar, nada.
 */
function EtiquetasDeCaixaDoPedido({ items, cliente, pedido }: { items: NonNullable<WarehouseTask["items"]>; cliente?: string | null; pedido: string }) {
  // Só lê as caixas do cliente quando alguma linha do pedido saiu de caixa.
  const saiuDeCaixa = items.some((item) => item.separated_boxes?.length);
  const caixas = useCaixasDoCliente(saiuDeCaixa ? cliente : null);
  const paraTrocar = useMemo(() => (caixas.data ? etiquetasParaTrocar(items, caixas.data) : []), [items, caixas.data]);
  // Com o pedido junto, a volta das etiquetas é ao pedido.
  return <AvisoDeEtiquetasDeCaixa quantas={paraTrocar.length} href={paraTrocar.length ? labelsUrl({ boxes: paraTrocar.map((caixa) => caixa.code), order: pedido }) : null} />;
}

/** Exportado para o teste (pedidos.lista.test.tsx). */
export function AvisoDeEtiquetasDeCaixa({ quantas, href }: { quantas: number; href: string | null }) {
  if (!quantas || !href) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-warning-soft-border bg-warning-soft px-4 py-2.5 text-sm font-semibold text-warning-soft-foreground md:px-5">
      {textoDeEtiquetasParaTrocar(quantas)}
      <Link href={href} className="font-bold underline underline-offset-2">
        Imprimir
      </Link>
    </p>
  );
}

function MenuDoPedido({
  order,
  disabled,
  onCancelar,
}: {
  order: OrderGroup;
  disabled: boolean;
  onCancelar: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Mais ações do pedido ${order.orderNumber}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onCancelar}>
          <XCircle className="size-4" />
          Cancelar pedido
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// O código do cliente e o SKU da linha moram com a regra da lista de separação.
export { codigosDoItem } from "@/lib/warehouse-ops/lista-de-separacao";

/**
 * Os itens do pedido por prateleira, na ordem de caminhada
 * (docs/mockups/WmsSepararLista.dc.html; o nome com o tamanho vem de
 * NomeWmsPedidos.dc.html): o cabeçalho da prateleira com os itens e as
 * unidades e, em cada linha, a foto, o nome com o tamanho ("Polo Masculino
 * Piquet Preto · GG"), os códigos, a caixa onde o item está e a quantidade.
 */
export function ItemList({ items, cliente }: { items: NonNullable<WarehouseTask["items"]>; cliente?: string | null }) {
  // Mesma foto do Estoque: quem separa confere o item pela imagem.
  const photoFor = useItemPhotos();
  const grupos = useListaDeSeparacao(items, cliente);
  return (
    <div className="border-t border-border/50 bg-muted/30 px-4 pb-2 md:px-5 md:pl-[4.6rem]">
      {grupos.map((grupo) => (
        <section key={grupo.posicao || "sem-endereco"}>
          <h3 className="flex items-baseline gap-2.5 pb-1 pt-3 text-sm font-medium text-muted-foreground">
            <span className="font-mono text-sm font-bold text-foreground">{grupo.posicao || "sem endereço"}</span>
            {resumoDoGrupo(grupo)}
          </h3>
          <ul>
            {grupo.linhas.map((linha) => {
              const photo = photoFor(linha.item.sku_code, linha.item.sku, linha.item.client_item_code);
              return (
                <li
                  key={linha.id}
                  className="flex items-start gap-3 border-t border-border/50 py-2 text-sm first:border-t-0 sm:items-center sm:border-t-0 sm:py-1.5"
                >
                  {photo ? (
                    <img
                      src={photo}
                      alt=""
                      loading="lazy"
                      className="size-11 shrink-0 rounded-lg bg-muted object-cover"
                    />
                  ) : photoFor.lendo ? (
                    // As fotos ainda chegam: o lugar fica neutro, sem afirmar "sem foto" (carregamento v2, parte 13c).
                    <Esqueleto forma="icone" className="size-11 shrink-0" />
                  ) : (
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      <Package className="size-4" aria-hidden="true" />
                    </span>
                  )}
                  {/* No celular, a grade (docs/mockups/WmsSepararListaCelular.dc.html): o nome, os códigos e as caixas
                      à esquerda e a quantidade no alto, à direita (o bloco do nome vira `contents`); o nome quebra a
                      linha para o tamanho, no fim, não sumir. */}
                  <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 sm:flex sm:items-center">
                    <span className="contents sm:block sm:min-w-0 sm:flex-1">
                      {linha.nome ? (
                        <span className="col-start-1 block font-semibold leading-snug text-foreground sm:truncate">{linha.nome}</span>
                      ) : null}
                      {linha.codigos ? (
                        <span className="col-start-1 block truncate text-xs text-muted-foreground">{linha.codigos}</span>
                      ) : null}
                    </span>
                    {/* A caixa onde o item está (decisão 10): as guardadas na prateleira, a mais antiga primeiro. */}
                    {linha.caixas.length ? (
                      <span className="col-start-1 flex flex-wrap gap-1.5 pt-0.5 sm:max-w-xs sm:shrink-0 sm:justify-end sm:pt-0">
                        {linha.caixas.map((caixa) => (
                          <span
                            key={caixa}
                            className="whitespace-nowrap rounded-md bg-info-soft px-1.5 py-0.5 font-mono text-xs font-medium text-info-soft-foreground"
                          >
                            {caixa}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="col-start-2 row-start-1 whitespace-nowrap font-semibold tabular-nums">
                      {numberFormatter.format(linha.quantidade)} un.
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
