import { useState, useMemo } from "react";
import { useListOrders, useUpdateOrder, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, Box } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function Orders() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const limit = 50;

  useMemo(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useListOrders(
    { num_pedido: debouncedSearch || undefined, status: statusFilter || undefined, limit, offset: page * limit },
    { query: { queryKey: getListOrdersQueryKey({ num_pedido: debouncedSearch || undefined, status: statusFilter || undefined, limit, offset: page * limit }) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Order Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Track picking, packing, and dispatch operations.</p>
        </div>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="bg-gray-50/50 border-b border-border py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search order number..." 
                className="pl-9 h-9 text-sm bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto items-center">
              <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val === "all" ? "" : val); setPage(0); }}>
                <SelectTrigger className="w-[180px] h-9 bg-white">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="SEPARACAO">Separação</SelectItem>
                  <SelectItem value="FATURADO">Faturado</SelectItem>
                  <SelectItem value="ENTREGUE">Entregue</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-gray-50/80 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Order Num</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Client / Channel</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium text-center">Progress</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Update Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading orders...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No orders found.</td>
                  </tr>
                ) : (
                  data?.items?.map((order) => {
                    const progress = order.qtd_solic > 0 ? ((order.qtd_sep || 0) / order.qtd_solic) * 100 : 0;
                    return (
                      <tr key={order.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-primary font-bold">#{order.num_pedido}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {order.data_solic ? new Date(order.data_solic).toLocaleDateString('pt-BR') : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{order.cod_cliente}</div>
                          <div className="text-xs text-muted-foreground">{order.canal || "Manual"}</div>
                        </td>
                        <td className="px-4 py-3 max-w-[200px] truncate" title={order.produto}>{order.produto}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 w-full max-w-[120px] mx-auto">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium text-gray-700">{order.qtd_sep || 0} / {order.qtd_solic}</span>
                              <span className="text-muted-foreground">{Math.round(progress)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="secondary" className={
                            order.status === 'ENTREGUE' || order.status === 'FATURADO' ? 'bg-emerald-50 text-emerald-700' :
                            order.status === 'PENDENTE' ? 'bg-amber-50 text-amber-700' :
                            order.status === 'CANCELADO' ? 'bg-rose-50 text-rose-700' :
                            'bg-blue-50 text-blue-700'
                          }>
                            {order.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <OrderStatusUpdater order={order} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/50">
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-medium">{data?.items?.length || 0}</span> of <span className="font-medium">{data?.total || 0}</span> orders
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => p + 1)}
                disabled={!data || data.items.length < limit || isLoading}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OrderStatusUpdater({ order }: { order: any }) {
  const updateOrder = useUpdateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (newStatus: string) => {
    updateOrder.mutate(
      { id: order.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          // Patch cache directly to avoid refetch jumpiness
          queryClient.setQueryData(
            getListOrdersQueryKey(), 
            (old: any) => old // We'll just invalidate for simplicity, it's safer with pagination
          );
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: `Order ${order.num_pedido} updated to ${newStatus}` });
        },
        onError: () => {
          toast({ title: "Failed to update order status", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Select value={order.status} onValueChange={handleStatusChange}>
      <SelectTrigger className="w-[130px] h-8 text-xs bg-white mx-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="PENDENTE">Pendente</SelectItem>
        <SelectItem value="SEPARACAO">Separação</SelectItem>
        <SelectItem value="FATURADO">Faturado</SelectItem>
        <SelectItem value="ENTREGUE">Entregue</SelectItem>
        <SelectItem value="CANCELADO">Cancelado</SelectItem>
      </SelectContent>
    </Select>
  );
}
