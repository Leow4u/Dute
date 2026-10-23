import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";

import { SeloDoTipo, type OpcaoDeFiltro } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  CANAIS_DA_DIRETA,
  CANAL_ROTULO,
  instanteDeSaoPaulo,
  tipoDoFormulario,
  type CanalDaDireta,
  type FormularioDaDemanda,
  type ItemDoCatalogo,
  type LinhaDoPedido,
} from "@/lib/operacao/demanda-direta";
import { TIPOS_DA_DEMANDA, TIPO_ROTULO, prazoDaDemanda, type TipoDaDemanda } from "@/lib/operacao/hoje";
import { ROTA_HOJE, hrefDaDemanda } from "@/lib/operacao/navegacao";
import { pedidoEmTexto, type SolicitacaoDaOperacao } from "@/lib/operacao/solicitacoes";
import { cn } from "@/lib/utils";

/**
 * Operação › Nova demanda direta (docs/plataforma/fase-3-operacao.md, parte
 * 3.5c; docs/mockups/OpDemandaNova.dc.html): o paraquedas e o emergencial que
 * chegam direto na Operação e se orçam depois da execução. O tipo sai da hora;
 * o coordenador corrige. Aberta pela solicitação do portal (parte 4.4c,
 * `?solicitacao=`), o formulário vem preenchido por ela, o canal é o portal,
 * "recebida em" é o instante da solicitação e, ao lado, a solicitação do
 * cliente com os anexos e a recusa com o motivo. Só apresentação: o estado e
 * a gravação chegam por props (pages/operacao/demanda-nova.tsx). Sem legenda
 * e sem preço.
 */

/** A solicitação do portal ao lado do formulário (parte 4.4c). */
export type PainelDaSolicitacao = {
  solicitacao: SolicitacaoDaOperacao;
  /** A URL de cada anexo pelo caminho no Storage. */
  urls: Readonly<Record<string, string>>;
  /** "Já virou a demanda 10050" ou "Recusada": não se atende mais. */
  resolvida: string | null;
  recusa: { aberta: boolean; motivo: string; problema: string | null; ocupado: boolean; erro: string | null };
  onRecusar: () => void;
  onMotivo: (motivo: string) => void;
  onConfirmarRecusa: () => void;
  onVoltar: () => void;
};

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50";

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      <legend className="float-left mb-1 w-full text-base font-semibold text-foreground">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function LinhaDoItem({
  linha,
  onLinha,
  onRemover,
}: {
  linha: LinhaDoPedido;
  onLinha: (linha: LinhaDoPedido) => void;
  onRemover: () => void;
}) {
  const id = `item-${linha.chave}`;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-end">
      {linha.lpuItemId ? (
        <span className="flex min-w-0 flex-1 flex-col sm:self-center">
          <span className="text-sm font-medium text-foreground">{linha.item}</span>
          {linha.unidade ? <span className="text-sm text-muted-foreground">{linha.unidade}</span> : null}
        </span>
      ) : (
        <>
          <Campo id={`${id}-nome`} rotulo="Item avulso" className="flex-1">
            <Input id={`${id}-nome`} value={linha.item} onChange={(event) => onLinha({ ...linha, item: event.target.value })} />
          </Campo>
          <Campo id={`${id}-unidade`} rotulo="Unidade" className="sm:w-24">
            <Input id={`${id}-unidade`} value={linha.unidade} onChange={(event) => onLinha({ ...linha, unidade: event.target.value })} />
          </Campo>
        </>
      )}
      <Campo id={`${id}-quantidade`} rotulo="Quantidade" className="sm:w-28">
        <Input
          id={`${id}-quantidade`}
          inputMode="decimal"
          value={linha.quantidade}
          onChange={(event) => onLinha({ ...linha, quantidade: event.target.value })}
        />
      </Campo>
      <Button type="button" variant="ghost" size="icon" aria-label={`Tirar ${linha.item || "item avulso"}`} onClick={onRemover}>
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </li>
  );
}

function PainelDoPortal({ painel }: { painel: PainelDaSolicitacao }) {
  const { solicitacao, recusa } = painel;
  const linhas: Array<[string, ReactNode]> = [
    ["Cliente", solicitacao.cliente],
    ["Contato", [solicitacao.contato.nome, solicitacao.contato.email].filter(Boolean).join(" · ") || "—"],
    ["Pedido", pedidoEmTexto(solicitacao)],
    ["Origem", solicitacao.origem || "—"],
    ["Destino", solicitacao.destino ?? "—"],
  ];
  return (
    <section aria-label="Solicitação do portal" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-bold text-foreground">Solicitação do portal</h2>
      <dl className="flex flex-col gap-2.5">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-start justify-between gap-4 text-sm">
            <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-foreground">{valor}</dd>
          </div>
        ))}
        <div className="flex flex-col gap-1 text-sm">
          <dt className="text-muted-foreground">O que será feito</dt>
          <dd className="whitespace-pre-line break-words font-medium text-foreground">{solicitacao.descricao}</dd>
        </div>
        {solicitacao.anexos.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <dt className="text-muted-foreground">Anexos</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {solicitacao.anexos.map((anexo) => (
                  <li key={anexo.caminho} className="min-w-0 break-words">
                    {painel.urls[anexo.caminho] ? (
                      <a href={painel.urls[anexo.caminho]} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
                        {anexo.nome}
                      </a>
                    ) : (
                      <span className="font-medium text-foreground">{anexo.nome}</span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      {painel.resolvida ? (
        <p role="status" className="text-sm font-semibold text-foreground">
          {solicitacao.demanda ? <Link href={hrefDaDemanda(solicitacao.demanda)} className="underline underline-offset-4">{painel.resolvida}</Link> : painel.resolvida}
        </p>
      ) : recusa.aberta ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Campo id="recusa-motivo" rotulo="Motivo">
            <Textarea
              id="recusa-motivo"
              rows={3}
              value={recusa.motivo}
              onChange={(event) => painel.onMotivo(event.target.value)}
              {...(recusa.problema ? { "aria-invalid": true, "aria-describedby": "recusa-motivo-problema" } : {})}
            />
          </Campo>
          {recusa.problema ? (
            <p id="recusa-motivo-problema" className="text-sm text-destructive">
              {recusa.problema}
            </p>
          ) : null}
          {recusa.erro ? (
            <p role="alert" className="text-sm text-destructive">
              {recusa.erro}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={recusa.ocupado} onClick={painel.onConfirmarRecusa}>
              Recusar solicitação
            </Button>
            <Button type="button" variant="ghost" onClick={painel.onVoltar}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="self-start" onClick={painel.onRecusar}>
          Recusar
        </Button>
      )}
    </section>
  );
}

function Resumo({
  form,
  cliente,
  agora,
  ocupado,
  erro,
  problemas,
}: {
  form: FormularioDaDemanda;
  cliente: string | null;
  agora: Date;
  ocupado: boolean;
  erro: string | null;
  problemas: readonly string[];
}) {
  const { tipo } = tipoDoFormulario(form);
  const prazo = prazoDaDemanda(instanteDeSaoPaulo(form.executarData, form.executarHora), agora);
  const recebida = instanteDeSaoPaulo(form.recebidaData, form.recebidaHora);
  const linhas: Array<[string, ReactNode]> = [
    ["Cliente", cliente ?? "—"],
    ["Pedido por", form.pedidoPorNome.trim() || "—"],
    ["Canal", CANAL_ROTULO[form.canal]],
    ["Recebida", recebida ? `${form.recebidaData.split("-").reverse().join("/")} ${form.recebidaHora.slice(0, 5)}` : "—"],
    [
      "Prazo",
      prazo ? (
        <span className={prazo.atrasada ? "font-semibold text-destructive" : undefined}>{[prazo.texto, prazo.falta].filter(Boolean).join(" · ")}</span>
      ) : (
        "—"
      ),
    ],
    ["Itens", String(form.linhas.length)],
  ];
  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">Nova demanda</h2>
        {tipo ? <SeloDoTipo tipo={tipo} /> : null}
      </div>
      <dl className="flex flex-col gap-2.5">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-start justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="text-right font-medium text-foreground">{valor}</dd>
          </div>
        ))}
      </dl>
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
      <Button type="submit" form="nova-demanda" disabled={ocupado} className="w-full">
        Abrir demanda
      </Button>
      <Button asChild variant="ghost" className="w-full">
        <Link href={ROTA_HOJE}>Cancelar</Link>
      </Button>
    </aside>
  );
}

export function DemandaNovaView({
  agora,
  form,
  onForm,
  clientes,
  locais,
  busca,
  onBusca,
  resultados,
  onAdicionar,
  onAvulso,
  corrigindo,
  onCorrigir,
  problemas,
  ocupado,
  erro,
  onAbrir,
  solicitacao = null,
}: {
  agora: Date;
  form: FormularioDaDemanda;
  onForm: (form: FormularioDaDemanda) => void;
  clientes: readonly OpcaoDeFiltro[];
  /** Os locais do cliente escolhido. */
  locais: readonly OpcaoDeFiltro[];
  busca: string;
  onBusca: (busca: string) => void;
  resultados: readonly ItemDoCatalogo[];
  onAdicionar: (item: ItemDoCatalogo) => void;
  onAvulso: () => void;
  /** O seletor do tipo aberto ("Corrigir"). */
  corrigindo: boolean;
  onCorrigir: (corrigindo: boolean) => void;
  /** O que falta, mostrado depois da primeira tentativa de abrir. */
  problemas: readonly string[];
  ocupado: boolean;
  erro: string | null;
  onAbrir: () => void;
  /** A solicitação do portal que a demanda atende, ou null. */
  solicitacao?: PainelDaSolicitacao | null;
}) {
  const doPortal = Boolean(solicitacao && !solicitacao.resolvida);
  const { calculado, tipo } = tipoDoFormulario(form);
  const cliente = clientes.find((opcao) => opcao.valor === form.customerCode)?.rotulo ?? null;
  const set = <K extends keyof FormularioDaDemanda>(campo: K, valor: FormularioDaDemanda[K]) => onForm({ ...form, [campo]: valor });
  return (
    <section className="flex flex-col gap-6">
      <Link href={ROTA_HOJE} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Hoje
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Nova demanda</h1>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form
          id="nova-demanda"
          className="flex min-w-0 flex-col rounded-lg border border-border bg-card"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onAbrir();
          }}
        >
          <Secao titulo="Pedido">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id="demanda-cliente" rotulo="Cliente">
                <select
                  id="demanda-cliente"
                  className={campoClasse}
                  value={form.customerCode}
                  disabled={doPortal}
                  onChange={(event) => onForm({ ...form, customerCode: event.target.value, origemLocalId: "", destinoLocalId: "" })}
                >
                  <option value="">Escolha</option>
                  {clientes.map((opcao) => (
                    <option key={opcao.valor} value={opcao.valor}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="demanda-titulo" rotulo="Título">
                <Input id="demanda-titulo" value={form.titulo} onChange={(event) => set("titulo", event.target.value)} />
              </Campo>
              <Campo id="demanda-pedido-por" rotulo="Quem pediu">
                <Input id="demanda-pedido-por" value={form.pedidoPorNome} onChange={(event) => set("pedidoPorNome", event.target.value)} />
              </Campo>
              <Campo id="demanda-telefone" rotulo="Telefone">
                <Input id="demanda-telefone" type="tel" value={form.pedidoPorTelefone} onChange={(event) => set("pedidoPorTelefone", event.target.value)} />
              </Campo>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Canal</span>
              {doPortal ? (
                <span className="text-sm font-semibold text-foreground">{CANAL_ROTULO.portal}</span>
              ) : (
                <Segmented<CanalDaDireta>
                  aria-label="Canal"
                  className="self-start"
                  options={CANAIS_DA_DIRETA.map((canal) => ({ value: canal, label: CANAL_ROTULO[canal] }))}
                  value={form.canal}
                  onChange={(canal) => set("canal", canal)}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-[1fr_7rem_1fr_7rem]">
              <Campo id="demanda-recebida-data" rotulo="Recebida em">
                <Input id="demanda-recebida-data" type="date" value={form.recebidaData} disabled={doPortal} onChange={(event) => set("recebidaData", event.target.value)} />
              </Campo>
              <Campo id="demanda-recebida-hora" rotulo="Hora">
                <Input id="demanda-recebida-hora" type="time" value={form.recebidaHora} disabled={doPortal} onChange={(event) => set("recebidaHora", event.target.value)} />
              </Campo>
              <Campo id="demanda-executar-data" rotulo="Executar até">
                <Input id="demanda-executar-data" type="date" value={form.executarData} onChange={(event) => set("executarData", event.target.value)} />
              </Campo>
              <Campo id="demanda-executar-hora" rotulo="Hora limite">
                <Input id="demanda-executar-hora" type="time" value={form.executarHora} onChange={(event) => set("executarHora", event.target.value)} />
              </Campo>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">Tipo</span>
              {tipo ? <SeloDoTipo tipo={tipo} /> : <span className="text-sm text-muted-foreground">—</span>}
              {corrigindo ? (
                <label className="flex items-center gap-2">
                  <span className="sr-only">Tipo corrigido</span>
                  <select
                    className={cn(campoClasse, "h-9 w-auto")}
                    value={form.tipoCorrigido}
                    onChange={(event) => set("tipoCorrigido", event.target.value as TipoDaDemanda | "")}
                  >
                    <option value="">{calculado ? `Pela hora: ${TIPO_ROTULO[calculado]}` : "Pela hora"}</option>
                    {TIPOS_DA_DEMANDA.map((opcao) => (
                      <option key={opcao} value={opcao}>
                        {TIPO_ROTULO[opcao]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Button type="button" variant="link" className="h-auto p-0" onClick={() => onCorrigir(true)}>
                  Corrigir
                </Button>
              )}
            </div>
          </Secao>

          <Secao titulo="Locais">
            {(["origem", "destino"] as const).map((lado) => {
              const localId = lado === "origem" ? "origemLocalId" : "destinoLocalId";
              const complemento = lado === "origem" ? "origemComplemento" : "destinoComplemento";
              const rotulo = lado === "origem" ? "Origem" : "Destino";
              return (
                <div key={lado} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Campo id={`demanda-${lado}`} rotulo={rotulo}>
                    <select
                      id={`demanda-${lado}`}
                      className={campoClasse}
                      value={form[localId]}
                      disabled={!form.customerCode}
                      onChange={(event) => set(localId, event.target.value)}
                    >
                      <option value="">{form.customerCode ? "Sem local cadastrado" : "Escolha o cliente"}</option>
                      {locais.map((opcao) => (
                        <option key={opcao.valor} value={opcao.valor}>
                          {opcao.rotulo}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo id={`demanda-${lado}-complemento`} rotulo="Andar ou sala">
                    <Input id={`demanda-${lado}-complemento`} value={form[complemento]} onChange={(event) => set(complemento, event.target.value)} />
                  </Campo>
                </div>
              );
            })}
          </Secao>

          <Secao titulo="Itens">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block flex-1">
                <span className="sr-only">Buscar no catálogo</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" value={busca} placeholder="Buscar no catálogo" className="pl-9" onChange={(event) => onBusca(event.target.value)} />
              </label>
              <Button type="button" variant="outline" onClick={onAvulso}>
                <Plus aria-hidden="true" className="size-4" />
                Item avulso
              </Button>
            </div>
            {busca.trim() ? (
              resultados.length ? (
                <ul aria-label="Itens do catálogo" className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {resultados.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{item.item}</span>
                        <span className="text-xs text-muted-foreground">{[item.servico, item.unidade].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Button type="button" size="sm" variant="outline" aria-label={`Incluir ${item.item}`} onClick={() => onAdicionar(item)}>
                        Incluir
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum item do catálogo</p>
              )
            ) : null}
            {form.linhas.length ? (
              <ul className="flex flex-col gap-2">
                {form.linhas.map((linha) => (
                  <LinhaDoItem
                    key={linha.chave}
                    linha={linha}
                    onLinha={(nova) => set("linhas", form.linhas.map((atual) => (atual.chave === linha.chave ? nova : atual)))}
                    onRemover={() => set("linhas", form.linhas.filter((atual) => atual.chave !== linha.chave))}
                  />
                ))}
              </ul>
            ) : null}
          </Secao>
        </form>

        <div className="flex min-w-0 flex-col gap-6 self-start xl:sticky xl:top-6">
          {solicitacao ? <PainelDoPortal painel={solicitacao} /> : null}
          <Resumo form={form} cliente={cliente} agora={agora} ocupado={ocupado} erro={erro} problemas={problemas} />
        </div>
      </div>
    </section>
  );
}
