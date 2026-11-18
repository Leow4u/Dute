import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { falhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { registroDaAberturaConcluida } from "@/lib/opening-inventory";
import { hrefDaFolha, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { RODADA_DA_RECONTAGEM_GERAL, rodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { useContagemPorCaixa } from "@/lib/warehouse-ops/use-contagem-por-caixa";
import { useCaixasDoCliente } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { useLeiturasDaRodada } from "@/lib/warehouse-ops/use-recontagem";

import { ContagemView, ROTA_DA_ABERTURA, type EstadoDaEntrada } from "./contagem-view";

/**
 * Estoque › Contagem, a entrada (desenho de 18/11/2026): para o cliente com a
 * abertura concluída, as contagens: a recontagem geral em andamento (as
 * mesmas leituras da Contagem por caixa, ao vivo) e a abertura em
 * "Anteriores", lida da sessão. Com a abertura pendente ou em curso, a tela
 * de hoje, em /wms/contagem/abertura, que volta para cá quando a sessão
 * conclui. Só leitura.
 */

const SEM_CATALOGO = new Map();

export default function PaginaDaContagem() {
  const { code, active, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const [agora] = useState(() => new Date());
  const [, navegar] = useLocation();

  const sessao = useOpeningInventorySession();
  // A sessão que falhou fica na tela enquanto tenta de novo (a cópia): a falha nunca vira o vazio.
  const sessaoNaTela = useLeituraComFalha(sessao);
  // A abertura pendente ou em curso é a tela de hoje; a sessão só manda para lá depois de lida, nunca na falha.
  const precisaDaAbertura = sessao.data !== undefined && sessao.data.status !== "completed";
  useEffect(() => {
    if (precisaDaAbertura) navegar(ROTA_DA_ABERTURA, { replace: true });
  }, [precisaDaAbertura, navegar]);

  // A rodada da recontagem geral, fixa até a coleção da rodada (decisão de 17/11/2026).
  const rodada = RODADA_DA_RECONTAGEM_GERAL;
  const leitura = useContagemPorCaixa(cliente);
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
  const primeiraRua = ruasDaContagem(leitura.prateleiras)[0] ?? null;

  const falhaDaSessao = falhaDasLeituras([[sessao, sessaoNaTela]]);
  const estado: EstadoDaEntrada =
    clienteCarregando || sessaoNaTela.isLoading || leitura.carregando || daRodada.carregando
      ? "carregando"
      : falhaDaSessao || leitura.falha || daRodada.falhou
        ? "erro"
        : "pronto";
  return (
    <ContagemView
      estado={estado}
      cliente={active.name}
      abertura={estado === "pronto" ? registroDaAberturaConcluida(sessaoNaTela.data) : null}
      rodada={estado === "pronto" ? resumo : null}
      agora={agora}
      leitura={[...leitura.leituras, sessaoNaTela]}
      aoVivo={daRodada.leitura}
      falha={falhaDaSessao ?? leitura.falha}
      clienteFalhou={clienteFalhou}
      hrefDaFolha={hrefDaFolha(primeiraRua)}
    />
  );
}
