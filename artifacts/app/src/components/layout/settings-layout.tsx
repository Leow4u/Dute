import { useMemo, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, WifiOff } from "lucide-react";

import { AccountMenu } from "@/components/layout/account-menu";
import { ContadorOuEspera, ITEM, ITEM_ATUAL, ITEM_OUTRO, MarcaDoAtual } from "@/components/layout/shell-do-modulo";
import { cn } from "@/lib/utils";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { useConexao } from "@/lib/carregando/estado-da-conexao";
import { NaV3 } from "@/lib/na-v3";
import {
  SETTINGS_GROUP_LABEL,
  SETTINGS_ROOT,
  getActiveSettingsSection,
  getReturnPath,
  getSettingsSections,
  secaoDaConfiguracaoNaV3,
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

/** "Voltar" e "Configuração" na barra preta e no cabeçalho preto do celular. */
function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-v3-header-foreground/75 outline-none transition-colors hover:bg-v3-header-foreground/10 hover:text-v3-header-foreground focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
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
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {SETTINGS_GROUP_LABEL[group.id]}
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
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

/**
 * A Configuração (tela própria, modelo Cursor) no shell da v3
 * (docs/mockups/ConfigClientes.dc.html): a barra lateral preta com o logo, o
 * "Voltar", as seções por grupo e a conta no rodapé; no celular, o cabeçalho
 * preto. O conteúdo de cada seção entra no `.v3` quando ela é revista
 * (`SECOES_DA_CONFIGURACAO_NA_V3`); as outras seguem o visual do WMS.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  // O aparelho sem rede há 3 s, pelo estado único da conexão; o Anunciador diz "Sem conexão" (momento 8).
  const semConexao = useConexao() === "sem-conexao";
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const role = user?.publicMetadata.role;
  const sections = getSettingsSections(role);
  const groups = groupSections(sections);
  const activeId = getActiveSettingsSection(location);
  const atRoot = normalizePath(location) === SETTINGS_ROOT;
  const conteudoV3 = secaoDaConfiguracaoNaV3(activeId);
  // Pessoas e Clientes são listas largas: usam a área inteira.
  const larga = activeId === "pessoas" || activeId === "clientes";
  // Lido uma vez por entrada na Configuração: navegar entre seções não muda
  // para onde o Voltar leva.
  const returnPath = useMemo(() => getReturnPath(role), [role]);

  return (
    <div className={cn("flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background font-sans text-foreground", conteudoV3 && "v3")}>
      <aside
        aria-label="Configuração"
        className="v3 hidden min-h-0 w-62 shrink-0 flex-col bg-v3-header px-3.5 pb-4 pt-6 font-sans text-v3-header-foreground md:flex"
      >
        <Link href="/" className="mb-4 block self-start rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80">
          <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog Soluções Logísticas" className="h-8 w-auto" />
        </Link>
        <div className="px-1.5">
          <BackLink href={returnPath} label="Voltar" />
        </div>
        <h1 className="mt-2 px-3.5 text-2xl font-extrabold tracking-tight">Configuração</h1>
        <nav aria-label="Seções da Configuração" className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id} className="mt-4 flex flex-col gap-1">
              <div className="px-3.5 pb-1 text-xs font-extrabold uppercase tracking-widest text-v3-header-foreground/55">
                {SETTINGS_GROUP_LABEL[group.id]}
              </div>
              {group.sections.map((section) => {
                const Icon = section.icon;
                const active = activeId === section.id;
                return (
                  <Link
                    key={section.id}
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(ITEM, active ? ITEM_ATUAL : ITEM_OUTRO)}
                  >
                    {active ? <MarcaDoAtual /> : null}
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    <ContadorOuEspera atual={active} contador={undefined} />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-3 border-t border-v3-header-foreground/10 pt-3">
          <AccountMenu basePath={basePath} variante="v3" signOut={signOut} user={user} />
          <div className="px-3 pt-2 text-xs text-v3-header-foreground/55">
            Dute · versão <span className="font-mono">{BUILD_COMMIT}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="v3 flex h-16 shrink-0 items-center justify-between gap-3 bg-v3-header px-2 font-sans text-v3-header-foreground md:hidden">
          {atRoot ? <BackLink href={returnPath} label="Voltar" /> : <BackLink href={SETTINGS_ROOT} label="Configuração" />}
          <div className="pr-2">
            <AccountMenu basePath={basePath} compact cabecalho variante="v3" signOut={signOut} user={user} />
          </div>
        </header>
        {semConexao ? (
          <div
            className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-soft-border bg-warning-soft/95 px-4 py-2 text-center text-xs font-medium text-warning-soft-foreground"
          >
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão. Alterações ficam bloqueadas até a internet voltar.
          </div>
        ) : null}
        <main className={cn("min-h-0 flex-1 overflow-auto overscroll-contain", conteudoV3 ? "bg-background" : "bg-card")}>
          <div
            className={cn(
              "mx-auto w-full p-4",
              larga ? "max-w-[1600px] md:p-8 lg:px-11 lg:py-9" : "max-w-[1040px] md:px-10 md:py-10",
            )}
          >
            {atRoot ? (
              <h1 className="mb-4 text-2xl font-semibold tracking-tight md:hidden">
                Configuração
              </h1>
            ) : null}
            {/* O que a seção abre em portal (diálogo, menu, lista) leva o .v3 junto. */}
            <NaV3.Provider value={conteudoV3}>{children}</NaV3.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}
