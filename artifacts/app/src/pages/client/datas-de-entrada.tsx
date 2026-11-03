import { useId } from "react";

/**
 * As datas de entrada do item no detalhe do produto do portal
 * (docs/plataforma/fifo-por-data.md, seção 3.3, parte 5; tela em
 * docs/mockups/PortalEstoqueDatas.dc.html): uma linha por dia, só do que está
 * nas prateleiras, sem prateleira nem caixa. "desde" é o dia em que as peças
 * entraram, não o "sem movimento há N dias" do aviso de itens parados. O que
 * está em recebimento segue no "Em recebimento", sem data.
 */

/** `desde` é o dia "AAAA-MM-DD" em São Paulo; null é o que as entradas não cobrem. */
export type DataDeEntrada = { desde: string | null; pecas: number };

const numero = new Intl.NumberFormat("pt-BR");

/** "2026-10-22" vira "22/10/2026", sem passar por fuso. */
export function diaEmTexto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

export function pecasEmTexto(pecas: number): string {
  return `${numero.format(pecas)} ${pecas === 1 ? "peça" : "peças"}`;
}

export function DatasDeEntrada({ datas }: { datas: readonly DataDeEntrada[] }) {
  const titulo = useId();
  if (!datas.length) return null;
  return (
    <section aria-labelledby={titulo} className="rounded-lg border border-border bg-card p-3">
      <h3 id={titulo} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Por data de entrada
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {datas.map((data) => (
          <li key={data.desde ?? "sem-data"} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-foreground">{data.desde ? `desde ${diaEmTexto(data.desde)}` : "sem data"}</span>
            <span className="font-semibold tabular-nums text-foreground">{pecasEmTexto(data.pecas)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** As datas do item do cliente, pelo getStockDates; o que não é uma data válida fica de fora. */
export async function buscarDatasDeEntrada(sku: string): Promise<DataDeEntrada[]> {
  const resposta = await fetch(`/api/client/inventory/dates/${encodeURIComponent(sku)}`);
  if (!resposta.ok) throw new Error("Não consegui carregar as datas de entrada.");
  const corpo = (await resposta.json()) as { datas?: unknown };
  return Array.isArray(corpo.datas) ? corpo.datas.filter(ehDataDeEntrada) : [];
}

function ehDataDeEntrada(valor: unknown): valor is DataDeEntrada {
  if (!valor || typeof valor !== "object") return false;
  const { desde, pecas } = valor as { desde?: unknown; pecas?: unknown };
  return (
    (desde === null || (typeof desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(desde))) &&
    typeof pecas === "number" &&
    Number.isFinite(pecas) &&
    pecas > 0
  );
}
