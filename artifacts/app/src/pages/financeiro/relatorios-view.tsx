import { CAMPO_SELECT, TelaDeRelatorios, dataBr } from "@/components/relatorios/tela-de-relatorios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTA_RELATORIOS_DO_FINANCEIRO } from "@/lib/financeiro/navegacao";
import {
  RELATORIOS_DO_FINANCEIRO,
  RELATORIO_DO_FINANCEIRO_ROTULO,
  type FiltroDoFinanceiro,
  type RelatorioDoFinanceiro,
} from "@/lib/financeiro/relatorios";
import type { NumeroDoResumo, TabelaDeRelatorio } from "@/lib/relatorios";

/**
 * Relatórios do Financeiro (parte 4.8b; docs/mockups/Relatorios.dc.html): a
 * receita por cliente e por serviço (pergunta 26), as NFs emitidas por mês e
 * as contas a receber por idade, com Excel e PDF. Têm valor: só quem lê
 * preço abre a tela.
 */

export function hrefDoRelatorioDoFinanceiro(relatorio: RelatorioDoFinanceiro): string {
  return relatorio === "receita" ? ROTA_RELATORIOS_DO_FINANCEIRO : `${ROTA_RELATORIOS_DO_FINANCEIRO}?relatorio=${relatorio}`;
}

export type RelatoriosDoFinanceiroViewProps = {
  relatorio: RelatorioDoFinanceiro;
  filtro: FiltroDoFinanceiro;
  hoje: string;
  clientes: ReadonlyArray<{ code: string; nome: string }>;
  estado: "carregando" | "erro" | "pronto";
  problema: string | null;
  resumo: NumeroDoResumo[] | null;
  tabela: TabelaDeRelatorio | null;
  acoes: {
    mudarFiltro: (mudanca: Partial<FiltroDoFinanceiro>) => void;
    exportar: () => void;
    imprimir: () => void;
  };
};

export function RelatoriosDoFinanceiroView({ relatorio, filtro, hoje, clientes, estado, problema, resumo, tabela, acoes }: RelatoriosDoFinanceiroViewProps) {
  const cliente = filtro.cliente ? (clientes.find((item) => item.code === filtro.cliente)?.nome ?? filtro.cliente) : null;
  const posicao = relatorio === "a_receber";
  return (
    <TelaDeRelatorios
      rotuloDaLista="Relatórios do Financeiro"
      relatorios={RELATORIOS_DO_FINANCEIRO.map((item) => ({ id: item, rotulo: RELATORIO_DO_FINANCEIRO_ROTULO[item], href: hrefDoRelatorioDoFinanceiro(item) }))}
      atual={relatorio}
      titulo={RELATORIO_DO_FINANCEIRO_ROTULO[relatorio]}
      subtitulo={[posicao ? `Posição em ${dataBr(hoje)}` : `${dataBr(filtro.de)} a ${dataBr(filtro.ate)}`, cliente].filter(Boolean).join(" · ")}
      filtros={
        <div className="flex flex-wrap items-end gap-3">
          {posicao ? null : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="relatorio-de">De</Label>
                <Input id="relatorio-de" type="date" value={filtro.de} onChange={(event) => acoes.mudarFiltro({ de: event.target.value })} className="w-40" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="relatorio-ate">Até</Label>
                <Input id="relatorio-ate" type="date" value={filtro.ate} onChange={(event) => acoes.mudarFiltro({ ate: event.target.value })} className="w-40" />
              </div>
            </>
          )}
          <div className="grid min-w-52 gap-1.5">
            <Label htmlFor="relatorio-cliente">Cliente</Label>
            <select id="relatorio-cliente" value={filtro.cliente ?? ""} onChange={(event) => acoes.mudarFiltro({ cliente: event.target.value || null })} className={CAMPO_SELECT}>
              <option value="">Todos</option>
              {clientes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
      }
      estado={estado}
      problema={problema}
      resumo={resumo}
      tabela={tabela}
      vazio={relatorio === "receita" || relatorio === "servico" ? "Nenhum pagamento no período." : relatorio === "faturamento" ? "Nenhuma NF emitida no período." : "Nenhuma NF em aberto."}
      acoes={acoes}
    />
  );
}
