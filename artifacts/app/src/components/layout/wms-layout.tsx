import { useEffect, useState, type ReactNode } from "react";
import { Boxes } from "lucide-react";
import { useLocation } from "wouter";

import { AccountMenu } from "@/components/layout/account-menu";
import { ActiveCustomerSwitcher } from "@/components/layout/active-customer-switcher";
import { ShellDoModulo } from "@/components/layout/shell-do-modulo";
import { useAtalhoDoAgente } from "@/hooks/use-atalho-do-agente";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { getNavigationForProfileRole, INTERNAL_ROLES } from "@/lib/modules";
import { useOperationProfile } from "@/lib/operation-profile";
import { contadoresDoMenu } from "@/lib/resumo-do-modulo";
import { moduloAberto, opcoesDoSeletor } from "@/lib/seletor-de-modulo";
import { rememberReturnPath } from "@/lib/settings-nav";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";

/** O menu lateral do shell, com os contadores, aparece a partir do md (768 px); abaixo, a barra do celular, sem eles. */
const COM_MENU_LATERAL = "(min-width: 768px)";

/**
 * O menu lateral está na tela. Lido já no primeiro desenho, para o celular não
 * começar a leitura que não mostra.
 */
function useMenuLateral(): boolean {
  const consulta = () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(COM_MENU_LATERAL).matches);
  const [visivel, setVisivel] = useState(consulta);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(COM_MENU_LATERAL);
    const mudou = () => setVisivel(media.matches);
    mudou();
    media.addEventListener("change", mudou);
    return () => media.removeEventListener("change", mudou);
  }, []);
  return visivel;
}

/**
 * Layout da Armazenagem para a equipe (docs/plataforma/fase-4-financeiro.md,
 * parte 4.7a): o shell v3 do módulo, com o Início, os Pedidos, o Estoque (as
 * telas dentro), o Faturamento e o resto do menu do WMS, o cliente ativo
 * abaixo do seletor e o contador de cada item, tirado do "Precisa de você"
 * do Início. A tela que ainda não passou para a v3 (lib/wms-v3.ts) fica com o
 * visual do WMS. O portal do cliente segue no layout de antes.
 */
export default function WmsLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { profile } = useOperationProfile();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const role = user?.publicMetadata.role;
  const menu = getNavigationForProfileRole(role, profile);
  // A leitura leve no celular (carregamento v2, parte 10; o PR 5 do celular): os contadores do menu só aparecem no
  // menu lateral, e a barra do celular não os mostra. Sem ele, o shell não lê o armazém (até cerca de 9.900
  // documentos) nem o relê a cada 60 s; cada tela lê o que mostra.
  const menuLateral = useMenuLateral();
  const inicio = useInicioDoWms(role, menuLateral);
  const comClienteAtivo = Boolean(role) && INTERNAL_ROLES.includes(role!);
  const gerenciaClientes = role === "owner" || role === "admin";
  useAtalhoDoAgente(role);

  // O "Voltar" da Configuração devolve a pessoa para esta tela.
  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  return (
    <ShellDoModulo
      ambiente="wms"
      atual={moduloAberto(location) ?? { label: "Armazenagem", icon: Boxes }}
      opcoes={opcoesDoSeletor(role, profile, location)}
      items={menu}
      contadores={contadoresDoMenu(inicio.items, menu, "home", inicio.carregando)}
      basePath={basePath}
      conteudoV3={telaDoWmsNaV3(location)}
      abaixoDoSeletor={
        comClienteAtivo
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
