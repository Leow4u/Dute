import type { ReactNode } from "react";
import { formatarReais } from "@workspace/dominio";
import { AlertTriangle, Check, Clock, FileText, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DIAS_PARA_FATURAR,
  FORMAS_DE_PAGAMENTO,
  FORMA_ROTULO,
  SITUACAO_ROTULO,
  VIAS_DA_NF,
  VIA_ROTULO,
  diasNaEtapa,
  filtrarLinhas,
  gruposPorCliente,
  podeMarcarNaNf,
  rotuloDaLinha,
  totalDasMarcadas,
  type FormDaNf,
  type FormaDePagamento,
  type LinhaAFaturar,
  type ViaDaNf,
} from "@/lib/financeiro/a-faturar";
import { cn } from "@/lib/utils";

/**
 * Financeiro › A faturar (parte 4.1b, no molde de docs/mockups/Financeiro.dc.html
 * e ComAutorizacoes.dc.html), só a apresentação: os dados e as ações chegam
 * por props (pages/financeiro/a-faturar.tsx). As demandas prontas, a
 * armazenagem emitida no WMS (parte 7.2b) e a medição aprovada (pergunta 64,
 * o canvas "Telas das decisões de 26/10", item 7), por cliente, as que
 * esperam e o painel de registrar a NF, com a medição linha por linha. Onde a NFS-e sai pela Omie (parte 7.4e), o
 * painel escolhe a via: pela Omie, que numera e emite, ou emitida fora (o
 * CT-e), registrada como antes. Sem legenda: rótulos, dados e ações; uma
 * ação principal, "Emitir pela Omie" ou "Registrar NF".
 */

export type AcoesDoAFaturar = {
  buscar: (texto: string) => void;
  abrirPainel: () => void;
  fecharPainel: () => void;
  /** Marca ou desmarca a linha na NF: o número da demanda ou o período da armazenagem. */
  marcar: (numero: string) => void;
  editar: <K extends keyof FormDaNf>(campo: K, valor: FormDaNf[K]) => void;
  registrar: () => void;
};

export type PainelDaNf = {
  aberto: boolean;
  /** As linhas marcadas: o número da demanda ou o período da armazenagem. */
  marcadas: string[];
  form: FormDaNf;
  /** A confirmação do último registro. */
  resultado: string | null;
  erro: string | null;
};

export type AFaturarViewProps = {
  estado: "carregando" | "erro" | "pronto";
  /** A fila inteira (linhaAFaturar); a busca se aplica aqui. */
  linhas: LinhaAFaturar[];
  busca: string;
  painel: PainelDaNf;
  /** "AAAA-MM-DD" de hoje em São Paulo: o limite da emissão. */
  hoje: string;
  agora: Date;
  /** Uma gravação em andamento: as ações esperam. */
  ocupado: boolean;
  /** A emissão pela Omie está liberada neste ambiente (OMIE_LIBERADA). */
  omie?: boolean;
  acoes: AcoesDoAFaturar;
};

const TOM_ATRASADA = "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
const TOM_ESPERANDO = "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
const TOM_OK = "border-success-soft-border bg-success-soft text-success-soft-foreground";

const ROTULO_DE_CAMPO = "block text-xs font-bold text-muted-foreground";
const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50";

/** Centavos em reais; o valor ainda não lido aparece como traço. */
function reais(centavos: number | null): string {
  return centavos === null ? "—" : formatarReais(centavos);
}

function textoDosDias(dias: number): string {
  if (dias === 0) return "hoje";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
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

function Caixa({ children }: { children: ReactNode }) {
  return (
    <div role="status" className={cn("flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-bold", TOM_OK)}>
      <Check aria-hidden="true" className="size-4.5 shrink-0" />
      {children}
    </div>
  );
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

function Descricao({ linha, cliente }: { linha: LinhaAFaturar; cliente: boolean }) {
  const detalhe = [cliente ? linha.demanda.cliente : null, linha.origem, linha.autorizacaoTexto].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-base font-extrabold tabular-nums">{rotuloDaLinha(linha)}</span>
      {linha.demanda.titulo ? <span className="text-sm font-bold">{linha.demanda.titulo}</span> : null}
      <span className="text-xs font-semibold text-muted-foreground">{detalhe}</span>
      {linha.resumo ? <span className="text-xs font-semibold text-muted-foreground">{linha.resumo}</span> : null}
    </div>
  );
}

/** A medição no painel: as demandas dela e as linhas sem demanda, cada uma com o valor. */
function Composicao({ linha }: { linha: LinhaAFaturar }) {
  if (!linha.composicao.length) return null;
  return (
    <ul aria-label={`Na NF da ${rotuloDaLinha(linha)}`} className="ml-3 border-l border-border pl-3">
      {linha.composicao.map((item) => (
        <li key={item.chave} className="flex items-baseline justify-between gap-3 border-t border-muted py-1.5 first:border-t-0">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-bold tabular-nums">{item.rotulo}</span>
            {item.detalhe ? <span className="truncate text-xs font-semibold text-muted-foreground">{item.detalhe}</span> : null}
          </span>
          <span className="text-sm font-bold tabular-nums">{formatarReais(item.valorCents)}</span>
        </li>
      ))}
    </ul>
  );
}

// --- Prontas -------------------------------------------------------------------------------

function Pronta({
  linha,
  primeira,
  marcando,
  marcada,
  cabe,
  agora,
  onMarcar,
}: {
  linha: LinhaAFaturar;
  primeira: boolean;
  marcando: boolean;
  marcada: boolean;
  cabe: boolean;
  agora: Date;
  onMarcar: (numero: string) => void;
}) {
  const dias = diasNaEtapa(linha, agora);
  return (
    <div className={cn("flex items-start gap-3.5 px-5 py-3.5", !primeira && "border-t border-muted", marcada && "bg-info-soft")}>
      {marcando ? (
        cabe ? (
          <Checkbox checked={marcada} onCheckedChange={() => onMarcar(linha.demanda.numero)} aria-label={`Incluir ${rotuloDaLinha(linha)}`} className="mt-1 size-4.5" />
        ) : (
          <span aria-hidden="true" className="w-4.5 shrink-0" />
        )
      ) : null}
      <Descricao linha={linha} cliente={false} />
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-base font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
        {dias !== null ? (
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold",
              dias > DIAS_PARA_FATURAR ? TOM_ATRASADA : TOM_ESPERANDO,
            )}
          >
            <Clock aria-hidden="true" className="size-3.5" />
            {textoDosDias(dias)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Prontas({ estado, linhas, busca, painel, agora, acoes, marcando }: AFaturarViewProps & { marcando: boolean }) {
  const prontas = linhas.filter((linha) => linha.situacao === "pronta");
  const filtradas = filtrarLinhas(prontas, busca);
  const grupos = gruposPorCliente(filtradas);
  const marcadas = prontas.filter((linha) => painel.marcadas.includes(linha.demanda.numero));
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar a fila.</Vazio>;
  else if (!prontas.length) conteudo = <Vazio>Nada a faturar</Vazio>;
  else if (!grupos.length) conteudo = <Vazio>Nada encontrado</Vazio>;
  else {
    conteudo = grupos.map((grupo, indice) => (
      <div key={grupo.customerCode} role="group" aria-label={grupo.cliente} className={cn(indice > 0 && "border-t border-border")}>
        <div className="flex items-center gap-2.5 border-b border-border bg-background px-5 py-2.5">
          <h3 className="text-xs font-extrabold uppercase tracking-wider">{grupo.cliente}</h3>
          <Contador>{grupo.linhas.length}</Contador>
          <span className="ml-auto text-sm font-extrabold tabular-nums">{reais(grupo.totalCents)}</span>
        </div>
        {grupo.linhas.map((linha, posicao) => (
          <Pronta
            key={linha.demanda.numero}
            linha={linha}
            primeira={posicao === 0}
            marcando={marcando}
            marcada={painel.marcadas.includes(linha.demanda.numero)}
            cabe={podeMarcarNaNf(linha, marcadas)}
            agora={agora}
            onMarcar={acoes.marcar}
          />
        ))}
      </div>
    ));
  }
  return (
    <section aria-label="Prontas para faturar" className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border px-5 py-3.5">
        <h2 className="text-base font-extrabold">Prontas para faturar</h2>
        <Contador>{prontas.length}</Contador>
        {prontas.length ? <span className="ml-auto text-base font-extrabold tabular-nums">{formatarReais(totalDasMarcadas(prontas))}</span> : null}
      </div>
      {conteudo}
    </section>
  );
}

// --- Painel --------------------------------------------------------------------------------

function Painel({ linhas, painel, hoje, ocupado, omie = false, acoes }: AFaturarViewProps) {
  const marcadas = linhas.filter((linha) => linha.situacao === "pronta" && painel.marcadas.includes(linha.demanda.numero));
  const primeira = marcadas[0] ?? null;
  const form = painel.form;
  const campo =
    <K extends keyof FormDaNf>(nome: K) =>
    (evento: { target: { value: string } }) =>
      acoes.editar(nome, evento.target.value as FormDaNf[K]);

  const pelaOmie = omie && form.via === "omie";
  const titulo = omie ? "Faturar" : "Registrar NF";

  return (
    <section aria-label={titulo} className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0">
      <div className="flex items-center gap-2.5">
        <h2 className="text-base font-extrabold">{titulo}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar" className="ml-auto size-8" onClick={acoes.fecharPainel} disabled={ocupado}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {primeira ? (
        <div className="min-w-0 space-y-1.5">
          <span className={ROTULO_DE_CAMPO}>Cliente</span>
          <div className="flex min-h-10 items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-bold">{primeira.demanda.cliente}</div>
        </div>
      ) : null}

      {omie ? (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className={ROTULO_DE_CAMPO}>Como a NF sai</legend>
          <div className="grid grid-cols-2 gap-2">
            {VIAS_DA_NF.map((via) => (
              <label
                key={via}
                className={cn(
                  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-bold focus-within:ring-2 focus-within:ring-ring/40",
                  form.via === via ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <input type="radio" name="nf-via" className="sr-only" checked={form.via === via} onChange={() => acoes.editar("via", via as ViaDaNf)} disabled={ocupado} />
                {VIA_ROTULO[via]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {pelaOmie ? (
        <Campo id="nf-vencimento" rotulo="Vencimento">
          <Input id="nf-vencimento" type="date" min={hoje} value={form.vencimento} onChange={campo("vencimento")} disabled={ocupado} />
        </Campo>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3.5">
            <Campo id="nf-numero" rotulo="Número da NF" className="col-span-2">
              <Input id="nf-numero" inputMode="numeric" autoComplete="off" value={form.numero} onChange={campo("numero")} disabled={ocupado} />
            </Campo>
            <Campo id="nf-serie" rotulo="Série">
              <Input id="nf-serie" autoComplete="off" value={form.serie} onChange={campo("serie")} disabled={ocupado} />
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Campo id="nf-emissao" rotulo="Emissão">
              <Input id="nf-emissao" type="date" max={hoje} value={form.emissao} onChange={campo("emissao")} disabled={ocupado} />
            </Campo>
            <Campo id="nf-vencimento" rotulo="Vencimento">
              <Input id="nf-vencimento" type="date" min={form.emissao || undefined} value={form.vencimento} onChange={campo("vencimento")} disabled={ocupado} />
            </Campo>
          </div>
        </>
      )}
      <Campo id="nf-forma" rotulo="Forma de pagamento">
        <select
          id="nf-forma"
          className={CAMPO_SELECT}
          value={form.forma}
          onChange={(evento) => acoes.editar("forma", evento.target.value as FormaDePagamento)}
          disabled={ocupado}
        >
          {FORMAS_DE_PAGAMENTO.map((forma) => (
            <option key={forma} value={forma}>
              {FORMA_ROTULO[forma]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="nf-observacao" rotulo="Observação">
        <Textarea id="nf-observacao" rows={2} maxLength={300} value={form.observacao} onChange={campo("observacao")} disabled={ocupado} />
      </Campo>

      <div aria-hidden="true" className="h-px bg-muted" />
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Na NF</h3>
        <Pill>{marcadas.length}</Pill>
      </div>
      {marcadas.map((linha) => (
        <div key={linha.demanda.numero} className="flex flex-col gap-1 rounded-md border border-border py-2 pl-3 pr-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="text-sm font-extrabold tabular-nums">{rotuloDaLinha(linha)}</b>
              {linha.demanda.titulo ? <span className="truncate text-xs font-semibold text-muted-foreground">{linha.demanda.titulo}</span> : null}
            </div>
            <span className="text-sm font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Tirar ${rotuloDaLinha(linha)}`}
              className="size-8"
              onClick={() => acoes.marcar(linha.demanda.numero)}
              disabled={ocupado}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <Composicao linha={linha} />
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-muted-foreground">Total da NF</span>
        <b className="font-extrabold tabular-nums">{formatarReais(totalDasMarcadas(marcadas))}</b>
      </div>
      {painel.erro ? (
        <p role="alert" className="text-sm font-bold text-destructive">
          {painel.erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" onClick={acoes.registrar} disabled={ocupado || marcadas.length === 0}>
          <Check aria-hidden="true" />
          {pelaOmie ? "Emitir pela Omie" : "Registrar NF"}
        </Button>
        <Button type="button" variant="outline" onClick={acoes.fecharPainel} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

// --- Esperando -----------------------------------------------------------------------------

function Esperando({ linhas, busca }: AFaturarViewProps) {
  const esperando = filtrarLinhas(
    linhas.filter((linha) => linha.situacao !== "pronta"),
    busca,
  ).sort((a, b) => a.demanda.cliente.localeCompare(b.demanda.cliente, "pt-BR") || a.demanda.numero.localeCompare(b.demanda.numero));
  if (!esperando.length) return null;
  return (
    <section aria-label="Esperando" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-background px-5 py-2.5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Esperando</h2>
        <Contador>{esperando.length}</Contador>
      </div>
      {esperando.map((linha, indice) => (
        <div key={linha.demanda.numero} className={cn("flex flex-wrap items-start gap-x-4.5 gap-y-2 px-5 py-3.5", indice > 0 && "border-t border-muted")}>
          <Descricao linha={linha} cliente />
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-base font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
            {linha.situacao !== "pronta" ? (
              <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM_ESPERANDO)}>
                <AlertTriangle aria-hidden="true" className="size-3.5" />
                {SITUACAO_ROTULO[linha.situacao]}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

// --- Tela ----------------------------------------------------------------------------------

export function AFaturarView(props: AFaturarViewProps) {
  const { estado, linhas, busca, painel, ocupado, acoes } = props;
  const temProntas = estado === "pronto" && linhas.some((linha) => linha.situacao === "pronta");
  const painelAberto = painel.aberto && temProntas;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">A faturar</h1>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:ml-auto md:w-auto">
          <label className="relative block min-w-0 flex-1 md:w-72 md:flex-none">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Buscar"
              placeholder="Buscar demanda, cliente ou pedido"
              value={busca}
              onChange={(evento) => acoes.buscar(evento.target.value)}
              className="pl-9"
            />
          </label>
          {temProntas && !painel.aberto ? (
            <Button type="button" variant="outline" onClick={acoes.abrirPainel} disabled={ocupado}>
              <FileText aria-hidden="true" />
              {props.omie ? "Faturar" : "Registrar NF"}
            </Button>
          ) : null}
        </div>
      </header>
      {!painelAberto && painel.resultado ? <Caixa>{painel.resultado}</Caixa> : null}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <Prontas {...props} marcando={painelAberto} />
        {painelAberto ? <Painel {...props} /> : null}
      </div>
      {estado === "pronto" ? <Esperando {...props} /> : null}
    </div>
  );
}
