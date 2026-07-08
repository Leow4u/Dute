import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  Tags,
  ArrowRightLeft,
  ShoppingCart,
  Map as MapIcon,
  FileText,
  Receipt,
  ListChecks,
  Users as UsersIcon,
  LogOut,
  User as UserIcon,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/use-role";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppAuth, useAppUser } from "@/lib/auth";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavSection = { title: string; items: NavItem[] };

const INTERNO_SECTIONS: NavSection[] = [
  {
    title: "Operações",
    items: [
      { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
      { href: "/products", label: "Catálogo", icon: Package },
      { href: "/skus", label: "Estoque de SKUs", icon: Tags },
      { href: "/movements", label: "Movimentações", icon: ArrowRightLeft },
      { href: "/orders", label: "Pedidos", icon: ShoppingCart },
      { href: "/warehouse", label: "Mapa do Armazém", icon: MapIcon },
      { href: "/reports", label: "Relatórios", icon: FileText },
    ],
  },
  {
    title: "Cobrança",
    items: [
      { href: "/faturamento", label: "Faturamento", icon: Receipt },
      { href: "/tabela-precos", label: "Tabela de Preços", icon: ListChecks },
      { href: "/usuarios", label: "Usuários", icon: UsersIcon },
    ],
  },
];

const CLIENTE_SECTIONS: NavSection[] = [
  {
    title: "Cobrança",
    items: [
      { href: "/minhas-faturas", label: "Minhas Faturas", icon: Receipt },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { role } = useRole();
  const { signOut } = useAppAuth();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const sections = role === "cliente" ? CLIENTE_SECTIONS : INTERNO_SECTIONS;

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground font-sans">
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col hidden md:flex">
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border bg-sidebar gap-3">
          <img
            src={`${basePath}/logo.svg`}
            alt="BTG"
            className="h-6 brightness-0 invert"
          />
          <span className="font-bold text-sidebar-foreground tracking-tight text-sm uppercase">
            Estoque
          </span>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title} className="mb-2">
              <div className="px-2 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                {section.title}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = location.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md hover:bg-sidebar-accent transition-colors outline-none text-sidebar-foreground/80 hover:text-sidebar-foreground">
              <div className="h-8 w-8 rounded-full bg-sidebar-accent border border-sidebar-border flex items-center justify-center overflow-hidden">
                {user?.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 text-left truncate">
                <div className="text-sm font-semibold truncate">
                  {user?.fullName || "Usuário"}
                </div>
                <div className="text-xs text-sidebar-foreground/50 truncate">
                  {user?.primaryEmailAddress?.emailAddress}
                </div>
              </div>
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ redirectUrl: basePath || "/" })}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <header className="h-14 border-b border-border bg-card flex items-center px-6 shrink-0 z-10 sticky top-0 md:hidden">
          <img src={`${basePath}/logo.svg`} alt="BTG" className="h-6 mr-3" />
          <span className="font-bold text-primary tracking-tight text-sm uppercase">
            Estoque
          </span>
        </header>
        <div className="flex-1 overflow-auto bg-gray-50/50">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
