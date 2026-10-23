import { useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import { useLeitura } from "@/lib/operacao/leitura";
import {
  RELATORIO_ROTULO,
  clientesDoPeriodo,
  diaEmSaoPaulo,
  doCliente,
  filtroInicial,
  inicioDoDiaIso,
  linhasDaPlanilha,
  nomeDaPlanilha,
  osDoRelatorio,
  problemaDoFiltro,
  relatorioDaBusca,
  resumoDasOs,
  solicitacaoDoRelatorio,
  somarDias,
  tabelaDoRelatorio,
  type FiltroDoRelatorio,
} from "@/lib/operacao/relatorios";
import { baixarPlanilha, planilhaXlsx } from "@/lib/planilha-xlsx";

import { RelatoriosView, resumoDasOsEmTexto, type ResumoDoRelatorio } from "./relatorios-view";

/**
 * /operacao/relatorios: lê as OS agendadas no período (`janela.data`) e, no
 * relatório do portal, as solicitações recebidas nele. As regras abrem a
 * leitura a quem coordena a Operação; nada aqui lê valor.
 */
export default function OperacaoRelatorios() {
  const relatorio = relatorioDaBusca(useSearch());
  const [filtro, setFiltro] = useState<FiltroDoRelatorio>(() => filtroInicial(diaEmSaoPaulo(new Date())));
  const problema = problemaDoFiltro(filtro);
  const periodo = problema ? null : `${filtro.de}:${filtro.ate}`;
  const oss = useLeitura(
    periodo ? `relatorio-os:${periodo}` : null,
    (db) => query(collection(db, "service_orders"), where("janela.data", ">=", filtro.de), where("janela.data", "<=", filtro.ate)),
    osDoRelatorio,
  );
  const comSolicitacoes = relatorio === "solicitacoes";
  const solicitacoes = useLeitura(
    periodo && comSolicitacoes ? `relatorio-solicitacoes:${periodo}` : null,
    (db) =>
      query(
        collection(db, "service_requests"),
        where("recebida_em", ">=", inicioDoDiaIso(filtro.de)),
        where("recebida_em", "<", inicioDoDiaIso(somarDias(filtro.ate, 1))),
      ),
    solicitacaoDoRelatorio,
  );

  const leituras = comSolicitacoes ? [oss, solicitacoes] : [oss];
  const estado = leituras.some((leitura) => leitura.erro) ? "erro" : !problema && leituras.some((leitura) => leitura.itens === null) ? "carregando" : "pronto";
  const todasAsOs = oss.itens ?? [];
  const todasAsSolicitacoes = solicitacoes.itens ?? [];
  const clientes = clientesDoPeriodo(todasAsOs, todasAsSolicitacoes);
  const doFiltro = doCliente(todasAsOs, filtro.cliente);
  const solicitacoesDoFiltro = doCliente(todasAsSolicitacoes, filtro.cliente);
  const tabela = problema || estado !== "pronto" ? null : tabelaDoRelatorio(relatorio, doFiltro, solicitacoesDoFiltro, filtro.agrupamento);
  let resumo: ResumoDoRelatorio | null = null;
  if (tabela && comSolicitacoes) {
    const [, recebidas, aceitas, recusadas, abertas] = tabela.total ?? [null, 0, 0, 0, 0];
    resumo = [
      { rotulo: "Recebidas", valor: String(recebidas ?? 0) },
      { rotulo: "Viraram demanda", valor: String(aceitas ?? 0) },
      { rotulo: "Recusadas", valor: String(recusadas ?? 0) },
      { rotulo: "Em aberto", valor: String(abertas ?? 0) },
    ];
  } else if (tabela) {
    resumo = resumoDasOsEmTexto(resumoDasOs(doFiltro));
  }

  return (
    <RelatoriosView
      relatorio={relatorio}
      filtro={filtro}
      clientes={clientes}
      estado={estado}
      problema={problema}
      resumo={resumo}
      tabela={tabela}
      acoes={{
        mudarFiltro: (mudanca) => setFiltro((atual) => ({ ...atual, ...mudanca })),
        exportar: () => {
          if (!tabela) return;
          baixarPlanilha(nomeDaPlanilha(relatorio, filtro), planilhaXlsx(RELATORIO_ROTULO[relatorio], tabela.colunas, linhasDaPlanilha(tabela)));
        },
        imprimir: () => window.print(),
      }}
    />
  );
}
