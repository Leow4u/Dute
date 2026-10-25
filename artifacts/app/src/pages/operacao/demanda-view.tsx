import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Flag, MapPin, Plus } from "lucide-react";

import {
  COR_DO_STATUS,
  rotuloDoStatusDaOs,
  SeloDoTipo,
  Servicos,
  selo,
  seloNeutro,
} from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { formatarData } from "@/lib/operacao/cadastro";
import {
  chegadaDaDemanda,
  type DemandaDaOperacao,
  type EtapaNaOperacao,
  type LinhaDoSaldo,
} from "@/lib/operacao/demandas";
import type { OsDaFila } from "@/lib/operacao/fila";
import {
  ENTRADA_ROTULO,
  entradaNaTela,
  equipeCurta,
  milesimos,
  type PrazoDoHoje,
} from "@/lib/operacao/hoje";
import { ROTA_DEMANDAS, hrefDaFichaDaOs, hrefDoPlano, hrefDoPlanoDaVistoria } from "@/lib/operacao/navegacao";
import { cn } from "@/lib/utils";

import { Etapa } from "./demandas-view";

/**
 * Operação › Demanda (docs/plataforma/fase-3-operacao.md, parte 3.5b;
 * docs/mockups/OpDemanda.dc.html): o escopo com o que está nas OS e o saldo,
 * as OS da demanda, os locais e, na direta, o pedido. Só apresentação; sem
 * legenda e sem valor. A tela de Planejar OS é da parte 3.6: até lá, a ação
 * abre uma OS com todo o saldo.
 */

export type EstadoDaDemanda =
  "carregando" | "erro" | "nao_encontrada" | "pronto";

export type LocalDaFicha = {
  rotulo: "Origem" | "Destino";
  nome: string | null;
  endereco: string | null;
  complemento: string | null;
};

function Cartao({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={titulo}
      className={cn("rounded-lg border border-border bg-card", className)}
    >
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold text-foreground">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Barra({ linha }: { linha: LinhaDoSaldo }) {
  const total = milesimos(linha.escopo);
  const parte = total
    ? Math.min(100, Math.round((milesimos(linha.nasOs) / total) * 100))
    : 0;
  return (
    <span
      aria-hidden="true"
      className="mt-2 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-foreground"
        style={{ width: `${parte}%` }}
      />
    </span>
  );
}

function Escopo({
  linhas,
  entrada,
}: {
  linhas: readonly LinhaDoSaldo[];
  entrada: DemandaDaOperacao["entrada"];
}) {
  const coluna = entrada === "direta" ? "Pedido" : "Orçado";
  return (
    <Cartao titulo="Escopo e saldo">
      {linhas.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">
          Sem itens no escopo
        </p>
      ) : (
        <>
          <ul className="flex flex-col sm:hidden">
            {linhas.map((linha) => (
              <li
                key={linha.id}
                className="flex flex-col gap-1 border-t border-border px-5 py-3.5 first:border-t-0"
              >
                <span className="text-sm font-medium text-foreground">
                  {linha.item}
                </span>
                <Barra linha={linha} />
                <span className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {coluna} {linha.escopo}
                  {linha.unidade
                    ? ` ${linha.unidade.toLocaleLowerCase("pt-BR")}`
                    : ""}{" "}
                  · Nas OS {linha.nasOs} · Saldo{" "}
                  <span className="font-semibold text-foreground">
                    {linha.saldo}
                  </span>
                </span>
                {linha.osNumeros.length ? (
                  <span className="text-xs text-muted-foreground">
                    {linha.osNumeros.map((numero) => `OS ${numero}`).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left">
              <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    {coluna}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Nas OS
                  </th>
                  <th scope="col" className="px-5 py-3 text-right">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr
                    key={linha.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <td className="px-5 py-3.5 align-top">
                      <span className="text-sm font-medium text-foreground">
                        {linha.item}
                      </span>
                      <Barra linha={linha} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right align-top text-sm tabular-nums text-foreground">
                      {linha.escopo}
                      {linha.unidade ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {linha.unidade.toLocaleLowerCase("pt-BR")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3.5 text-right align-top text-sm tabular-nums">
                      <span className="block font-semibold text-foreground">
                        {linha.nasOs}
                      </span>
                      {linha.osNumeros.length ? (
                        <span className="block text-xs text-muted-foreground">
                          {linha.osNumeros
                            .map((numero) => `OS ${numero}`)
                            .join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3.5 text-right align-top text-sm font-semibold tabular-nums",
                        milesimos(linha.saldo) > 0
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {linha.saldo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Cartao>
  );
}

function quandoDaOs(os: OsDaFila): string {
  if (!os.agenda) return "Sem data";
  return [
    formatarData(os.agenda.data),
    os.agenda.hora && os.agenda.fim
      ? `${os.agenda.hora}–${os.agenda.fim}`
      : os.agenda.hora,
  ]
    .filter(Boolean)
    .join(" ");
}

function OrdensDaDemanda({
  numeroDaDemanda,
  ordens,
  linhasComSaldo,
  podeAbrir,
  vistoria,
}: {
  numeroDaDemanda: string;
  ordens: readonly OsDaFila[];
  linhasComSaldo: number;
  podeAbrir: boolean;
  /** A vistoria que se pode abrir (parte 3.11c): o dia da visita técnica pedida, ou "" sem dia; null quando não se abre. */
  vistoria: string | null;
}) {
  return (
    <Cartao titulo={`OS desta demanda · ${ordens.length}`}>
      <ul className="flex flex-col gap-3 p-5">
        {ordens.map((os) => {
          const equipe = equipeCurta(
            os.pessoas?.map((pessoa) => pessoa.nome) ?? [],
          );
          const detalhe = [
            quandoDaOs(os),
            equipe ?? "Sem equipe",
            os.placas?.length ? os.placas.join(" e ") : "Sem veículo",
          ].join(" · ");
          return (
            <li
              key={os.numero}
              className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <Link
                  href={hrefDaFichaDaOs(os.numero)}
                  className="self-start rounded text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  OS {os.numero}
                </Link>
                {os.rota ? (
                  <span className="text-sm text-muted-foreground">
                    {os.rota}
                  </span>
                ) : null}
                <span className="text-sm text-muted-foreground">{detalhe}</span>
                <Servicos servicos={os.servicos ?? []} />
              </span>
              <span
                className={cn(selo, COR_DO_STATUS[os.status], "self-start")}
              >
                {rotuloDoStatusDaOs(os)}
              </span>
            </li>
          );
        })}
        {podeAbrir && linhasComSaldo > 0 ? (
          <li className="flex flex-col gap-3 rounded-lg border border-dashed border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-semibold text-foreground">
              Saldo de {linhasComSaldo}{" "}
              {linhasComSaldo === 1 ? "item" : "itens"}
            </span>
            <Button asChild size="sm">
              <Link href={hrefDoPlano(numeroDaDemanda)}>
                <Plus aria-hidden="true" className="size-4" />
                Planejar OS
              </Link>
            </Button>
          </li>
        ) : null}
        {vistoria !== null ? (
          <li className="flex flex-col gap-3 rounded-lg border border-dashed border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-semibold text-foreground">{vistoria ? `Vistoria · ${formatarData(vistoria)}` : "Vistoria"}</span>
            <Button asChild size="sm">
              <Link href={hrefDoPlanoDaVistoria(numeroDaDemanda)}>
                <Plus aria-hidden="true" className="size-4" />
                Planejar vistoria
              </Link>
            </Button>
          </li>
        ) : null}
        {ordens.length === 0 && !(podeAbrir && linhasComSaldo > 0) && vistoria === null ? (
          <li className="text-sm text-muted-foreground">Nenhuma OS</li>
        ) : null}
      </ul>
    </Cartao>
  );
}

function Locais({ locais }: { locais: readonly LocalDaFicha[] }) {
  return (
    <Cartao titulo="Locais">
      {locais.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Sem local</p>
      ) : (
        <ul className="flex flex-col gap-4 px-5 py-4">
          {locais.map((local) => (
            <li key={local.rotulo} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              >
                {local.rotulo === "Origem" ? (
                  <MapPin className="size-4" />
                ) : (
                  <Flag className="size-4" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {local.rotulo}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {local.nome ?? local.complemento ?? "Local do cliente"}
                </span>
                {[local.endereco, local.nome ? local.complemento : null].filter(
                  Boolean,
                ).length ? (
                  <span className="text-sm text-muted-foreground">
                    {[local.endereco, local.nome ? local.complemento : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function Pedido({
  demanda,
  prazo,
}: {
  demanda: DemandaDaOperacao;
  prazo: PrazoDoHoje | null;
}) {
  const linhas: Array<[string, string]> = [];
  if (demanda.pedidoPor)
    linhas.push([
      "Pedido por",
      [demanda.pedidoPor.nome, demanda.pedidoPor.telefone]
        .filter(Boolean)
        .join(" · "),
    ]);
  const chegada = chegadaDaDemanda(demanda);
  if (chegada) linhas.push(["Recebida", chegada]);
  if (prazo)
    linhas.push([
      "Executar até",
      [prazo.texto.replace(/ até /, " "), prazo.falta]
        .filter(Boolean)
        .join(" · "),
    ]);
  if (!linhas.length) return null;
  return (
    <Cartao titulo="Pedido">
      <dl className="flex flex-col gap-3 px-5 py-4">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex flex-col">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {rotulo}
            </dt>
            <dd
              className={cn(
                "text-sm text-foreground",
                rotulo === "Executar até" && prazo?.atrasada
                  ? "font-semibold text-destructive"
                  : null,
              )}
            >
              {valor}
            </dd>
          </div>
        ))}
      </dl>
    </Cartao>
  );
}

export function DemandaView({
  estado,
  numero,
  demanda,
  cliente,
  etapa,
  escopo,
  ordens,
  linhasComSaldo,
  locais,
  prazo,
  erro,
  vistoria = null,
}: {
  estado: EstadoDaDemanda;
  numero: string | null;
  demanda: DemandaDaOperacao | null;
  cliente: string;
  etapa: EtapaNaOperacao | null;
  escopo: readonly LinhaDoSaldo[];
  ordens: readonly OsDaFila[];
  linhasComSaldo: number;
  locais: readonly LocalDaFicha[];
  prazo: PrazoDoHoje | null;
  erro: string | null;
  /** A vistoria que se pode abrir: o dia da visita técnica, "" sem dia, ou null (parte 3.11c). */
  vistoria?: string | null;
}) {
  const voltar = (
    <Link
      href={ROTA_DEMANDAS}
      className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Demandas
    </Link>
  );
  if (estado !== "pronto" || !demanda || !etapa) {
    return (
      <section className="flex flex-col gap-4">
        {voltar}
        {estado === "carregando" ? (
          <p className="text-sm text-muted-foreground">Carregando</p>
        ) : null}
        {estado === "erro" ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar a demanda.
          </p>
        ) : null}
        {estado === "nao_encontrada" || (estado === "pronto" && !demanda) ? (
          <p className="text-sm text-muted-foreground">
            {numero
              ? `Demanda ${numero} não encontrada`
              : "Demanda não encontrada"}
          </p>
        ) : null}
      </section>
    );
  }
  const podeAbrir =
    etapa === "para_planejar" ||
    etapa === "para_agendar" ||
    etapa === "agendada" ||
    etapa === "em_execucao" ||
    etapa === "em_revisao";
  return (
    <section className="flex flex-col gap-6">
      {voltar}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Demanda {demanda.numero}
            {demanda.titulo ? (
              <span className="font-semibold"> · {demanda.titulo}</span>
            ) : null}
          </h1>
          <SeloDoTipo tipo={demanda.tipo} />
          <span className={cn(selo, seloNeutro, "font-medium")}>
            <Etapa etapa={etapa} />
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{cliente}</span>
          <span aria-hidden="true">·</span>
          <span>{ENTRADA_ROTULO[entradaNaTela(demanda)]}</span>
        </p>
      </header>
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Escopo linhas={escopo} entrada={demanda.entrada} />
          <OrdensDaDemanda
            numeroDaDemanda={demanda.numero}
            ordens={ordens}
            linhasComSaldo={linhasComSaldo}
            podeAbrir={podeAbrir}
            vistoria={vistoria}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Pedido demanda={demanda} prazo={prazo} />
          <Locais locais={locais} />
        </div>
      </div>
    </section>
  );
}
