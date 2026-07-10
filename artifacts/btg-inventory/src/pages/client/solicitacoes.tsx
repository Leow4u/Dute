import { useState } from "react";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Link2,
  type LucideIcon,
  PackagePlus,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  MetricCard,
  ModulePanel,
  StatusBadge,
  firstNumber,
  formatDate,
  formatNumber,
  getRequests,
  normalizeSlug,
  priorityLabel,
  requestDate,
  requestItems,
  requestQuantityTotal,
  requestReference,
  requestTitle,
  requestTypeLabel,
  sortByDateDesc,
} from "./shared";
import { ClientOperationalRequestForm } from "./request-form";

type RequestFlowMode = "retirada" | "recebimento";

export function ClienteSolicitacoes() {
  const [requestFlow, setRequestFlow] = useState<RequestFlowMode | null>(null);

  return (
    <ClientDataBoundary>
      {(overview) => {
        const requests = sortByDateDesc(getRequests(overview), requestDate);
        const requestSummary = Array.isArray(overview.requests)
          ? undefined
          : overview.requests;
        const open = firstNumber(requestSummary?.open, requestSummary?.pending);
        const inOperation = requests.filter((request) =>
          ["in-progress", "em-execucao", "separacao", "picking"].includes(
            normalizeSlug(request.status),
          ),
        ).length;
        const closed = requests.filter((request) =>
          [
            "closed",
            "encerrada",
            "encerrado",
            "concluida",
            "concluido",
          ].includes(normalizeSlug(request.status)),
        ).length;
        const linked = requests.filter(
          (request) =>
            request.order_id ||
            request.pedido_id ||
            request.shipment_id ||
            request.tracking_code ||
            request.proof_id ||
            request.document_id,
        ).length;

        return (
          <ClientModuleShell
            overview={overview}
            eyebrow="Modulo de solicitacoes"
            title="Solicitacoes"
            description="Acompanhamento objetivo das demandas abertas pelo cliente e seus vinculos operacionais."
            icon={ClipboardList}
          >
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Abertas"
                value={formatNumber(open || requests.length)}
                description="Demandas aguardando tratativa"
                icon={Clock3}
                tone="warning"
              />
              <MetricCard
                label="Em operacao"
                value={formatNumber(inOperation)}
                description="Solicitacoes com execucao vinculada"
                icon={ClipboardList}
                tone="info"
              />
              <MetricCard
                label="Encerradas"
                value={formatNumber(closed)}
                description="Fluxos finalizados para o cliente"
                icon={CheckCircle2}
                tone="success"
              />
              <MetricCard
                label="Com vinculo WMS"
                value={formatNumber(linked)}
                description="Pedidos, remessas ou documentos associados"
                icon={Link2}
                tone="neutral"
              />
            </section>

            {requestFlow ? (
              <ClientOperationalRequestForm
                key={requestFlow}
                overview={overview}
                defaultMode={requestFlow}
                allowModeSwitch={false}
                onBack={() => setRequestFlow(null)}
                onCreated={() => setRequestFlow(null)}
              />
            ) : (
              <RequestFlowChooser onSelect={setRequestFlow} />
            )}

            <ModulePanel
              title="Historico de solicitacoes"
              description="Ultimos protocolos registrados no portal"
              icon={ClipboardList}
            >
              {requests.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Protocolo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descricao</TableHead>
                      <TableHead className="text-right">Itens</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Atualizacao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.slice(0, 12).map((request, index) => (
                      <TableRow key={`${requestReference(request)}-${index}`}>
                        <TableCell className="font-medium">
                          {requestReference(request)}
                        </TableCell>
                        <TableCell>
                          {requestTypeLabel(request.type ?? request.tipo)}
                        </TableCell>
                        <TableCell className="max-w-[320px] truncate">
                          {requestTitle(request)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(
                            requestQuantityTotal(request) ||
                              requestItems(request).length,
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-white/70">
                            {priorityLabel(
                              request.priority ?? request.prioridade,
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={request.status} />
                        </TableCell>
                        <TableCell>
                          {formatDate(requestDate(request))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyModuleState
                  title="Nenhuma solicitacao registrada"
                  description="Quando o cliente abrir uma demanda, ela aparecera nesta fila."
                  icon={AlertTriangle}
                />
              )}
            </ModulePanel>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function RequestFlowChooser({
  onSelect,
}: {
  onSelect: (mode: RequestFlowMode) => void;
}) {
  return (
    <ModulePanel
      title="Nova solicitacao"
      description="Escolha o tipo de demanda antes de preencher as informacoes."
      icon={ClipboardList}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <RequestFlowCard
          icon={Truck}
          title="Pedir do estoque"
          description="Solicitar separacao, conferencia e envio para uma unidade."
          meta="Usa somente SKUs reais disponiveis no estoque."
          onClick={() => onSelect("retirada")}
        />
        <RequestFlowCard
          icon={PackagePlus}
          title="Avisar recebimento"
          description="Informar que um fornecedor enviara produtos para a Dutelog."
          meta="Abre a previsao para conferencia e entrada no saldo real."
          onClick={() => onSelect("recebimento")}
        />
      </div>
    </ModulePanel>
  );
}

function RequestFlowCard({
  icon: Icon,
  title,
  description,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[170px] w-full cursor-pointer flex-col justify-between rounded-[24px] border border-border bg-white/72 p-6 text-left shadow-[0_8px_24px_rgba(15,23,42,.04)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white hover:shadow-[0_18px_60px_rgba(15,23,42,.05)]"
    >
      <span className="flex items-start justify-between gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] border border-border bg-white text-muted-foreground transition group-hover:border-primary/20 group-hover:bg-primary/10 group-hover:text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground transition group-hover:text-primary">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
      <span className="space-y-2">
        <span className="block text-xl font-semibold tracking-normal text-foreground">
          {title}
        </span>
        <span className="block max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {meta}
        </span>
      </span>
    </button>
  );
}
