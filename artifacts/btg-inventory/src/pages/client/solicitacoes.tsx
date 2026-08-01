import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  PackagePlus,
} from "lucide-react";

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
  ModulePanel,
  StatusBadge,
  formatDate,
  formatNumber,
  getRequests,
  normalizeSlug,
  requestDate,
  requestItems,
  requestQuantityTotal,
  requestReference,
  requestTitle,
  sortByDateDesc,
  type ClientRequest,
} from "./shared";
import { ClientOperationalRequestForm } from "./request-form";

export function ClienteSolicitacoes() {
  const [creating, setCreating] = useState(false);

  return (
    <ClientDataBoundary>
      {(overview) => {
        const receipts = sortByDateDesc(
          getRequests(overview).filter(isInboundRequest),
          requestDate,
        );

        return (
          <ClientModuleShell
            overview={overview}
            title="Avisar chegada"
            icon={PackagePlus}
          >
            {creating ? (
              <ClientOperationalRequestForm
                overview={overview}
                onBack={() => setCreating(false)}
                onCreated={() => setCreating(false)}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="group flex min-h-[164px] w-full cursor-pointer items-start gap-5 rounded-[24px] border border-border bg-white/72 p-6 text-left shadow-[0_8px_24px_rgba(15,23,42,.04)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white hover:shadow-[0_18px_60px_rgba(15,23,42,.05)]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-primary/20 bg-primary/10 text-primary">
                    <PackagePlus className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold text-foreground">
                      Avisar nova entrega
                    </span>
                    <span className="mt-1 block max-w-3xl text-sm leading-6 text-muted-foreground">
                      Informe fornecedor, documento, previsão e todos os itens enviados. Você também pode anexar a nota fiscal ou o pedido.
                    </span>
                    <span className="mt-3 block text-xs font-medium text-muted-foreground">
                      Este aviso cria uma previsão para a equipe; nenhum saldo é lançado automaticamente.
                    </span>
                  </span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-white text-muted-foreground transition group-hover:text-primary">
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>

                {receipts.length > 0 ? (
                  <ModulePanel
                    title="Entregas avisadas"
                    description="Previsões enviadas por você e andamento da conferência"
                    icon={Clock3}
                  >
                    <div className="overflow-auto rounded-2xl border border-border bg-white/35">
                      <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Protocolo</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead className="text-right">Itens</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Atualização</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {receipts.slice(0, 20).map((request, index) => (
                            <TableRow key={`${requestReference(request)}-${index}`}>
                              <TableCell className="font-medium">
                                {requestReference(request)}
                              </TableCell>
                              <TableCell className="max-w-[360px] truncate">
                                {requestTitle(request)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatNumber(
                                  requestQuantityTotal(request) ||
                                    requestItems(request).length,
                                )}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={request.status} />
                              </TableCell>
                              <TableCell>{formatDate(requestDate(request))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ModulePanel>
                ) : (
                  <EmptyModuleState
                    title="Nenhuma entrega avisada"
                    description="Quando você informar uma compra enviada à Dutelog, o acompanhamento aparecerá aqui."
                    icon={CheckCircle2}
                  />
                )}
              </>
            )}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function isInboundRequest(request: ClientRequest) {
  const value = normalizeSlug(
    [
      request.type,
      request.tipo,
      request.title,
      request.titulo,
      request.description,
      request.descricao,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return (
    value.includes("recebimento") ||
    value.includes("fornecedor") ||
    value.includes("chegada")
  );
}
