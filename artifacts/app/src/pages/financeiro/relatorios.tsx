import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { collection, query, where, type DocumentData } from "firebase/firestore";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { nomesDosClientes, pagamentoDaNf } from "@/lib/financeiro/faturas";
import { lerDocumento } from "@/lib/financeiro/ler-documento";
import {
  RELATORIO_DO_FINANCEIRO_ROTULO,
  clientesDasFaturas,
  doClienteDoFinanceiro,
  filtroInicialDoFinanceiro,
  fontesDoRateio,
  linhasDaPlanilhaDoFinanceiro,
  nfsDoPeriodo,
  nfsEmAberto,
  nomeDaPlanilhaDoFinanceiro,
  pagamentosDoPeriodo,
  problemaDoFiltroDoFinanceiro,
  receitaPorServico,
  relatorioDoFinanceiroDaBusca,
  resumoAReceber,
  resumoDaReceita,
  resumoDaReceitaPorServico,
  resumoDoFaturamento,
  tabelaAReceber,
  tabelaDaReceita,
  tabelaDaReceitaPorServico,
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
 * outras telas do Financeiro) e, na receita, os pagamentos do período. Por
 * serviço, também as RVs e as medições das NFs pagas, lidas uma vez, e o
 * serviço dos itens do catálogo quando há medição (pergunta 26). As regras
 * abrem tudo isso só a quem lê preço.
 */
export default function FinanceiroRelatorios() {
  const { user } = useAppUser();
  const relatorio = relatorioDoFinanceiroDaBusca(useSearch());
  const hoje = diaEmSaoPaulo(new Date());
  const [filtro, setFiltro] = useState<FiltroDoFinanceiro>(() => filtroInicialDoFinanceiro(hoje));
  const problema = problemaDoFiltroDoFinanceiro(relatorio, filtro);
  const leituraDasFaturas = useFaturas(user?.publicMetadata.role);
  const comPagamentos = (relatorio === "receita" || relatorio === "servico") && !problema;
  const pagamentos = useLeitura(
    comPagamentos ? `financeiro:relatorio-pagamentos:${filtro.de}:${filtro.ate}` : null,
    (db) => query(collection(db, "pagamentos"), where("recebido_em", ">=", filtro.de), where("recebido_em", "<=", filtro.ate)),
    pagamentoDaNf,
  );
  const faturas = leituraDasFaturas.faturas ?? [];
  const clientes = clientesDasFaturas(faturas);
  const doPeriodo = doClienteDoFinanceiro(pagamentos.itens ?? [], filtro.cliente);
  const validos = pagamentosDoPeriodo(doPeriodo, filtro.de, filtro.ate);

  // Por serviço: o que cada NF paga no período rateia, lido uma vez.
  const porServico = relatorio === "servico" && comPagamentos;
  const pagas = new Set(validos.map((pagamento) => pagamento.faturaId));
  const fontes = porServico ? fontesDoRateio(faturas.filter((fatura) => pagas.has(fatura.id))) : [];
  const lidas = useQueries({
    queries: fontes.map((fonte) => ({ queryKey: ["financeiro", "rateio", fonte.caminho], queryFn: () => lerDocumento(fonte.caminho), staleTime: 60_000, retry: 1 })),
  });
  const comCatalogo = fontes.some((fonte) => fonte.tipo === "medicoes");
  const catalogo = useLeitura(comCatalogo ? "financeiro:servicos-do-catalogo" : null, (db) => collection(db, "lpu_items"), (id, dados) =>
    typeof dados.servico === "string" && dados.servico.trim() ? { id, servico: dados.servico.trim() } : null,
  );

  const erro =
    leituraDasFaturas.falhas.length > 0 || (comPagamentos && pagamentos.erro) || lidas.some((lida) => lida.isError) || (comCatalogo && catalogo.erro);
  const carregando =
    leituraDasFaturas.carregando || (comPagamentos && pagamentos.itens === null) || lidas.some((lida) => lida.isPending) || (comCatalogo && catalogo.itens === null);
  const estado = erro ? "erro" : !problema && carregando ? "carregando" : "pronto";

  let tabela: TabelaDeRelatorio | null = null;
  let resumo: NumeroDoResumo[] | null = null;
  if (estado === "pronto" && !problema) {
    if (relatorio === "receita") {
      tabela = tabelaDaReceita(validos, nomesDosClientes(faturas));
      resumo = resumoDaReceita(validos, doPeriodo.filter((pagamento) => pagamento.estornado).length);
    } else if (relatorio === "servico") {
      const revisoes = new Map<string, DocumentData | null>();
      const medicoes = new Map<string, DocumentData | null>();
      fontes.forEach((fonte, indice) => (fonte.tipo === "revisoes" ? revisoes : medicoes).set(fonte.chave, lidas[indice]?.data ?? null));
      const servicoDoItem = new Map((catalogo.itens ?? []).map((item) => [item.id, item.servico]));
      const linhas = receitaPorServico(validos, faturas, { revisoes, medicoes, servicoDoItem });
      tabela = tabelaDaReceitaPorServico(linhas, validos.length);
      resumo = resumoDaReceitaPorServico(linhas, validos.length);
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
