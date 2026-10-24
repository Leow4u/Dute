import { useState } from "react";

import { useAppUser } from "@/lib/auth";
import { usePainelDoRh } from "@/lib/rh/use-rh";

import { PessoasView, type EstadoDaTela } from "./pessoas-view";

/** /rh/pessoas: quem está ativo, da mesma leitura do Início (getRhPanel). */
export default function RhPessoas() {
  const { user } = useAppUser();
  const leitura = usePainelDoRh(user?.publicMetadata.role);
  const [busca, setBusca] = useState("");
  const estado: EstadoDaTela = leitura.falhas.length ? "erro" : leitura.painel ? "pronto" : "carregando";
  return <PessoasView estado={estado} colaboradores={leitura.painel?.colaboradores ?? []} busca={busca} onBusca={setBusca} />;
}
