import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import {
  Switch,
  Route,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

import AppLayout from "./components/layout/app-layout";
import Dashboard from "./pages/dashboard";
import Products from "./pages/products";
import Skus from "./pages/skus";
import Movements from "./pages/movements";
import Orders from "./pages/orders";
import Warehouse from "./pages/warehouse";
import Reports from "./pages/reports";
import Billing from "./pages/billing";
import PriceList from "./pages/price-list";
import Users from "./pages/users";
import MyInvoices from "./pages/my-invoices";
import NotFound from "./pages/not-found";
import { useRole } from "./hooks/use-role";
import { isDemoMode } from "./lib/demo-mode";
import {
  AuthProvider,
  useAppUser,
} from "./lib/auth";
import { firebaseAuth, firebaseConfigError, firestore } from "./lib/firebase";
import { queryClient } from "./lib/queryClient";

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
        role: "interno" | "cliente";
      };
    };

const initialAuthState: AuthFormState = {
  nome: "",
  email: "",
  senha: "",
  error: null,
  loading: false,
};

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const logoPath = `${basePath}/dutelog-logo.png`;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-[420px] rounded-md border border-gray-200 bg-white p-6 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img
            src={logoPath}
            alt="Dutelog Soluções Logísticas"
            className="h-12 w-auto max-w-[260px] object-contain"
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              {title}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
        {firebaseConfigError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{firebaseConfigError}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded, accessDenied } = useAppUser();
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
          error instanceof Error
            ? error.message
            : "Não foi possível entrar.",
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
    <AuthShell
      title="Bem-vindo de volta"
      subtitle="Entre para acessar o estoque BTG"
    >
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
              Seu e-mail ainda não tem convite ativo para acessar o sistema.
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
      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          onClick={resetPassword}
        >
          Esqueci minha senha
        </button>
        <span className="text-muted-foreground">Acesso apenas por convite</span>
      </div>
    </AuthShell>
  );
}

function SignUpPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useAppUser();
  const [form, setForm] = useState<AuthFormState>(initialAuthState);
  const [invite, setInvite] = useState<InviteState>({ status: "loading" });

  if (isLoaded && user) return <Redirect to="/" />;

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      const token = new URLSearchParams(window.location.search).get("invite");
      if (!token) {
        if (active) setInvite({ status: "missing" });
        return;
      }

      if (!firestore) {
        if (active) setInvite({ status: "invalid" });
        return;
      }

      const snapshot = await getDoc(doc(firestore, "invites", token));
      if (!snapshot.exists()) {
        if (active) setInvite({ status: "invalid" });
        return;
      }

      const data = snapshot.data() as DocumentData;
      if (data.status !== "pending") {
        if (active) setInvite({ status: "used" });
        return;
      }

      const role = data.role === "interno" ? "interno" : "cliente";
      const email = String(data.email ?? "").trim().toLowerCase();
      if (!email) {
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
      <AuthShell title="Convite necessário" subtitle="Acesso controlado pela Dute">
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
        <div className="rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-muted-foreground">
          Perfil do convite:{" "}
          <span className="font-medium text-foreground">
            {invite.data.role === "interno" ? "Interno Dutelog" : "Cliente"}
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
  if (!isLoaded) return null;
  return (
    <Redirect to={role === "cliente" ? "/minhas-faturas" : "/dashboard"} />
  );
}

function HomeRedirect() {
  const { user, isLoaded } = useAppUser();
  if (!isLoaded) return null;
  if (!user) return <Redirect to="/sign-in" />;
  return <RoleHome />;
}

function RoleGate({
  requireRole,
  children,
}: {
  requireRole?: "interno" | "cliente";
  children: React.ReactNode;
}) {
  const { role, isLoaded } = useRole();
  if (!isLoaded) return null;
  if (requireRole && role !== requireRole) return <Redirect to="/" />;
  return <>{children}</>;
}

function ProtectedRoute({ component: Component, requireRole, ...rest }: any) {
  const { user, isLoaded } = useAppUser();

  return (
    <Route {...rest}>
      {(params) => {
        if (!isLoaded) return null;
        if (!user) return <Redirect to="/sign-in" />;
        return (
          <RoleGate requireRole={requireRole}>
            <AppLayout>
              <Component params={params} />
            </AppLayout>
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
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <ProtectedRoute
              path="/dashboard"
              component={Dashboard}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/products"
              component={Products}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/skus"
              component={Skus}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/movements"
              component={Movements}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/orders"
              component={Orders}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/warehouse"
              component={Warehouse}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/reports"
              component={Reports}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/faturamento"
              component={Billing}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/tabela-precos"
              component={PriceList}
              requireRole="interno"
            />
            <ProtectedRoute
              path="/usuarios"
              component={Users}
              requireRole="interno"
            />

            <ProtectedRoute path="/minhas-faturas" component={MyInvoices} />

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

function DemoRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/">
            <Redirect to="/dashboard" />
          </Route>
          <Route path="/dashboard">
            <AppLayout>
              <Dashboard />
            </AppLayout>
          </Route>
          <Route path="/products">
            <AppLayout>
              <Products />
            </AppLayout>
          </Route>
          <Route path="/skus">
            <AppLayout>
              <Skus />
            </AppLayout>
          </Route>
          <Route path="/movements">
            <AppLayout>
              <Movements />
            </AppLayout>
          </Route>
          <Route path="/orders">
            <AppLayout>
              <Orders />
            </AppLayout>
          </Route>
          <Route path="/warehouse">
            <AppLayout>
              <Warehouse />
            </AppLayout>
          </Route>
          <Route path="/reports">
            <AppLayout>
              <Reports />
            </AppLayout>
          </Route>
          <Route path="/faturamento">
            <AppLayout>
              <Billing />
            </AppLayout>
          </Route>
          <Route path="/tabela-precos">
            <AppLayout>
              <PriceList />
            </AppLayout>
          </Route>
          <Route path="/usuarios">
            <AppLayout>
              <Users />
            </AppLayout>
          </Route>
          <Route path="/minhas-faturas">
            <AppLayout>
              <MyInvoices />
            </AppLayout>
          </Route>
          <Route component={NotFound} />
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      {isDemoMode ? <DemoRoutes /> : <AppRoutes />}
    </WouterRouter>
  );
}

export default App;
