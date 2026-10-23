import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { functionsDoApp } from "@/lib/firebase-functions";
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
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { DocumentTitle } from "./components/document-title";
import AppLayout from "./components/layout/app-layout";
import ComercialLayout from "./components/layout/comercial-layout";
import OperacaoLayout from "./components/layout/operacao-layout";
import CampoLayout from "./components/layout/campo-layout";
import TvLayout from "./components/layout/tv-layout";
import FinanceiroLayout from "./components/layout/financeiro-layout";
import { AppThemeProvider } from "./components/theme/theme-provider";
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
const EntradaPage = lazy(() => import("./pages/entrada"));
const Catalog = lazy(() => import("./pages/catalog"));
const Movements = lazy(() => import("./pages/movements"));
const Orders = lazy(() => import("./pages/orders"));
const Reports = lazy(() => import("./pages/reports"));
const BillingHub = lazy(() => import("./pages/billing-hub"));
const BillingInvoice = lazy(() => import("./pages/billing-invoice"));
const Users = lazy(() => import("./pages/users"));
const SettingsCustomers = lazy(() => import("./pages/settings-customers"));
const Documents = lazy(() => import("./pages/documents"));
const Settings = lazy(() => import("./pages/settings"));
const SettingsAccount = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsAccount })),
);
const SettingsApp = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsApp })),
);
const AiControl = lazy(() => import("./pages/ai-control"));
const AgentePage = lazy(() => import("./pages/agente"));
const AgentKnowledge = lazy(() => import("./pages/agent-knowledge"));
const SettingsSystem = lazy(() => import("./pages/settings-system"));
const CustomerRequests = lazy(() => import("./pages/customer-requests"));
const WarehouseOps = lazy(() => import("./pages/warehouse-ops"));
const Receber = lazy(() => import("./pages/receber"));
const WmsInventoryPage = lazy(() => import("./pages/wms-inventory"));
const WarehousePositionsPage = lazy(() => import("./pages/warehouse-positions"));
const WarehouseLabelsPage = lazy(() => import("./pages/warehouse-labels"));
const WarehouseMapPage = lazy(() => import("./pages/warehouse-map"));
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
const ClienteEventos = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteEventos })),
);
const ClienteServicos = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteServicos })),
);
const ClienteFaturas = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteFaturas })),
);
const ClienteFatura = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteFatura })),
);
const ClienteRelatorio = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteRelatorio })),
);
const ClienteInicio = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteInicio })),
);
const ClientePedidos = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClientePedidos })),
);
const ClienteEnvios = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteEnvios })),
);
const ComercialClientes = lazy(() => import("./pages/comercial/clientes"));
const ComercialInicio = lazy(() => import("./pages/comercial/inicio"));
const FinanceiroInicio = lazy(() => import("./pages/financeiro/inicio"));
const FinanceiroAFaturar = lazy(() => import("./pages/financeiro/a-faturar"));
const FinanceiroAReceber = lazy(() => import("./pages/financeiro/faturas").then((tela) => ({ default: tela.FinanceiroAReceber })));
const FinanceiroVencidos = lazy(() => import("./pages/financeiro/faturas").then((tela) => ({ default: tela.FinanceiroVencidos })));
const FinanceiroPagos = lazy(() => import("./pages/financeiro/faturas").then((tela) => ({ default: tela.FinanceiroPagos })));
const FinanceiroFaturas = lazy(() => import("./pages/financeiro/faturas").then((tela) => ({ default: tela.FinanceiroFaturas })));
const FinanceiroNf = lazy(() => import("./pages/financeiro/nf"));
const ComercialOrcamentos = lazy(() => import("./pages/comercial/orcamentos"));
const ComercialOrcamento = lazy(() => import("./pages/comercial/orcamento"));
const ComercialDocumento = lazy(() => import("./pages/comercial/documento"));
const ComercialAprovar = lazy(() => import("./pages/comercial/aprovar"));
const ComercialContratos = lazy(() => import("./pages/comercial/contratos"));
const ComercialAutorizacoes = lazy(() => import("./pages/comercial/autorizacoes"));
const ComercialMedicoes = lazy(() => import("./pages/comercial/medicoes"));
const OperacaoInicio = lazy(() => import("./pages/operacao/inicio"));
const OperacaoHoje = lazy(() => import("./pages/operacao/hoje"));
const OperacaoAgenda = lazy(() => import("./pages/operacao/agenda"));
const OperacaoDemandas = lazy(() => import("./pages/operacao/demandas"));
const OperacaoDemanda = lazy(() => import("./pages/operacao/demanda"));
const OperacaoDemandaNova = lazy(() => import("./pages/operacao/demanda-nova"));
const OperacaoPlanejar = lazy(() => import("./pages/operacao/planejar"));
const OperacaoOs = lazy(() => import("./pages/operacao/os"));
const OperacaoOsImpressao = lazy(() => import("./pages/operacao/os-impressao"));
const OperacaoRevisao = lazy(() => import("./pages/operacao/revisao"));
const CampoHoje = lazy(() => import("./pages/campo/hoje"));
const CampoOs = lazy(() => import("./pages/campo/os"));
const CampoConcluir = lazy(() => import("./pages/campo/concluir"));
const TvDaSala = lazy(() => import("./pages/tv/tv"));
const OperacaoColaboradores = lazy(() => import("./pages/operacao/colaboradores"));
const OperacaoVeiculos = lazy(() => import("./pages/operacao/veiculos"));
import { useRole } from "./hooks/use-role";
import { AuthProvider, useAppUser } from "./lib/auth";
import { ActiveCustomerProvider } from "./lib/active-customer-context";
import { useOperationProfile } from "./lib/operation-profile";
import { PLATAFORMA_LIBERADA } from "./lib/liberacao";
import { soComComercialLiberado } from "./lib/comercial/navegacao";
import { soComOperacaoLiberada } from "./lib/operacao/navegacao";
import { soComFinanceiroLiberado } from "./lib/financeiro/navegacao";
import { entrada } from "./lib/platform-modules";
import { portalModulesFor } from "./lib/operations";
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
  portalModuleForPath,
  type CurrentAppRole as AppRole,
  type ProfileRole,
} from "./lib/modules";
import { queryClient } from "./lib/queryClient";
import { RealtimeSyncBridge } from "./lib/realtime-sync";
import { layoutDaRota, type LayoutDaRota } from "./lib/ambientes";
import { LEGACY_SETTINGS_REDIRECTS } from "./lib/settings-nav";
import { INTERNAL_CUSTOMER_CODE, LEGACY_CUSTOMER_CODE } from "./lib/active-customer";

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

// Como o papel aparece na frase do convite ("ativou acesso como ...").
const INVITE_ROLE_LABEL: Record<ProfileRole, string> = {
  owner: "owner Dutelog",
  admin: "admin Dutelog",
  interno: "interno Dutelog",
  wms: "operação WMS",
  campo: "campo",
  comercial: "comercial",
  financeiro: "financeiro",
  rh: "RH",
  suporte: "suporte",
  painel: "painel",
  cliente: "cliente",
};

function roleLabel(role: ProfileRole) {
  return INVITE_ROLE_LABEL[role];
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
        functionsDoApp(firebaseApp),
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
      <div className="mt-5 flex items-center justify-between border-t border-[var(--auth-line)] pt-4 text-sm">
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
        data.customer_code ?? (role === "cliente" ? LEGACY_CUSTOMER_CODE : INTERNAL_CUSTOMER_CODE);
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
              ? LEGACY_CUSTOMER_CODE
              : INTERNAL_CUSTOMER_CODE),
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
        <div className="soft-panel rounded-md px-4 py-3 text-sm text-muted-foreground">
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

/**
 * Tela de entrada por módulo (docs/plataforma/fase-2-nucleo.md, parte 2): um
 * módulo vai direto para a casa dele; dois ou mais mostram os cards. O
 * cliente espera o perfil (módulos contratados) para não abrir o portal e
 * tirar em seguida.
 */
function EntradaPorModulo() {
  const { user } = useAppUser();
  const operation = useOperationProfile();
  const role = user?.publicMetadata.role;
  if (role === "cliente" && operation.isLoading) return null;
  const decision = entrada(role, operation.profile);
  if (decision.kind === "redirect") return <Redirect to={decision.to} />;
  return (
    <ChunkErrorBoundary>
      <EntradaPage decision={decision} />
    </ChunkErrorBoundary>
  );
}

function HomeRedirect() {
  const { user, isLoaded } = useAppUser();
  if (!isLoaded) return null;
  if (!user) return <SignInPage />;
  // Fora da liberação (produção), a aterrissagem por papel de sempre.
  return PLATAFORMA_LIBERADA ? <EntradaPorModulo /> : <RoleHome />;
}

function RoleGate({
  appRoles,
  profileRoles,
  path,
  children,
}: {
  appRoles: AppRole[];
  profileRoles: ProfileRole[];
  path?: string;
  children: React.ReactNode;
}) {
  const { role, isLoaded } = useRole();
  const { user } = useAppUser();
  const operation = useOperationProfile();
  if (!isLoaded) return null;
  if (!role || !appRoles.includes(role)) return <Redirect to="/" />;
  if (!canAccessModule(user?.publicMetadata.role, profileRoles)) {
    return <Redirect to="/" />;
  }
  // Portal: uma tela que o modelo de operação do cliente não tem (Eventos no
  // Mobiliário) volta ao Início, mesmo por link direto. Espera a primeira
  // leitura do perfil para não abrir a tela e tirar em seguida.
  if (role === "cliente" && path) {
    if (operation.isLoading) return null;
    const allowed = portalModulesFor(operation.profile);
    const portalModule = portalModuleForPath(path);
    if (allowed && portalModule && !allowed.includes(portalModule)) {
      return <Redirect to="/portal" />;
    }
  }
  return <>{children}</>;
}

type ProtectedRouteConfig = {
  path: string;
  component: React.ComponentType<any>;
  appRoles: AppRole[];
  profileRoles: ProfileRole[];
  layout: LayoutDaRota;
};

/** "app" é o shell do WMS. Configuração e cada módulo novo têm o deles. */
const LAYOUT_DA_ROTA = {
  app: AppLayout,
  settings: SettingsLayout,
  comercial: ComercialLayout,
  operacao: OperacaoLayout,
  campo: CampoLayout,
  tv: TvLayout,
  financeiro: FinanceiroLayout,
} as const;

function protectedRoute(
  path: string,
  component: React.ComponentType<any>,
): ProtectedRouteConfig {
  return {
    path,
    component,
    appRoles: getRouteAppRoles(path),
    profileRoles: getRouteProfileRoles(path),
    layout: layoutDaRota(path),
  };
}

function WmsModuleScreen({ module }: { module: WarehouseOpsModuleKey }) {
  // Remonta quando o módulo muda: o estado da bancada não vaza entre filas.
  return <WarehouseOps key={module} initialModule={module} />;
}

// A fila de pedidos saiu da bancada: é o item "Pedidos" do menu.
const WmsOrdersRedirect = () => <Redirect to="/pedidos" />;
// Saldos virou a lista de Itens do Estoque (com a ficha de cada item).
const WmsStockRedirect = () => <Redirect to="/estoque" />;
// Guarda (putaway) é o grupo "Para guardar" do Receber.
const WmsPutawayRedirect = () => <Redirect to="/wms/receber" />;

const WmsReceiveRedirect = () => <Redirect to="/wms/receber" />;
const WmsCountRedirect = () => <Redirect to="/wms/contagem" />;

// Qualidade (falta, avaria, retenção) continua viva por URL, fora da régua.
// As etapas antigas (putaway, picking, packing, expedição, exceções) viraram
// redirects: a guarda vive no Receber e o pedido inteiro em Pedidos, onde
// "Tratar" abre a tarefa bloqueada.
const WmsQuality = () => <WmsModuleScreen module="quality" />;
const ClientRequestsRedirect = () => <Redirect to="/portal/recebimentos" />;
const ClientAgentRedirect = () => <Redirect to="/portal/agente" />;
const ClientInvoicesRedirect = () => <Redirect to="/portal/faturas" />;
// Fusões de tela (Catálogo e Faturamento): as rotas antigas redirecionam
// para a aba equivalente, preservando links salvos.
const ProductsRedirect = () => <Redirect to="/catalogo" />;
const SkusRedirect = () => <Redirect to="/catalogo/saldos" />;
// O mapa do armazém mudou para Estoque › Mapa (16/10/2026); os endereços antigos seguem para lá.
const WarehouseMapRedirect = () => <Redirect to="/estoque/mapa" />;
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
  protectedRoute("/wms/receber", Receber),
  protectedRoute("/wms/pedidos", WmsOrdersRedirect),
  protectedRoute("/pedidos", Pedidos),
  protectedRoute("/wms/contagem", WmsInventoryPage),
  protectedRoute("/wms/recebimento", WmsReceiveRedirect),
  protectedRoute("/wms/inventario", WmsCountRedirect),
  protectedRoute("/wms/qualidade", WmsQuality),
  protectedRoute("/wms/putaway", WmsPutawayRedirect),
  protectedRoute("/wms/picking", WmsOrdersRedirect),
  protectedRoute("/wms/packing", WmsOrdersRedirect),
  protectedRoute("/wms/expedicao", WmsOrdersRedirect),
  protectedRoute("/wms/devolucoes", WmsReturnsPage),
  protectedRoute("/wms/excecoes", WmsOrdersRedirect),
  protectedRoute("/wms", WmsStockRedirect),
  protectedRoute("/estoque/posicoes", WarehousePositionsPage),
  protectedRoute("/estoque/etiquetas", WarehouseLabelsPage),
  protectedRoute("/estoque/mapa", WarehouseMapPage),
  protectedRoute("/estoque", Estoque),
  protectedRoute("/catalogo", Catalog),
  protectedRoute("/catalogo/saldos", Catalog),
  protectedRoute("/catalogo/mapa", WarehouseMapRedirect),
  protectedRoute("/warehouse", WarehouseMapRedirect),
  protectedRoute("/products", ProductsRedirect),
  protectedRoute("/skus", SkusRedirect),
  protectedRoute("/movements", Movements),
  protectedRoute("/orders", Orders),
  protectedRoute("/faturamento/fatura", BillingInvoice),
  protectedRoute("/faturamento", BillingHub),
  protectedRoute("/faturamento/tabela", BillingHub),
  protectedRoute("/tabela-precos", PriceListRedirect),
  protectedRoute("/agente", AgentePage),
  protectedRoute("/agente/painel", AiControl),
  protectedRoute("/agente/conhecimento", AgentKnowledge),
  protectedRoute("/suporte", legacySettingsRedirect("/suporte")),
  protectedRoute("/documentos", Documents),
  protectedRoute("/clientes", legacySettingsRedirect("/clientes")),
  protectedRoute("/usuarios", legacySettingsRedirect("/usuarios")),
  protectedRoute("/configuracoes", Settings),
  protectedRoute("/configuracoes/conta", SettingsAccount),
  protectedRoute("/configuracoes/aplicativo", SettingsApp),
  protectedRoute("/configuracoes/pessoas", Users),
  protectedRoute("/configuracoes/clientes", SettingsCustomers),
  protectedRoute("/configuracoes/cliente", legacySettingsRedirect("/configuracoes/cliente")),
  protectedRoute("/configuracoes/sistema", SettingsSystem),
  protectedRoute("/portal", ClienteInicio),
  protectedRoute("/portal/estoque", ClienteEstoque),
  protectedRoute("/portal/eventos", ClienteEventos),
  protectedRoute("/portal/recebimentos", ClienteEnvios),
  protectedRoute("/portal/solicitacoes", ClientRequestsRedirect),
  protectedRoute("/portal/pedidos", ClientePedidos),
  protectedRoute("/portal/faturas/fatura", ClienteFatura),
  protectedRoute("/portal/faturas/relatorio", ClienteRelatorio),
  // As OS do cliente (parte 4.3b): a barreira por módulo do portal pede a Operação no contrato.
  protectedRoute("/portal/servicos", ClienteServicos),
  protectedRoute("/portal/faturas", ClienteFaturas),
  protectedRoute("/portal/documentos", ClienteDocumentos),
  protectedRoute("/portal/agente/operacional", ClientAgentRedirect),
  protectedRoute("/portal/agente", ClienteAssistente),
  // Tela antiga de faturas; /portal/faturas é a dona. Redirect preserva links salvos.
  protectedRoute("/minhas-faturas", ClientInvoicesRedirect),
  // Comercial (docs/plataforma/fase-6-comercial.md): as rotas só existem onde
  // a liberação do Comercial está ligada (lib/comercial/navegacao.ts). Toda
  // rota do Comercial entra neste bloco (comercial/navegacao.test.ts).
  ...soComOperacaoLiberada([
    protectedRoute("/operacao", OperacaoInicio),
    protectedRoute("/operacao/hoje", OperacaoHoje),
    protectedRoute("/operacao/agenda", OperacaoAgenda),
    protectedRoute("/operacao/demandas", OperacaoDemandas),
    protectedRoute("/operacao/demanda", OperacaoDemanda),
    protectedRoute("/operacao/nova-demanda", OperacaoDemandaNova),
    protectedRoute("/operacao/planejar", OperacaoPlanejar),
    protectedRoute("/operacao/os", OperacaoOs),
    protectedRoute("/operacao/os/impressao", OperacaoOsImpressao),
    protectedRoute("/operacao/revisao", OperacaoRevisao),
    protectedRoute("/operacao/colaboradores", OperacaoColaboradores),
    protectedRoute("/operacao/veiculos", OperacaoVeiculos),
    // O app do campo é da Operação (parte 3.8b).
    protectedRoute("/campo", CampoHoje),
    protectedRoute("/campo/os", CampoOs),
    protectedRoute("/campo/concluir", CampoConcluir),
    // A TV da sala é da Operação (parte 3.12b).
    protectedRoute("/tv", TvDaSala),
  ]),
  ...soComComercialLiberado([
    protectedRoute("/comercial", ComercialInicio),
    protectedRoute("/comercial/orcamentos", ComercialOrcamentos),
    protectedRoute("/comercial/orcamento", ComercialOrcamento),
    protectedRoute("/comercial/orcamento/documento", ComercialDocumento),
    protectedRoute("/comercial/aprovar", ComercialAprovar),
    protectedRoute("/comercial/clientes", ComercialClientes),
    protectedRoute("/comercial/contratos", ComercialContratos),
    protectedRoute("/comercial/autorizacoes", ComercialAutorizacoes),
    protectedRoute("/comercial/medicoes", ComercialMedicoes),
  ]),
  // Financeiro da demanda (docs/plataforma/fase-4-financeiro.md): as rotas só
  // existem onde a liberação do Financeiro está ligada (lib/financeiro/navegacao.ts).
  ...soComFinanceiroLiberado([
    protectedRoute("/financeiro", FinanceiroInicio),
    protectedRoute("/financeiro/a-faturar", FinanceiroAFaturar),
    protectedRoute("/financeiro/a-receber", FinanceiroAReceber),
    protectedRoute("/financeiro/vencidos", FinanceiroVencidos),
    protectedRoute("/financeiro/pagos", FinanceiroPagos),
    protectedRoute("/financeiro/faturas", FinanceiroFaturas),
    protectedRoute("/financeiro/nf", FinanceiroNf),
  ]),
];

function ProtectedRoute({
  component: Component,
  appRoles,
  profileRoles,
  layout,
  ...rest
}: any) {
  const Layout = LAYOUT_DA_ROTA[layout as LayoutDaRota] ?? AppLayout;
  const { user, isLoaded } = useAppUser();

  return (
    <Route {...rest}>
      {(params) => {
        if (!isLoaded) return null;
        if (!user) return <Redirect to="/sign-in" />;
        return (
          <RoleGate appRoles={appRoles} profileRoles={profileRoles} path={rest.path}>
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
      <AppThemeProvider>
        <QueryClientProvider client={queryClient}>
          <QueryClientCacheInvalidator />
          <RealtimeSyncBridge />
          {/* Cliente ativo da área interna (lib/active-customer.ts). */}
          <ActiveCustomerProvider>
          <TooltipProvider>
            <ChunkErrorBoundary>
              <DocumentTitle />
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
          </ActiveCustomerProvider>
        </QueryClientProvider>
      </AppThemeProvider>
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
