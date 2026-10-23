import { useAppUser } from "@/lib/auth";
import { useInicioDoRh } from "@/lib/rh/use-rh";

import { InicioDoRhView } from "./inicio-view";

/** /rh: o Início do RH, com o painel que a callable getRhPanel devolve. */
export default function RhInicio() {
  const { user } = useAppUser();
  const inicio = useInicioDoRh(user?.publicMetadata.role);
  return <InicioDoRhView nome={user?.fullName ?? ""} hoje={new Date()} inicio={inicio} />;
}
