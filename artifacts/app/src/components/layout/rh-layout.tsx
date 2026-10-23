import { useEffect, type ReactNode } from "react";
import { Users } from "lucide-react";
import { useLocation } from "wouter";

import { AccountMenu } from "@/components/layout/account-menu";
import { ShellDoModulo } from "@/components/layout/shell-do-modulo";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { menuDoRh } from "@/lib/modules";
import { useOperationProfile } from "@/lib/operation-profile";
import { usePwaInstall } from "@/lib/pwa-install";
import { contadoresDoMenu } from "@/lib/resumo-do-modulo";
import { useInicioDoRh } from "@/lib/rh/use-rh";
import { moduloAberto, opcoesDoSeletor } from "@/lib/seletor-de-modulo";
import { rememberReturnPath } from "@/lib/settings-nav";

/**
 * Layout das rotas /rh (docs/plataforma/fase-8-rh.md): o shell v3 do módulo,
 * com o Início e Pessoas. O RH não tem Agent Dute nem cliente ativo: o que
 * mora nele não vai a nenhum dos dois.
 */
export default function RhLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { profile } = useOperationProfile();
  const { isOnline } = usePwaInstall();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const role = user?.publicMetadata.role;
  const menu = menuDoRh(role);
  // Os contadores do menu saem da lista do Início do módulo (parte 2.4).
  const inicio = useInicioDoRh(role);

  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  return (
    <ShellDoModulo
      ambiente="rh"
      atual={moduloAberto(location) ?? { label: "RH", icon: Users }}
      opcoes={opcoesDoSeletor(role, profile, location)}
      items={menu}
      contadores={contadoresDoMenu(inicio.itens, menu, "rh-inicio")}
      basePath={basePath}
      online={isOnline}
      conta={(compact) => (
        <AccountMenu basePath={basePath} compact={compact} cabecalho={compact} variante="v3" signOut={signOut} user={user} />
      )}
    >
      {children}
    </ShellDoModulo>
  );
}
