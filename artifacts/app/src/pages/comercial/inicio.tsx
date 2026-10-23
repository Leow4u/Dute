import { useAppUser } from "@/lib/auth";
import { useInicioDoComercial } from "@/lib/comercial/use-inicio";

import { InicioDoComercialView } from "./inicio-view";

/** /comercial: o Início do Comercial, com as consultas de quem abre o módulo. */
export default function ComercialInicio() {
  const { user } = useAppUser();
  const inicio = useInicioDoComercial(user?.publicMetadata.role, user?.uid);
  return <InicioDoComercialView nome={user?.fullName ?? ""} hoje={new Date()} inicio={inicio} />;
}
