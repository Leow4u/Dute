/*
 * Portal › Eventos (docs/superpowers/specs/2026-11-26-eventos-design.md, "As
 * telas › Portal"; prancha docs/mockups/EventosPortalLista.dc.html): um
 * cartão por evento, com a edição da vez (o status, o período, o local, o
 * cronograma, os itens e o preço fechado), as edições anteriores e as ações.
 * As edições, as capas e os preços chegam ao vivo pelas regras do Firestore.
 * O rascunho continua no formulário ("Continuar") ou é excluído; as outras
 * abrem a edição. Nada aqui movimenta estoque.
 */
import { Fragment, useRef, useState } from "react";
import { ROTULO_DO_STATUS, type StatusDaEdicao } from "@workspace/dominio";
import { Banknote, CalendarDays, Clock, Copy, MapPin, Package, Plus, Search } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Chip } from "@/components/ui/chip";
import { Confirmacao } from "@/components/ui/confirmacao";
import { FaixaAoVivo, FalhaAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { EVENTOS_LIBERADO } from "@/lib/liberacao";
import { cartoesDaLista, contagemDosFiltros, filtrarCartoes, type CartaoDoEvento } from "@/lib/eventos/lista";
import { ROTA_NOVO_EVENTO, hrefDaEdicao, hrefDoNovoDoEvento } from "@/lib/eventos/navegacao";
import { ETAPAS_DA_EDICAO, FILTROS_DA_LISTA, ROTULO_DO_FILTRO, type FiltroDaLista } from "@/lib/eventos/rotulos";
import { useEdicoesDoCliente, useEventosDoCliente, usePrecosDoCliente } from "@/lib/eventos/use-eventos";
import { hojeIso } from "@/lib/operacao/fila";
import { novaChave } from "@/lib/operacao/api";
import { novaTentativaDe } from "@/lib/operacao/leitura";
import { useOperationProfile } from "@/lib/operation-profile";
import { leiturasDoPortal } from "@/lib/operations";
import { cn } from "@/lib/utils";
import { cancelarEdicao } from "@/lib/wms/eventos";

import { ClienteEventosModelos } from "./eventos-modelos";
import { ClientDataBoundary, ClientModuleShell } from "./shared";

export type ListaDeEventosViewProps = {
  estado: "carregando" | "erro" | "pronto";
  /** A nova tentativa e a falta das três leituras ao vivo. */
  leitura: LeituraAoVivoNaTela;
  /** Todos os cartões (cartoesDaLista); o filtro e a busca se aplicam aqui. */
  cartoes: CartaoDoEvento[];
  contagens: Record<FiltroDaLista, number>;
  filtro: FiltroDaLista;
  busca: string;
  acoes: {
    filtrar: (filtro: FiltroDaLista) => void;
    buscar: (texto: string) => void;
    excluir: (cartao: CartaoDoEvento) => void;
  };
};

const TITULO = "Eventos";
const DESCRICAO = "O que vai para cada evento, como a Dutelog leva, monta e traz de volta, e o registro de cada edição.";

const TOM_DO_SELO: Record<StatusDaEdicao, string> = {
  rascunho: "border-border bg-muted text-muted-foreground",
  enviado: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  confirmado: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  separado: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  no_evento: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  retornado: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  fechado: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelado: "border-border bg-muted text-muted-foreground",
};

function NovoEvento({ variante }: { variante: "default" | "outline" }) {
  return (
    <Button asChild variant={variante} size={variante === "default" ? "lg" : "sm"} className="shrink-0">
      <Link href={ROTA_NOVO_EVENTO}>
        <Plus aria-hidden="true" />
        Novo evento
      </Link>
    </Button>
  );
}

function Etapas({ etapa }: { etapa: number }) {
  return (
    <ol aria-label="Etapas da edição" className="flex items-start px-4 pb-3">
      {ETAPAS_DA_EDICAO.map((status, indice) => (
        <li key={status} aria-current={indice === etapa ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center gap-1">
          {indice < ETAPAS_DA_EDICAO.length - 1 ? (
            <span aria-hidden="true" className={cn("absolute left-1/2 top-1.5 h-0.5 w-full", indice < etapa ? "bg-success-soft-border" : "bg-border")} />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "relative z-10 size-3 rounded-full border-2",
              indice < etapa ? "border-success-soft-foreground bg-success-soft-foreground" : indice === etapa ? "border-primary-fundo bg-primary ring-4 ring-primary/15" : "border-border bg-card",
            )}
          />
          <span className={cn("whitespace-nowrap text-xs font-semibold", indice <= etapa ? "text-foreground" : "text-muted-foreground")}>{ROTULO_DO_STATUS[status]}</span>
        </li>
      ))}
    </ol>
  );
}

function Cartao({ cartao, onExcluir }: { cartao: CartaoDoEvento; onExcluir: () => void }) {
  const { evento, atual } = cartao;
  const idDoTitulo = `evento-${evento.id}`;
  const edicoes = [...cartao.anteriores, atual].sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "", "pt-BR", { numeric: true }));
  return (
    <article aria-labelledby={idDoTitulo} className="flex flex-col rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <h2 id={idDoTitulo} className="text-lg font-bold tracking-tight">
            {evento.name}
          </h2>
          <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM_DO_SELO[atual.status])}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {cartao.selo}
          </span>
        </div>
        {cartao.quando ? (
          <span className="shrink-0 whitespace-nowrap text-right text-sm font-bold">
            {cartao.quando.texto}
            {cartao.quando.rotulo ? <span className="block text-xs font-semibold text-muted-foreground">{cartao.quando.rotulo}</span> : null}
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-1.5 px-4 py-3 text-sm text-muted-foreground">
        {cartao.local ? (
          <span className="flex items-start gap-2">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cartao.local}
          </span>
        ) : null}
        {cartao.cronograma ? (
          <span className="flex items-start gap-2">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cartao.cronograma}
          </span>
        ) : null}
        {cartao.itens ? (
          <span className="flex items-start gap-2">
            <Package aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cartao.itens}
          </span>
        ) : null}
        {cartao.fechamento ? (
          <span className="flex items-start gap-2">
            <Banknote aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cartao.fechamento}
          </span>
        ) : null}
      </div>

      {cartao.etapa !== null ? <Etapas etapa={cartao.etapa} /> : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2.5 border-t border-border/60 px-4 py-3">
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
          Edições:
          {edicoes.map((edicao, indice) => (
            <Fragment key={edicao.id}>
              {indice > 0 ? <span aria-hidden="true">·</span> : null}
              {edicao === atual ? (
                <b className="font-bold text-foreground">{edicao.label ?? "—"}</b>
              ) : (
                <Link href={hrefDaEdicao(edicao.id)} aria-label={`Edição ${edicao.label ?? ""}`.trim()} className="font-bold text-primary-texto hover:underline">
                  {edicao.label ?? "—"}
                </Link>
              )}
              {edicao === atual && cartao.esta ? <span>(esta)</span> : null}
            </Fragment>
          ))}
        </span>
        <span className="flex flex-wrap gap-2">
          {cartao.acoes.excluirRascunho ? (
            <Button type="button" variant="ghost" size="sm" onClick={onExcluir}>
              Excluir rascunho
            </Button>
          ) : null}
          {cartao.acoes.continuar ? (
            <Button asChild variant="outline" size="sm">
              <Link href={hrefDaEdicao(atual.id)}>Continuar</Link>
            </Button>
          ) : null}
          {cartao.acoes.abrir ? (
            <Button asChild variant="outline" size="sm">
              <Link href={hrefDaEdicao(atual.id)}>Abrir</Link>
            </Button>
          ) : null}
          {cartao.acoes.novaEdicaoAPartirDe ? (
            <Button asChild size="sm">
              <Link href={hrefDoNovoDoEvento(evento.id)}>
                <Copy aria-hidden="true" />
                Nova edição a partir de {cartao.acoes.novaEdicaoAPartirDe}
              </Link>
            </Button>
          ) : null}
        </span>
      </footer>
    </article>
  );
}

/** A lista, só a apresentação: os dados chegam por props (ListaDeEventos). */
export function ListaDeEventosView({ estado, leitura, cartoes, contagens, filtro, busca, acoes }: ListaDeEventosViewProps) {
  const visiveis = filtrarCartoes(cartoes, filtro, busca);
  return (
    <ClientModuleShell overview={{}} title={TITULO} description={DESCRICAO} icon={CalendarDays} headerAction={<NovoEvento variante="default" />}>
      {estado === "carregando" ? (
        // O título fica; sob ele, a caixa e "Carregando eventos…" aos 300 ms (carregamento v2).
        <CarregandoNaRegiao rotulo="Carregando eventos…" continuaARota onTentar={leitura.tentar} />
      ) : estado === "erro" ? (
        <FalhaAoVivo leitura={leitura} mensagem="Não foi possível carregar os eventos." className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3" />
      ) : (
        <>
          <FaixaAoVivo leitura={leitura} />
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS_DA_LISTA.map((item) => (
              <Chip key={item} selected={item === filtro} count={`· ${contagens[item]}`} onClick={() => acoes.filtrar(item)}>
                {ROTULO_DO_FILTRO[item]}
              </Chip>
            ))}
            <label className="relative block w-full min-w-0 sm:ml-auto sm:w-80">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Buscar evento ou local"
                placeholder="Buscar evento ou local"
                value={busca}
                onChange={(evento) => acoes.buscar(evento.target.value)}
                className="pl-9"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visiveis.map((cartao) => (
              <Cartao key={cartao.evento.id} cartao={cartao} onExcluir={() => acoes.excluir(cartao)} />
            ))}
            <article className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-7 text-center">
              <CalendarDays aria-hidden="true" className="size-6 text-muted-foreground" />
              <p className="font-bold">{cartoes.length ? "Criar outro evento" : "Nenhum evento ainda"}</p>
              <NovoEvento variante="outline" />
            </article>
          </div>
        </>
      )}
    </ClientModuleShell>
  );
}

/**
 * A página da lista: as três leituras ao vivo pelo código do cliente da
 * conta, só com a armazenagem no contrato (leiturasDoPortal). O filtro
 * começa em Próximos, ou em Todos quando não há próximo.
 */
export function ListaDeEventos() {
  const { user } = useAppUser();
  const { profile } = useOperationProfile();
  const leituras = profile ? leiturasDoPortal(profile.modules) : null;
  const codigo = user?.publicMetadata.customer_code;
  const ligado = Boolean(leituras?.eventos);
  const eventos = useEventosDoCliente(codigo, ligado);
  const edicoes = useEdicoesDoCliente(codigo, ligado);
  const precos = usePrecosDoCliente(codigo, ligado);
  const [escolhido, setEscolhido] = useState<FiltroDaLista | null>(null);
  const [busca, setBusca] = useState("");
  const [excluindo, setExcluindo] = useState<CartaoDoEvento | null>(null);
  const [ocupada, setOcupada] = useState(false);
  // A mesma chave na nova tentativa de excluir o mesmo rascunho: a exclusão repetida não apaga outra coisa.
  const chaves = useRef(new Map<string, string>());
  const { toast } = useToast();

  async function excluir(cartao: CartaoDoEvento) {
    const id = cartao.atual.id;
    const chave = chaves.current.get(id) ?? novaChave();
    chaves.current.set(id, chave);
    setOcupada(true);
    try {
      await cancelarEdicao({ id, idempotency_key: chave });
      // Quem fecha a confirmação é o sucesso; na falha, ela fica, com o aviso (parte 13a).
      setExcluindo(null);
      toast({ title: "Rascunho excluído", description: cartao.evento.name });
    } catch (erro) {
      toast({ title: "Não foi possível excluir", description: erro instanceof Error ? erro.message : "", variant: "destructive" });
    } finally {
      setOcupada(false);
    }
  }

  const leiturasAoVivo = [eventos, edicoes, precos];
  const tentativa = novaTentativaDe(leiturasAoVivo);
  const estado = leiturasAoVivo.some((leitura) => leitura.erro && leitura.itens === null)
    ? "erro"
    : leiturasAoVivo.every((leitura) => leitura.itens !== null)
      ? "pronto"
      : "carregando";
  const cartoes = cartoesDaLista(eventos.itens ?? [], edicoes.itens ?? [], precos.itens ?? [], hojeIso());
  const contagens = contagemDosFiltros(cartoes);
  const filtro = escolhido ?? (contagens.proximos ? "proximos" : "todos");

  return (
    <ClientDataBoundary titulo={TITULO}>
      {() => (
        <>
          <ListaDeEventosView
            estado={estado}
            leitura={tentativa}
            cartoes={cartoes}
            contagens={contagens}
            filtro={filtro}
            busca={busca}
            acoes={{ filtrar: setEscolhido, buscar: setBusca, excluir: setExcluindo }}
          />
          <Confirmacao
            aberta={Boolean(excluindo)}
            ocupada={ocupada}
            titulo={`Excluir o rascunho de ${excluindo?.evento.name ?? ""}?`}
            confirmar="Excluir"
            confirmando="Excluindo…"
            perigo
            onConfirmar={() => {
              if (excluindo) void excluir(excluindo);
            }}
            onFechar={() => setExcluindo(null)}
          />
        </>
      )}
    </ClientDataBoundary>
  );
}

/** Portal › Eventos: a lista nova só com a liberação dos Eventos; fora dela, a tela de hoje (o legado, até a parte 12). */
export const ClienteEventos = () => (EVENTOS_LIBERADO ? <ListaDeEventos /> : <ClienteEventosModelos />);
