import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Flag, MapPin, Plus, Trash2, X } from "lucide-react";

import { Avatar, SeloDoTipo, selo, seloNeutro } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAPEL_ROTULO, VINCULO_ROTULO, formatarData, type ColaboradorDaLista, type PapelDeCampo, type VeiculoDaLista } from "@/lib/operacao/cadastro";
import {
  divisaoEmTexto,
  duracaoSugeridaEmTexto,
  itemEmTexto,
  planoOtimistaEmTexto,
  type Sugestao,
  type SugestaoNaTela,
} from "@/lib/memoria/sugestao";
import type { DemandaDaOperacao, LinhaDoSaldo } from "@/lib/operacao/demandas";
import { hrefDaDemanda } from "@/lib/operacao/navegacao";
import {
  papeisDaPessoa,
  restanteEmTexto,
  type FormularioDoPlano,
  type OsNoPlano,
} from "@/lib/operacao/planejar";
import { cn } from "@/lib/utils";

import type { LocalDaFicha } from "./demanda-view";

/**
 * Operação › Planejar OS (docs/plataforma/fase-3-operacao.md, parte 3.6a;
 * docs/mockups/OpOSPlanejar.dc.html): uma ou várias OS da demanda com a
 * fatia do saldo, a janela, a equipe com o papel de cada pessoa (inclusive
 * freelancer e terceiro), os veículos, os contatos no local e as instruções.
 * Só apresentação: o estado e a gravação chegam por props
 * (pages/operacao/planejar.tsx). Sem legenda e sem preço. A vistoria (parte
 * 3.11c) usa a mesma tela, numa OS só, sem itens e só com o local de origem.
 * Com a memória liberada (parte 5.2b), cada OS mostra a duração sugerida.
 */

export type EstadoDoPlano = "carregando" | "erro" | "nao_encontrada" | "sem_saldo" | "indisponivel" | "pronto";

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Cartao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {acao}
      </header>
      {children}
    </section>
  );
}

function rotuloDaOs(indice: number, total: number) {
  return total > 1 ? `OS ${indice + 1}` : "Nesta OS";
}

/**
 * A duração sugerida pela memória da Dute para a OS (parte 5.2b), com a base
 * de cada item: de onde veio, quantas execuções e as OS mais recentes. "Usar"
 * só preenche a janela; quem salva é a pessoa.
 */
function SugestaoDaOs({ sugestao, rotulo, onUsar, onIgnorar }: { sugestao: Sugestao; rotulo: string; onUsar: () => void; onIgnorar: () => void }) {
  const titulo = duracaoSugeridaEmTexto(sugestao);
  return (
    <div role="group" aria-label={`Duração sugerida · ${rotulo}`} className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2.5 text-sm">
      {titulo ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{titulo}</span>
          <div className="ml-auto flex gap-1">
            <Button type="button" variant="outline" size="sm" onClick={onUsar}>
              Usar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onIgnorar}>
              Ignorar
            </Button>
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">Sem base para sugerir a duração</span>
      )}
      {titulo ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {sugestao.itens.map((item, indice) => (
            <li key={`${item.lpu_item_id ?? "livre"}-${indice}`}>{itemEmTexto(item, sugestao.pessoas)}</li>
          ))}
        </ul>
      ) : null}
      {sugestao.divisao ? <p className="text-muted-foreground">{divisaoEmTexto(sugestao.divisao)}</p> : null}
      {sugestao.plano_otimista ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-soft-border bg-amber-soft px-2.5 py-1.5 text-amber-soft-foreground">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {planoOtimistaEmTexto(sugestao.plano_otimista)}
        </p>
      ) : null}
    </div>
  );
}

function Quando({
  ordens,
  onOs,
  onRemover,
  onDividir,
  sugestoes = [],
  ignoradas = [],
  onUsarSugestao,
  onIgnorarSugestao,
}: {
  ordens: readonly OsNoPlano[];
  onOs: (indice: number, os: OsNoPlano) => void;
  onRemover: (indice: number) => void;
  /** Mais uma OS; sem ela (a vistoria), o plano fica numa OS só. */
  onDividir?: () => void;
  /** A duração sugerida de cada OS, pelo índice (parte 5.2b). */
  sugestoes?: ReadonlyArray<SugestaoNaTela | null>;
  ignoradas?: readonly boolean[];
  onUsarSugestao?: (indice: number) => void;
  onIgnorarSugestao?: (indice: number) => void;
}) {
  return (
    <Cartao
      titulo="Quando"
      acao={
        onDividir ? (
          <Button type="button" variant="outline" size="sm" onClick={onDividir}>
            <Plus aria-hidden="true" className="size-4" />
            Mais uma OS
          </Button>
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-4 px-5 py-4">
        {ordens.map((os, indice) => {
          const sugestao = sugestoes[indice];
          return (
            <li key={indice} className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                {ordens.length > 1 ? (
                  <span className="flex h-10 shrink-0 items-center text-sm font-semibold text-foreground sm:w-14">OS {indice + 1}</span>
                ) : null}
                <Campo id={`os-${indice}-data`} rotulo="Data" className="flex-1">
                  <Input id={`os-${indice}-data`} type="date" value={os.data} onChange={(event) => onOs(indice, { ...os, data: event.target.value })} />
                </Campo>
                <div className="grid grid-cols-2 gap-3 sm:contents">
                  <Campo id={`os-${indice}-inicio`} rotulo="Início" className="sm:w-32">
                    <Input id={`os-${indice}-inicio`} type="time" value={os.inicio} onChange={(event) => onOs(indice, { ...os, inicio: event.target.value.slice(0, 5) })} />
                  </Campo>
                  <Campo id={`os-${indice}-fim`} rotulo="Fim" className="sm:w-32">
                    <Input id={`os-${indice}-fim`} type="time" value={os.fim} onChange={(event) => onOs(indice, { ...os, fim: event.target.value.slice(0, 5) })} />
                  </Campo>
                </div>
                {ordens.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Tirar a OS ${indice + 1}`} onClick={() => onRemover(indice)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                ) : null}
              </div>
              {sugestao?.estado === "pronto" && sugestao.sugestao && !ignoradas[indice] && onUsarSugestao && onIgnorarSugestao ? (
                <SugestaoDaOs
                  sugestao={sugestao.sugestao}
                  rotulo={ordens.length > 1 ? `OS ${indice + 1}` : "Nesta OS"}
                  onUsar={() => onUsarSugestao(indice)}
                  onIgnorar={() => onIgnorarSugestao(indice)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}

function Locais({
  locais,
  form,
  onForm,
  rotulos = ["Origem", "Destino"],
}: {
  locais: readonly LocalDaFicha[];
  form: FormularioDoPlano;
  onForm: (form: FormularioDoPlano) => void;
  /** A vistoria é só no local de origem. */
  rotulos?: ReadonlyArray<"Origem" | "Destino">;
}) {
  return (
    <Cartao titulo={rotulos.length === 1 ? "Local" : "Locais"}>
      <div className={cn("grid grid-cols-1 gap-4 px-5 py-4", rotulos.length > 1 ? "lg:grid-cols-2" : null)}>
        {rotulos.map((rotulo) => {
          const local = locais.find((item) => item.rotulo === rotulo) ?? null;
          const campo = rotulo === "Origem" ? "contatoOrigem" : "contatoDestino";
          const id = rotulo.toLocaleLowerCase("pt-BR");
          return (
            <div key={rotulo} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {rotulo === "Origem" ? <MapPin className="size-4" /> : <Flag className="size-4" />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
                  <span className="text-sm font-semibold text-foreground">{local?.nome ?? local?.complemento ?? "Sem local"}</span>
                  {local && [local.endereco, local.nome ? local.complemento : null].filter(Boolean).length ? (
                    <span className="text-sm text-muted-foreground">{[local.endereco, local.nome ? local.complemento : null].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo id={`contato-${id}-nome`} rotulo="Contato no local">
                  <Input id={`contato-${id}-nome`} value={form[campo].nome} onChange={(event) => onForm({ ...form, [campo]: { ...form[campo], nome: event.target.value } })} />
                </Campo>
                <Campo id={`contato-${id}-telefone`} rotulo="Telefone">
                  <Input
                    id={`contato-${id}-telefone`}
                    type="tel"
                    value={form[campo].telefone}
                    onChange={(event) => onForm({ ...form, [campo]: { ...form[campo], telefone: event.target.value } })}
                  />
                </Campo>
              </div>
            </div>
          );
        })}
      </div>
    </Cartao>
  );
}

function Itens({
  saldo,
  form,
  restante,
  onQuantidade,
  onIgualar,
}: {
  saldo: readonly LinhaDoSaldo[];
  form: FormularioDoPlano;
  restante: ReadonlyMap<string, number>;
  onQuantidade: (indice: number, linha: string, valor: string) => void;
  onIgualar: (indice: number) => void;
}) {
  const total = form.ordens.length;
  return (
    <Cartao
      titulo="Itens do saldo"
      acao={
        total === 1 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onIgualar(0)}>
            Igualar ao saldo
          </Button>
        ) : null
      }
    >
      <ul className="flex flex-col">
        {saldo.map((linha) => {
          const sobra = restante.get(linha.id) ?? 0;
          return (
            <li key={linha.id} className="flex flex-col gap-3 border-t border-border px-5 py-3.5 first:border-t-0 lg:flex-row lg:items-end">
              <span className="flex min-w-0 flex-1 flex-col lg:self-center">
                <span className="text-sm font-medium text-foreground">{linha.item}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  Saldo {linha.saldo}
                  {linha.unidade ? ` ${linha.unidade.toLocaleLowerCase("pt-BR")}` : ""}
                </span>
              </span>
              <div className="flex flex-wrap items-end gap-3">
                {form.ordens.map((os, indice) => (
                  <Campo key={indice} id={`item-${linha.id}-${indice}`} rotulo={rotuloDaOs(indice, total)} className="w-28">
                    <Input
                      id={`item-${linha.id}-${indice}`}
                      inputMode="decimal"
                      value={os.itens[linha.id] ?? ""}
                      onChange={(event) => onQuantidade(indice, linha.id, event.target.value)}
                    />
                  </Campo>
                ))}
                <span className="flex w-24 flex-col">
                  <span className="text-sm font-medium text-foreground">Restante</span>
                  <span className={cn("flex h-10 items-center text-sm font-semibold tabular-nums", sobra < 0 ? "text-destructive" : sobra === 0 ? "text-muted-foreground" : "text-foreground")}>
                    {restanteEmTexto(sobra)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {total > 1 ? (
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          {form.ordens.map((_, indice) => (
            <Button key={indice} type="button" variant="ghost" size="sm" onClick={() => onIgualar(indice)}>
              OS {indice + 1}: igualar ao saldo
            </Button>
          ))}
        </div>
      ) : null}
    </Cartao>
  );
}

function OrdensDoParticipante({
  total,
  ordens,
  nome,
  onOrdens,
}: {
  total: number;
  ordens: readonly number[];
  nome: string;
  onOrdens: (ordens: number[]) => void;
}) {
  if (total <= 1) return null;
  return (
    <div role="group" aria-label={`OS de ${nome}`} className="flex flex-wrap gap-1.5">
      {Array.from({ length: total }, (_, indice) => {
        const marcada = ordens.includes(indice);
        return (
          <button
            key={indice}
            type="button"
            aria-pressed={marcada}
            onClick={() => onOrdens(marcada ? ordens.filter((item) => item !== indice) : [...ordens, indice].sort((a, b) => a - b))}
            className={cn(
              "h-7 rounded-md border px-2 text-xs font-semibold",
              marcada ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground",
            )}
          >
            OS {indice + 1}
          </button>
        );
      })}
    </div>
  );
}

function Equipe({
  form,
  pessoas,
  onForm,
}: {
  form: FormularioDoPlano;
  pessoas: readonly ColaboradorDaLista[];
  onForm: (form: FormularioDoPlano) => void;
}) {
  const porId = new Map(pessoas.map((pessoa) => [pessoa.id, pessoa]));
  const livres = pessoas.filter((pessoa) => pessoa.ativo && !form.equipe.some((item) => item.colaboradorId === pessoa.id));
  const grupos = (["proprio", "freelancer", "terceiro"] as const)
    .map((vinculo) => ({ vinculo, pessoas: livres.filter((pessoa) => pessoa.vinculo === vinculo) }))
    .filter((grupo) => grupo.pessoas.length);
  return (
    <Cartao titulo={`Equipe · ${form.equipe.length}`}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {form.equipe.length ? (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {form.equipe.map((item, posicao) => {
              const pessoa = porId.get(item.colaboradorId);
              const nome = pessoa?.nome ?? item.colaboradorId;
              const trocar = (novo: typeof item) => onForm({ ...form, equipe: form.equipe.map((atual, indice) => (indice === posicao ? novo : atual)) });
              return (
                <li key={item.colaboradorId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <Avatar nome={nome} />
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{nome}</span>
                      {pessoa && pessoa.vinculo !== "proprio" ? (
                        <span className={cn(selo, seloNeutro, "font-medium")}>
                          {pessoa.vinculo === "terceiro" && pessoa.empresa ? `Terceiro · ${pessoa.empresa}` : VINCULO_ROTULO[pessoa.vinculo]}
                        </span>
                      ) : null}
                      {pessoa?.noApp ? <span className={cn(selo, seloNeutro, "font-medium")}>no app</span> : null}
                    </span>
                    <label className="flex flex-col gap-1">
                      <span className="sr-only">Papel de {nome}</span>
                      <select className={cn(campoClasse, "h-9")} value={item.papel} onChange={(event) => trocar({ ...item, papel: event.target.value as PapelDeCampo | "" })}>
                        <option value="">Sem papel</option>
                        {(pessoa ? papeisDaPessoa(pessoa) : []).map((papel) => (
                          <option key={papel} value={papel}>
                            {PAPEL_ROTULO[papel]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <OrdensDoParticipante total={form.ordens.length} ordens={item.ordens} nome={nome} onOrdens={(ordens) => trocar({ ...item, ordens })} />
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Tirar ${nome}`}
                    onClick={() => onForm({ ...form, equipe: form.equipe.filter((_, indice) => indice !== posicao) })}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <label className="flex max-w-sm flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Adicionar pessoa</span>
          <select
            className={campoClasse}
            value=""
            onChange={(event) => {
              const pessoa = porId.get(event.target.value);
              if (!pessoa) return;
              onForm({
                ...form,
                equipe: [...form.equipe, { colaboradorId: pessoa.id, papel: pessoa.papeis[0] ?? "", ordens: form.ordens.map((_, indice) => indice) }],
              });
            }}
          >
            <option value="">Escolha</option>
            {grupos.map((grupo) => (
              <optgroup key={grupo.vinculo} label={VINCULO_ROTULO[grupo.vinculo]}>
                {grupo.pessoas.map((pessoa) => (
                  <option key={pessoa.id} value={pessoa.id}>
                    {[pessoa.nome, pessoa.funcao, pessoa.vinculo === "terceiro" ? pessoa.empresa : null].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
    </Cartao>
  );
}

function Veiculos({
  form,
  veiculos,
  onForm,
}: {
  form: FormularioDoPlano;
  veiculos: readonly VeiculoDaLista[];
  onForm: (form: FormularioDoPlano) => void;
}) {
  const porId = new Map(veiculos.map((veiculo) => [veiculo.id, veiculo]));
  const livres = veiculos.filter((veiculo) => veiculo.ativo && !form.veiculos.some((item) => item.veiculoId === veiculo.id));
  return (
    <Cartao titulo={`Veículos · ${form.veiculos.length}`}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {form.veiculos.length ? (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {form.veiculos.map((item, posicao) => {
              const veiculo = porId.get(item.veiculoId);
              const placa = veiculo?.placa ?? item.veiculoId;
              return (
                <li key={item.veiculoId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{placa}</span>
                      {veiculo?.dono === "terceiro" ? (
                        <span className={cn(selo, seloNeutro, "font-medium")}>{veiculo.empresa ? `Terceiro · ${veiculo.empresa}` : "Terceiro"}</span>
                      ) : null}
                    </span>
                    {veiculo ? <span className="text-sm text-muted-foreground">{[veiculo.tipo, veiculo.resumo].filter(Boolean).join(" · ")}</span> : null}
                    <OrdensDoParticipante
                      total={form.ordens.length}
                      ordens={item.ordens}
                      nome={placa}
                      onOrdens={(ordens) => onForm({ ...form, veiculos: form.veiculos.map((atual, indice) => (indice === posicao ? { ...atual, ordens } : atual)) })}
                    />
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Tirar ${placa}`}
                    onClick={() => onForm({ ...form, veiculos: form.veiculos.filter((_, indice) => indice !== posicao) })}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <label className="flex max-w-sm flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Adicionar veículo</span>
          <select
            className={campoClasse}
            value=""
            onChange={(event) => {
              if (!porId.get(event.target.value)) return;
              onForm({ ...form, veiculos: [...form.veiculos, { veiculoId: event.target.value, ordens: form.ordens.map((_, indice) => indice) }] });
            }}
          >
            <option value="">Escolha</option>
            {livres.map((veiculo) => (
              <option key={veiculo.id} value={veiculo.id}>
                {[veiculo.placa, veiculo.tipo, veiculo.dono === "terceiro" ? veiculo.empresa || "Terceiro" : null].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Cartao>
  );
}

function Resumo({
  form,
  pessoas,
  veiculos,
  saldo,
  alertas,
  problemas,
  erro,
  ocupado,
  voltar,
  onGravar,
  vistoria,
}: {
  form: FormularioDoPlano;
  pessoas: readonly ColaboradorDaLista[];
  veiculos: readonly VeiculoDaLista[];
  saldo: readonly LinhaDoSaldo[];
  alertas: readonly string[];
  problemas: readonly string[];
  erro: string | null;
  ocupado: boolean;
  voltar: string;
  onGravar: (agendar: boolean) => void;
  vistoria: boolean;
}) {
  const porId = new Map(pessoas.map((pessoa) => [pessoa.id, pessoa]));
  const equipe = form.equipe.map((item) => porId.get(item.colaboradorId)).filter((pessoa): pessoa is ColaboradorDaLista => Boolean(pessoa));
  const freelancers = equipe.filter((pessoa) => pessoa.vinculo === "freelancer").length;
  const terceiros = equipe.filter((pessoa) => pessoa.vinculo === "terceiro").length;
  const placas = form.veiculos.map((item) => veiculos.find((veiculo) => veiculo.id === item.veiculoId)?.placa ?? item.veiculoId);
  const linhas = saldo.filter((linha) => form.ordens.some((os) => Number((os.itens[linha.id] ?? "").replace(",", ".")) > 0)).length;
  const quando = form.ordens.map((os) => (os.data ? formatarData(os.data) : "Sem data")).join(" · ");
  const itens: Array<[string, string]> = [
    ...(vistoria ? [] : ([["OS", String(form.ordens.length)]] as Array<[string, string]>)),
    ["Quando", quando],
    ...(vistoria ? [] : ([["Itens", String(linhas)]] as Array<[string, string]>)),
    ["Equipe", [String(equipe.length), freelancers ? `${freelancers} ${freelancers === 1 ? "freelancer" : "freelancers"}` : null, terceiros ? `${terceiros} ${terceiros === 1 ? "terceiro" : "terceiros"}` : null].filter(Boolean).join(" · ")],
    ["Veículos", placas.length ? placas.join(" · ") : "Nenhum"],
  ];
  return (
    <aside className="flex flex-col gap-4 self-start rounded-lg border border-border bg-card p-5 xl:sticky xl:top-6">
      <h2 className="text-lg font-bold text-foreground">Resumo</h2>
      <dl className="flex flex-col gap-2.5">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-start justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="text-right font-medium text-foreground">{valor}</dd>
          </div>
        ))}
      </dl>
      {alertas.length ? (
        <ul aria-label="Atenção" className="flex flex-col gap-1.5 rounded-md border border-amber-soft-border bg-amber-soft px-3 py-2.5 text-sm text-amber-soft-foreground">
          {alertas.map((alerta) => (
            <li key={alerta} className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {alerta}
            </li>
          ))}
        </ul>
      ) : null}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      {problemas.length ? (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-destructive">
          {problemas.map((problema) => (
            <li key={problema}>{problema}</li>
          ))}
        </ul>
      ) : null}
      <Button type="button" disabled={ocupado} className="w-full" onClick={() => onGravar(true)}>
        Agendar
      </Button>
      <Button type="button" variant="outline" disabled={ocupado} className="w-full" onClick={() => onGravar(false)}>
        Salvar rascunho
      </Button>
      <Button asChild variant="ghost" className="w-full">
        <Link href={voltar}>Cancelar</Link>
      </Button>
    </aside>
  );
}

export function PlanejarView({
  estado,
  numero,
  demanda,
  cliente,
  saldo,
  restante,
  locais,
  form,
  onForm,
  onQuantidade,
  onIgualar,
  onDividir,
  onRemoverOs,
  pessoas,
  veiculos,
  alertas,
  problemas,
  ocupado,
  erro,
  onGravar,
  vistoria = false,
  motivo = null,
  sugestoes,
  ignoradas,
  onUsarSugestao,
  onIgnorarSugestao,
}: {
  estado: EstadoDoPlano;
  numero: string | null;
  demanda: DemandaDaOperacao | null;
  cliente: string;
  saldo: readonly LinhaDoSaldo[];
  restante: ReadonlyMap<string, number>;
  locais: readonly LocalDaFicha[];
  form: FormularioDoPlano | null;
  onForm: (form: FormularioDoPlano) => void;
  onQuantidade: (indice: number, linha: string, valor: string) => void;
  onIgualar: (indice: number) => void;
  onDividir: () => void;
  onRemoverOs: (indice: number) => void;
  pessoas: readonly ColaboradorDaLista[];
  veiculos: readonly VeiculoDaLista[];
  alertas: readonly string[];
  problemas: readonly string[];
  ocupado: boolean;
  erro: string | null;
  /** Agendar (com a janela) ou salvar o rascunho (Para agendar). */
  onGravar: (agendar: boolean) => void;
  /** Planejar a vistoria (parte 3.11c): uma OS, sem itens. */
  vistoria?: boolean;
  /** Por que a demanda não recebe a vistoria (estado indisponivel). */
  motivo?: string | null;
  /** A duração sugerida de cada OS, pelo índice, e as que a pessoa ignorou (parte 5.2b). */
  sugestoes?: ReadonlyArray<SugestaoNaTela | null>;
  ignoradas?: readonly boolean[];
  onUsarSugestao?: (indice: number) => void;
  onIgnorarSugestao?: (indice: number) => void;
}) {
  const voltar = numero ? hrefDaDemanda(numero) : "/operacao/demandas";
  const linkDeVolta = (
    <Link href={voltar} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {numero ? `Demanda ${numero}` : "Demandas"}
    </Link>
  );
  if (estado !== "pronto" || !demanda || !form) {
    return (
      <section className="flex flex-col gap-4">
        {linkDeVolta}
        {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
        {estado === "erro" ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar a demanda.
          </p>
        ) : null}
        {estado === "nao_encontrada" ? <p className="text-sm text-muted-foreground">{numero ? `Demanda ${numero} não encontrada` : "Demanda não encontrada"}</p> : null}
        {estado === "sem_saldo" ? <p className="text-sm text-muted-foreground">Todo o saldo da demanda já está em OS</p> : null}
        {estado === "indisponivel" && motivo ? <p className="text-sm text-muted-foreground">{motivo}</p> : null}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-6">
      {linkDeVolta}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {vistoria ? "Planejar vistoria" : "Planejar OS"} · Demanda {demanda.numero}
          </h1>
          <SeloDoTipo tipo={demanda.tipo} />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{cliente}</span>
          {demanda.titulo ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{demanda.titulo}</span>
            </>
          ) : null}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form
          id="planejar-os"
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onGravar(true);
          }}
        >
          <Quando
            ordens={form.ordens}
            onOs={(indice, os) => onForm({ ...form, ordens: form.ordens.map((atual, posicao) => (posicao === indice ? os : atual)) })}
            onRemover={onRemoverOs}
            onDividir={vistoria ? undefined : onDividir}
            sugestoes={sugestoes}
            ignoradas={ignoradas}
            onUsarSugestao={onUsarSugestao}
            onIgnorarSugestao={onIgnorarSugestao}
          />
          {vistoria ? null : <Itens saldo={saldo} form={form} restante={restante} onQuantidade={onQuantidade} onIgualar={onIgualar} />}
          <Equipe form={form} pessoas={pessoas} onForm={onForm} />
          <Veiculos form={form} veiculos={veiculos} onForm={onForm} />
          <Locais locais={locais} form={form} onForm={onForm} rotulos={vistoria ? ["Origem"] : undefined} />
          <Cartao titulo="Instruções">
            <div className="px-5 py-4">
              <Campo id="planejar-instrucoes" rotulo="Para a equipe">
                <Textarea id="planejar-instrucoes" rows={4} value={form.instrucoes} onChange={(event) => onForm({ ...form, instrucoes: event.target.value })} />
              </Campo>
            </div>
          </Cartao>
        </form>
        <Resumo
          form={form}
          pessoas={pessoas}
          veiculos={veiculos}
          saldo={saldo}
          alertas={alertas}
          problemas={problemas}
          erro={erro}
          ocupado={ocupado}
          voltar={voltar}
          onGravar={onGravar}
          vistoria={vistoria}
        />
      </div>
    </section>
  );
}
