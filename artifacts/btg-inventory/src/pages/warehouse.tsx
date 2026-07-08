import { useGetWarehouseMap } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, PackageOpen, Box } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

export default function Warehouse() {
  const { data: ruas, isLoading } = useGetWarehouseMap();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-gray-200 rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1,2,3].map(i => <div key={i} className="h-64 bg-gray-200 rounded-xl"></div>)}
        </div>
      </div>
    );
  }

  if (!ruas || ruas.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Warehouse Map</h1>
          <p className="text-sm text-muted-foreground mt-1">Physical distribution of SKUs.</p>
        </div>
        <div className="p-8 text-center bg-gray-50 border border-border rounded-lg text-muted-foreground">
          No location data assigned to any SKUs yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Warehouse Map</h1>
        <p className="text-sm text-muted-foreground mt-1">Hierarchical view of physical storage (Rua &rarr; Prateleira &rarr; Caixa).</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {ruas.map((rua) => (
          <Card key={rua.rua} className="border-border shadow-sm flex flex-col overflow-hidden max-h-[800px]">
            <CardHeader className="bg-sidebar text-sidebar-foreground p-4 shrink-0">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-sidebar-primary" />
                  <CardTitle className="text-lg">Aisle (Rua) {rua.rua}</CardTitle>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-sidebar-primary-foreground">{rua.total_pecas.toLocaleString('pt-BR')}</div>
                  <div className="text-xs text-sidebar-foreground/70 uppercase font-semibold">Total Pcs</div>
                </div>
              </div>
              <div className="flex gap-4 mt-4 pt-4 border-t border-sidebar-border/50 text-xs">
                <div><span className="font-bold text-white">{rua.total_skus}</span> SKUs</div>
                <div><span className="font-bold text-white">{rua.total_caixas}</span> Caixas</div>
                <div><span className="font-bold text-white">{rua.prateleiras.length}</span> Prateleiras</div>
              </div>
            </CardHeader>
            <ScrollArea className="flex-1 bg-gray-50/30">
              <CardContent className="p-0">
                <Accordion type="multiple" className="w-full">
                  {rua.prateleiras.map((prat) => (
                    <AccordionItem value={`prat-${prat.prateleira}`} key={prat.prateleira} className="border-b border-border last:border-0">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-gray-50">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                          <PackageOpen className="h-4 w-4 text-muted-foreground" />
                          Shelf (Prat) {prat.prateleira}
                          <Badge variant="secondary" className="ml-2 bg-blue-50 text-blue-700 font-normal">
                            {prat.caixas.length} boxes
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-0">
                        <div className="bg-white divide-y divide-gray-100">
                          {prat.caixas.map((cx) => (
                            <div key={cx.caixa} className="p-3 pl-10 hover:bg-gray-50/50 transition-colors">
                              <div className="flex items-center gap-2 mb-2">
                                <Box className="h-3.5 w-3.5 text-primary" />
                                <span className="font-semibold text-xs text-gray-900">Box {cx.caixa}</span>
                              </div>
                              <div className="space-y-1">
                                {cx.skus.map((sku) => (
                                  <div key={sku.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-gray-50 border border-border">
                                    <span className="font-mono font-medium text-primary" title={sku.produto}>
                                      {sku.cod_btg}
                                    </span>
                                    <span className="font-bold text-gray-700 bg-white px-1.5 py-0.5 rounded shadow-sm">
                                      {sku.estoque_atual} pcs
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </ScrollArea>
          </Card>
        ))}
      </div>
    </div>
  );
}
