import { useEffect, useRef } from "react";
import { ArrowLeft, Check, Package, Plus, Printer, Search } from "lucide-react";
import { tamanhoDoProduto } from "@workspace/dominio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  boxDraftToPayload,
  emptyBoxDraft,
  formatBoxDimensions,
  type BoxDraft,
} from "@/lib/warehouse-boxes";
import type {
  WarehouseTask,
  WarehouseTaskItem,
} from "@/lib/warehouse-ops/model";
import { situacaoDaChegada } from "@/lib/warehouse-ops/receiving";
import {
  MOTIVO_DA_FALTA,
  bloqueiosDaTela,
  emTresCasas,
  esperaJustificativa,
  estadoDaCaixa,
  situacaoDaEtiqueta,
  situacaoDaLinha,
  temEtiqueta,
  totaisDaChegada,
  type CaixaDaChegada,
  type EstadoDaCaixa,
  type FaltaMarcada,
  type SituacaoDaLinha,
} from "@/lib/wms/caixas-do-recebimento";
import {
  DestinoDaCaixa,
  RecusaDaPrateleira,
  type DestinoDaCaixaEstado,
  type DestinoDaCaixaProps,
} from "./destino-da-caixa";
import { FaltaDaLinha } from "./falta-da-linha";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const metrosCubicos = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const TOM_DO_SELO: Record<EstadoDaCaixa["tom"], string> = {
  amb: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  grn: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  mut: "border-border bg-muted text-muted-foreground",
};
const PAINEL = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const ETAPAS = [
  "Conferência",
  "Fechar caixa",
  "Destino",
  "Revisar entrada",
] as const;
export type EtapaDaConferencia = 1 | 2 | 3 | 4;
export type RascunhoDoFechamento = BoxDraft & {
  tombar: boolean;
  empilhar: boolean;
};
export const rascunhoVazio = (): RascunhoDoFechamento => ({
  ...emptyBoxDraft(),
  tombar: false,
  empilhar: false,
});

/** "XG 29 · GG 12 · 41 un.": o tamanho de cada linha (o do código, senão o campo Tamanho; sem tamanho, o código) e o total. */
export function conteudoDaCaixa(caixa: CaixaDaChegada) {
  return [
    ...caixa.lines.map(
      (linha) =>
        `${tamanhoDoProduto({ codigo: linha.client_item_code, tamanho: linha.size }) || linha.client_item_code || linha.sku_code} ${numero.format(linha.counted_qty)}`,
    ),
    `${numero.format(caixa.unit_count)} un.`,
  ].join(" · ");
}
function medidasDaCaixa(caixa: CaixaDaChegada) {
  if (caixa.length_m == null || caixa.width_m == null || caixa.height_m == null)
    return null;
  return formatBoxDimensions({
    length_m: caixa.length_m,
    width_m: caixa.width_m,
    height_m: caixa.height_m,
    gross_weight_kg: caixa.gross_weight_kg,
  });
}
export function rascunhoDaCaixa(caixa: CaixaDaChegada): RascunhoDoFechamento {
  const cm = (valor: number | null) =>
    valor == null ? "" : numero.format(Math.round(valor * 1000) / 10);
  return {
    length_cm: cm(caixa.length_m),
    width_cm: cm(caixa.width_m),
    height_cm: cm(caixa.height_m),
    weight_kg:
      caixa.gross_weight_kg == null ? "" : numero.format(caixa.gross_weight_kg),
    content: "",
    tombar: caixa.allow_tilt,
    empilhar: caixa.allow_stacking,
  };
}
export function quantidadeManual(valor: string): number | null {
  if (!/^\d+(?:[,.]\d{1,3})?$/.test(valor.trim())) return null;
  const total = Number(valor.trim().replace(",", "."));
  return total > 0 && total <= 1_000_000 ? emTresCasas(total) : null;
}
function nomeDoProduto(item: WarehouseTaskItem) {
  return (
    item.product_name ||
    item.name ||
    item.client_item_code ||
    item.sku_code ||
    "Produto"
  );
}
function SeloDaLinha({ situacao }: { situacao: SituacaoDaLinha }) {
  if (situacao.tipo === "ok")
    return (
      <Badge variant="outline" className={TOM_DO_SELO.grn}>
        Quantidade confere
      </Badge>
    );
  if (situacao.tipo === "falta_marcada")
    return (
      <Badge
        variant="outline"
        className="border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground"
      >
        falta marcada · {numero.format(situacao.quantidade)}
      </Badge>
    );
  return (
    <Badge variant="outline" className={TOM_DO_SELO.amb}>
      {situacao.tipo === "sobram" ? "sobram" : "faltam"}{" "}
      {numero.format(situacao.quantidade)}
    </Badge>
  );
}

export type FichaDaChegadaPorCaixaProps = {
  etapa?: EtapaDaConferencia;
  produtoSelecionado?: string | null;
  onProduto?: (id: string) => void;
  onEtapa?: (etapa: EtapaDaConferencia) => void;
  onBack?: () => void;
  feedback?: string;
  erro?: string;
  rascunhosPendentes?: boolean;
  onDescartar?: (id: string) => void;
  onRemoverProduto?: (id: string) => void;
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
  onConfirmarFalta: (marca: {
    motivo: FaltaMarcada["reason"];
    detalhe: string;
  }) => void;
  onDesmarcarFalta: (itemId: string) => void;
  /**
   * As etiquetas das caixas pedidas (parte 6): a de uma caixa com destino, ou
   * todas as da chegada, que a tela de Etiquetas filtra e nomeia.
   */
  onEtiquetas?: (codigos: string[]) => void;
};

export function FichaDaChegadaPorCaixaConteudo(
  props: FichaDaChegadaPorCaixaProps,
) {
  const caixa =
    props.caixas.find((item) => item.code === props.selecionada) ?? null;
  const etapa = !props.podeOperar
    ? 4
    : (props.etapa ??
      (props.fechando
        ? 2
        : caixa?.status === "reviewed"
          ? 3
          : caixa?.status === "counting"
            ? 1
            : 4));
  const titulo = !props.podeOperar
    ? "Detalhes do recebimento"
    : [
        "Conferir recebimento",
        "Fechar caixa",
        "Definir destino",
        "Revisar entrada",
      ][etapa - 1];
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const etapaAnterior = useRef(etapa);
  useEffect(() => {
    if (etapaAnterior.current !== etapa) tituloRef.current?.focus();
    etapaAnterior.current = etapa;
  }, [etapa]);
  return (
    <div className="@container flex min-w-0 flex-col gap-5">
      {props.onBack ? (
        <Button
          type="button"
          variant="ghost"
          className="w-fit px-0"
          disabled={props.ocupado || props.rascunhosPendentes}
          onClick={props.onBack}
        >
          <ArrowLeft aria-hidden="true" />
          Voltar à fila
        </Button>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            ref={tituloRef}
            tabIndex={-1}
            className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl"
          >
            {titulo}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              props.task.receipt_number ||
                props.task.title ||
                props.task.reference,
              props.task.invoice_number
                ? `NF ${props.task.invoice_number}`
                : null,
              props.task.customer || props.task.customer_code,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Badge variant="outline">{situacaoDaChegada(props.task)}</Badge>
      </header>
      {props.podeOperar ? (
        <ol
          aria-label="Etapas do recebimento"
          className="grid grid-cols-2 gap-2 border-b border-border pb-4 sm:grid-cols-4"
        >
          {ETAPAS.map((label, index) => (
            <li
              key={label}
              aria-current={etapa === index + 1 ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-sm font-semibold",
                etapa === index + 1 ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border",
                  etapa === index + 1 &&
                    "border-primary bg-primary text-primary-foreground",
                )}
              >
                {index + 1 < etapa ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
      ) : null}
      {props.erro ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive-soft-border bg-destructive-soft p-3 text-sm text-destructive-soft-foreground"
        >
          {props.erro}
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {props.ocupado
          ? "Salvando… Aguarde a confirmação."
          : props.feedback || ""}
      </p>
      {props.rascunhosPendentes ? (
        <p role="status" className="text-sm text-warning-soft-foreground">
          Há quantidade não salva. Salve ou descarte a alteração antes de
          revisar.
        </p>
      ) : null}
      {etapa === 1 ? (
        <Conferencia {...props} caixa={caixa} />
      ) : etapa === 2 && caixa ? (
        <Fechamento {...props} caixa={caixa} />
      ) : etapa === 3 && caixa ? (
        <Destino {...props} caixa={caixa} />
      ) : (
        <Revisao {...props} />
      )}
    </div>
  );
}

function Caixas({ props }: { props: FichaDaChegadaPorCaixaProps }) {
  return (
    <section aria-label="Caixas da chegada" className="flex flex-wrap gap-2">
      {props.caixas.map((caixa) => {
        const estado = estadoDaCaixa(caixa);
        const conteudo = (
          <>
            <span className="font-bold">
              {caixa.code}
              {caixa.location_id ? ` · destino ${caixa.location_id}` : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {[conteudoDaCaixa(caixa), medidasDaCaixa(caixa), situacaoDaEtiqueta(caixa)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Badge variant="outline" className={TOM_DO_SELO[estado.tom]}>
              {estado.rotulo}
            </Badge>
          </>
        );
        const chip = props.podeOperar ? (
          <button
            type="button"
            aria-label={`Selecionar caixa ${caixa.code}`}
            aria-pressed={caixa.code === props.selecionada}
            disabled={props.ocupado}
            onClick={() => props.onSelecionar(caixa.code)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1 rounded-lg border border-border bg-card px-4 py-3 text-left disabled:opacity-50",
              caixa.code === props.selecionada && "border-primary bg-primary/5",
            )}
          >
            {conteudo}
          </button>
        ) : (
          <div className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4">
            {conteudo}
          </div>
        );
        // A etiqueta da caixa com destino (parte 6), ao lado da caixa.
        const etiqueta =
          props.onEtiquetas && temEtiqueta(caixa) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-center"
              aria-label={`Etiqueta da caixa ${caixa.code}`}
              onClick={() => props.onEtiquetas?.([caixa.code])}
            >
              <Printer aria-hidden="true" />
              Etiqueta
            </Button>
          ) : null;
        return (
          <div key={caixa.code} className="flex min-w-0 items-stretch gap-1">
            {chip}
            {etiqueta}
          </div>
        );
      })}
    </section>
  );
}

function Conferencia(
  props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada | null },
) {
  const { caixa, ocupado } = props;
  const itens = props.task.items ?? [];
  const busca = props.busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = itens.filter((item) =>
    [
      nomeDoProduto(item),
      item.client_item_code,
      item.sku_code,
      item.barcode,
    ].some((valor) => valor?.toLocaleLowerCase("pt-BR").includes(busca)),
  );
  const produto = itens.find((item) => item.id === props.produtoSelecionado);
  const salvo = caixa?.lines.find(
    (linha) => linha.inbound_item_id === produto?.id,
  )?.counted_qty;
  const valor = produto?.id
    ? (props.quantidades[produto.id] ??
      (salvo == null ? "" : String(salvo).replace(".", ",")))
    : "";
  const total = quantidadeManual(valor);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.produtoSelecionado && !ocupado) input.current?.focus();
  }, [props.produtoSelecionado, caixa?.code, ocupado]);
  const totais = totaisDaChegada(
    itens.map((item) => ({ ...item, id: item.id ?? "" })),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold">
            {caixa ? `Caixa ativa ${caixa.code}` : "Caixas da chegada"}
          </h3>
          {caixa ? (
            <p className="text-sm text-muted-foreground">
              Em conferência · {numero.format(caixa.unit_count)} un. salvas
              nesta caixa
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={ocupado}
          onClick={props.onIniciar}
        >
          <Plus className="size-4" aria-hidden="true" />
          {props.caixas.length ? "Iniciar outra caixa" : "Iniciar caixa"}
        </Button>
      </div>
      {props.caixas.length > 1 ? <Caixas props={props} /> : null}
      {!caixa ? (
        <div className={PAINEL}>
          <Package
            className="mb-3 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <p>
            Inicie uma caixa para selecionar os produtos e informar as
            quantidades encontradas.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 @3xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <section className={PAINEL} aria-labelledby="produtos-da-nf">
            <h3 id="produtos-da-nf" className="mb-4 text-lg font-extrabold">
              Produtos da NF
            </h3>
            <Label htmlFor="caixa-busca" className="sr-only">
              Buscar produto por nome ou código
            </Label>
            <div className="relative mb-4">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-2.5 size-4 text-muted-foreground"
              />
              <Input
                id="caixa-busca"
                className="pl-9"
                placeholder="Buscar produto por nome ou código"
                value={props.busca}
                disabled={ocupado}
                onChange={(event) => props.onBusca(event.target.value)}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-2 text-left">
                      Produto
                    </th>
                    <th scope="col" className="p-2 text-right">
                      NF
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Nesta caixa
                    </th>
                    <th scope="col" className="p-2 text-left">
                      Conferência
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        "border-t border-border",
                        item.id === produto?.id && "bg-primary/5",
                      )}
                    >
                      <td className="p-2">
                        <button
                          type="button"
                          disabled={ocupado || !item.id}
                          aria-pressed={item.id === produto?.id}
                          className="w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          onClick={() => item.id && props.onProduto?.(item.id)}
                        >
                          <span className="block font-bold">
                            {nomeDoProduto(item)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {item.client_item_code || item.sku_code}
                          </span>
                        </button>
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {numero.format(
                          Number(item.expected_quantity ?? item.quantity ?? 0),
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {numero.format(
                          caixa.lines.find(
                            (linha) => linha.inbound_item_id === item.id,
                          )?.counted_qty ?? 0,
                        )}
                      </td>
                      <td className="p-2">
                        <SeloDaLinha
                          situacao={situacaoDaLinha({
                            ...item,
                            id: item.id ?? "",
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtrados.length ? (
              <p role="status" className="py-6 text-sm text-muted-foreground">
                Nenhum produto da NF encontrado.
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              A conferência compara o total de todas as caixas com a NF.
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-4">
              {[
                ["Esperado", totais.esperado],
                ["Salvo nesta caixa", caixa.unit_count],
                ["Faltam na chegada", totais.semCaixa],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-extrabold">
                    {numero.format(Number(value))} un.
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            className={cn(PAINEL, "flex flex-col gap-4")}
            aria-label="Quantidade do produto selecionado"
          >
            {produto?.id ? (
              <>
                <div>
                  <h3 className="text-lg font-extrabold">
                    {nomeDoProduto(produto)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {produto.client_item_code || produto.sku_code}
                  </p>
                </div>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!ocupado && total != null && total !== salvo)
                      props.onLancar(produto.id!);
                  }}
                >
                  <Label htmlFor="caixa-quantidade">
                    Quantidade nesta caixa
                  </Label>
                  <Input
                    ref={input}
                    id="caixa-quantidade"
                    inputMode="decimal"
                    autoComplete="off"
                    className="h-14 text-2xl font-bold md:text-2xl"
                    value={valor}
                    disabled={ocupado}
                    aria-describedby="quantidade-ajuda"
                    onChange={(event) =>
                      props.onQuantidade(produto.id!, event.target.value)
                    }
                  />
                  <p
                    id="quantidade-ajuda"
                    className="text-sm text-muted-foreground"
                  >
                    Informe o total encontrado nesta caixa. Na NF:{" "}
                    {numero.format(
                      Number(
                        produto.expected_quantity ?? produto.quantity ?? 0,
                      ),
                    )}{" "}
                    un.
                  </p>
                  <Button
                    type="submit"
                    disabled={ocupado || total == null || total === salvo}
                  >
                    {salvo == null ? "Adicionar à caixa" : "Salvar quantidade"}
                  </Button>
                  {valor.trim() && total == null ? (
                    <p className="text-sm text-destructive">
                      Informe uma quantidade maior que zero, com até três casas
                      decimais.
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {salvo == null
                      ? "Quantidade ainda não adicionada."
                      : `Salvo nesta caixa: ${numero.format(salvo)} un.`}
                  </p>
                </form>
                {Object.hasOwn(props.quantidades, produto.id) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => props.onDescartar?.(produto.id!)}
                  >
                    Descartar alteração
                  </Button>
                ) : null}
                {salvo != null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => props.onRemoverProduto?.(produto.id!)}
                  >
                    Remover produto da caixa
                  </Button>
                ) : null}
              </>
            ) : (
              <div className="my-auto py-8 text-center text-muted-foreground">
                <Package className="mx-auto mb-3 size-8" aria-hidden="true" />
                <p>
                  Selecione um produto da NF para informar a quantidade nesta
                  caixa.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          {caixa ? (
            <Button
              type="button"
              variant="ghost"
              disabled={ocupado}
              onClick={props.onRemover}
            >
              Remover caixa
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={ocupado || props.rascunhosPendentes}
            onClick={() => props.onEtapa?.(4)}
          >
            Revisar entrada
          </Button>
        </div>
        <Button
          type="button"
          disabled={ocupado || !caixa?.lines.length || props.rascunhosPendentes}
          onClick={props.onAbrirFechamento}
        >
          Revisar caixa
        </Button>
      </footer>
    </>
  );
}

function ConteudoDaCaixa({ caixa }: { caixa: CaixaDaChegada }) {
  return (
    <section aria-labelledby="conteudo-da-caixa" className={PAINEL}>
      <h3 id="conteudo-da-caixa" className="mb-4 text-lg font-extrabold">
        Conteúdo da caixa
      </h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 text-left">
              Produto
            </th>
            <th scope="col" className="py-2 text-right">
              Quantidade
            </th>
          </tr>
        </thead>
        <tbody>
          {caixa.lines.map((linha) => (
            <tr key={linha.inbound_item_id} className="border-t border-border">
              <td className="py-3 pr-3">
                <span className="block font-bold">
                  {linha.product_name ||
                    linha.client_item_code ||
                    linha.sku_code}
                </span>
                <span className="text-xs text-muted-foreground">
                  {linha.client_item_code || linha.sku_code}
                </span>
              </td>
              <td className="py-3 text-right tabular-nums">
                {numero.format(linha.counted_qty)} un.
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 border-t border-border pt-4 text-right font-extrabold">
        Total na caixa: {numero.format(caixa.unit_count)} un.
      </p>
    </section>
  );
}
function ResumoDaCaixa({ caixa }: { caixa: CaixaDaChegada }) {
  const estado = estadoDaCaixa(caixa);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <Package aria-hidden="true" className="size-5" />
      <strong>Caixa {caixa.code}</strong>
      <Badge variant="outline" className={TOM_DO_SELO[estado.tom]}>
        {estado.rotulo}
      </Badge>
      <span className="text-sm text-muted-foreground">
        {[
          `${caixa.lines.length} produtos · ${numero.format(caixa.unit_count)} un.`,
          medidasDaCaixa(caixa),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}
function Fechamento(
  props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada },
) {
  const medidas = boxDraftToPayload(props.rascunho);
  const campo = (key: keyof BoxDraft, label: string) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`fechar-${key}`}>{label}</Label>
      <Input
        id={`fechar-${key}`}
        inputMode="decimal"
        value={props.rascunho[key]}
        disabled={props.ocupado}
        onChange={(event) =>
          props.onRascunho({ ...props.rascunho, [key]: event.target.value })
        }
      />
    </div>
  );
  return (
    <>
      <ResumoDaCaixa caixa={props.caixa} />
      <div className="grid gap-5 @3xl:grid-cols-2">
        <ConteudoDaCaixa caixa={props.caixa} />
        <section
          className={cn(PAINEL, "flex flex-col gap-5")}
          aria-labelledby="medidas-e-peso"
        >
          <h3 id="medidas-e-peso" className="text-lg font-extrabold">
            Medidas e peso
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {campo("length_cm", "Comprimento (cm)")}
            {campo("width_cm", "Largura (cm)")}
            {campo("height_cm", "Altura (cm)")}
            {campo("weight_kg", "Peso (kg)")}
          </div>
          {medidas ? (
            <p className="text-sm text-muted-foreground">
              Volume{" "}
              {metrosCubicos.format(
                medidas.length_m * medidas.width_m * medidas.height_m,
              )}{" "}
              m³
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="fechar-tombar"
              checked={props.rascunho.tombar}
              disabled={props.ocupado}
              onCheckedChange={(value) =>
                props.onRascunho({ ...props.rascunho, tombar: value === true })
              }
            />
            <Label htmlFor="fechar-tombar">Pode virar esta caixa de lado</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="fechar-empilhar"
              checked={props.rascunho.empilhar}
              disabled={props.ocupado}
              onCheckedChange={(value) =>
                props.onRascunho({
                  ...props.rascunho,
                  empilhar: value === true,
                })
              }
            />
            <Label htmlFor="fechar-empilhar">
              Pode empilhar esta caixa sobre outra que suporte seu peso
            </Label>
          </div>
        </section>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={props.ocupado}
          onClick={props.onCancelarFechamento}
        >
          Editar conteúdo
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Próxima etapa: destino
          </span>
          <Button
            type="button"
            disabled={props.ocupado || !medidas?.gross_weight_kg}
            onClick={props.onFechar}
          >
            Fechar caixa
          </Button>
        </div>
      </footer>
    </>
  );
}
function Destino(
  props: FichaDaChegadaPorCaixaProps & { caixa: CaixaDaChegada },
) {
  return (
    <>
      <ResumoDaCaixa caixa={props.caixa} />
      <div className="grid min-w-0 gap-5 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <DestinoDaCaixa
            estado={props.destino}
            ocupado={props.ocupado}
            {...props.onDestino}
          />
          <p className="text-sm text-muted-foreground">
            Confirmar o destino reserva a prateleira. A guarda física será feita
            após concluir a entrada.
          </p>
        </div>
        <ConteudoDaCaixa caixa={props.caixa} />
      </div>
      <RecusaDaPrateleira
        prateleira={props.recusando}
        caixa={props.caixa.code}
        detalhe={[medidasDaCaixa(props.caixa), conteudoDaCaixa(props.caixa)]
          .filter(Boolean)
          .join(" · ")}
        enviando={props.ocupado}
        onCancelar={props.onCancelarRecusa}
        onRecusar={props.onRecusar}
      />
      <footer className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={props.ocupado}
            onClick={props.onReabrir}
          >
            Reabrir para ajustar
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={props.ocupado}
            onClick={props.onRemover}
          >
            Remover caixa
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={props.ocupado || props.rascunhosPendentes}
          onClick={() => props.onEtapa?.(4)}
        >
          Continuar sem prateleira
        </Button>
      </footer>
    </>
  );
}

function Revisao(props: FichaDaChegadaPorCaixaProps) {
  const itens = props.task.items ?? [];
  const linhas = itens.map((item) => ({ ...item, id: item.id ?? "" }));
  const totais = totaisDaChegada(linhas);
  const bloqueios = bloqueiosDaTela(props.caixas, linhas, props.justificativa);
  const marcando = itens.find((item) => item.id === props.marcando) ?? null;
  const justificar =
    props.podeOperar &&
    (esperaJustificativa(props.caixas, linhas) || Boolean(props.justificativa));
  // "Etiquetas da chegada" leva todas as caixas; a tela de Etiquetas nomeia a que ainda não tem destino (decisão 30).
  const comEtiqueta = props.caixas.some(temEtiqueta);
  return (
    <>
      <div className="flex flex-wrap gap-5 rounded-lg border border-border bg-muted/30 p-4">
        <strong>
          {props.caixas.length} {props.caixas.length === 1 ? "caixa" : "caixas"}
        </strong>
        <span>{numero.format(totais.emCaixas)} un. conferidas</span>
        <span>
          {linhas.every((linha) => situacaoDaLinha(linha).tipo === "ok")
            ? "Quantidades conferem com a NF"
            : "Há divergências na conferência"}
        </span>
      </div>
      <section aria-labelledby="linhas-da-nf" className={PAINEL}>
        <h3 id="linhas-da-nf" className="mb-4 text-lg font-extrabold">
          Conferência da NF
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 text-left">
                  Produto
                </th>
                <th scope="col" className="p-2 text-right">
                  NF (un.)
                </th>
                <th scope="col" className="p-2 text-right">
                  Conferido (un.)
                </th>
                <th scope="col" className="p-2 text-right">
                  Custo NF
                </th>
                <th scope="col" className="p-2 text-left">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {[...itens]
                .sort(
                  (a, b) =>
                    Number(a.line_number ?? 0) - Number(b.line_number ?? 0),
                )
                .map((item) => (
                  <LinhaDaNfRow
                    key={item.id}
                    item={item}
                    podeOperar={props.podeOperar}
                    ocupado={props.ocupado}
                    onMarcarFalta={props.onMarcarFalta}
                    onDesmarcarFalta={props.onDesmarcarFalta}
                  />
                ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 flex flex-wrap gap-6 border-t border-border pt-4">
          {[
            ["Esperado", totais.esperado],
            ["Em caixas", totais.emCaixas],
            ...(totais.semCaixa > 0 || !totais.faltaMarcada
              ? [["Sem caixa", totais.semCaixa]]
              : []),
            ...(totais.faltaMarcada
              ? [["Falta marcada", totais.faltaMarcada]]
              : []),
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-extrabold">
                {numero.format(Number(value))} un.
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="caixas-e-destinos">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="caixas-e-destinos" className="text-lg font-extrabold">
            Caixas e destinos
          </h3>
          {props.onEtiquetas && comEtiqueta ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                props.onEtiquetas?.(props.caixas.map((caixa) => caixa.code))
              }
            >
              <Printer aria-hidden="true" />
              Etiquetas da chegada
            </Button>
          ) : null}
        </div>
        <Caixas props={props} />
      </section>
      {justificar ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="justificativa-da-divergencia">
            Justificativa da divergência
          </Label>
          <Textarea
            id="justificativa-da-divergencia"
            rows={3}
            maxLength={1000}
            value={props.justificativa}
            disabled={props.ocupado}
            onChange={(event) => props.onJustificativa(event.target.value)}
          />
        </div>
      ) : null}
      {props.podeOperar ? (
        <>
          <p className="text-sm text-muted-foreground">
            Ao concluir a entrada, as caixas seguem para a fila de guarda
            física. Caixas sem prateleira terão o destino definido na guarda.
          </p>
          {bloqueios.length ? (
            <p className="text-sm text-warning-soft-foreground">
              {bloqueios.join(" · ")}
            </p>
          ) : null}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={props.ocupado}
                onClick={() => props.onEtapa?.(1)}
              >
                Voltar à conferência
              </Button>
              {props.podeRegistrarDivergencia ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={props.ocupado}
                  onClick={props.onRegistrarDivergencia}
                >
                  Registrar divergência
                </Button>
              ) : null}
            </div>
            <Button
              type="button"
              disabled={
                props.ocupado ||
                props.rascunhosPendentes ||
                bloqueios.length > 0
              }
              onClick={props.onConcluir}
            >
              Concluir entrada
            </Button>
          </footer>
          <FaltaDaLinha
            linha={marcando}
            nf={Number(marcando?.expected_quantity ?? marcando?.quantity ?? 0)}
            emCaixas={Number(marcando?.boxed_qty ?? 0)}
            falta={
              marcando
                ? Math.max(
                    0,
                    emTresCasas(
                      Number(
                        marcando.expected_quantity ?? marcando.quantity ?? 0,
                      ) - Number(marcando.boxed_qty ?? 0),
                    ),
                  )
                : 0
            }
            enviando={props.ocupado}
            onCancelar={props.onCancelarFalta}
            onMarcar={props.onConfirmarFalta}
          />
        </>
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
  const semMarca =
    situacao.tipo === "faltam" || situacao.tipo === "marca_velha";
  return (
    <tr className="border-t border-border/60">
      <td className="px-2 py-2 align-middle">
        <span className="block font-bold">
          {item.line_number ? `${item.line_number} · ${nome}` : nome}
        </span>
        <span className="block text-muted-foreground">
          {item.client_item_code || item.sku_code}
        </span>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {numero.format(Number(item.expected_quantity ?? item.quantity ?? 0))}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {numero.format(Number(item.boxed_qty ?? 0))}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {typeof item.unit_cost === "number" && item.unit_cost > 0
          ? item.unit_cost.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : ""}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col items-start gap-1.5">
          <SeloDaLinha situacao={situacao} />
          {situacao.tipo === "falta_marcada" ? (
            <span className="text-xs text-muted-foreground">
              {[MOTIVO_DA_FALTA[situacao.motivo], situacao.detalhe]
                .filter(Boolean)
                .join(" · ")}
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
