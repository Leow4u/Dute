import { useEffect, type ReactNode } from "react";
import { Truck } from "lucide-react";
import { useLocation } from "wouter";

import { AccountMenu } from "@/components/layout/account-menu";
import { ActiveCustomerSwitcher } from "@/components/layout/active-customer-switcher";
import { ShellDoModulo } from "@/components/layout/shell-do-modulo";
import { useAtalhoDoAgente } from "@/hooks/use-atalho-do-agente";
import { abreAgenteDoNucleo, ehTelaDoAgente, ROTA_AGENTE_DA_OPERACAO } from "@/lib/agente/navegacao";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { menuDoOperacao } from "@/lib/modules";
import { useInicioDaOperacao } from "@/lib/operacao/use-inicio";
import { useOperationProfile } from "@/lib/operation-profile";
import { usePwaInstall } from "@/lib/pwa-install";
import { contadoresDoMenu } from "@/lib/resumo-do-modulo";
import { moduloAberto, opcoesDoSeletor } from "@/lib/seletor-de-modulo";
import { rememberReturnPath } from "@/lib/settings-nav";

/** Layout das rotas /operacao: o shell v3 do módulo, com a fila e o cadastro. */
export default function OperacaoLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { profile } = useOperationProfile();
  const { isOnline } = usePwaInstall();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const role = user?.publicMetadata.role;
  const menu = menuDoOperacao(role);
  // Os contadores do menu saem da lista do Início do módulo (parte 2.4).
  const inicio = useInicioDaOperacao(role);

  // O Agent Dute do módulo (parte 5.5j): o "/" leva a ele, e a tela dele mostra o cliente ativo.
  useAtalhoDoAgente(role, abreAgenteDoNucleo(role) ? ROTA_AGENTE_DA_OPERACAO : null);
  const gerenciaClientes = role === "owner" || role === "admin";

  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  return (
    <ShellDoModulo
      ambiente="operacao"
      atual={moduloAberto(location) ?? { label: "Operação", icon: Truck }}
      opcoes={opcoesDoSeletor(role, profile, location)}
      items={menu}
      contadores={contadoresDoMenu(inicio.itens, menu, "operacao-inicio")}
      basePath={basePath}
      online={isOnline}
      abaixoDoSeletor={
        ehTelaDoAgente(location)
          ? (compact) => <ActiveCustomerSwitcher variant={compact ? "v3-cabecalho" : "v3"} canManageCustomers={gerenciaClientes} />
          : undefined
      }
      conta={(compact) => (
        <AccountMenu basePath={basePath} compact={compact} cabecalho={compact} variante="v3" signOut={signOut} user={user} />
      )}
    >
      {children}
    </ShellDoModulo>
  );
}
