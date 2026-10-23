import { useGetDashboard } from "@workspace/api-client-react";

import { useAppUser } from "@/lib/auth";
import { itensDoInicioDoWms } from "@/lib/inicio-do-wms";
import { canAccessModule, WMS_ROLES } from "@/lib/modules";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";

import { InicioDoWmsView } from "./home-view";

/** /dashboard: o Início da Armazenagem, com as leituras de quem abre o módulo. */
export default function Home() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const seesWarehouse = canAccessModule(role, WMS_ROLES);
  const dashboard = useGetDashboard();
  const inbox = useInicioDoWms(role);
  const skus = Number((dashboard.data as { total_skus?: number } | undefined)?.total_skus ?? 0);

  return (
    <InicioDoWmsView
      nome={user?.fullName ?? ""}
      hoje={new Date()}
      inicio={{
        itens: itensDoInicioDoWms(inbox.items),
        carregando: inbox.carregando,
        falhas: inbox.falhas,
        hoje: seesWarehouse ? { ...inbox.summary, skus } : null,
      }}
    />
  );
}
