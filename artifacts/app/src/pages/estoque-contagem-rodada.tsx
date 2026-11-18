import { useMemo, useState } from "react";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { hrefDaFolha, relatorioCaixasSaldo, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { RODADA_DA_RECONTAGEM_GERAL, rodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { useContagemPorCaixa } from "@/lib/warehouse-ops/use-contagem-por-caixa";
import { useCaixasDoCliente } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { useLeiturasDaRodada } from "@/lib/warehouse-ops/use-recontagem";

import { EstoqueContagemRodadaView, type EstadoDaRodada } from "./estoque-contagem-rodada-view";

/**
 * Estoque › Contagem por caixa, a rodada (diagnóstico da Contagem cíclica,
 * seção 6, item 4): as prateleiras do cliente ativo com o estado na
 * recontagem geral, das leituras da folha (as do Mapa e das Etiquetas) e
 * das recontagens gravadas com o `round_id` dela, ao vivo. Só leitura: a
 * bancada de cada prateleira é que grava.
 */

const SEM_CATALOGO = new Map();

export default function PaginaRodadaDaContagem() {
  const { code, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const [agora] = useState(() => new Date());
  // A rodada da recontagem geral, fixa até a coleção da rodada: o progresso é o da recontagem inteira, de todos os dias.
  const rodada = RODADA_DA_RECONTAGEM_GERAL;
  const leitura = useContagemPorCaixa(cliente);
  // As mesmas caixas que a folha já lê (a mesma chave): a rodada precisa também das que ela esvaziou.
  const caixas = useCaixasDoCliente(cliente);
  const daRodada = useLeiturasDaRodada(cliente, rodada.id, SEM_CATALOGO);

  const resumo = useMemo(
    () =>
      rodadaDaContagem({
        cliente,
        prateleiras: leitura.prateleiras,
        caixas: caixas.data ?? [],
        recontagens: daRodada.recontagens,
        guardas: daRodada.guardas,
        reservas: daRodada.separadas,
        rodada,
        agora,
      }),
    [cliente, leitura.prateleiras, caixas.data, daRodada.recontagens, daRodada.guardas, daRodada.separadas, rodada, agora],
  );
  const relatorio = useMemo(() => relatorioCaixasSaldo(leitura.prateleiras), [leitura.prateleiras]);
  const primeiraRua = ruasDaContagem(leitura.prateleiras)[0] ?? null;

  const estado: EstadoDaRodada = clienteCarregando || leitura.carregando || daRodada.carregando ? "carregando" : leitura.falha || daRodada.falhou ? "erro" : "pronto";
  return (
    <EstoqueContagemRodadaView
      estado={estado}
      rodada={estado === "pronto" ? resumo : null}
      agora={agora}
      relatorio={estado === "pronto" ? relatorio : null}
      leitura={leitura.leituras}
      aoVivo={daRodada.leitura}
      falha={leitura.falha}
      clienteFalhou={clienteFalhou}
      hrefDaFolha={hrefDaFolha(primeiraRua)}
    />
  );
}
