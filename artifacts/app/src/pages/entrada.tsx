import { LogOut, Settings } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { useInicioDoComercial } from "@/lib/comercial/use-inicio";
import { fraseDoInicio } from "@/lib/inicio-do-modulo";
import { useInicioDaOperacao } from "@/lib/operacao/use-inicio";
import { abreFinanceiro } from "@/lib/financeiro/navegacao";
import { useInicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";
import { useInicioDoRh } from "@/lib/rh/use-rh";
import type { Entrada } from "@/lib/platform-modules";
import { resumoDoModulo, type ResumoDoModulo } from "@/lib/resumo-do-modulo";
import { formatToday, greeting } from "@/lib/saudacao";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";
import { cn } from "@/lib/utils";

/**
 * Tela de entrada da plataforma (docs/plataforma/fase-2-nucleo.md, partes 2 e
 * 2.4): um card por módulo para quem tem dois ou mais; quem tem um vai direto
 * para ele e nunca vê esta tela. Cada card mostra quantas linhas o "Precisa de
 * você" do módulo tem e a primeira delas. Desde 16/11/2026 é um lobby: a foto do
 * login ao fundo e um bloco colorido por módulo (docs/mockups/ModEntradaV2.dc.html).
 * Identidade v3, só aqui dentro (.v3 em index.css). Sem legenda: rótulos,
 * dados e ações.
 */

export type EntradaTela = Exclude<Entrada, { kind: "redirect" }>;

/** O resumo de cada módulo com Início; sem a chave, o card fica só com o nome. */
export type ResumosDaEntrada = Partial<Record<string, ResumoDoModulo>>;

type EntradaViewProps = {
  decision: EntradaTela;
  name: string;
  today: Date;
  basePath: string;
  onSignOut: () => void;
  resumos?: ResumosDaEntrada;
  /** Todos os resumos chegaram: a frase de quantas coisas esperam pode aparecer. */
  resumosProntos?: boolean;
};

function initials(name: string) {
  const parts = name.split(/\s+/).filter((part) => /^\p{L}/u.test(part));
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

function ContaMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-semibold text-v3-header-foreground focus-visible:outline-hidden transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-foco">
        <span className="hidden max-w-48 truncate sm:inline">{name}</span>
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full bg-v3-header-foreground/15 text-xs font-bold"
        >
          {initials(name)}
        </span>
        <span className="sr-only">Minha conta</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/configuracoes" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Configuração
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * O véu sobre a foto do lobby (docs/mockups/ModEntradaV2.dc.html): fechado à
 * esquerda, onde ficam o texto e os blocos, e aberto à direita para a cena.
 * Lê o --v3-header, a tinta da v3, igual nos dois temas.
 */
const VEU_LARGO =
  "linear-gradient(90deg, hsl(var(--v3-header) / 0.97) 0%, hsl(var(--v3-header) / 0.94) 36%, hsl(var(--v3-header) / 0.72) 62%, hsl(var(--v3-header) / 0.3) 100%)";
/** No celular o véu desce: o texto e os blocos ocupam a tela inteira. */
const VEU_ESTREITO =
  "linear-gradient(180deg, hsl(var(--v3-header) / 0.9) 0%, hsl(var(--v3-header) / 0.93) 58%, hsl(var(--v3-header) / 0.78) 100%)";

/** O contador do "Precisa de você" no canto do bloco: vermelho da marca só no módulo com item crítico, com um aro para não sumir sobre a cor do bloco. */
function Contador({ resumo }: { resumo: ResumoDoModulo }) {
  if (!resumo.total) return null;
  return (
    <span
      className={cn(
        "absolute top-4 right-4 inline-flex h-7.5 min-w-7.5 shrink-0 items-center justify-center rounded-full px-2.5 text-sm font-extrabold tabular-nums",
        resumo.alerta ? "bg-v3-marca text-v3-marca-foreground ring-2 ring-v3-header-foreground/90" : "bg-v3-header-foreground text-v3-header",
      )}
    >
      {resumo.total}
    </span>
  );
}

export function EntradaView({ decision, name, today, basePath, onSignOut, resumos = {}, resumosProntos = false }: EntradaViewProps) {
  const firstName = name.split(" ")[0] ?? "";
  const total = Object.values(resumos).reduce((soma, resumo) => soma + (resumo?.total ?? 0), 0);
  const frase = fraseDoInicio(total, "hoje");
  const modulos = decision.kind === "cards" ? decision.modules : [];
  // Com número ímpar de módulos, o último bloco ocupa as duas colunas do celular, para não sobrar buraco.
  const ultimoInteiro = modulos.length % 2 === 1 ? modulos.length - 1 : -1;
  return (
    <div className="v3 relative min-h-dvh overflow-hidden bg-v3-header text-v3-header-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{ backgroundImage: `url(${basePath}/auth-visual.jpg)`, backgroundPosition: "50% 27%" }}
      />
      <div aria-hidden="true" className="absolute inset-0 sm:hidden" style={{ background: VEU_ESTREITO }} />
      <div aria-hidden="true" className="absolute inset-0 hidden sm:block" style={{ background: VEU_LARGO }} />
      <header className="relative flex h-19 items-center justify-between gap-4 px-4 sm:px-12">
        <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog" className="h-7 w-auto sm:h-8" />
        <ContaMenu name={name} onSignOut={onSignOut} />
      </header>
      <main className="relative mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-12 sm:pt-16">
        <p className="text-sm font-semibold text-v3-header-foreground/70 sm:text-base">{formatToday(today)}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-5xl">
          {greeting(today)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        {decision.kind === "cards" && resumosProntos ? (
          <p className="mt-2 text-base text-v3-header-foreground/85 sm:text-lg">
            {frase.destaque ? <strong className="font-extrabold text-v3-header-foreground">{frase.destaque}</strong> : null}
            {frase.destaque ? " " : null}
            {frase.resto}
          </p>
        ) : null}
        {decision.kind === "cards" ? (
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            {modulos.map(({ module, href }, indice) => {
              const Icon = module.icon;
              const resumo = resumos[module.key];
              return (
                <li key={module.key} className={cn(indice === ultimoInteiro && "col-span-2 md:col-span-1")}>
                  <Link
                    href={href}
                    className={cn(
                      "relative flex min-h-40 flex-col justify-between rounded-lg p-4 text-v3-header-foreground shadow-lg transition focus-visible:outline-hidden hover:brightness-110 focus-visible:ring-2 focus-visible:ring-foco focus-visible:ring-offset-2 focus-visible:ring-offset-v3-header sm:min-h-47",
                      module.cor,
                    )}
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-v3-header-foreground/15">
                      <Icon className="size-7" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xl font-extrabold leading-tight tracking-tight">{module.label}</span>
                      {resumo?.primeira ? <span className="mt-1 line-clamp-2 text-sm font-semibold">{resumo.primeira}</span> : null}
                    </span>
                    {resumo ? <Contador resumo={resumo} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground">
            <h2 className="text-lg font-extrabold">Nenhum módulo liberado</h2>
            <Button variant="outline" onClick={onSignOut}>
              Sair
            </Button>
          </section>
        )}
      </main>
    </div>
  );
}

type FonteDoResumo = { itens: ReadonlyArray<{ tone: string; title: string; href: string }>; carregando: boolean; falhas: readonly string[] };

/** O resumo da fonte quando ela chegou inteira; carregando ou com falha, nada (o card não inventa zero). */
function resumoDa(fonte: FonteDoResumo): ResumoDoModulo | undefined {
  return fonte.carregando || fonte.falhas.length ? undefined : resumoDoModulo(fonte.itens);
}

/**
 * As mesmas leituras dos Inícios, só para os módulos dos cards: quem não abre
 * a Operação não assina nada dela, e assim por diante.
 */
function useResumosDaEntrada(decision: EntradaTela): { resumos: ResumosDaEntrada; prontos: boolean } {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const chaves = decision.kind === "cards" ? decision.modules.map((entrada) => entrada.module.key) : [];
  const wms = useInicioDoWms(role, chaves.includes("wms"));
  const comercial = useInicioDoComercial(role, user?.uid, chaves.includes("comercial"));
  const operacao = useInicioDaOperacao(role, new Date(), chaves.includes("operacao"));
  // O card do Financeiro só conta onde leva ao shell dele; fora da liberação leva ao Faturamento do WMS, sem contador.
  const comFinanceiro = chaves.includes("financeiro") && abreFinanceiro(role);
  const financeiro = useInicioDoFinanceiro(role, new Date(), comFinanceiro);
  // O card do RH só existe com a liberação dele (modulesForPerson): a leitura é a do Início do RH.
  const rh = useInicioDoRh(role, chaves.includes("rh"));
  const fontes: Array<[(typeof chaves)[number], FonteDoResumo]> = [
    ["wms", { itens: wms.items, carregando: wms.carregando, falhas: wms.falhas }],
    ["comercial", comercial],
    ["operacao", operacao],
    ...(comFinanceiro ? ([["financeiro", financeiro]] as Array<[(typeof chaves)[number], FonteDoResumo]>) : []),
    ["rh", rh],
  ];
  const resumos: ResumosDaEntrada = {};
  let prontos = true;
  for (const [chave, fonte] of fontes) {
    if (!chaves.includes(chave)) continue;
    const resumo = resumoDa(fonte);
    if (resumo) resumos[chave] = resumo;
    else prontos = false;
  }
  return { resumos, prontos };
}

export default function EntradaPage({ decision }: { decision: EntradaTela }) {
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { resumos, prontos } = useResumosDaEntrada(decision);
  return (
    <EntradaView
      decision={decision}
      name={user?.fullName ?? ""}
      today={new Date()}
      basePath={basePath}
      onSignOut={() => void signOut({ redirectUrl: basePath || "/" })}
      resumos={resumos}
      resumosProntos={prontos}
    />
  );
}
