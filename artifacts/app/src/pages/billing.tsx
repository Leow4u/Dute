import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  useGetBillingPeriod,
  getGetBillingPeriodQueryKey,
  getListBillingPeriodsQueryKey,
  useSaveBillingManual,
  useEmitBillingInvoice,
  usePayBillingInvoice,
  useListBillingPeriods,
} from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, FileText, Save, Send, TriangleAlert } from "lucide-react";
import { Link } from "wouter";

import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
import { Input } from "@/components/ui/input";
import { Confirmacao } from "@/components/ui/confirmacao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { useToast } from "@/hooks/use-toast";
import { CABECALHO_DO_CLIENTE } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { useAcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import type { LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { useChegada } from "@/lib/carregando/use-chegada";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { SaiComOFoco, useFocoQueSegue } from "@/lib/carregando/use-foco-que-segue";
import { BarraDaLista, useListaComFiltro, useListaEmTroca } from "@/lib/carregando/use-lista-em-troca";
import { acaoDaArmazenagem } from "@/lib/financeiro/armazenagem";
import { humanApiError } from "@/lib/permissions";
import {
  STATUS_META,
  competenciaLabel,
  currentCompetencia,
  fmtBRL,
  fmtNum,
} from "@/lib/billing-format";
import { isAdValoremLine } from "@/lib/invoice-view";
import { cn } from "@/lib/utils";

/**
 * Fechamento do mês: o que vai ser cobrado, o que falta preencher e emitir.
 * O total vem do servidor (getBillingPreview) com o mesmo cálculo que a
 * emissão congela; aqui só se digitam as quantidades manuais.
 */

type Line = {
  price_list_id: number | string | null;
  item: string;
  unidade?: string | null;
  qtde: number;
  valor_unit: number;
  total: number;
  observacao?: string | null;
  auto?: boolean;
  auto_source?: string | null;
};

type Period = {
  competencia: string;
  status: string;
  custo_estoque: number;
  ad_valorem_rate: number;
  total: number;
  grupos: Array<{ grupo: string; total: number; itens: Line[] }>;
  emitido_em?: string | null;
  pago_em?: string | null;
  /** A NF do Financeiro em que a competência está (parte 7.2a). */
  fatura_id?: string | null;
  emission?: { can_emit: boolean; available_from: string };
};

const cents = (value: number) => Math.round(value * 100);

function brDate(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function previousCompetencia(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function competenciaFromUrl() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("competencia");
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

const STATUS_DOT: Record<string, string> = {
  aberto: "bg-amber-500",
  emitido: "bg-blue-500",
  pago: "bg-green-600",
};

export default function Billing() {
  // Abre no mês a fechar (o anterior); o mês corrente fica ao lado.
  const [competencia, setCompetencia] = useState(
    () => competenciaFromUrl() ?? previousCompetencia(currentCompetencia()),
  );
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  // O mês na tela e o que se grava são do cliente ativo desta aba: a chave
  // da leitura leva o cliente, e cada chamada o diz no cabeçalho.
  const { code: cliente, isLoading: carregandoCliente, codeProvavel, recarregar } = useActiveCustomer();
  const doCliente = useMemo(() => ({ headers: { [CABECALHO_DO_CLIENTE]: cliente } }), [cliente]);

  // Trocar o mês ou o cliente lê no servidor: o mês anterior fica, a 50% e inert, até o novo chegar (carregamento
  // v2, momento 7, caso 4); a releitura que falha não o apaga (a faixa diz), e a troca que falha mostra o aviso.
  const leitura = useGetBillingPeriod(competencia, {
    query: { queryKey: [...getGetBillingPeriodQueryKey(competencia), cliente], enabled: !carregandoCliente, placeholderData: keepPreviousData },
    request: doCliente,
  });
  const { data: raw, isLoading } = leitura;
  // Enquanto o cliente ativo lê, o `code` ainda é o do cliente padrão: nenhum mês dele entra na tela, nem as ações que
  // gravariam nele (o customer_code é a fronteira).
  const data = carregandoCliente ? undefined : (raw as unknown as Period | undefined);
  const lista = useListaComFiltro(leitura);
  const troca = useListaEmTroca(lista.trocando);
  // O mês do que está na tela: na troca, ainda o anterior, que a tela continua dizendo qual é.
  const mesNaTela = useRef(competencia);
  if (!lista.trocando) mesNaTela.current = competencia;
  const idDaLinha = useId();
  const idDaFatura = useId();
  // Com o cliente ativo ainda lendo, a leitura do mês ainda não começou: para a linha de estado ela já lê, e a espera
  // é uma só, do toque até o mês chegar (carregamento v2, parte 13d; antes, "Calculando Outubro de 2026..."). O
  // "Tentar de novo" da demora lê de novo a lista dos clientes, nunca o mês: o mês lido agora seria o do cliente padrão.
  const leituraDaLinha: LeituraDaLista =
    carregandoCliente && data === undefined
      ? {
          ...leitura,
          isLoading: true,
          isError: false,
          error: null,
          refetch: (() => Promise.resolve(recarregar?.()).then(() => ({ isError: false, error: null }))) as unknown as UseQueryResult<unknown>["refetch"],
        }
      : leitura;
  // O esqueleto do mês entra aos 300 ms, como a linha (momento 2); a leitura rápida não pisca nada.
  const lendoOMes = data === undefined && !lista.falhou;
  const fantasmas = useEspera(lendoOMes);
  // Na chegada, o mês entra no lugar do esqueleto por opacidade, subindo 4 px, em cascata (momento 2).
  const chegando = useChegada(lendoOMes);
  // O botão que sai com o foco (Salvar quantidades, Marcar como paga) o deixa no link da fatura, nunca no body.
  const focoQueSegue = useFocoQueSegue();
  const periodos = useListBillingPeriods({
    query: { queryKey: [...getListBillingPeriodsQueryKey(), cliente], enabled: !carregandoCliente },
    request: doCliente,
  });
  const periodsData = periodos.data;
  // Sem a lista dos meses, o estado de cada mês é desconhecido: nunca "Em aberto" antes de ler, nem na falha. A falha
  // fica na tela enquanto a pessoa tenta de novo (a cópia), com o aviso sob os meses: o "—" nunca fica calado.
  const meses = useLeituraComFalha(periodos);
  const periodosFalharam = meses.isError && periodsData === undefined;
  const fantasmasDosMeses = useEspera(periodsData === undefined && !periodosFalharam);

  const [qty, setQty] = useState<Record<string, string>>({});
  const [obs, setObs] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  // A confirmação de Emitir espera a resposta: fecha só no sucesso (decisão 6 de 06/11/2026).
  const [confirmarEmissao, setConfirmarEmissao] = useState(false);
  // "Salvar quantidades" e "Marcar como paga" no relógio da ação (carregamento v2, momento 3): "Salvando…" até o
  // servidor responder; depois, "Quantidades salvas" pelo menos 1 s e até a releitura do mês chegar (até lá, o mês na
  // tela é o de antes, e o botão voltaria ativo com as quantidades ou o estado antigos); no erro, "Quantidades não
  // salvas" por 2 s. Aos 70 s sem resposta, "Conferir" relê o mês e nunca grava de novo.
  // Cada mês tem a sua ação: o "Quantidades salvas" de outubro não aparece em novembro.
  const acoes = useAcaoNaLinha<string>();

  const lines = useMemo(() => data?.grupos.flatMap((group) => group.itens) ?? [], [data]);
  const autoLines = lines.filter((line) => line.auto);
  const manualLines = useMemo(
    () => lines.filter((line) => !line.auto && line.price_list_id != null),
    [lines],
  );
  // O esqueleto do mês tem as linhas que o último mês lido deste cliente teve (de 1 a 5; sem lembrança, 2).
  // O cliente que a tela vai operar: enquanto o ativo lê, o escolhido neste aparelho (só para a altura do esqueleto).
  const clienteProvavel = codeProvavel ?? cliente;
  const contagem = useContagemLembrada(
    "fechamento",
    clienteProvavel,
    data && !lista.trocando ? { automaticos: autoLines.length, servicos: manualLines.length } : null,
  );
  const aberto = !data || data.status === "aberto";

  useEffect(() => {
    const q: Record<string, string> = {};
    const o: Record<string, string> = {};
    for (const line of manualLines) {
      q[String(line.price_list_id)] = String(line.qtde);
      o[String(line.price_list_id)] = line.observacao || "";
    }
    setQty(q);
    setObs(o);
    setDirty(false);
  }, [manualLines]);

  const quantity = (line: Line) =>
    aberto ? Number(qty[String(line.price_list_id)] || 0) : line.qtde;
  const lineTotal = (line: Line) =>
    aberto && dirty ? cents(quantity(line) * line.valor_unit) / 100 : line.total;
  // Com alterações não salvas, mostra o total que elas vão dar.
  const total = dirty
    ? (cents(data?.total ?? 0) -
        manualLines.reduce((sum, line) => sum + cents(line.total), 0) +
        manualLines.reduce((sum, line) => sum + cents(lineTotal(line)), 0)) /
      100
    : (data?.total ?? 0);

  const months = useMemo(() => {
    const known = new Map<string, { status: string; total: number }>();
    for (const period of periodsData?.items ?? []) {
      known.set(period.competencia, { status: period.status, total: period.total });
    }
    const current = currentCompetencia();
    const list = new Set([...known.keys(), current, previousCompetencia(current), competencia]);
    // O mês que a lista lida não traz ainda está aberto; sem a lista, o estado fica nulo (o bloco, ou "—" na falha).
    return [...list]
      .filter((value) => value <= current)
      .sort()
      .slice(-4)
      .map((value): { competencia: string; status: string | null; total: number } => ({
        competencia: value,
        ...(known.get(value) ?? (periodsData ? { status: "aberto", total: 0 } : { status: null, total: 0 })),
      }));
  }, [periodsData, competencia]);
  // A faixa dos meses na forma final: antes da lista, só o mês corrente e o anterior são conhecidos; os que a última
  // lista deste cliente trouxe a mais entram como cartões-fantasma à esquerda, até ela chegar (sem lembrança, a faixa
  // cheia, com quatro).
  const contagemDosMeses = useContagemLembrada("fechamento-meses", clienteProvavel, periodsData ? { meses: months.length } : null);
  const mesesFantasma =
    periodsData === undefined && !periodosFalharam
      ? Math.max(0, Math.min(4, contagemDosMeses.lembrada("meses") ?? 4) - months.length)
      : 0;

  const save = useSaveBillingManual({ request: doCliente });
  const emit = useEmitBillingInvoice({ request: doCliente });
  const pay = usePayBillingInvoice({ request: doCliente });

  const refetch = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getGetBillingPeriodQueryKey(competencia) }),
      qc.invalidateQueries({ queryKey: getListBillingPeriodsQueryKey() }),
    ]);
  /** O mês relido, para o "Conferir" dos 70 s: relê e nunca grava de novo. */
  const mesRelido = async () => (await leitura.refetch()).data as unknown as Period | undefined;

  const failure = (title: string) => (err: unknown) =>
    toast({
      title,
      description: humanApiError(err, "Tente novamente em instantes."),
      variant: "destructive",
    });

  const handleSave = () => {
    const items = manualLines.map((line) => ({
      price_list_id: line.price_list_id as number,
      qtde: Number(qty[String(line.price_list_id)] || 0),
      observacao: obs[String(line.price_list_id)] || null,
    }));
    // A chamada é a de sempre; a linha ocupada não grava de novo.
    void acoes.executar(
      competencia,
      "salvar",
      () =>
        save.mutateAsync({ competencia, data: { items } }).then(
          () => toast({ title: "Quantidades salvas" }),
          (erro: unknown) => {
            failure("Quantidades não salvas")(erro);
            throw erro;
          },
        ),
      {
        releitura: refetch,
        conferir: async () => {
          const lido = await mesRelido();
          const lancadas = new Map(
            (lido?.grupos ?? []).flatMap((grupo) => grupo.itens).map((line) => [String(line.price_list_id), line.qtde]),
          );
          return items.every((item) => lancadas.get(String(item.price_list_id)) === item.qtde);
        },
      },
    );
  };

  const handleEmit = () =>
    emit.mutate(
      { competencia },
      {
        onSuccess: () => {
          setConfirmarEmissao(false);
          toast({
            title: "Fatura emitida",
            description:
              "Os valores foram congelados e a fatura está disponível para a cliente em Faturas.",
          });
          void refetch();
        },
        onError: failure("Fatura não emitida"),
      },
    );

  const handlePay = () => {
    void acoes.executar(
      competencia,
      "pagar",
      () =>
        pay.mutateAsync({ competencia }).then(
          () => toast({ title: "Fatura marcada como paga" }),
          (erro: unknown) => {
            failure("Não foi possível marcar como paga")(erro);
            throw erro;
          },
        ),
      { releitura: refetch, conferir: async () => (await mesRelido())?.status === "pago" },
    );
  };
  const estadoDoSalvar = acoes.estado(competencia, "salvar");
  const estadoDoPagar = acoes.estado(competencia, "pagar");

  const status = data?.status ?? "aberto";
  // Onde o Financeiro está ligado, a emitida se fatura e se recebe lá (parte 7.2c).
  const acao = acaoDaArmazenagem(status, data?.fatura_id, user?.publicMetadata.role);
  const statusMeta = STATUS_META[status] ?? STATUS_META.aberto;
  const canEmit = aberto && data?.emission?.can_emit === true && !dirty;
  const monthName = competenciaLabel(mesNaTela.current).split(" de ")[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: mesesFantasma }, (_, ordem) => (
          // O mês que a lista ainda vai trazer: o cartão na forma do real, fora da árvore, que entra aos 300 ms.
          <span
            key={`fantasma-${ordem}`}
            aria-hidden="true"
            data-fantasmas=""
            data-visivel={fantasmasDosMeses.visivel ? "" : undefined}
            className="inline-flex min-w-[150px] flex-col rounded-2xl border border-border bg-card px-4 py-2"
          >
            <span className="flex h-5 items-center">
              <Esqueleto forma="texto" className="w-28" />
            </span>
            <span className="flex h-4 items-center">
              <Esqueleto forma="texto" className="h-2.5 w-20" />
            </span>
          </span>
        ))}
        {months.map((month) => {
          const meta = month.status === null ? null : (STATUS_META[month.status] ?? STATUS_META.aberto);
          return (
            <button
              key={month.competencia}
              type="button"
              onClick={() => setCompetencia(month.competencia)}
              className={cn(
                "min-w-[150px] rounded-2xl border bg-card px-4 py-2 text-left transition-colors",
                month.competencia === competencia
                  ? "border-2 border-primary bg-info-soft/40"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <span className="block text-sm font-semibold">{competenciaLabel(month.competencia)}</span>
              <span className="flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground">
                {meta === null ? (
                  // Antes da lista dos meses, o bloco no lugar do estado; na falha, "—": a tela não afirma o que não leu.
                  periodosFalharam ? "—" : <Esqueleto forma="texto" className="h-2.5 w-20" />
                ) : (
                  <>
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[month.status ?? "aberto"] ?? "bg-amber-500")} />
                    {meta.label}
                    {month.status !== "aberto" && month.total ? ` · ${fmtBRL(month.total)}` : ""}
                  </>
                )}
              </span>
            </button>
          );
        })}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-surface-hover">
          <CalendarDays className="size-4" aria-hidden="true" />
          Outro mês
          <input
            type="month"
            aria-label="Outro mês"
            value={competencia}
            max={currentCompetencia()}
            onChange={(event) => event.target.value && setCompetencia(event.target.value)}
            className="w-32 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
      </div>

      {periodosFalharam ? (
        // A lista dos meses que não veio: o "—" nos cartões e o aviso, com "Tentar de novo"; o mês na tela segue.
        <FalhaNaLeitura leitura={periodos} erro={meses.error} mensagem="Não consegui carregar os meses." focoAoSair={idDaLinha} />
      ) : null}

      {/* A casa do estado do mês, logo abaixo dos meses, sempre reservada: "Carregando outubro de 2026…" na primeira
          leitura, com o esqueleto do mês no lugar dele; "Atualizado às", a troca que passa de 5 s, a releitura que falha
          e a falta de conexão, sem empurrar o mês (carregamento v2, parte 13d). */}
      <LinhaDeEstado id={idDaLinha} leitura={leituraDaLinha} objeto={competenciaLabel(competencia).toLowerCase()} />

      {lista.falhou ? (
        <FalhaNaLeitura leitura={leitura} erro={lista.erro} mensagem={humanApiError(lista.erro, "Não consegui calcular a competência.")} focoAoSair={idDaLinha} />
      ) : isLoading || !data ? (
        <EsqueletoDoMes
          visivel={fantasmas.visivel}
          idDaLinha={idDaLinha}
          automaticos={contagem.linhas("automaticos")}
          servicos={contagem.linhas("servicos")}
        />
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" {...troca.props} {...(chegando ? { "data-chegada": "" } : {})}>
          <section className="relative overflow-hidden rounded-lg border border-border bg-card">
            <BarraDaLista ativa={lista.trocando} />
            <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
              <h2 className="text-sm font-semibold">Cobrado automaticamente</h2>
              <span className="text-xs text-muted-foreground">calculado pelo sistema</span>
            </div>
            <div className="space-y-2 px-5 pb-4">
              {autoLines.length ? (
                autoLines.map((line) => (
                  <div
                    key={String(line.price_list_id ?? line.item)}
                    className="flex items-center gap-4 rounded-xl border border-info-soft-border bg-info-soft/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{line.item}</div>
                      <div className="text-xs text-muted-foreground">
                        {isAdValoremLine(line)
                          ? `${fmtNum(line.valor_unit * 100)}% × ${fmtBRL(line.qtde)} · ${
                              aberto ? "valor atual do estoque" : "valor congelado na emissão"
                            }`
                          : `${fmtNum(line.qtde)} ${line.unidade ?? ""} × ${fmtBRL(line.valor_unit)}`}
                      </div>
                    </div>
                    <div className="text-lg font-semibold tabular-nums">{fmtBRL(line.total)}</div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum serviço automático na tabela de preços.
                </p>
              )}
            </div>

            <div className="flex items-baseline justify-between border-t border-border/60 px-5 pb-2 pt-4">
              <h2 className="text-sm font-semibold">Serviços do mês</h2>
              <span className="text-xs text-muted-foreground">
                {aberto ? "quantidade lançada por você" : "quantidades congeladas"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                    <th className="px-5 py-2 font-semibold">Serviço</th>
                    <th className="px-3 py-2 text-right font-semibold">Qtde</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor unit.</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-5 py-2 font-semibold">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {manualLines.map((line) => {
                    const id = String(line.price_list_id);
                    const value = lineTotal(line);
                    return (
                      <tr key={id} className="border-b border-border/40 last:border-0">
                        <td className="px-5 py-2">
                          <div>{line.item}</div>
                          <div className="text-xs text-muted-foreground">{line.unidade}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {aberto ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              aria-label={`Quantidade de ${line.item}`}
                              value={qty[id] ?? ""}
                              onChange={(event) => {
                                setDirty(true);
                                setQty((state) => ({ ...state, [id]: event.target.value }));
                              }}
                              className="ml-auto h-9 w-24 text-right tabular-nums"
                            />
                          ) : (
                            <span className="tabular-nums">{fmtNum(line.qtde)}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtBRL(line.valor_unit)}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                            value > 0 ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {fmtBRL(value)}
                        </td>
                        <td className="px-5 py-2">
                          {aberto ? (
                            <Input
                              aria-label={`Observação de ${line.item}`}
                              value={obs[id] ?? ""}
                              placeholder="—"
                              onChange={(event) => {
                                setDirty(true);
                                setObs((state) => ({ ...state, [id]: event.target.value }));
                              }}
                              className="h-9"
                            />
                          ) : (
                            <span className="text-muted-foreground">{line.observacao}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="order-first space-y-3 lg:order-none lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-lg border-2 border-primary bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {competenciaLabel(mesNaTela.current)} · {aberto ? "total previsto" : "total"}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    statusMeta.className,
                  )}
                >
                  {statusMeta.label}
                </span>
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{fmtBRL(total)}</div>
              <p className="text-xs text-muted-foreground">
                {aberto
                  ? dirty
                    ? "Inclui alterações ainda não salvas."
                    : "Mesmo cálculo que será congelado na emissão."
                  : "Valores congelados na emissão."}
              </p>

              <ul className="mt-4 space-y-2.5 text-sm">
                {aberto ? (
                  <>
                    <Check
                      tone={dirty ? "warn" : "ok"}
                      title={dirty ? "Alterações não salvas" : "Quantidades salvas"}
                      detail={dirty ? "Salve antes de emitir." : undefined}
                    />
                    <Check
                      tone={data.emission?.can_emit ? "ok" : "wait"}
                      title={
                        data.emission?.can_emit
                          ? `${monthName} encerrado`
                          : `${monthName} ainda não terminou`
                      }
                      detail={
                        data.emission?.can_emit
                          ? "Pronto para emitir."
                          : `Emissão liberada a partir de ${brDate(data.emission?.available_from)}.`
                      }
                    />
                  </>
                ) : (
                  <>
                    <Check
                      tone="ok"
                      title={`Emitida${data.emitido_em ? ` em ${brDate(data.emitido_em)}` : ""}`}
                      detail="Disponível para a cliente em Faturas."
                    />
                    <Check
                      tone={status === "pago" ? "ok" : "wait"}
                      title={
                        status === "pago"
                          ? `Paga${data.pago_em ? ` em ${brDate(data.pago_em)}` : ""}`
                          : "Aguardando pagamento"
                      }
                    />
                  </>
                )}
              </ul>

              <div className="mt-4 flex flex-col gap-2">
                {aberto && (dirty || estadoDoSalvar !== "repouso") ? (
                  // Ocupado não é desabilitado: o foco fica no botão até a releitura, e vai ao link da fatura quando ele sai.
                  // Salvo, ele fica com "Quantidades salvas" até o mês relido chegar, e só então sai.
                  <SaiComOFoco alvo={idDaFatura} pedido={focoQueSegue}>
                    <BotaoDeAcao
                      estado={estadoDoSalvar}
                      icone={<Save aria-hidden="true" />}
                      rotulo="Salvar quantidades"
                      andamento="Salvando…"
                      sucesso="Quantidades salvas"
                      erro="Quantidades não salvas"
                      onClick={handleSave}
                    />
                  </SaiComOFoco>
                ) : null}
                <Button asChild variant="outline">
                  <Link id={idDaFatura} href={`/faturamento/fatura?competencia=${mesNaTela.current}`}>
                    <FileText className="mr-2 h-4 w-4" />
                    {aberto ? "Ver prévia da fatura (PDF)" : "Ver fatura (PDF)"}
                  </Link>
                </Button>
                {aberto ? (
                  <>
                    <Button disabled={!canEmit} onClick={() => setConfirmarEmissao(true)}>
                      <Send className="mr-2 h-4 w-4" />
                      Emitir e publicar para a cliente
                    </Button>
                    <Confirmacao
                      aberta={confirmarEmissao}
                      ocupada={emit.isPending}
                      titulo={`Emitir a fatura de ${competenciaLabel(competencia)}?`}
                      descricao={
                        <>
                          Os valores serão congelados e a fatura não poderá mais ser editada. Ela ficará
                          disponível para a cliente em Faturas. Total:{" "}
                          <strong>{fmtBRL(data.total)}</strong>.
                        </>
                      }
                      confirmar="Emitir"
                      confirmando="Emitindo…"
                      onConfirmar={handleEmit}
                      onFechar={() => setConfirmarEmissao(false)}
                      // Emitida, o "Emitir" sai da tela: o foco vai ao link da fatura, nunca ao body.
                      focoAoFechar={() => document.getElementById(idDaFatura)}
                    />
                  </>
                ) : null}
                {acao?.tipo === "pagar_no_wms" || estadoDoPagar !== "repouso" ? (
                  <SaiComOFoco alvo={idDaFatura} pedido={focoQueSegue}>
                    <BotaoDeAcao
                      variant="outline"
                      estado={estadoDoPagar}
                      icone={<CheckCircle2 aria-hidden="true" />}
                      rotulo="Marcar como paga"
                      andamento="Marcando como paga…"
                      sucesso="Marcada como paga"
                      erro="Não marcada como paga"
                      onClick={handlePay}
                    />
                  </SaiComOFoco>
                ) : null}
                {acao?.tipo === "abrir_no_financeiro" ? (
                  <Button asChild variant="outline">
                    <Link href={acao.href}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {acao.rotulo}
                    </Link>
                  </Button>
                ) : null}
                {acao?.tipo === "nf_vinculada" ? (
                  <p className="text-sm text-muted-foreground">
                    Esta competência já está vinculada a uma nota fiscal. O pagamento precisa ser conciliado com essa nota antes de registrar a baixa.
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
        </>
      )}
    </div>
  );
}

/**
 * O mês ainda lendo (carregamento v2, parte 13d; momento 2): a forma final, com
 * os títulos reais e os blocos no lugar das linhas, do total e das ações. Os
 * blocos entram aos 300 ms, com o brilho de dois ciclos; quem diz o que lê é a
 * linha de estado ("Carregando outubro de 2026…"), que descreve a região
 * ocupada. Os blocos ficam fora da árvore de acessibilidade.
 */
function EsqueletoDoMes({
  visivel,
  idDaLinha,
  automaticos,
  servicos,
}: {
  visivel: boolean;
  idDaLinha: string;
  automaticos: number;
  servicos: number;
}) {
  const fantasmas = { "aria-hidden": true, "data-fantasmas": "", "data-visivel": visivel ? "" : undefined } as const;
  // Um brilho por cartão, nunca um por bloco (seção 5.2): as linhas automáticas, os serviços e o total, a 120 ms um do
  // outro; só depois dos 300 ms, para os dois ciclos caberem nos 5 s do movimento.
  const cartao = (ordem: number, classes: string) => ({
    ...fantasmas,
    className: cn(classes, visivel && "carregando-com-brilho"),
    style: visivel ? ({ "--ordem": String(ordem) } as CSSProperties) : undefined,
  });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true" aria-describedby={idDaLinha}>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-5 pb-2 pt-4">
          <h2 className="text-sm font-semibold">Cobrado automaticamente</h2>
        </div>
        <div {...cartao(0, "space-y-2 px-5 pb-4")}>
          {Array.from({ length: automaticos }, (_, ordem) => (
            <div key={ordem} className="flex min-h-[66px] items-center gap-4 rounded-xl border border-border px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <Esqueleto forma="texto" className="w-40" />
                <Esqueleto forma="texto" className="h-2.5 w-56 max-w-full" />
              </span>
              <Esqueleto forma="texto" className="h-5 w-24" />
            </div>
          ))}
        </div>
        <div className="border-t border-border/60 px-5 pb-2 pt-4">
          <h2 className="text-sm font-semibold">Serviços do mês</h2>
        </div>
        <div {...cartao(1, "divide-y divide-border/40 px-5")}>
          {/* O cabeçalho da tabela dos serviços (Serviço, Qtde, Valor unit., Total, Observação). */}
          <div className="flex h-8 items-center gap-4">
            <Esqueleto forma="texto" className="h-2.5 w-16" />
            <Esqueleto forma="texto" className="ml-auto h-2.5 w-24" />
          </div>
          {Array.from({ length: servicos }, (_, ordem) => (
            <div key={ordem} className="flex h-[53px] items-center gap-4">
              <Esqueleto forma="texto" className="w-40" />
              <Esqueleto forma="bloco" className="ml-auto h-9 w-24" />
              <Esqueleto forma="texto" className="w-20" />
            </div>
          ))}
        </div>
      </section>
      {/* O cartão do total, na anatomia do real: o mês e o estado, o total, a nota, as duas conferências e as ações. */}
      <aside className="order-first lg:order-none lg:self-start">
        <div {...cartao(2, "rounded-lg border-2 border-border bg-card p-5")}>
          <div className="flex h-[22px] items-center justify-between gap-2">
            <Esqueleto forma="texto" className="w-44" />
            <Esqueleto forma="bloco" className="h-5 w-20 rounded-full" />
          </div>
          <div className="mt-1 flex h-9 items-center">
            <Esqueleto forma="bloco" className="h-7 w-40" />
          </div>
          <div className="flex h-4 items-center">
            <Esqueleto forma="texto" className="h-2.5 w-52 max-w-full" />
          </div>
          <div className="mt-4 space-y-2.5">
            {/* As duas conferências: a primeira só com o título, a segunda com o detalhe, como no mês aberto. */}
            {[false, true].map((comDetalhe, ordem) => (
              <div key={ordem} className="flex gap-2.5">
                <Esqueleto forma="bloco" className="mt-0.5 size-4 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="flex h-5 items-center">
                    <Esqueleto forma="texto" className="w-32" />
                  </div>
                  {comDetalhe ? (
                    <div className="flex h-4 items-center">
                      <Esqueleto forma="texto" className="h-2.5 w-40" />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Esqueleto forma="botao" className="w-full" />
            <Esqueleto forma="botao" className="w-full" />
          </div>
        </div>
      </aside>
    </div>
  );
}

function Check({
  tone,
  title,
  detail,
}: {
  tone: "ok" | "warn" | "wait";
  title: string;
  detail?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? TriangleAlert : Clock3;
  return (
    <li className="flex gap-2.5">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "ok" ? "text-success-soft-foreground" : tone === "warn" ? "text-warning-soft-foreground" : "text-info-soft-foreground",
        )}
      />
      <div>
        <div>{title}</div>
        {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  );
}
