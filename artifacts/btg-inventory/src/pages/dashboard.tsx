import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Tags, ArrowRightLeft, DollarSign, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data, isLoading, error } = useGetDashboard();

  if (isLoading) {
    return <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-gray-200 rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[1,2,3,4,5].map(i => <div key={i} className="h-32 bg-gray-200 rounded-xl"></div>)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-96 bg-gray-200 rounded-xl"></div>
        <div className="h-96 bg-gray-200 rounded-xl"></div>
      </div>
    </div>;
  }

  if (error || !data) {
    return <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20">
      Falha ao carregar os dados do painel. Tente novamente.
    </div>;
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Central de Operações</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão em tempo real do estoque e das movimentações do armazém.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Total de Produtos</CardTitle>
            <Package className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_produtos.toLocaleString('pt-BR')}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Total de SKUs</CardTitle>
            <Tags className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_skus.toLocaleString('pt-BR')}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Total de Peças</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_pecas.toLocaleString('pt-BR')}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Custo Total</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.custo_total)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Ad Valorem</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.ad_valorem)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b border-border/60 bg-white/35">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-gray-700">Estoque por Categoria</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.by_category} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="categoria" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} />
                  <RechartsTooltip cursor={{fill: 'rgba(241,244,248,.72)'}} contentStyle={{borderRadius: '16px', border: '1px solid #E8EBEF', boxShadow: '0 18px 60px rgba(15,23,42,.05)'}} />
                  <Bar dataKey="total_pecas" fill="hsl(var(--primary))" radius={[10, 10, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60 bg-white/35 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-gray-700">Movimentações Recentes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-gray-50/80 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium text-right">Qtde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recent_movements.slice(0, 7).map((mov) => (
                    <tr key={mov.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{new Date(mov.data).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant="outline" className={mov.sinal > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
                          {mov.tipo_mov}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{mov.cod_sku}</td>
                      <td className="px-4 py-3 truncate max-w-[200px]" title={mov.produto}>{mov.produto}</td>
                      <td className={`px-4 py-3 whitespace-nowrap text-right font-medium ${mov.sinal > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {mov.sinal > 0 ? '+' : '-'}{mov.qtde}
                      </td>
                    </tr>
                  ))}
                  {data.recent_movements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma movimentação recente
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b border-border/60 bg-white/35">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-gray-700">Status dos Pedidos</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {data.order_status_counts.map((stat) => (
                <div key={stat.status} className="soft-panel rounded-[18px] p-4 text-center">
                  <div className="text-3xl font-bold mb-1 text-primary">{stat.count}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{stat.status}</div>
                </div>
              ))}
              {data.order_status_counts.length === 0 && (
                <div className="col-span-full text-center text-muted-foreground py-8">
                  Nenhum pedido encontrado
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
