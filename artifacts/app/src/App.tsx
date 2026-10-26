import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
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
import { AuthShell } from "@/components/auth-shell";
import PortalDesligadoPage from "@/pages/portal-desligado";
import ConvitePage from "@/pages/convite";

import { DocumentTitle } from "./components/document-title";
import AppLayout from "./components/layout/app-layout";
import ComercialLayout from "./components/layout/comercial-layout";
import OperacaoLayout from "./components/layout/operacao-layout";
import CampoLayout from "./components/layout/campo-layout";
import TvLayout from "./components/layout/tv-layout";
import FinanceiroLayout from "./components/layout/financeiro-layout";
import RhLayout from "./components/layout/rh-layout";
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
// O Agent Dute no shell de cada módulo (parte 5.5j): só com a liberação dele.
const AgenteDoComercial = lazy(() => import("./pages/agente-do-modulo").then((m) => ({ default: m.AgenteDoComercial })));
const AgenteDaOperacao = lazy(() => import("./pages/agente-do-modulo").then((m) => ({ default: m.AgenteDaOperacao })));
const AgenteDoFinanceiro = lazy(() => import("./pages/agente-do-modulo").then((m) => ({ default: m.AgenteDoFinanceiro })));
const AgentKnowledge = lazy(() => import("./pages/agent-knowledge"));
const SettingsSystem = lazy(() => import("./pages/settings-system"));
const CustomerRequests = lazy(() => import("./pages/customer-requests"));
const WarehouseOps = lazy(() => import("./pages/warehouse-ops"));
const Receber = lazy(() => import("./pages/receber"));
const WmsInventoryPage = lazy(() => import("./pages/wms-inventory"));
const WarehousePositionsPage = lazy(() => import("./pages/warehouse-positions"));
const WarehouseLabelsPage = lazy(() => import("./pages/warehouse-labels"));
const EstoqueAlertas = lazy(() => import("./pages/estoque-alertas"));
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
const ClienteComprovante = lazy(() =>
  import("./pages/client").then((m) => ({ default: m.ClienteComprovante })),
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
const FinanceiroEmissoes = lazy(() => import("./pages/financeiro/emissoes"));
const FinanceiroRelatorios = lazy(() => import("./pages/financeiro/relatorios"));
const RhInicio = lazy(() => import("./pages/rh/inicio"));
const RhPessoas = lazy(() => import("./pages/rh/pessoas"));
const RhFicha = lazy(() => import("./pages/rh/ficha"));
const RhExportacao = lazy(() => import("./pages/rh/exportacao"));
const FinanceiroContratos = lazy(() => import("./pages/financeiro/contratos"));
const FinanceiroAutorizacoes = lazy(() => import("./pages/financeiro/autorizacoes"));
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
const OperacaoRelatorios = lazy(() => import("./pages/operacao/relatorios"));
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
import { MEMORIA_LIBERADA, PLATAFORMA_LIBERADA } from "./lib/liberacao";
import { soComComercialLiberado } from "./lib/comercial/navegacao";
import { soComOperacaoLiberada } from "./lib/operacao/navegacao";
import { soComFinanceiroLiberado } from "./lib/financeiro/navegacao";
import { soComRhLiberado } from "./lib/rh/navegacao";
import { entrada } from "./lib/platform-modules";
import { portalModulesFor } from "./lib/operations";
import { firebaseAuth, firebaseConfigError } from "./lib/firebase";
import {
  canAccessModule,
  getHomePathForAppRole,
  getHomePathForProfile,
  getRouteAppRoles,
  getRouteProfileRoles,
  inicioDoPortal,
  portalModuleForPath,
  type CurrentAppRole as AppRole,
  type ProfileRole,
} from "./lib/modules";
import { queryClient } from "./lib/queryClient";
import { RealtimeSyncBridge } from "./lib/realtime-sync";
import { MENSAGEM_DA_RECUPERACAO, problemaDaRecuperacao } from "./lib/recuperar-senha";
import { layoutDaRota, type LayoutDaRota } from "./lib/ambientes";
import { LEGACY_SETTINGS_REDIRECTS } from "./lib/settings-nav";

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
  if (role === "cliente") {
    // Espera a primeira leitura do perfil para não abrir a tela e tirar em
    // seguida.
    if (operation.isLoading) return null;
    // O cliente arquivado ou "Sem portal" (pergunta 69): a pessoa vê só a
    // tela do portal desligado, com Sair.
    if (operation.profile?.portalDesligado) return <PortalDesligadoPage />;
    // Uma tela que o modelo de operação do cliente não tem (Eventos no
    // Mobiliário) volta ao começo do portal, mesmo por link direto: o Início,
    // ou Minhas OS para o contrato sem a armazenagem.
    const allowed = portalModulesFor(operation.profile);
    const portalModule = path ? portalModuleForPath(path) : null;
    if (allowed && portalModule && !allowed.includes(portalModule)) {
      return <Redirect to={inicioDoPortal(operation.profile)} />;
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
  rh: RhLayout,
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
  // O alerta do item parado (parte 5.4e) só existe onde a memória roda: fora
  // dela a tela diria "Nenhum alerta" sem a rotina que propõe os alertas.
  ...(MEMORIA_LIBERADA ? [protectedRoute("/estoque/alertas", EstoqueAlertas)] : []),
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
  // O comprovante da OS concluída (parte 4.3d).
  protectedRoute("/portal/servicos/comprovante", ClienteComprovante),
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
    protectedRoute("/operacao/relatorios", OperacaoRelatorios),
    protectedRoute("/operacao/colaboradores", OperacaoColaboradores),
    protectedRoute("/operacao/veiculos", OperacaoVeiculos),
    // O app do campo é da Operação (parte 3.8b).
    protectedRoute("/campo", CampoHoje),
    protectedRoute("/campo/os", CampoOs),
    protectedRoute("/campo/concluir", CampoConcluir),
    // A TV da sala é da Operação (parte 3.12b).
    protectedRoute("/tv", TvDaSala),
    // O Agent Dute da Operação (parte 5.5j), só com a liberação dele.
    protectedRoute("/operacao/agente", AgenteDaOperacao),
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
    protectedRoute("/comercial/agente", AgenteDoComercial),
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
    protectedRoute("/financeiro/contratos", FinanceiroContratos),
    protectedRoute("/financeiro/autorizacoes", FinanceiroAutorizacoes),
    protectedRoute("/financeiro/relatorios", FinanceiroRelatorios),
    protectedRoute("/financeiro/emissoes", FinanceiroEmissoes),
    protectedRoute("/financeiro/agente", AgenteDoFinanceiro),
  ]),
  // RH (docs/plataforma/fase-8-rh.md): as rotas só existem onde a liberação
  // do RH está ligada, depois da parte 8.1b (lib/rh/navegacao.ts).
  ...soComRhLiberado([
    protectedRoute("/rh", RhInicio),
    protectedRoute("/rh/pessoas", RhPessoas),
    protectedRoute("/rh/ficha", RhFicha),
    protectedRoute("/rh/exportacao", RhExportacao),
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
                  <Route path="/convite/*?" component={ConvitePage} />
                  <Route path="/sign-up/*?" component={ConvitePage} />

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
