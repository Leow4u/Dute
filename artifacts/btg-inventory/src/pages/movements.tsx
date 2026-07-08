import { useState, useMemo } from "react";
import { useListMovements, useCreateMovement, getListMovementsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@clerk/react";

const movementSchema = z.object({
  data: z.string().min(1, "Required"),
  tipo_mov: z.string().min(1, "Required"),
  cod_sku: z.string().min(1, "Required"),
  produto: z.string().min(1, "Required"),
  qtde: z.coerce.number().min(1, "Quantity must be at least 1"),
  sinal: z.coerce.number(),
  origem: z.string().optional(),
  destino: z.string().optional(),
  responsavel: z.string().optional(),
  doc_nf: z.string().optional(),
});

type MovementFormValues = z.infer<typeof movementSchema>;

export default function Movements() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  useMemo(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useListMovements(
    { cod_sku: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListMovementsQueryKey({ cod_sku: debouncedSearch || undefined, limit, offset: page * limit }) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Kardex Log</h1>
          <p className="text-sm text-muted-foreground mt-1">Immutable ledger of all inventory inbound and outbound operations.</p>
        </div>
        <MovementModal />
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="bg-gray-50/50 border-b border-border py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by SKU code..." 
                className="pl-9 h-9 text-sm bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="mr-2 h-4 w-4" /> Filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-gray-50/80 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Cod. SKU</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium text-center">Path (Orig &rarr; Dest)</th>
                  <th className="px-4 py-3 font-medium">Doc/NF</th>
                  <th className="px-4 py-3 font-medium">Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading movements...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No movements found.</td>
                  </tr>
                ) : (
                  data?.items?.map((mov) => {
                    const isPositive = mov.sinal > 0;
                    return (
                      <tr key={mov.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {new Date(mov.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Badge variant="outline" className={isPositive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
                            {mov.tipo_mov}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-primary font-bold">{mov.cod_sku}</td>
                        <td className="px-4 py-2 truncate max-w-[150px] font-medium" title={mov.produto}>{mov.produto}</td>
                        <td className="px-4 py-2 text-right">
                          <div className={`flex items-center justify-end gap-1 font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {isPositive ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                            {isPositive ? '+' : '-'}{mov.qtde}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-muted-foreground">
                          <div className="flex items-center justify-center gap-2">
                            <span className="truncate max-w-[80px]" title={mov.origem || "-"}>{mov.origem || "-"}</span>
                            <span className="text-gray-300">&rarr;</span>
                            <span className="truncate max-w-[80px]" title={mov.destino || "-"}>{mov.destino || "-"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{mov.doc_nf || "-"}</td>
                        <td className="px-4 py-2 text-xs font-medium text-gray-700">{mov.responsavel || "-"}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/50">
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-medium">{data?.items?.length || 0}</span> of <span className="font-medium">{data?.total || 0}</span> movements
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

function MovementModal() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMovement = useCreateMovement();
  const { user } = useUser();

  const { register, handleSubmit, formState: { errors }, reset, control, watch, setValue } = useForm<MovementFormValues>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      data: new Date().toISOString().slice(0, 16),
      tipo_mov: "ENTRADA",
      cod_sku: "",
      produto: "",
      qtde: 1,
      sinal: 1,
      origem: "",
      destino: "ESTOQUE_BTG",
      responsavel: user?.fullName || "System",
      doc_nf: "",
    }
  });

  const tipo_mov = watch("tipo_mov");

  const onSubmit = (data: MovementFormValues) => {
    // Ensure sinal matches tipo_mov logic
    data.sinal = data.tipo_mov === "ENTRADA" || data.tipo_mov === "DEVOLUCAO" ? 1 : -1;
    
    // Ensure date is properly formatted as ISO
    data.data = new Date(data.data).toISOString();

    createMovement.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMovementsQueryKey() });
          toast({ title: "Movement logged successfully" });
          setOpen(false);
          reset();
        },
        onError: () => {
          toast({ title: "Error logging movement", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90 text-white shadow-sm h-9">
          <Plus className="mr-2 h-4 w-4" /> Log Movement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Log Inventory Movement</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="tipo_mov">Movement Type *</Label>
              <Controller
                control={control}
                name="tipo_mov"
                render={({ field }) => (
                  <Select 
                    onValueChange={(val) => {
                      field.onChange(val);
                      if (val === "ENTRADA" || val === "DEVOLUCAO") {
                        setValue("sinal", 1);
                        setValue("destino", "ESTOQUE_BTG");
                        setValue("origem", "FORNECEDOR");
                      } else {
                        setValue("sinal", -1);
                        setValue("origem", "ESTOQUE_BTG");
                        setValue("destino", "CLIENTE");
                      }
                    }} 
                    defaultValue={field.value}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA">Entrada (+)</SelectItem>
                      <SelectItem value="SAIDA">Saída (-)</SelectItem>
                      <SelectItem value="AJUSTE_ENTRADA">Ajuste Positivo (+)</SelectItem>
                      <SelectItem value="AJUSTE_SAIDA">Ajuste Negativo (-)</SelectItem>
                      <SelectItem value="DEVOLUCAO">Devolução (+)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="cod_sku">Cod. SKU *</Label>
              <Input id="cod_sku" {...register("cod_sku")} />
              {errors.cod_sku && <span className="text-xs text-destructive">{errors.cod_sku.message}</span>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qtde">Quantity *</Label>
              <Input id="qtde" type="number" min="1" {...register("qtde")} />
              {errors.qtde && <span className="text-xs text-destructive">{errors.qtde.message}</span>}
            </div>
            
            <div className="space-y-2 col-span-2">
              <Label htmlFor="produto">Product Name *</Label>
              <Input id="produto" {...register("produto")} />
              {errors.produto && <span className="text-xs text-destructive">{errors.produto.message}</span>}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="origem">Origin</Label>
              <Input id="origem" {...register("origem")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destino">Destination</Label>
              <Input id="destino" {...register("destino")} />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="doc_nf">Document / NF</Label>
              <Input id="doc_nf" {...register("doc_nf")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data">Date</Label>
              <Input id="data" type="datetime-local" {...register("data")} />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createMovement.isPending}>
              {createMovement.isPending ? "Saving..." : "Log Movement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
