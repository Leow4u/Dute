import type { ReactNode } from "react";

import { textoDoComeco, unidadesComSinal, type RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { periodoDaRodada } from "@/lib/warehouse-ops/rodadas-da-contagem";

const numero = new Intl.NumberFormat("pt-BR");

/**
 * O cartão da rodada: o nome, quando começou e quem, os quatro números
 * (prateleiras e caixas contadas do total, caixas com diferença, diferença
 * líquida) e a barra do progresso pelas caixas. É o cabeçalho da Contagem por
 * caixa (`h2`, o padrão) e o "Em andamento" da entrada da Contagem (`h3`, com
 * a fila de ações "Continuar" e "Ver prateleiras" entre os números e a barra;
 * desenho de 18/11/2026). Sem legenda.
 */
export function CartaoDaRodada({
  rodada,
  agora,
  id = "rodada-titulo",
  titulo: Titulo = "h2",
  acoes,
}: {
  rodada: RodadaDaContagem;
  /** O dia da tela: o começo de outro dia sai com o dia ("começou 17/11 08:10"). */
  agora: Date;
  /** O id do título, para o aria-labelledby da seção. */
  id?: string;
  /** O nível do título: h2 na rodada, h3 dentro de "Em andamento" na entrada. */
  titulo?: "h2" | "h3";
  /** A fila de ações entre os números e a barra. */
  acoes?: ReactNode;
}) {
  const percentual = rodada.caixas ? Math.round((rodada.caixasConfirmadas / rodada.caixas) * 100) : 0;
  const numeros: Array<{ valor: string; de?: string; rotulo: string }> = [
    { valor: numero.format(rodada.prateleirasContadas), de: `de ${numero.format(rodada.prateleiras)}`, rotulo: "prateleiras" },
    { valor: numero.format(rodada.caixasConfirmadas), de: `de ${numero.format(rodada.caixas)}`, rotulo: "caixas" },
    { valor: numero.format(rodada.caixasComDiferenca), rotulo: "caixas com diferença" },
    { valor: unidadesComSinal(rodada.diferenca), rotulo: "diferença líquida" },
  ];
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0">
          <Titulo id={id} className="text-base font-extrabold text-foreground">
            {rodada.titulo}
          </Titulo>
          {rodada.concluida ? (
            // A rodada concluída (o "Ver" das anteriores): o período e quem concluiu, no lugar do começo.
            <p className="text-sm text-muted-foreground">{periodoDaRodada({ inicio: rodada.comeco, fim: rodada.concluida })}</p>
          ) : rodada.comeco ? (
            <p className="text-sm text-muted-foreground">{textoDoComeco(rodada.comeco, agora)}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:ml-auto">
          {numeros.map((item) => (
            <div key={item.rotulo} className="flex flex-col-reverse lg:text-right">
              <dt className="text-xs font-semibold text-muted-foreground">{item.rotulo}</dt>
              <dd className="text-2xl font-extrabold tabular-nums text-foreground">
                {item.valor}
                {item.de ? <span className="ml-1 text-sm font-bold text-muted-foreground">{item.de}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {acoes ? (
        <div data-acoes-da-rodada="" className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3">
          {acoes}
        </div>
      ) : null}
      <div aria-hidden="true" className="h-1.5 bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${percentual}%` }} />
      </div>
    </section>
  );
}
