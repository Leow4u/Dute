/*
 * Portal › Eventos, o formulário da edição (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "As telas › Portal"; prancha docs/mockups/EventosPortalNovo.dc.html): o
 * evento, onde, o cronograma, o que vai do estoque Dutelog (o resumo, cinco
 * famílias e "Ver os N itens"), a coleta no cliente, as observações e o
 * resumo ao lado. A edição nasce no servidor quando o nome existe e a pessoa
 * sai dele (ou muda outro campo); a rota passa a edicao?id= sem entrada no
 * histórico, e cada mudança grava sozinha um segundo depois, pelo patch com
 * expected_edicao. "Enviar para a Dutelog" para no que falta, com a falta de
 * saldo dita antes. Nada aqui movimenta estoque.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { LIMITES, ROTULO_DO_MOMENTO } from "@workspace/dominio";
import { ChevronLeft, Package, Paperclip, Plus, Send, X } from "lucide-react";
import { Link, Redirect, useLocation, useSearch } from "wouter";

import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { ErroNaLeitura, FalhaAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { horaDaLeitura } from "@/lib/conexao";
import { documentosDoCliente, linhaDoDocumento, problemaDoAnexo } from "@/lib/eventos/anexos";
import { adicionarOutro, comIdsGravados, type LinhaDoCronograma } from "@/lib/eventos/cronograma";
import { enviarAnexoDoEvento } from "@/lib/eventos/enviar-anexo";
import {
  ATRASO_DO_AUTOSAVE_MS,
  campoDaMensagem,
  criacaoDoFormulario,
  formularioDaEdicao,
  formularioVazio,
  gravadoDaEdicao,
  patchDoFormulario,
  problemasDoFormulario,
  resumoDaEdicao,
  type CampoDoFormulario,
  type FormularioDaEdicao,
  type GravadoDaEdicao,
} from "@/lib/eventos/formulario";
import {
  ITENS_A_VISTA_NO_FORMULARIO,
  descricaoDaFamilia,
  faltasDeSaldo,
  familiasDaEdicao,
  fotoDoItem,
  itemDeEntrada,
  resumoComValor,
  textoDasFaltas,
  textoDoMostrando,
  type ProdutoDoEstoque,
} from "@/lib/eventos/itens";
import type { EventoView } from "@/lib/eventos/leitura";
import { ROTA_EVENTOS, eventoDaBusca, hrefDaEdicao, hrefDoEstoqueDoEvento, idDaEdicaoNaBusca } from "@/lib/eventos/navegacao";
import { CAMPOS_DO_MOMENTO, ROTULO_DO_OUTRO } from "@/lib/eventos/rotulos";
import type { ConteudoDaEdicao, CriarEdicao, DocumentoView, EdicaoView } from "@/lib/eventos/tipos";
import { useEdicaoDoEvento, useEventosDoCliente, usePrecosDoCliente } from "@/lib/eventos/use-eventos";
import { hojeIso } from "@/lib/operacao/fila";
import { novaChave } from "@/lib/operacao/api";
import { novaTentativaDe, type NovaTentativa } from "@/lib/operacao/leitura";
import { useOperationProfile } from "@/lib/operation-profile";
import { leiturasDoPortal } from "@/lib/operations";
import { cn } from "@/lib/utils";
import { enviarEdicao, salvarEdicao, tirarDocumento } from "@/lib/wms/eventos";

import { groupInventoryProducts } from "./estoque";
import { ItensDoEventoDialogo } from "./evento-itens-dialogo";
import { ClientDataBoundary, getInventoryItems } from "./shared";

const TITULO = "Novo evento";
const DESCRICAO = "O plano da edição. Salvar guarda o rascunho; Enviar para a Dutelog cria o pedido com os itens.";

// ----------------------------------------------------------------- a view

export type FormularioDaEdicaoViewProps = {
  form: FormularioDaEdicao;
  /** Os eventos ativos do cliente, para "Edição de". */
  eventos: EventoView[];
  /** A edição já nasceu: "Edição de" fica no evento dela, e os anexos e o Estoque abrem. */
  nascida: boolean;
  /** A edição está nascendo: "Edição de" trava já, para o rascunho não nascer num evento e mostrar outro. */
  nascendo?: boolean;
  produtos: ProdutoDoEstoque[];
  salvoAs: string | null;
  salvando: boolean;
  enviando: boolean;
  erros: Partial<Record<CampoDoFormulario, string>>;
  /** O layout e a planilha do cliente, do documento vivo; travados antes do nascimento. */
  anexos: { layout: AnexosNaTela; planilhas: AnexosNaTela };
  idDaEdicao: string | null;
  acoes: {
    mudar: <K extends keyof FormularioDaEdicao>(campo: K, valor: FormularioDaEdicao[K]) => void;
    sairDoNome: () => void;
    escolherEvento: (eventoId: string | null) => void;
    salvarAgora: () => void;
    enviar: () => void;
    verItens: () => void;
  };
};

/** Os anexos de uma seção: os documentos dela, a subida que anda e a recusa antes de subir. */
export type AnexosNaTela = {
  documentos: DocumentoView[];
  enviando: boolean;
  problema: string | null;
  onEscolher: (arquivo: File) => void;
  onTirar: (documento: DocumentoView) => void;
};

const ACEITA_O_LAYOUT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
const ACEITA_A_PLANILHA = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function AnexosDaSecao({ uso, titulo, botao, aceita, travado, anexos }: { uso: string; titulo: string; botao: string; aceita: string; travado: boolean; anexos: AnexosNaTela }) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium leading-none">{titulo}</span>
      <div className="flex flex-wrap items-center gap-2">
        {anexos.documentos.map((documento) => (
          <span key={documento.id} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted pl-3 pr-1 text-sm font-semibold">
            <Paperclip aria-hidden="true" className="size-4 shrink-0" />
            {linhaDoDocumento(documento)}
            <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={`Tirar ${documento.nome}`} onClick={() => anexos.onTirar(documento)}>
              <X aria-hidden="true" />
            </Button>
          </span>
        ))}
        <BotaoDeAcao
          type="button"
          variant="outline"
          size="sm"
          estado={anexos.enviando ? "andamento" : "repouso"}
          icone={<Paperclip aria-hidden="true" />}
          rotulo={botao}
          andamento="Enviando…"
          bloqueado={travado}
          onClick={() => entrada.current?.click()}
        />
        <input
          ref={entrada}
          type="file"
          hidden
          data-anexo={uso}
          accept={aceita}
          disabled={travado}
          onChange={(evento) => {
            const arquivo = evento.target.files?.[0];
            evento.target.value = "";
            if (arquivo) anexos.onEscolher(arquivo);
          }}
        />
      </div>
      {anexos.problema ? <p className="text-xs font-semibold text-destructive-soft-foreground">{anexos.problema}</p> : null}
    </div>
  );
}

function Campo({ id, rotulo, obrigatorio = false, problema, className, children }: { id: string; rotulo: string; obrigatorio?: boolean; problema?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {rotulo}
        {obrigatorio ? (
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {problema ? (
        <p id={`${id}-problema`} className="text-xs font-semibold text-destructive-soft-foreground">
          {problema}
        </p>
      ) : null}
    </div>
  );
}

function Secao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  const id = `secao-${titulo.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={id} className="text-base font-bold tracking-tight">
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function ProblemaDaSecao({ id, texto }: { id: string; texto?: string }) {
  if (!texto) return null;
  return (
    <p id={id} className="text-sm font-semibold text-destructive-soft-foreground">
      {texto}
    </p>
  );
}

const invalido = (problema: string | undefined, id: string) => (problema ? { "aria-invalid": true, "aria-describedby": `${id}-problema` } : {});

function LinhaDoMomento({ linha, onMudar }: { linha: LinhaDoCronograma; onMudar: (linha: LinhaDoCronograma) => void }) {
  const campos = CAMPOS_DO_MOMENTO[linha.tipo];
  const mudar = (campo: keyof LinhaDoCronograma) => (evento: { target: { value: string } }) => onMudar({ ...linha, [campo]: evento.target.value });
  return (
    <div className="grid grid-cols-2 items-center gap-2.5 md:grid-cols-[minmax(0,12rem)_9rem_6rem_6rem_minmax(0,1fr)]">
      {linha.tipo === "outro" ? (
        <Input aria-label={ROTULO_DO_OUTRO} value={linha.rotulo} maxLength={LIMITES.rotulo} onChange={mudar("rotulo")} className="col-span-2 md:col-span-1" />
      ) : (
        <span className="col-span-2 text-sm font-semibold md:col-span-1">{ROTULO_DO_MOMENTO[linha.tipo]}</span>
      )}
      <Input type="date" aria-label={campos.data} value={linha.data} onChange={mudar("data")} />
      <Input type="time" aria-label={campos.hora} value={linha.hora} onChange={mudar("hora")} />
      {campos.ate ? (
        <Input type="time" aria-label={campos.ate} value={linha.ate} onChange={mudar("ate")} />
      ) : (
        <span aria-hidden="true" className="text-center text-muted-foreground">
          —
        </span>
      )}
      <Input aria-label={campos.observacao} value={linha.observacao} maxLength={LIMITES.observacaoDoMomento} onChange={mudar("observacao")} />
    </div>
  );
}

function Familias({ form, produtos, onVerItens }: { form: FormularioDaEdicao; produtos: ProdutoDoEstoque[]; onVerItens: () => void }) {
  const familias = familiasDaEdicao(form.itens);
  const vistas = familias.slice(0, ITENS_A_VISTA_NO_FORMULARIO);
  const mostrando = vistas.reduce((soma, familia) => soma + familia.tamanhos.length, 0);
  return (
    <>
      <ul className="flex flex-col divide-y divide-border/60">
        {vistas.map((familia) => {
          const foto = fotoDoItem(familia.tamanhos[0].item, produtos);
          return (
            <li key={familia.chave} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 md:grid-cols-[2.75rem_minmax(0,1.2fr)_minmax(0,1.6fr)_4rem]">
              <span className="flex size-11 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
                {foto ? <img src={foto} alt="" loading="lazy" className="size-full object-cover" /> : <Package aria-hidden="true" className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{familia.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">{descricaoDaFamilia(familia)}</span>
              </span>
              <span className="col-span-3 flex flex-wrap gap-1.5 md:col-span-1">
                {familia.tamanhos.map(({ item, tamanho }) => (
                  <span key={item.sku_code} className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-muted px-2 text-xs font-semibold text-muted-foreground">
                    {tamanho ?? "Único"} <b className="font-bold text-foreground">{item.quantity.toLocaleString("pt-BR")}</b>
                  </span>
                ))}
              </span>
              <span className="text-right font-bold tabular-nums">{familia.pecas.toLocaleString("pt-BR")}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border/60 pt-2 text-sm">
        <span className="text-muted-foreground">{textoDoMostrando(mostrando, form.itens.length)}</span>
        <Button type="button" variant="link" onClick={onVerItens}>
          Ver os {form.itens.length.toLocaleString("pt-BR")} itens
        </Button>
      </div>
    </>
  );
}

function LinhaDoResumo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex justify-between gap-2.5">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right font-bold">{valor ?? "—"}</dd>
    </div>
  );
}

/** O formulário, só a apresentação: o estado e as ações chegam por props (useRascunhoDaEdicao). */
export function FormularioDaEdicaoView(props: FormularioDaEdicaoViewProps) {
  const { form, eventos, nascida, nascendo = false, produtos, salvoAs, salvando, enviando, erros, acoes, idDaEdicao } = props;
  const resumo = resumoDaEdicao(form, produtos, hojeIso());
  const falta = form.itens.length ? textoDasFaltas(faltasDeSaldo(form.itens, produtos)) : null;
  const onde = <K extends keyof FormularioDaEdicao["onde"]>(campo: K, valor: string) => acoes.mudar("onde", { ...form.onde, [campo]: valor });
  const coleta = <K extends keyof FormularioDaEdicao["coleta"]>(campo: K, valor: string) => acoes.mudar("coleta", { ...form.coleta, [campo]: valor });
  const mudarLinha = (indice: number) => (linha: LinhaDoCronograma) => acoes.mudar("cronograma", form.cronograma.map((atual, posicao) => (posicao === indice ? linha : atual)));
  const outros = form.cronograma.filter((linha) => linha.tipo === "outro").length;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <header className="flex items-start gap-3.5 border-b border-border/60 pb-5">
        <Button asChild variant="outline" size="icon" className="shrink-0">
          <Link href={ROTA_EVENTOS} aria-label="Voltar a Eventos">
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{TITULO}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{DESCRICAO}</p>
        </div>
        {salvoAs ? <span className="shrink-0 pt-1 text-sm font-semibold text-muted-foreground">Salvo {salvoAs}</span> : null}
      </header>

      <form
        aria-label={TITULO}
        noValidate
        className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]"
        // O Enter num campo não envia: "Enviar para a Dutelog" é o botão.
        onSubmit={(evento) => evento.preventDefault()}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Secao titulo="O evento">
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Campo id="evento-nome" rotulo="Nome do evento" obrigatorio problema={erros.nome}>
                <Input
                  id="evento-nome"
                  value={form.nome}
                  maxLength={LIMITES.nome}
                  onChange={(evento) => acoes.mudar("nome", evento.target.value)}
                  onBlur={acoes.sairDoNome}
                  {...invalido(erros.nome, "evento-nome")}
                />
              </Campo>
              <Campo id="evento-edicao-de" rotulo="Edição de">
                <select
                  id="evento-edicao-de"
                  value={form.eventoId ?? ""}
                  disabled={nascida || nascendo}
                  onChange={(evento) => acoes.escolherEvento(evento.target.value || null)}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground disabled:opacity-70"
                >
                  <option value="">Evento novo</option>
                  {eventos.map((evento) => (
                    <option key={evento.id} value={evento.id}>
                      {evento.name}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo id="evento-descricao" rotulo="Descrição">
              <Input id="evento-descricao" value={form.descricao} maxLength={LIMITES.descricao} onChange={(evento) => acoes.mudar("descricao", evento.target.value)} />
            </Campo>
          </Secao>

          <Secao titulo="Onde">
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
              <Campo id="evento-local" rotulo="Local" obrigatorio problema={erros["onde.local"]}>
                <Input id="evento-local" value={form.onde.local} maxLength={LIMITES.local} onChange={(evento) => onde("local", evento.target.value)} {...invalido(erros["onde.local"], "evento-local")} />
              </Campo>
              <Campo id="evento-endereco" rotulo="Endereço">
                <Input id="evento-endereco" value={form.onde.endereco} maxLength={LIMITES.endereco} onChange={(evento) => onde("endereco", evento.target.value)} />
              </Campo>
            </div>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <Campo id="evento-contato" rotulo="Contato no local">
                <Input id="evento-contato" value={form.onde.contatoNome} maxLength={LIMITES.contatoNome} onChange={(evento) => onde("contatoNome", evento.target.value)} />
              </Campo>
              <Campo id="evento-telefone" rotulo="Telefone do contato">
                <Input id="evento-telefone" type="tel" value={form.onde.contatoTelefone} maxLength={LIMITES.contatoTelefone} onChange={(evento) => onde("contatoTelefone", evento.target.value)} />
              </Campo>
            </div>
            <AnexosDaSecao uso="layout" titulo="Layout do evento" botao="Anexar layout" aceita={ACEITA_O_LAYOUT} travado={!nascida} anexos={props.anexos.layout} />
          </Secao>

          <Secao titulo="Cronograma">
            <div className="flex flex-col gap-2.5" {...(erros.cronograma ? { "aria-describedby": "evento-cronograma-problema" } : {})}>
              <div aria-hidden="true" className="hidden border-b border-border/60 pb-1 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,12rem)_9rem_6rem_6rem_minmax(0,1fr)] md:gap-2.5">
                <span>Momento</span>
                <span>Data</span>
                <span>Hora</span>
                <span>Até</span>
                <span>Observação</span>
              </div>
              {form.cronograma.map((linha, indice) => (
                <LinhaDoMomento key={linha.id ?? `${linha.tipo}-${indice}`} linha={linha} onMudar={mudarLinha(indice)} />
              ))}
            </div>
            <ProblemaDaSecao id="evento-cronograma-problema" texto={erros.cronograma} />
            {outros < LIMITES.outros ? (
              <div>
                <Button type="button" variant="ghost" onClick={() => acoes.mudar("cronograma", adicionarOutro(form.cronograma))}>
                  <Plus aria-hidden="true" />
                  {ROTULO_DO_MOMENTO.outro}
                </Button>
              </div>
            ) : null}
          </Secao>

          <Secao
            titulo="O que vai · do estoque Dutelog"
            acao={
              <span className="flex flex-wrap gap-2">
                {form.itens.length ? (
                  <Button type="button" variant="outline" size="sm" onClick={acoes.verItens}>
                    Ver os {form.itens.length.toLocaleString("pt-BR")} itens
                  </Button>
                ) : null}
                {idDaEdicao ? (
                  <Button asChild size="sm">
                    <Link href={hrefDoEstoqueDoEvento(idDaEdicao)}>
                      <Plus aria-hidden="true" />
                      Escolher no Estoque
                    </Link>
                  </Button>
                ) : (
                  <Button type="button" size="sm" disabled>
                    <Plus aria-hidden="true" />
                    Escolher no Estoque
                  </Button>
                )}
              </span>
            }
          >
            {form.itens.length ? <p className="-mt-2 text-sm text-muted-foreground">{resumoComValor(form.itens, produtos)}</p> : null}
            {falta && falta !== erros.itens ? <p className="text-sm font-semibold text-warning-soft-foreground">{falta}</p> : null}
            <ProblemaDaSecao id="evento-itens-problema" texto={erros.itens} />
            {form.itens.length ? <Familias form={form} produtos={produtos} onVerItens={acoes.verItens} /> : null}
          </Secao>

          <Secao titulo="O que vai · coleta no cliente">
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]">
              <Campo id="coleta-onde" rotulo="Onde buscar">
                <Input id="coleta-onde" value={form.coleta.onde} maxLength={LIMITES.coletaOnde} onChange={(evento) => coleta("onde", evento.target.value)} />
              </Campo>
              <Campo id="coleta-quantidade" rotulo="Quantidade">
                <Input id="coleta-quantidade" inputMode="numeric" value={form.coleta.quantidade} onChange={(evento) => coleta("quantidade", evento.target.value)} {...invalido(erros.coleta, "coleta")} />
              </Campo>
              <Campo id="coleta-valor" rotulo="Valor declarado">
                <Input id="coleta-valor" inputMode="decimal" value={form.coleta.valorDeclarado} onChange={(evento) => coleta("valorDeclarado", evento.target.value)} {...invalido(erros.coleta, "coleta")} />
              </Campo>
            </div>
            <ProblemaDaSecao id="coleta-problema" texto={erros.coleta} />
            <AnexosDaSecao uso="planilha" titulo="Planilha dos produtos" botao="Anexar planilha" aceita={ACEITA_A_PLANILHA} travado={!nascida} anexos={props.anexos.planilhas} />
          </Secao>

          <Secao titulo="Observações para a Dutelog">
            <Campo id="evento-observacoes" rotulo="O que mais a Dutelog precisa saber" problema={erros.observacoes}>
              <Textarea
                id="evento-observacoes"
                rows={5}
                value={form.observacoes}
                maxLength={LIMITES.observacoes}
                onChange={(evento) => acoes.mudar("observacoes", evento.target.value)}
                {...invalido(erros.observacoes, "evento-observacoes")}
              />
            </Campo>
          </Secao>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pb-2 pt-1">
            <Button asChild variant="ghost" size="lg">
              <Link href={ROTA_EVENTOS}>Cancelar</Link>
            </Button>
            <BotaoDeAcao
              type="button"
              variant="outline"
              size="lg"
              estado={salvando ? "andamento" : "repouso"}
              rotulo="Salvar rascunho"
              andamento="Salvando…"
              sucesso="Salvo"
              onClick={acoes.salvarAgora}
            />
            <BotaoDeAcao
              type="button"
              size="lg"
              estado={enviando ? "andamento" : "repouso"}
              icone={<Send aria-hidden="true" />}
              rotulo="Enviar para a Dutelog"
              andamento="Enviando…"
              bloqueado={!nascida}
              onClick={acoes.enviar}
            />
          </div>
        </div>

        <aside aria-labelledby="resumo-da-edicao" className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-5 py-4 xl:sticky xl:top-5">
          <h2 id="resumo-da-edicao" className="text-base font-bold tracking-tight">
            Resumo da edição
          </h2>
          <dl className="flex flex-col gap-2.5 text-sm">
            <LinhaDoResumo rotulo="Evento" valor={resumo.nome || null} />
            <LinhaDoResumo rotulo="Edição" valor={resumo.dias} />
            <LinhaDoResumo rotulo="Local" valor={resumo.local} />
            <LinhaDoResumo rotulo="Do estoque Dutelog" valor={resumo.estoque} />
            <LinhaDoResumo rotulo="Coleta no cliente" valor={resumo.coleta} />
            <LinhaDoResumo rotulo="Entrega no local" valor={resumo.entrega} />
            <LinhaDoResumo rotulo="Retorno ao estoque" valor={resumo.retorno} />
          </dl>
          <dl className="flex flex-col gap-1.5 border-t border-border/60 pt-3 text-sm">
            <LinhaDoResumo rotulo="Ao enviar" valor={resumo.pedido} />
            <LinhaDoResumo rotulo="A Dutelog responde com" valor="Preço fechado" />
          </dl>
        </aside>
      </form>
    </div>
  );
}

// --------------------------------------------------- o rascunho e a gravação

/** O que a aba que fez nascer a edição entrega à tela da rota nova (a troca de rota remonta a tela). */
type Entrega = { form: FormularioDaEdicao; gravado: GravadoDaEdicao; versao: number; edicao: EdicaoView; sujo: boolean; salvoAs: string | null };
const ENTREGAS = new Map<string, Entrega>();

/** O gravado da criação: o que foi; na criação repetida (a resposta perdida), o servidor pode ter outro, e o patch seguinte leva tudo. */
function gravadoDaCriacao(entrada: CriarEdicao, edicao: EdicaoView, criada: boolean, capa: { nome: string; descricao: string | null } | null): GravadoDaEdicao {
  const itens = edicao.itens.map(itemDeEntrada);
  if (!criada) return { nome: "", descricao: "\u0000", valorDeclaradoCents: Number.NaN, itens };
  const evento = entrada.patch?.evento;
  return {
    nome: evento?.name ?? capa?.nome ?? entrada.name ?? edicao.event_name,
    descricao: evento && "description" in evento ? (evento.description ?? null) : capa ? capa.descricao : (entrada.description ?? null),
    valorDeclaradoCents: entrada.patch?.coleta?.valor_declarado_cents ?? null,
    itens,
  };
}

/** O gravado depois de um patch que valeu: o que ele levou passa a ser o gravado. */
function gravadoDepois(gravado: GravadoDaEdicao, patch: ConteudoDaEdicao): GravadoDaEdicao {
  return {
    nome: patch.evento?.name ?? gravado.nome,
    descricao: patch.evento && "description" in patch.evento ? (patch.evento.description ?? null) : gravado.descricao,
    valorDeclaradoCents: patch.coleta && "valor_declarado_cents" in patch.coleta ? (patch.coleta.valor_declarado_cents ?? null) : gravado.valorDeclaradoCents,
    itens: patch.itens ? patch.itens.map(itemDeEntrada) : gravado.itens,
  };
}

type ErroComCodigo = Error & { code?: string };

const CAMPO_DO_FORMULARIO: Partial<Record<keyof FormularioDaEdicao, CampoDoFormulario>> = {
  nome: "nome",
  descricao: "nome",
  onde: "onde.local",
  cronograma: "cronograma",
  itens: "itens",
  coleta: "coleta",
  observacoes: "observacoes",
};

type Controle = {
  id: string | null;
  form: FormularioDaEdicao;
  /** O formulário veio do servidor (o documento vivo ou a entrega): só então grava. */
  adotado: boolean;
  /** Depois de "A edição mudou em outra aba": espera o documento vivo mais novo que `versao`. */
  esperaVersaoMaiorQue: number | null;
  edicao: EdicaoView | null;
  versao: number | null;
  gravado: GravadoDaEdicao | null;
  sujo: boolean;
  salvoAs: string | null;
  errosDoServidor: Partial<Record<CampoDoFormulario, string>>;
  tentouEnviar: boolean;
  salvando: boolean;
  enviando: boolean;
  nascendo: boolean;
  pendente: boolean;
  gravacao: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  capa: { id: string; nome: string; descricao: string | null } | null;
  /** O evento da última criação tentada: outro evento depois de uma falha pede outra chave. */
  capaDaCriacao: string | null | undefined;
  chaveDaCriacao: string;
  chavesDoEnvio: Map<number, string>;
  navegou: boolean;
  preencheuDaBusca: boolean;
};

export type RascunhoDaEdicao = {
  form: FormularioDaEdicao;
  mudar: <K extends keyof FormularioDaEdicao>(campo: K, valor: FormularioDaEdicao[K]) => void;
  sairDoNome: () => void;
  escolherEvento: (eventoId: string | null) => void;
  edicao: EdicaoView | null;
  /** O documento vivo, com os anexos de agora. */
  viva: EdicaoView | null | undefined;
  eventos: EventoView[];
  salvoAs: string | null;
  salvando: boolean;
  erros: Partial<Record<CampoDoFormulario, string>>;
  salvarAgora: () => void;
  enviar: () => void;
  enviando: boolean;
  /** O formulário ainda espera o servidor para abrir (a primeira leitura da edição). */
  lendo: boolean;
  /** A edição está nascendo. */
  nascendo: boolean;
  /** As leituras ao vivo: a falha sem nada lido, com a nova tentativa. */
  leitura: NovaTentativa;
};

/**
 * O rascunho da edição na tela: o nascimento, o salvamento automático (uma
 * gravação por vez, a seguinte com o formulário mais novo), a recusa no
 * campo, o conflito com outra aba e o envio. O estado mora num controle
 * mutável (as respostas chegam depois de várias mudanças), e cada mudança
 * redesenha a tela.
 */
export function useRascunhoDaEdicao({
  id,
  eventoId,
  customerCode,
  ligado,
  produtos,
}: {
  id: string | null;
  eventoId: string | null;
  customerCode: string | null | undefined;
  ligado: boolean;
  produtos: ProdutoDoEstoque[];
}): RascunhoDaEdicao {
  const viva = useEdicaoDoEvento(id);
  const eventos = useEventosDoCliente(customerCode, ligado);
  const precos = usePrecosDoCliente(customerCode, ligado && Boolean(id));
  const [, navegar] = useLocation();
  const { toast } = useToast();
  const [, redesenhar] = useReducer((vez: number) => vez + 1, 0);
  const controle = useRef<Controle | null>(null);
  if (!controle.current) {
    // A entrega fica no mapa até a tela montar: a renderização que o React descarta antes de
    // montar (a concorrente que outra atualização interrompe e recomeça, um irmão que suspende)
    // também a lê, e quem monta a tira.
    const entrega = id ? ENTREGAS.get(id) : undefined;
    controle.current = {
      id,
      form: entrega?.form ?? formularioVazio(),
      adotado: !id || Boolean(entrega),
      esperaVersaoMaiorQue: null,
      edicao: entrega?.edicao ?? null,
      versao: entrega?.versao ?? null,
      gravado: entrega?.gravado ?? null,
      sujo: entrega?.sujo ?? false,
      salvoAs: entrega?.salvoAs ?? null,
      errosDoServidor: {},
      tentouEnviar: false,
      salvando: false,
      enviando: false,
      nascendo: false,
      pendente: false,
      gravacao: null,
      timer: null,
      capa: null,
      capaDaCriacao: undefined,
      chaveDaCriacao: novaChave(),
      chavesDoEnvio: new Map(),
      navegou: false,
      preencheuDaBusca: false,
    };
  }
  const c = controle.current;
  useEffect(() => {
    if (id) ENTREGAS.delete(id);
  }, [id]);
  const produtosRef = useRef(produtos);
  produtosRef.current = produtos;
  const montado = useRef(true);

  function agendar(atraso = ATRASO_DO_AUTOSAVE_MS) {
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      c.timer = null;
      void gravar();
    }, atraso);
  }

  function tratarRecusa(erro: unknown, aoFalhar: string) {
    const mensagem = erro instanceof Error ? erro.message : "";
    const codigo = (erro as ErroComCodigo | null)?.code;
    if (codigo === "failed-precondition" && /mudou em outra aba/.test(mensagem)) {
      toast({ title: mensagem, variant: "destructive" });
      // O formulário volta ao documento vivo, mais novo que o desta aba: o texto daqui não volta ao servidor.
      c.adotado = false;
      c.sujo = false;
      c.esperaVersaoMaiorQue = c.versao;
      return;
    }
    if (codigo === "failed-precondition" && /já tem registro e não sai do cronograma/.test(mensagem)) {
      c.errosDoServidor = { ...c.errosDoServidor, cronograma: mensagem };
      // A linha que ficou sem data e tem registro volta do documento vivo; as outras ficam como a pessoa deixou.
      const vivo = viva.edicao ?? c.edicao;
      const registrados = new Set(
        [...(vivo?.documentos ?? []), ...(vivo?.fotos ?? [])].map((arquivo) => arquivo.momento_id).filter((momento): momento is string => Boolean(momento)),
      );
      c.form = {
        ...c.form,
        cronograma: c.form.cronograma.map((linha) => {
          const gravado = vivo?.cronograma.find((momento) => momento.id === linha.id);
          if (!gravado || linha.data || !(gravado.feito || registrados.has(gravado.id))) return linha;
          return { ...linha, data: gravado.previsto.data, hora: gravado.previsto.hora ?? "", ate: gravado.previsto.ate ?? "" };
        }),
      };
      return;
    }
    const campo = codigo === "invalid-argument" || codigo === "failed-precondition" ? campoDaMensagem(mensagem) : null;
    if (campo) {
      c.errosDoServidor = { ...c.errosDoServidor, [campo]: mensagem };
      return;
    }
    toast({ title: aoFalhar, description: mensagem || undefined, variant: "destructive" });
  }

  async function nascer() {
    if (c.nascendo || c.navegou) return;
    c.nascendo = true;
    redesenhar();
    const formEnviado = c.form;
    // A capa desta tentativa: a de depois da resposta pode ser outra.
    const capa = c.capa;
    // Outro evento depois de uma criação sem resposta é outra criação: a mesma chave devolveria a do evento de antes.
    if (c.capaDaCriacao !== undefined && c.capaDaCriacao !== (capa?.id ?? null)) c.chaveDaCriacao = novaChave();
    c.capaDaCriacao = capa?.id ?? null;
    const entrada = criacaoDoFormulario(formEnviado, c.chaveDaCriacao, capa);
    try {
      const resposta = await salvarEdicao(entrada);
      const entrega: Entrega = {
        // O evento da edição nascida (o novo ganha o id na criação), e os ids que o servidor deu aos momentos.
        form: {
          ...c.form,
          eventoId: resposta.edition.event_id || c.form.eventoId,
          cronograma: comIdsGravados(c.form.cronograma, formEnviado.cronograma, resposta.edition.cronograma),
        },
        gravado: gravadoDaCriacao(entrada, resposta.edition, resposta.created, capa),
        versao: resposta.edicao,
        edicao: resposta.edition,
        sujo: c.form !== formEnviado || !resposta.created,
        salvoAs: horaDaLeitura(Date.now()),
      };
      // A pessoa saiu da tela durante a criação ("Cancelar", outra rota): o rascunho fica e a tela não a
      // puxa de volta, mas o que ela digitou depois do nome grava daqui, pelo patch, como na rota nova.
      if (!montado.current) {
        if (entrega.sujo) {
          Object.assign(c, { id: resposta.id, form: entrega.form, gravado: entrega.gravado, versao: entrega.versao, edicao: entrega.edicao, sujo: true, nascendo: false, pendente: false });
          void gravar();
        }
        return;
      }
      ENTREGAS.set(resposta.id, entrega);
      c.navegou = true;
      navegar(hrefDaEdicao(resposta.id), { replace: true });
    } catch (erro) {
      c.nascendo = false;
      if (!montado.current) return;
      tratarRecusa(erro, "Rascunho não salvo");
      redesenhar();
    }
  }

  function gravar(): Promise<void> {
    if (c.timer) {
      clearTimeout(c.timer);
      c.timer = null;
    }
    if (!c.adotado) return Promise.resolve();
    if (c.salvando || c.nascendo) {
      c.pendente = true;
      return c.gravacao ?? Promise.resolve();
    }
    if (!c.id) return c.form.nome.trim() ? nascer() : Promise.resolve();
    if (!c.sujo || c.versao === null || !c.gravado) return Promise.resolve();
    const id = c.id;
    const formEnviado = c.form;
    const patch = patchDoFormulario(formEnviado, c.gravado);
    c.salvando = true;
    c.sujo = false;
    redesenhar();
    const gravacao = (async () => {
      try {
        const resposta = await salvarEdicao({ id, expected_edicao: c.versao!, patch });
        c.versao = resposta.edicao;
        c.edicao = resposta.edition;
        c.gravado = gravadoDepois(c.gravado!, patch);
        // Os ids que o servidor deu aos momentos novos: a próxima gravação funde por eles.
        if (patch.cronograma) c.form = { ...c.form, cronograma: comIdsGravados(c.form.cronograma, formEnviado.cronograma, resposta.edition.cronograma) };
        c.salvoAs = horaDaLeitura(Date.now());
        c.errosDoServidor = {};
      } catch (erro) {
        if (c.adotado) c.sujo = true;
        tratarRecusa(erro, "Rascunho não salvo");
        if (!c.adotado) c.pendente = false;
      } finally {
        c.salvando = false;
        c.gravacao = null;
        redesenhar();
        if (c.pendente) {
          c.pendente = false;
          void gravar();
        }
      }
    })();
    c.gravacao = gravacao;
    return gravacao;
  }

  function mudar<K extends keyof FormularioDaEdicao>(campo: K, valor: FormularioDaEdicao[K]) {
    c.form = { ...c.form, [campo]: valor };
    const doCampo = CAMPO_DO_FORMULARIO[campo];
    if (doCampo && c.errosDoServidor[doCampo]) {
      const { [doCampo]: _tirado, ...resto } = c.errosDoServidor;
      c.errosDoServidor = resto;
    }
    redesenhar();
    if (!c.adotado) return;
    if (c.id) {
      c.sujo = true;
      agendar();
    } else if (campo !== "nome" && c.form.nome.trim()) {
      // Antes do nascimento, a mudança fora do nome faz a edição nascer, com o mesmo atraso.
      agendar();
    }
  }

  /** "Edição de": o nome e a descrição vêm do evento escolhido; a escolha da pessoa faz a edição nascer, a da busca (?evento=) não. */
  function escolherEvento(eventoId: string | null, pelaPessoa = true) {
    if (c.nascendo || c.id) return;
    const capa = eventoId ? (eventos.itens ?? []).find((evento) => evento.id === eventoId) : null;
    c.capa = capa ? { id: capa.id, nome: capa.name, descricao: capa.description } : null;
    c.form = { ...c.form, eventoId: capa?.id ?? null, ...(capa ? { nome: capa.name, descricao: capa.description ?? "" } : {}) };
    redesenhar();
    if (pelaPessoa && c.form.nome.trim()) agendar();
  }

  // A primeira leitura (e a de depois do conflito): o documento vivo, a capa e o preço.
  useEffect(() => {
    if (!c.id || c.adotado) return;
    const edicao = viva.edicao;
    if (!edicao || eventos.itens === null || precos.itens === null) return;
    if (c.esperaVersaoMaiorQue !== null && edicao.edicao <= c.esperaVersaoMaiorQue) return;
    const capa = eventos.itens.find((evento) => evento.id === edicao.event_id) ?? null;
    const preco = precos.itens.find((item) => item.id === edicao.id) ?? null;
    c.form = formularioDaEdicao(edicao, capa, preco);
    c.gravado = gravadoDaEdicao(edicao, capa, preco);
    c.versao = edicao.edicao;
    c.edicao = edicao;
    c.adotado = true;
    c.sujo = false;
    c.esperaVersaoMaiorQue = null;
    redesenhar();
  });

  // O ?evento= de "Nova edição a partir de": a capa escolhida, quando os eventos chegam.
  useEffect(() => {
    if (c.id || c.preencheuDaBusca || !eventoId || eventos.itens === null) return;
    c.preencheuDaBusca = true;
    if (eventos.itens.some((evento) => evento.id === eventoId)) escolherEvento(eventoId, false);
  });

  // A entrega trouxe mudança que esperava a rota nova: grava logo.
  useEffect(() => {
    montado.current = true;
    if (c.id && c.adotado && c.sujo && !c.salvando && !c.timer) agendar(0);
    return () => {
      montado.current = false;
      // Saindo da tela com mudança por gravar ("Cancelar" logo depois de digitar), grava agora.
      if (c.timer) {
        clearTimeout(c.timer);
        c.timer = null;
        void gravar();
      }
    };
    // Só na montagem e na saída.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar() {
    c.tentouEnviar = true;
    const problemas = problemasDoFormulario(c.form, produtosRef.current);
    if (Object.keys(problemas).length || !c.id) {
      redesenhar();
      return;
    }
    while (c.gravacao) await c.gravacao;
    if (c.sujo) await gravar();
    if (c.sujo || !c.adotado || c.versao === null) return;
    const versao = c.versao;
    const chave = c.chavesDoEnvio.get(versao) ?? novaChave();
    c.chavesDoEnvio.set(versao, chave);
    c.enviando = true;
    redesenhar();
    try {
      await enviarEdicao({ id: c.id, expected_edicao: versao, idempotency_key: chave });
      toast({ title: "Edição enviada à Dutelog" });
      navegar(ROTA_EVENTOS);
    } catch (erro) {
      c.enviando = false;
      tratarRecusa(erro, "Não foi possível enviar");
      redesenhar();
    }
  }

  const erros = { ...(c.tentouEnviar ? problemasDoFormulario(c.form, produtos) : {}), ...c.errosDoServidor };
  const doDocumento = { item: viva.edicao, erro: viva.erro, tentando: viva.tentando, tentar: viva.tentar, falta: viva.falta, lidaEm: viva.lidaEm };
  const leitura = novaTentativaDe(c.id ? [doDocumento, eventos, precos] : [eventos]);
  return {
    form: c.form,
    mudar,
    sairDoNome: () => {
      if (!c.id && c.form.nome.trim()) void gravar();
    },
    escolherEvento: (eventoId) => escolherEvento(eventoId),
    edicao: c.edicao,
    viva: viva.edicao,
    eventos: eventos.itens ?? [],
    salvoAs: c.salvoAs,
    salvando: c.salvando || c.nascendo,
    erros,
    salvarAgora: () => void gravar(),
    enviar: () => void enviar(),
    enviando: c.enviando,
    lendo: !c.adotado && c.esperaVersaoMaiorQue === null,
    nascendo: c.nascendo,
    leitura,
  };
}

// ------------------------------------------------------------------ as rotas

function produtosDoPortal(overview: Parameters<typeof getInventoryItems>[0]): ProdutoDoEstoque[] {
  return groupInventoryProducts(getInventoryItems(overview));
}

function FormularioComProdutos({ id, eventoId, produtos }: { id: string | null; eventoId: string | null; produtos: ProdutoDoEstoque[] }) {
  const { user } = useAppUser();
  const { profile } = useOperationProfile();
  const leituras = profile ? leiturasDoPortal(profile.modules) : null;
  const rascunho = useRascunhoDaEdicao({ id, eventoId, customerCode: user?.publicMetadata.customer_code, ligado: Boolean(leituras?.eventos), produtos });
  const [vendoItens, setVendoItens] = useState(false);
  const [, navegar] = useLocation();
  const { toast } = useToast();
  const codigo = user?.publicMetadata.customer_code ?? null;
  type Subida = { enviando: boolean; problema: string | null };
  const [subidas, setSubidas] = useState<Record<"layout" | "planilhas", Subida>>({ layout: { enviando: false, problema: null }, planilhas: { enviando: false, problema: null } });
  const comDocumentos = rascunho.viva ?? rascunho.edicao;
  const documentos = documentosDoCliente(comDocumentos);
  const mudarSubida = (uso: "layout" | "planilhas", subida: Subida) => setSubidas((atual) => ({ ...atual, [uso]: subida }));
  function escolher(uso: "layout" | "planilhas", arquivo: File) {
    const problema = problemaDoAnexo(arquivo, comDocumentos?.documentos.length ?? 0);
    if (problema || !id || !codigo) {
      mudarSubida(uso, { enviando: false, problema });
      return;
    }
    mudarSubida(uso, { enviando: true, problema: null });
    // O documento aparece pelo documento vivo; aqui só a subida e a recusa.
    enviarAnexoDoEvento(codigo, id, arquivo)
      .then(() => mudarSubida(uso, { enviando: false, problema: null }))
      .catch((erro: unknown) => mudarSubida(uso, { enviando: false, problema: `${arquivo.name}: ${erro instanceof Error ? erro.message : "não subiu"}` }));
  }
  function tirar(documento: DocumentoView) {
    if (!id) return;
    tirarDocumento({ edition_id: id, documento_id: documento.id, idempotency_key: novaChave() }).catch((erro: unknown) =>
      toast({ title: "Não foi possível tirar o documento", description: erro instanceof Error ? erro.message : undefined, variant: "destructive" }),
    );
  }
  const anexos = {
    layout: { documentos: documentos.layout, ...subidas.layout, onEscolher: (arquivo: File) => escolher("layout", arquivo), onTirar: tirar },
    planilhas: { documentos: documentos.planilhas, ...subidas.planilhas, onEscolher: (arquivo: File) => escolher("planilhas", arquivo), onTirar: tirar },
  };
  const aoVivo: LeituraAoVivoNaTela = { tentando: rascunho.leitura.tentando, tentar: rascunho.leitura.tentar, falta: rascunho.leitura.falta, lidaEm: rascunho.leitura.lidaEm };
  if (rascunho.lendo) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">{TITULO}</h1>
        {rascunho.leitura.falhou ? (
          // A leitura que falhou não volta sozinha: a falha fica, com "Tentar de novo" (carregamento v2).
          <FalhaAoVivo leitura={aoVivo} mensagem="Não foi possível carregar a edição." className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3" />
        ) : (
          <CarregandoNaRegiao rotulo="Carregando a edição…" onTentar={rascunho.leitura.tentar} />
        )}
      </div>
    );
  }
  const base = rascunho.edicao ?? rascunho.viva;
  return (
    <>
    {rascunho.leitura.falhou ? (
      <div className="mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <FalhaAoVivo
          leitura={aoVivo}
          mensagem={id ? "Não foi possível carregar a edição." : "Não foi possível carregar os eventos."}
          className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3"
        />
      </div>
    ) : null}
    <FormularioDaEdicaoView
      form={rascunho.form}
      eventos={rascunho.eventos}
      nascida={Boolean(id)}
      nascendo={rascunho.nascendo}
      idDaEdicao={id}
      produtos={produtos}
      salvoAs={rascunho.salvoAs}
      salvando={rascunho.salvando}
      enviando={rascunho.enviando}
      erros={rascunho.erros}
      anexos={anexos}
      acoes={{
        mudar: rascunho.mudar,
        sairDoNome: rascunho.sairDoNome,
        escolherEvento: rascunho.escolherEvento,
        salvarAgora: rascunho.salvarAgora,
        enviar: rascunho.enviar,
        verItens: () => setVendoItens(true),
      }}
    />
    {vendoItens && base ? (
      <ItensDoEventoDialogo
        // Os itens do formulário (o que a pessoa já mudou) sobre a edição gravada.
        edicao={{ ...base, event_name: rascunho.form.nome.trim() || base.event_name, itens: rascunho.form.itens as EdicaoView["itens"] }}
        produtos={produtos}
        onMudar={(itens) => rascunho.mudar("itens", itens)}
        onFechar={() => setVendoItens(false)}
        onEscolherMais={() => {
          setVendoItens(false);
          if (id) navegar(hrefDoEstoqueDoEvento(id));
        }}
      />
    ) : null}
    </>
  );
}

/** O formulário da edição: o novo com `id` null; o rascunho com o id dele. */
export function ClienteEventoFormulario({ id, eventoId = null }: { id: string | null; eventoId?: string | null }) {
  return (
    <ClientDataBoundary titulo={TITULO}>
      {(overview) => (
        <main className="h-full min-h-0 w-full overflow-y-auto">
          <FormularioComProdutos id={id} eventoId={eventoId} produtos={produtosDoPortal(overview)} />
        </main>
      )}
    </ClientDataBoundary>
  );
}

/** /portal/eventos/novo; com ?evento=, a nova edição de um evento que já existe. */
export function ClienteEventoNovo() {
  const eventoId = eventoDaBusca(useSearch());
  return <ClienteEventoFormulario id={null} eventoId={eventoId} />;
}

/**
 * /portal/eventos/edicao?id=: o formulário no rascunho; fora dele, a volta à
 * lista (a parte 11 troca só esse ramo pela edição registrada). A edição
 * apagada ou de outro cliente nega a leitura: fica a falha, com a nova
 * tentativa.
 */
export function ClienteEventoEdicao() {
  const id = idDaEdicaoNaBusca(useSearch());
  return id ? <EdicaoPeloId key={id} id={id} /> : <Redirect to={ROTA_EVENTOS} replace />;
}

function EdicaoPeloId({ id }: { id: string }) {
  const viva = useEdicaoDoEvento(id);
  // A edição que acabou de nascer nesta aba abre na hora, com o que a pessoa digitou; e a tela aberta fica aberta.
  const [aberta, setAberta] = useState(() => ENTREGAS.has(id));
  const foraDoRascunho = viva.edicao === null || (viva.edicao !== undefined && viva.edicao.status !== "rascunho");
  if (!aberta && !foraDoRascunho && viva.edicao?.status === "rascunho") setAberta(true);
  if (foraDoRascunho) return <Redirect to={ROTA_EVENTOS} replace />;
  if (aberta) return <ClienteEventoFormulario id={id} />;
  if (viva.erro) {
    return (
      <main className="h-full min-h-0 w-full overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">{TITULO}</h1>
          <ErroNaLeitura mensagem="Não foi possível carregar a edição." tentando={viva.tentando} onTentar={viva.tentar} />
        </div>
      </main>
    );
  }
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">{TITULO}</h1>
        <CarregandoNaRegiao rotulo="Carregando a edição…" onTentar={viva.tentar} />
      </div>
    </main>
  );
}
