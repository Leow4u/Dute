import { CAMPO_SELECT, TelaDeRelatorios, dataBr, type NumeroDoResumo } from "@/components/relatorios/tela-de-relatorios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTA_RELATORIOS } from "@/lib/operacao/navegacao";
import {
  RELATORIOS_DA_OPERACAO,
  RELATORIO_ROTULO,
  type FiltroDoRelatorio,
  type RelatorioDaOperacao,
  type ResumoDasOs,
  type TabelaDoRelatorio,
} from "@/lib/operacao/relatorios";
import { cn } from "@/lib/utils";

/**
 * Relatórios da Operação (parte 4.8a; docs/mockups/Relatorios.dc.html): a
 * tela de relatórios comum (components/relatorios) com os relatórios da
 * Operação, o período, o cliente e o agrupamento. Sem valor.
 */

export function hrefDoRelatorio(relatorio: RelatorioDaOperacao): string {
  return relatorio === "periodo" ? ROTA_RELATORIOS : `${ROTA_RELATORIOS}?relatorio=${relatorio}`;
}

export type ResumoDoRelatorio = NumeroDoResumo[];

export type RelatoriosViewProps = {
  relatorio: RelatorioDaOperacao;
  filtro: FiltroDoRelatorio;
  clientes: ReadonlyArray<{ code: string; nome: string }>;
  estado: "carregando" | "erro" | "pronto";
  /** O que falta no filtro, ou null. */
  problema: string | null;
  resumo: ResumoDoRelatorio | null;
  tabela: TabelaDoRelatorio | null;
  acoes: {
    mudarFiltro: (mudanca: Partial<FiltroDoRelatorio>) => void;
    exportar: () => void;
    imprimir: () => void;
  };
};

/** Os números do período: as OS. */
export function resumoDasOsEmTexto(resumo: ResumoDasOs): ResumoDoRelatorio {
  return [
    { rotulo: "OS no período", valor: String(resumo.total) },
    { rotulo: "Concluídas", valor: String(resumo.concluidas) },
    { rotulo: "Canceladas", valor: String(resumo.canceladas) },
    { rotulo: "No prazo", valor: resumo.noPrazo === null ? "—" : `${resumo.noPrazo}%` },
  ];
}

function Filtros({ relatorio, filtro, clientes, acoes }: Pick<RelatoriosViewProps, "relatorio" | "filtro" | "clientes" | "acoes">) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="relatorio-de">De</Label>
        <Input id="relatorio-de" type="date" value={filtro.de} onChange={(event) => acoes.mudarFiltro({ de: event.target.value })} className="w-40" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="relatorio-ate">Até</Label>
        <Input id="relatorio-ate" type="date" value={filtro.ate} onChange={(event) => acoes.mudarFiltro({ ate: event.target.value })} className="w-40" />
      </div>
      <div className="grid min-w-52 gap-1.5">
        <Label htmlFor="relatorio-cliente">Cliente</Label>
        <select id="relatorio-cliente" value={filtro.cliente ?? ""} onChange={(event) => acoes.mudarFiltro({ cliente: event.target.value || null })} className={CAMPO_SELECT}>
          <option value="">Todos</option>
          {clientes.map((cliente) => (
            <option key={cliente.code} value={cliente.code}>
              {cliente.nome}
            </option>
          ))}
        </select>
      </div>
      {relatorio === "periodo" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="relatorio-agrupar">Agrupar</Label>
          <select
            id="relatorio-agrupar"
            value={filtro.agrupamento}
            onChange={(event) => acoes.mudarFiltro({ agrupamento: event.target.value === "mes" ? "mes" : "semana" })}
            className={cn(CAMPO_SELECT, "w-36")}
          >
            <option value="semana">Semana</option>
            <option value="mes">Mês</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

export function RelatoriosView({ relatorio, filtro, clientes, estado, problema, resumo, tabela, acoes }: RelatoriosViewProps) {
  const cliente = filtro.cliente ? (clientes.find((item) => item.code === filtro.cliente)?.nome ?? filtro.cliente) : null;
  return (
    <TelaDeRelatorios
      rotuloDaLista="Relatórios da Operação"
      relatorios={RELATORIOS_DA_OPERACAO.map((item) => ({ id: item, rotulo: RELATORIO_ROTULO[item], href: hrefDoRelatorio(item) }))}
      atual={relatorio}
      titulo={RELATORIO_ROTULO[relatorio]}
      subtitulo={[`${dataBr(filtro.de)} a ${dataBr(filtro.ate)}`, cliente].filter(Boolean).join(" · ")}
      filtros={<Filtros relatorio={relatorio} filtro={filtro} clientes={clientes} acoes={acoes} />}
      estado={estado}
      problema={problema}
      resumo={resumo}
      tabela={tabela}
      vazio={relatorio === "solicitacoes" ? "Nenhuma solicitação no período." : "Nenhuma OS no período."}
      acoes={acoes}
    />
  );
}
