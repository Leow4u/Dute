import { useAppUser } from "@/lib/auth";
import { useInicioDaOperacao } from "@/lib/operacao/use-inicio";

import { InicioDaOperacaoView } from "./inicio-view";

/** /operacao: o Início da Operação, com as leituras de quem abre o módulo. */
export default function OperacaoInicio() {
  const { user } = useAppUser();
  const agora = new Date();
  const inicio = useInicioDaOperacao(user?.publicMetadata.role, agora);
  return <InicioDaOperacaoView nome={user?.fullName ?? ""} hoje={agora} inicio={inicio} />;
}
