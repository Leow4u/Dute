import {
  ClipboardCheck,
  FileCheck2,
  PackageCheck,
  Truck,
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
  MetricCard,
  ModulePanel,
  StatusBadge,
  documentDate,
  documentLabel,
  documentUrl,
  firstText,
  formatDate,
  formatNumber,
  getDocuments,
  getPackages,
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
        const packages = getPackages(overview);
        const signed = documents.filter((document) =>
          String(document.status ?? "").toLowerCase().includes("assin"),
        ).length;

        return (
          <ClientModuleShell
            overview={overview}
            eyebrow="Modulo de documentos"
            title="Documentos"
            description="Comprovantes, arquivos de entrega e evidencias vinculadas a remessas e solicitacoes."
            icon={FileCheck2}
          >
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Documentos"
                value={formatNumber(documents.length)}
                description="Arquivos e comprovantes localizados"
                icon={FileCheck2}
                tone="info"
              />
              <MetricCard
                label="Com assinatura"
                value={formatNumber(signed)}
                description="Comprovantes assinados ou confirmados"
                icon={ClipboardCheck}
                tone="success"
              />
              <MetricCard
                label="Remessas"
                value={formatNumber(shipments.length)}
                description="Entregas com vinculo documental"
                icon={Truck}
                tone="neutral"
              />
              <MetricCard
                label="Volumes"
                value={formatNumber(packages.length)}
                description="Pacotes relacionados as entregas"
                icon={PackageCheck}
                tone="warning"
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
              <ModulePanel
                title="Arquivos disponiveis"
                description="Documentos retornados diretamente ou por remessas"
                icon={FileCheck2}
              >
                {documents.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Documento</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Acesso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.slice(0, 12).map((document, index) => {
                        const url = documentUrl(document);

                        return (
                          <TableRow key={`${documentLabel(document)}-${index}`}>
                            <TableCell className="font-medium">
                              {documentLabel(document)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={document.status} />
                            </TableCell>
                            <TableCell>
                              {firstText(
                                document.order_number,
                                document.order_id,
                                document.shipment_id,
                                "Sem vinculo",
                              )}
                            </TableCell>
                            <TableCell>{formatDate(documentDate(document))}</TableCell>
                            <TableCell>
                              {url ? (
                                <a
                                  href={url}
                                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Abrir
                                </a>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  Indisponivel
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyModuleState
                    title="Nenhum documento disponivel"
                    description="Comprovantes e arquivos vinculados aparecerao aqui quando forem publicados."
                  />
                )}
              </ModulePanel>

              <ModulePanel
                title="Remessas relacionadas"
                description="Ultimas entregas com possivel evidencia documental"
                icon={Truck}
              >
                {shipments.length > 0 ? (
                  <div className="space-y-3">
                    {shipments.slice(0, 6).map((shipment, index) => (
                      <div
                        key={`${shipmentReference(shipment)}-${index}`}
                        className="rounded-2xl border border-border bg-white/55 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {shipmentReference(shipment)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {firstText(shipment.carrier, shipment.destination, "Sem transportadora")}
                            </p>
                          </div>
                          <StatusBadge status={shipment.status} />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Unidades</p>
                            <p className="font-medium">
                              {formatNumber(shipmentQuantity(shipment))}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Data</p>
                            <p className="font-medium">{formatDate(shipmentDate(shipment))}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyModuleState
                    title="Sem remessas"
                    description="Ainda nao ha remessas vinculadas aos documentos."
                  />
                )}
              </ModulePanel>
            </section>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
