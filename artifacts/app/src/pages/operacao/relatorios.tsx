import { useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { MEMORIA_LIBERADA } from "@/lib/liberacao";
import { RELATORIO_DO_ACERTO, ROTULO_DO_ACERTO, resumoDoAcerto, sugestaoDoAcerto, tabelaDoAcerto, veAcerto } from "@/lib/memoria/acerto";
import { useLeitura } from "@/lib/operacao/leitura";
import {
  RELATORIOS_DA_OPERACAO,
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

import { RelatoriosView, resumoDasOsEmTexto, type RelatorioDaTela, type ResumoDoRelatorio } from "./relatorios-view";

/**
 * /operacao/relatorios: lê as OS agendadas no período (`janela.data`) e, no
 * relatório do portal, as solicitações recebidas nele. As regras abrem a
 * leitura a quem coordena a Operação; nada aqui lê valor. No acerto da
 * memória (parte 5.6, só owner e admin onde a memória roda), as sugestões de
 * duração criadas no período.
 */
export default function OperacaoRelatorios() {
  const busca = useSearch();
  const { user } = useAppUser();
  const comAcerto = veAcerto(user?.publicMetadata.role, MEMORIA_LIBERADA);
  const pediuAcerto = comAcerto && new URLSearchParams(busca).get("relatorio") === RELATORIO_DO_ACERTO;
  const relatorio: RelatorioDaTela = pediuAcerto ? RELATORIO_DO_ACERTO : relatorioDaBusca(busca);
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

  const sugestoes = useLeitura(
    periodo && pediuAcerto ? `relatorio-acerto:${periodo}` : null,
    (db) =>
      query(
        collection(db, "ai_suggestions"),
        where("criada_em", ">=", inicioDoDiaIso(filtro.de)),
        where("criada_em", "<", inicioDoDiaIso(somarDias(filtro.ate, 1))),
      ),
    sugestaoDoAcerto,
  );

  const leituras = comSolicitacoes ? [oss, solicitacoes] : pediuAcerto ? [oss, sugestoes] : [oss];
  const estado = leituras.some((leitura) => leitura.erro) ? "erro" : !problema && leituras.some((leitura) => leitura.itens === null) ? "carregando" : "pronto";
  const todasAsOs = oss.itens ?? [];
  const todasAsSolicitacoes = solicitacoes.itens ?? [];
  const todasAsSugestoes = sugestoes.itens ?? [];
  const daOs = clientesDoPeriodo(todasAsOs, todasAsSolicitacoes);
  // O cliente da sugestão sem OS no período entra pelo código.
  const clientes = [...daOs, ...[...new Set(todasAsSugestoes.map((sugestao) => sugestao.customerCode))].filter((code) => !daOs.some((cliente) => cliente.code === code)).map((code) => ({ code, nome: code }))];
  const nomeDoCliente = (code: string) => clientes.find((cliente) => cliente.code === code)?.nome ?? code;
  const doFiltro = doCliente(todasAsOs, filtro.cliente);
  const solicitacoesDoFiltro = doCliente(todasAsSolicitacoes, filtro.cliente);
  const sugestoesDoFiltro = doCliente(todasAsSugestoes, filtro.cliente);
  const tabela =
    problema || estado !== "pronto"
      ? null
      : relatorio === RELATORIO_DO_ACERTO
        ? tabelaDoAcerto(sugestoesDoFiltro, nomeDoCliente)
        : tabelaDoRelatorio(relatorio, doFiltro, solicitacoesDoFiltro, filtro.agrupamento);
  let resumo: ResumoDoRelatorio | null = null;
  if (tabela && relatorio === RELATORIO_DO_ACERTO) {
    resumo = resumoDoAcerto(sugestoesDoFiltro);
  } else if (tabela && comSolicitacoes) {
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
      relatorios={comAcerto ? [...RELATORIOS_DA_OPERACAO, RELATORIO_DO_ACERTO] : RELATORIOS_DA_OPERACAO}
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
          const rotulo = relatorio === RELATORIO_DO_ACERTO ? ROTULO_DO_ACERTO : RELATORIO_ROTULO[relatorio];
          baixarPlanilha(nomeDaPlanilha(relatorio, filtro), planilhaXlsx(rotulo, tabela.colunas, linhasDaPlanilha(tabela)));
        },
        imprimir: () => window.print(),
      }}
    />
  );
}
