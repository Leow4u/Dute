import { useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { nomesDosClientes, pagamentoDaNf } from "@/lib/financeiro/faturas";
import {
  RELATORIO_DO_FINANCEIRO_ROTULO,
  clientesDasFaturas,
  doClienteDoFinanceiro,
  filtroInicialDoFinanceiro,
  linhasDaPlanilhaDoFinanceiro,
  nfsDoPeriodo,
  nfsEmAberto,
  nomeDaPlanilhaDoFinanceiro,
  pagamentosDoPeriodo,
  problemaDoFiltroDoFinanceiro,
  relatorioDoFinanceiroDaBusca,
  resumoAReceber,
  resumoDaReceita,
  resumoDoFaturamento,
  tabelaAReceber,
  tabelaDaReceita,
  tabelaDoFaturamento,
  type FiltroDoFinanceiro,
} from "@/lib/financeiro/relatorios";
import { useFaturas } from "@/lib/financeiro/use-faturas";
import { useLeitura } from "@/lib/operacao/leitura";
import { diaEmSaoPaulo } from "@/lib/operacao/relatorios";
import { baixarPlanilha, planilhaXlsx } from "@/lib/planilha-xlsx";
import type { NumeroDoResumo, TabelaDeRelatorio } from "@/lib/relatorios";

import { RelatoriosDoFinanceiroView } from "./relatorios-view";

/**
 * /financeiro/relatorios: as NFs registradas (`faturas`, ao vivo, como nas
 * outras telas do Financeiro) e, na receita, os pagamentos do período. As
 * regras abrem as duas coleções só a quem lê preço.
 */
export default function FinanceiroRelatorios() {
  const { user } = useAppUser();
  const relatorio = relatorioDoFinanceiroDaBusca(useSearch());
  const hoje = diaEmSaoPaulo(new Date());
  const [filtro, setFiltro] = useState<FiltroDoFinanceiro>(() => filtroInicialDoFinanceiro(hoje));
  const problema = problemaDoFiltroDoFinanceiro(relatorio, filtro);
  const leituraDasFaturas = useFaturas(user?.publicMetadata.role);
  const comPagamentos = relatorio === "receita" && !problema;
  const pagamentos = useLeitura(
    comPagamentos ? `financeiro:relatorio-pagamentos:${filtro.de}:${filtro.ate}` : null,
    (db) => query(collection(db, "pagamentos"), where("recebido_em", ">=", filtro.de), where("recebido_em", "<=", filtro.ate)),
    pagamentoDaNf,
  );

  const erro = leituraDasFaturas.falhas.length > 0 || (comPagamentos && pagamentos.erro);
  const carregando = leituraDasFaturas.carregando || (comPagamentos && pagamentos.itens === null);
  const estado = erro ? "erro" : !problema && carregando ? "carregando" : "pronto";
  const faturas = leituraDasFaturas.faturas ?? [];
  const clientes = clientesDasFaturas(faturas);

  let tabela: TabelaDeRelatorio | null = null;
  let resumo: NumeroDoResumo[] | null = null;
  if (estado === "pronto" && !problema) {
    if (relatorio === "receita") {
      const doPeriodo = doClienteDoFinanceiro(pagamentos.itens ?? [], filtro.cliente);
      const validos = pagamentosDoPeriodo(doPeriodo, filtro.de, filtro.ate);
      tabela = tabelaDaReceita(validos, nomesDosClientes(faturas));
      resumo = resumoDaReceita(validos, doPeriodo.filter((pagamento) => pagamento.estornado).length);
    } else if (relatorio === "faturamento") {
      const nfs = nfsDoPeriodo(doClienteDoFinanceiro(faturas, filtro.cliente), filtro.de, filtro.ate);
      tabela = tabelaDoFaturamento(nfs);
      resumo = resumoDoFaturamento(nfs);
    } else {
      const abertas = nfsEmAberto(doClienteDoFinanceiro(faturas, filtro.cliente));
      tabela = tabelaAReceber(abertas, hoje);
      resumo = resumoAReceber(abertas, hoje);
    }
  }

  return (
    <RelatoriosDoFinanceiroView
      relatorio={relatorio}
      filtro={filtro}
      hoje={hoje}
      clientes={clientes}
      estado={estado}
      problema={problema}
      resumo={resumo}
      tabela={tabela}
      acoes={{
        mudarFiltro: (mudanca) => setFiltro((atual) => ({ ...atual, ...mudanca })),
        exportar: () => {
          if (!tabela) return;
          baixarPlanilha(
            nomeDaPlanilhaDoFinanceiro(relatorio, filtro, hoje),
            planilhaXlsx(RELATORIO_DO_FINANCEIRO_ROTULO[relatorio], tabela.colunas, linhasDaPlanilhaDoFinanceiro(tabela)),
          );
        },
        imprimir: () => window.print(),
      }}
    />
  );
}
