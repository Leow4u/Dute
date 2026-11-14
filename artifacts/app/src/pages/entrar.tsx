import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { Redirect } from "wouter";

import { AuthShell } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppUser } from "@/lib/auth";
import { firebaseAuth, firebaseConfigError } from "@/lib/firebase";
import { MENSAGEM_DA_RECUPERACAO, problemaDaRecuperacao } from "@/lib/recuperar-senha";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuthFormState = {
  email: string;
  senha: string;
  error: string | null;
  loading: boolean;
};

const initialAuthState: AuthFormState = {
  email: "",
  senha: "",
  error: null,
  loading: false,
};

/**
 * A entrada com e-mail e senha (a /sign-in e a raiz sem sessão). Saiu do
 * App.tsx na parte 13h do carregamento v2, para ter teste: o "Entrar" é o
 * BotaoDeAcao, e a reticência é o caractere "…".
 */
export default function SignInPage() {
  const { user, isLoaded, accessDenied, accessRemoved } = useAppUser();
  const [form, setForm] = useState<AuthFormState>(initialAuthState);

  if (isLoaded && user) return <Redirect to="/" />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) return;

    setForm((current) => ({ ...current, loading: true, error: null }));
    try {
      await signInWithEmailAndPassword(
        firebaseAuth,
        form.email.trim(),
        form.senha,
      );
      window.location.assign(basePath || "/");
    } catch (error) {
      setForm((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error ? error.message : "Não foi possível entrar.",
      }));
    }
  }

  async function resetPassword() {
    if (!firebaseAuth) return;
    const problema = problemaDaRecuperacao(form.email);
    if (problema) {
      setForm((current) => ({ ...current, error: problema }));
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, form.email.trim());
      setForm((current) => ({ ...current, error: MENSAGEM_DA_RECUPERACAO.enviada }));
    } catch {
      setForm((current) => ({ ...current, error: MENSAGEM_DA_RECUPERACAO.falhou }));
    }
  }

  return (
    <AuthShell title="Entrar">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <PasswordInput
            id="senha"
            autoComplete="current-password"
            value={form.senha}
            onChange={(event) =>
              setForm((current) => ({ ...current, senha: event.target.value }))
            }
            required
          />
        </div>
        {form.error ? (
          <Alert
            variant={
              form.error.includes("recuperação") ? "default" : "destructive"
            }
          >
            <AlertDescription>{form.error}</AlertDescription>
          </Alert>
        ) : null}
        {accessDenied ? (
          <Alert variant="destructive">
            <AlertDescription>
              {accessRemoved
                ? "Seu acesso foi removido. Se precisar voltar a usar o sistema, fale com a administração da Dutelog."
                : "Seu e-mail ainda não tem convite ativo para acessar o sistema."}
            </AlertDescription>
          </Alert>
        ) : null}
        {/* Entrando, o botão é o BotaoDeAcao: o gerúndio aos 300 ms, aria-busy e aria-disabled, e o foco fica nele;
            nunca disabled, que levaria o foco ao body (carregamento v2, parte 13h). */}
        <BotaoDeAcao
          type="submit"
          className="w-full"
          estado={form.loading ? "andamento" : "repouso"}
          rotulo="Entrar"
          andamento="Entrando…"
          bloqueado={Boolean(firebaseConfigError)}
        />
      </form>
      <div className="mt-5 flex items-center justify-between border-t border-[var(--auth-line)] pt-4 text-sm">
        <button
          type="button"
          className="inline-flex min-h-11 items-center font-medium text-[var(--auth-accent)] transition-opacity hover:opacity-80"
          onClick={resetPassword}
        >
          Esqueci minha senha
        </button>
        <span className="text-[var(--auth-muted)]" title="Contas criadas apenas com link de convite">
          Acesso por convite
        </span>
      </div>
    </AuthShell>
  );
}
