import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ptBR } from '@clerk/localizations';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import AppLayout from './components/layout/app-layout';
import Dashboard from './pages/dashboard';
import Products from './pages/products';
import Skus from './pages/skus';
import Movements from './pages/movements';
import Orders from './pages/orders';
import Warehouse from './pages/warehouse';
import Reports from './pages/reports';
import Billing from './pages/billing';
import PriceList from './pages/price-list';
import Users from './pages/users';
import MyInvoices from './pages/my-invoices';
import NotFound from './pages/not-found';
import { useRole } from './hooks/use-role';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(212, 98%, 18%)",
    colorForeground: "hsl(222, 47%, 11%)",
    colorMutedForeground: "hsl(215, 16%, 47%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(0, 0%, 100%)",
    colorInputForeground: "hsl(222, 47%, 11%)",
    colorNeutral: "hsl(214, 32%, 91%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-md shadow-lg border border-gray-200 w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-xl font-bold text-gray-900 tracking-tight",
    headerSubtitle: "text-sm text-gray-500",
    socialButtonsBlockButtonText: "font-medium",
    formFieldLabel: "text-sm font-medium text-gray-700",
    footerActionLink: "font-semibold text-primary hover:text-primary/90",
    footerActionText: "text-sm text-gray-500",
    dividerText: "text-xs text-gray-400 font-medium",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-success text-sm",
    alertText: "text-sm",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClientInstance = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClientInstance.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClientInstance]);

  return null;
}

function RoleHome() {
  const { role, isLoaded } = useRole();
  if (!isLoaded) return null;
  return <Redirect to={role === "cliente" ? "/minhas-faturas" : "/dashboard"} />;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <RoleHome />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function RoleGate({ requireRole, children }: { requireRole?: "interno" | "cliente"; children: React.ReactNode }) {
  const { role, isLoaded } = useRole();
  if (!isLoaded) return null;
  if (requireRole && role !== requireRole) return <Redirect to="/" />;
  return <>{children}</>;
}

function ProtectedRoute({ component: Component, requireRole, ...rest }: any) {
  return (
    <Route {...rest}>
      {(params) => (
        <>
          <Show when="signed-in">
            <RoleGate requireRole={requireRole}>
              <AppLayout>
                <Component params={params} />
              </AppLayout>
            </RoleGate>
          </Show>
          <Show when="signed-out">
            <Redirect to="/sign-in" />
          </Show>
        </>
      )}
    </Route>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        ...ptBR,
        signIn: {
          ...ptBR.signIn,
          start: {
            ...ptBR.signIn?.start,
            title: "Bem-vindo de volta",
            subtitle: "Entre para acessar sua conta",
          },
        },
        signUp: {
          ...ptBR.signUp,
          start: {
            ...ptBR.signUp?.start,
            title: "Crie sua conta",
            subtitle: "Comece agora mesmo",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <ProtectedRoute path="/dashboard" component={Dashboard} requireRole="interno" />
            <ProtectedRoute path="/products" component={Products} requireRole="interno" />
            <ProtectedRoute path="/skus" component={Skus} requireRole="interno" />
            <ProtectedRoute path="/movements" component={Movements} requireRole="interno" />
            <ProtectedRoute path="/orders" component={Orders} requireRole="interno" />
            <ProtectedRoute path="/warehouse" component={Warehouse} requireRole="interno" />
            <ProtectedRoute path="/reports" component={Reports} requireRole="interno" />
            <ProtectedRoute path="/faturamento" component={Billing} requireRole="interno" />
            <ProtectedRoute path="/tabela-precos" component={PriceList} requireRole="interno" />
            <ProtectedRoute path="/usuarios" component={Users} requireRole="interno" />

            <ProtectedRoute path="/minhas-faturas" component={MyInvoices} />

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
