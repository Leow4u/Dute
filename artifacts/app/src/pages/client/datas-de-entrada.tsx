import { useId } from "react";

import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { datasValidas, desdeEmTexto, pecasEmTexto, type DataDeEntrada } from "@/lib/datas-de-entrada";

export { diaEmTexto, pecasEmTexto, type DataDeEntrada } from "@/lib/datas-de-entrada";

/**
 * A leitura das datas (carregamento v2, parte 13f): lendo, a seção fica com a
 * espera; na falha, com a frase e "Tentar de novo". Nunca some nem parece o
 * item sem data.
 */
export type LeituraDasDatas = {
  lendo: boolean;
  falhou: boolean;
  /** A leitura lê agora (a nova tentativa). */
  tentando: boolean;
  /** Relê; a promessa diz quando a tentativa pedida acabou. */
  onTentar: () => unknown;
  /** Relê do zero a leitura presa (a demora dos 10 s e a desistência dos 70 s). */
  onTentarDoZero?: () => void;
};

/**
 * As datas de entrada do item no detalhe do produto do portal
 * (docs/plataforma/fifo-por-data.md, seção 3.3, parte 5; tela em
 * docs/mockups/PortalEstoqueDatas.dc.html): uma linha por dia, só do que está
 * nas prateleiras, sem prateleira nem caixa. "desde" é o dia em que as peças
 * entraram, não o "sem movimento há N dias" do aviso de itens parados. O que
 * está em recebimento segue no "Em recebimento", sem data. Lidas e sem
 * nenhuma, a seção não aparece.
 */
export function DatasDeEntrada({ datas, leitura }: { datas: readonly DataDeEntrada[]; leitura?: LeituraDasDatas }) {
  const titulo = useId();
  const lendo = Boolean(leitura?.lendo);
  const falhou = Boolean(leitura?.falhou);
  if (!datas.length && !lendo && !falhou) return null;
  return (
    <section aria-labelledby={titulo} className="rounded-lg border border-border bg-card p-3">
      <h3 id={titulo} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Por data de entrada
      </h3>
      {falhou && leitura ? (
        <FalhaNaSecao
          mensagem="Não foi possível carregar as datas de entrada."
          tentando={leitura.tentando}
          onTentar={leitura.onTentar}
          className="mt-2"
        />
      ) : lendo ? (
        <CarregandoNaRegiao rotulo="Carregando as datas…" onTentar={leitura?.onTentarDoZero} className="mt-2" />
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {datas.map((data) => (
            <li key={data.desde ?? "sem-data"} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-foreground">{desdeEmTexto(data.desde)}</span>
              <span className="font-semibold tabular-nums text-foreground">{pecasEmTexto(data.pecas)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** As datas do item do cliente, pelo getStockDates; o que não é uma data válida fica de fora. */
export async function buscarDatasDeEntrada(sku: string): Promise<DataDeEntrada[]> {
  const resposta = await fetch(`/api/client/inventory/dates/${encodeURIComponent(sku)}`);
  if (!resposta.ok) throw new Error("Não consegui carregar as datas de entrada.");
  const corpo = (await resposta.json()) as { datas?: unknown };
  return datasValidas(corpo.datas);
}
