import type { ReactNode } from "react";
import { alertasDoContrato, type TipoAlerta } from "@workspace/dominio";
import { CalendarX, Clock, FileText, FolderOpen, Pencil, Plus, RefreshCw, Table2, TrendingUp, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dataBr, type CadastroComercial, type Carga } from "@/lib/comercial/clientes";
import {
  aditivosEmOrdem,
  condicoesDoContrato,
  contarFiltros,
  linhaDoAditivo,
  linkDoDocumento,
  listaDeContratos,
  nomesDosClientes,
  numerosDoContrato,
  periodoDaTabela,
  seloDoContrato,
  situacaoDaTabela,
  tabelasEmOrdem,
  textoDoAlerta,
  ultimoAditivo,
  vigenciaDoContrato,
  type Aditivo,
  type Contrato,
  type FiltroDaLista,
  type SeloDoContrato,
  type TabelaDoContrato,
  type TomDoSelo,
} from "@/lib/comercial/contratos";
import { cn } from "@/lib/utils";

/**
 * Aba Contratos do Comercial (docs/mockups/ComContrato.dc.html), só a
 * apresentação: os dados e as ações chegam por props (pages/comercial/contratos.tsx).
 * Conteúdo na identidade v3 (.v3 em index.css) dentro do layout de hoje. Sem
 * legenda: rótulos, dados e ações; uma ação principal, "Registrar aditivo".
 */

export type AcoesDosContratos = {
  novoContrato: () => void;
  editar: () => void;
  registrarAditivo: () => void;
};

export type ContratosViewProps = {
  estado: "carregando" | "erro" | "pronto";
  contratos: Contrato[];
  /** Cadastro (`customers`): nome e razão social do cliente de cada contrato. */
  clientes: CadastroComercial[];
  /** "AAAA-MM-DD" do dia. */
  hoje: string;
  filtro: FiltroDaLista;
  onFiltro: (filtro: FiltroDaLista) => void;
  selecionado: Contrato | null;
  onSelecionar: (id: string) => void;
  tabelas: Carga<TabelaDoContrato>;
  aditivos: Carga<Aditivo>;
  /** Uma gravação em andamento: as ações esperam. */
  ocupado: boolean;
  acoes: AcoesDosContratos;
  /** Telas do Comercial que já existem (barra de abas); o padrão é a do app. */
  telas?: readonly string[];
};

const TOM: Record<TomDoSelo, string> = {
  ok: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  atencao: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  critico: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  neutro: "border-border bg-muted text-muted-foreground",
};

function Selo({ selo }: { selo: SeloDoContrato }) {
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM[selo.tom])}>
      {selo.rotulo}
    </span>
  );
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
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}

/** Carregando ou erro no lugar da lista: a tela não afirma vazio sem ter lido. */
function SemLeitura({ carga }: { carga: "carregando" | "erro" }) {
  return <Vazio>{carga === "erro" ? "Não foi possível carregar." : "Carregando..."}</Vazio>;
}

function Rotulo({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{children}</span>;
}

function CabecalhoDoCartao({ icone, titulo, contagem, children }: { icone: ReactNode; titulo: string; contagem?: number; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        {icone}
      </span>
      <h3 className="text-sm font-extrabold uppercase tracking-wider">{titulo}</h3>
      {contagem === undefined ? null : <Contador>{contagem}</Contador>}
      {children ? <span className="ml-auto">{children}</span> : null}
    </div>
  );
}

// --- Lista -------------------------------------------------------------------------------

const ROTULO_DO_FILTRO: Record<FiltroDaLista, string> = { vigentes: "Vigentes", encerrados: "Encerrados" };

function Lista(props: ContratosViewProps) {
  const { estado, contratos, clientes, hoje, filtro, onFiltro, selecionado, onSelecionar, ocupado, acoes } = props;
  const contagem = contarFiltros(contratos);
  const outro: FiltroDaLista = filtro === "vigentes" ? "encerrados" : "vigentes";
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar os contratos.</Vazio>;
  else {
    const itens = listaDeContratos(contratos, nomesDosClientes(clientes), filtro, hoje);
    conteudo = itens.length ? (
      itens.map((item) => {
        const ativo = item.contrato.id === selecionado?.id;
        return (
          <button
            key={item.contrato.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => onSelecionar(item.contrato.id)}
            className={cn(
              "flex w-full flex-col gap-1 border-l-4 border-t border-t-muted py-3 pl-4 pr-5 text-left transition-colors",
              ativo ? "border-l-foreground bg-background" : "border-l-transparent bg-card hover:bg-surface-hover",
            )}
          >
            <span className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-extrabold">{item.cliente}</span>
              <Selo selo={item.selo} />
            </span>
            <span className="block text-xs font-semibold text-muted-foreground">
              {item.contrato.dados.nome} · {item.vencimento}
            </span>
          </button>
        );
      })
    ) : (
      <Vazio>{filtro === "vigentes" ? "Nenhum contrato vigente" : "Nenhum contrato encerrado"}</Vazio>
    );
  }
  return (
    <section
      aria-label={`Contratos ${ROTULO_DO_FILTRO[filtro].toLocaleLowerCase("pt-BR")}`}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-80 xl:shrink-0 xl:overflow-y-auto"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <FileText className="size-4" />
        </span>
        <h2 className="text-sm font-extrabold uppercase tracking-wider">{ROTULO_DO_FILTRO[filtro]}</h2>
        <Contador>{contagem[filtro]}</Contador>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={acoes.novoContrato} disabled={ocupado}>
          <Plus aria-hidden="true" />
          Novo contrato
        </Button>
      </div>
      <div className="[&>button:first-child]:border-t-0">{conteudo}</div>
      {estado === "pronto" ? (
        <button
          type="button"
          onClick={() => onFiltro(outro)}
          className="flex w-full items-center justify-between gap-2 border-t border-border px-5 py-3 text-left text-sm font-bold text-foreground underline-offset-4 transition-colors hover:bg-surface-hover hover:underline"
        >
          {ROTULO_DO_FILTRO[outro]}
          <Pill>{contagem[outro]}</Pill>
        </button>
      ) : null}
    </section>
  );
}

// --- Ficha -------------------------------------------------------------------------------

function Marcador({ posicao, children, className }: { posicao: number; children: ReactNode; className?: string }) {
  // Perto das pontas, o rótulo encosta na borda em vez de sair da barra.
  const alinhamento = posicao < 15 ? "translate-x-0" : posicao > 85 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <span className={cn("absolute top-0 whitespace-nowrap text-xs font-bold", alinhamento, className)} style={{ left: `${posicao}%` }}>
      {children}
    </span>
  );
}

function Vigencia({ contrato, hoje }: { contrato: Contrato; hoje: string }) {
  const vigencia = vigenciaDoContrato(contrato.dados, hoje);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Rotulo>Vigência</Rotulo>
        <b className="text-base font-extrabold tabular-nums">{vigencia.periodo}</b>
        <span className="text-base font-extrabold @md:ml-auto">{vigencia.restante}</span>
      </div>
      {vigencia.hoje === null ? null : (
        <>
          <div className="relative mt-3 h-2.5 rounded-full bg-muted" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${vigencia.hoje}%` }} />
            {vigencia.renovacao ? (
              <span
                className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-sm bg-warning-soft-foreground"
                style={{ left: `${vigencia.renovacao.posicao}%` }}
              />
            ) : null}
            <span
              className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-4 border-foreground bg-card"
              style={{ left: `${vigencia.hoje}%` }}
            />
          </div>
          <div className="relative mt-2 h-5">
            <Marcador posicao={vigencia.hoje}>Hoje · {dataBr(hoje).slice(0, 5)}</Marcador>
          </div>
          {vigencia.renovacao ? (
            <div className="relative h-5">
              <Marcador posicao={vigencia.renovacao.posicao} className="text-warning-soft-foreground">
                {vigencia.renovacao.rotulo} · {dataBr(vigencia.renovacao.data)}
              </Marcador>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Cabecalho({ contrato, cliente, aditivos, hoje, ocupado, acoes }: {
  contrato: Contrato;
  cliente: CadastroComercial | null;
  aditivos: Carga<Aditivo>;
  hoje: string;
  ocupado: boolean;
  acoes: AcoesDosContratos;
}) {
  const ultimo = Array.isArray(aditivos) ? ultimoAditivo(aditivos) : null;
  const { ordem: _ordem, dias: _dias, ...selo } = seloDoContrato(contrato.dados, hoje);
  return (
    <section aria-label={`Contrato ${contrato.dados.nome}`} className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
          <span className="text-sm font-bold text-muted-foreground">
            {cliente?.razaoSocial ?? cliente?.nome ?? contrato.dados.customer_code}
          </span>
          <h2 className="text-2xl font-extrabold tracking-tight">{contrato.dados.nome}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <Selo selo={selo} />
            {numerosDoContrato(contrato.dados, cliente?.nome).map((numero) => (
              <Pill key={numero}>{numero}</Pill>
            ))}
            {ultimo ? <Pill>Aditivo {ultimo.numero}</Pill> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={acoes.editar} disabled={ocupado}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
          {/* O número do aditivo sai do histórico: espera os aditivos serem lidos. */}
          <Button type="button" onClick={acoes.registrarAditivo} disabled={ocupado || !Array.isArray(aditivos)}>
            <Plus aria-hidden="true" />
            Registrar aditivo
          </Button>
        </div>
      </div>
      {contrato.dados.objeto ? (
        <div>
          <Rotulo>Objeto</Rotulo>
          <p className="mt-1 text-sm font-semibold">{contrato.dados.objeto}</p>
        </div>
      ) : null}
      <Vigencia contrato={contrato} hoje={hoje} />
    </section>
  );
}

const ICONE_DO_ALERTA: Record<TipoAlerta, LucideIcon> = {
  renovacao: RefreshCw,
  fim_vigencia: CalendarX,
  reajuste: TrendingUp,
};

function Alertas({ contrato, hoje }: { contrato: Contrato; hoje: string }) {
  const alertas = alertasDoContrato(contrato.dados, hoje);
  if (!alertas.length) return null;
  return (
    <section aria-label="Alertas" className="grid gap-3 @xl:grid-cols-2">
      {alertas.map((alerta) => {
        const texto = textoDoAlerta(alerta, contrato.dados);
        const Icone = ICONE_DO_ALERTA[alerta.tipo];
        return (
          <div key={`${alerta.tipo}-${alerta.data}`} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", TOM[texto.tom])}>
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card">
              <Icone className="size-4" />
            </span>
            <span className="min-w-0">
              <b className="block text-sm font-extrabold">{texto.titulo}</b>
              <span className="block text-xs font-bold">{texto.quando}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function Condicoes({ contrato, hoje }: { contrato: Contrato; hoje: string }) {
  const { campos, pagamento } = condicoesDoContrato(contrato.dados, hoje);
  return (
    <section aria-label="Condições" className="overflow-hidden rounded-lg border border-border bg-card">
      <CabecalhoDoCartao icone={<FileText className="size-4" />} titulo="Condições" />
      <dl className="grid gap-x-7 gap-y-4 p-5 @lg:grid-cols-2">
        {campos.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{rotulo}</dt>
            <dd className="mt-0.5 break-words text-sm font-bold">{valor}</dd>
          </div>
        ))}
      </dl>
      <div className="px-5 pb-5">
        <Rotulo>Pagamento</Rotulo>
        {pagamento.faixas.length ? (
          <div className="mt-2 grid gap-2.5 @2xl:grid-cols-3">
            {pagamento.faixas.map((faixa) => (
              <div key={faixa.quando} className="rounded-lg border border-border bg-background px-3.5 py-3">
                <span className="block text-xs font-bold text-muted-foreground">{faixa.quando}</span>
                <b className="block text-sm font-extrabold">{faixa.paga}</b>
              </div>
            ))}
          </div>
        ) : null}
        {pagamento.regra ? <p className="mt-1 text-sm font-bold">{pagamento.regra}</p> : null}
        {pagamento.previsto ? (
          <p className="mt-3 text-sm font-semibold text-muted-foreground">
            NF recebida hoje · <b className="font-extrabold text-foreground">paga em {pagamento.previsto}</b>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Tabelas({ tabelas, hoje }: { tabelas: Carga<TabelaDoContrato>; hoje: string }) {
  return (
    <section aria-label="Tabelas de preço" className="overflow-hidden rounded-lg border border-border bg-card">
      <CabecalhoDoCartao
        icone={<Table2 className="size-4" />}
        titulo="Tabelas de preço"
        contagem={Array.isArray(tabelas) ? tabelas.length : undefined}
      />
      {!Array.isArray(tabelas) ? (
        <SemLeitura carga={tabelas} />
      ) : tabelas.length === 0 ? (
        <Vazio>Nenhuma tabela</Vazio>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-background text-left text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                <th className="whitespace-nowrap border-b border-border px-5 py-2.5">Tabela</th>
                <th className="whitespace-nowrap border-b border-border px-3 py-2.5">Variante</th>
                <th className="whitespace-nowrap border-b border-border px-3 py-2.5">Situação</th>
                <th className="whitespace-nowrap border-b border-border px-3 py-2.5 text-right">Itens</th>
                <th className="whitespace-nowrap border-b border-border px-5 py-2.5">Vigência</th>
              </tr>
            </thead>
            <tbody>
              {tabelasEmOrdem(tabelas, hoje).map((tabela) => {
                const { ordem: _ordem, ...situacao } = situacaoDaTabela(tabela, hoje);
                const encerrada = situacao.tom === "neutro";
                return (
                  <tr key={tabela.id} className="border-b border-muted last:border-b-0">
                    <td className={cn("whitespace-nowrap px-5 py-3 font-extrabold", encerrada && "text-muted-foreground")}>{tabela.nome}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold">{tabela.variante || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Selo selo={situacao} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{tabela.itens}</td>
                    <td className={cn("whitespace-nowrap px-5 py-3 font-semibold", encerrada && "text-muted-foreground")}>
                      {periodoDaTabela(tabela)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Aditivos({ aditivos }: { aditivos: Carga<Aditivo> }) {
  return (
    <section aria-label="Aditivos" className="min-w-0 flex-1 basis-80 overflow-hidden rounded-lg border border-border bg-card">
      <CabecalhoDoCartao
        icone={<Clock className="size-4" />}
        titulo="Aditivos"
        contagem={Array.isArray(aditivos) ? aditivos.length : undefined}
      />
      {!Array.isArray(aditivos) ? (
        <SemLeitura carga={aditivos} />
      ) : aditivos.length === 0 ? (
        <Vazio>Nenhum aditivo</Vazio>
      ) : (
        <ol className="px-5 py-4">
          {aditivosEmOrdem(aditivos).map((aditivo, index, todos) => {
            const linha = linhaDoAditivo(aditivo);
            return (
              <li key={aditivo.id} className="relative pb-4 pl-7 last:pb-0">
                {index < todos.length - 1 ? (
                  <span aria-hidden="true" className="absolute bottom-0 left-1.5 top-5 w-0.5 bg-border" />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-0 top-1 size-3.5 rounded-full border-2",
                    index === 0 ? "border-foreground bg-foreground" : "border-muted-foreground bg-card",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm font-extrabold">{linha.titulo}</b>
                  <Pill>{linha.tipo}</Pill>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs font-semibold">
                  <span className="text-muted-foreground">{linha.detalhes.join(" · ")}</span>
                  {linha.documento?.href ? (
                    <a
                      href={linha.documento.href}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-bold text-foreground underline underline-offset-4"
                    >
                      {linha.documento.nome}
                    </a>
                  ) : linha.documento ? (
                    <span className="break-all text-muted-foreground">{linha.documento.nome}</span>
                  ) : null}
                </div>
                {linha.observacao ? <p className="mt-0.5 text-xs font-semibold">{linha.observacao}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Documentos({ contrato }: { contrato: Contrato }) {
  const documentos = contrato.dados.documentos;
  return (
    <section aria-label="Documentos" className="min-w-0 flex-1 basis-80 overflow-hidden rounded-lg border border-border bg-card">
      <CabecalhoDoCartao icone={<FolderOpen className="size-4" />} titulo="Documentos" contagem={documentos.length} />
      {documentos.length === 0 ? (
        <Vazio>Nenhum documento</Vazio>
      ) : (
        <ul>
          {documentos.map((documento) => (
            <li key={`${documento.nome}-${documento.referencia}`} className="flex items-center gap-3 border-t border-muted px-5 py-3 first:border-t-0">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive-soft text-destructive-soft-foreground">
                <FileText className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-sm font-bold">{documento.nome}</b>
                {linkDoDocumento(documento.referencia) ? (
                  <a
                    href={documento.referencia}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all text-xs font-semibold text-foreground underline underline-offset-4"
                  >
                    {documento.referencia}
                  </a>
                ) : (
                  <span className="block break-all text-xs font-semibold text-muted-foreground">{documento.referencia}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Ficha(props: ContratosViewProps & { selecionado: Contrato }) {
  const { selecionado: contrato, clientes, hoje, tabelas, aditivos, ocupado, acoes } = props;
  const cliente = clientes.find((cadastro) => cadastro.code === contrato.dados.customer_code) ?? null;
  return (
    // @container: as grades da ficha seguem a largura dela (com o menu do app ao lado), não a da janela.
    <div aria-label="Ficha do contrato" role="region" className="@container flex min-w-0 flex-1 flex-col gap-5">
      <Cabecalho contrato={contrato} cliente={cliente} aditivos={aditivos} hoje={hoje} ocupado={ocupado} acoes={acoes} />
      <Alertas contrato={contrato} hoje={hoje} />
      <Condicoes contrato={contrato} hoje={hoje} />
      <Tabelas tabelas={tabelas} hoje={hoje} />
      <div className="flex flex-wrap items-start gap-5">
        <Aditivos aditivos={aditivos} />
        <Documentos contrato={contrato} />
      </div>
    </div>
  );
}

export function ContratosView(props: ContratosViewProps) {
  const { estado, selecionado, telas } = props;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Contratos</h1>
      </header>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <Lista {...props} />
        {estado === "pronto" && selecionado ? <Ficha {...props} selecionado={selecionado} /> : null}
      </div>
    </div>
  );
}
