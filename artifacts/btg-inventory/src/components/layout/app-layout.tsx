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
    <div className="app-atmosphere flex min-h-[100dvh] w-full text-foreground font-sans">
      <aside className="hidden w-72 flex-shrink-0 border-r border-sidebar-border bg-sidebar/80 backdrop-blur-[40px] md:flex flex-col">
        <div className="h-20 flex items-center px-6 border-b border-sidebar-border/70 gap-3">
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className="h-10 w-auto max-w-[180px] object-contain"
          />
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-2 px-4 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              <div className="px-3 mb-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-normal">
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
                      "flex items-center gap-3 rounded-[18px] px-4 py-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-out",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)]"
                        : "text-sidebar-foreground/70 hover:bg-white/70 hover:text-sidebar-foreground",
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

        <div className="p-4 border-t border-sidebar-border/70">
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-3 rounded-[20px] px-3 py-3 text-sm font-medium transition-colors duration-200 outline-none text-sidebar-foreground/80 hover:bg-white/70 hover:text-sidebar-foreground">
              <div className="h-9 w-9 rounded-full bg-sidebar-accent border border-sidebar-border flex items-center justify-center overflow-hidden">
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

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-border/70 bg-white/72 backdrop-blur-[40px] flex items-center px-6 shrink-0 z-10 sticky top-0 md:hidden">
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className="h-8 w-auto max-w-[168px] object-contain"
          />
        </header>
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] p-5 md:p-8 lg:p-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
