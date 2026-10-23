import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronDown, Clock, MapPin, Plus, Search, Truck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatarData } from "@/lib/operacao/cadastro";
import { rotuloDaDemandaFora, type AgendaEmEdicao, type OsDaFila } from "@/lib/operacao/fila";
import {
  ENTRADAS_DA_DEMANDA,
  ENTRADA_ROTULO,
  TIPOS_DA_DEMANDA,
  TIPO_ROTULO,
  equipeCurta,
  type CartaoDeDemanda,
  type CartaoDeOs,
  type FiltrosDoHoje,
  type PrazoDoHoje,
  type QuadroDoHoje,
} from "@/lib/operacao/hoje";
import { Avatar, Filtro, SeloDoTipo, Servicos, selo, seloAlerta, type OpcaoDeFiltro } from "@/components/operacao/partes";
import { ROTA_NOVA_DEMANDA, hrefDaDemanda } from "@/lib/operacao/navegacao";
import { cn } from "@/lib/utils";

/**
 * Operação › Hoje (docs/plataforma/fase-3-operacao.md, parte 3.5a;
 * docs/mockups/ModOpHoje.dc.html): Para planejar, Para agendar, Agendadas
 * hoje, Em execução e Em revisão, com os filtros e a busca. Só apresentação:
 * os dados e as ações chegam por props (pages/operacao/hoje.tsx). Sem legenda
 * e sem valor.
 */

export type EstadoDoHoje = "carregando" | "erro" | "pronto";

export type PessoaDaEquipe = { id: string; nome: string; funcao: string; ativo: boolean };

export type VeiculoDaAgenda = { id: string; placa: string; tipo: string; ativo: boolean };

function Coluna({ titulo, ponto, contagem, vazio, children }: { titulo: string; ponto: string; contagem: number; vazio: string; children?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 rounded-full", ponto)} />
        {titulo}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">{contagem}</span>
      </h2>
      {contagem === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-3">{children}</ul>
      )}
    </section>
  );
}

function Prazo({ prazo }: { prazo: PrazoDoHoje }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-sm", prazo.atrasada ? "font-semibold text-destructive" : "text-foreground")}>
      <Clock aria-hidden="true" className="size-4 shrink-0" />
      <span className="font-semibold">{prazo.texto}</span>
      {prazo.falta ? <span className={prazo.atrasada ? undefined : "text-muted-foreground"}>· {prazo.falta}</span> : null}
    </p>
  );
}

function resumoDaOs(cartao: CartaoDeOs): string {
  return [cartao.demanda?.titulo ?? cartao.os.itens[0]?.item ?? null, cartao.os.rota ?? null].filter(Boolean).join(" · ");
}

function CartaoDaDemanda({ cartao, ocupado, onAbrir }: { cartao: CartaoDeDemanda; ocupado: boolean; onAbrir: (numero: string) => void }) {
  const { demanda } = cartao;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <SeloDoTipo tipo={demanda.tipo} />
        <Link
          href={hrefDaDemanda(demanda.numero)}
          className="rounded text-sm font-semibold tabular-nums text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {demanda.numero}
        </Link>
      </div>
      <p className="text-base font-semibold leading-snug text-foreground">{cartao.cliente}</p>
      {demanda.titulo ? <p className="text-sm text-muted-foreground">{demanda.titulo}</p> : null}
      {cartao.prazo ? <Prazo prazo={cartao.prazo} /> : null}
      <p className="text-sm text-muted-foreground">
        {[ENTRADA_ROTULO[demanda.entrada], demanda.osNumeros.length ? `${demanda.osNumeros.length} OS` : null, `${cartao.linhasComSaldo} ${cartao.linhasComSaldo === 1 ? "item" : "itens"} com saldo`].filter(Boolean).join(" · ")}
      </p>
      <div>
        <Button type="button" size="sm" disabled={ocupado} onClick={() => onAbrir(demanda.numero)}>
          Abrir OS
        </Button>
      </div>
    </li>
  );
}

function Equipe({ cartao }: { cartao: CartaoDeOs }) {
  const nome = equipeCurta(cartao.equipe);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      {nome ? (
        <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
          <Avatar nome={cartao.equipe[0]} />
          <span className="truncate">{nome}</span>
        </span>
      ) : (
        <span className={cn(selo, seloAlerta)}>Sem equipe</span>
      )}
      {cartao.placas.length ? (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Truck aria-hidden="true" className="size-4" />
          {cartao.placas.join(" · ")}
        </span>
      ) : (
        <span className={cn(selo, seloAlerta)}>Sem veículo</span>
      )}
    </div>
  );
}

/** O destaque do cartão agendado: a hora, hoje; a data e a hora, nos próximos dias. */
function quandoDaOs(os: OsDaFila, comData: boolean): string | null {
  if (!os.agenda) return null;
  const hora = os.agenda.hora ?? (comData ? null : "Sem hora");
  return comData ? [formatarData(os.agenda.data), hora].filter(Boolean).join(" ") : hora;
}

function CartaoDaOs({
  cartao,
  destaque,
  acao,
  onAbrir,
}: {
  cartao: CartaoDeOs;
  /** A hora (ou a data e a hora) em destaque no lugar do tipo. */
  destaque?: string | null;
  acao?: string;
  onAbrir: (os: OsDaFila) => void;
}) {
  const { os, demanda } = cartao;
  const resumo = resumoDaOs(cartao);
  const comEquipe = os.status !== "aberta" || cartao.equipe.length > 0;
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border bg-card p-4", cartao.prazo?.atrasada ? "border-destructive-soft-border" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        {destaque ? (
          <span className="text-base font-bold tabular-nums text-foreground">{destaque}</span>
        ) : demanda ? (
          <SeloDoTipo tipo={demanda.tipo} />
        ) : (
          <span />
        )}
        {os.status === "aberta" || os.status === "agendada" ? (
          <button
            type="button"
            onClick={() => onAbrir(os)}
            className="rounded text-sm font-semibold tabular-nums text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            OS {os.numero}
          </button>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">OS {os.numero}</span>
        )}
      </div>
      {os.demandaFora ? <p className="text-sm font-semibold text-destructive">{rotuloDaDemandaFora(os.demandaFora)}</p> : null}
      <p className="text-base font-semibold leading-snug text-foreground">{cartao.cliente}</p>
      {resumo ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          {os.rota ? <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
          <span>{resumo}</span>
        </p>
      ) : null}
      {cartao.prazo && os.status === "aberta" ? <Prazo prazo={cartao.prazo} /> : null}
      <Servicos servicos={os.servicos ?? []} />
      {comEquipe ? <Equipe cartao={cartao} /> : null}
      {acao ? (
        <div className={cn("flex flex-wrap items-center gap-2", comEquipe ? null : "border-t border-border pt-3")}>
          {comEquipe ? null : <span className={cn(selo, seloAlerta)}>Sem equipe</span>}
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onAbrir(os)}>
            {acao === "Escalar" ? <UserPlus aria-hidden="true" className="size-4" /> : null}
            {acao}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ProximosDias({ cartoes, onAbrir }: { cartoes: readonly CartaoDeOs[]; onAbrir: (os: OsDaFila) => void }) {
  const [aberto, setAberto] = useState(false);
  if (!cartoes.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="ghost" size="sm" className="justify-between" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        Próximos dias · {cartoes.length}
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", aberto ? "rotate-180" : null)} />
      </Button>
      {aberto ? (
        <ul className="flex flex-col gap-3">
          {cartoes.map((cartao) => (
            <CartaoDaOs key={cartao.os.numero} cartao={cartao} destaque={quandoDaOs(cartao.os, true)} onAbrir={onAbrir} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// --- Escalar --------------------------------------------------------------------------------

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

/**
 * Escalar a OS: data, hora, equipe e veículo. Sem equipe ou sem veículo, a OS
 * agenda e o Início avisa (parte 3.4b); a tela de Planejar OS, com o papel de
 * cada pessoa e vários veículos, é da parte 3.6. Cancelar pede o motivo.
 */
export function EscalaDaOs({
  os,
  pessoas,
  veiculos,
  agenda,
  onAgenda,
  onSalvar,
  onCancelar,
  ocupado,
  erro,
}: {
  os: OsDaFila;
  pessoas: readonly PessoaDaEquipe[];
  veiculos: readonly VeiculoDaAgenda[];
  agenda: AgendaEmEdicao;
  onAgenda: (agenda: AgendaEmEdicao) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const fora = os.demandaFora ?? null;
  const podeSalvar = !fora && Boolean(agenda.data);
  function alternar(id: string, marcado: boolean) {
    const equipe = marcado ? [...agenda.equipe, id] : agenda.equipe.filter((atual) => atual !== id);
    onAgenda({ ...agenda, equipe });
  }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (podeSalvar) onSalvar();
      }}
    >
      {fora ? <p className="text-sm font-semibold text-destructive">{rotuloDaDemandaFora(fora)}</p> : null}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      {fora ? null : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="os-data" rotulo="Data">
              <Input id="os-data" type="date" value={agenda.data} onChange={(event) => onAgenda({ ...agenda, data: event.target.value })} />
            </Campo>
            <Campo id="os-hora" rotulo="Hora">
              <Input id="os-hora" type="time" value={agenda.hora} onChange={(event) => onAgenda({ ...agenda, hora: event.target.value })} />
            </Campo>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">Equipe</legend>
            {pessoas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum colaborador ativo</p> : null}
            <ul className="flex flex-col gap-2">
              {pessoas.map((pessoa) => (
                <li key={pessoa.id}>
                  <label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={agenda.equipe.includes(pessoa.id)}
                      onChange={(event) => alternar(pessoa.id, event.target.checked)}
                    />
                    <Avatar nome={pessoa.nome} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{pessoa.nome}</span>
                      <span className="block truncate text-muted-foreground">{pessoa.ativo ? pessoa.funcao : `${pessoa.funcao} · Desativado`}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Campo id="os-veiculo" rotulo="Veículo">
            <select
              id="os-veiculo"
              className={campoClasse}
              value={agenda.veiculoId}
              onChange={(event) => onAgenda({ ...agenda, veiculoId: event.target.value })}
            >
              <option value="">Sem veículo</option>
              {veiculos.map((veiculo) => (
                <option key={veiculo.id} value={veiculo.id}>
                  {veiculo.ativo ? `${veiculo.placa} · ${veiculo.tipo}` : `${veiculo.placa} · ${veiculo.tipo} · Desativado`}
                </option>
              ))}
            </select>
          </Campo>
          <Button type="submit" disabled={ocupado || !podeSalvar}>
            {os.status === "agendada" ? "Salvar" : "Agendar"}
          </Button>
        </>
      )}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <Campo id="os-motivo" rotulo="Motivo do cancelamento">
          <Input id="os-motivo" value={agenda.motivo} onChange={(event) => onAgenda({ ...agenda, motivo: event.target.value })} />
        </Campo>
        <Button type="button" variant="outline" disabled={ocupado || agenda.motivo.trim().length < 3} onClick={onCancelar}>
          Cancelar OS
        </Button>
      </div>
    </form>
  );
}

// --- Tela -----------------------------------------------------------------------------------

export function HojeView({
  estado,
  resumo,
  quadro,
  filtros,
  opcoes,
  busca,
  onBusca,
  onFiltros,
  onAbrirDemanda,
  onEscalar,
  ocupado,
  erro,
  escala,
}: {
  estado: EstadoDoHoje;
  resumo: string;
  quadro: QuadroDoHoje;
  filtros: FiltrosDoHoje;
  opcoes: { clientes: readonly OpcaoDeFiltro[]; pessoas: readonly OpcaoDeFiltro[] };
  busca: string;
  onBusca: (busca: string) => void;
  onFiltros: (filtros: FiltrosDoHoje) => void;
  onAbrirDemanda: (numero: string) => void;
  onEscalar: (os: OsDaFila) => void;
  ocupado: boolean;
  erro: string | null;
  /** O painel de escalar aberto, com o formulário (EscalaDaOs) e como fechar. */
  escala: { titulo: string; cliente: string; conteudo: ReactNode; onFechar: () => void } | null;
}) {
  const filtrado = Boolean(filtros.tipo || filtros.entrada || filtros.cliente || filtros.pessoa);
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Hoje</h1>
          {estado === "pronto" ? <p className="text-sm font-medium text-muted-foreground">{resumo}</p> : null}
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <label className="relative block w-full lg:w-80">
            <span className="sr-only">Buscar OS, demanda ou cliente</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={busca}
              placeholder="Buscar OS, demanda ou cliente"
              className="pl-9"
              onChange={(event) => onBusca(event.target.value)}
            />
          </label>
          <Button asChild className="shrink-0">
            <Link href={ROTA_NOVA_DEMANDA}>
              <Plus aria-hidden="true" className="size-4" />
              Nova demanda
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Filtro
          rotulo="Tipo"
          todos="Todos os tipos"
          valor={filtros.tipo}
          opcoes={TIPOS_DA_DEMANDA.map((tipo) => ({ valor: tipo, rotulo: TIPO_ROTULO[tipo] }))}
          onChange={(valor) => onFiltros({ ...filtros, tipo: valor as FiltrosDoHoje["tipo"] })}
        />
        <Filtro
          rotulo="Entrada"
          todos="Todas as entradas"
          valor={filtros.entrada}
          opcoes={ENTRADAS_DA_DEMANDA.map((entrada) => ({ valor: entrada, rotulo: ENTRADA_ROTULO[entrada] }))}
          onChange={(valor) => onFiltros({ ...filtros, entrada: valor as FiltrosDoHoje["entrada"] })}
        />
        <Filtro rotulo="Cliente" todos="Todos os clientes" valor={filtros.cliente} opcoes={opcoes.clientes} onChange={(valor) => onFiltros({ ...filtros, cliente: valor })} />
        <Filtro rotulo="Equipe" todos="Toda a equipe" valor={filtros.pessoa} opcoes={opcoes.pessoas} onChange={(valor) => onFiltros({ ...filtros, pessoa: valor })} />
        {filtrado ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onFiltros({ tipo: "", entrada: "", cliente: "", pessoa: "" })}>
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o Hoje.
        </p>
      ) : null}
      {erro && !escala ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}

      {estado === "pronto" ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5 xl:gap-4">
          <Coluna titulo="Para planejar" ponto="bg-muted-foreground" contagem={quadro.paraPlanejar.length} vazio="Nenhuma demanda">
            {quadro.paraPlanejar.map((cartao) => (
              <CartaoDaDemanda key={cartao.demanda.numero} cartao={cartao} ocupado={ocupado} onAbrir={onAbrirDemanda} />
            ))}
          </Coluna>
          <Coluna titulo="Para agendar" ponto="bg-info-soft-foreground" contagem={quadro.paraAgendar.length} vazio="Nenhuma OS">
            {quadro.paraAgendar.map((cartao) => (
              <CartaoDaOs key={cartao.os.numero} cartao={cartao} acao="Escalar" onAbrir={onEscalar} />
            ))}
          </Coluna>
          <div className="flex min-w-0 flex-col gap-3">
            <Coluna titulo="Agendadas hoje" ponto="bg-violet-soft-foreground" contagem={quadro.agendadasHoje.length} vazio="Nenhuma OS">
              {quadro.agendadasHoje.map((cartao) => (
                <CartaoDaOs key={cartao.os.numero} cartao={cartao} destaque={quandoDaOs(cartao.os, false)} onAbrir={onEscalar} />
              ))}
            </Coluna>
            <ProximosDias cartoes={quadro.proximosDias} onAbrir={onEscalar} />
          </div>
          <Coluna titulo="Em execução" ponto="bg-amber-soft-foreground" contagem={quadro.emExecucao.length} vazio="Nenhuma OS">
            {quadro.emExecucao.map((cartao) => (
              <CartaoDaOs key={cartao.os.numero} cartao={cartao} destaque={quandoDaOs(cartao.os, false)} onAbrir={onEscalar} />
            ))}
          </Coluna>
          <Coluna titulo="Em revisão" ponto="bg-teal-soft-foreground" contagem={quadro.emRevisao.length} vazio="Nenhuma OS">
            {quadro.emRevisao.map((cartao) => (
              <CartaoDaOs key={cartao.os.numero} cartao={cartao} destaque={quandoDaOs(cartao.os, false)} onAbrir={onEscalar} />
            ))}
          </Coluna>
        </div>
      ) : null}

      <Sheet open={Boolean(escala)} onOpenChange={(aberto) => (aberto ? null : escala?.onFechar())}>
        <SheetContent className="w-full overflow-y-auto bg-card sm:max-w-md">
          {escala ? (
            <>
              <SheetHeader className="mb-5 text-left">
                <SheetTitle>{escala.titulo}</SheetTitle>
                <SheetDescription>{escala.cliente}</SheetDescription>
              </SheetHeader>
              {escala.conteudo}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
