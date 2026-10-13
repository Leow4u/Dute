/* Capa da demo: o mesmo visual do login de produção, com os dois perfis prontos. */
import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, RotateCcw, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import markUrl from "../public/dutelog-mark-64.png";
import visualUrl from "../public/auth-visual.jpg";
import { CUSTOMER, resetDemoState } from "./data";
import { AVAILABLE_PROFILES, profileForLogin, writeSession, type DemoProfile } from "./session";
import { LANG, setLang, type Lang } from "./i18n/lang";

function switchLang(lang: Lang) {
  if (lang === LANG) return;
  setLang(lang);
  window.location.reload();
}

function enter(profile: DemoProfile) {
  writeSession(profile.key);
  // Sem a busca da sessão anterior (?c=...), direto na tela inicial do perfil.
  window.history.replaceState(null, "", `${window.location.pathname}#${profile.home}`);
  window.location.reload();
}

export default function DemoLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const year = new Date().getFullYear();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = profileForLogin(email, password);
    if (!profile) {
      setError(AVAILABLE_PROFILES.length > 1 ? "E-mail ou senha não conferem. Use um dos acessos de demonstração abaixo." : "E-mail ou senha não conferem. Use o acesso de demonstração abaixo.");
      return;
    }
    enter(profile);
  }

  function fill(profile: DemoProfile) {
    setEmail(profile.login);
    setPassword(profile.password);
    setError(null);
  }

  return (
    <div className="auth-cover relative grid min-h-[100dvh] overflow-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative flex min-h-[100dvh] flex-col px-6 py-7 sm:px-12 lg:min-h-0">
        <div aria-hidden className="auth-glow pointer-events-none absolute inset-x-0 top-0 h-[420px] lg:hidden" />

        <header className="relative flex items-center gap-3">
          <img src={markUrl} alt="Dutelog" className="h-9 w-9 object-contain" />
          <span className="demo-pill">
            Ambiente de demonstração
          </span>
          <div className="demo-lang" role="group" aria-label="Idioma" data-no-translate>
            <button type="button" aria-pressed={LANG === "pt"} onClick={() => switchLang("pt")}>
              Português
            </button>
            <button type="button" aria-pressed={LANG === "en"} onClick={() => switchLang("en")}>
              English
            </button>
          </div>
        </header>

        <main className="relative flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[420px]">
            <h1 className="auth-title text-3xl">Entrar</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--auth-muted)]">
              Sistema Dutelog com dados fictícios de mobiliário e material de marketing da conta {CUSTOMER}.
            </p>

            <div className="auth-card mt-8 rounded-2xl p-6 sm:p-7">
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="demo-email">E-mail</Label>
                  <Input id="demo-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="demo-password">Senha</Label>
                  <Input id="demo-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
                {error ? <p className="demo-error">{error}</p> : null}
                <Button type="submit" className="w-full">
                  Entrar
                </Button>
              </form>

              <div className="demo-access">
                <p className="demo-access-title">{AVAILABLE_PROFILES.length > 1 ? "Acessos de demonstração" : "Acesso de demonstração"}</p>
                <ul className="demo-access-list">
                  {AVAILABLE_PROFILES.map((profile) => {
                    const Icon = profile.key === "cliente" ? Store : Building2;
                    return (
                      <li key={profile.key}>
                        <button
                          type="button"
                          onClick={() => enter(profile)}
                          onFocus={() => fill(profile)}
                          onMouseEnter={() => fill(profile)}
                          className="demo-profile"
                        >
                          <Icon className="demo-profile-icon" aria-hidden />
                          <span className="demo-profile-body">
                            <span className="demo-profile-title">{profile.label}</span>
                            <span className="demo-profile-hint">{profile.hint}</span>
                            <span className="demo-profile-login">
                              {profile.login} · senha {profile.password}
                            </span>
                          </span>
                          <ArrowRight className="demo-profile-arrow" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                resetDemoState();
                setRestored(true);
              }}
              className="demo-reset"
            >
              <RotateCcw aria-hidden />
              {restored ? "Dados da demonstração restaurados" : "Restaurar os dados da demonstração"}
            </button>
          </div>
        </main>

        <footer className="relative">
          <p className="text-xs text-[var(--auth-muted)]">© {year} Dutelog Soluções Logísticas · demonstração com dados fictícios</p>
        </footer>
      </div>

      <aside aria-hidden className="relative hidden overflow-hidden lg:block">
        <img src={visualUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--auth-canvas)] via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--auth-canvas)]/90 via-transparent to-[var(--auth-canvas)]/30" />
        <div className="auth-grid absolute inset-0 opacity-60" />
      </aside>
    </div>
  );
}
