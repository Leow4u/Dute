import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, WifiOff, type LucideIcon } from "lucide-react";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SeletorDeModulo } from "@/components/layout/seletor-de-modulo";
import { ehTelaDoAgente } from "@/lib/agente/navegacao";
import { isModuleGroup, isNavRouteActive, type AppModule } from "@/lib/modules";
import { NaV3 } from "@/lib/na-v3";
import type { ContadorDoItem } from "@/lib/resumo-do-modulo";
import type { OpcaoDeModulo } from "@/lib/seletor-de-modulo";
import { cn } from "@/lib/utils";

/**
 * Shell v3 de um módulo (docs/plataforma/plano-de-implantacao.md, parte 2.3;
 * mockups docs/mockups/ModComInicio.dc.html e ModOpInicio.dc.html): barra
 * lateral preta com o logo (leva aos cards), o seletor de módulo, as telas do
 * módulo com o contador de cada uma e a conta no rodapé. No celular, o
 * cabeçalho preto traz o seletor e a conta, e a barra inferior, as telas.
 * Sem legenda: só rótulos, dados e ações.
 *
 * A Armazenagem (parte 4.7) usa o mesmo shell: o Estoque é um grupo, com as
 * telas dentro; o cliente ativo fica logo abaixo do seletor; e a tela que
 * ainda não passou para a v3 fica com o visual do WMS (`conteudoV3` falso).
 */

export type { ContadorDoItem } from "@/lib/resumo-do-modulo";

export type ShellDoModuloProps = {
  ambiente: "wms" | "comercial" | "operacao" | "financeiro";
  atual: { label: string; icon: LucideIcon };
  opcoes: readonly OpcaoDeModulo[];
  items: AppModule[];
  contadores?: Readonly<Record<string, ContadorDoItem>>;
  basePath: string;
  online: boolean;
  conta: (compact: boolean) => ReactNode;
  /** Logo abaixo do seletor (na barra) e ao lado dele (no cabeçalho do celular): o cliente ativo do WMS. */
  abaixoDoSeletor?: (compact: boolean) => ReactNode;
  /** A tela já segue a v3. Falso: só a barra, o cabeçalho e a barra do celular ficam na v3. */
  conteudoV3?: boolean;
  children: ReactNode;
};

const ITEM =
  "relative flex h-12 w-full shrink-0 items-center gap-3 rounded-lg px-3.5 text-left text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80";
const ITEM_ATUAL = "bg-v3-header-foreground/15 text-v3-header-foreground";
const ITEM_OUTRO = "text-v3-header-foreground/75 hover:bg-v3-header-foreground/10 hover:text-v3-header-foreground";

function MarcaDoAtual() {
  return <span aria-hidden="true" className="absolute inset-y-3.5 left-0 w-0.75 rounded-full bg-v3-marca" />;
}

/** O grupo do menu (o Estoque do WMS): o nome abre e fecha as telas de dentro. */
function GrupoDoMenu({
  item,
  location,
  aberto,
  onAlternar,
  contador,
}: {
  item: AppModule;
  location: string;
  aberto: boolean;
  onAlternar: () => void;
  contador: ContadorDoItem | undefined;
}) {
  const Icone = item.icon;
  const telas = item.routes.filter((route) => route.href);
  const atualNoGrupo = telas.some((route) => isNavRouteActive(location, route));
  const idDasTelas = `menu-${item.id}`;
  return (
    <div className="flex shrink-0 flex-col">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idDasTelas}
        onClick={onAlternar}
        className={cn(ITEM, atualNoGrupo && !aberto ? ITEM_ATUAL : ITEM_OUTRO)}
      >
        {atualNoGrupo && !aberto ? <MarcaDoAtual /> : null}
        <Icone className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <Contador contador={contador} />
        <ChevronDown className={cn("size-4 shrink-0 opacity-70 transition-transform", aberto ? "" : "-rotate-90")} aria-hidden="true" />
      </button>
      {aberto ? (
        <ul id={idDasTelas} className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-v3-header-foreground/15 pl-2.5">
          {telas.map((route) => {
            const IconeDaTela = route.icon;
            const atual = isNavRouteActive(location, route);
            return (
              <li key={route.id}>
                <Link
                  href={route.href ?? "/"}
                  aria-current={atual ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
                    atual ? ITEM_ATUAL : ITEM_OUTRO,
                  )}
                >
                  {atual ? <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-0.75 rounded-full bg-v3-marca" /> : null}
                  <IconeDaTela className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{route.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Contador({ contador }: { contador: ContadorDoItem | undefined }) {
  if (!contador || contador.n <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums",
        contador.alerta ? "bg-v3-marca text-v3-marca-foreground" : "bg-v3-header-foreground/15 text-v3-header-foreground",
      )}
    >
      {contador.n}
    </span>
  );
}

export function ShellDoModulo({
  ambiente,
  atual,
  opcoes,
  items,
  contadores,
  basePath,
  online,
  conta,
  abaixoDoSeletor,
  conteudoV3 = true,
  children,
}: ShellDoModuloProps) {
  const [location] = useLocation();
  const aberto = items.find((item) => item.routes.some((route) => isNavRouteActive(location, route)));
  // Os grupos abertos: o da tela aberta abre sozinho; os outros, pelo nome.
  const grupoDaTela = aberto && isModuleGroup(aberto) ? aberto.id : null;
  const [gruposAbertos, setGruposAbertos] = useState<ReadonlySet<string>>(() => new Set(grupoDaTela ? [grupoDaTela] : []));
  useEffect(() => {
    if (!grupoDaTela) return;
    setGruposAbertos((atuais) => (atuais.has(grupoDaTela) ? atuais : new Set([...atuais, grupoDaTela])));
  }, [grupoDaTela]);
  const alternar = (id: string) =>
    setGruposAbertos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(id)) proximos.delete(id);
      else proximos.add(id);
      return proximos;
    });

  return (
    <div
      data-ambiente={ambiente}
      className={cn("flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background font-sans text-foreground", conteudoV3 && "v3")}
    >
      <aside
        aria-label={atual.label}
        className="v3 hidden min-h-0 w-62 shrink-0 flex-col bg-v3-header px-3.5 pb-4 pt-6 font-sans text-v3-header-foreground md:flex"
      >
        <Link href="/" className="mb-5 block self-start rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80">
          <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog Soluções Logísticas" className="h-8 w-auto" />
        </Link>
        <SeletorDeModulo atual={atual} opcoes={opcoes} variante="v3" />
        {abaixoDoSeletor ? <div className="mt-2">{abaixoDoSeletor(false)}</div> : null}
        <nav aria-label={`Telas de ${atual.label}`} className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            if (isModuleGroup(item)) {
              return (
                <GrupoDoMenu
                  key={item.id}
                  item={item}
                  location={location}
                  aberto={gruposAbertos.has(item.id)}
                  onAlternar={() => alternar(item.id)}
                  contador={contadores?.[item.id]}
                />
              );
            }
            const Icone = item.icon;
            const atualItem = aberto?.id === item.id;
            return (
              <Link
                key={item.id}
                href={item.href ?? "/"}
                aria-current={atualItem ? "page" : undefined}
                className={cn(ITEM, atualItem ? ITEM_ATUAL : ITEM_OUTRO)}
              >
                {atualItem ? <MarcaDoAtual /> : null}
                <Icone className="size-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Contador contador={contadores?.[item.id]} />
              </Link>
            );
          })}
        </nav>
        <div className="mt-3 border-t border-v3-header-foreground/10 pt-3">{conta(false)}</div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="v3 shrink-0 bg-v3-header font-sans md:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-4">
            <SeletorDeModulo atual={atual} opcoes={opcoes} variante="v3-cabecalho" />
            {conta(true)}
          </div>
          {abaixoDoSeletor ? <div className="flex h-11 items-center border-t border-v3-header-foreground/10 px-3">{abaixoDoSeletor(true)}</div> : null}
        </header>
        {online ? null : (
          <p
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-soft-border bg-warning-soft px-4 py-2 text-sm font-bold text-warning-soft-foreground"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            Sem conexão
          </p>
        )}
        <main className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {/* No WMS a tela ocupa a altura (o chat do Agent Dute, as filas); nos outros, o chat do agente também. */}
          <div className={cn("mx-auto w-full max-w-[1600px] p-4 md:p-8 lg:px-11 lg:py-9", (ambiente === "wms" || ehTelaDoAgente(location)) && "h-full")}>
            {/* O que a tela abre em portal (diálogo, painel, menu) leva o .v3 junto. */}
            <NaV3.Provider value={conteudoV3}>{children}</NaV3.Provider>
          </div>
        </main>
        <div className={cn("contents", !conteudoV3 && "v3")}>
          <MobileTabBar activeModuleId={aberto?.id ?? null} modules={items} variante="v3" />
        </div>
      </div>
    </div>
  );
}
