import type React from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { firebaseConfigError } from "@/lib/firebase";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Capa do app: é a porta de entrada de app.dutelog.com.br.
 *
 * Split-screen — formulário à esquerda, painel visual à direita. Nenhuma
 * informação operacional aparece antes da autenticação: esta página é
 * pública, e dado de cliente não se expõe em página pública. A imagem do
 * painel é arte abstrata de armazém gerada para a marca, sem dado algum.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  // Só a marca (símbolo) no formulário: o wordmark completo já vive na
  // imagem do painel, e repeti-lo aqui seria marca dupla.
  const markPath = `${basePath}/dutelog-mark-64.png`;
  const visualPath = `${basePath}/auth-visual.jpg`;
  const year = new Date().getFullYear();

  return (
    <div className="auth-cover relative grid min-h-[100dvh] overflow-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Coluna do formulário */}
      <div className="relative flex min-h-[100dvh] flex-col px-6 py-7 sm:px-12 lg:min-h-0">
        <div
          aria-hidden
          className="auth-glow pointer-events-none absolute inset-x-0 top-0 h-[420px] lg:hidden"
        />

        <header className="relative">
          <img
            src={markPath}
            alt="Dutelog"
            className="h-9 w-9 rounded-lg object-contain"
          />
        </header>

        <main className="relative flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[420px]">
            <h1 className="auth-title text-3xl">{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--auth-muted)]">
                {subtitle}
              </p>
            ) : null}

            <div
              className={`auth-card rounded-2xl p-6 sm:p-7 ${subtitle ? "mt-8" : "mt-6"}`}
            >
              {firebaseConfigError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{firebaseConfigError}</AlertDescription>
                </Alert>
              ) : null}
              {children}
            </div>
          </div>
        </main>

        <footer className="relative">
          <p className="text-xs text-[var(--auth-muted)]">
            © {year} Dutelog Soluções Logísticas
          </p>
        </footer>
      </div>

      {/* Painel visual — some no mobile; o formulário é o protagonista lá. */}
      <aside
        aria-hidden
        className="relative hidden overflow-hidden lg:block"
      >
        <img
          src={visualPath}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Véus: integram a imagem ao canvas e garantem contraste do selo. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--auth-canvas)] via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--auth-canvas)]/90 via-transparent to-[var(--auth-canvas)]/30" />
        <div className="auth-grid absolute inset-0 opacity-60" />

      </aside>
    </div>
  );
}
