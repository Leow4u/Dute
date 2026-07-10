import { ShieldCheck, UserRound } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppUser } from "@/lib/auth";
import { normalizeProfileRole } from "@/lib/modules";

function roleLabel(role: unknown) {
  const normalized = normalizeProfileRole(role);
  if (normalized === "owner") return "Owner Dutelog";
  if (normalized === "admin") return "Admin Dutelog";
  if (normalized === "wms") return "Operação WMS";
  if (normalized === "financeiro") return "Financeiro";
  if (normalized === "suporte") return "Suporte";
  if (normalized === "interno") return "Interno Dutelog";
  if (normalized === "cliente") return "Cliente";
  return "Sem perfil";
}

export default function Settings() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">
          Conta e sessão
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Configuração
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Dados do acesso autenticado no portal Dutelog.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 bg-white/35">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Usuário</CardTitle>
                <CardDescription>Identidade usada nesta sessão.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-white/55 p-4">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Nome
              </div>
              <div className="mt-2 truncate text-sm font-semibold">
                {user?.fullName || "Usuário"}
              </div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/55 p-4">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                E-mail
              </div>
              <div className="mt-2 truncate text-sm font-semibold">
                {user?.primaryEmailAddress.emailAddress || "Sem e-mail"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 bg-white/35">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Permissão</CardTitle>
                <CardDescription>Perfil aplicado ao sistema.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-white/55 p-4">
              <span className="text-sm text-muted-foreground">Perfil</span>
              <Badge variant="secondary">{roleLabel(role)}</Badge>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/55 p-4 text-sm leading-6 text-muted-foreground">
              Alterações de perfil e permissões continuam sob controle do
              administrador Dutelog.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
