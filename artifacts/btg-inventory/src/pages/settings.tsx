import {
  CircleCheck,
  Download,
  Share,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wifi,
} from "lucide-react";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppUser } from "@/lib/auth";
import { roleDescription, roleLabel } from "@/lib/access";
import { usePwaInstall } from "@/lib/pwa-install";

export default function Settings() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const {
    canInstall,
    isAppleMobile,
    isInstalled,
    isOnline,
    requestInstall,
  } = usePwaInstall();
  const [installMessage, setInstallMessage] = useState("");

  async function installApplication() {
    const outcome = await requestInstall();
    if (outcome === "accepted" || outcome === "installed") {
      setInstallMessage("Aplicativo instalado neste dispositivo.");
      return;
    }
    if (outcome === "dismissed") {
      setInstallMessage("Instalação cancelada. Você pode tentar novamente.");
      return;
    }
    setInstallMessage(
      "Abra o menu do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial.",
    );
  }

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">
          Conta e sessão
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Configuração
        </h1>
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-white/55 p-4">
              <span className="text-sm text-muted-foreground">Perfil</span>
              <Badge variant="secondary">{roleLabel(role)}</Badge>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/55 p-4 text-sm leading-6 text-muted-foreground">
              {roleDescription(role)}{" "}
              {role === "owner" || role === "admin"
                ? "Perfis são definidos em Pessoas e acessos."
                : "Para mudar seu perfil, fale com a administração."}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card id="aplicativo" className="scroll-mt-6 overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-white/35">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Aplicativo no celular</CardTitle>
              </div>
            </div>
            <Badge variant={isInstalled ? "default" : "secondary"}>
              {isInstalled ? "Instalado" : "Disponível para instalar"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {isInstalled ? (
              <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="text-sm font-semibold">
                    Aplicativo instalado
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Abra a Dutelog pelo ícone na tela inicial do aparelho.
                  </p>
                </div>
              </div>
            ) : isAppleMobile ? (
              <div className="space-y-3 rounded-2xl border border-border/70 bg-white/55 p-4">
                <div className="text-sm font-semibold">No iPhone ou iPad</div>
                <ol className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <li className="flex gap-3">
                    <span className="font-semibold text-foreground">1.</span>
                    Abra este sistema pelo Safari.
                  </li>
                  <li className="flex gap-3">
                    <Share className="mt-1 h-4 w-4 shrink-0 text-foreground" />
                    Toque em Compartilhar.
                  </li>
                  <li className="flex gap-3">
                    <Download className="mt-1 h-4 w-4 shrink-0 text-foreground" />
                    Escolha Adicionar à Tela de Início.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Instale para abrir em tela cheia, acessar pelo ícone da Dutelog
                  e usar a câmera traseira durante o cadastro dos produtos.
                </p>
                <Button
                  type="button"
                  onClick={installApplication}
                  disabled={!canInstall}
                >
                  <Download data-icon="inline-start" />
                  Instalar aplicativo
                </Button>
                {!canInstall ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Caso o botão ainda esteja desabilitado, use o menu do Chrome e
                    selecione Instalar aplicativo. O navegador também pode liberar
                    o botão após alguns instantes de uso.
                  </p>
                ) : null}
                {installMessage ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {installMessage}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/70 bg-white/55 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wifi className="h-4 w-4 text-primary" />
              Operação protegida
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A interface pode abrir pelo aplicativo, mas entradas, saídas,
              contagens e pedidos exigem internet para manter o saldo único em
              tempo real.
            </p>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-white/70 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Conexão agora</span>
              <span className="font-medium">
                {isOnline ? "Online" : "Sem conexão"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
