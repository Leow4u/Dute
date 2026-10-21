import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, Copy, CornerDownRight, ExternalLink, FileText, Pencil, Plus, Save, Search, Send, Undo2, X } from "lucide-react";

import { formatarReais } from "@workspace/dominio";

import { AbasDoComercial } from "@/components/comercial/abas-do-comercial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dataBr, type ContatoResumo, type LocalResumo } from "@/lib/comercial/clientes";
import {
  VARIANTES,
  adicionarDaTabela,
  adicionarSugestao,
  buscarItensDaTabela,
  formatarDecimal,
  linhaAvulsa,
  linhaDeAjuste,
  opcoesDoPara,
  origemDaLinha,
  previaDosTotais,
  problemasDaLinha,
  removerLinha,
  rotuloDoContato,
  servicosIrmaos,
  teclaNaBusca,
  type AcoesDoOrcamento,
  type FormOrcamento,
  type ItemDaTabela,
  type LinhaForm,
  type LocalForm,
  type ModoExecucao,
} from "@/lib/comercial/montar";
import { ORIGEM_ROTULO, TIPO_RV_ROTULO, type EtapaDemanda, type StatusOrcamento, type TipoRv } from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

import { SeloProspect } from "./clientes-view";
import { MarcaDaOrigem, SeloDaEtapa } from "./orcamentos-view";

/**
 * Montar orçamento (docs/mockups/ComOrcamento.dc.html), só a apresentação:
 * os dados e as gravações chegam por props (pages/comercial/orcamento.tsx).
 * Conteúdo na identidade v3 dentro do layout de hoje. Sem legenda: rótulos,
 * dados e ações; uma ação principal ("Enviar para aprovação" no rascunho,
 * "Aprovar" para o owner). A grade é a do Excel do Guilherme; a busca de item
 * da tabela é pelo teclado (Enter adiciona, o foco vai para a quantidade).
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
  /** "Enviado para aprovação · 21/10 09:05", "Aprovado por Leonardo · 21/10 08:50". */
  situacao: string | null;
  devolucao: { nota: string | null; detalhe: string } | null;
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
  ocupado: boolean;
  aviso: { tipo: "erro" | "info"; texto: string } | null;
  handlers: {
    salvar: () => void;
    enviar: () => void;
    duplicar: () => void;
    editar: () => void;
    aprovar: () => void;
    devolver: () => void;
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

export const ID_DA_BUSCA = "adicionar-item";

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
  };
  return (
    <section
      aria-label={`Orçamento ${dados.rotulo}`}
      className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 rounded-lg border border-border bg-card px-6 py-5"
    >
      <div className="flex min-w-0 flex-1 basis-96 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-extrabold tabular-nums tracking-tight">{dados.rotulo}</h2>
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
          {acoes.secundarias.map((acao) => (
            <Button key={acao} type="button" variant="outline" onClick={rotulos[acao].onClick} disabled={ocupado}>
              {rotulos[acao].icone}
              {rotulos[acao].rotulo}
            </Button>
          ))}
          {acoes.principal === "enviar" ? (
            <Button type="button" onClick={handlers.enviar} disabled={ocupado}>
              <Send aria-hidden="true" />
              Enviar para aprovação
            </Button>
          ) : null}
          {acoes.principal === "aprovar" ? (
            <Button type="button" onClick={handlers.aprovar} disabled={ocupado}>
              <Check aria-hidden="true" />
              Aprovar
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// --- Pedido, execução e locais --------------------------------------------------------------

function Pedido({ form, onForm, acoes, contatos, handlers }: MontarViewProps) {
  const desabilitado = !acoes.editavel;
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
            {desabilitado ? null : <option value={NOVO_CONTATO}>Novo contato…</option>}
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
    </Bloco>
  );
}

const MODOS: ReadonlyArray<{ valor: ModoExecucao; rotulo: string }> = [
  { valor: "data", rotulo: "Data" },
  { valor: "intervalo", rotulo: "Intervalo" },
  { valor: "a_definir", rotulo: "A definir" },
];

function Execucao({ form, onForm, acoes }: MontarViewProps) {
  const desabilitado = !acoes.editavel;
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

function Locais({ form, onForm, acoes, locais }: MontarViewProps) {
  const desabilitado = !acoes.editavel;
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

const COLUNAS = "grid grid-cols-[4.5rem_minmax(15rem,1fr)_7.5rem_4.5rem_11rem_5.5rem_8rem_2.75rem]";

/** Célula da grade: borda à direita, menos na última coluna. */
function celula(extra?: string, ultima = false): string {
  return cn("flex min-w-0 px-3 py-2", !ultima && "border-r border-muted", extra ?? "items-center");
}

const CAMPO_DA_GRADE = "h-8 min-w-0 px-2 text-sm";

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
  const lista = Array.isArray(catalogo) ? buscarItensDaTabela(catalogo, termo) : [];
  const adicionar = (item: ItemDaTabela | undefined) => {
    if (!item) return;
    onAdicionar(item);
    setTermo("");
    setDestacado(0);
    setAberta(false);
  };
  const semTabela = !Array.isArray(catalogo) || catalogo.length === 0;
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
      <Input
        id={ID_DA_BUSCA}
        role="combobox"
        aria-label="Adicionar item da tabela"
        aria-expanded={aberta && lista.length > 0}
        aria-controls="itens-da-tabela"
        aria-activedescendant={aberta && lista[destacado] ? `item-${lista[destacado].lpuItemId}` : undefined}
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
      {aberta && lista.length > 0 ? (
        <ul
          id="itens-da-tabela"
          role="listbox"
          aria-label="Itens da tabela"
          className="absolute left-0 right-0 top-11 z-20 max-h-80 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {lista.map((item, indice) => (
            <li
              key={item.lpuItemId}
              id={`item-${item.lpuItemId}`}
              role="option"
              aria-selected={indice === destacado}
              onMouseDown={(evento) => {
                evento.preventDefault();
                adicionar(item);
              }}
              onMouseEnter={() => setDestacado(indice)}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                indice === destacado ? "bg-surface-hover" : "bg-popover",
              )}
            >
              <span className="w-12 shrink-0 font-bold tabular-nums text-muted-foreground">{item.codigo ?? "—"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{item.item}</span>
                <span className="block truncate text-xs font-semibold text-muted-foreground">
                  {[item.servico, item.unidade].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{formatarDecimal(item.preco, 2)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LinhaDaGrade({
  linha,
  totalCents,
  editavel,
  onMuda,
  onRemover,
  onEnterNaQuantidade,
}: {
  linha: LinhaForm;
  totalCents: number | null;
  editavel: boolean;
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
  return (
    <div role="row" className={cn(COLUNAS, "border-t border-muted")}>
      <span role="cell" className={cn(celula(), "font-bold tabular-nums text-muted-foreground")}>
        {linha.codigo ?? "—"}
      </span>
      <div role="cell" className={celula("flex-col items-start justify-center gap-1")}>
        <div className="flex w-full flex-wrap items-center gap-2 font-bold">
          {origem === "ajuste" ? <MarcaDaOrigem origem="ajuste" rotulo="Ajuste" /> : null}
          {linha.origem === "tabela" ? (
            <span>{linha.item}</span>
          ) : (
            <Input
              aria-label={origem === "ajuste" ? "Descrição do ajuste" : "Item avulso"}
              value={linha.descricao}
              onChange={muda("descricao")}
              maxLength={300}
              disabled={!editavel}
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
            maxLength={300}
            disabled={!editavel}
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
            disabled={!editavel}
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
            disabled={!editavel}
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
          disabled={!editavel}
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
            disabled={!editavel}
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
            className="size-8"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function Sugestoes({ itens, onAdicionar }: { itens: ItemDaTabela[]; onAdicionar: (item: ItemDaTabela) => void }) {
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
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-muted-foreground bg-card px-3 text-xs font-bold text-foreground hover:border-solid hover:bg-surface-hover"
        >
          <Plus className="size-3" aria-hidden="true" />
          {`${[item.codigo, item.servico].filter(Boolean).join(" ")} · ${formatarDecimal(item.preco, 2)}${item.unidade ? ` / ${item.unidade}` : ""}`}
        </button>
      ))}
    </div>
  );
}

function Itens({ form, onForm, acoes, catalogo, dados }: MontarViewProps) {
  const editavel = acoes.editavel;
  const contador = useRef(0);
  const [foco, setFoco] = useState<string | null>(null);
  const [sugestaoDe, setSugestaoDe] = useState<string | null>(null);
  const previa = previaDosTotais(form.linhas);
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const porId = new Map(lista.map((item) => [item.lpuItemId, item]));

  useEffect(() => {
    if (!foco) return;
    const campo = document.getElementById(idDaQuantidade(foco));
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
  const adicionar = (resultado: { linhas: LinhaForm[]; foco: string }) => {
    onForm((atual) => ({ ...atual, linhas: resultado.linhas }));
    setFoco(resultado.foco);
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
        <div role="table" aria-label="Itens do orçamento" className="min-w-[60rem]">
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
            desabilitado={!editavel}
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
            onClick={() =>
              adicionar({
                linhas: [...form.linhas, linhaAvulsa(novaChave())],
                foco: "",
              })
            }
          >
            <Plus aria-hidden="true" />
            Item avulso
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              adicionar({
                linhas: [...form.linhas, linhaDeAjuste(novaChave())],
                foco: "",
              })
            }
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

function Rodape({
  form,
  onForm,
  acoes,
  totais,
}: MontarViewProps & {
  totais: {
    subtotal: number | null;
    ajustes: number | null;
    total: number | null;
  };
}) {
  const desabilitado = !acoes.editavel;
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

/** Os totais que a tela mostra: os do servidor sem mudança; a prévia (lib/dominio) com mudança. */
function totaisDaTela(props: MontarViewProps) {
  if (!props.sujo) {
    return {
      subtotal: props.dados.subtotalCents,
      ajustes: props.dados.ajustesCents,
      total: props.dados.totalCents,
    };
  }
  const previa = previaDosTotais(props.form.linhas);
  if (!previa.completa) return { subtotal: null, ajustes: null, total: null };
  return {
    subtotal: previa.subtotalCents,
    ajustes: previa.ajustesCents,
    total: previa.totalCents,
  };
}

export function MontarView(props: MontarViewProps) {
  const totais = totaisDaTela(props);
  const { aviso, dados } = props;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <div className="flex flex-col items-start gap-3.5">
        <h1 className="text-3xl font-extrabold tracking-tight">Comercial</h1>
        <AbasDoComercial />
      </div>
      <Cabecalho {...props} totalCents={totais.total} />
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
      <div className="flex flex-col items-start gap-3.5">
        <h1 className="text-3xl font-extrabold tracking-tight">Comercial</h1>
        <AbasDoComercial />
      </div>
      <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">
        {texto}
      </p>
    </div>
  );
}
