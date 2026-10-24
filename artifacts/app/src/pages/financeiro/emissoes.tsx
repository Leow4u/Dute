import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppUser } from "@/lib/auth";
import { chamarFinanceiro, novaChave } from "@/lib/financeiro/api";
import type { AcaoDaEmissao, EmissaoDoFinanceiro } from "@/lib/financeiro/emissoes";
import { CHAVE_DAS_EMISSOES, useEmissoesDoFinanceiro } from "@/lib/financeiro/use-emissoes";

import { EmissoesView, type EstadoDasEmissoes } from "./emissoes-view";

/**
 * /financeiro/emissoes: as NFS-e pedidas à Omie (parte 7.4f), pela callable
 * listNfEmissions. Tentar de novo e desistir passam pela actOnNfEmission,
 * com a edição que a tela viu; desistir pede a confirmação na linha. A chave
 * de idempotência é da intenção (a emissão, a ação e a edição): a nova
 * tentativa depois da falha leva a mesma chave, e se a primeira gravou, o
 * servidor repete o resultado. Depois de cada ação, a lista é lida de novo.
 */
export default function FinanceiroEmissoes() {
  const { user } = useAppUser();
  const leitura = useEmissoesDoFinanceiro(user?.publicMetadata.role);
  const queryClient = useQueryClient();
  const chaves = useRef(new Map<string, string>());
  const [desistindo, setDesistindo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  async function agir(emissao: EmissaoDoFinanceiro, acao: AcaoDaEmissao) {
    const intencao = `${emissao.id}:${acao}:${emissao.edicao}`;
    const chave = chaves.current.get(intencao) ?? novaChave();
    chaves.current.set(intencao, chave);
    setOcupado(true);
    setAviso(null);
    setFalha(null);
    try {
      await chamarFinanceiro("actOnNfEmission", { idempotency_key: chave, id: emissao.id, acao, expected_edicao: emissao.edicao });
      chaves.current.delete(intencao);
      setAviso(acao === "retomar" ? `${emissao.cliente}: emissão retomada` : `${emissao.cliente}: emissão desistida`);
      setDesistindo(null);
    } catch (error) {
      setFalha(error instanceof Error ? error.message : "Não foi possível mudar a emissão.");
    } finally {
      // Lê de novo também depois da falha: se a emissão mudou, a tela mostra a edição que vale.
      await queryClient.invalidateQueries({ queryKey: CHAVE_DAS_EMISSOES });
      setOcupado(false);
    }
  }

  function daLista(id: string): EmissaoDoFinanceiro | undefined {
    return leitura.emissoes?.find((item) => item.id === id);
  }

  const estado: EstadoDasEmissoes = leitura.falhas.length ? "erro" : leitura.emissoes ? "pronto" : "carregando";
  return (
    <EmissoesView
      estado={estado}
      emissoes={leitura.emissoes ?? []}
      desistindo={desistindo}
      ocupado={ocupado}
      aviso={aviso}
      falha={falha}
      acoes={{
        pedir: (id, acao) => {
          const emissao = daLista(id);
          if (!emissao) return;
          setAviso(null);
          setFalha(null);
          if (acao === "desistir") setDesistindo(id);
          else void agir(emissao, "retomar");
        },
        confirmarDesistencia: () => {
          const emissao = desistindo ? daLista(desistindo) : undefined;
          if (emissao) void agir(emissao, "desistir");
        },
        desistirDeDesistir: () => setDesistindo(null),
      }}
    />
  );
}
