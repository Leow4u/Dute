import { Download, FileCheck2, FolderOpen, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  documentDate,
  documentLabel,
  documentUrl,
  firstText,
  formatDate,
  formatNumber,
  getDocuments,
  getShipments,
  shipmentDate,
  shipmentQuantity,
  shipmentReference,
  sortByDateDesc,
} from "./shared";

export function ClienteDocumentos() {
  return (
    <ClientDataBoundary>
      {(overview) => {
        const documents = sortByDateDesc(getDocuments(overview), documentDate);
        const shipments = sortByDateDesc(getShipments(overview), shipmentDate);

        return (
          <ClientModuleShell
            overview={overview}
            title="Documentos"
            icon={FileCheck2}
          >
            {documents.length === 0 ? (
              <EmptyModuleState
                title="Nenhum documento publicado"
                description="Comprovantes de entrega e outros arquivos aparecerão aqui quando estiverem disponíveis."
                icon={FolderOpen}
              />
            ) : (
              <>
                <ModulePanel
                  title="Arquivos disponíveis"
                  description={`${formatNumber(documents.length)} documento(s) na sua conta`}
                  icon={FileCheck2}
                >
                  <div className="overflow-auto rounded-2xl border border-border bg-white/35">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Documento</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Referência</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="w-[100px] text-right">Arquivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {documents.slice(0, 30).map((document, index) => {
                          const url = documentUrl(document);
                          return (
                            <TableRow key={`${documentLabel(document)}-${index}`}>
                              <TableCell className="font-medium">{documentLabel(document)}</TableCell>
                              <TableCell><StatusBadge status={document.status} /></TableCell>
                              <TableCell>
                                {firstText(
                                  document.order_number,
                                  document.order_id,
                                  document.shipment_id,
                                  "Sem vínculo",
                                )}
                              </TableCell>
                              <TableCell>{formatDate(documentDate(document))}</TableCell>
                              <TableCell className="text-right">
                                {url ? (
                                  <Button asChild variant="ghost" size="sm" className="rounded-xl">
                                    <a href={url} target="_blank" rel="noreferrer">
                                      <Download className="h-4 w-4" />
                                      Abrir
                                    </a>
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Indisponível</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </ModulePanel>

                {shipments.length > 0 ? (
                  <ModulePanel
                    title="Entregas relacionadas"
                    description="Últimas remessas com documentação vinculada"
                    icon={Truck}
                  >
                    <div className="divide-y divide-border/70 rounded-2xl border border-border bg-white/45">
                      {shipments.slice(0, 6).map((shipment, index) => (
                        <div
                          key={`${shipmentReference(shipment)}-${index}`}
                          className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto] sm:items-center"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{shipmentReference(shipment)}</p>
                            <p className="mt-1 truncate text-sm text-muted-foreground">
                              {firstText(shipment.carrier, shipment.destination, "Entrega Dutelog")}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatNumber(shipmentQuantity(shipment))} unidade(s)
                          </p>
                          <p className="text-sm text-muted-foreground">{formatDate(shipmentDate(shipment))}</p>
                          <StatusBadge status={shipment.status} />
                        </div>
                      ))}
                    </div>
                  </ModulePanel>
                ) : null}
              </>
            )}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
