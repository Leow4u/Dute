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
import type { Entrada } from "@/lib/platform-modules";
import { resumoDoModulo, type ResumoDoModulo } from "@/lib/resumo-do-modulo";
import { formatToday, greeting } from "@/lib/saudacao";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";
import { cn } from "@/lib/utils";

/**
 * Tela de entrada da plataforma (docs/plataforma/fase-2-nucleo.md, partes 2 e
 * 2.4): um card por módulo para quem tem dois ou mais; quem tem um vai direto
 * para ele e nunca vê esta tela. Cada card mostra quantas linhas o "Precisa de
 * você" do módulo tem e a primeira delas (docs/mockups/ModEntrada.dc.html).
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
      <DropdownMenuTrigger className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-semibold text-v3-header-foreground outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-ring">
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

function Contador({ resumo }: { resumo: ResumoDoModulo }) {
  if (!resumo.total) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-7.5 min-w-7.5 shrink-0 items-center justify-center rounded-full px-2.5 text-sm font-extrabold tabular-nums",
        resumo.alerta ? "bg-v3-marca text-v3-marca-foreground" : "bg-muted text-foreground",
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
  return (
    <div className="v3 min-h-dvh bg-background text-foreground">
      <header className="flex h-16 items-center justify-between gap-4 bg-v3-header px-4 text-v3-header-foreground sm:px-8">
        <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog" className="h-8 w-auto" />
        <ContaMenu name={name} onSignOut={onSignOut} />
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <p className="text-base font-semibold text-muted-foreground">{formatToday(today)}</p>
        <h1 className="mt-1 text-4xl font-extrabold tracking-tight">
          {greeting(today)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        {decision.kind === "cards" && resumosProntos ? (
          <p className="mt-1.5 text-lg text-muted-foreground">
            {frase.destaque ? <strong className="font-extrabold text-destructive-soft-foreground">{frase.destaque}</strong> : null}
            {frase.destaque ? " " : null}
            {frase.resto}
          </p>
        ) : null}
        {decision.kind === "cards" ? (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {decision.modules.map(({ module, href }) => {
              const Icon = module.icon;
              const resumo = resumos[module.key];
              return (
                <li key={module.key}>
                  <Link
                    href={href}
                    className="flex min-h-26 items-center gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-13 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-lg font-extrabold">{module.label}</span>
                      {resumo?.primeira ? <span className="truncate text-sm text-muted-foreground">{resumo.primeira}</span> : null}
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
  const fontes: Array<[(typeof chaves)[number], FonteDoResumo]> = [
    ["wms", { itens: wms.items, carregando: wms.carregando, falhas: wms.falhas }],
    ["comercial", comercial],
    ["operacao", operacao],
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
