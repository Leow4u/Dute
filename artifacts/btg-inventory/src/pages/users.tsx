import {
  useListBillingUsers,
  getListBillingUsersQueryKey,
  useUpdateUserRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListBillingUsers();
  const update = useUpdateUserRole();

  const handleChange = (id: string, role: string) => {
    update.mutate(
      { id, data: { role } },
      {
        onSuccess: () => { toast({ title: "Papel atualizado" }); qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() }); },
        onError: () => toast({ title: "Erro ao atualizar papel", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Usuários & Acessos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina quem é da equipe interna (acesso total) e quem é cliente (vê apenas as próprias faturas).
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Usuários</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="w-48">Alterar papel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={u.role === "cliente" ? "bg-purple-100 text-purple-800 border-purple-200" : "bg-slate-100 text-slate-800 border-slate-200"}>
                        {u.role === "cliente" ? "Cliente" : "Interno (Dutelog)"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(v) => handleChange(u.id, v)}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="interno">Interno (Dutelog)</SelectItem>
                          <SelectItem value="cliente">Cliente</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
