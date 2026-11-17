import { useMemo, useState } from "react";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { hrefDaFolha, relatorioCaixasSaldo, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { useContagemPorCaixa, useContagensDeHoje } from "@/lib/warehouse-ops/use-contagem-por-caixa";

import { EstoqueContagemCaixasView, type EstadoDoRelatorio } from "./estoque-contagem-caixas-view";

/**
 * Estoque › Contagem › Caixas × saldo (diagnóstico da Contagem cíclica, seção
 * 6, item 1): a regra de ouro por prateleira do cliente ativo, das mesmas
 * leituras do Mapa e das Etiquetas, e as contagens gravadas hoje
 * (`cycle_counts`). Só leitura: nada aqui grava.
 */

/** A nova tentativa que a pessoa pede, contada enquanto a leitura não responde. */
function useTentativa(tentar: () => Promise<unknown>): { tentando: boolean; tentar: () => Promise<unknown> } {
  const [pedidas, setPedidas] = useState(0);
  return {
    tentando: pedidas > 0,
    tentar: () => {
      setPedidas((quantas) => quantas + 1);
      return tentar().finally(() => setPedidas((quantas) => quantas - 1));
    },
  };
}

export default function PaginaCaixasSaldo() {
  const { code, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const leitura = useContagemPorCaixa(cliente);
  const contagens = useContagensDeHoje(cliente);
  const relatorio = useMemo(() => relatorioCaixasSaldo(leitura.prateleiras), [leitura.prateleiras]);
  const primeiraRua = ruasDaContagem(leitura.prateleiras)[0] ?? null;
  const tentativa = useTentativa(leitura.tentar);
  const tentativaDasContagens = useTentativa(() => contagens.leitura.refetch());

  const estado: EstadoDoRelatorio = clienteCarregando || leitura.carregando ? "carregando" : leitura.falha ? "erro" : "pronto";
  return (
    <EstoqueContagemCaixasView
      estado={estado}
      relatorio={estado === "pronto" ? relatorio : null}
      contagens={{
        estado: clienteCarregando || contagens.carregando ? "carregando" : contagens.falha ? "erro" : "pronto",
        itens: contagens.contagens,
        tentando: tentativaDasContagens.tentando,
        onTentar: tentativaDasContagens.tentar,
      }}
      leitura={leitura.leituras}
      falha={leitura.falha}
      clienteFalhou={clienteFalhou}
      catalogoFalhou={leitura.catalogoFalhou}
      tentando={tentativa.tentando}
      onTentar={tentativa.tentar}
      hrefDaFolha={hrefDaFolha(primeiraRua)}
    />
  );
}
