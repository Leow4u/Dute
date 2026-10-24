import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppUser } from "@/lib/auth";
import { chamarFinanceiro, novaChave } from "@/lib/financeiro/api";
import { tituloDaBaixa, type AcaoNaBaixa, type BaixaDoFinanceiro } from "@/lib/financeiro/baixas";
import type { AcaoDaEmissao, EmissaoDoFinanceiro } from "@/lib/financeiro/emissoes";
import { CHAVE_DAS_BAIXAS, useBaixasDoFinanceiro } from "@/lib/financeiro/use-baixas";
import { CHAVE_DAS_EMISSOES, useEmissoesDoFinanceiro } from "@/lib/financeiro/use-emissoes";

import { EmissoesView, type EstadoDasEmissoes } from "./emissoes-view";

/**
 * /financeiro/emissoes: as NFS-e pedidas à Omie (parte 7.4f), pela callable
 * listNfEmissions, e as baixas dos pagamentos abertas na Omie (parte 7.4h),
 * pela listNfSettlements. Tentar de novo, desistir e dispensar passam pelas
 * callables de ação (actOnNfEmission e actOnNfSettlement), com a edição que
 * a tela viu; desistir e dispensar pedem a confirmação na linha. A chave de
 * idempotência é da intenção (o item, a ação e a edição): a nova tentativa
 * depois da falha leva a mesma chave, e se a primeira gravou, o servidor
 * repete o resultado. Depois de cada ação, as listas são lidas de novo.
 */
export default function FinanceiroEmissoes() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const leitura = useEmissoesDoFinanceiro(role);
  const leituraDasBaixas = useBaixasDoFinanceiro(role);
  const queryClient = useQueryClient();
  const chaves = useRef(new Map<string, string>());
  const [desistindo, setDesistindo] = useState<string | null>(null);
  const [dispensando, setDispensando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  function chaveDa(intencao: string): string {
    const chave = chaves.current.get(intencao) ?? novaChave();
    chaves.current.set(intencao, chave);
    return chave;
  }

  async function gravar(intencao: string, chamar: (chave: string) => Promise<unknown>, deuCerto: string) {
    setOcupado(true);
    setAviso(null);
    setFalha(null);
    try {
      await chamar(chaveDa(intencao));
      chaves.current.delete(intencao);
      setAviso(deuCerto);
      setDesistindo(null);
      setDispensando(null);
    } catch (error) {
      setFalha(error instanceof Error ? error.message : "Não foi possível gravar.");
    } finally {
      // Lê de novo também depois da falha: se o item mudou, a tela mostra a edição que vale.
      await Promise.all([queryClient.invalidateQueries({ queryKey: CHAVE_DAS_EMISSOES }), queryClient.invalidateQueries({ queryKey: CHAVE_DAS_BAIXAS })]);
      setOcupado(false);
    }
  }

  function agirNaEmissao(emissao: EmissaoDoFinanceiro, acao: AcaoDaEmissao) {
    void gravar(
      `${emissao.id}:${acao}:${emissao.edicao}`,
      (chave) => chamarFinanceiro("actOnNfEmission", { idempotency_key: chave, id: emissao.id, acao, expected_edicao: emissao.edicao }),
      acao === "retomar" ? `${emissao.cliente}: emissão retomada` : `${emissao.cliente}: emissão desistida`,
    );
  }

  function agirNaBaixa(baixa: BaixaDoFinanceiro, acao: AcaoNaBaixa) {
    void gravar(
      `${baixa.id}:${acao}:${baixa.edicao}`,
      (chave) => chamarFinanceiro("actOnNfSettlement", { idempotency_key: chave, id: baixa.id, acao, expected_edicao: baixa.edicao }),
      acao === "retomar" ? `${tituloDaBaixa(baixa)}: baixa retomada` : `${tituloDaBaixa(baixa)}: baixa dispensada`,
    );
  }

  const daLista = (id: string) => leitura.emissoes?.find((item) => item.id === id);
  const baixaDaLista = (id: string) => leituraDasBaixas.baixas?.find((item) => item.id === id);

  const falhas = [...leitura.falhas, ...leituraDasBaixas.falhas];
  const estado: EstadoDasEmissoes = falhas.length ? "erro" : leitura.emissoes && leituraDasBaixas.baixas ? "pronto" : "carregando";
  return (
    <EmissoesView
      estado={estado}
      emissoes={leitura.emissoes ?? []}
      baixas={leituraDasBaixas.baixas ?? []}
      desistindo={desistindo}
      dispensando={dispensando}
      ocupado={ocupado}
      aviso={aviso}
      falha={falha}
      acoes={{
        pedir: (id, acao) => {
          const emissao = daLista(id);
          if (!emissao) return;
          setAviso(null);
          setFalha(null);
          setDispensando(null);
          if (acao === "desistir") setDesistindo(id);
          else agirNaEmissao(emissao, "retomar");
        },
        confirmarDesistencia: () => {
          const emissao = desistindo ? daLista(desistindo) : undefined;
          if (emissao) agirNaEmissao(emissao, "desistir");
        },
        desistirDeDesistir: () => setDesistindo(null),
        pedirNaBaixa: (id, acao) => {
          const baixa = baixaDaLista(id);
          if (!baixa) return;
          setAviso(null);
          setFalha(null);
          setDesistindo(null);
          if (acao === "dispensar") setDispensando(id);
          else agirNaBaixa(baixa, "retomar");
        },
        confirmarDispensa: () => {
          const baixa = dispensando ? baixaDaLista(dispensando) : undefined;
          if (baixa) agirNaBaixa(baixa, "dispensar");
        },
        desistirDeDispensar: () => setDispensando(null),
      }}
    />
  );
}
