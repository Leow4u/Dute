import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, ImageIcon, MapPin, Truck } from "lucide-react";

import { Avatar, COR_DO_STATUS, SeloDoTipo, rotuloDoStatusDaOs, selo, seloAlerta, seloNeutro } from "@/components/operacao/partes";
import { VistoriaEnviada } from "@/components/operacao/vistoria-lida";
import { Button } from "@/components/ui/button";
import {
  conclusaoNaFicha,
  detalheDaPessoa,
  detalheDoVeiculo,
  enderecoNoMaps,
  etapasDaFicha,
  feitoEm,
  historicoDaOs,
  horaDaEtapa,
  itensDaFicha,
  janelaEmTexto,
  passosDaOs,
  revisaoNaFicha,
  servicosEmTexto,
  type FichaDaOs,
  type LocalLido,
} from "@/lib/operacao/ficha-da-os";
import type { TipoDaDemanda } from "@/lib/operacao/hoje";
import { ROTA_HOJE, hrefDaDemanda, hrefDaOs } from "@/lib/operacao/navegacao";
import { cn } from "@/lib/utils";

/**
 * Operação › OS (docs/plataforma/fase-3-operacao.md, parte 3.7d;
 * docs/mockups/OpOS.dc.html): os quatro passos, os locais com a hora da
 * saída e da chegada, as etapas, os itens com o feito e o incluído em campo,
 * as fotos, a equipe, os veículos e o histórico; concluída, o aceite, quem
 * assinou ou recebeu, a assinatura e o motivo de cada item a menos (parte
 * 3.9c). Só apresentação: os dados chegam por props (pages/operacao/os.tsx).
 * Sem legenda e sem valor.
 */

export type EstadoDaFicha = "carregando" | "erro" | "nao_encontrada" | "pronto";

export type CabecalhoDaFicha = { cliente: string; titulo: string | null; tipo: TipoDaDemanda | null };

function Cartao({ titulo, acao, children, className }: { titulo: string; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Passos({ ficha }: { ficha: FichaDaOs }) {
  const passos = passosDaOs(ficha);
  return (
    <ol aria-label="Passos da OS" className={cn("grid grid-cols-2 gap-2 sm:gap-3", passos.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4")}>
      {passos.map((passo) => (
        <li
          key={passo.numero}
          aria-current={passo.estado === "atual" ? "step" : undefined}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border bg-card p-3 sm:gap-3 sm:p-4",
            passo.estado === "atual" ? "border-foreground" : "border-border",
            passo.estado === "pendente" ? "text-muted-foreground" : null,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              passo.estado === "feito" ? "bg-success-soft text-success-soft-foreground" : passo.estado === "atual" ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
            )}
          >
            {passo.estado === "feito" ? <Check className="size-4" /> : passo.numero}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn("text-sm font-semibold", passo.estado === "pendente" ? null : "text-foreground")}>
              {passo.titulo}
              {passo.estado === "feito" ? <span className="sr-only"> · feito</span> : null}
            </span>
            <span className="text-xs">{passo.quem}</span>
            {passo.detalhe ? <span className="text-xs text-muted-foreground">{passo.detalhe}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Local({ rotulo, local, hora }: { rotulo: string; local: LocalLido; hora: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{[rotulo, hora].filter(Boolean).join(" · ")}</span>
        <span className="text-sm font-semibold text-foreground">{[local.endereco ?? local.nome, local.complemento].filter(Boolean).join(" · ")}</span>
        {local.endereco && local.nome ? <span className="text-xs text-muted-foreground">{local.nome}</span> : null}
      </div>
    </div>
  );
}

function Locais({ ficha }: { ficha: FichaDaOs }) {
  const { origem, destino } = ficha.locais;
  const maps = enderecoNoMaps(ficha);
  const contatos = [origem?.contato, destino?.contato].filter((contato, indice, todos): contato is NonNullable<typeof contato> => Boolean(contato) && todos.findIndex((outro) => outro?.nome === contato?.nome) === indice);
  return (
    <Cartao
      titulo="Locais"
      acao={
        maps ? (
          <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-primary underline-offset-4 hover:underline">
            Abrir no Maps
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {origem ? <Local rotulo="Origem" local={origem} hora={horaDaEtapa(ficha, "saida_origem") ? `saída ${horaDaEtapa(ficha, "saida_origem")}` : null} /> : null}
        {destino ? <Local rotulo="Destino" local={destino} hora={horaDaEtapa(ficha, "chegada_destino") ? `chegada ${horaDaEtapa(ficha, "chegada_destino")}` : null} /> : null}
        {!origem && !destino ? <p className="text-sm text-muted-foreground">Sem local</p> : null}
        {contatos.length || ficha.instrucoes ? (
          <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {contatos.length ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Contato do cliente</dt>
                {contatos.map((contato) => (
                  <dd key={contato.nome} className="text-sm font-semibold text-foreground">
                    {[contato.nome, contato.telefone].filter(Boolean).join(" · ")}
                  </dd>
                ))}
              </div>
            ) : null}
            {ficha.instrucoes ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Instruções</dt>
                <dd className="text-sm text-foreground">{ficha.instrucoes}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </Cartao>
  );
}

function Etapas({ ficha }: { ficha: FichaDaOs }) {
  const janela = ficha.janela?.inicio ? (ficha.janela.fim ? `${ficha.janela.inicio}–${ficha.janela.fim}` : ficha.janela.inicio) : null;
  return (
    <Cartao titulo="Etapas" acao={janela ? <span className="text-sm text-muted-foreground">Janela {janela}</span> : null}>
      <ol className="flex flex-col px-5 py-2">
        {etapasDaFicha(ficha).map((etapa) => (
          <li key={etapa.etapa} aria-current={etapa.estado === "atual" ? "step" : undefined} className="flex items-start gap-3 py-2">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                etapa.estado === "feita" ? "bg-success-soft-foreground" : etapa.estado === "atual" ? "bg-amber-soft-foreground" : "bg-border",
              )}
            />
            <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-foreground">{etapa.hora}</span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-sm", etapa.estado === "pendente" || etapa.estado === "pulada" ? "text-muted-foreground" : "text-foreground")}>{etapa.rotulo}</span>
              {etapa.quem ? <span className="text-xs text-muted-foreground">{etapa.quem}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Cartao>
  );
}

function Itens({ ficha }: { ficha: FichaDaOs }) {
  const itens = itensDaFicha(ficha);
  const quando = feitoEm(ficha);
  const coluna = quando ? `Feito às ${quando}` : "Feito";
  return (
    <Cartao
      titulo="Itens"
      acao={
        <Link href={hrefDaDemanda(ficha.demanda)} className="rounded text-sm font-medium text-primary underline-offset-4 hover:underline">
          Escopo e saldo da demanda {ficha.demanda}
        </Link>
      }
    >
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_4rem_6rem_12rem] gap-4 border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Item</span>
        <span>Un</span>
        <span>Planejado</span>
        <span>{coluna}</span>
      </div>
      <ul className="flex flex-col">
        {itens.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 border-t border-border px-5 py-3.5 first:border-t-0">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_4rem_6rem_12rem] md:items-center md:gap-4">
              <span className="text-sm font-medium text-foreground">
                {item.codigo ? <span className="mr-1.5 text-muted-foreground tabular-nums">{item.codigo}</span> : null}
                {item.item}
              </span>
              <span className="hidden text-sm text-muted-foreground md:block">{item.unidade}</span>
              <span className="text-sm tabular-nums text-foreground">
                <span className="md:hidden">Planejado </span>
                <span className="font-semibold">{item.previsto}</span>
                {item.composicao ? <span className="ml-1.5 text-xs text-muted-foreground">{item.composicao}</span> : null}
              </span>
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="block h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-foreground" style={{ width: `${Math.round(item.fracao * 100)}%` }} />
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {item.feito} de {item.previsto}
                </span>
              </span>
            </div>
            {item.incluidos.length || item.alem ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                {item.incluidos.map((inclusao) => (
                  <span key={inclusao.texto} className="text-xs text-foreground">
                    {inclusao.texto}
                  </span>
                ))}
                {item.alem ? <span className={cn(selo, seloAlerta, "ml-auto")}>{item.alem}</span> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

function Conclusao({ ficha, urls }: { ficha: FichaDaOs; urls: Readonly<Record<string, string>> }) {
  const conclusao = conclusaoNaFicha(ficha);
  if (!conclusao) return null;
  const assinatura = conclusao.assinatura ? urls[conclusao.assinatura] : null;
  return (
    <Cartao titulo="Conclusão">
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">{conclusao.aceite}</span>
          {conclusao.responsavel ? <span className="text-sm text-muted-foreground">{conclusao.responsavel}</span> : null}
          <span className="text-xs text-muted-foreground">{conclusao.origem}</span>
        </div>
        {conclusao.assinatura ? (
          <figure className="flex w-full max-w-64 flex-col gap-1 sm:w-64">
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
              {assinatura ? <img src={assinatura} alt={conclusao.aceite} className="size-full object-contain" /> : <ImageIcon aria-hidden="true" className="size-5 text-muted-foreground" />}
            </div>
            <figcaption className="sr-only">Assinatura</figcaption>
          </figure>
        ) : null}
      </div>
      {conclusao.diferencas.length ? (
        <ul aria-label="Itens a menos" className="flex flex-col divide-y divide-border border-t border-border">
          {conclusao.diferencas.map((diferenca) => (
            <li key={diferenca.linha} className="flex flex-col gap-0.5 px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
                {diferenca.item} · {diferenca.quantidade}
              </span>
              <span className="pl-6 text-sm text-muted-foreground">{diferenca.motivo}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Cartao>
  );
}

function Revisao({ ficha }: { ficha: FichaDaOs }) {
  const revisao = revisaoNaFicha(ficha);
  if (!revisao) return null;
  return (
    <Cartao titulo="Revisão" acao={<span className="text-sm text-muted-foreground">{revisao.quando}</span>}>
      {revisao.linhas.length ? (
        <ul aria-label="Decisões" className="flex flex-col divide-y divide-border">
          {revisao.linhas.map((linha) => (
            <li key={linha.linha} className="flex flex-col gap-0.5 px-5 py-3">
              <span className="text-sm font-semibold text-foreground">{linha.texto}</span>
              {linha.motivo ? <span className="text-sm text-muted-foreground">{linha.motivo}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">Sem divergência</p>
      )}
      {revisao.nota ? <p className="border-t border-border px-5 py-3 text-sm text-foreground">{revisao.nota}</p> : null}
    </Cartao>
  );
}

const FOTOS_A_MOSTRAR = 5;

function Fotos({ ficha, urls, acao }: { ficha: FichaDaOs; urls: Readonly<Record<string, string>>; acao?: ReactNode }) {
  const fotos = [...ficha.fotos].sort((a, b) => b.instante.localeCompare(a.instante));
  return (
    <Cartao titulo={`Fotos · ${fotos.length}`} acao={acao}>
      {fotos.length ? (
        <ul className="grid grid-cols-3 gap-2 px-5 py-4 sm:grid-cols-6">
          {fotos.slice(0, FOTOS_A_MOSTRAR).map((foto) => {
            const url = urls[foto.caminho];
            const nome = foto.legenda ?? `Foto ${foto.id}`;
            return (
              <li key={foto.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" aria-label={nome} className="block size-full">
                    <img src={url} alt={nome} className="size-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon aria-hidden="true" className="size-5" />
                    <span className="sr-only">{nome}</span>
                  </span>
                )}
                {foto.legenda ? (
                  <span aria-hidden="true" className="absolute inset-x-1 bottom-1 truncate rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium text-foreground">
                    {foto.legenda}
                  </span>
                ) : null}
              </li>
            );
          })}
          {fotos.length > FOTOS_A_MOSTRAR ? (
            <li className="flex aspect-square items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-foreground">+{fotos.length - FOTOS_A_MOSTRAR}</li>
          ) : null}
        </ul>
      ) : (
        <p className="px-5 py-5 text-sm text-muted-foreground">Nenhuma foto</p>
      )}
    </Cartao>
  );
}

function Equipe({ ficha }: { ficha: FichaDaOs }) {
  return (
    <Cartao
      titulo={`Equipe · ${ficha.equipe.length}`}
      acao={
        ficha.status === "agendada" || ficha.status === "aberta" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={hrefDaOs(ficha.numero)}>Alterar</Link>
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        {ficha.equipe.length ? (
          <ul className="flex flex-col gap-3">
            {ficha.equipe.map((pessoa) => (
              <li key={pessoa.id} className="flex items-center gap-3">
                <Avatar nome={pessoa.nome} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">{pessoa.nome}</span>
                  <span className="truncate text-xs text-muted-foreground">{detalheDaPessoa(pessoa)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={cn(selo, seloAlerta, "self-start")}>Sem equipe</span>
        )}
        <h3 className="border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Veículos · {ficha.veiculos.length}</h3>
        {ficha.veiculos.length ? (
          <ul className="flex flex-col gap-3">
            {ficha.veiculos.map((veiculo) => (
              <li key={veiculo.id} className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <Truck className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-foreground">{veiculo.placa}</span>
                  <span className="truncate text-xs text-muted-foreground">{detalheDoVeiculo(veiculo)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={cn(selo, seloAlerta, "self-start")}>Sem veículo</span>
        )}
      </div>
    </Cartao>
  );
}

function Historico({ ficha, hoje }: { ficha: FichaDaOs; hoje: string }) {
  const entradas = historicoDaOs(ficha, hoje);
  return (
    <Cartao titulo="Histórico">
      {entradas.length ? (
        <ol className="flex flex-col px-5 py-3">
          {entradas.map((entrada) => (
            <li key={entrada.chave} className="flex flex-col gap-0.5 border-l-2 border-border py-2 pl-4">
              <span className="text-sm font-semibold text-foreground">{entrada.titulo}</span>
              <span className="text-xs text-muted-foreground">{entrada.detalhe}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-5 text-sm text-muted-foreground">Nenhum registro</p>
      )}
    </Cartao>
  );
}

export function OsView({
  estado,
  numero,
  ficha,
  cabecalho,
  hoje,
  urls,
  acoes,
  painel,
  anexarFotos,
}: {
  estado: EstadoDaFicha;
  numero: string;
  ficha: FichaDaOs | null;
  cabecalho: CabecalhoDaFicha;
  hoje: string;
  /** A URL de cada foto pelo caminho no Storage; sem ela, o espaço da foto. */
  urls: Readonly<Record<string, string>>;
  /** As ações do cabeçalho (Registrar andamento, parte 3.7e). */
  acoes?: ReactNode;
  /** O painel aberto de Registrar andamento (parte 3.7e). */
  painel?: ReactNode;
  /** Anexar fotos à OS, no cartão das fotos (parte 3.7e). */
  anexarFotos?: ReactNode;
}) {
  const voltar = (
    <Link href={ROTA_HOJE} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Hoje
    </Link>
  );
  if (estado !== "pronto" || !ficha) {
    return (
      <section className="flex flex-col gap-6">
        {voltar}
        <h1 className="text-3xl font-bold tracking-tight text-foreground">OS {numero}</h1>
        {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
        {estado === "erro" ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar a OS.
          </p>
        ) : null}
        {estado === "nao_encontrada" ? <p className="text-sm text-muted-foreground">OS {numero} não encontrada</p> : null}
      </section>
    );
  }
  const subtitulo = [cabecalho.titulo, servicosEmTexto(ficha.servicos), janelaEmTexto(ficha.janela, hoje)].filter(Boolean);
  return (
    <section className="flex flex-col gap-6">
      {voltar}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">OS {ficha.numero}</h1>
            <span className={cn(selo, COR_DO_STATUS[ficha.status])}>{rotuloDoStatusDaOs(ficha)}</span>
            {cabecalho.tipo ? <SeloDoTipo tipo={cabecalho.tipo} /> : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link href={hrefDaDemanda(ficha.demanda)} className="rounded font-medium text-primary underline-offset-4 hover:underline">
              Demanda {ficha.demanda}
            </Link>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-foreground">{cabecalho.cliente}</span>
            {subtitulo.map((parte) => (
              <span key={parte} className="contents">
                <span aria-hidden="true">·</span>
                <span>{parte}</span>
              </span>
            ))}
          </p>
        </div>
        {acoes ? <div className="flex shrink-0 flex-wrap gap-2">{acoes}</div> : null}
      </header>

      {painel}

      {ficha.status === "cancelada" ? (
        <p className={cn(selo, seloNeutro, "h-auto self-start py-1.5 text-sm")}>Cancelada{ficha.cancelamento ? ` · ${ficha.cancelamento}` : ""}</p>
      ) : (
        <Passos ficha={ficha} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {ficha.vistoria ? (
            <Cartao titulo="Vistoria">
              <div className="px-5 py-4">
                <VistoriaEnviada vistoria={ficha.vistoria} fotos={ficha.fotos} urls={urls} />
              </div>
            </Cartao>
          ) : null}
          <Revisao ficha={ficha} />
          <Conclusao ficha={ficha} urls={urls} />
          <Locais ficha={ficha} />
          <Etapas ficha={ficha} />
          {ficha.tipo === "vistoria" ? null : <Itens ficha={ficha} />}
          <Fotos ficha={ficha} urls={urls} acao={anexarFotos} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Equipe ficha={ficha} />
          <Historico ficha={ficha} hoje={hoje} />
        </div>
      </div>
    </section>
  );
}
