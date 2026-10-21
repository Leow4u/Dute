import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";

import { AccountMenu, SidebarAccountFooter } from "@/components/layout/account-menu";
import { ComercialShell } from "@/components/layout/comercial-shell";
import { podeTrocarDeModulo } from "@/lib/ambientes";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { menuDoComercial } from "@/lib/modules";
import { useOperationProfile } from "@/lib/operation-profile";
import { usePwaInstall } from "@/lib/pwa-install";
import { rememberReturnPath } from "@/lib/settings-nav";

/**
 * Layout das rotas /comercial. O menu lista só as telas do módulo; o WMS
 * não entra. A página inicial é a fila (/comercial).
 */
export default function ComercialLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { isOnline } = usePwaInstall();
  const operation = useOperationProfile();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const role = user?.publicMetadata.role;
  const showModulos = podeTrocarDeModulo(role, operation.profile);
  const items = menuDoComercial(role);

  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  const conta = (compact: boolean) =>
    compact ? (
      <AccountMenu basePath={basePath} compact signOut={signOut} user={user} />
    ) : (
      <SidebarAccountFooter basePath={basePath} signOut={signOut} user={user} />
    );

  return (
    <ComercialShell items={items} showModulos={showModulos} basePath={basePath} online={isOnline} conta={conta}>
      {children}
    </ComercialShell>
  );
}
