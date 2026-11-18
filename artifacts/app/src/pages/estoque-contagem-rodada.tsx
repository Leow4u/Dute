import { useMemo, useState } from "react";
import { useSearch } from "wouter";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { juntarTentativas } from "@/lib/operacao/leitura";
import { hrefDaFolha, relatorioCaixasSaldo, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { rodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { rodadaDaBusca } from "@/lib/warehouse-ops/rodadas-da-contagem";
import { useContagemPorCaixa } from "@/lib/warehouse-ops/use-contagem-por-caixa";
import { useCaixasDoCliente } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { useLeiturasDaRodada } from "@/lib/warehouse-ops/use-recontagem";
import { useRodadasDaContagem } from "@/lib/warehouse-ops/use-rodadas";

import { EstoqueContagemRodadaView, type EstadoDaRodada } from "./estoque-contagem-rodada-view";

/**
 * Estoque › Contagem por caixa, a rodada (diagnóstico da Contagem cíclica,
 * seção 6, item 4; o registro da rodada, 18/11/2026): as prateleiras do
 * cliente ativo com o estado na rodada aberta (lida de count_rounds; a
 * recontagem geral de 17/11 sem documento vale como aberta), das leituras da
 * folha (as do Mapa e das Etiquetas) e das recontagens gravadas com o
 * `round_id` dela, ao vivo. Com ?rodada=<id>, aquela rodada, só leitura (o
 * "Ver" das anteriores). Sem rodada aberta, "Nenhuma contagem em
 * andamento." com "Iniciar contagem" (decisão 2 de 18/11/2026). Só leitura:
 * a bancada de cada prateleira é que grava.
 */

const SEM_CATALOGO = new Map();

export default function PaginaRodadaDaContagem() {
  const { code, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const [agora] = useState(() => new Date());
  const busca = rodadaDaBusca(useSearch());
  const rodadas = useRodadasDaContagem(cliente);
  // A rodada da busca (o "Ver" das anteriores) ou a aberta do cliente; a pedida que não é a aberta abre só leitura.
  const pedida = busca ? (rodadas.registradas.find((registrada) => registrada.id === busca) ?? (rodadas.aberta?.id === busca ? rodadas.aberta : null)) : null;
  const rodada = busca ? pedida : rodadas.aberta;
  const somenteLeitura = Boolean(busca) && pedida?.id !== rodadas.aberta?.id;
  const leitura = useContagemPorCaixa(cliente);
  // As mesmas caixas que a folha já lê (a mesma chave): a rodada precisa também das que ela esvaziou.
  const caixas = useCaixasDoCliente(cliente);
  const daRodada = useLeiturasDaRodada(cliente, rodada?.id ?? null, SEM_CATALOGO);

  const resumo = useMemo(
    () =>
      rodada
        ? rodadaDaContagem({
            cliente,
            prateleiras: leitura.prateleiras,
            caixas: caixas.data ?? [],
            recontagens: daRodada.recontagens,
            guardas: daRodada.guardas,
            reservas: daRodada.separadas,
            rodada,
            agora,
          })
        : null,
    [cliente, leitura.prateleiras, caixas.data, daRodada.recontagens, daRodada.guardas, daRodada.separadas, rodada, agora],
  );
  const relatorio = useMemo(() => relatorioCaixasSaldo(leitura.prateleiras), [leitura.prateleiras]);
  const primeiraRua = ruasDaContagem(leitura.prateleiras)[0] ?? null;

  // Sem rodada só depois de ler: nunca "Nenhuma contagem em andamento." antes de as rodadas chegarem.
  const estado: EstadoDaRodada =
    clienteCarregando || rodadas.carregando || leitura.carregando || daRodada.carregando
      ? "carregando"
      : leitura.falha || rodadas.falhou || daRodada.falhou
        ? "erro"
        : !rodada
          ? "sem_rodada"
          : "pronto";
  return (
    <EstoqueContagemRodadaView
      estado={estado}
      rodada={estado === "pronto" ? resumo : null}
      somenteLeitura={somenteLeitura}
      agora={agora}
      relatorio={estado === "pronto" ? relatorio : null}
      leitura={leitura.leituras}
      aoVivo={juntarTentativas(rodadas.leitura, daRodada.leitura)}
      falha={leitura.falha}
      clienteFalhou={clienteFalhou}
      hrefDaFolha={hrefDaFolha(primeiraRua)}
    />
  );
}
