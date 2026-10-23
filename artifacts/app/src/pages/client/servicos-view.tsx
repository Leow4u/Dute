import type { FormEvent, ReactNode } from "react";
import { formatarReais } from "@workspace/dominio";
import { Check, FileText, Paperclip, Plus, Search, X } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SituacaoDaCobranca } from "@/lib/financeiro/faturas";
import { hrefDoComprovante } from "@/lib/portal/comprovante";
import { SITUACAO_NO_PORTAL_ROTULO, type CobrancaDaOs, type NumerosDoPortal, type OsDoPortal, type SituacaoNoPortal } from "@/lib/portal/servicos";
import {
  MAX_ANEXOS,
  SITUACAO_DA_SOLICITACAO_ROTULO,
  TIPOS_DE_SERVICO,
  TIPO_DE_SERVICO_ROTULO,
  detalheDaSolicitacao,
  tituloDaSolicitacao,
  type FormularioDaSolicitacao,
  type ProblemasDaSolicitacao,
  type SituacaoDaSolicitacao,
  type SolicitacaoDoPortal,
  type TipoDeServico,
} from "@/lib/portal/solicitacao";
import { cn } from "@/lib/utils";

/**
 * Portal › Minhas OS (parte 4.3b, no molde de docs/mockups/Portal.dc.html),
 * só a apresentação: os dados chegam por props (pages/client/servicos.tsx).
 * Os números, a lista das OS do cliente e o andamento da OS aberta, com a NF
 * da demanda quando o cliente tem as faturas no contrato. Com a Operação
 * liberada, "Solicitar OS" (parte 4.4b) abre o formulário no lugar do painel
 * e as solicitações em aberto aparecem antes das OS. Conteúdo na identidade
 * v3 (.v3) dentro do layout do portal. Sem legenda: rótulos, dados e ações.
 */

/** O formulário de Solicitar OS na tela; null quando o cliente não pede por aqui. */
export type PedidoNaTela = {
  aberto: boolean;
  form: FormularioDaSolicitacao;
  /** O que falta, mostrado depois da primeira tentativa de enviar. */
  problemas: ProblemasDaSolicitacao;
  enviando: boolean;
  erro: string | null;
  problemaDoAnexo: string | null;
  /** A solicitação acabou de sair. */
  enviada: boolean;
  /** O primeiro dia que o campo de data aceita (aaaa-mm-dd). */
  hoje: string;
};

export type ServicosViewProps = {
  estado: "carregando" | "erro" | "pronto";
  /** As OS já ordenadas (ordenarOs). */
  os: OsDoPortal[];
  numeros: NumerosDoPortal;
  /** O que falta pagar nas NFs abertas; null sem as faturas no contrato. */
  aPagarCents: number | null;
  /** A NF de cada demanda (cobrancaPorDemanda). */
  cobrancas: ReadonlyMap<string, CobrancaDaOs>;
  busca: string;
  aberta: OsDoPortal | null;
  /** As solicitações em aberto (solicitacoesEmAberto). */
  solicitacoes: SolicitacaoDoPortal[];
  pedido: PedidoNaTela | null;
  acoes: {
    buscar: (texto: string) => void;
    abrir: (numero: string) => void;
    fechar: () => void;
    solicitar: () => void;
    mudar: (form: FormularioDaSolicitacao) => void;
    anexar: (arquivos: File[]) => void;
    removerAnexo: (indice: number) => void;
    enviar: () => void;
    cancelar: () => void;
  };
};

const TOM_DA_SOLICITACAO: Record<SituacaoDaSolicitacao, string> = {
  aguardando: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  em_planejamento: "border-violet-soft-border bg-violet-soft text-violet-soft-foreground",
  nao_atendida: "border-border bg-muted text-muted-foreground",
};

const TOM_DA_SITUACAO: Record<SituacaoNoPortal, string> = {
  para_agendar: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  agendada: "border-violet-soft-border bg-violet-soft text-violet-soft-foreground",
  em_execucao: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  concluida: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelada: "border-border bg-muted text-muted-foreground",
};

const TOM_DA_COBRANCA: Record<SituacaoDaCobranca, string> = {
  a_vencer: "border-border bg-muted text-foreground",
  vencida: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  paga: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelada: "border-border bg-muted text-muted-foreground",
};

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", className)}>{children}</span>;
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-5 py-4">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      <span className="text-xl font-extrabold tabular-nums sm:text-2xl">{valor}</span>
    </div>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-bold text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-bold">{valor}</dd>
    </div>
  );
}

function Linha({ os, cobranca, aberta, primeira, onAbrir }: { os: OsDoPortal; cobranca: CobrancaDaOs | null; aberta: boolean; primeira: boolean; onAbrir: (numero: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={aberta}
      onClick={() => onAbrir(os.numero)}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 px-5 py-3.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        !primeira && "border-t border-muted",
        aberta && "bg-info-soft",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-extrabold tabular-nums">OS {os.numero}</span>
        <span className="text-sm font-bold">{os.servicos}</span>
        {os.janela ? <span className="text-xs font-semibold text-muted-foreground">{os.janela}</span> : null}
      </span>
      <span className="flex flex-wrap items-start justify-end gap-1.5">
        <Pill className={TOM_DA_SITUACAO[os.situacao]}>{SITUACAO_NO_PORTAL_ROTULO[os.situacao]}</Pill>
        {cobranca ? <Pill className={TOM_DA_COBRANCA[cobranca.situacao]}>{cobranca.texto}</Pill> : null}
      </span>
    </button>
  );
}

function Andamento({ os }: { os: OsDoPortal }) {
  return (
    <ol className="flex flex-col gap-3">
      {os.andamento.map((marco, indice) => (
        <li key={marco.titulo} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-extrabold",
              marco.feito ? "border-success-soft-border bg-success-soft text-success-soft-foreground" : "border-border bg-card text-muted-foreground",
            )}
          >
            {marco.feito ? <Check className="size-3.5" /> : indice + 1}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className={cn("text-sm font-extrabold", !marco.feito && "text-muted-foreground")}>{marco.titulo}</span>
            {marco.detalhe ? <span className="text-xs font-semibold text-muted-foreground">{marco.detalhe}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Painel({ os, cobranca, onFechar }: { os: OsDoPortal; cobranca: CobrancaDaOs | null; onFechar: () => void }) {
  return (
    <section aria-label={`OS ${os.numero}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-base font-extrabold tabular-nums">OS {os.numero}</h2>
          <span className="text-sm font-bold">{os.servicos}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar" className="size-8" onClick={onFechar}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <Pill className={cn("self-start", TOM_DA_SITUACAO[os.situacao])}>{SITUACAO_NO_PORTAL_ROTULO[os.situacao]}</Pill>
      {os.andamento.length ? <Andamento os={os} /> : null}
      <dl className="flex flex-col gap-3">
        {os.janela ? <Par rotulo="Data" valor={os.janela} /> : null}
        {os.origem ? <Par rotulo="Origem" valor={os.origem} /> : null}
        {os.destino ? <Par rotulo="Destino" valor={os.destino} /> : null}
        {os.motorista ? <Par rotulo="Motorista" valor={os.motorista} /> : null}
        {os.recebimento ? <Par rotulo="Recebimento" valor={os.recebimento} /> : null}
        {cobranca ? <Par rotulo="Faturamento" valor={cobranca.texto} /> : null}
      </dl>
      {os.comprovante ? (
        <Button asChild variant="outline" className="h-11 self-start">
          <Link href={hrefDoComprovante(os.numero)}>
            <FileText aria-hidden="true" />
            Comprovante
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

function Solicitacoes({ lista, enviada }: { lista: SolicitacaoDoPortal[]; enviada: boolean }) {
  return (
    <section aria-label="Solicitações" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-muted px-5 py-3.5">
        <h2 className="text-base font-extrabold">Solicitações</h2>
        {enviada ? (
          <p role="status" className="text-sm font-bold text-success-soft-foreground">
            Solicitação enviada
          </p>
        ) : null}
      </div>
      <ul>
        {lista.map((item, indice) => {
          const detalhe = detalheDaSolicitacao(item);
          return (
            <li key={item.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1 px-5 py-3.5", indice > 0 && "border-t border-muted")}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-extrabold">{tituloDaSolicitacao(item)}</span>
                <span className="truncate text-xs font-semibold text-muted-foreground">{[item.origem, item.destino].filter(Boolean).join(" → ")}</span>
                {detalhe ? <span className="text-xs font-semibold">{detalhe}</span> : null}
              </span>
              <span className="flex items-start">
                <Pill className={TOM_DA_SOLICITACAO[item.situacao]}>{SITUACAO_DA_SOLICITACAO_ROTULO[item.situacao]}</Pill>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, problema, children }: { id: string; rotulo: string; problema?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {problema ? (
        <p id={`${id}-problema`} className="text-xs font-semibold text-destructive-soft-foreground">
          {problema}
        </p>
      ) : null}
    </div>
  );
}

function Formulario({ pedido, acoes }: { pedido: PedidoNaTela; acoes: ServicosViewProps["acoes"] }) {
  const { form, problemas } = pedido;
  const set = <K extends keyof FormularioDaSolicitacao>(campo: K, valor: FormularioDaSolicitacao[K]) => acoes.mudar({ ...form, [campo]: valor });
  const invalido = (campo: keyof ProblemasDaSolicitacao, id: string) => (problemas[campo] ? { "aria-invalid": true, "aria-describedby": `${id}-problema` } : {});
  return (
    <form
      aria-label="Solicitar OS"
      noValidate
      className="order-first flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5 xl:order-none xl:w-96 xl:shrink-0"
      onSubmit={(evento: FormEvent) => {
        evento.preventDefault();
        acoes.enviar();
      }}
    >
      <div className="flex items-start gap-2.5">
        <h2 className="flex-1 text-base font-extrabold">Solicitar OS</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar" className="size-8" onClick={acoes.cancelar}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <Campo id="solicitar-tipo" rotulo="Tipo de serviço">
        <select id="solicitar-tipo" className={campoClasse} value={form.tipo} onChange={(evento) => set("tipo", evento.target.value as TipoDeServico)}>
          {TIPOS_DE_SERVICO.map((tipo) => (
            <option key={tipo} value={tipo}>
              {TIPO_DE_SERVICO_ROTULO[tipo]}
            </option>
          ))}
        </select>
      </Campo>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <Campo id="solicitar-data" rotulo="Data">
            <Input id="solicitar-data" type="date" min={pedido.hoje} value={form.data} onChange={(evento) => set("data", evento.target.value)} {...invalido("quando", "solicitar-quando")} />
          </Campo>
          <Campo id="solicitar-horario" rotulo="Horário">
            <Input id="solicitar-horario" type="time" value={form.horario} onChange={(evento) => set("horario", evento.target.value)} {...invalido("quando", "solicitar-quando")} />
          </Campo>
        </div>
        {problemas.quando ? (
          <p id="solicitar-quando-problema" className="text-xs font-semibold text-destructive-soft-foreground">
            {problemas.quando}
          </p>
        ) : null}
      </div>
      <Campo id="solicitar-origem" rotulo="Origem" problema={problemas.origem}>
        <Input id="solicitar-origem" autoComplete="street-address" value={form.origem} onChange={(evento) => set("origem", evento.target.value)} {...invalido("origem", "solicitar-origem")} />
      </Campo>
      <Campo id="solicitar-destino" rotulo="Destino">
        <Input id="solicitar-destino" value={form.destino} onChange={(evento) => set("destino", evento.target.value)} />
      </Campo>
      <Campo id="solicitar-descricao" rotulo="O que será feito" problema={problemas.descricao}>
        <Textarea id="solicitar-descricao" rows={3} value={form.descricao} onChange={(evento) => set("descricao", evento.target.value)} {...invalido("descricao", "solicitar-descricao")} />
      </Campo>
      <div className="flex flex-wrap items-center gap-2">
        {form.anexos.map((anexo, indice) => (
          <span key={anexo.nome} className="inline-flex h-8 max-w-full items-center gap-1 rounded-md border border-border bg-muted pl-2.5 text-xs font-medium">
            <span className="truncate">{anexo.rotulo}</span>
            <button type="button" aria-label={`Tirar ${anexo.rotulo}`} onClick={() => acoes.removerAnexo(indice)} className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-background">
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        ))}
        {form.anexos.length < MAX_ANEXOS ? (
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted focus-within:ring-2 focus-within:ring-ring/40">
            <Paperclip aria-hidden="true" className="size-4" />
            Anexar nota fiscal ou documento
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(evento) => {
                acoes.anexar(Array.from(evento.target.files ?? []));
                evento.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
      {pedido.problemaDoAnexo || pedido.erro ? (
        <p role="alert" className="text-sm font-semibold text-destructive-soft-foreground">
          {pedido.problemaDoAnexo ?? pedido.erro}
        </p>
      ) : null}
      <Button type="submit" className="h-11 w-full" disabled={pedido.enviando}>
        {pedido.enviando ? "Enviando..." : "Enviar solicitação"}
      </Button>
    </form>
  );
}

export function ServicosView({ estado, os, numeros, aPagarCents, cobrancas, busca, aberta, solicitacoes, pedido, acoes }: ServicosViewProps) {
  const termo = semAcento(busca.trim());
  const lista = termo ? os.filter((item) => [item.numero, item.servicos, item.origem ?? "", item.destino ?? ""].some((campo) => semAcento(campo).includes(termo))) : os;
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">Carregando...</p>;
  else if (estado === "erro") conteudo = <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">Não foi possível carregar as OS.</p>;
  else if (!os.length) conteudo = <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">Nenhuma OS ainda</p>;
  else if (!lista.length) conteudo = <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">Nenhuma OS encontrada</p>;
  else conteudo = lista.map((item, indice) => <Linha key={item.numero} os={item} cobranca={cobrancas.get(item.demanda) ?? null} aberta={aberta?.numero === item.numero} primeira={indice === 0} onAbrir={acoes.abrir} />);
  return (
    <div className="v3 mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Minhas OS</h1>
        <label className="relative block w-full min-w-0 md:ml-auto md:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Buscar" placeholder="Buscar OS, serviço ou endereço" value={busca} onChange={(evento) => acoes.buscar(evento.target.value)} className="pl-9" />
        </label>
        {pedido && !pedido.aberto ? (
          <Button type="button" className="w-full md:w-auto" onClick={acoes.solicitar}>
            <Plus aria-hidden="true" />
            Solicitar OS
          </Button>
        ) : null}
      </header>
      {estado === "pronto" ? (
        <section aria-label="Números" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero rotulo="Em execução" valor={String(numeros.emAndamento)} />
          <Numero rotulo="Agendadas" valor={String(numeros.agendadas)} />
          <Numero rotulo="Concluídas" valor={String(numeros.concluidas)} />
          {aPagarCents !== null ? <Numero rotulo="A pagar" valor={formatarReais(aPagarCents)} /> : null}
        </section>
      ) : null}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {solicitacoes.length ? <Solicitacoes lista={solicitacoes} enviada={Boolean(pedido?.enviada)} /> : null}
          <section aria-label="OS" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            {conteudo}
          </section>
        </div>
        {pedido?.aberto ? (
          <Formulario pedido={pedido} acoes={acoes} />
        ) : aberta ? (
          <Painel os={aberta} cobranca={cobrancas.get(aberta.demanda) ?? null} onFechar={acoes.fechar} />
        ) : null}
      </div>
    </div>
  );
}
