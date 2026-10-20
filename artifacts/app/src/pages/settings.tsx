import {
  CircleCheck,
  Download,
  Share,
  Smartphone,
  Wifi,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsSectionList } from "@/components/layout/settings-layout";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { roleDescription, roleLabel } from "@/lib/access";
import { canChooseTheme } from "@/lib/theme";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { usePwaInstall } from "@/lib/pwa-install";

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <PageHeader title={title} description={subtitle} className="mb-5" />
  );
}

function Row({ label, value, aside }: { label: string; value: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-4 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{value}</div>
      </div>
      {aside}
    </div>
  );
}

/** Minha conta: quem é você no sistema e como sair. */
export function SettingsAccount() {
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const role = user?.publicMetadata.role;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div>
      <SectionTitle title="Minha conta" subtitle="Seus dados e o que seu perfil pode fazer" />
      <div className="space-y-4">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <Row label="Nome" value={user?.fullName || "Usuário"} />
          <Row label="E-mail" value={user?.primaryEmailAddress.emailAddress || "Sem e-mail"} />
          <Row
            label="Perfil"
            value={
              <>
                {roleDescription(role)}{" "}
                {role === "owner" || role === "admin"
                  ? "Perfis são definidos em Pessoas e acessos."
                  : "Para mudar seu perfil, fale com a administração."}
              </>
            }
            aside={<Badge variant="secondary" className="shrink-0">{roleLabel(role)}</Badge>}
          />
        </section>
        {canChooseTheme(role) ? (
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border/50 px-5 py-4">
              <div className="text-sm font-medium">Aparência</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                Tema deste aparelho. Sistema acompanha o claro ou escuro do aparelho.
              </div>
            </div>
            <div className="px-5 py-4">
              <ThemeSelector />
            </div>
          </section>
        ) : null}
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <Row
            label="Sair da conta"
            value="Encerra a sessão neste dispositivo"
            aside={
              <Button
                type="button"
                variant="outline"
                onClick={() => signOut({ redirectUrl: basePath || "/" })}
              >
                Sair
              </Button>
            }
          />
        </section>
      </div>
    </div>
  );
}

/** Raiz: no celular, a lista de seções; no computador, Minha conta. */
export default function SettingsHome() {
  return (
    <>
      <SettingsSectionList />
      <div className="hidden md:block">
        <SettingsAccount />
      </div>
    </>
  );
}

export function SettingsApp() {
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
    <div>
      <SectionTitle
        title="Aplicativo no celular"
        subtitle="Abra a Dutelog pelo ícone, em tela cheia"
      />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card">
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
              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
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

          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wifi className="h-4 w-4 text-primary" />
              Operação protegida
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A interface pode abrir pelo aplicativo, mas entradas, saídas,
              contagens e pedidos exigem internet para manter o saldo único em
              tempo real.
            </p>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2 text-sm">
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
