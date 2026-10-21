import type { ReactNode } from "react";
import { Link } from "wouter";
import { Box, FileText, Pencil, Plus, Search, Target, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SEGMENTOS,
  cidadeUf,
  contarSegmentos,
  contratoVigente,
  contratosDoCliente,
  enderecoEmLinha,
  filtrarCadastros,
  formatarCnpj,
  formatarTelefone,
  gruposDeContatos,
  iniciais,
  ordenarLocais,
  rotuloDoContrato,
  situacaoDoContrato,
  vigenciaDoContrato,
  type CadastroComercial,
  type ContatoResumo,
  type ContratoResumo,
  type LocalResumo,
  type Segmento,
} from "@/lib/comercial/clientes";
import { hrefDoContrato } from "@/lib/comercial/navegacao";
import { cn } from "@/lib/utils";

/**
 * Clientes e prospects do Comercial (docs/mockups/ComClientes.dc.html), só a
 * apresentação: os dados e as ações chegam por props (pages/comercial/clientes.tsx).
 * Conteúdo na identidade v3 (.v3 em index.css) dentro do layout de hoje.
 * Sem legenda: rótulos, dados e ações; uma ação principal, "Novo prospect".
 */

export type FichaAba = "dados" | "locais" | "contatos" | "contratos";

export type AcoesDaTela = {
  novoProspect: () => void;
  editar: () => void;
  marcarCliente: () => void;
  novoLocal: () => void;
  editarLocal: (local: LocalResumo) => void;
  alternarLocal: (local: LocalResumo) => void;
  novoContato: () => void;
  editarContato: (contato: ContatoResumo) => void;
  alternarContato: (contato: ContatoResumo) => void;
};

export type ClientesViewProps = {
  estado: "carregando" | "erro" | "pronto";
  cadastros: CadastroComercial[];
  contratos: ContratoResumo[];
  /** "AAAA-MM-DD" do dia, para o contrato vigente. */
  hoje: string;
  segmento: Segmento;
  onSegmento: (segmento: Segmento) => void;
  busca: string;
  onBusca: (busca: string) => void;
  selecionado: CadastroComercial | null;
  onSelecionar: (id: string) => void;
  aba: FichaAba;
  onAba: (aba: FichaAba) => void;
  /** null: ainda carregando. */
  locais: LocalResumo[] | null;
  contatos: ContatoResumo[] | null;
  responsavel: string | null;
  /** Uma gravação em andamento: as ações esperam. */
  ocupado: boolean;
  acoes: AcoesDaTela;
};

const ROTULO_DO_SEGMENTO: Record<Segmento, string> = {
  todos: "Todos",
  clientes: "Clientes",
  prospects: "Prospects",
};

const ABAS_DA_FICHA: Array<{ id: FichaAba; rotulo: string }> = [
  { id: "dados", rotulo: "Dados" },
  { id: "locais", rotulo: "Locais" },
  { id: "contatos", rotulo: "Contatos" },
  { id: "contratos", rotulo: "Contratos" },
];

function Contador({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold text-foreground">
      {children}
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

function SeloProspect() {
  return (
    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-muted-foreground bg-card px-2 text-xs font-bold text-foreground">
      <Target className="size-3" aria-hidden="true" />
      Prospect
    </span>
  );
}

function SeloArmazenagem() {
  return (
    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-foreground bg-foreground px-2 text-xs font-bold text-background">
      <Box className="size-3" aria-hidden="true" />
      Armazenagem
    </span>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}

// --- Cabeçalho e lista -------------------------------------------------------------

function Cabecalho({ cadastros, segmento, onSegmento, busca, onBusca, ocupado, acoes }: ClientesViewProps) {
  const contagem = contarSegmentos(cadastros);
  return (
    <header className="flex flex-wrap items-center gap-4">
      <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Clientes</h1>
      <div role="group" aria-label="Filtrar cadastro" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-1">
        {SEGMENTOS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={segmento === item}
            onClick={() => onSegmento(item)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-bold transition-colors sm:gap-2 sm:px-3.5",
              segmento === item
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {ROTULO_DO_SEGMENTO[item]}
            <Contador>{contagem[item]}</Contador>
          </button>
        ))}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto">
        <label className="relative block min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar por nome ou CNPJ"
            placeholder="Nome ou CNPJ"
            value={busca}
            onChange={(event) => onBusca(event.target.value)}
            className="w-full pl-9 sm:w-72"
          />
        </label>
        <Button type="button" onClick={acoes.novoProspect} disabled={ocupado}>
          <Plus aria-hidden="true" />
          Novo prospect
        </Button>
      </div>
    </header>
  );
}

function LinhaDoCadastro({
  cadastro,
  contrato,
  ativo,
  onSelecionar,
}: {
  cadastro: CadastroComercial;
  contrato: ContratoResumo | null;
  ativo: boolean;
  onSelecionar: (id: string) => void;
}) {
  const detalhe = [cidadeUf(cadastro.cidade, cadastro.uf), rotuloDoContrato(contrato)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => onSelecionar(cadastro.id)}
      className={cn(
        "flex w-full items-center gap-3 border-l-4 border-t border-t-muted py-3 pl-3 pr-4 text-left transition-colors first:border-t-0",
        ativo ? "border-l-foreground bg-background" : "border-l-transparent bg-card hover:bg-surface-hover",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold",
          ativo ? "bg-foreground text-background" : "bg-muted text-foreground",
        )}
      >
        {iniciais(cadastro.nome)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold">{cadastro.nome}</span>
        <span className="block truncate text-xs font-semibold text-muted-foreground">{detalhe}</span>
        {cadastro.estagio === "prospect" || cadastro.armazenagem ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {cadastro.estagio === "prospect" ? <SeloProspect /> : null}
            {cadastro.armazenagem ? <SeloArmazenagem /> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function CabecalhoDoGrupo({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Lista(props: ClientesViewProps) {
  const { estado, cadastros, contratos, hoje, segmento, busca, selecionado, onSelecionar } = props;
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar o cadastro.</Vazio>;
  else {
    const { clientes, prospects } = filtrarCadastros(cadastros, segmento, busca);
    const linha = (cadastro: CadastroComercial) => (
      <LinhaDoCadastro
        key={cadastro.id}
        cadastro={cadastro}
        contrato={contratoVigente(contratos, cadastro.code, hoje)}
        ativo={cadastro.id === selecionado?.id}
        onSelecionar={onSelecionar}
      />
    );
    conteudo = (
      <>
        {clientes.length ? (
          <div>
            <CabecalhoDoGrupo>Clientes</CabecalhoDoGrupo>
            {clientes.map(linha)}
          </div>
        ) : null}
        {prospects.length ? (
          <div className={cn(clientes.length && "border-t border-border")}>
            <CabecalhoDoGrupo>Prospects</CabecalhoDoGrupo>
            {prospects.map(linha)}
          </div>
        ) : null}
        {!clientes.length && !prospects.length ? (
          <Vazio>{cadastros.length ? "Nenhum resultado" : "Nenhum cadastro"}</Vazio>
        ) : null}
      </>
    );
  }
  return (
    <section
      aria-label="Lista de clientes e prospects"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card lg:w-96 lg:shrink-0"
    >
      {conteudo}
    </section>
  );
}

// --- Ficha --------------------------------------------------------------------------

function AcaoDaLinha({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function Dados({ cadastro, responsavel }: { cadastro: CadastroComercial; responsavel: string | null }) {
  const campos: Array<[string, string]> = [
    ["Código", cadastro.code],
    ["Razão social", cadastro.razaoSocial ?? "—"],
    ["CNPJ", cadastro.cnpj ? formatarCnpj(cadastro.cnpj) : "—"],
    ["Cidade/UF", cidadeUf(cadastro.cidade, cadastro.uf) || "—"],
    ["Responsável", responsavel ?? "—"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
      {campos.map(([rotulo, valor]) => (
        <div key={rotulo} className="min-w-0">
          <dt className="text-xs font-bold text-muted-foreground">{rotulo}</dt>
          <dd className="mt-0.5 break-words text-sm font-bold">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function BarraDaAba({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2.5 px-5 pb-3 pt-4">{children}</div>;
}

function Locais({ locais, ocupado, acoes }: { locais: LocalResumo[] | null; ocupado: boolean; acoes: AcoesDaTela }) {
  return (
    <div>
      <BarraDaAba>
        <Button type="button" variant="outline" size="sm" onClick={acoes.novoLocal} disabled={ocupado}>
          <Plus aria-hidden="true" />
          Novo local
        </Button>
      </BarraDaAba>
      {locais === null ? (
        <Vazio>Carregando...</Vazio>
      ) : locais.length === 0 ? (
        <Vazio>Nenhum local</Vazio>
      ) : (
        <ul aria-label="Locais do cliente" className="border-t border-border">
          {ordenarLocais(locais).map((local) => {
            const endereco = enderecoEmLinha(local.endereco);
            return (
              <li key={local.id} className="flex flex-wrap items-center gap-3 border-t border-muted px-5 py-3 first:border-t-0">
                <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-border bg-muted px-2 text-xs font-extrabold tracking-wide">
                  {local.sigla ?? "—"}
                </span>
                <span className={cn("min-w-0 flex-1", !local.ativo && "text-muted-foreground")}>
                  <span className="block text-sm font-bold">{local.nome}</span>
                  {endereco ? <span className="block text-xs font-semibold text-muted-foreground">{endereco}</span> : null}
                </span>
                {local.ativo ? null : <Pill>Inativo</Pill>}
                <span className="flex gap-1">
                  <AcaoDaLinha onClick={() => acoes.editarLocal(local)} disabled={ocupado}>
                    Editar
                  </AcaoDaLinha>
                  <AcaoDaLinha onClick={() => acoes.alternarLocal(local)} disabled={ocupado}>
                    {local.ativo ? "Desativar" : "Reativar"}
                  </AcaoDaLinha>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Contatos({
  contatos,
  nomeDoCliente,
  ocupado,
  acoes,
}: {
  contatos: ContatoResumo[] | null;
  nomeDoCliente: string;
  ocupado: boolean;
  acoes: AcoesDaTela;
}) {
  const grupos = contatos ? gruposDeContatos(contatos, nomeDoCliente) : [];
  const pessoas = contatos?.length ?? 0;
  return (
    <div>
      <BarraDaAba>
        {pessoas ? (
          <span className="mr-auto">
            <Pill>
              {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"} · {grupos.length} {grupos.length === 1 ? "empresa" : "empresas"}
            </Pill>
          </span>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={acoes.novoContato} disabled={ocupado}>
          <Plus aria-hidden="true" />
          Novo contato
        </Button>
      </BarraDaAba>
      {contatos === null ? (
        <Vazio>Carregando...</Vazio>
      ) : contatos.length === 0 ? (
        <Vazio>Nenhum contato</Vazio>
      ) : (
        <div className="flex flex-wrap gap-3 px-5 pb-5">
          {grupos.map((grupo) => (
            <section
              key={`${grupo.tipo}-${grupo.empresa}`}
              aria-label={grupo.empresa}
              className="min-w-0 flex-1 basis-60 overflow-hidden rounded-lg border border-border"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-3.5 py-2.5">
                <b className="text-sm font-extrabold">{grupo.empresa}</b>
                <span className="ml-auto">
                  <Pill>{grupo.tipo}</Pill>
                </span>
              </div>
              {grupo.pessoas.map((pessoa) => {
                const meios = [pessoa.email, formatarTelefone(pessoa.telefone)].filter(Boolean).join(" · ");
                return (
                  <div key={pessoa.id} className="border-t border-muted px-3.5 py-2.5 first:border-t-0">
                    <div className={cn("flex flex-wrap items-start gap-2", !pessoa.ativo && "text-muted-foreground")}>
                      <span className="min-w-0 flex-1">
                        <b className="block text-sm font-bold">{pessoa.nome}</b>
                        <span className="block text-xs font-semibold text-muted-foreground">{pessoa.papelRotulo}</span>
                        {meios ? <span className="block break-all text-xs font-bold">{meios}</span> : null}
                      </span>
                      {pessoa.ativo ? null : <Pill>Inativo</Pill>}
                    </div>
                    <div className="mt-1 flex gap-1">
                      <AcaoDaLinha onClick={() => acoes.editarContato(pessoa)} disabled={ocupado}>
                        Editar
                      </AcaoDaLinha>
                      <AcaoDaLinha onClick={() => acoes.alternarContato(pessoa)} disabled={ocupado}>
                        {pessoa.ativo ? "Desativar" : "Reativar"}
                      </AcaoDaLinha>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Contratos({ contratos, hoje }: { contratos: ContratoResumo[]; hoje: string }) {
  if (!contratos.length) return <Vazio>Nenhum contrato</Vazio>;
  return (
    <ul aria-label="Contratos do cliente">
      {contratos.map((contrato) => {
        const href = hrefDoContrato(contrato.id);
        const situacao = situacaoDoContrato(contrato, hoje);
        return (
          <li key={contrato.id} className="flex flex-wrap items-center gap-3 border-t border-muted px-5 py-3 first:border-t-0">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {href ? (
                <Link href={href} className="block text-sm font-bold underline-offset-4 hover:underline">
                  {contrato.nome}
                </Link>
              ) : (
                <span className="block text-sm font-bold">{contrato.nome}</span>
              )}
              {contrato.numeros.length ? (
                <span className="block text-xs font-semibold text-muted-foreground">{contrato.numeros.join(" · ")}</span>
              ) : null}
            </span>
            <span className="text-sm font-bold tabular-nums">{vigenciaDoContrato(contrato)}</span>
            <Pill>{situacao}</Pill>
          </li>
        );
      })}
    </ul>
  );
}

function Ficha(props: ClientesViewProps & { selecionado: CadastroComercial }) {
  const { selecionado: cadastro, contratos, hoje, aba, onAba, locais, contatos, responsavel, ocupado, acoes } = props;
  const prospect = cadastro.estagio === "prospect";
  const vigente = contratoVigente(contratos, cadastro.code, hoje);
  const doCliente = contratosDoCliente(contratos, cadastro.code);
  const linkDoVigente = vigente ? hrefDoContrato(vigente.id) : null;
  const meta = [
    cadastro.razaoSocial,
    cadastro.cnpj ? `CNPJ ${formatarCnpj(cadastro.cnpj)}` : null,
    cidadeUf(cadastro.cidade, cadastro.uf),
    cadastro.desde ? `${prospect ? "Prospect" : "Cliente"} desde ${cadastro.desde}` : null,
  ].filter((item): item is string => Boolean(item));
  const contagem: Record<FichaAba, number | null> = {
    dados: null,
    locais: locais?.length ?? null,
    contatos: contatos?.length ?? null,
    contratos: doCliente.length,
  };

  return (
    <section aria-label="Ficha do cliente" className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-foreground text-lg font-extrabold text-background"
        >
          {iniciais(cadastro.nome)}
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-2xl font-extrabold tracking-tight">{cadastro.nome}</h2>
          {meta.length ? (
            <div className="mt-0.5 flex flex-wrap gap-x-3.5 gap-y-1 text-sm font-semibold text-muted-foreground">
              {meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {prospect ? <SeloProspect /> : null}
            {cadastro.armazenagem ? <SeloArmazenagem /> : null}
            {linkDoVigente ? (
              <Link href={linkDoVigente} className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-bold underline-offset-4 hover:underline">
                <FileText className="size-3" aria-hidden="true" />
                {rotuloDoContrato(vigente)}
              </Link>
            ) : (
              <Pill>{rotuloDoContrato(vigente)}</Pill>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={acoes.editar} disabled={ocupado}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
          {prospect ? (
            <Button type="button" variant="outline" size="sm" onClick={acoes.marcarCliente} disabled={ocupado}>
              <UserCheck aria-hidden="true" />
              Marcar como cliente
            </Button>
          ) : null}
        </div>
      </div>

      <div role="tablist" aria-label="Ficha" className="flex gap-0.5 overflow-x-auto overflow-y-hidden border-y border-border bg-background px-3.5">
        {ABAS_DA_FICHA.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`ficha-aba-${item.id}`}
            aria-selected={aba === item.id}
            aria-controls="ficha-painel"
            onClick={() => onAba(item.id)}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-bold transition-colors",
              aba === item.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.rotulo}
            {contagem[item.id] === null ? null : <Contador>{contagem[item.id]}</Contador>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ficha-painel" aria-labelledby={`ficha-aba-${aba}`}>
        {aba === "dados" ? <Dados cadastro={cadastro} responsavel={responsavel} /> : null}
        {aba === "locais" ? <Locais locais={locais} ocupado={ocupado} acoes={acoes} /> : null}
        {aba === "contatos" ? (
          <Contatos contatos={contatos} nomeDoCliente={cadastro.nome} ocupado={ocupado} acoes={acoes} />
        ) : null}
        {aba === "contratos" ? <Contratos contratos={doCliente} hoje={hoje} /> : null}
      </div>
    </section>
  );
}

export function ClientesView(props: ClientesViewProps) {
  const { estado, selecionado } = props;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <Cabecalho {...props} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Lista {...props} />
        {estado === "pronto" && selecionado ? <Ficha {...props} selecionado={selecionado} /> : null}
      </div>
    </div>
  );
}
