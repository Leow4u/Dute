import { useAppUser } from "@/lib/auth";
import { useInicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";

import { InicioDoFinanceiroView } from "./inicio-view";

/** /financeiro: o Início do Financeiro, com as leituras de quem abre o módulo. */
export default function FinanceiroInicio() {
  const { user } = useAppUser();
  const agora = new Date();
  const inicio = useInicioDoFinanceiro(user?.publicMetadata.role, agora);
  return <InicioDoFinanceiroView nome={user?.fullName ?? ""} hoje={agora} inicio={inicio} />;
}
