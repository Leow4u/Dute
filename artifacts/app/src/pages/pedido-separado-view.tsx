import { useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { textoDaEtiqueta, textoDasAbertas, textoDasVazias, type CaixaVazia, type EtiquetaParaTrocar } from "@/lib/warehouse-ops/caixas-da-separacao";
import {
  conteudoDoVolume,
  nomeDoVolume,
  pesoDoVolume,
  resumoDosVolumes,
  textoVerVolumes,
  type VolumeDoPedido,
} from "@/lib/warehouse-ops/volumes-do-pedido";

/**
 * O pedido separado (separação com caixas, parte 4d;
 * docs/mockups/WmsSepararConcluido.dc.html): depois de "Confirmar separação",
 * a bancada do pedido mostra os volumes com o conteúdo de cada um, com
 * "Etiquetas dos volumes" (o lote, com "de 42") e "Romaneio"; as caixas que o
 * pedido abriu e ainda estão com a etiqueta velha, e as que ele esvaziou. Os
 * dados chegam por props (pages/pedidos-separar.tsx). Sem legenda.
 */

/** Quantos volumes a tela lista antes de "Ver os N volumes". */
const VOLUMES_A_VISTA = 12;

export type EstadoDosVolumesDoPedido = "carregando" | "erro" | "pronto";

const numero = new Intl.NumberFormat("pt-BR");

export function PedidoSeparadoView({
  numero: pedido,
  selo = "separado",
  resumo,
  estado,
  volumes,
  etiquetasDosVolumesHref,
  romaneioHref,
  etiquetaDoVolumeHref,
  etiquetas = [],
  etiquetasHref,
  vazias = [],
  onTentar,
}: {
  /** "PED-0001" */
  numero: string;
  /** "separado"; depois da entrega, "entregue". */
  selo?: string;
  /** "BTG Pactual · 116 itens · 3.335 un. · 42 volumes · lacre 88231 · Para quando Seg 16/11 11:36" */
  resumo: string;
  estado: EstadoDosVolumesDoPedido;
  volumes: readonly VolumeDoPedido[];
  /** O lote das etiquetas, com o total. */
  etiquetasDosVolumesHref: string | null;
  romaneioHref: string | null;
  etiquetaDoVolumeHref?: (volume: VolumeDoPedido) => string | null;
  /** As caixas que o pedido abriu e que estão com a etiqueta velha. */
  etiquetas?: readonly EtiquetaParaTrocar[];
  etiquetasHref?: string | null;
  /** As caixas que o pedido esvaziou. */
  vazias?: readonly CaixaVazia[];
  /** Lê os volumes de novo (a leitura ao vivo): "Tentar de novo" na demora, na desistência e na falha. */
  onTentar?: () => Promise<unknown>;
}) {
  const [todos, setTodos] = useState(false);
  const visiveis = todos ? volumes : volumes.slice(0, VOLUMES_A_VISTA);
  const comVolumes = estado === "pronto" && volumes.length > 0;
  const comLateral = etiquetas.length > 0 || vazias.length > 0;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href="/pedidos" aria-label="Voltar a Pedidos">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-extrabold tracking-tight text-foreground">
              {pedido}
              <Badge variant="outline" className="border-success-soft-border bg-success-soft text-success-soft-foreground">
                {selo}
              </Badge>
            </h1>
            {resumo ? <p className="mt-0.5 text-sm text-muted-foreground">{resumo}</p> : null}
          </div>
        </div>
        {comVolumes ? (
          <div className="flex flex-wrap items-center gap-2">
            {etiquetasDosVolumesHref ? (
              <Button asChild variant="outline">
                <Link href={etiquetasDosVolumesHref}>Etiquetas dos volumes</Link>
              </Button>
            ) : null}
            {romaneioHref ? (
              <Button asChild>
                <Link href={romaneioHref}>
                  <Printer className="size-4" aria-hidden="true" />
                  Romaneio
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className={comLateral ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_372px] lg:items-start" : undefined}>
        <section aria-labelledby="volumes-do-pedido" className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-baseline gap-2.5 border-b border-border bg-muted/40 px-4 py-3 md:px-5">
            <h2 id="volumes-do-pedido" className="text-base font-extrabold text-foreground">
              Volumes
            </h2>
            {comVolumes ? <span className="text-sm font-semibold text-muted-foreground">{resumoDosVolumes(volumes)}</span> : null}
          </div>
          {/* A primeira leitura é a espera em bloco do carregamento v2 (parte 13c), no lugar do "Carregando" seco, com a
              saída da leitura ao vivo, que relê: "Tentar de novo" aos 10 s e a desistência aos 70 s. */}
          {estado === "carregando" ? (
            <CarregandoNaRegiao rotulo="Carregando volumes…" onTentar={onTentar} className="px-5 py-6" />
          ) : estado !== "pronto" && onTentar ? (
            <FalhaNaLeitura leitura={{ error: null, refetch: onTentar }} mensagem="Não foi possível carregar os volumes." className="rounded-none border-0" />
          ) : estado !== "pronto" ? (
            <p role="alert" className="px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
              Não foi possível carregar os volumes.
            </p>
          ) : !volumes.length ? (
            <p className="px-5 py-7 text-center text-sm font-semibold text-muted-foreground">Nenhum volume</p>
          ) : (
            <>
              <ul>
                {visiveis.map((volume) => {
                  const href = etiquetaDoVolumeHref?.(volume) ?? null;
                  const conteudo = conteudoDoVolume(volume);
                  return (
                    <li key={volume.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-4 py-2 first:border-t-0 md:px-5">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                          {nomeDoVolume(volume.numero)}
                          {/* A caixa que saiu inteira e virou o volume: só a equipe a vê. */}
                          {volume.caixa ? <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">{volume.caixa}</span> : null}
                        </p>
                        {conteudo ? <p className="truncate text-xs text-muted-foreground">{conteudo}</p> : null}
                      </div>
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums text-foreground">
                        {[`${numero.format(volume.unidades)} un.`, pesoDoVolume(volume.pesoKg)].filter(Boolean).join(" · ")}
                      </span>
                      {href ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={href} aria-label={`Etiqueta do volume ${volume.numero}`}>
                            Etiqueta
                          </Link>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {!todos && volumes.length > VOLUMES_A_VISTA ? (
                <div className="border-t border-border/60 px-4 py-2 md:px-5">
                  <Button type="button" variant="link" className="h-auto px-0" onClick={() => setTodos(true)}>
                    {textoVerVolumes(volumes.length)}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>

        {comLateral ? (
          <div className="flex flex-col gap-5">
            {etiquetas.length ? (
              <section aria-labelledby="etiquetas-para-trocar" className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="min-w-0">
                    <h2 id="etiquetas-para-trocar" className="text-base font-extrabold text-foreground">
                      Etiquetas para trocar
                    </h2>
                    <p className="text-xs font-semibold text-muted-foreground">{textoDasAbertas(etiquetas.length)}</p>
                  </div>
                  {etiquetasHref ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={etiquetasHref}>Imprimir etiquetas</Link>
                    </Button>
                  ) : null}
                </div>
                <ul>
                  {etiquetas.map((etiqueta) => (
                    <li key={etiqueta.code} className="border-t border-border/60 px-4 py-2.5 first:border-t-0">
                      <p className="font-mono text-sm font-bold text-foreground">{etiqueta.code}</p>
                      <p className="text-xs text-muted-foreground">{textoDaEtiqueta(etiqueta)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {vazias.length ? (
              <section aria-labelledby="caixas-vazias" className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted/40 px-4 py-3">
                  <h2 id="caixas-vazias" className="text-base font-extrabold text-foreground">
                    Caixas vazias
                  </h2>
                  <p className="text-xs font-semibold text-muted-foreground">{textoDasVazias(vazias.length)}</p>
                </div>
                <ul className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3">
                  {vazias.map((caixa) => (
                    <li key={caixa.code} className="whitespace-nowrap rounded-md bg-muted px-2 py-1.5 font-mono text-xs font-medium text-foreground">
                      {[caixa.code, caixa.posicao].filter(Boolean).join(" · ")}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
