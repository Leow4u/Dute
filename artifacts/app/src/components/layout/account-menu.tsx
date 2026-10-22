import type { Papel } from "@workspace/dominio";
import type { ReactNode } from "react";
import { ChevronsUpDown, Download, LayoutGrid, LogOut, Settings, User as UserIcon, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/access";
import { moduloDaRota, podeTrocarDeModulo } from "@/lib/ambientes";
import type { AppUser } from "@/lib/auth";
import { COMERCIAL_LIBERADO, PLATAFORMA_LIBERADA } from "@/lib/liberacao";
import { useOperationProfile } from "@/lib/operation-profile";
import type { OperationProfile } from "@/lib/operations";
import { modulesForPerson } from "@/lib/platform-modules";
import { usePwaInstall } from "@/lib/pwa-install";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  basePath: string;
  compact?: boolean;
  /**
   * Cabeçalho do celular. O botão fica no canto direito: o painel abre para
   * baixo, dentro da tela, e os módulos entram na mesma lista. O submenu
   * lateral não cabe ali.
   */
  cabecalho?: boolean;
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
  user: AppUser | null;
};

/** Onde o painel da conta abre. A barra recolhida continua para o lado. */
export function posicaoDoMenu(cabecalho: boolean, compact: boolean): { side: "bottom" | "right" | "top"; align: "start" | "end" } {
  if (cabecalho) return { side: "bottom", align: "end" };
  if (compact) return { side: "right", align: "start" };
  return { side: "top", align: "end" };
}

export type AtalhoDeModulo = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  atual: boolean;
};

/**
 * Módulos com tela, na ordem da entrada, só quando a pessoa tem mais de um.
 * O aberto fica marcado: Comercial pelo prefixo, Financeiro pela casa
 * /faturamento (mesmo dentro do shell do WMS) e o resto desse shell como
 * Armazenagem. Configuração não marca nenhum.
 */
export function atalhosDaConta(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  path: string,
  comercial: boolean = COMERCIAL_LIBERADO,
  plataforma: boolean = PLATAFORMA_LIBERADA,
): AtalhoDeModulo[] {
  if (!podeTrocarDeModulo(role, profile, comercial, plataforma)) return [];
  const aberto = moduloDaRota(path);
  return modulesForPerson(role, profile, comercial).map((entry) => ({
    key: entry.module.key,
    label: entry.module.label,
    href: entry.href,
    icon: entry.module.icon,
    atual: entry.module.key === aberto,
  }));
}

function UserAvatar({ user }: { user: AppUser | null }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-sidebar-border bg-sidebar-accent">
      {user?.imageUrl ? (
        <img src={user.imageUrl} alt="Avatar" className="h-full w-full object-cover" />
      ) : (
        <UserIcon className="h-4 w-4" />
      )}
    </div>
  );
}

export function ContaCabecalho({ user, name, email, papel }: { user: AppUser | null; name: string; email: string; papel: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
      <UserAvatar user={user} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
        <span className="mt-1 inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">{papel}</span>
      </div>
    </div>
  );
}

export function ModuloLink({ atalho, className }: { atalho: AtalhoDeModulo; className?: string }) {
  const Icon = atalho.icon;
  return (
    <Link
      href={atalho.href}
      aria-current={atalho.atual ? "page" : undefined}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        className,
        atalho.atual && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{atalho.label}</span>
      {atalho.atual ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground" /> : null}
    </Link>
  );
}

/**
 * Módulos na mesma lista do menu. O submenu lateral não cabe no celular.
 * `item` envolve cada link no item do menu, para o toque fechar o painel.
 */
export function ListaDeModulos({
  atalhos,
  item,
}: {
  atalhos: AtalhoDeModulo[];
  item?: (link: ReactNode, key: string) => ReactNode;
}) {
  return (
    <div className="border-b border-border/60 p-1">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Módulos</p>
      {atalhos.map((atalho) => {
        const link = <ModuloLink atalho={atalho} className="min-h-11" />;
        return item ? item(link, atalho.key) : <div key={atalho.key}>{link}</div>;
      })}
    </div>
  );
}

export function AccountMenu({ basePath, compact = false, cabecalho = false, signOut, user }: AccountMenuProps) {
  const { isInstalled } = usePwaInstall();
  const { profile } = useOperationProfile();
  const [location] = useLocation();
  const role = user?.publicMetadata.role;
  const name = user?.fullName || "Usuário";
  const email = user?.primaryEmailAddress?.emailAddress || "Sem e-mail";
  const atalhos = atalhosDaConta(role, profile, location);
  const posicao = posicaoDoMenu(cabecalho, compact);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm font-medium text-sidebar-foreground/80 outline-none transition-colors duration-200 hover:bg-card hover:text-sidebar-foreground",
          compact ? "h-11 w-11 justify-center" : "w-full px-2 py-2",
        )}
      >
        <UserAvatar user={user} />
        {compact ? (
          <span className="sr-only">Minha conta</span>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">{name}</div>
              <div className="truncate text-xs text-sidebar-foreground/55">{email}</div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={posicao.align}
        side={posicao.side}
        collisionPadding={16}
        className={cn("p-0", cabecalho ? "w-[min(18.75rem,calc(100vw-2rem))]" : "w-[300px]")}
      >
        <ContaCabecalho user={user} name={name} email={email} papel={roleLabel(role)} />
        {cabecalho && atalhos.length > 0 ? (
          <ListaDeModulos
            atalhos={atalhos}
            item={(link, key) => (
              <DropdownMenuItem key={key} asChild>
                {link}
              </DropdownMenuItem>
            )}
          />
        ) : null}
        <div className="p-1">
          {!cabecalho && atalhos.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                Módulos
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent align="start" className="min-w-44">
                {atalhos.map((atalho) => (
                  <DropdownMenuItem key={atalho.key} asChild>
                    <ModuloLink atalho={atalho} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/configuracoes" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Configuração
            </Link>
          </DropdownMenuItem>
          {!isInstalled ? (
            <DropdownMenuItem asChild>
              <Link href="/configuracoes/aplicativo" className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" />
                Instalar no celular
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarAccountFooter(props: AccountMenuProps) {
  if (props.compact) {
    return (
      <div className="flex justify-center">
        <AccountMenu {...props} />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-sidebar-border/70 bg-card p-1">
      <AccountMenu {...props} />
    </div>
  );
}
