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
import type { Entrada } from "@/lib/platform-modules";
import { formatToday, greeting } from "@/lib/saudacao";

/**
 * Tela de entrada da plataforma (docs/plataforma/fase-2-nucleo.md, parte 2):
 * um card por módulo para quem tem dois ou mais; quem tem um vai direto para
 * ele e nunca vê esta tela. Identidade v3 (docs/mockups), só aqui dentro
 * (.v3 em index.css). Sem legenda: rótulos, dados e ações.
 */

export type EntradaTela = Exclude<Entrada, { kind: "redirect" }>;

type EntradaViewProps = {
  decision: EntradaTela;
  name: string;
  today: Date;
  basePath: string;
  onSignOut: () => void;
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

export function EntradaView({ decision, name, today, basePath, onSignOut }: EntradaViewProps) {
  const firstName = name.split(" ")[0] ?? "";
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
        {decision.kind === "cards" ? (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decision.modules.map(({ module, href }) => {
              const Icon = module.icon;
              return (
                <li key={module.key}>
                  <Link
                    href={href}
                    className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-13 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <span className="text-lg font-extrabold">{module.label}</span>
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

export default function EntradaPage({ decision }: { decision: EntradaTela }) {
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <EntradaView
      decision={decision}
      name={user?.fullName ?? ""}
      today={new Date()}
      basePath={basePath}
      onSignOut={() => void signOut({ redirectUrl: basePath || "/" })}
    />
  );
}
