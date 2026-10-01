import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import {
  Switch,
  Route,
  Link,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

import AppLayout from "./components/layout/app-layout";
import SettingsLayout from "./components/layout/settings-layout";
import type { WarehouseOpsModuleKey } from "./lib/warehouse-ops/model";
import NotFound from "./pages/not-found";

/**
 * Um deploy troca o hash de todos os chunks. Com registerType "autoUpdate" +
 * skipWaiting, uma aba aberta desde antes do deploy pede um chunk que não
 * existe mais ao navegar — o import dinâmico rejeita, passa por cima do
 * Suspense e a tela fica branca. Aqui isso vira um convite a recarregar.
 */
class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>
          Nao foi possivel carregar esta tela. Uma nova versao pode ter sido
          publicada.
        </p>
        <Button type="button" onClick={() => window.location.reload()}>
          Recarregar
        </Button>
      </div>
    );
  }
}

const Home = lazy(() => import("./pages/home"));
const Catalog = lazy(() => import("./pages/catalog"));
const Movements = lazy(() => import("./pages/movements"));
const Orders = lazy(() => import("./pages/orders"));
const Reports = lazy(() => import("./pages/reports"));
const BillingHub = lazy(() => import("./pages/billing-hub"));
const BillingInvoice = lazy(() => import("./pages/billing-invoice"));
const Users = lazy(() => import("./pages/users"));
const SettingsCustomer = lazy(() => import("./pages/settings-customer"));
const Documents = lazy(() => import("./pages/documents"));
const Settings = lazy(() => import("./pages/settings"));
const SettingsAccount = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsAccount })),
);
const SettingsApp = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsApp })),
);
const AiControl = lazy(() => import("./pages/ai-control"));
const AgentKnowledge = lazy(() => import("./pages/agent-knowledge"));
const SettingsSystem = lazy(() => import("./pages/settings-system"));
const CustomerRequests = lazy(() => import("./pages/customer-requests"));
const WarehouseOps = lazy(() => import("./pages/warehouse-ops"));
const WmsInventoryPage = lazy(() => import("./pages/wms-inventory"));
const Pedidos = lazy(() => import("./pages/pedidos"));
const Estoque = lazy(() => import("./pages/estoque"));
const WmsReturnsPage = lazy(() => import("./pages/wms-returns"));
const ClienteAssistente = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteAssistente })),
);
const ClienteDocumentos = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteDocumentos })),
);
const ClienteEstoque = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteEstoque })),
);
const ClienteFaturas = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteFaturas })),
);
const ClienteFatura = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteFatura })),
);
const ClienteInicio = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteInicio })),
);
const ClientePedidos = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClientePedidos })),
);
const ClienteSolicitacoes = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteSolicitacoes })),
);
import { useRole } from "./hooks/use-role";
import { AuthProvider, useAppUser } from "./lib/auth";
import {
  firebaseApp,
  firebaseAuth,
  firebaseConfigError,
  firestore,
} from "./lib/firebase";
import {
  canAccessModule,
  getHomePathForAppRole,
  getHomePathForProfile,
  getRouteAppRoles,
  getRouteProfileRoles,
  normalizeProfileRole,
  type CurrentAppRole as AppRole,
  type ProfileRole,
} from "./lib/modules";
import { queryClient } from "./lib/queryClient";
import { RealtimeSyncBridge } from "./lib/realtime-sync";
import { LEGACY_SETTINGS_REDIRECTS, isSettingsPath } from "./lib/settings-nav";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuthFormState = {
  nome: string;
  email: string;
  senha: string;
  error: string | null;
  loading: boolean;
};

type InviteState =
  | { status: "loading" }
  | { status: "missing" | "invalid" | "used" }
  | {
      status: "ready";
      token: string;
      data: {
        email: string;
        nome?: string;
        role: ProfileRole;
        customer_code?: string;
      };
    };

type InviteData = {
  email?: string;
  nome?: string;
  role?: string;
  status?: string;
  customer_code?: string;
};

const initialAuthState: AuthFormState = {
  nome: "",
  email: "",
  senha: "",
  error: null,
  loading: false,
};

function normalizeInviteRole(role: unknown): ProfileRole | null {
  return normalizeProfileRole(role);
}

function appRole(role: ProfileRole): AppRole {
  return role === "cliente" ? "cliente" : "interno";
}

function roleLabel(role: ProfileRole) {
  if (role === "owner") return "owner Dutelog";
  if (role === "admin") return "admin Dutelog";
  if (role === "wms") return "operação WMS";
  if (role === "financeiro") return "financeiro";
  if (role === "suporte") return "suporte";
  if (role === "interno") return "interno Dutelog";
  return "cliente";
}

function getRestString(
  fields: Record<string, { stringValue?: string }> | undefined,
  key: string,
) {
  const value = fields?.[key]?.stringValue;
  return typeof value === "string" ? value : undefined;
}

async function fetchInviteViaRest(token: string): Promise<InviteData | null> {
  const projectId = firebaseApp?.options.projectId;
  const apiKey = firebaseApp?.options.apiKey;
  if (!projectId || !apiKey) throw new Error("Firebase config unavailable");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId,
      )}/databases/(default)/documents/invites/${encodeURIComponent(
        token,
      )}?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );

    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Invite lookup failed: ${response.status}`);

    const payload = (await response.json()) as {
      fields?: Record<string, { stringValue?: string }>;
    };

    return {
      email: getRestString(payload.fields, "email"),
      nome: getRestString(payload.fields, "nome"),
      role: getRestString(payload.fields, "role"),
      status: getRestString(payload.fields, "status"),
      customer_code: getRestString(payload.fields, "customer_code"),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchInviteViaSdk(token: string): Promise<InviteData | null> {
  if (!firestore) return null;
  const snapshot = await getDoc(doc(firestore, "invites", token));
  return snapshot.exists() ? (snapshot.data() as InviteData) : null;
}

async function fetchInvite(token: string): Promise<InviteData | null> {
  try {
    if (firebaseApp) {
      const lookup = httpsCallable<{ token: string }, InviteData>(
        getFunctions(firebaseApp, "southamerica-east1"),
        "lookupInvite",
      );
      const result = await lookup({ token });
      return result.data;
    }
  } catch {
    // Keep the REST/SDK fallback for an older deployment during rollout.
  }
  try {
    return await fetchInviteViaRest(token);
  } catch {
    return fetchInviteViaSdk(token);
  }
}

/**
 * Capa do app: é a porta de entrada de app.dutelog.com.br.
 *
 * Split-screen — formulário à esquerda, painel visual à direita. Nenhuma
 * informação operacional aparece antes da autenticação: esta página é
 * pública, e dado de cliente não se expõe em página pública. A imagem do
 * painel é arte abstrata de armazém gerada para a marca, sem dado algum.
 */
function AuthShell({
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
            className="h-9 w-9 object-contain"
          />
        </header>

        <main className="relative flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[420px]">
            <h1 className="auth-title text-[28px]">{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--auth-muted)]">
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
          <p className="text-[12px] text-[var(--auth-muted)]">
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

function SignInPage() {
  const [, setLocation] = useLocation();
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
    if (!firebaseAuth || !form.email.trim()) return;
    await sendPasswordResetEmail(firebaseAuth, form.email.trim());
    setForm((current) => ({
      ...current,
      error: "E-mail de recuperação enviado.",
    }));
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
          <Input
            id="senha"
            type="password"
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
        <Button
          type="submit"
          className="w-full"
          disabled={form.loading || Boolean(firebaseConfigError)}
        >
          {form.loading ? "Entrando..." : "Entrar"}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between border-t border-[var(--auth-line)] pt-4 text-[13px]">
        <button
          type="button"
          className="font-medium text-[var(--auth-accent)] transition-opacity hover:opacity-80"
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

function SignUpPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useAppUser();
  const [form, setForm] = useState<AuthFormState>(initialAuthState);
  const [invite, setInvite] = useState<InviteState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      const token = new URLSearchParams(window.location.search).get("invite");
      if (!token) {
        if (active) setInvite({ status: "missing" });
        return;
      }

      const data = await fetchInvite(token);
      if (!data) {
        if (active) setInvite({ status: "invalid" });
        return;
      }

      if (data.status !== "pending") {
        if (active) setInvite({ status: "used" });
        return;
      }

      const role = normalizeInviteRole(data.role);
      const email = String(data.email ?? "")
        .trim()
        .toLowerCase();
      const customerCode =
        data.customer_code ?? (role === "cliente" ? "BTG Pactual" : "Dutelog");
      if (!email || !role) {
        if (active) setInvite({ status: "invalid" });
        return;
      }

      if (active) {
        setInvite({
          status: "ready",
          token,
          data: {
            email,
            nome: data.nome,
            role,
            customer_code: customerCode,
          },
        });
        setForm((current) => ({
          ...current,
          nome: String(data.nome ?? ""),
          email,
        }));
      }
    }

    loadInvite().catch(() => {
      if (active) setInvite({ status: "invalid" });
    });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth || !firestore || invite.status !== "ready") return;

    setForm((current) => ({ ...current, loading: true, error: null }));
    let createdNewUser = false;
    try {
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(
          firebaseAuth,
          invite.data.email,
          form.senha,
        );
        createdNewUser = true;
        await updateProfile(credential.user, { displayName: form.nome.trim() });
      } catch (error) {
        if ((error as { code?: string }).code !== "auth/email-already-in-use") {
          throw error;
        }
        credential = await signInWithEmailAndPassword(
          firebaseAuth,
          invite.data.email,
          form.senha,
        );
      }

      const batch = writeBatch(firestore);
      batch.set(doc(firestore, "users", credential.user.uid), {
        nome: form.nome.trim(),
        email: invite.data.email,
        role: invite.data.role,
        customer_code: invite.data.customer_code,
        invite_id: invite.token,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      batch.update(doc(firestore, "invites", invite.token), {
        status: "used",
        used_by: credential.user.uid,
        used_at: serverTimestamp(),
      });
      await batch.commit();
      await fetch("/api/ai/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "access.invite_accepted",
          title: "Convite aceito",
          description: `${form.nome.trim()} ativou acesso como ${roleLabel(
            invite.data.role,
          )}.`,
          severity: "info",
          entity_type: "usuario",
          entity_id: credential.user.uid,
          customer_code:
            invite.data.customer_code ??
            (appRole(invite.data.role) === "cliente"
              ? "BTG Pactual"
              : "Dutelog"),
          payload: {
            email: invite.data.email,
            role: invite.data.role,
            customer_code: invite.data.customer_code,
            invite_id: invite.token,
          },
        }),
      }).catch(() => undefined);

      setLocation("/");
    } catch (error) {
      if (createdNewUser && firebaseAuth.currentUser) {
        await deleteUser(firebaseAuth.currentUser).catch(() => undefined);
      }
      setForm((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível criar a conta.",
      }));
    }
  }

  if (isLoaded && user) {
    return (
      <AuthShell
        title="Você já está conectado"
        subtitle="Saia da conta atual para aceitar este convite"
      >
        <Alert>
          <AlertDescription>
            Esta janela está conectada como{" "}
            <span className="font-medium text-foreground">
              {user.primaryEmailAddress.emailAddress || "usuário autenticado"}
            </span>
            . O convite deve ser aceito pela conta da pessoa convidada.
          </AlertDescription>
        </Alert>
        {form.error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{form.error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-4 grid gap-3">
          <Button
            type="button"
            disabled={form.loading || !firebaseAuth}
            onClick={async () => {
              if (!firebaseAuth) return;
              setForm((current) => ({
                ...current,
                loading: true,
                error: null,
              }));
              try {
                await signOut(firebaseAuth);
                setForm((current) => ({ ...current, loading: false }));
              } catch (error) {
                setForm((current) => ({
                  ...current,
                  loading: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Não foi possível sair da conta atual.",
                }));
              }
            }}
          >
            {form.loading ? "Saindo..." : "Sair e continuar com o convite"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation("/")}
          >
            Voltar ao sistema
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (invite.status === "loading") {
    return (
      <AuthShell title="Validando convite" subtitle="Aguarde um instante">
        <div className="text-center text-sm text-muted-foreground">
          Conferindo seu convite...
        </div>
      </AuthShell>
    );
  }

  if (invite.status !== "ready") {
    const message =
      invite.status === "used"
        ? "Este convite já foi usado."
        : invite.status === "missing"
          ? "Este cadastro só funciona por link de convite."
          : "Convite inválido ou não encontrado.";

    return (
      <AuthShell
        title="Convite necessário"
        subtitle="Acesso controlado pela Dute"
      >
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          onClick={() => setLocation("/sign-in")}
        >
          Voltar para login
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Aceitar convite" subtitle="Crie sua senha para acessar">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            autoComplete="name"
            value={form.nome}
            onChange={(event) =>
              setForm((current) => ({ ...current, nome: event.target.value }))
            }
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email-signup">E-mail</Label>
          <Input
            id="email-signup"
            type="email"
            autoComplete="email"
            value={form.email}
            readOnly
            required
          />
        </div>
        <div className="soft-panel rounded-[16px] px-4 py-3 text-sm text-muted-foreground">
          Perfil do convite:{" "}
          <span className="font-medium text-foreground">
            {roleLabel(invite.data.role)}
          </span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="senha-signup">Senha</Label>
          <Input
            id="senha-signup"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={form.senha}
            onChange={(event) =>
              setForm((current) => ({ ...current, senha: event.target.value }))
            }
            required
          />
        </div>
        {form.error ? (
          <Alert variant="destructive">
            <AlertDescription>{form.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={form.loading || Boolean(firebaseConfigError)}
        >
          {form.loading ? "Criando..." : "Aceitar convite"}
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 w-full text-sm font-medium text-primary hover:underline"
        onClick={() => setLocation("/sign-in")}
      >
        Já tenho conta
      </button>
    </AuthShell>
  );
}

function QueryClientCacheInvalidator() {
  const { user, isLoaded } = useAppUser();
  const queryClientInstance = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const userId = user?.uid ?? null;
    if (
      prevUserIdRef.current !== undefined &&
      prevUserIdRef.current !== userId
    ) {
      queryClientInstance.clear();
    }
    prevUserIdRef.current = userId;
  }, [isLoaded, queryClientInstance, user?.uid]);

  return null;
}

function RoleHome() {
  const { role, isLoaded } = useRole();
  const { user } = useAppUser();
  if (!isLoaded) return null;
  const profileRole = user?.publicMetadata.role;
  // Papel do perfil decide a aterrissagem (wms → bancada, financeiro →
  // faturamento); o appRole agregado fica de fallback.
  return (
    <Redirect
      to={
        profileRole
          ? getHomePathForProfile(profileRole)
          : getHomePathForAppRole(role)
      }
    />
  );
}

function HomeRedirect() {
  const { user, isLoaded } = useAppUser();
  if (!isLoaded) return null;
  if (!user) return <SignInPage />;
  return <RoleHome />;
}

function RoleGate({
  appRoles,
  profileRoles,
  children,
}: {
  appRoles: AppRole[];
  profileRoles: ProfileRole[];
  children: React.ReactNode;
}) {
  const { role, isLoaded } = useRole();
  const { user } = useAppUser();
  if (!isLoaded) return null;
  if (!role || !appRoles.includes(role)) return <Redirect to="/" />;
  if (!canAccessModule(user?.publicMetadata.role, profileRoles)) {
    return <Redirect to="/" />;
  }
  return <>{children}</>;
}

type ProtectedRouteConfig = {
  path: string;
  component: React.ComponentType<any>;
  appRoles: AppRole[];
  profileRoles: ProfileRole[];
  layout: "app" | "settings";
};

function protectedRoute(
  path: string,
  component: React.ComponentType<any>,
): ProtectedRouteConfig {
  return {
    path,
    component,
    appRoles: getRouteAppRoles(path),
    profileRoles: getRouteProfileRoles(path),
    // Configuração é tela própria, sem o menu do app (lib/settings-nav.ts).
    layout: isSettingsPath(path) ? "settings" : "app",
  };
}

/**
 * Bancada em 2 abas — o que tem (Estoque) e o que chegou (Receber). O que
 * o cliente pediu está em /pedidos, item próprio do menu. As etapas enterprise (putaway/picking/packing/expedição/
 * qualidade/exceções) continuam roteáveis por URL como telas de exceção,
 * fora da régua. A contagem (abertura/cíclica) vive em /wms/contagem,
 * alcançada pelo botão dentro da própria régua.
 */
const WMS_STAGES: Array<{ label: string; path: string; match?: string[] }> = [
  { label: "Estoque", path: "/estoque", match: ["/estoque", "/wms/contagem"] },
  { label: "Receber", path: "/wms/receber", match: ["/wms/receber", "/wms/recebimento"] },
];

function WmsStageTabs() {
  const [location, navigate] = useLocation();
  const active =
    WMS_STAGES.find((stage) =>
      (stage.match ?? [stage.path]).some((path) => location === path),
    )?.path ?? "/wms";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={active} onValueChange={(value) => navigate(value)}>
        <TabsList className="h-auto flex-wrap">
          {WMS_STAGES.map((stage) => (
            <TabsTrigger key={stage.path} value={stage.path}>
              {stage.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {location === "/wms" || location === "/wms/contagem" ? (
        <Button asChild type="button" variant="outline" size="sm">
          <Link href="/wms/contagem">Contagem de estoque</Link>
        </Button>
      ) : null}
    </div>
  );
}

function WmsModuleScreen({ module }: { module: WarehouseOpsModuleKey }) {
  // Force remount when the WMS module changes so shared WarehouseOps state
  // never leaks between Recebimento / Putaway / etc.
  return <WarehouseOps key={module} initialModule={module} />;
}

// Aba Receber: o centro de recebimento existente.
const WmsReceiveScreen = () => (
  <div className="space-y-6">
    <WmsStageTabs />
    <WarehouseOps key="receiving" initialModule="receiving" />
  </div>
);

// A fila de pedidos saiu da bancada: é o item "Pedidos" do menu.
const WmsOrdersRedirect = () => <Redirect to="/pedidos" />;
// Saldos virou a lista de Itens do Estoque (com a ficha de cada item).
const WmsStockRedirect = () => <Redirect to="/estoque" />;

// Contagem (abertura + cíclica) — alcançada pelo botão da aba Estoque.
const WmsCountScreen = () => (
  <div className="space-y-6">
    <WmsStageTabs />
    <WmsInventoryPage />
  </div>
);

const WmsReceiveRedirect = () => <Redirect to="/wms/receber" />;
const WmsCountRedirect = () => <Redirect to="/wms/contagem" />;

// Telas por etapa (exceções e casos avançados) — fora da régua, mas vivas
// por URL. "Tratar exceção" nos cartões de Pedidos aponta para cá.
const WmsQuality = () => <WmsModuleScreen module="quality" />;
const WmsPutaway = () => <WmsModuleScreen module="putaway" />;
const WmsPicking = () => <WmsModuleScreen module="picking" />;
const WmsPacking = () => <WmsModuleScreen module="packing" />;
const WmsExpedition = () => <WmsModuleScreen module="expedition" />;
const WmsExceptions = () => <WmsModuleScreen module="exceptions" />;
const ClientRequestsRedirect = () => <Redirect to="/portal/recebimentos" />;
const ClientAgentRedirect = () => <Redirect to="/portal/agente" />;
const ClientInvoicesRedirect = () => <Redirect to="/portal/faturas" />;
// Fusões de tela (Catálogo e Faturamento): as rotas antigas redirecionam
// para a aba equivalente, preservando links salvos.
const ProductsRedirect = () => <Redirect to="/catalogo" />;
const SkusRedirect = () => <Redirect to="/catalogo/saldos" />;
const WarehouseMapRedirect = () => <Redirect to="/catalogo/mapa" />;
const PriceListRedirect = () => <Redirect to="/faturamento/tabela" />;
// A Administração virou seção da Configuração.
const legacySettingsRedirect = (path: string) => {
  const to = LEGACY_SETTINGS_REDIRECTS[path];
  return () => <Redirect to={to} />;
};

const PROTECTED_ROUTES: ProtectedRouteConfig[] = [
  protectedRoute("/dashboard", Home),
  protectedRoute("/reports", Reports),
  protectedRoute("/solicitacoes", CustomerRequests),
  protectedRoute("/wms/receber", WmsReceiveScreen),
  protectedRoute("/wms/pedidos", WmsOrdersRedirect),
  protectedRoute("/pedidos", Pedidos),
  protectedRoute("/wms/contagem", WmsCountScreen),
  protectedRoute("/wms/recebimento", WmsReceiveRedirect),
  protectedRoute("/wms/inventario", WmsCountRedirect),
  protectedRoute("/wms/qualidade", WmsQuality),
  protectedRoute("/wms/putaway", WmsPutaway),
  protectedRoute("/wms/picking", WmsPicking),
  protectedRoute("/wms/packing", WmsPacking),
  protectedRoute("/wms/expedicao", WmsExpedition),
  protectedRoute("/wms/devolucoes", WmsReturnsPage),
  protectedRoute("/wms/excecoes", WmsExceptions),
  protectedRoute("/wms", WmsStockRedirect),
  protectedRoute("/estoque", Estoque),
  protectedRoute("/catalogo", Catalog),
  protectedRoute("/catalogo/saldos", Catalog),
  protectedRoute("/catalogo/mapa", Catalog),
  protectedRoute("/warehouse", WarehouseMapRedirect),
  protectedRoute("/products", ProductsRedirect),
  protectedRoute("/skus", SkusRedirect),
  protectedRoute("/movements", Movements),
  protectedRoute("/orders", Orders),
  protectedRoute("/faturamento/fatura", BillingInvoice),
  protectedRoute("/faturamento", BillingHub),
  protectedRoute("/faturamento/tabela", BillingHub),
  protectedRoute("/tabela-precos", PriceListRedirect),
  protectedRoute("/agente", AiControl),
  protectedRoute("/agente/conhecimento", AgentKnowledge),
  protectedRoute("/suporte", legacySettingsRedirect("/suporte")),
  protectedRoute("/documentos", Documents),
  protectedRoute("/clientes", legacySettingsRedirect("/clientes")),
  protectedRoute("/usuarios", legacySettingsRedirect("/usuarios")),
  protectedRoute("/configuracoes", Settings),
  protectedRoute("/configuracoes/conta", SettingsAccount),
  protectedRoute("/configuracoes/aplicativo", SettingsApp),
  protectedRoute("/configuracoes/pessoas", Users),
  protectedRoute("/configuracoes/cliente", SettingsCustomer),
  protectedRoute("/configuracoes/sistema", SettingsSystem),
  protectedRoute("/portal", ClienteInicio),
  protectedRoute("/portal/estoque", ClienteEstoque),
  protectedRoute("/portal/recebimentos", ClienteSolicitacoes),
  protectedRoute("/portal/solicitacoes", ClientRequestsRedirect),
  protectedRoute("/portal/pedidos", ClientePedidos),
  protectedRoute("/portal/faturas/fatura", ClienteFatura),
  protectedRoute("/portal/faturas", ClienteFaturas),
  protectedRoute("/portal/documentos", ClienteDocumentos),
  protectedRoute("/portal/agente/operacional", ClientAgentRedirect),
  protectedRoute("/portal/agente", ClienteAssistente),
  // Tela antiga de faturas; /portal/faturas é a dona. Redirect preserva links salvos.
  protectedRoute("/minhas-faturas", ClientInvoicesRedirect),
];

function ProtectedRoute({
  component: Component,
  appRoles,
  profileRoles,
  layout,
  ...rest
}: any) {
  const Layout = layout === "settings" ? SettingsLayout : AppLayout;
  const { user, isLoaded } = useAppUser();

  return (
    <Route {...rest}>
      {(params) => {
        if (!isLoaded) return null;
        if (!user) return <Redirect to="/sign-in" />;
        return (
          <RoleGate appRoles={appRoles} profileRoles={profileRoles}>
            <Layout>
              <ChunkErrorBoundary>
                <Suspense
                  fallback={
                    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
                      Carregando...
                    </div>
                  }
                >
                  <Component params={params} />
                </Suspense>
              </ChunkErrorBoundary>
            </Layout>
          </RoleGate>
        );
      }}
    </Route>
  );
}

function AppRoutes() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <QueryClientCacheInvalidator />
        <RealtimeSyncBridge />
        <TooltipProvider>
          <ChunkErrorBoundary>
            <Suspense
              fallback={
                <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
                  Carregando...
                </div>
              }
            >
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/convite/*?" component={SignUpPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />

                {PROTECTED_ROUTES.map((route) => (
                  <ProtectedRoute key={route.path} {...route} />
                ))}

                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </ChunkErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
