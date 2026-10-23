import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  CalendarDays,
  Check,
  CircleDot,
  Copy,
  CornerDownRight,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { formatarReais } from "@workspace/dominio";

import { AcoesDepoisDoEnvio } from "@/components/comercial/acoes-depois-do-envio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { itensDoAditivoEmTexto, type ExecucaoDaOperacao } from "@/lib/comercial/aditivos-da-operacao";
import { dataBr, type ContatoResumo, type LocalResumo } from "@/lib/comercial/clientes";
import type { AcaoDepoisDoEnvio, AcoesDaEtapa } from "@/lib/comercial/depois-do-envio";
import { ROTULO_DO_ENVIO } from "@/lib/comercial/envio";
import {
  CANAIS_DO_PEDIDO,
  DESCRICAO_MAXIMA,
  ITEM_AVULSO_MAXIMO,
  MOTIVO_MAXIMO,
  VARIANTES,
  adicionarAjuste,
  adicionarAvulsa,
  adicionarDaTabela,
  adicionarSugestao,
  buscaNaTabela,
  formatarDecimal,
  opcoesDoPara,
  origemDaLinha,
  previaDosTotais,
  problemasDaLinha,
  removerLinha,
  rotuloDoContato,
  servicosIrmaos,
  teclaNaBusca,
  type AcoesDoOrcamento,
  type CampoDoFoco,
  type FormOrcamento,
  type ItemDaTabela,
  type LinhaForm,
  type LocalForm,
  type ModoExecucao,
} from "@/lib/comercial/montar";
import {
  CANAL_ROTULO,
  ORIGEM_ROTULO,
  TIPO_RV_ROTULO,
  type EtapaDemanda,
  type StatusOrcamento,
  type TipoRv,
} from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

import { SeloProspect } from "./clientes-view";
import { MarcaDaOrigem, SeloDaEtapa } from "./orcamentos-view";

/**
 * Montar orçamento (docs/mockups/ComOrcamento.dc.html), só a apresentação:
 * os dados e as gravações chegam por props (pages/comercial/orcamento.tsx).
 * Conteúdo na identidade v3 dentro do layout de hoje. Sem legenda: rótulos,
 * dados e ações; uma ação principal ("Enviar para aprovação" no rascunho,
 * ou "Enviar ao cliente" com a marca "Aprovação dispensada" na RV de execução
 * que o servidor dispensa da aprovação; "Aprovar" para o owner, "Enviar ao
 * cliente" no aprovado; na RV enviada, a ação da etapa: Fechado, Validado...). O documento A4
 * abre ao lado ("Prévia do PDF" até o envio; "PDF" depois). A grade é a do Excel do Guilherme; a busca de item
 * da tabela é pelo teclado (Enter adiciona, o foco vai para a quantidade).
 * Enquanto uma gravação está em andamento, nada se edita: o que voltar do
 * servidor substitui o formulário.
 */

export type DadosDoOrcamento = {
  numero: string;
  rotulo: string;
  tipoRv: TipoRv;
  status: StatusOrcamento;
  edicao: number;
  etapa: EtapaDemanda;
  diasNaEtapa: number | null;
  cliente: string;
  prospect: boolean;
  /** "Contrato Itaú · até 30/06/2027", "Sem contrato". */
  contrato: string;
  contratoHref: string | null;
  autor: string | null;
  tabelaNome: string | null;
  variante: string;
  dataBase: string | null;
  /** Os totais que o servidor calculou. */
  subtotalCents: number | null;
  ajustesCents: number | null;
  totalCents: number | null;
  /** "Com o aprovador · 21/10 09:05", "Aprovado por Leonardo · 21/10 08:50". */
  situacao: string | null;
  devolucao: { nota: string | null; detalhe: string } | null;
  /** O que a Operação executou e revisou, e o aditivo que ela pediu (parte 3.10c). */
  operacao: ExecucaoDaOperacao | null;
};

export type MontarViewProps = {
  dados: DadosDoOrcamento;
  form: FormOrcamento;
  onForm: (muda: (form: FormOrcamento) => FormOrcamento) => void;
  /** A pessoa mudou algo desde o último salvamento: os totais são a prévia. */
  sujo: boolean;
  acoes: AcoesDoOrcamento;
  contatos: ContatoResumo[];
  locais: LocalResumo[];
  catalogo: ItemDaTabela[] | "carregando" | "erro";
  /** Uma gravação em andamento: a tela fica travada até ela voltar. */
  ocupado: boolean;
  aviso: { tipo: "erro" | "info"; texto: string } | null;
  /** "10:12": o último salvamento nesta tela. */
  salvoEm: string | null;
  /** O servidor mudou enquanto a pessoa editava (lib/comercial/montar.ts, desatualizado). */
  desatualizado: boolean;
  /** O documento A4 da RV em curso (lib/comercial/documento.ts, hrefDoDocumento). */
  documentoHref: string;
  /** As ações depois do envio da etapa em que o orçamento está (lib/comercial/depois-do-envio.ts). */
  posEnvio: { acoes: AcoesDaEtapa; onAcao: (acao: AcaoDepoisDoEnvio) => void };
  handlers: {
    salvar: () => void;
    /** "Prévia do PDF" com alteração não salva: salva e só então leva a aba nova ao documento. */
    previaSalva: () => void;
    enviar: () => void;
    duplicar: () => void;
    editar: () => void;
    aprovar: () => void;
    devolver: () => void;
    /** O aprovado ao cliente (send): grava e só então abre o documento. */
    enviarCliente: () => void;
    /** Só o owner, do "para aprovar" (approve_and_send). */
    aprovarEEnviar: () => void;
    /** A RV de execução com a aprovação dispensada: do rascunho direto ao cliente (send). */
    enviarDispensado: () => void;
    /** Descartar a RV seguinte ainda não enviada (abre a confirmação). */
    descartarRv: () => void;
    trocarVariante: (variante: string) => void;
    novoContato: () => void;
  };
};

const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

/** Valor do opção "Novo contato…" no "Para". */
export const NOVO_CONTATO = "__novo_contato__";

/** Id do campo de quantidade da linha (o foco vai para ele depois de adicionar). */
export function idDaQuantidade(chave: string): string {
  return `qtd-${chave}`;
}

/** Id da descrição da linha avulsa ou de ajuste (o foco vai para ela quando a linha entra). */
export function idDaDescricao(chave: string): string {
  return `desc-${chave}`;
}

function idDoCampo(chave: string, campo: CampoDoFoco): string {
  return campo === "descricao" ? idDaDescricao(chave) : idDaQuantidade(chave);
}

export const ID_DA_BUSCA = "adicionar-item";

/** Os campos não se editam: só leitura, ou uma gravação em andamento. */
function travado({ acoes, ocupado }: Pick<MontarViewProps, "acoes" | "ocupado">): boolean {
  return !acoes.editavel || ocupado;
}

/** "1.008,00" (a grade, como no Excel, sem o R$). */
function valor(centavos: number | null): string {
  if (centavos === null) return "—";
  return formatarReais(centavos).replace(/^(-?)R\$\s/, "$1");
}

function reais(centavos: number | null): string {
  return centavos === null ? "—" : formatarReais(centavos);
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-xs font-bold text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Alternancia<T extends string>({
  rotulo,
  opcoes,
  valor: atual,
  onEscolher,
  disabled,
}: {
  rotulo: string;
  opcoes: ReadonlyArray<{ valor: T; rotulo: string }>;
  valor: T;
  onEscolher: (valor: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex flex-wrap gap-0.5 self-start rounded-lg bg-muted p-1">
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          aria-pressed={opcao.valor === atual}
          disabled={disabled}
          onClick={() => onEscolher(opcao.valor)}
          className={cn(
            "inline-flex h-8 items-center rounded-md border px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed",
            opcao.valor === atual
              ? "border-border bg-card text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}

function Campo({ id, rotulo, children, className }: { id?: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {id ? <Label htmlFor={id}>{rotulo}</Label> : <span className="text-sm font-medium">{rotulo}</span>}
      {children}
    </div>
  );
}

function Bloco({ rotulo, children, className }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <section
      aria-label={rotulo}
      className={cn("flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-5", className)}
    >
      <h3 className="text-base font-extrabold">{rotulo}</h3>
      {children}
    </section>
  );
}

// --- Cabeçalho -------------------------------------------------------------------------------

function Cabecalho(props: MontarViewProps & { totalCents: number | null }) {
  const { dados, acoes, ocupado, handlers, totalCents } = props;
  const rotulos: Record<string, { rotulo: string; icone: ReactNode; onClick: () => void }> = {
    salvar: {
      rotulo: "Salvar",
      icone: <Save aria-hidden="true" />,
      onClick: handlers.salvar,
    },
    duplicar: {
      rotulo: "Duplicar",
      icone: <Copy aria-hidden="true" />,
      onClick: handlers.duplicar,
    },
    editar: {
      rotulo: "Editar",
      icone: <Pencil aria-hidden="true" />,
      onClick: handlers.editar,
    },
    devolver: {
      rotulo: "Devolver",
      icone: <Undo2 aria-hidden="true" />,
      onClick: handlers.devolver,
    },
    aprovar_e_enviar: {
      rotulo: "Aprovar e enviar",
      icone: <Send aria-hidden="true" />,
      onClick: handlers.aprovarEEnviar,
    },
    descartar_rv: {
      rotulo: "Descartar RV",
      icone: <Trash2 aria-hidden="true" />,
      onClick: handlers.descartarRv,
    },
  };
  return (
    <section
      aria-label={`Orçamento ${dados.rotulo}`}
      className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 rounded-lg border border-border bg-card px-6 py-5"
    >
      <div className="flex min-w-0 flex-1 basis-96 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tabular-nums tracking-tight">{dados.rotulo}</h1>
          <SeloDaEtapa etapa={dados.etapa} dias={dados.diasNaEtapa} />
          <Pill>{TIPO_RV_ROTULO[dados.tipoRv]}</Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
          <b className="font-extrabold text-foreground">{dados.cliente}</b>
          {dados.prospect ? <SeloProspect /> : null}
          <span aria-hidden="true">·</span>
          {dados.contratoHref ? (
            <Link href={dados.contratoHref} className="font-bold underline-offset-4 hover:underline">
              {dados.contrato}
            </Link>
          ) : (
            <span className="font-bold">{dados.contrato}</span>
          )}
          {dados.autor ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{dados.autor}</span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill className="h-9 rounded-lg bg-card px-3 text-sm font-extrabold">
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
            {dados.tabelaNome ?? "Sem tabela"}
          </Pill>
          {props.acoes.editavel ? (
            <Alternancia
              rotulo="Tabela"
              opcoes={VARIANTES.map((variante) => ({
                valor: variante as string,
                rotulo: variante,
              }))}
              valor={dados.variante}
              disabled={ocupado}
              onEscolher={(variante) => {
                if (variante !== dados.variante) handlers.trocarVariante(variante);
              }}
            />
          ) : (
            <Pill className="h-9 rounded-lg px-3 text-sm">{dados.variante}</Pill>
          )}
          <Pill className="h-9 rounded-lg px-3 text-sm">{`Data-base ${dados.dataBase ? dataBr(dados.dataBase) : "—"}`}</Pill>
        </div>
      </div>
      <div className="flex flex-col items-end gap-3">
        <div className="text-right">
          <span className="text-sm font-medium">Total</span>
          <div className="text-3xl font-extrabold tabular-nums tracking-tight">{reais(totalCents)}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {dados.situacao ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm font-bold text-success-soft-foreground">
              <Check className="size-4" aria-hidden="true" />
              {dados.situacao}
            </span>
          ) : null}
          {acoes.aprovacaoDispensada ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm font-bold text-success-soft-foreground">
              <Check className="size-4" aria-hidden="true" />
              Aprovação dispensada
            </span>
          ) : null}
          {acoes.editavel && props.sujo ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm font-bold text-amber-soft-foreground">
              <CircleDot className="size-4" aria-hidden="true" />
              Alterações não salvas
            </span>
          ) : null}
          {acoes.editavel && !props.sujo && props.salvoEm ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Check className="size-4" aria-hidden="true" />
              {`Salvo às ${props.salvoEm}`}
            </span>
          ) : null}
          {acoes.secundarias.map((acao) => (
            <Button key={acao} type="button" variant="outline" onClick={rotulos[acao].onClick} disabled={ocupado}>
              {rotulos[acao].icone}
              {rotulos[acao].rotulo}
            </Button>
          ))}
          {/* O documento abre noutra aba: a montagem fica onde está. Com alteração não salva, salva antes: o documento lê o que está gravado. */}
          <Button asChild variant="outline">
            <a
              href={props.documentoHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(evento) => {
                if (!acoes.editavel || !props.sujo) return;
                evento.preventDefault();
                if (!ocupado) handlers.previaSalva();
              }}
            >
              <FileText aria-hidden="true" />
              {acoes.documento === "enviado" ? "PDF" : "Prévia do PDF"}
            </a>
          </Button>
          {/* Depois do envio, a ação da etapa é a principal da tela (Descartar RV já está entre as secundárias). */}
          <AcoesDepoisDoEnvio
            acoes={props.posEnvio.acoes}
            onAcao={props.posEnvio.onAcao}
            ocupado={ocupado}
            destaque
            ignorar={["descartar_rv"]}
          />
          {acoes.principal === "enviar" ? (
            <Button type="button" onClick={handlers.enviar} disabled={ocupado}>
              <Send aria-hidden="true" />
              Enviar para aprovação
            </Button>
          ) : null}
          {acoes.principal === "enviar_dispensado" ? (
            <Button type="button" onClick={handlers.enviarDispensado} disabled={ocupado}>
              <Send aria-hidden="true" />
              {ROTULO_DO_ENVIO.send}
            </Button>
          ) : null}
          {acoes.principal === "aprovar" ? (
            <Button type="button" onClick={handlers.aprovar} disabled={ocupado}>
              <Check aria-hidden="true" />
              Aprovar
            </Button>
          ) : null}
          {acoes.principal === "enviar_cliente" ? (
            <Button type="button" onClick={handlers.enviarCliente} disabled={ocupado}>
              <Send aria-hidden="true" />
              {ROTULO_DO_ENVIO.send}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// --- Pedido, execução e locais --------------------------------------------------------------

/** As opções do canal: as que a pessoa escolhe e, se o pedido veio do portal ou do WMS, a dele. */
function opcoesDoCanal(atual: string): Array<{ valor: string; rotulo: string }> {
  const opcoes: Array<{ valor: string; rotulo: string }> = CANAIS_DO_PEDIDO.map((canal) => ({ ...canal }));
  if (atual && !opcoes.some((opcao) => opcao.valor === atual)) {
    const rotulo = CANAL_ROTULO[atual] ?? atual;
    opcoes.push({ valor: atual, rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1) });
  }
  return opcoes;
}

function Pedido(props: MontarViewProps) {
  const { form, onForm, acoes, contatos, handlers } = props;
  const desabilitado = travado(props);
  const muda =
    (campo: "refCliente" | "titulo" | "recebidaEm" | "emailAssunto" | "emailLink") => (evento: { target: { value: string } }) =>
      onForm((atual) => ({ ...atual, [campo]: evento.target.value }));
  const link = form.emailLink.trim();
  return (
    <Bloco rotulo="Pedido do cliente" className="flex-[1.5_1_28rem]">
      <div className="flex flex-wrap gap-3">
        <Campo id="pedido-para" rotulo="Para" className="flex-[2_1_14rem]">
          <select
            id="pedido-para"
            value={form.contatoId}
            disabled={desabilitado}
            onChange={(evento) => {
              if (evento.target.value === NOVO_CONTATO) handlers.novoContato();
              else
                onForm((atual) => ({
                  ...atual,
                  contatoId: evento.target.value,
                }));
            }}
            className={CAMPO_SELECT}
          >
            <option value="">—</option>
            {opcoesDoPara(contatos, form.contatoId).map((contato) => (
              <option key={contato.id} value={contato.id}>
                {rotuloDoContato(contato)}
              </option>
            ))}
            {acoes.editavel ? <option value={NOVO_CONTATO}>Novo contato…</option> : null}
          </select>
        </Campo>
        <Campo id="pedido-ref" rotulo="Referência do cliente" className="flex-[1_1_8rem]">
          <Input id="pedido-ref" value={form.refCliente} onChange={muda("refCliente")} maxLength={80} disabled={desabilitado} />
        </Campo>
      </div>
      <div className="flex flex-wrap gap-3">
        <Campo id="pedido-titulo" rotulo="Título" className="flex-[2_1_14rem]">
          <Input id="pedido-titulo" value={form.titulo} onChange={muda("titulo")} maxLength={160} disabled={desabilitado} />
        </Campo>
        <Campo id="pedido-recebido" rotulo="Recebido em" className="flex-[1_1_10rem]">
          <Input
            id="pedido-recebido"
            type="datetime-local"
            value={form.recebidaEm}
            onChange={muda("recebidaEm")}
            disabled={desabilitado}
          />
        </Campo>
      </div>
      <Campo rotulo="Canal">
        <Alternancia
          rotulo="Canal"
          opcoes={opcoesDoCanal(form.canal)}
          valor={form.canal}
          disabled={desabilitado}
          onEscolher={(canal) => onForm((atual) => ({ ...atual, canal }))}
        />
      </Campo>
      {form.canal === "email" || form.emailAssunto.trim() || link ? (
        <>
          <Campo id="pedido-assunto" rotulo="Assunto do e-mail">
            <Input
              id="pedido-assunto"
              value={form.emailAssunto}
              onChange={muda("emailAssunto")}
              maxLength={300}
              disabled={desabilitado}
            />
          </Campo>
          <Campo id="pedido-link" rotulo="Link do e-mail">
            <div className="flex items-center gap-2.5">
              <Input
                id="pedido-link"
                type="url"
                value={form.emailLink}
                onChange={muda("emailLink")}
                maxLength={2000}
                disabled={desabilitado}
                className="min-w-0 flex-1"
              />
              {/^https?:\/\/\S+$/i.test(link) ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-primary underline-offset-4 hover:underline"
                >
                  Abrir no Outlook
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </Campo>
        </>
      ) : null}
    </Bloco>
  );
}

const MODOS: ReadonlyArray<{ valor: ModoExecucao; rotulo: string }> = [
  { valor: "data", rotulo: "Data" },
  { valor: "intervalo", rotulo: "Intervalo" },
  { valor: "a_definir", rotulo: "A definir" },
];

function Execucao(props: MontarViewProps) {
  const { form, onForm } = props;
  const desabilitado = travado(props);
  const exec = form.execucao;
  const muda = (campo: "data" | "de" | "ate" | "visitaTecnica") => (evento: { target: { value: string } }) =>
    onForm((atual) => ({
      ...atual,
      execucao: { ...atual.execucao, [campo]: evento.target.value },
    }));
  return (
    <Bloco rotulo="Execução" className="flex-[1_1_15rem]">
      <Alternancia
        rotulo="Datas da execução"
        opcoes={MODOS}
        valor={exec.modo}
        disabled={desabilitado}
        onEscolher={(modo) =>
          onForm((atual) => ({
            ...atual,
            execucao: { ...atual.execucao, modo },
          }))
        }
      />
      {exec.modo === "data" ? (
        <Campo id="execucao-data" rotulo="Data">
          <Input id="execucao-data" type="date" value={exec.data} onChange={muda("data")} disabled={desabilitado} />
        </Campo>
      ) : null}
      {exec.modo === "a_definir" ? (
        <Campo rotulo="Data">
          <div className="flex h-10 items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm font-bold text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />A definir
          </div>
        </Campo>
      ) : null}
      {exec.modo === "intervalo" ? (
        <div className="flex flex-wrap gap-3">
          <Campo id="execucao-de" rotulo="De" className="flex-[1_1_7rem]">
            <Input id="execucao-de" type="date" value={exec.de} onChange={muda("de")} disabled={desabilitado} />
          </Campo>
          <Campo id="execucao-ate" rotulo="Até" className="flex-[1_1_7rem]">
            <Input id="execucao-ate" type="date" value={exec.ate} onChange={muda("ate")} disabled={desabilitado} />
          </Campo>
        </div>
      ) : null}
      <Campo id="execucao-visita" rotulo="Visita técnica">
        <Input
          id="execucao-visita"
          type="date"
          value={exec.visitaTecnica}
          onChange={muda("visitaTecnica")}
          disabled={desabilitado}
        />
      </Campo>
    </Bloco>
  );
}

function SeletorDeLocal({
  id,
  rotulo,
  local,
  locais,
  desabilitado,
  onMuda,
}: {
  id: string;
  rotulo: string;
  local: LocalForm;
  locais: LocalResumo[];
  desabilitado: boolean;
  onMuda: (local: LocalForm) => void;
}) {
  const opcoes = locais.filter((item) => item.ativo || item.id === local.localId);
  return (
    <Campo id={id} rotulo={rotulo}>
      <select
        id={id}
        value={local.localId}
        disabled={desabilitado}
        onChange={(evento) => onMuda({ ...local, localId: evento.target.value })}
        className={CAMPO_SELECT}
      >
        <option value="">—</option>
        {opcoes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nome}
          </option>
        ))}
      </select>
      <Input
        aria-label={`Complemento ${rotulo === "Origem" ? "da origem" : "do destino"}`}
        value={local.complemento}
        onChange={(evento) => onMuda({ ...local, complemento: evento.target.value })}
        maxLength={200}
        disabled={desabilitado}
      />
    </Campo>
  );
}

function Locais(props: MontarViewProps) {
  const { form, onForm, locais } = props;
  const desabilitado = travado(props);
  return (
    <Bloco rotulo="Locais" className="flex-[1.2_1_18rem]">
      <SeletorDeLocal
        id="local-origem"
        rotulo="Origem"
        local={form.origem}
        locais={locais}
        desabilitado={desabilitado}
        onMuda={(origem) => onForm((atual) => ({ ...atual, origem }))}
      />
      <SeletorDeLocal
        id="local-destino"
        rotulo="Destino"
        local={form.destino}
        locais={locais}
        desabilitado={desabilitado}
        onMuda={(destino) => onForm((atual) => ({ ...atual, destino }))}
      />
    </Bloco>
  );
}

// --- Grade de itens --------------------------------------------------------------------------

/** O código da LPU (DTL-0002-T) cabe numa linha: a coluna tem a largura dele. */
const COLUNAS = "grid grid-cols-[7.5rem_minmax(15rem,1fr)_7.5rem_4.5rem_11rem_5.5rem_8rem_2.75rem]";

/** Célula da grade: borda à direita, menos na última coluna. */
function celula(extra?: string, ultima = false): string {
  return cn("flex min-w-0 px-3 py-2", !ultima && "border-r border-muted", extra ?? "items-center");
}

const CAMPO_DA_GRADE = "h-8 min-w-0 px-2 text-sm";

/** A lista da busca de item: os itens achados, "Nenhum item" e quantos ficaram de fora. */
export function ListaDaBusca({
  itens,
  total,
  destacado,
  onEscolher,
  onDestacar,
}: {
  itens: ItemDaTabela[];
  total: number;
  destacado: number;
  onEscolher: (item: ItemDaTabela) => void;
  onDestacar: (indice: number) => void;
}) {
  const fora = total - itens.length;
  return (
    <ul
      id="itens-da-tabela"
      role="listbox"
      aria-label="Itens da tabela"
      className="absolute left-0 right-0 top-11 z-20 max-h-80 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
    >
      {itens.length === 0 ? (
        <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-2 text-sm font-bold text-muted-foreground">
          Nenhum item
        </li>
      ) : null}
      {itens.map((item, indice) => (
        <li
          key={item.lpuItemId}
          id={`item-${item.lpuItemId}`}
          role="option"
          aria-selected={indice === destacado}
          onMouseDown={(evento) => {
            evento.preventDefault();
            onEscolher(item);
          }}
          onMouseEnter={() => onDestacar(indice)}
          className={cn(
            "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
            indice === destacado ? "bg-surface-hover" : "bg-popover",
          )}
        >
          <span className="w-24 shrink-0 whitespace-nowrap font-bold tabular-nums text-muted-foreground">{item.codigo ?? "—"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{item.item}</span>
            <span className="block truncate text-xs font-semibold text-muted-foreground">
              {[item.servico, item.unidade].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="shrink-0 font-bold tabular-nums">{formatarDecimal(item.preco, 2)}</span>
        </li>
      ))}
      {fora > 0 ? (
        <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-2 text-xs font-bold text-muted-foreground">
          {fora === 1 ? "+1 item" : `+${fora} itens`}
        </li>
      ) : null}
    </ul>
  );
}

function BuscaDeItem({
  catalogo,
  desabilitado,
  onAdicionar,
}: {
  catalogo: MontarViewProps["catalogo"];
  desabilitado: boolean;
  onAdicionar: (item: ItemDaTabela) => void;
}) {
  const [termo, setTermo] = useState("");
  const [destacado, setDestacado] = useState(0);
  const [aberta, setAberta] = useState(false);
  const busca = Array.isArray(catalogo) ? buscaNaTabela(catalogo, termo) : { itens: [], total: 0 };
  const lista = busca.itens;
  const adicionar = (item: ItemDaTabela | undefined) => {
    if (!item) return;
    onAdicionar(item);
    setTermo("");
    setDestacado(0);
    setAberta(false);
  };
  const semTabela = !Array.isArray(catalogo) || catalogo.length === 0;
  // Com termo, a lista aparece mesmo vazia ("Nenhum item").
  const mostrar = aberta && termo.trim().length > 0;
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
      <Input
        id={ID_DA_BUSCA}
        role="combobox"
        aria-label="Adicionar item da tabela"
        aria-expanded={mostrar}
        aria-controls="itens-da-tabela"
        aria-activedescendant={mostrar && lista[destacado] ? `item-${lista[destacado].lpuItemId}` : undefined}
        aria-autocomplete="list"
        placeholder="Adicionar item…"
        autoComplete="off"
        value={termo}
        disabled={desabilitado || semTabela}
        onChange={(evento) => {
          setTermo(evento.target.value);
          setDestacado(0);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => setAberta(false)}
        onKeyDown={(evento) => {
          const passo = teclaNaBusca(evento.key, {
            destacado,
            total: lista.length,
          });
          if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(evento.key)) evento.preventDefault();
          setDestacado(passo.destacado);
          if (passo.acao === "adicionar") adicionar(lista[passo.destacado]);
          if (passo.acao === "fechar") setAberta(false);
          else if (evento.key.startsWith("Arrow")) setAberta(true);
        }}
        className="pl-9 pr-11"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-2.5 inline-flex h-5 min-w-6 items-center justify-center rounded-sm border border-border bg-muted px-1.5 text-xs font-bold text-muted-foreground"
      >
        ↵
      </kbd>
      {mostrar ? (
        <ListaDaBusca itens={lista} total={busca.total} destacado={destacado} onEscolher={adicionar} onDestacar={setDestacado} />
      ) : null}
    </div>
  );
}

function LinhaDaGrade({
  linha,
  totalCents,
  editavel,
  travada,
  onMuda,
  onRemover,
  onEnterNaQuantidade,
}: {
  linha: LinhaForm;
  totalCents: number | null;
  /** A linha é de um rascunho: mostra o que falta e o Remover. */
  editavel: boolean;
  /** Só leitura ou gravação em andamento: os campos não se editam. */
  travada: boolean;
  onMuda: (linha: LinhaForm) => void;
  onRemover: () => void;
  onEnterNaQuantidade: () => void;
}) {
  const origem = origemDaLinha(linha);
  const problemas = editavel ? problemasDaLinha(linha) : [];
  const nome = linha.origem === "tabela" ? linha.item : linha.descricao;
  const rotulo = [nome || ORIGEM_ROTULO[origem], linha.servico].filter(Boolean).join(" · ");
  const muda = (campo: keyof LinhaForm) => (evento: { target: { value: string } }) =>
    onMuda({ ...linha, [campo]: evento.target.value });
  const pedeMotivo = origem !== "tabela";
  // Linha que ainda não foi salva (sem id do servidor) fica destacada, como .xr.new no mockup.
  const nova = editavel && !linha.id;
  return (
    <div role="row" className={cn(COLUNAS, "border-t border-muted", nova && "bg-info-soft")}>
      <span role="cell" className={cn(celula(), "whitespace-nowrap font-bold tabular-nums text-muted-foreground")}>
        {linha.codigo ?? "—"}
      </span>
      <div role="cell" className={celula("flex-col items-start justify-center gap-1")}>
        <div className="flex w-full flex-wrap items-center gap-2 font-bold">
          {origem === "ajuste" ? <MarcaDaOrigem origem="ajuste" rotulo="Ajuste" /> : null}
          {linha.origem === "tabela" ? (
            <span>{linha.item}</span>
          ) : (
            <Input
              id={idDaDescricao(linha.chave)}
              aria-label={origem === "ajuste" ? "Descrição do ajuste" : "Item avulso"}
              value={linha.descricao}
              onChange={muda("descricao")}
              maxLength={origem === "ajuste" ? DESCRICAO_MAXIMA : ITEM_AVULSO_MAXIMO}
              disabled={travada}
              className={cn(CAMPO_DA_GRADE, "flex-1")}
            />
          )}
          {origem === "alterado" ? <MarcaDaOrigem origem="alterado" rotulo="Alterado" /> : null}
          {origem === "avulso" ? <MarcaDaOrigem origem="avulso" rotulo="Avulso" /> : null}
        </div>
        {pedeMotivo ? (
          <Input
            aria-label={`Motivo · ${rotulo}`}
            placeholder="Motivo"
            value={linha.motivo}
            onChange={muda("motivo")}
            maxLength={MOTIVO_MAXIMO}
            disabled={travada}
            className={cn(CAMPO_DA_GRADE, "w-full")}
          />
        ) : null}
        {problemas.length ? (
          <span role="alert" className="text-xs font-bold text-destructive">
            {problemas.join(" ")}
          </span>
        ) : null}
      </div>
      <span role="cell" className={celula()}>
        {linha.origem === "avulso" ? (
          <Input
            aria-label={`Serviço · ${rotulo}`}
            value={linha.servico}
            onChange={muda("servico")}
            maxLength={120}
            disabled={travada}
            className={CAMPO_DA_GRADE}
          />
        ) : (
          linha.servico || "—"
        )}
      </span>
      <span role="cell" className={celula()}>
        {linha.origem === "avulso" ? (
          <Input
            aria-label={`Unidade · ${rotulo}`}
            value={linha.unidade}
            onChange={muda("unidade")}
            maxLength={20}
            disabled={travada}
            className={CAMPO_DA_GRADE}
          />
        ) : (
          linha.unidade || "—"
        )}
      </span>
      <div role="cell" className={celula("items-center justify-end gap-2")}>
        {origem === "alterado" && linha.precoTabela ? (
          <s className="text-sm font-semibold tabular-nums text-muted-foreground">{formatarDecimal(linha.precoTabela, 2)}</s>
        ) : null}
        {origem === "ajuste" ? <span className="font-bold">−</span> : null}
        <Input
          aria-label={`Valor unitário · ${rotulo}`}
          inputMode="decimal"
          value={linha.preco}
          onChange={muda("preco")}
          disabled={travada}
          className={cn(
            CAMPO_DA_GRADE,
            "w-24 text-right tabular-nums",
            origem === "alterado" && "font-extrabold text-warning-soft-foreground",
          )}
        />
      </div>
      <div role="cell" className={celula("items-center justify-end")}>
        {origem === "ajuste" ? (
          <span className="font-bold">1</span>
        ) : (
          <Input
            id={idDaQuantidade(linha.chave)}
            aria-label={`Quantidade · ${rotulo}`}
            inputMode="decimal"
            value={linha.quantidade}
            onChange={muda("quantidade")}
            onKeyDown={(evento) => {
              if (evento.key === "Enter") {
                evento.preventDefault();
                onEnterNaQuantidade();
              }
            }}
            disabled={travada}
            className={cn(CAMPO_DA_GRADE, "w-16 text-right font-bold tabular-nums")}
          />
        )}
      </div>
      <span role="cell" className={cn(celula("items-center justify-end"), "font-extrabold tabular-nums")}>
        {valor(totalCents)}
      </span>
      <span role="cell" className={cn(celula("items-center justify-center", true), "px-1")}>
        {editavel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover · ${rotulo}`}
            onClick={onRemover}
            disabled={travada}
            className="size-8"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function Sugestoes({
  itens,
  desabilitado,
  onAdicionar,
}: {
  itens: ItemDaTabela[];
  desabilitado: boolean;
  onAdicionar: (item: ItemDaTabela) => void;
}) {
  return (
    <div
      role="row"
      className="flex flex-wrap items-center gap-2 border-t border-dashed border-border bg-background py-2 pl-20 pr-5 text-muted-foreground"
    >
      <CornerDownRight className="size-4 shrink-0" aria-hidden="true" />
      {itens.map((item) => (
        <button
          key={item.lpuItemId}
          type="button"
          onClick={() => onAdicionar(item)}
          disabled={desabilitado}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-muted-foreground bg-card px-3 text-xs font-bold text-foreground hover:border-solid hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-3" aria-hidden="true" />
          {`${[item.codigo, item.servico].filter(Boolean).join(" ")} · ${formatarDecimal(item.preco, 2)}${item.unidade ? ` / ${item.unidade}` : ""}`}
        </button>
      ))}
    </div>
  );
}

function Itens(props: MontarViewProps) {
  const { form, onForm, acoes, catalogo, dados } = props;
  const editavel = acoes.editavel;
  const travada = travado(props);
  const contador = useRef(0);
  const [foco, setFoco] = useState<{ chave: string; campo: CampoDoFoco } | null>(null);
  const [sugestaoDe, setSugestaoDe] = useState<string | null>(null);
  const previa = previaDosTotais(form.linhas);
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const porId = new Map(lista.map((item) => [item.lpuItemId, item]));

  useEffect(() => {
    if (!foco) return;
    const campo = document.getElementById(idDoCampo(foco.chave, foco.campo));
    if (campo instanceof HTMLInputElement) {
      campo.focus();
      campo.select();
    }
    setFoco(null);
  }, [foco, form.linhas]);

  const novaChave = () => {
    contador.current += 1;
    return `nova-${Date.now()}-${contador.current}`;
  };
  const adicionar = (resultado: { linhas: LinhaForm[]; foco: string; campo?: CampoDoFoco }) => {
    onForm((atual) => ({ ...atual, linhas: resultado.linhas }));
    setFoco({ chave: resultado.foco, campo: resultado.campo ?? "quantidade" });
  };
  const focarBusca = () => document.getElementById(ID_DA_BUSCA)?.focus();
  const tabelaRotulo = dados.tabelaNome ? `${dados.tabelaNome} · ${dados.variante}` : "Sem tabela";

  return (
    <section aria-label="Itens" className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-extrabold">
          Itens
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold">
            {form.linhas.length}
          </span>
        </h3>
        <span className="text-sm font-bold text-muted-foreground">{tabelaRotulo}</span>
      </div>
      <div className="overflow-x-auto">
        <div role="table" aria-label="Itens do orçamento" className="min-w-[63rem]">
          <div role="row" className={cn(COLUNAS, "border-t border-muted bg-background text-sm font-bold text-muted-foreground")}>
            <span role="columnheader" className={celula()}>
              Código
            </span>
            <span role="columnheader" className={celula()}>
              Item
            </span>
            <span role="columnheader" className={celula()}>
              Serviço
            </span>
            <span role="columnheader" className={celula()}>
              Unid.
            </span>
            <span role="columnheader" className={celula("items-center justify-end")}>
              Valor unit.
            </span>
            <span role="columnheader" className={celula("items-center justify-end")}>
              Qtd
            </span>
            <span role="columnheader" className={celula("items-center justify-end")}>
              Total
            </span>
            <span role="columnheader" className={celula(undefined, true)} />
          </div>
          {form.linhas.map((linha) => {
            const origemDaSugestao = sugestaoDe === linha.chave && linha.lpuItemId ? porId.get(linha.lpuItemId) : undefined;
            const irmaos = editavel && origemDaSugestao ? servicosIrmaos(origemDaSugestao, lista, form.linhas) : [];
            return (
              <div key={linha.chave} className="contents">
                <LinhaDaGrade
                  linha={linha}
                  totalCents={previa.porLinha[linha.chave] ?? null}
                  editavel={editavel}
                  travada={travada}
                  onMuda={(nova) =>
                    onForm((atual) => ({
                      ...atual,
                      linhas: atual.linhas.map((item) => (item.chave === nova.chave ? nova : item)),
                    }))
                  }
                  onRemover={() =>
                    onForm((atual) => ({
                      ...atual,
                      linhas: removerLinha(atual.linhas, linha.chave),
                    }))
                  }
                  onEnterNaQuantidade={focarBusca}
                />
                {irmaos.length ? (
                  <Sugestoes
                    itens={irmaos}
                    desabilitado={travada}
                    onAdicionar={(item) => adicionar(adicionarSugestao(form.linhas, linha.chave, item, novaChave()))}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {editavel ? (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-muted px-5 py-3 sm:pl-20">
          <BuscaDeItem
            catalogo={catalogo}
            desabilitado={travada}
            onAdicionar={(item) => {
              const resultado = adicionarDaTabela(form.linhas, item, novaChave());
              adicionar(resultado);
              setSugestaoDe(resultado.foco);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={travada}
            onClick={() => adicionar(adicionarAvulsa(form.linhas, novaChave()))}
          >
            <Plus aria-hidden="true" />
            Item avulso
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={travada}
            onClick={() => adicionar(adicionarAjuste(form.linhas, novaChave()))}
          >
            <Plus aria-hidden="true" />
            Ajuste
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// --- Rodapé ------------------------------------------------------------------------------

function Rodape(
  props: MontarViewProps & {
    totais: {
      subtotal: number | null;
      ajustes: number | null;
      total: number | null;
    };
  },
) {
  const { form, onForm, totais } = props;
  const desabilitado = travado(props);
  return (
    <div className="flex flex-wrap items-stretch gap-5">
      <Bloco rotulo="Condições" className="flex-[1.3_1_22rem]">
        <Textarea
          aria-label="Condições"
          rows={5}
          value={form.condicoes}
          onChange={(evento) => onForm((atual) => ({ ...atual, condicoes: evento.target.value }))}
          maxLength={4000}
          disabled={desabilitado}
        />
      </Bloco>
      <Bloco rotulo="Observações internas" className="flex-[1_1_18rem]">
        <Textarea
          aria-label="Observações internas"
          rows={5}
          value={form.observacoes}
          onChange={(evento) => onForm((atual) => ({ ...atual, observacoes: evento.target.value }))}
          maxLength={4000}
          disabled={desabilitado}
        />
      </Bloco>
      <section aria-label="Totais" className="flex flex-[0_1_20rem] flex-col gap-2.5 rounded-lg border border-border bg-card p-5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold text-muted-foreground">Subtotal</span>
          <b className="font-bold tabular-nums">{reais(totais.subtotal)}</b>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold text-muted-foreground">Ajustes</span>
          <b className="font-bold tabular-nums">{reais(totais.ajustes)}</b>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5 text-lg">
          <span className="font-extrabold">Total</span>
          <b className="font-extrabold tabular-nums">{reais(totais.total)}</b>
        </div>
      </section>
    </div>
  );
}

/**
 * Os totais que a tela mostra: os do servidor sem mudança; com mudança, a
 * prévia (lib/dominio) das linhas que já têm valor. A linha incompleta fica
 * sem valor na grade e diz o que falta; não zera o resto.
 */
function totaisDaTela(props: MontarViewProps) {
  if (!props.sujo) {
    return {
      subtotal: props.dados.subtotalCents,
      ajustes: props.dados.ajustesCents,
      total: props.dados.totalCents,
    };
  }
  const previa = previaDosTotais(props.form.linhas);
  return {
    subtotal: previa.subtotalCents,
    ajustes: previa.ajustesCents,
    total: previa.totalCents,
  };
}

/** O que a Operação executou e revisou, por linha, e o aditivo que ela pediu (parte 3.10c). Sem valor. */
function ExecucaoNaOperacao({ execucao }: { execucao: ExecucaoDaOperacao }) {
  return (
    <section aria-label="Execução na Operação" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold">Execução na Operação</h2>
        <span className="text-sm font-semibold text-muted-foreground">{execucao.titulo}</span>
      </div>
      {execucao.aditivo ? (
        <p className="rounded-md border border-amber-soft-border bg-amber-soft px-4 py-2.5 text-sm font-semibold text-amber-soft-foreground">
          Aditivo pedido pela Operação · {itensDoAditivoEmTexto(execucao.aditivo.itens)}
        </p>
      ) : null}
      {execucao.linhas.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Item</th>
                <th className="px-2 py-2 text-right">Executado</th>
                <th className="px-2 py-2 text-right">A cobrar</th>
                <th className="px-2 py-2 text-right">Absorvido</th>
                <th className="py-2 pl-2 text-right">Aditivo</th>
              </tr>
            </thead>
            <tbody>
              {execucao.linhas.map((linha) => (
                <tr key={linha.item} className="border-b border-border last:border-b-0 font-semibold">
                  <td className="py-2 pr-3">
                    {linha.item}
                    {linha.unidade ? <span className="ml-1.5 text-xs text-muted-foreground">{linha.unidade}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{linha.executado}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{linha.aCobrar}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{linha.absorvido}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{linha.aditivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function MontarView(props: MontarViewProps) {
  const totais = totaisDaTela(props);
  const { aviso, dados } = props;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <Cabecalho {...props} totalCents={totais.total} />
      {props.desatualizado && props.sujo ? (
        <p
          role="alert"
          className="rounded-md border border-amber-soft-border bg-amber-soft px-4 py-3 text-sm font-semibold text-amber-soft-foreground"
        >
          O orçamento mudou enquanto você editava. Ao salvar, o servidor recusa e o orçamento recarrega.
        </p>
      ) : null}
      {aviso ? (
        <p
          role={aviso.tipo === "erro" ? "alert" : "status"}
          className={cn(
            "rounded-md border px-4 py-3 text-sm font-semibold",
            aviso.tipo === "erro"
              ? "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground"
              : "border-info-soft-border bg-info-soft text-info-soft-foreground",
          )}
        >
          {aviso.texto}
        </p>
      ) : null}
      {dados.status === "rascunho" && dados.devolucao ? (
        <section
          aria-label="Devolução"
          className="flex flex-col gap-1 rounded-lg border border-warning-soft-border bg-warning-soft px-5 py-4 text-warning-soft-foreground"
        >
          <b className="text-sm font-extrabold">{dados.devolucao.detalhe}</b>
          {dados.devolucao.nota ? <p className="text-sm font-semibold">{dados.devolucao.nota}</p> : null}
        </section>
      ) : null}
      {dados.operacao ? <ExecucaoNaOperacao execucao={dados.operacao} /> : null}
      <div className="flex flex-wrap items-stretch gap-5">
        <Pedido {...props} />
        <Execucao {...props} />
        <Locais {...props} />
      </div>
      <Itens {...props} />
      <Rodape {...props} totais={totais} />
    </div>
  );
}

/** Carregando, não encontrado ou erro, no lugar da tela. */
export function EstadoDoOrcamento({ estado }: { estado: "carregando" | "nao_encontrado" | "erro" }) {
  const texto =
    estado === "carregando"
      ? "Carregando..."
      : estado === "nao_encontrado"
        ? "Orçamento não encontrado"
        : "Não foi possível carregar o orçamento.";
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <h1 className="text-3xl font-extrabold tracking-tight">Orçamento</h1>
      <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">
        {texto}
      </p>
    </div>
  );
}
