import { ChevronsUpDown, Download, LogOut, Settings, User as UserIcon } from "lucide-react";
import { Link } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/access";
import type { AppUser } from "@/lib/auth";
import { usePwaInstall } from "@/lib/pwa-install";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  basePath: string;
  compact?: boolean;
  /**
   * Cabeçalho do celular. O botão fica no canto direito: o painel abre para
   * baixo, dentro da tela. A troca de módulo fica no seletor do shell.
   */
  cabecalho?: boolean;
  /** "v3": barra e cabeçalho pretos de cada módulo. */
  variante?: "padrao" | "v3";
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
  user: AppUser | null;
};

/** Onde o painel da conta abre. A barra recolhida continua para o lado. */
export function posicaoDoMenu(cabecalho: boolean, compact: boolean): { side: "bottom" | "right" | "top"; align: "start" | "end" } {
  if (cabecalho) return { side: "bottom", align: "end" };
  if (compact) return { side: "right", align: "start" };
  return { side: "top", align: "end" };
}

/** Duas letras do nome, para o avatar sem foto. */
export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((parte) => /^\p{L}/u.test(parte));
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? "").slice(0, 2);
  return letras.toUpperCase() || "?";
}

function UserAvatar({ user }: { user: AppUser | null }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-sidebar-border bg-sidebar-accent">
      {user?.imageUrl ? (
        <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <UserIcon className="h-4 w-4" aria-hidden="true" />
      )}
    </div>
  );
}

function AvatarV3({ user, nome }: { user: AppUser | null; nome: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-v3-marca text-sm font-bold text-v3-marca-foreground"
    >
      {user?.imageUrl ? <img src={user.imageUrl} alt="" className="size-full object-cover" /> : iniciais(nome)}
    </span>
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

const GATILHO_V3 = {
  rodape:
    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
  compacto:
    "flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
};

export function AccountMenu({
  basePath,
  compact = false,
  cabecalho = false,
  variante = "padrao",
  signOut,
  user,
}: AccountMenuProps) {
  const { isInstalled } = usePwaInstall();
  const role = user?.publicMetadata.role;
  const name = user?.fullName || "Usuário";
  const email = user?.primaryEmailAddress?.emailAddress || "Sem e-mail";
  const posicao = posicaoDoMenu(cabecalho, compact);
  const v3 = variante === "v3";

  return (
    <DropdownMenu>
      {v3 ? (
        <DropdownMenuTrigger className={compact ? GATILHO_V3.compacto : GATILHO_V3.rodape}>
          <AvatarV3 user={user} nome={name} />
          {compact ? (
            <span className="sr-only">Minha conta</span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-v3-header-foreground">{name}</span>
              <span className="block truncate text-xs text-v3-header-foreground/65">{roleLabel(role)}</span>
            </span>
          )}
        </DropdownMenuTrigger>
      ) : (
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
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
            </>
          )}
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        align={posicao.align}
        side={posicao.side}
        collisionPadding={16}
        className={cn("p-0", cabecalho ? "w-[min(18.75rem,calc(100vw-2rem))]" : "w-[300px]", v3 && "v3")}
      >
        <ContaCabecalho user={user} name={name} email={email} papel={roleLabel(role)} />
        <div className="p-1">
          <DropdownMenuItem asChild>
            <Link href="/configuracoes" className="min-h-11 cursor-pointer">
              <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
              Configuração
            </Link>
          </DropdownMenuItem>
          {!isInstalled ? (
            <DropdownMenuItem asChild>
              <Link href="/configuracoes/aplicativo" className="min-h-11 cursor-pointer">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Instalar no celular
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="min-h-11 cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
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
