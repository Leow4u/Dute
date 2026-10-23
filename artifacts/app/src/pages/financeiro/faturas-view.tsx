import type { ReactNode } from "react";
import { formatarReais } from "@workspace/dominio";
import { Check, Download, FileText, Search, Send, X } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dataBr } from "@/lib/comercial/clientes";
import { FORMAS_DE_PAGAMENTO, FORMA_ROTULO, type FormaDePagamento } from "@/lib/financeiro/a-faturar";
import {
  MEIOS_DE_ENVIO,
  MEIO_ROTULO,
  TITULO_DO_FILTRO,
  acoesDaNf,
  faturasDoFiltro,
  rotuloDaNf,
  rotuloDoMes,
  situacaoDaCobranca,
  textoDaSituacao,
  textoDoPagamento,
  totalDaLista,
  type FaturaDoFinanceiro,
  type FiltroDeFaturas,
  type FormDoEnvio,
  type FormDoPagamento,
  type MeioDeEnvio,
  type PagamentoDaNf,
  type ReceitaPorCliente,
  type SituacaoDaCobranca,
} from "@/lib/financeiro/faturas";
import { hrefDaViaComercial } from "@/lib/financeiro/navegacao";
import { cn } from "@/lib/utils";

/**
 * Financeiro › A receber, Vencidos, Pagos e Faturas (parte 4.2b, no molde de
 * docs/mockups/Financeiro.dc.html), só a apresentação: os dados e as ações
 * chegam por props (pages/financeiro/faturas.tsx). A lista do filtro e o
 * painel da NF aberta: os valores, o envio, os pagamentos (com o estorno) e o
 * cancelamento do registro. Em Pagos, sem NF aberta, a receita do mês por
 * cliente (parte 4.2c). Toda lista exporta para XLSX. Sem legenda: rótulos,
 * dados e ações; uma ação principal, "Registrar pagamento", quando a NF tem
 * saldo.
 */

export type AcoesDasFaturas = {
  buscar: (texto: string) => void;
  abrir: (id: string) => void;
  fechar: () => void;
  editarPagamento: <K extends keyof FormDoPagamento>(campo: K, valor: FormDoPagamento[K]) => void;
  registrarPagamento: () => void;
  editarEnvio: <K extends keyof FormDoEnvio>(campo: K, valor: FormDoEnvio[K]) => void;
  marcarEnviada: () => void;
  pedirEstorno: (pagamentoId: string) => void;
  editarMotivo: (motivo: string) => void;
  confirmarEstorno: () => void;
  pedirCancelamento: () => void;
  confirmarCancelamento: () => void;
  desistir: () => void;
  /** Baixa a lista do filtro (com a busca) em XLSX. */
  exportar: () => void;
  mudarMes: (mes: string) => void;
};

/** A receita por cliente do mês, só em Pagos. `dados` null enquanto carrega. */
export type ReceitaDoMes = { mes: string; dados: ReceitaPorCliente | null; erro: boolean };

export type PainelDaNfAberta = {
  pagamento: FormDoPagamento;
  envio: FormDoEnvio;
  /** O estorno ou o cancelamento pedido, com o motivo digitado. */
  confirmando: { tipo: "estorno"; pagamentoId: string; motivo: string } | { tipo: "cancelamento"; motivo: string } | null;
  erro: string | null;
};

export type FaturasViewProps = {
  filtro: FiltroDeFaturas;
  estado: "carregando" | "erro" | "pronto";
  /** Todas as NFs lidas; o filtro e a busca se aplicam aqui. */
  faturas: FaturaDoFinanceiro[];
  busca: string;
  /** "AAAA-MM-DD" de hoje em São Paulo. */
  hoje: string;
  aberta: FaturaDoFinanceiro | null;
  /** Os pagamentos da NF aberta; null enquanto carregam. */
  pagamentos: PagamentoDaNf[] | null;
  painel: PainelDaNfAberta;
  /** A confirmação da última gravação. */
  resultado: string | null;
  ocupado: boolean;
  acoes: AcoesDasFaturas;
  receita?: ReceitaDoMes | null;
};

const TOM_DA_SITUACAO: Record<SituacaoDaCobranca, string> = {
  a_vencer: "border-border bg-muted text-foreground",
  vencida: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  paga: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelada: "border-border bg-muted text-muted-foreground",
};
const TOM_PARA_ENVIAR = "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
const TOM_OK = "border-success-soft-border bg-success-soft text-success-soft-foreground";

const ROTULO_DE_CAMPO = "block text-xs font-bold text-muted-foreground";
const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50";

const VAZIO_DO_FILTRO: Record<FiltroDeFaturas, string> = {
  a_receber: "Nenhuma NF a receber",
  vencidos: "Nenhuma NF vencida",
  pagos: "Nenhuma NF paga",
  todas: "Nenhuma NF registrada",
};

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", className)}>{children}</span>;
}

function Contador({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className={ROTULO_DE_CAMPO}>
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

function Par({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="font-semibold text-muted-foreground">{rotulo}</dt>
      <dd className={cn("tabular-nums", forte ? "text-base font-extrabold" : "font-bold")}>{valor}</dd>
    </div>
  );
}

function Subtitulo({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}

// --- Lista ---------------------------------------------------------------------------------

function Linha({ fatura, hoje, aberta, primeira, onAbrir }: { fatura: FaturaDoFinanceiro; hoje: string; aberta: boolean; primeira: boolean; onAbrir: (id: string) => void }) {
  const situacao = situacaoDaCobranca(fatura, hoje);
  const paraEnviar = fatura.status === "emitida" && !fatura.enviada && (situacao === "a_vencer" || situacao === "vencida");
  const parcial = fatura.recebidoCents > 0 && fatura.saldoCents > 0;
  return (
    <button
      type="button"
      aria-pressed={aberta}
      onClick={() => onAbrir(fatura.id)}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 px-5 py-3.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        !primeira && "border-t border-muted",
        aberta && "bg-info-soft",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5 sm:row-span-2">
        <span className="text-base font-extrabold tabular-nums">{rotuloDaNf(fatura)}</span>
        <span className="text-sm font-bold">{fatura.cliente}</span>
        <span className="text-xs font-semibold text-muted-foreground">
          {[`Emitida ${dataBr(fatura.nf.emitidaEm)}`, fatura.vencimento ? `vence ${dataBr(fatura.vencimento)}` : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="text-base font-extrabold tabular-nums">{formatarReais(situacao === "a_vencer" || situacao === "vencida" ? fatura.saldoCents : fatura.valorCents)}</span>
        {parcial ? <span className="text-xs font-semibold text-muted-foreground">de {formatarReais(fatura.valorCents)}</span> : null}
      </span>
      {/* No celular, as marcas descem para a linha de baixo; da tela média para cima, ficam sob o valor. */}
      <span className="col-span-2 flex flex-wrap gap-1.5 sm:col-span-1 sm:col-start-2 sm:justify-end">
        {paraEnviar ? <Pill className={TOM_PARA_ENVIAR}>Para enviar</Pill> : null}
        <Pill className={TOM_DA_SITUACAO[situacao]}>{textoDaSituacao(fatura, hoje)}</Pill>
      </span>
    </button>
  );
}

function Lista({ filtro, estado, faturas, busca, hoje, aberta, acoes }: FaturasViewProps) {
  const doFiltro = faturasDoFiltro(faturas, filtro, hoje);
  const lista = faturasDoFiltro(faturas, filtro, hoje, busca);
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar as NFs.</Vazio>;
  else if (!doFiltro.length) conteudo = <Vazio>{VAZIO_DO_FILTRO[filtro]}</Vazio>;
  else if (!lista.length) conteudo = <Vazio>Nenhuma NF encontrada</Vazio>;
  else conteudo = lista.map((fatura, indice) => <Linha key={fatura.id} fatura={fatura} hoje={hoje} aberta={aberta?.id === fatura.id} primeira={indice === 0} onAbrir={acoes.abrir} />);
  return (
    <section aria-label={`NFs: ${TITULO_DO_FILTRO[filtro]}`} className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border px-5 py-3.5">
        <h2 className="text-base font-extrabold">NFs</h2>
        <Contador>{doFiltro.length}</Contador>
        {doFiltro.length ? <span className="ml-auto text-base font-extrabold tabular-nums">{formatarReais(totalDaLista(doFiltro, filtro))}</span> : null}
      </div>
      {conteudo}
    </section>
  );
}

// --- Painel --------------------------------------------------------------------------------

function Pagamentos({ pagamentos, painel, ocupado, acoes, podeEstornar }: { pagamentos: PagamentoDaNf[] | null; painel: PainelDaNfAberta; ocupado: boolean; acoes: AcoesDasFaturas; podeEstornar: boolean }) {
  if (pagamentos === null) return <p className="text-sm font-bold text-muted-foreground">Carregando...</p>;
  if (!pagamentos.length) return <p className="text-sm font-bold text-muted-foreground">Nenhum pagamento</p>;
  return (
    <ul className="flex flex-col gap-2">
      {pagamentos.map((pagamento) => {
        const confirmando = painel.confirmando?.tipo === "estorno" && painel.confirmando.pagamentoId === pagamento.id;
        return (
          <li key={pagamento.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-extrabold tabular-nums", pagamento.estornado && "line-through")}>{formatarReais(pagamento.valorCents)}</span>
                <span className="text-xs font-semibold text-muted-foreground">{textoDoPagamento(pagamento)}</span>
              </div>
              {pagamento.estornado ? (
                <Pill className="border-border bg-muted text-muted-foreground">Estornado</Pill>
              ) : podeEstornar && !confirmando ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => acoes.pedirEstorno(pagamento.id)} disabled={ocupado}>
                  Estornar
                </Button>
              ) : null}
            </div>
            {pagamento.observacao ? <span className="text-xs font-semibold">{pagamento.observacao}</span> : null}
            {pagamento.estornado?.motivo ? <span className="text-xs font-semibold text-muted-foreground">{pagamento.estornado.motivo}</span> : null}
            {confirmando ? <Confirmacao id={`estorno-${pagamento.id}`} rotulo="Motivo do estorno" botao="Confirmar estorno" painel={painel} ocupado={ocupado} acoes={acoes} onConfirmar={acoes.confirmarEstorno} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Confirmacao({ id, rotulo, botao, painel, ocupado, acoes, onConfirmar }: { id: string; rotulo: string; botao: string; painel: PainelDaNfAberta; ocupado: boolean; acoes: AcoesDasFaturas; onConfirmar: () => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Campo id={id} rotulo={rotulo}>
        <Textarea id={id} rows={2} maxLength={300} value={painel.confirmando?.motivo ?? ""} onChange={(evento) => acoes.editarMotivo(evento.target.value)} disabled={ocupado} />
      </Campo>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size="sm" onClick={onConfirmar} disabled={ocupado}>
          {botao}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={acoes.desistir} disabled={ocupado}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

function Painel({ aberta: fatura, hoje, pagamentos, painel, ocupado, acoes }: FaturasViewProps & { aberta: FaturaDoFinanceiro }) {
  const pode = acoesDaNf(fatura);
  const situacao = situacaoDaCobranca(fatura, hoje);
  const formPagamento = painel.pagamento;
  const formEnvio = painel.envio;
  const cancelando = painel.confirmando?.tipo === "cancelamento";
  return (
    <section aria-label={rotuloDaNf(fatura)} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-base font-extrabold tabular-nums">{rotuloDaNf(fatura)}</h2>
          <span className="text-sm font-bold">{fatura.cliente}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar" className="size-8" onClick={acoes.fechar} disabled={ocupado}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Pill className={TOM_DA_SITUACAO[situacao]}>{textoDaSituacao(fatura, hoje)}</Pill>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href={hrefDaViaComercial(fatura.id)}>
            <FileText aria-hidden="true" />
            Via comercial
          </Link>
        </Button>
      </div>

      <dl className="flex flex-col gap-1.5">
        <Par rotulo="Valor da NF" valor={formatarReais(fatura.valorCents)} />
        <Par rotulo="Recebido" valor={formatarReais(fatura.recebidoCents)} />
        <Par rotulo="Saldo" valor={formatarReais(fatura.saldoCents)} forte />
      </dl>
      <dl className="flex flex-col gap-1.5">
        <Par rotulo="Emissão" valor={dataBr(fatura.nf.emitidaEm)} />
        <Par rotulo="Vencimento" valor={dataBr(fatura.vencimento)} />
        <Par rotulo="Forma" valor={FORMA_ROTULO[fatura.forma]} />
      </dl>
      {fatura.observacao ? <p className="text-sm font-semibold">{fatura.observacao}</p> : null}

      <div className="flex flex-col gap-2">
        <Subtitulo>Demandas</Subtitulo>
        <dl className="flex flex-col gap-1.5">
          {fatura.demandas.map((demanda) => (
            <Par key={demanda.numero} rotulo={demanda.numero} valor={formatarReais(demanda.valorCents)} />
          ))}
        </dl>
      </div>

      <div aria-hidden="true" className="h-px bg-muted" />
      <div className="flex flex-col gap-2.5">
        <Subtitulo>Envio</Subtitulo>
        {fatura.enviada ? (
          <p className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold", TOM_OK)}>
            <Send aria-hidden="true" className="size-4 shrink-0" />
            {`${dataBr(fatura.enviada.em)} · ${MEIO_ROTULO[fatura.enviada.meio]}`}
          </p>
        ) : pode.enviar ? (
          <>
            <div className="grid grid-cols-2 gap-3.5">
              <Campo id="envio-dia" rotulo="Enviada em">
                <Input id="envio-dia" type="date" min={fatura.nf.emitidaEm || undefined} max={hoje} value={formEnvio.enviadaEm} onChange={(evento) => acoes.editarEnvio("enviadaEm", evento.target.value)} disabled={ocupado} />
              </Campo>
              <Campo id="envio-meio" rotulo="Meio">
                <select id="envio-meio" className={CAMPO_SELECT} value={formEnvio.meio} onChange={(evento) => acoes.editarEnvio("meio", evento.target.value as MeioDeEnvio)} disabled={ocupado}>
                  {MEIOS_DE_ENVIO.map((meio) => (
                    <option key={meio} value={meio}>
                      {MEIO_ROTULO[meio]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Button type="button" variant="outline" className="self-start" onClick={acoes.marcarEnviada} disabled={ocupado}>
              <Send aria-hidden="true" />
              Marcar como enviada
            </Button>
          </>
        ) : (
          <p className="text-sm font-bold text-muted-foreground">Não enviada</p>
        )}
      </div>

      <div aria-hidden="true" className="h-px bg-muted" />
      <div className="flex flex-col gap-2.5">
        <Subtitulo>Pagamentos</Subtitulo>
        <Pagamentos pagamentos={pagamentos} painel={painel} ocupado={ocupado} acoes={acoes} podeEstornar={fatura.status !== "cancelada"} />
      </div>

      {pode.pagar ? (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <Campo id="pagamento-valor" rotulo="Valor recebido">
              <Input id="pagamento-valor" inputMode="decimal" className="text-right tabular-nums" value={formPagamento.valor} onChange={(evento) => acoes.editarPagamento("valor", evento.target.value)} disabled={ocupado} />
            </Campo>
            <Campo id="pagamento-dia" rotulo="Recebido em">
              <Input id="pagamento-dia" type="date" min={fatura.nf.emitidaEm || undefined} max={hoje} value={formPagamento.recebidoEm} onChange={(evento) => acoes.editarPagamento("recebidoEm", evento.target.value)} disabled={ocupado} />
            </Campo>
          </div>
          <Campo id="pagamento-forma" rotulo="Forma">
            <select id="pagamento-forma" className={CAMPO_SELECT} value={formPagamento.forma} onChange={(evento) => acoes.editarPagamento("forma", evento.target.value as FormaDePagamento)} disabled={ocupado}>
              {FORMAS_DE_PAGAMENTO.map((forma) => (
                <option key={forma} value={forma}>
                  {FORMA_ROTULO[forma]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="pagamento-observacao" rotulo="Observação">
            <Textarea id="pagamento-observacao" rows={2} maxLength={300} value={formPagamento.observacao} onChange={(evento) => acoes.editarPagamento("observacao", evento.target.value)} disabled={ocupado} />
          </Campo>
        </div>
      ) : null}

      {painel.erro ? (
        <p role="alert" className="text-sm font-bold text-destructive">
          {painel.erro}
        </p>
      ) : null}

      {pode.pagar ? (
        <Button type="button" className="self-start" onClick={acoes.registrarPagamento} disabled={ocupado}>
          <Check aria-hidden="true" />
          Registrar pagamento
        </Button>
      ) : null}

      {pode.cancelar ? (
        <>
          <div aria-hidden="true" className="h-px bg-muted" />
          {cancelando ? (
            <Confirmacao id="cancelamento" rotulo="Motivo do cancelamento" botao="Confirmar cancelamento" painel={painel} ocupado={ocupado} acoes={acoes} onConfirmar={acoes.confirmarCancelamento} />
          ) : (
            <Button type="button" variant="destructive" className="self-start" onClick={acoes.pedirCancelamento} disabled={ocupado}>
              Cancelar registro
            </Button>
          )}
        </>
      ) : null}
      {fatura.cancelada ? <p className="text-sm font-semibold text-muted-foreground">{fatura.cancelada.motivo}</p> : null}
    </section>
  );
}

// --- Receita por cliente ------------------------------------------------------------------

function Receita({ receita, hoje, acoes }: { receita: ReceitaDoMes; hoje: string; acoes: AcoesDasFaturas }) {
  const mes = rotuloDoMes(receita.mes);
  const dados = receita.dados;
  let conteudo: ReactNode;
  if (receita.erro) conteudo = <p className="text-sm font-bold text-muted-foreground">Não foi possível carregar os pagamentos.</p>;
  else if (!dados) conteudo = <p className="text-sm font-bold text-muted-foreground">Carregando...</p>;
  else if (!dados.pagamentos) conteudo = <p className="text-sm font-bold text-muted-foreground">{`Nenhum pagamento em ${mes}`}</p>;
  else {
    conteudo = (
      <>
        <dl className="flex flex-col gap-1.5">
          {dados.linhas.map((linha) => (
            <Par key={linha.customerCode} rotulo={linha.cliente} valor={formatarReais(linha.cents)} />
          ))}
          {dados.outros ? <Par rotulo={`Outros ${dados.outros.clientes} clientes`} valor={formatarReais(dados.outros.cents)} /> : null}
        </dl>
        <div aria-hidden="true" className="h-px bg-muted" />
        <dl className="flex flex-col gap-1.5">
          <Par rotulo={`Recebido em ${mes}`} valor={formatarReais(dados.totalCents)} forte />
          <Par rotulo="Pagamentos" valor={String(dados.pagamentos)} />
        </dl>
      </>
    );
  }
  return (
    <section aria-label="Receita por cliente" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0">
      <h2 className="text-base font-extrabold">Receita por cliente</h2>
      <Campo id="receita-mes" rotulo="Mês">
        <Input id="receita-mes" type="month" max={hoje.slice(0, 7)} value={receita.mes} onChange={(evento) => acoes.mudarMes(evento.target.value)} />
      </Campo>
      {conteudo}
    </section>
  );
}

// --- Tela ----------------------------------------------------------------------------------

export function FaturasView(props: FaturasViewProps) {
  const { filtro, estado, faturas, busca, hoje, aberta, resultado, acoes, receita } = props;
  const exporta = estado === "pronto" && faturasDoFiltro(faturas, filtro, hoje, busca).length > 0;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">{TITULO_DO_FILTRO[filtro]}</h1>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:ml-auto md:w-auto">
          <label className="relative block min-w-0 flex-1 md:w-72 md:flex-none">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Buscar" placeholder="Buscar NF, cliente ou demanda" value={busca} onChange={(evento) => acoes.buscar(evento.target.value)} className="pl-9" />
          </label>
          {exporta ? (
            <Button type="button" variant="outline" onClick={acoes.exportar}>
              <Download aria-hidden="true" />
              Exportar XLSX
            </Button>
          ) : null}
        </div>
      </header>
      {resultado ? (
        <div role="status" className={cn("flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-bold", TOM_OK)}>
          <Check aria-hidden="true" className="size-4.5 shrink-0" />
          {resultado}
        </div>
      ) : null}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <Lista {...props} />
        {aberta ? <Painel {...props} aberta={aberta} /> : receita ? <Receita receita={receita} hoje={hoje} acoes={acoes} /> : null}
      </div>
    </div>
  );
}
