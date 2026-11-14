import { useState } from "react";

import { useAppUser } from "@/lib/auth";
import { usePainelDoRh } from "@/lib/rh/use-rh";

import { PessoasView, type EstadoDaTela } from "./pessoas-view";

/** /rh/pessoas: quem está ativo e quem está inativo na Operação com o vínculo aberto, da mesma leitura do Início (getRhPanel). */
export default function RhPessoas() {
  const { user } = useAppUser();
  const leitura = usePainelDoRh(user?.publicMetadata.role);
  const [busca, setBusca] = useState("");
  // O painel lido fica na tela quando a releitura falha (a do intervalo, a de depois de gravar): a lista não some.
  const estado: EstadoDaTela = leitura.painel ? "pronto" : leitura.falhas.length ? "erro" : "carregando";
  // A nova tentativa relê do zero, e a falha fica na tela até a resposta (usePainelDoRh).
  const novaTentativa = { tentando: Boolean(leitura.falhas.length && leitura.relendo), tentar: () => leitura.reler?.() };
  return (
    <PessoasView
      estado={estado}
      leitura={novaTentativa}
      falhaNaReleitura={Boolean(leitura.painel) && leitura.falhas.length > 0}
      colaboradores={leitura.painel?.colaboradores ?? []}
      busca={busca}
      onBusca={setBusca}
    />
  );
}
