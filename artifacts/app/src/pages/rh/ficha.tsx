import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { colaboradorDaBusca } from "@/lib/rh/navegacao";
import { useFichaDoRh } from "@/lib/rh/use-rh";

import { FichaView, type EstadoDaFicha } from "./ficha-view";

/** /rh/ficha?colaborador=col_...: a ficha da pessoa, pela callable getRhFicha. */
export default function RhFicha() {
  const { user } = useAppUser();
  const colaboradorId = colaboradorDaBusca(useSearch());
  const leitura = useFichaDoRh(user?.publicMetadata.role, colaboradorId);
  const estado: EstadoDaFicha = !colaboradorId || leitura.erro ? "erro" : leitura.ficha ? "pronto" : "carregando";
  return <FichaView estado={estado} ficha={leitura.ficha} erro={colaboradorId ? leitura.erro : "Pessoa não encontrada."} />;
}
