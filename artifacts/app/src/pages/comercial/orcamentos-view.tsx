import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, FilePlus, FileText, MapPin, Plus, Search, Send, User } from "lucide-react";

import { formatarReais } from "@workspace/dominio";

import { AcoesDepoisDoEnvio } from "@/components/comercial/acoes-depois-do-envio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dataBr, type ContratoResumo } from "@/lib/comercial/clientes";
import { ROTULO_DA_ACAO, type AcaoDepoisDoEnvio, type AcoesDaEtapa } from "@/lib/comercial/depois-do-envio";
import { hrefDoDocumento } from "@/lib/comercial/documento";
import { ROTULO_DO_ENVIO, type AcaoDeEnvio } from "@/lib/comercial/envio";
import {
  ETAPA_ROTULO,
  SEGMENTOS_DA_FILA,
  SEGMENTO_ROTULO,
  tipoDoItem,
  acaoDaEtapa,
  contarSegmentos,
  corDaEtapa,
  diasNaEtapa,
  filtrarFila,
  historicoDoOrcamento,
  hrefDoOrcamento,
  linhasPorOrigem,
  pontoDaEtapa,
  rotuloDoContratoDoOrcamento,
  tempoNaEtapa,
  type EtapaDemanda,
  type ItemDaFila,
  type OrigemLinha,
  type SegmentoDaFila,
} from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

import { SeloProspect } from "./clientes-view";

/**
 * Comercial › Orçamentos: a fila por etapa (docs/mockups/ComFila.dc.html),
 * só a apresentação; os dados e as ações chegam por props
 * (pages/comercial/orcamentos.tsx). Conteúdo na identidade v3 dentro do
 * layout de hoje. Sem legenda: rótulos, dados e ações; uma ação principal,
 * "Novo orçamento", com "Orçar execução" (a demanda direta) ao lado em
 * contorno. Na ficha, "Enviar ao cliente" no aprovado, as ações da etapa
 * depois do envio (parte 12b: Fechado, Validado, Registrar execução...) e o
 * documento A4.
 */

/** O que a fila mostra além da demanda e do orçamento: cadastro, contatos, locais e contratos. */
export type ContextoDaFila = {
  /** Códigos dos cadastros em prospect. */
  prospects: ReadonlySet<string>;
  contatos: ReadonlyMap<string, { nome: string; empresa: string | null }>;
  /** Id do local → nome. */
  locais: ReadonlyMap<string, string>;
  contratos: ReadonlyMap<string, ContratoResumo>;
  nomeDe: (uid: string | null) => string | null;
};

export type FilaViewProps = {
  estado: "carregando" | "erro" | "pronto";
  itens: ItemDaFila[];
  agora: Date;
  segmento: SegmentoDaFila;
  onSegmento: (segmento: SegmentoDaFila) => void;
  busca: string;
  onBusca: (busca: string) => void;
  selecionado: ItemDaFila | null;
  onSelecionar: (numero: string) => void;
  /** No celular, a ficha aberta toma o lugar da fila. */
  fichaAberta: boolean;
  onVoltar: () => void;
  contexto: ContextoDaFila;
  onNovo: () => void;
  /** "Orçar execução": a demanda direta, executada antes do orçamento (secundária ao "Novo orçamento"). */
  onOrcarExecucao: () => void;
  /** Duplo clique na linha: abre o orçamento (o clique só seleciona). */
  onAbrir: (numero: string) => void;
  /** O envio que a ficha oferece ao orçamento selecionado (lib/comercial/envio.ts, envioDaFicha). */
  envio: {
    acao: AcaoDeEnvio | null;
    ocupado: boolean;
    erro: string | null;
    onEnviar: (item: ItemDaFila, acao: AcaoDeEnvio) => void;
  };
  /** As ações da etapa do orçamento selecionado depois do envio (lib/comercial/depois-do-envio.ts). */
  depois: {
    acoes: AcoesDaEtapa;
    ocupado: boolean;
    /** A recusa de concorrência que fechou o diálogo. */
    aviso: string | null;
    onAcao: (acao: AcaoDepoisDoEnvio) => void;
  };
};

function Contador({ children, invertido = false }: { children: ReactNode; invertido?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
        invertido ? "bg-background/20 text-background" : "bg-foreground/10 text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

function Ponto({ etapa, anel = false }: { etapa: EtapaDemanda; anel?: boolean }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", pontoDaEtapa(etapa), anel && "ring-2 ring-background")} />;
}

export function SeloDaEtapa({ etapa, dias }: { etapa: EtapaDemanda; dias?: number | null }) {
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", corDaEtapa(etapa, dias))}>
      {ETAPA_ROTULO[etapa]}
    </span>
  );
}

const MARCA_DA_ORIGEM: Record<OrigemLinha, string> = {
  tabela: "",
  alterado: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  avulso: "border-border bg-muted text-muted-foreground",
  ajuste: "border-border bg-card text-foreground",
};

export function MarcaDaOrigem({ origem, rotulo }: { origem: OrigemLinha; rotulo: string }) {
  if (origem === "tabela") return <span className="text-sm font-semibold">{rotulo}</span>;
  return (
    <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-md border px-1.5 text-xs font-bold", MARCA_DA_ORIGEM[origem])}>
      {rotulo}
    </span>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</div>
  );
}

function totalEmReais(item: ItemDaFila): string {
  return item.totalCents === null ? "—" : formatarReais(item.totalCents);
}

/** "CEIC – Torre Olavo Setubal → CAT": a origem e, se for outro, o destino. */
function locaisDoItem(item: ItemDaFila, contexto: ContextoDaFila): string | null {
  const origem = item.origemLocalId ? (contexto.locais.get(item.origemLocalId) ?? null) : null;
  const destino = item.destinoLocalId ? (contexto.locais.get(item.destinoLocalId) ?? null) : null;
  if (origem && destino && destino !== origem) return `${origem} → ${destino}`;
  return origem ?? destino;
}

/** "Marina Teixeira · Souza & Lopes": o contato e a empresa dele. */
function paraDoItem(item: ItemDaFila, contexto: ContextoDaFila): string | null {
  const contato = item.contatoId ? contexto.contatos.get(item.contatoId) : undefined;
  if (!contato) return null;
  return [contato.nome, item.empresa ?? contato.empresa].filter(Boolean).join(" · ");
}


// --- Cabeçalho e segmentos -------------------------------------------------------------------

function Cabecalho({ busca, onBusca, onNovo, onOrcarExecucao }: FilaViewProps) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Orçamentos</h1>
      <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto">
        <label className="relative block min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar orçamento"
            placeholder="Número, nº legado, cliente, referência ou título"
            value={busca}
            onChange={(event) => onBusca(event.target.value)}
            className="w-full pl-9 sm:w-80"
          />
        </label>
        <Button type="button" variant="outline" onClick={onOrcarExecucao}>
          <FilePlus aria-hidden="true" />
          {ROTULO_DA_ACAO.orcar_execucao}
        </Button>
        <Button type="button" onClick={onNovo}>
          <Plus aria-hidden="true" />
          Novo orçamento
        </Button>
      </div>
    </header>
  );
}

function Segmentos({ itens, segmento, onSegmento }: FilaViewProps) {
  const contagem = contarSegmentos(itens);
  return (
    <div role="group" aria-label="Etapa" className="flex flex-wrap items-center gap-2">
      {SEGMENTOS_DA_FILA.map((item) => {
        const ativo = item === segmento;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={ativo}
            onClick={() => onSegmento(item)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-bold transition-colors",
              ativo ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-surface-hover",
            )}
          >
            {item === "todas" ? null : <Ponto etapa={item} anel={ativo} />}
            {SEGMENTO_ROTULO[item]}
            <Contador invertido={ativo}>{contagem[item]}</Contador>
          </button>
        );
      })}
    </div>
  );
}

// --- Lista ---------------------------------------------------------------------------------

export function LinhaDaFila({
  item,
  ativo,
  agora,
  contexto,
  onSelecionar,
  onAbrir,
}: {
  item: ItemDaFila;
  ativo: boolean;
  agora: Date;
  contexto: ContextoDaFila;
  onSelecionar: (numero: string) => void;
  onAbrir: (numero: string) => void;
}) {
  const refLocal = [item.refCliente, locaisDoItem(item, contexto)].filter(Boolean).join(" · ");
  const para = paraDoItem(item, contexto);
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => onSelecionar(item.numero)}
      onDoubleClick={() => onAbrir(item.numero)}
      className={cn(
        "flex w-full flex-wrap items-start gap-x-4 gap-y-2 border-l-4 px-5 py-3.5 text-left transition-colors",
        ativo ? "border-l-foreground bg-background" : "border-l-transparent hover:bg-surface-hover",
      )}
    >
      <span className="flex w-28 shrink-0 flex-col items-start gap-1.5">
        <span className="whitespace-nowrap text-base font-extrabold tabular-nums">{item.rotulo}</span>
        <Pill>{tipoDoItem(item)}</Pill>
        {item.numeroLegado ? (
          <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">nº legado {item.numeroLegado}</span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-extrabold">
          {item.cliente}
          {contexto.prospects.has(item.customerCode) ? <SeloProspect /> : null}
        </span>
        {item.titulo ? <span className="text-sm font-bold">{item.titulo}</span> : null}
        {refLocal ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {refLocal}
          </span>
        ) : null}
        {para ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <User className="size-3.5 shrink-0" aria-hidden="true" />
            {para}
          </span>
        ) : null}
      </span>
      <span className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:items-end sm:gap-1.5 sm:text-right">
        <span className="whitespace-nowrap text-base font-extrabold tabular-nums">{totalEmReais(item)}</span>
        <SeloDaEtapa etapa={item.etapa} dias={diasNaEtapa(item.etapaDesde, agora)} />
        <span className="text-xs font-bold tabular-nums text-muted-foreground">{tempoNaEtapa(item.etapaDesde, agora, item.etapa)}</span>
      </span>
    </button>
  );
}

function Lista(props: FilaViewProps) {
  const { estado, itens, segmento, busca, selecionado, agora, contexto, onSelecionar, onAbrir, fichaAberta } = props;
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar os orçamentos.</Vazio>;
  else {
    const grupos = filtrarFila(itens, segmento, busca);
    conteudo = grupos.length ? (
      grupos.map((grupo) => (
        <section key={grupo.etapa} aria-label={grupo.rotulo} className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2.5 border-b border-border bg-background px-5 py-3">
            <Ponto etapa={grupo.etapa} />
            <h2 className="text-xs font-extrabold uppercase tracking-wider">{grupo.rotulo}</h2>
            <Contador>{grupo.itens.length}</Contador>
          </div>
          <div className="divide-y divide-muted">
            {grupo.itens.map((item) => (
              <LinhaDaFila
                key={item.numero}
                item={item}
                ativo={item.numero === selecionado?.numero}
                agora={agora}
                contexto={contexto}
                onSelecionar={onSelecionar}
                onAbrir={onAbrir}
              />
            ))}
          </div>
        </section>
      ))
    ) : (
      <Vazio>Nenhum orçamento</Vazio>
    );
  }
  return (
    <section aria-label="Orçamentos" className={cn("min-w-0 flex-1 flex-col gap-4", fichaAberta ? "hidden lg:flex" : "flex")}>
      {conteudo}
    </section>
  );
}

// --- Ficha -------------------------------------------------------------------------------

function Secao({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <div className="border-b border-muted px-5 py-4 last:border-b-0">
      {titulo ? <h3 className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{titulo}</h3> : null}
      {children}
    </div>
  );
}

function Quadro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2.5 text-sm font-bold">
      <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      {children}
    </div>
  );
}

function Ficha(props: FilaViewProps & { selecionado: ItemDaFila }) {
  const { selecionado: item, agora, contexto, fichaAberta, onVoltar, envio, depois } = props;
  const contato = item.contatoId ? (contexto.contatos.get(item.contatoId)?.nome ?? null) : null;
  const campos: Array<[string, string]> = [
    ["Cliente", item.cliente],
    ["Local", locaisDoItem(item, contexto) ?? "—"],
    ["Para", paraDoItem(item, contexto) ?? "—"],
    ["Referência", item.refCliente ?? "—"],
    ["Contrato", rotuloDoContratoDoOrcamento(item.contratoId, item.contratoId ? contexto.contratos.get(item.contratoId) : null)],
    ["Tabela", item.tabelaNome ? [item.tabelaNome, item.variante].filter(Boolean).join(" · ") : "Sem tabela"],
    ["Data-base", item.dataBase ? dataBr(item.dataBase) : "—"],
  ];
  const linhas = linhasPorOrigem(item.linhas);
  const passos = historicoDoOrcamento(item, { nomeDe: contexto.nomeDe, contato });
  const href = hrefDoOrcamento(item.numero);
  return (
    <aside
      aria-label="Orçamento selecionado"
      className={cn(
        "min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-4 lg:w-96 lg:shrink-0",
        fichaAberta ? "flex" : "hidden lg:flex",
      )}
    >
      <div className="border-b border-muted px-3 py-2 lg:hidden">
        <Button type="button" variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft aria-hidden="true" />
          Voltar
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-b border-muted px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          {item.semOrcamento ? (
            <span className="text-xl font-extrabold tabular-nums text-foreground">{item.rotulo}</span>
          ) : (
            <Link href={href} className="text-xl font-extrabold tabular-nums text-foreground underline-offset-4 hover:underline">
              {item.rotulo}
            </Link>
          )}
          <Pill>{tipoDoItem(item)}</Pill>
          <SeloDaEtapa etapa={item.etapa} dias={diasNaEtapa(item.etapaDesde, agora)} />
        </div>
        {item.titulo ? <p className="text-base font-bold">{item.titulo}</p> : null}
        {item.numeroLegado ? <span className="text-xs font-bold text-muted-foreground">nº legado {item.numeroLegado}</span> : null}
      </div>
      <Secao>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo} className="contents">
              <dt className="font-bold text-muted-foreground">{rotulo}</dt>
              <dd className="min-w-0 break-words font-bold">{valor}</dd>
            </div>
          ))}
        </dl>
      </Secao>
      {item.semOrcamento ? null : (
        <Secao titulo="Linhas">
          {linhas.map((grupo) => (
            <div key={grupo.origem} className="flex items-center gap-2.5 py-1.5">
              <MarcaDaOrigem origem={grupo.origem} rotulo={grupo.rotulo} />
              <span className="text-xs font-bold text-muted-foreground">{grupo.quantidade === 1 ? "1 linha" : `${grupo.quantidade} linhas`}</span>
              <b className="ml-auto whitespace-nowrap font-extrabold tabular-nums">{formatarReais(grupo.totalCents)}</b>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-2.5 border-t border-border pt-2.5 font-extrabold">
            <span>Total</span>
            <b className="text-xl tabular-nums">{totalEmReais(item)}</b>
          </div>
        </Secao>
      )}
      <Secao titulo="Histórico">
        <ol>
          {passos.map((passo, indice) => (
            <li
              key={`${passo.rotulo}-${indice}`}
              className="relative flex gap-3 pb-3 before:absolute before:bottom-0 before:left-1 before:top-4 before:w-0.5 before:bg-muted last:pb-0 last:before:hidden"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-2.5 shrink-0 rounded-full",
                  passo.estado === "feito" && "bg-success",
                  passo.estado === "perdido" && "bg-muted-foreground",
                  passo.estado === "pendente" && "border-2 border-muted-foreground bg-card",
                )}
              />
              <div className="min-w-0">
                <b className={cn("block text-sm font-bold", passo.estado === "pendente" && "text-muted-foreground")}>{passo.rotulo}</b>
                <span className="block text-xs font-semibold text-muted-foreground">
                  {[passo.quando ?? (passo.estado === "pendente" ? "pendente" : null), passo.detalhe].filter(Boolean).join(" · ")}
                </span>
              </div>
            </li>
          ))}
        </ol>
        {item.perda?.motivo ? <Quadro rotulo="Motivo">{item.perda.motivo}</Quadro> : null}
        {item.status === "rascunho" && item.devolucao?.nota ? <Quadro rotulo="Devolução">{item.devolucao.nota}</Quadro> : null}
      </Secao>
      <div className="flex flex-wrap gap-2 px-5 pb-5 pt-4">
        {envio.acao ? (
          <Button type="button" variant="outline" size="sm" onClick={() => envio.onEnviar(item, envio.acao!)} disabled={envio.ocupado}>
            <Send aria-hidden="true" />
            {ROTULO_DO_ENVIO[envio.acao]}
          </Button>
        ) : null}
        <AcoesDepoisDoEnvio acoes={depois.acoes} onAcao={depois.onAcao} ocupado={depois.ocupado} tamanho="sm" />
        {item.semOrcamento ? null : (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={href}>{acaoDaEtapa(item.etapa, item.status)}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={hrefDoDocumento(item.numero, item.rv)}>
                <FileText aria-hidden="true" />
                {item.status === "enviado" ? "PDF" : "Prévia do PDF"}
              </Link>
            </Button>
          </>
        )}
        {[envio.erro, depois.aviso].filter(Boolean).map((mensagem) => (
          <p
            key={mensagem}
            role="alert"
            className="w-full rounded-md border border-destructive-soft-border bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive-soft-foreground"
          >
            {mensagem}
          </p>
        ))}
      </div>
    </aside>
  );
}

export function FilaView(props: FilaViewProps) {
  const { estado, selecionado } = props;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <Cabecalho {...props} />
      <Segmentos {...props} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Lista {...props} />
        {estado === "pronto" && selecionado ? <Ficha {...props} selecionado={selecionado} /> : null}
      </div>
    </div>
  );
}
