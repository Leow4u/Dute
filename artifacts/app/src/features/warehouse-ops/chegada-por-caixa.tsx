import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareWarning } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { cn } from "@/lib/utils";
import { boxDraftToPayload, emptyBoxDraft, formatBoxDimensions, type BoxDraft, type SlottingCandidate } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import { type TaskQueueEntry, type WarehouseTask, type WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { situacaoDaChegada } from "@/lib/warehouse-ops/receiving";
import {
  MOTIVO_DA_FALTA,
  bloqueiosDaTela,
  concluirEntradaPorCaixa,
  confirmarDestino,
  desmarcarFalta,
  emTresCasas,
  esperaJustificativa,
  estadoDaCaixa,
  fecharCaixa,
  iniciarCaixa,
  lancarNaCaixa,
  marcarFalta,
  reabrirCaixa,
  recusarSugestao,
  removerCaixa,
  situacaoDaLinha,
  sugerirPrateleira,
  totaisDaChegada,
  type FaltaMarcada,
  type CaixaDaChegada,
  type EstadoDaCaixa,
  type SituacaoDaLinha,
} from "@/lib/wms/caixas-do-recebimento";

import {
  DestinoDaCaixa,
  RecusaDaPrateleira,
  destinoVazio,
  seloDaCaixaFechada,
  sugestaoDoConfirmar,
  type DestinoDaCaixaEstado,
  type DestinoDaCaixaProps,
  type ModoDoDestino,
} from "./destino-da-caixa";
import { FaltaDaLinha } from "./falta-da-linha";
import { eligibleShelfPositions } from "./shelf-picker";

/**
 * A ficha da chegada por caixa, na bancada (docs/plataforma/recebimento-com-caixas.md,
 * parte 5b; mockups WmsRecebimentoCaixa e WmsRecebimentoFecharCaixa, aprovados
 * em 03/11/2026): iniciar a caixa, lançar as linhas da NF que estão nela,
 * fechar com as medidas e o peso, reabrir e remover. Fechar e a caixa
 * fechada abrem a vista da caixa, como no mockup WmsRecebimentoFecharCaixa,
 * com o destino da caixa fechada (parte 5c, destino-da-caixa.tsx). Nas
 * linhas da NF, marcar e desmarcar a falta, a justificativa da divergência e
 * "Concluir entrada" (parte 5d; mockups WmsRecebimentoFalta e
 * WmsRecebimentoConcluir).
 */

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const metrosCubicos = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const TOM_DO_SELO: Record<EstadoDaCaixa["tom"], string> = {
  amb: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  grn: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  mut: "border-border bg-muted text-muted-foreground",
};

function receiptIdOf(task: WarehouseTask) {
  return task.reference || task.id.replace(/^receiving:/, "");
}

/** "XG 29 · GG 12 · 41 un.": o que está na caixa, pelo tamanho ou pelo código. */
export function conteudoDaCaixa(caixa: CaixaDaChegada): string {
  const partes = caixa.lines.map((linha) => `${linha.size || linha.client_item_code || linha.sku_code} ${numero.format(linha.counted_qty)}`);
  return [...partes, `${numero.format(caixa.unit_count)} un.`].join(" · ");
}

function medidasDaCaixa(caixa: CaixaDaChegada): string | null {
  if (caixa.length_m == null || caixa.width_m == null || caixa.height_m == null) return null;
  return formatBoxDimensions({
    length_m: caixa.length_m,
    width_m: caixa.width_m,
    height_m: caixa.height_m,
    gross_weight_kg: caixa.gross_weight_kg,
  });
}

/** O selo da situação da linha da NF (o "Físico" derivado da parte 5). */
function SeloDaLinha({ situacao }: { situacao: SituacaoDaLinha }) {
  if (situacao.tipo === "ok") {
    return <Badge variant="outline" className={TOM_DO_SELO.grn}>OK</Badge>;
  }
  if (situacao.tipo === "falta_marcada") {
    return (
      <Badge variant="outline" className="border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground">
        falta marcada · {numero.format(situacao.quantidade)}
      </Badge>
    );
  }
  const texto = situacao.tipo === "sobram" ? `sobram ${numero.format(situacao.quantidade)}` : `faltam ${numero.format(situacao.quantidade)}`;
  return <Badge variant="outline" className={TOM_DO_SELO.amb}>{texto}</Badge>;
}

export type RascunhoDoFechamento = BoxDraft & { tombar: boolean; empilhar: boolean };

export function rascunhoVazio(): RascunhoDoFechamento {
  return { ...emptyBoxDraft(), tombar: false, empilhar: false };
}

export type FichaDaChegadaPorCaixaProps = {
  task: WarehouseTask;
  caixas: CaixaDaChegada[];
  selecionada: string | null;
  /** Quantidades digitadas e ainda não lançadas, por linha da NF da caixa selecionada. */
  quantidades: Record<string, string>;
  busca: string;
  fechando: boolean;
  rascunho: RascunhoDoFechamento;
  ocupado: boolean;
  /** Quem só consulta (o suporte) vê as caixas e as linhas, sem as ações. */
  podeOperar: boolean;
  podeRegistrarDivergencia: boolean;
  onSelecionar: (code: string) => void;
  onIniciar: () => void;
  onBusca: (valor: string) => void;
  onAdicionar: () => void;
  onQuantidade: (itemId: string, valor: string) => void;
  onLancar: (itemId: string) => void;
  onAbrirFechamento: () => void;
  onRascunho: (rascunho: RascunhoDoFechamento) => void;
  onFechar: () => void;
  onCancelarFechamento: () => void;
  onReabrir: () => void;
  onRemover: () => void;
  onVoltar: () => void;
  onRegistrarDivergencia: () => void;
  /** O destino da caixa fechada (parte 5c). */
  destino: DestinoDaCaixaEstado;
  /** A prateleira do "Não cabe aqui" aberto, se houver. */
  recusando: string | null;
  onDestino: Omit<DestinoDaCaixaProps, "estado" | "ocupado">;
  onCancelarRecusa: () => void;
  onRecusar: (motivo: string) => void;
  /** A justificativa da divergência, digitada (parte 5d). */
  justificativa: string;
  onJustificativa: (valor: string) => void;
  onConcluir: () => void;
  /** A linha da NF do "Marcar falta" aberto, se houver. */
  marcando: string | null;
  onMarcarFalta: (itemId: string) => void;
  onCancelarFalta: () => void;
  onConfirmarFalta: (marca: { motivo: FaltaMarcada["reason"]; detalhe: string }) => void;
  onDesmarcarFalta: (itemId: string) => void;
};

function tituloDaChegada(task: WarehouseTask) {
  return task.receipt_number || task.title || receiptIdOf(task);
}

/** Centímetros e quilos da caixa já fechada, no formato que a tela digita. */
export function rascunhoDaCaixa(caixa: CaixaDaChegada): RascunhoDoFechamento {
  const centimetros = (metros: number | null) => (metros == null ? "" : numero.format(Math.round(metros * 1000) / 10));
  return {
    length_cm: centimetros(caixa.length_m),
    width_cm: centimetros(caixa.width_m),
    height_cm: centimetros(caixa.height_m),
    weight_kg: caixa.gross_weight_kg == null ? "" : numero.format(caixa.gross_weight_kg),
    content: "",
    tombar: caixa.allow_tilt,
    empilhar: caixa.allow_stacking,
  };
}

/** A caixa que abre a vista dela: a que está sendo fechada e a fechada sem destino. */
function caixaEmVista(caixa: CaixaDaChegada | null, fechando: boolean) {
  if (!caixa) return null;
  return (caixa.status === "counting" && fechando) || caixa.status === "reviewed" ? caixa : null;
}

/** O corpo da ficha, sem as chamadas: o estado e as ações vêm de fora. */
export function FichaDaChegadaPorCaixaConteudo(props: FichaDaChegadaPorCaixaProps) {
  const { task, caixas, selecionada } = props;
  const caixa = caixas.find((candidata) => candidata.code === selecionada) ?? null;
  const emVista = caixaEmVista(caixa, props.fechando);

  return (
    <div className="@container flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground">Recebimento</Badge>
        <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{situacaoDaChegada(task)}</Badge>
        <Badge variant="outline" className="border-info-soft-border bg-info-soft text-info-soft-foreground">por caixa</Badge>
        {emVista ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={props.onVoltar}>
            <ArrowLeft data-icon="inline-start" />
            Voltar à chegada
          </Button>
        ) : null}
      </div>
      {emVista ? <VistaDaCaixa {...props} caixa={emVista} /> : <VistaDaChegada {...props} caixa={caixa} />}
    </div>
  );
}

/** A chegada: as caixas, a caixa em conferência e as linhas da NF (mockup WmsRecebimentoCaixa). */
function VistaDaChegada(props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada | null }) {
  const { task, caixas, caixa, selecionada, ocupado } = props;
  const itens = task.items ?? [];
  const linhas = itens.map((item) => ({ ...item, id: item.id ?? "" }));
  const totais = totaisDaChegada(linhas);
  const detalhe = [task.invoice_number ? `NF ${task.invoice_number}` : null, `${numero.format(totais.esperado)} un.`].filter(Boolean).join(" · ");
  const bloqueios = bloqueiosDaTela(caixas, linhas, props.justificativa);
  // A justificativa entra quando só falta ela; o que já foi digitado não some (mockup WmsRecebimentoConcluir).
  const justificar = props.podeOperar && (esperaJustificativa(caixas, linhas) || Boolean(props.justificativa));
  const marcando = props.marcando ? itens.find((item) => item.id === props.marcando) ?? null : null;
  const totaisAVista = [
    { rotulo: "Esperado", valor: totais.esperado },
    { rotulo: "Em caixas", valor: totais.emCaixas },
    ...(totais.semCaixa > 0 || totais.faltaMarcada === 0 ? [{ rotulo: "Sem caixa", valor: totais.semCaixa }] : []),
    ...(totais.faltaMarcada > 0 ? [{ rotulo: "Falta marcada", valor: totais.faltaMarcada }] : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-extrabold tracking-tight">{tituloDaChegada(task)}</h2>
        <span className="text-sm text-muted-foreground">{detalhe}</span>
      </div>
      {props.podeRegistrarDivergencia || props.podeOperar ? (
        <div className="flex flex-wrap items-center gap-2">
          {props.podeRegistrarDivergencia ? (
            <Button type="button" variant="outline" onClick={props.onRegistrarDivergencia}>
              <MessageSquareWarning data-icon="inline-start" />
              Registrar divergência
            </Button>
          ) : null}
          {props.podeOperar ? (
            <>
              <Button type="button" disabled={ocupado || bloqueios.length > 0} onClick={props.onConcluir}>
                Concluir entrada
              </Button>
              {bloqueios.length ? <span className="text-sm text-muted-foreground">{bloqueios.join(" · ")}</span> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/* Duas colunas só quando a ficha tem largura para elas; estreita, as caixas vêm antes das linhas. */}
      <div className="grid min-w-0 gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <section aria-labelledby="caixas-da-chegada" className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 id="caixas-da-chegada" className="text-base font-extrabold">Caixas da chegada</h3>
            {props.podeOperar ? (
              <Button type="button" size="sm" variant="secondary" disabled={ocupado} onClick={props.onIniciar}>
                Iniciar caixa
              </Button>
            ) : null}
          </div>
          {caixas.map((item) => {
            const estado = estadoDaCaixa(item);
            const medidas = medidasDaCaixa(item);
            const destino = item.status === "committing" || item.status === "stored" ? item.location_id : "";
            return (
              <button
                key={item.code}
                type="button"
                aria-pressed={item.code === selecionada}
                onClick={() => props.onSelecionar(item.code)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-left",
                  item.code === selecionada && "border-destructive bg-destructive-soft/40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{destino ? `${item.code} · destino ${destino}` : item.code}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[conteudoDaCaixa(item), medidas].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Badge variant="outline" className={TOM_DO_SELO[estado.tom]}>{estado.rotulo}</Badge>
              </button>
            );
          })}

          {caixa && caixa.status === "counting" && props.podeOperar ? <CaixaEmConferencia {...props} caixa={caixa} itens={itens} /> : null}
        </section>

        <section aria-labelledby="linhas-da-nf" className="flex min-w-0 flex-col gap-2.5">
          <h3 id="linhas-da-nf" className="flex h-8 items-center text-base font-extrabold">Linhas da NF</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-2 text-left font-extrabold">Linha</th>
                  <th scope="col" className="px-2 py-2 text-right font-extrabold">NF (un.)</th>
                  <th scope="col" className="px-2 py-2 text-right font-extrabold">Em caixas (un.)</th>
                  <th scope="col" className="px-2 py-2 text-right font-extrabold">Custo NF</th>
                  <th scope="col" className="px-2 py-2 text-left font-extrabold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {[...itens]
                  .sort((a, b) => Number(a.line_number ?? 0) - Number(b.line_number ?? 0))
                  .map((item) => (
                    <LinhaDaNfRow
                      key={item.id ?? String(item.line_number)}
                      item={item}
                      podeOperar={props.podeOperar}
                      ocupado={ocupado}
                      onMarcarFalta={props.onMarcarFalta}
                      onDesmarcarFalta={props.onDesmarcarFalta}
                    />
                  ))}
              </tbody>
            </table>
          </div>
          <dl className={cn("grid gap-2 rounded-lg border border-border p-3.5", totaisAVista.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
            {totaisAVista.map((total) => (
              <div key={total.rotulo}>
                <dt className="text-xs font-bold text-muted-foreground">{total.rotulo}</dt>
                <dd className="font-extrabold">{numero.format(total.valor)} un.</dd>
              </div>
            ))}
          </dl>
          {justificar ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="justificativa-da-divergencia">Justificativa da divergência</Label>
              <Textarea
                id="justificativa-da-divergencia"
                rows={3}
                maxLength={1000}
                value={props.justificativa}
                disabled={ocupado}
                onChange={(event) => props.onJustificativa(event.target.value)}
              />
            </div>
          ) : null}
        </section>
      </div>
      {props.podeOperar ? (
        <FaltaDaLinha
          linha={marcando}
          nf={Number(marcando?.expected_quantity ?? marcando?.quantity ?? 0)}
          emCaixas={Number(marcando?.boxed_qty ?? 0)}
          falta={marcando ? Math.max(0, emTresCasas(Number(marcando.expected_quantity ?? marcando.quantity ?? 0) - Number(marcando.boxed_qty ?? 0))) : 0}
          enviando={ocupado}
          onCancelar={props.onCancelarFalta}
          onMarcar={props.onConfirmarFalta}
        />
      ) : null}
    </>
  );
}

function LinhaDaNfRow({
  item,
  podeOperar,
  ocupado,
  onMarcarFalta,
  onDesmarcarFalta,
}: {
  item: WarehouseTaskItem;
  podeOperar: boolean;
  ocupado: boolean;
  onMarcarFalta: (itemId: string) => void;
  onDesmarcarFalta: (itemId: string) => void;
}) {
  const situacao = situacaoDaLinha({ ...item, id: item.id ?? "" });
  const nome = item.product_name || item.name || item.sku_code || "";
  const linha = item.line_number ?? "";
  const semMarca = situacao.tipo === "faltam" || situacao.tipo === "marca_velha";
  return (
    <tr className="border-t border-border/60">
      <td className="px-2 py-2 align-middle">
        <span className="block font-bold">{item.line_number ? `${item.line_number} · ${nome}` : nome}</span>
        <span className="block text-muted-foreground">{item.client_item_code || item.sku_code}</span>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{numero.format(Number(item.expected_quantity ?? item.quantity ?? 0))}</td>
      <td className="px-2 py-2 text-right tabular-nums">{numero.format(Number(item.boxed_qty ?? 0))}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {typeof item.unit_cost === "number" && item.unit_cost > 0
          ? item.unit_cost.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : ""}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col items-start gap-1.5">
          <SeloDaLinha situacao={situacao} />
          {situacao.tipo === "falta_marcada" ? (
            <span className="text-xs text-muted-foreground">
              {[MOTIVO_DA_FALTA[situacao.motivo], situacao.detalhe].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          {podeOperar && item.id && semMarca ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Marcar falta na linha ${linha}`}
              disabled={ocupado}
              onClick={() => onMarcarFalta(item.id!)}
            >
              Marcar falta
            </Button>
          ) : null}
          {podeOperar && item.id && situacao.tipo === "falta_marcada" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Desmarcar a falta da linha ${linha}`}
              disabled={ocupado}
              onClick={() => onDesmarcarFalta(item.id!)}
            >
              Desmarcar
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function CaixaEmConferencia(props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada; itens: WarehouseTaskItem[] }) {
  const { caixa, itens, ocupado } = props;
  const porId = new Map(itens.map((item) => [item.id ?? "", item]));
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <h4 className="text-base font-extrabold">Caixa {caixa.code}</h4>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          props.onAdicionar();
        }}
      >
        <Label htmlFor="caixa-busca">Cód. cliente, SKU ou barras</Label>
        <Input id="caixa-busca" value={props.busca} disabled={ocupado} onChange={(event) => props.onBusca(event.target.value)} />
      </form>
      {caixa.lines.map((linha) => {
        const item = porId.get(linha.inbound_item_id);
        const id = `caixa-qtd-${linha.inbound_item_id}`;
        const valor = props.quantidades[linha.inbound_item_id] ?? String(linha.counted_qty);
        return (
          <div key={linha.inbound_item_id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <label htmlFor={id} className="block font-bold">{linha.product_name || item?.product_name || linha.sku_code}</label>
              <span className="block text-sm text-muted-foreground">{[linha.client_item_code, linha.sku_code].filter(Boolean).join(" · ")}</span>
            </span>
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="w-20 text-right"
              value={valor}
              disabled={ocupado}
              onChange={(event) => props.onQuantidade(linha.inbound_item_id, event.target.value)}
              onBlur={() => props.onLancar(linha.inbound_item_id)}
            />
            <span className="text-sm text-muted-foreground">un.</span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={ocupado || !caixa.lines.length} onClick={props.onAbrirFechamento}>
          Fechar caixa
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={props.onRemover}>
          Remover caixa
        </Button>
      </div>
    </div>
  );
}

/**
 * A vista da caixa (mockup WmsRecebimentoFecharCaixa): fechar com as medidas e
 * o peso e, fechada sem destino, reabrir ou remover. As medidas da caixa
 * fechada ficam à vista, sem edição.
 */
function VistaDaCaixa(props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada }) {
  const { task, caixa, ocupado } = props;
  const fechando = caixa.status === "counting";
  const rascunho = fechando ? props.rascunho : rascunhoDaCaixa(caixa);
  const medidas = fechando ? boxDraftToPayload(rascunho) : null;
  const pronto = Boolean(medidas?.gross_weight_kg);
  const lados = fechando
    ? medidas && [medidas.length_m, medidas.width_m, medidas.height_m]
    : caixa.length_m != null && caixa.width_m != null && caixa.height_m != null
      ? [caixa.length_m, caixa.width_m, caixa.height_m]
      : null;
  const volume = lados ? lados.reduce((produto, lado) => produto * lado, 1) : null;
  const selo: EstadoDaCaixa = fechando ? estadoDaCaixa(caixa) : { rotulo: seloDaCaixaFechada(props.destino), tom: "amb" };
  const detalhe = [tituloDaChegada(task), task.invoice_number ? `NF ${task.invoice_number}` : null, conteudoDaCaixa(caixa)]
    .filter(Boolean)
    .join(" · ");
  const editavel = fechando && !ocupado;
  const campo = (chave: keyof BoxDraft, rotulo: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`fechar-${chave}`}>{rotulo}</Label>
      <Input
        id={`fechar-${chave}`}
        inputMode="decimal"
        value={rascunho[chave]}
        disabled={!editavel}
        onChange={(event) => props.onRascunho({ ...props.rascunho, [chave]: event.target.value })}
      />
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-2xl font-extrabold tracking-tight">Caixa {caixa.code}</h2>
        <Badge variant="outline" className={TOM_DO_SELO[selo.tom]}>{selo.rotulo}</Badge>
        <span className="text-sm text-muted-foreground">{detalhe}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
        {campo("length_cm", "Comprimento (cm)")}
        {campo("width_cm", "Largura (cm)")}
        {campo("height_cm", "Altura (cm)")}
        {campo("weight_kg", "Peso (kg)")}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="fechar-tombar"
            checked={rascunho.tombar}
            disabled={!editavel}
            onCheckedChange={(valor) => props.onRascunho({ ...props.rascunho, tombar: valor === true })}
          />
          <Label htmlFor="fechar-tombar">Pode virar esta caixa de lado</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="fechar-empilhar"
            checked={rascunho.empilhar}
            disabled={!editavel}
            onCheckedChange={(valor) => props.onRascunho({ ...props.rascunho, empilhar: valor === true })}
          />
          <Label htmlFor="fechar-empilhar">Pode empilhar esta caixa sobre outra que suporte seu peso</Label>
        </div>
        {volume != null ? (
          <span className="ml-auto text-sm text-muted-foreground">Volume {metrosCubicos.format(volume)} m³</span>
        ) : null}
      </div>
      {!fechando && props.podeOperar ? (
        <>
          <DestinoDaCaixa estado={props.destino} ocupado={ocupado} {...props.onDestino} />
          <RecusaDaPrateleira
            prateleira={props.recusando}
            caixa={caixa.code}
            detalhe={[medidasDaCaixa(caixa), conteudoDaCaixa(caixa)].filter(Boolean).join(" · ")}
            enviando={ocupado}
            onCancelar={props.onCancelarRecusa}
            onRecusar={props.onRecusar}
          />
        </>
      ) : null}
      {props.podeOperar ? (
        <div className="flex flex-wrap gap-2">
          {fechando ? (
            <>
              <Button type="button" disabled={ocupado || !pronto} onClick={props.onFechar}>
                Fechar caixa
              </Button>
              <Button type="button" variant="outline" disabled={ocupado} onClick={props.onCancelarFechamento}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={ocupado} onClick={props.onReabrir}>
                Reabrir para ajustar
              </Button>
              <Button type="button" variant="outline" disabled={ocupado} onClick={props.onRemover}>
                Remover caixa
              </Button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** A linha da NF que o código lido acha: o código do cliente, o SKU ou o código de barras. */
export function linhaPeloCodigo(itens: readonly WarehouseTaskItem[], codigo: string): WarehouseTaskItem | null {
  const alvo = codigo.trim().toUpperCase();
  if (!alvo) return null;
  const codigos = (item: WarehouseTaskItem) =>
    [item.client_item_code, item.sku_code, item.sku, item.barcode]
      .filter((valor): valor is string => Boolean(valor))
      .map((valor) => valor.trim().toUpperCase());
  return itens.find((item) => codigos(item).includes(alvo)) ?? null;
}

/** A ficha com as chamadas: o estado da tela e as escritas na caixa. */
export function FichaDaChegadaPorCaixa({
  entry,
  registeringExceptionId,
  onOpenException,
}: {
  entry: TaskQueueEntry;
  registeringExceptionId?: string;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const { task } = entry;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { code: customerCode } = useActiveCustomer();
  const caixas = useMemo(() => task.boxes ?? [], [task.boxes]);
  const receiptId = receiptIdOf(task);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [fechando, setFechando] = useState(false);
  const [rascunho, setRascunho] = useState<RascunhoDoFechamento>(rascunhoVazio);
  // A revisão que a última escrita devolveu: a próxima não espera a releitura da fila.
  const [revisoes, setRevisoes] = useState<Record<string, number>>({});
  // O destino da caixa fechada (parte 5c).
  const [modoDoDestino, setModoDoDestino] = useState<ModoDoDestino>("sugestao");
  const [prateleiraEscolhida, setPrateleiraEscolhida] = useState("");
  const [recusando, setRecusando] = useState<string | null>(null);
  // As linhas da NF e a conclusão (parte 5d).
  const [marcando, setMarcando] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");

  const selecionada = escolhida && caixas.some((caixa) => caixa.code === escolhida)
    ? escolhida
    : caixas.find((caixa) => caixa.status === "counting")?.code ?? null;
  const caixa = caixas.find((candidata) => candidata.code === selecionada) ?? null;
  const revisaoDe = (alvo: CaixaDaChegada) => Math.max(alvo.conference_revision, revisoes[alvo.code] ?? 0);
  const chave = () => crypto.randomUUID();
  const daChegada = { receipt_id: receiptId, customer_code: customerCode || undefined };
  const podeOperar = task.can_advance !== false;
  // A caixa fechada à vista é a que espera o destino; quem só consulta não pede a sugestão.
  const semDestino = podeOperar && caixa && caixa.status === "reviewed" ? caixa : null;
  const revisaoSemDestino = semDestino ? revisaoDe(semDestino) : 0;

  const anotarRevisao = (revisao?: unknown, code?: string) => {
    if (code && typeof revisao === "number") setRevisoes((atual) => ({ ...atual, [code]: revisao }));
  };
  const releitura = () => queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  const depois = (revisao?: unknown, code?: string) => {
    anotarRevisao(revisao, code);
    void releitura();
  };
  const falhou = (titulo: string) => (error: unknown) => {
    toast({ title: titulo, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
  };
  const limparDestino = () => {
    setModoDoDestino("sugestao");
    setPrateleiraEscolhida("");
    setRecusando(null);
  };
  const mensagem = (error: unknown) => (error ? (error instanceof Error ? error.message : String(error)) : null);

  const sugestao = useQuery({
    queryKey: ["sugestao-da-caixa", receiptId, semDestino?.code ?? "", revisaoSemDestino],
    queryFn: () => sugerirPrateleira({ ...daChegada, box_code: semDestino!.code }),
    enabled: Boolean(semDestino),
    retry: false,
    staleTime: 0,
  });
  const posicoes = useQuery({
    queryKey: ["warehouse-positions", "all-pages"],
    staleTime: 30_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
    enabled: Boolean(semDestino) && modoDoDestino === "escolha",
  });
  const previa = useQuery({
    queryKey: ["sugestao-da-caixa", receiptId, semDestino?.code ?? "", revisaoSemDestino, "prateleira", prateleiraEscolhida],
    queryFn: () => sugerirPrateleira({ ...daChegada, box_code: semDestino!.code, location_id: prateleiraEscolhida }),
    enabled: Boolean(semDestino) && modoDoDestino === "escolha" && Boolean(prateleiraEscolhida),
    retry: false,
    staleTime: 0,
  });
  const prateleiras = useMemo(() => {
    const recusadas = new Set(semDestino?.refused_positions ?? []);
    // A fila do Receber é a do cliente ativo: as prateleiras são as da zona dele.
    return eligibleShelfPositions(posicoes.data?.items ?? [], customerCode).filter((posicao) => !recusadas.has(posicao.code));
  }, [posicoes.data?.items, semDestino?.refused_positions, customerCode]);
  const destino: DestinoDaCaixaEstado = semDestino
    ? {
        modo: modoDoDestino,
        sugestao: sugestao.data ?? null,
        carregandoSugestao: sugestao.isFetching,
        erroSugestao: mensagem(sugestao.error),
        prateleiras,
        carregandoPrateleiras: posicoes.isLoading,
        erroPrateleiras: mensagem(posicoes.error),
        escolhida: prateleiraEscolhida,
        previa: previa.data?.position ?? null,
        carregandoPrevia: previa.isFetching,
        erroPrevia: mensagem(previa.error),
      }
    : destinoVazio();

  const iniciar = useMutation({
    mutationFn: () => iniciarCaixa({ ...daChegada, idempotency_key: chave() }),
    onSuccess: (resultado) => {
      const code = typeof (resultado.box as { code?: unknown } | undefined)?.code === "string"
        ? String((resultado.box as { code: string }).code)
        : null;
      if (code) setEscolhida(code);
      setFechando(false);
      limparDestino();
      depois();
    },
    onError: falhou("Não foi possível iniciar a caixa"),
  });
  const lancar = useMutation({
    mutationFn: (input: { caixa: CaixaDaChegada; itemId: string; quantidade: number }) =>
      lancarNaCaixa({
        ...daChegada,
        box_code: input.caixa.code,
        expected_revision: revisaoDe(input.caixa),
        inbound_item_id: input.itemId,
        counted_qty: input.quantidade,
        idempotency_key: chave(),
      }),
    onSuccess: (resultado, input) => {
      setQuantidades((atual) => {
        const proximo = { ...atual };
        delete proximo[input.itemId];
        return proximo;
      });
      depois(resultado.conference_revision, input.caixa.code);
    },
    onError: falhou("Não foi possível lançar na caixa"),
  });
  const fechar = useMutation({
    mutationFn: (alvo: CaixaDaChegada) => {
      const medidas = boxDraftToPayload(rascunho);
      if (!medidas?.gross_weight_kg) throw new Error("Informe as medidas e o peso da caixa.");
      return fecharCaixa({
        ...daChegada,
        box_code: alvo.code,
        expected_revision: revisaoDe(alvo),
        length_m: medidas.length_m,
        width_m: medidas.width_m,
        height_m: medidas.height_m,
        gross_weight_kg: medidas.gross_weight_kg,
        allow_tilt: rascunho.tombar,
        allow_stacking: rascunho.empilhar,
        idempotency_key: chave(),
      });
    },
    onSuccess: async (resultado, alvo) => {
      anotarRevisao(resultado.conference_revision, alvo.code);
      // Espera a fila trazer a caixa fechada: a vista passa direto ao destino, sem piscar a chegada.
      await releitura();
      setEscolhida(alvo.code);
      setFechando(false);
      setRascunho(rascunhoVazio());
      limparDestino();
    },
    onError: falhou("Não foi possível fechar a caixa"),
  });
  const reabrir = useMutation({
    mutationFn: (alvo: CaixaDaChegada) =>
      reabrirCaixa({ ...daChegada, box_code: alvo.code, expected_revision: revisaoDe(alvo), idempotency_key: chave() }),
    onSuccess: (resultado, alvo) => {
      limparDestino();
      depois(resultado.conference_revision, alvo.code);
    },
    onError: falhou("Não foi possível reabrir a caixa"),
  });
  const remover = useMutation({
    mutationFn: (alvo: CaixaDaChegada) =>
      removerCaixa({ ...daChegada, box_code: alvo.code, expected_revision: revisaoDe(alvo), idempotency_key: chave() }),
    onSuccess: () => {
      setEscolhida(null);
      setFechando(false);
      limparDestino();
      depois();
    },
    onError: falhou("Não foi possível remover a caixa"),
  });
  const confirmar = useMutation({
    mutationFn: (input: { caixa: CaixaDaChegada; candidato: SlottingCandidate }) =>
      confirmarDestino({
        ...daChegada,
        box_code: input.caixa.code,
        expected_revision: revisaoDe(input.caixa),
        location_id: input.candidato.code,
        orientation: input.candidato.placement.orientation,
        support_box_code: input.candidato.placement.support_box_code,
        // A sugestão do motor vai junto mesmo quando a pessoa escolheu outra prateleira.
        suggestion: sugestaoDoConfirmar(sugestao.data ?? null),
        idempotency_key: chave(),
      }),
    onSuccess: async (resultado, input) => {
      anotarRevisao(resultado.conference_revision, input.caixa.code);
      await releitura();
      // Com o destino confirmado, a caixa volta à lista da chegada.
      setEscolhida(null);
      limparDestino();
    },
    onError: falhou("Não foi possível confirmar o destino"),
  });
  const recusar = useMutation({
    mutationFn: (input: { caixa: CaixaDaChegada; prateleira: string; motivo: string }) =>
      recusarSugestao({
        ...daChegada,
        box_code: input.caixa.code,
        expected_revision: revisaoDe(input.caixa),
        position: input.prateleira,
        reason: input.motivo,
        idempotency_key: chave(),
      }),
    onSuccess: (resultado, input) => {
      setRecusando(null);
      // A revisão nova pede outra sugestão, já sem a prateleira recusada.
      depois(resultado.conference_revision, input.caixa.code);
    },
    onError: falhou("Não foi possível recusar a prateleira"),
  });
  const marcar = useMutation({
    mutationFn: (input: { item: WarehouseTaskItem; motivo: FaltaMarcada["reason"]; detalhe: string }) =>
      marcarFalta({
        ...daChegada,
        inbound_item_id: input.item.id ?? "",
        reason: input.motivo,
        detail: input.detalhe || undefined,
        // A marca vale para o que a tela viu nas caixas; mudou em outra tela, o servidor recusa.
        expected_boxed_qty: emTresCasas(Number(input.item.boxed_qty ?? 0)),
        idempotency_key: chave(),
      }),
    onSuccess: () => {
      setMarcando(null);
      depois();
    },
    onError: falhou("Não foi possível marcar a falta"),
  });
  const desmarcar = useMutation({
    mutationFn: (itemId: string) => desmarcarFalta({ ...daChegada, inbound_item_id: itemId, idempotency_key: chave() }),
    onSuccess: () => depois(),
    onError: falhou("Não foi possível desmarcar a falta"),
  });
  const concluir = useMutation({
    mutationFn: () =>
      concluirEntradaPorCaixa({
        ...daChegada,
        // O status que a tela viu: a chegada por caixa conclui de created ou checking.
        expected_status: task.status === "checking" ? "checking" : "created",
        note: justificativa.trim() || undefined,
        idempotency_key: chave(),
      }),
    onSuccess: () => {
      const titulo = task.receipt_number || task.title || receiptId;
      toast({ title: "Entrada concluída", description: `${titulo} · ${caixas.length} ${caixas.length === 1 ? "caixa" : "caixas"} para guardar` });
      setJustificativa("");
      void releitura();
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
    },
    onError: falhou("Não foi possível concluir a entrada"),
  });
  const ocupado =
    iniciar.isPending || lancar.isPending || fechar.isPending || reabrir.isPending || remover.isPending ||
    confirmar.isPending || recusar.isPending || marcar.isPending || desmarcar.isPending || concluir.isPending;

  return (
    <FichaDaChegadaPorCaixaConteudo
      task={task}
      caixas={caixas}
      selecionada={selecionada}
      quantidades={quantidades}
      busca={busca}
      fechando={fechando}
      rascunho={rascunho}
      ocupado={ocupado}
      podeOperar={podeOperar}
      podeRegistrarDivergencia={task.can_register_exception !== false && registeringExceptionId !== task.id}
      onSelecionar={(code) => {
        setEscolhida(code);
        setFechando(false);
        limparDestino();
      }}
      onIniciar={() => iniciar.mutate()}
      onBusca={setBusca}
      onAdicionar={() => {
        if (!caixa) return;
        const item = linhaPeloCodigo(task.items ?? [], busca);
        if (!item?.id) {
          toast({ title: "Produto fora da NF desta chegada", description: busca.trim(), variant: "destructive" });
          return;
        }
        const atual = caixa.lines.find((linha) => linha.inbound_item_id === item.id)?.counted_qty ?? 0;
        setBusca("");
        lancar.mutate({ caixa, itemId: item.id, quantidade: emTresCasas(atual + 1) });
      }}
      onQuantidade={(itemId, valor) => setQuantidades((atual) => ({ ...atual, [itemId]: valor }))}
      onLancar={(itemId) => {
        if (!caixa) return;
        const digitado = quantidades[itemId];
        if (digitado === undefined) return;
        const quantidade = Number(digitado.replace(",", "."));
        const atual = caixa.lines.find((linha) => linha.inbound_item_id === itemId)?.counted_qty ?? 0;
        if (!Number.isFinite(quantidade) || quantidade < 0 || emTresCasas(quantidade) === atual) {
          setQuantidades((anterior) => {
            const proximo = { ...anterior };
            delete proximo[itemId];
            return proximo;
          });
          return;
        }
        lancar.mutate({ caixa, itemId, quantidade: emTresCasas(quantidade) });
      }}
      onAbrirFechamento={() => {
        // A caixa reaberta já tem as medidas: fechar de novo começa por elas.
        setRascunho(caixa && caixa.length_m != null ? rascunhoDaCaixa(caixa) : rascunhoVazio());
        setFechando(true);
      }}
      onRascunho={setRascunho}
      onFechar={() => caixa && fechar.mutate(caixa)}
      onCancelarFechamento={() => setFechando(false)}
      onReabrir={() => caixa && reabrir.mutate(caixa)}
      onRemover={() => caixa && remover.mutate(caixa)}
      onVoltar={() => {
        // Da caixa sendo fechada volta-se a ela, em conferência; da fechada, à chegada.
        if (caixa?.status === "counting") setFechando(false);
        else setEscolhida(null);
        limparDestino();
      }}
      onRegistrarDivergencia={() => onOpenException(task)}
      destino={destino}
      recusando={recusando}
      onDestino={{
        onModo: setModoDoDestino,
        onEscolher: setPrateleiraEscolhida,
        onConfirmar: (candidato) => semDestino && confirmar.mutate({ caixa: semDestino, candidato }),
        onNaoCabe: setRecusando,
        onTentarDeNovo: () => void sugestao.refetch(),
      }}
      onCancelarRecusa={() => setRecusando(null)}
      onRecusar={(motivo) => semDestino && recusando && recusar.mutate({ caixa: semDestino, prateleira: recusando, motivo })}
      justificativa={justificativa}
      onJustificativa={setJustificativa}
      onConcluir={() => concluir.mutate()}
      marcando={marcando}
      onMarcarFalta={setMarcando}
      onCancelarFalta={() => setMarcando(null)}
      onConfirmarFalta={(marca) => {
        const item = (task.items ?? []).find((candidato) => candidato.id === marcando);
        if (item) marcar.mutate({ item, ...marca });
      }}
      onDesmarcarFalta={(itemId) => desmarcar.mutate(itemId)}
    />
  );
}
