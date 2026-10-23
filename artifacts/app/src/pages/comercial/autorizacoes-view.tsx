import type { ReactNode } from "react";
import { formatarReais } from "@workspace/dominio";
import { AlertTriangle, Check, Clock, FileText, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FILTROS_DE_IDADE,
  ROTULO_DO_FILTRO,
  conferenciaDoValor,
  contarPorFaixa,
  contratoDoPainel,
  gruposDaFila,
  linhasMarcadas,
  podeMarcar,
  rotulosDoTipo,
  somaDasLinhas,
  tipoDasLinhas,
  totalDasAutorizadas,
  type FiltroDeIdade,
  type FormAutorizacao,
  type LinhaAutorizada,
  type LinhaDaFila,
} from "@/lib/comercial/autorizacoes";
import type { Carga } from "@/lib/comercial/clientes";
import type { Contrato } from "@/lib/comercial/contratos";
import { cn } from "@/lib/utils";

/**
 * Aba Autorizações do Comercial (docs/mockups/ComAutorizacoes.dc.html), só a
 * apresentação: os dados e as ações chegam por props
 * (pages/comercial/autorizacoes.tsx). Conteúdo na identidade v3 (.v3 em
 * index.css) dentro do layout de hoje. Sem legenda: rótulos, dados e ações;
 * uma ação principal, "Registrar autorização".
 */

export type AcoesDasAutorizacoes = {
  filtrar: (filtro: FiltroDeIdade) => void;
  buscar: (texto: string) => void;
  abrirPainel: () => void;
  fecharPainel: () => void;
  /** Marca ou desmarca a demanda na autorização. */
  marcar: (numero: string) => void;
  editar: <K extends keyof FormAutorizacao>(campo: K, valor: FormAutorizacao[K]) => void;
  registrar: () => void;
  cancelarAutorizacao: (id: string) => void;
};

export type PainelDaAutorizacao = {
  aberto: boolean;
  /** Números das demandas marcadas. */
  marcadas: string[];
  form: FormAutorizacao;
  /** A confirmação do último registro. */
  resultado: string | null;
  erro: string | null;
};

export type AutorizacoesViewProps = {
  estado: "carregando" | "erro" | "pronto";
  /** A fila inteira (linhasDaFila); o filtro e a busca se aplicam aqui. */
  linhas: LinhaDaFila[];
  filtro: FiltroDeIdade;
  busca: string;
  painel: PainelDaAutorizacao;
  /** Contratos (`contracts`): a vigência e o código de serviço do painel. */
  contratos: Contrato[];
  /** As autorizadas a faturar (autorizadasAFaturar), já com a busca. */
  autorizadas: Carga<LinhaAutorizada>;
  /** "AAAA-MM-DD" do dia: o limite do campo "Recebida em". */
  hoje: string;
  /** Uma gravação em andamento: as ações esperam. */
  ocupado: boolean;
  acoes: AcoesDasAutorizacoes;
  /** Telas do Comercial que já existem (barra de abas); o padrão é a do app. */
  telas?: readonly string[];
};

const TOM_ATRASADA = "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
const TOM_ESPERANDO = "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
const TOM_OK = "border-success-soft-border bg-success-soft text-success-soft-foreground";

const ROTULO_DE_CAMPO = "block text-xs font-bold text-muted-foreground";

/** Centavos em reais; o valor ainda não lido aparece como traço. */
function reais(centavos: number | null): string {
  return centavos === null ? "—" : formatarReais(centavos);
}

function textoDosDias(dias: number): string {
  if (dias === 0) return "hoje";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

function Contador({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}

/** Conferência e confirmação: verde quando confere, âmbar quando diverge. */
function Caixa({ tom, children }: { tom: "ok" | "diverge"; children: ReactNode }) {
  const Icone = tom === "ok" ? Check : AlertTriangle;
  return (
    <div role="status" className={cn("flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-bold", tom === "ok" ? TOM_OK : TOM_ESPERANDO)}>
      <Icone aria-hidden="true" className="size-4.5 shrink-0" />
      {children}
    </div>
  );
}

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className={ROTULO_DE_CAMPO}>
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

// --- Fila ----------------------------------------------------------------------------------

function Linha({
  linha,
  primeira,
  marcando,
  marcada,
  cabe,
  onMarcar,
}: {
  linha: LinhaDaFila;
  primeira: boolean;
  marcando: boolean;
  marcada: boolean;
  cabe: boolean;
  onMarcar: (numero: string) => void;
}) {
  return (
    <div className={cn("flex items-start gap-3.5 px-5 py-3.5", !primeira && "border-t border-muted", marcada && "bg-info-soft")}>
      {marcando ? (
        cabe ? (
          <Checkbox checked={marcada} onCheckedChange={() => onMarcar(linha.numero)} aria-label={`Incluir ${linha.rotulo}`} className="mt-1 size-4.5" />
        ) : (
          <span aria-hidden="true" className="w-4.5 shrink-0" />
        )
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-extrabold tabular-nums">
          {linha.rotulo}
          {linha.legado ? <Pill>{linha.legado}</Pill> : null}
        </span>
        {linha.titulo ? <span className="text-sm font-bold">{linha.titulo}</span> : null}
        {linha.detalhe ? <span className="text-xs font-semibold text-muted-foreground">{linha.detalhe}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-base font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
        {linha.dias !== null ? (
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold",
              linha.atrasada ? TOM_ATRASADA : TOM_ESPERANDO,
            )}
          >
            <Clock aria-hidden="true" className="size-3.5" />
            {textoDosDias(linha.dias)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Fila({ estado, linhas, filtro, busca, painel, acoes, marcando }: AutorizacoesViewProps & { marcando: boolean }) {
  const contagem = contarPorFaixa(linhas, busca);
  const grupos = gruposDaFila(linhas, filtro, busca);
  const marcadas = linhasMarcadas(linhas, painel.marcadas);
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar a fila.</Vazio>;
  else if (!linhas.length) conteudo = <Vazio>Nenhum executado aguardando autorização</Vazio>;
  else if (!grupos.length) conteudo = <Vazio>{busca.trim() ? "Nenhum executado encontrado" : "Nenhum executado nesta faixa"}</Vazio>;
  else {
    conteudo = grupos.map((grupo, indice) => (
      <div key={grupo.customerCode} role="group" aria-label={grupo.cliente} className={cn(indice > 0 && "border-t border-border")}>
        <div className="flex items-center gap-2.5 border-b border-border bg-background px-5 py-2.5">
          <h3 className="text-xs font-extrabold uppercase tracking-wider">{grupo.cliente}</h3>
          <Contador>{grupo.linhas.length}</Contador>
          <span className="ml-auto text-sm font-extrabold tabular-nums">{reais(grupo.totalCents)}</span>
        </div>
        {grupo.linhas.map((linha, posicao) => (
          <Linha
            key={linha.numero}
            linha={linha}
            primeira={posicao === 0}
            marcando={marcando}
            marcada={painel.marcadas.includes(linha.numero)}
            cabe={podeMarcar(linha, marcadas)}
            onMarcar={acoes.marcar}
          />
        ))}
      </div>
    ));
  }
  return (
    <section aria-label="Executados aguardando autorização" className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border px-5 py-3.5">
        <h2 className="text-base font-extrabold">Executados aguardando autorização</h2>
        <Contador>{contagem.todas}</Contador>
        <div role="group" aria-label="Dias desde a execução" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-1 sm:ml-auto">
          {FILTROS_DE_IDADE.map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={opcao === filtro}
              onClick={() => acoes.filtrar(opcao)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-bold transition-colors",
                opcao === filtro ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {ROTULO_DO_FILTRO[opcao]}
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">{contagem[opcao]}</span>
            </button>
          ))}
        </div>
      </div>
      {conteudo}
    </section>
  );
}

// --- Painel --------------------------------------------------------------------------------

function Painel({ linhas, painel, contratos, hoje, ocupado, acoes }: AutorizacoesViewProps) {
  const marcadas = linhasMarcadas(linhas, painel.marcadas);
  const primeira = marcadas[0] ?? null;
  const rotulos = rotulosDoTipo(tipoDasLinhas(marcadas));
  const contrato = primeira ? contratoDoPainel(contratos.find((item) => item.id === primeira.contratoId) ?? null) : null;
  const form = painel.form;
  const codigo = form.codigoServico ?? contrato?.codigoServico ?? "";
  const soma = somaDasLinhas(marcadas);
  const conferencia = conferenciaDoValor(form.valor, soma);
  const campo =
    <K extends keyof FormAutorizacao>(nome: K) =>
    (evento: { target: { value: string } }) =>
      acoes.editar(nome, evento.target.value as FormAutorizacao[K]);

  return (
    <section
      aria-label="Registrar autorização de faturamento"
      className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0"
    >
      <div className="flex items-center gap-2.5">
        <h2 className="text-base font-extrabold">Registrar autorização de faturamento</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar" className="ml-auto size-8" onClick={acoes.fecharPainel} disabled={ocupado}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {painel.resultado ? <Caixa tom="ok">{painel.resultado}</Caixa> : null}

      {primeira && contrato ? (
        <div className="min-w-0 space-y-1.5">
          <span className={ROTULO_DE_CAMPO}>Cliente</span>
          <div className="flex min-h-10 flex-wrap items-center gap-x-2.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-bold">
            {primeira.cliente}
            <span className="ml-auto text-xs font-semibold text-muted-foreground">{contrato.vigencia}</span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3.5">
        <Campo id="aut-pedido" rotulo={rotulos.pedido} className={rotulos.aceite ? undefined : "col-span-2"}>
          <Input id="aut-pedido" autoComplete="off" value={form.pedido} onChange={campo("pedido")} disabled={ocupado} />
        </Campo>
        {rotulos.aceite ? (
          <Campo id="aut-aceite" rotulo={rotulos.aceite}>
            <Input id="aut-aceite" autoComplete="off" value={form.aceite} onChange={campo("aceite")} disabled={ocupado} />
          </Campo>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <Campo id="aut-recebida" rotulo="Recebida em">
          <Input id="aut-recebida" type="date" max={hoje} value={form.recebidaEm} onChange={campo("recebidaEm")} disabled={ocupado} />
        </Campo>
        <Campo id="aut-valor" rotulo={rotulos.valor}>
          <Input id="aut-valor" inputMode="decimal" className="text-right tabular-nums" value={form.valor} onChange={campo("valor")} disabled={ocupado} />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <Campo id="aut-tomador" rotulo="Tomador · CNPJ">
          <Input id="aut-tomador" placeholder="00.000.000/0000-00" value={form.tomador} onChange={campo("tomador")} disabled={ocupado} />
        </Campo>
        <Campo id="aut-cc" rotulo="Centro de custo">
          <Input id="aut-cc" value={form.centroCusto} onChange={campo("centroCusto")} disabled={ocupado} />
        </Campo>
      </div>
      <Campo id="aut-codigo" rotulo="Código de serviço">
        <Input id="aut-codigo" inputMode="numeric" value={codigo} onChange={campo("codigoServico")} disabled={ocupado} />
      </Campo>
      <Campo id="aut-escopo" rotulo="Escopo">
        <Textarea id="aut-escopo" rows={2} value={form.escopo} onChange={campo("escopo")} disabled={ocupado} />
      </Campo>
      <div className="grid grid-cols-2 gap-3.5">
        <Campo id="aut-doc" rotulo="Documento">
          <Input id="aut-doc" value={form.documentoNome} onChange={campo("documentoNome")} disabled={ocupado} />
        </Campo>
        <Campo id="aut-doc-ref" rotulo="Link ou pasta">
          <Input id="aut-doc-ref" value={form.documentoReferencia} onChange={campo("documentoReferencia")} disabled={ocupado} />
        </Campo>
      </div>

      <div aria-hidden="true" className="h-px bg-muted" />
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Demandas</h3>
        <Pill>{marcadas.length}</Pill>
      </div>
      {marcadas.map((linha) => (
        <div key={linha.numero} className="flex items-center gap-2.5 rounded-md border border-border py-2 pl-3 pr-1.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <b className="text-sm font-extrabold tabular-nums">{linha.rotulo}</b>
            {linha.titulo ? <span className="truncate text-xs font-semibold text-muted-foreground">{linha.titulo}</span> : null}
          </div>
          <span className="text-sm font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Tirar ${linha.rotulo}`}
            className="size-8"
            onClick={() => acoes.marcar(linha.numero)}
            disabled={ocupado}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-muted-foreground">Soma das RVs</span>
        <b className="font-extrabold tabular-nums">{reais(soma)}</b>
      </div>
      {conferencia ? <Caixa tom={conferencia.tom}>{conferencia.texto}</Caixa> : null}
      {painel.erro ? (
        <p role="alert" className="text-sm font-bold text-destructive">
          {painel.erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" onClick={acoes.registrar} disabled={ocupado || marcadas.length === 0}>
          <Check aria-hidden="true" />
          Registrar autorização
        </Button>
        <Button type="button" variant="outline" onClick={acoes.fecharPainel} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

// --- Autorizadas, a faturar ----------------------------------------------------------------

function Autorizadas({ autorizadas, ocupado, acoes }: AutorizacoesViewProps) {
  const lista = Array.isArray(autorizadas) ? autorizadas : null;
  let conteudo: ReactNode;
  if (autorizadas === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (autorizadas === "erro") conteudo = <Vazio>Não foi possível carregar as autorizações.</Vazio>;
  else if (!lista?.length) conteudo = <Vazio>Nenhuma autorização a faturar</Vazio>;
  else {
    conteudo = lista.map((linha, indice) => (
      <div key={linha.id} className={cn("flex flex-wrap items-center gap-x-4.5 gap-y-2.5 px-5 py-4", indice > 0 && "border-t border-muted")}>
        <div className="flex w-44 shrink-0 flex-col">
          <span className="text-base font-extrabold tabular-nums">{linha.pedido}</span>
          <span className="text-xs font-semibold text-muted-foreground">{linha.sub}</span>
        </div>
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <span className="text-sm font-bold">{linha.cliente}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {linha.demandas.map((rotulo) => (
              <Pill key={rotulo}>{rotulo}</Pill>
            ))}
            {linha.marcas.map((marca) => (
              <span key={marca} className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM_ESPERANDO)}>
                {marca}
              </span>
            ))}
            {linha.info ? <span className="text-xs font-semibold text-muted-foreground">{linha.info}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end sm:w-48">
          <span className="text-base font-extrabold tabular-nums">{reais(linha.valorCents)}</span>
          {linha.quando ? <span className="text-xs font-semibold text-muted-foreground">{linha.quando}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM_OK)}>
            <FileText aria-hidden="true" className="size-3.5" />A faturar
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => acoes.cancelarAutorizacao(linha.id)} disabled={ocupado}>
            Cancelar
          </Button>
        </div>
      </div>
    ));
  }
  return (
    <section aria-label="Autorizadas, a faturar" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-background px-5 py-2.5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Autorizadas · a faturar</h2>
        {lista ? <Contador>{lista.length}</Contador> : null}
        {lista ? <span className="ml-auto text-sm font-extrabold tabular-nums">{formatarReais(totalDasAutorizadas(lista))}</span> : null}
      </div>
      {conteudo}
    </section>
  );
}

// --- Tela ----------------------------------------------------------------------------------

export function AutorizacoesView(props: AutorizacoesViewProps) {
  const { estado, linhas, busca, painel, ocupado, acoes, telas } = props;
  const temFila = estado === "pronto" && linhas.length > 0;
  const painelAberto = painel.aberto && temFila;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Autorizações</h1>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:ml-auto md:w-auto">
          <label className="relative block min-w-0 flex-1 md:w-72 md:flex-none">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Buscar"
              placeholder="Buscar pedido, aceite ou demanda"
              value={busca}
              onChange={(evento) => acoes.buscar(evento.target.value)}
              className="pl-9"
            />
          </label>
          {temFila && !painel.aberto ? (
            <Button type="button" variant="outline" onClick={acoes.abrirPainel} disabled={ocupado}>
              <Plus aria-hidden="true" />
              Nova autorização
            </Button>
          ) : null}
        </div>
      </header>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <Fila {...props} marcando={painelAberto} />
        {painelAberto ? <Painel {...props} /> : null}
      </div>
      {!painelAberto && painel.resultado ? <Caixa tom="ok">{painel.resultado}</Caixa> : null}
      <Autorizadas {...props} />
    </div>
  );
}
