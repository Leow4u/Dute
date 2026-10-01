import { useMemo, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppUser } from "@/lib/auth";
import { usePwaInstall } from "@/lib/pwa-install";
import {
  SETTINGS_GROUP_LABEL,
  SETTINGS_ROOT,
  getActiveSettingsSection,
  getReturnPath,
  getSettingsSections,
  type SettingsSection,
} from "@/lib/settings-nav";
import { normalizePath } from "@/lib/modules";
import { BUILD_COMMIT } from "@/lib/build-info";

function groupSections(sections: SettingsSection[]) {
  const groups: Array<{ id: SettingsSection["group"]; sections: SettingsSection[] }> = [];
  for (const section of sections) {
    const group = groups.find((item) => item.id === section.group);
    if (group) group.sections.push(section);
    else groups.push({ id: section.group, sections: [section] });
  }
  return groups;
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-black/[.04] hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}

/**
 * Lista de seções que o celular mostra na raiz da Configuração. No
 * computador o menu lateral já faz esse papel.
 */
export function SettingsSectionList() {
  const { user } = useAppUser();
  const groups = groupSections(getSettingsSections(user?.publicMetadata.role));
  return (
    <div className="space-y-6 md:hidden">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {SETTINGS_GROUP_LABEL[group.id]}
          </div>
          <div className="overflow-hidden rounded-[18px] border border-border bg-white">
            {group.sections.map((section) => {
              const Icon = section.icon;
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  className="flex items-center gap-3 border-b border-border/50 px-4 py-3.5 text-sm font-medium last:border-0"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{section.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { isOnline } = usePwaInstall();
  const role = user?.publicMetadata.role;
  const sections = getSettingsSections(role);
  const groups = groupSections(sections);
  const activeId = getActiveSettingsSection(location);
  const atRoot = normalizePath(location) === SETTINGS_ROOT;
  // Lido uma vez por entrada na Configuração: navegar entre seções não muda
  // para onde o Voltar leva.
  const returnPath = useMemo(() => getReturnPath(role), [role]);

  return (
    <div className="app-atmosphere flex h-[100dvh] min-h-0 w-full overflow-hidden font-sans text-foreground">
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 px-3 py-4 backdrop-blur-[40px] md:flex">
        <div>
          <BackLink href={returnPath} label="Voltar" />
        </div>
        <h1 className="mb-2 mt-4 px-3 text-xl font-semibold tracking-tight">Configuração</h1>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id} className="mt-4">
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {SETTINGS_GROUP_LABEL[group.id]}
              </div>
              <div className="space-y-0.5">
                {group.sections.map((section) => {
                  const Icon = section.icon;
                  const active = activeId === section.id;
                  return (
                    <Link
                      key={section.id}
                      href={section.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                        active
                          ? "border-border bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,.06)]"
                          : "border-transparent text-sidebar-foreground/70 hover:bg-white/70 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{section.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 pt-3 text-xs text-muted-foreground">
          Dute · versão <span className="font-mono">{BUILD_COMMIT}</span>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white/60">
        <header className="flex h-14 shrink-0 items-center border-b border-border/70 bg-white/80 px-2 backdrop-blur-[40px] md:hidden">
          {atRoot ? (
            <BackLink href={returnPath} label="Voltar" />
          ) : (
            <BackLink href={SETTINGS_ROOT} label="Configuração" />
          )}
        </header>
        {!isOnline ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50/95 px-4 py-2 text-center text-xs font-medium text-amber-900"
          >
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão. Alterações ficam bloqueadas até a internet voltar.
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[1040px] p-4 md:px-10 md:py-10">
            {atRoot ? (
              <h1 className="mb-4 text-2xl font-semibold tracking-tight md:hidden">
                Configuração
              </h1>
            ) : null}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
