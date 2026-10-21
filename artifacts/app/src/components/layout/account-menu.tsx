import { ChevronsUpDown, Download, LogOut, Settings, User as UserIcon } from "lucide-react";
import { Link } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleDescription, roleLabel } from "@/lib/access";
import type { AppUser } from "@/lib/auth";
import { usePwaInstall } from "@/lib/pwa-install";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  basePath: string;
  compact?: boolean;
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
  user: AppUser | null;
};

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

export function AccountMenu({ basePath, compact = false, signOut, user }: AccountMenuProps) {
  const { isInstalled } = usePwaInstall();
  const role = user?.publicMetadata.role;
  const name = user?.fullName || "Usuário";
  const email = user?.primaryEmailAddress?.emailAddress || "Sem e-mail";
  const managesAccess = role === "owner" || role === "admin";

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
      <DropdownMenuContent align={compact ? "start" : "end"} side={compact ? "right" : "top"} className="w-[300px] p-0">
        {/* A conta inteira cabe aqui; a antiga tela de Configuração repetia isto. */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <UserAvatar user={user} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
        </div>
        <div className="space-y-1.5 border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Perfil</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">{roleLabel(role)}</span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {roleDescription(role)}{" "}
            {managesAccess ? "Perfis são definidos em Pessoas e acessos." : "Para mudar seu perfil, fale com a administração."}
          </p>
        </div>
        <div className="p-1">
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
