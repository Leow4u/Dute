import { Link } from "wouter";
import { ChevronRight, Plus, Search } from "lucide-react";
import { MODULO_ROTULO } from "@workspace/dominio";

import { Codigo, Pilula, QuadroDoCliente, Selo, SeloDaSituacao } from "@/components/clientes/partes";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { BlocoSemConexao, ErroNaLeitura } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { Input } from "@/components/ui/input";
import {
  CUSTOMER_FILTERS,
  CUSTOMER_FILTER_LABEL,
  countCustomerFilters,
  customerHref,
  customerInFilter,
  searchCustomerRows,
  type CustomerFilter,
  type CustomerRow,
} from "@/lib/customer-registry";
import { templateStatusLabel } from "@/lib/operations";
import { cn } from "@/lib/utils";

/**
 * Configurações › Clientes, a galeria (docs/mockups/ConfigClientes.dc.html,
 * aprovada em 11/11/2026): um cartão por cliente, com a sigla do nome na cor
 * dele, o modelo, o pacote, o selo do portal, os números e os módulos; o
 * cartão abre a página do cliente. Só a apresentação: os dados e as ações
 * chegam por props (pages/settings-customers.tsx). Sem legenda.
 */

export type GaleriaProps = {
  estado: "carregando" | "erro" | "pronto";
  erro: string | null;
  tentando: boolean;
  onTentar: () => void;
  rows: CustomerRow[];
  filtro: CustomerFilter;
  onFiltro: (filtro: CustomerFilter) => void;
  busca: string;
  onBusca: (busca: string) => void;
  /** A leitura das posições (a zona de cada cliente): sem ela, a zona não é afirmada. */
  zonas: "carregando" | "erro" | "pronto";
  /** A leitura das pessoas (quantas entram no portal): sem ela, nunca "0 no portal". */
  pessoas?: "carregando" | "erro" | "pronto";
  /** Módulos contratados no cartão, onde a plataforma está liberada. */
  comModulos: boolean;
  onNovo: () => void;
  /**
   * A nova tentativa das leituras dos números (as prateleiras e as pessoas):
   * na falha, o aviso com "Tentar de novo" em cima dos cartões, que mostram
   * "—"; na demora da leitura dos clientes, o "Tentar de novo" dos 10 s.
   */
  tentarLeituras?: { tentando: boolean; onTentar: () => unknown };
  /** A leitura dos clientes falhou por falta de conexão: o aviso da conexão, e não o erro vermelho. */
  semConexao?: boolean;
};

/** O que não foi lido, em palavras: a falha dos números nunca fica só no "—" dos cartões. */
function falhaDosNumeros(zonas: GaleriaProps["zonas"], pessoas: NonNullable<GaleriaProps["pessoas"]>): string | null {
  const fontes = [zonas === "erro" ? "as prateleiras" : null, pessoas === "erro" ? "as pessoas" : null].filter(Boolean);
  return fontes.length ? `Não foi possível ler ${fontes.join(" e ")}.` : null;
}

const VAZIO_DO_FILTRO: Record<CustomerFilter, string> = {
  todos: "Nenhum cliente ativo",
  com_portal: "Nenhum cliente com portal",
  sem_portal: "Nenhum cliente sem portal",
  arquivados: "Nenhum cliente arquivado",
};

function Contagem({ children, ativa }: { children: number; ativa: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
        ativa ? "bg-foreground/10 text-foreground" : "bg-foreground/5 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Numero({ valor, rotulo }: { valor: React.ReactNode; rotulo: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-1">
      <dt className="text-xs font-semibold leading-snug text-muted-foreground">{rotulo}</dt>
      <dd className="text-xl font-extrabold leading-none tracking-tight tabular-nums">{valor}</dd>
    </div>
  );
}

/** "Rua C", "Ruas A e B": sem quebra de linha no meio (espaço que não quebra). */
export function ruasDaZona(aisles: readonly string[]): string {
  const ruas = aisles.length === 1 ? `Rua ${aisles[0]}` : `Ruas ${aisles.join(", ").replace(/, ([^,]*)$/, " e $1")}`;
  return ruas.replace(/ /g, "\u00a0");
}

function zonaCurta(row: CustomerRow): string {
  if (!row.zone || row.zone.positions === 0) return "zona a definir";
  return `${row.zone.positions === 1 ? "prateleira" : "prateleiras"} · ${ruasDaZona(row.zone.aisles)}`;
}

/**
 * O número que ainda não foi lido (carregamento v2, parte 13e): o bloco do
 * esqueleto enquanto lê, "—" quando a leitura falhou; nunca o zero nem a
 * reticência solta.
 */
export function ValorNaoLido({ estado }: { estado: "carregando" | "erro" }) {
  return estado === "carregando" ? <Esqueleto forma="contagem" /> : <>—</>;
}

function CartaoDoCliente({
  row,
  comModulos,
  zonas,
  pessoas,
}: {
  row: CustomerRow;
  comModulos: boolean;
  zonas: GaleriaProps["zonas"];
  pessoas: NonNullable<GaleriaProps["pessoas"]>;
}) {
  const { profile } = row;
  const semPortal = profile.template.portal === null;
  const prateleiras = row.zone && row.zone.positions > 0 ? row.zone.positions : null;
  const zonaLida = zonas === "pronto";
  return (
    <li>
      <Link
        href={customerHref(row.code)}
        className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-card p-4 text-foreground outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/40 sm:p-5"
      >
        <div className="flex items-start gap-3.5">
          <QuadroDoCliente row={row} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-extrabold leading-tight tracking-tight">{row.name}</h2>
            <p className="mt-0.5 truncate text-sm font-semibold text-muted-foreground">{row.code}</p>
          </div>
          <SeloDaSituacao row={row} />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          {profile.template.label}
          {profile.pack ? <Codigo>{profile.pack.key}</Codigo> : null}
          {profile.template.status === "building" ? <Selo tom="amber">{templateStatusLabel(profile.template)}</Selo> : null}
        </p>
        <dl className="hidden grid-cols-3 gap-3 border-t border-border/60 pt-4 sm:grid">
          <Numero valor={zonaLida ? (prateleiras ?? "—") : <ValorNaoLido estado={zonas} />} rotulo={zonaLida ? zonaCurta(row) : "prateleiras"} />
          <Numero valor={semPortal ? "—" : pessoas === "pronto" ? row.people : <ValorNaoLido estado={pessoas} />} rotulo={semPortal ? "sem portal" : "no portal"} />
          <Numero
            valor={profile.skuPrefix ? <Codigo destaque>{profile.skuPrefix}</Codigo> : <Selo tom="warn">A definir</Selo>}
            rotulo="sigla do SKU"
          />
        </dl>
        <p className="-mt-1 flex items-center gap-2 text-sm font-semibold text-muted-foreground sm:hidden">
          <span className="min-w-0 flex-1">
            {[
              !zonaLida ? null : prateleiras === null ? "Zona a definir" : `${prateleiras} ${prateleiras === 1 ? "prateleira" : "prateleiras"}`,
              semPortal || pessoas !== "pronto" ? null : `${row.people} no portal`,
              profile.skuPrefix ? null : "sigla a definir",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        </p>
        <div className="mt-auto hidden items-center gap-1.5 sm:flex">
          {comModulos ? (
            <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {profile.modules.map((modulo) => (
                <Pilula key={modulo}>{MODULO_ROTULO[modulo]}</Pilula>
              ))}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}

export function GaleriaDeClientes({
  estado,
  erro,
  tentando,
  onTentar,
  rows,
  filtro,
  onFiltro,
  busca,
  onBusca,
  zonas,
  pessoas = "pronto",
  comModulos,
  onNovo,
  tentarLeituras,
  semConexao = false,
}: GaleriaProps) {
  const falhaNosNumeros = estado === "pronto" && rows.length > 0 ? falhaDosNumeros(zonas, pessoas) : null;
  const contagem = countCustomerFilters(rows);
  const visiveis = searchCustomerRows(
    rows.filter((row) => customerInFilter(row, filtro)),
    busca,
  );
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Clientes</h1>
        {estado === "pronto" && rows.length > 0 ? (
          <div role="group" aria-label="Filtrar clientes" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-1">
            {CUSTOMER_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={filtro === item}
                onClick={() => onFiltro(item)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-bold transition-colors sm:gap-2 sm:px-3.5",
                  filtro === item ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {CUSTOMER_FILTER_LABEL[item]}
                <Contagem ativa={filtro === item}>{contagem[item]}</Contagem>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto">
          {estado === "pronto" && rows.length > 0 ? (
            <label className="relative block min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Buscar cliente"
                placeholder="Nome ou CNPJ"
                value={busca}
                onChange={(event) => onBusca(event.target.value)}
                className="w-full pl-9 sm:w-60"
              />
            </label>
          ) : null}
          <Button type="button" onClick={onNovo} disabled={estado === "carregando"}>
            <Plus aria-hidden="true" />
            Novo cliente
          </Button>
        </div>
      </header>

      {estado === "carregando" ? (
        <div className="rounded-lg border border-border bg-card px-5 py-5">
          <CarregandoNaRegiao rotulo="Carregando clientes…" continuaARota onTentar={onTentar} />
        </div>
      ) : estado === "erro" && semConexao ? (
        <BlocoSemConexao tentando={tentando} onTentar={onTentar} />
      ) : estado === "erro" ? (
        <ErroNaLeitura mensagem={erro ?? "Não foi possível carregar os clientes."} tentando={tentando} onTentar={onTentar} />
      ) : rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-border bg-card px-5 py-12 text-center text-sm font-bold text-muted-foreground">
          Nenhum cliente cadastrado
        </p>
      ) : visiveis.length === 0 ? (
        <p role="status" className="rounded-lg border border-border bg-card px-5 py-12 text-center text-sm font-bold text-muted-foreground">
          {busca.trim() ? "Nenhum cliente encontrado" : VAZIO_DO_FILTRO[filtro]}
        </p>
      ) : (
        <>
          {falhaNosNumeros && tentarLeituras ? (
            <FalhaNaSecao
              mensagem={falhaNosNumeros}
              tentando={tentarLeituras.tentando}
              onTentar={tentarLeituras.onTentar}
              className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3"
            />
          ) : null}
        <ul aria-label="Clientes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((row) => (
            <CartaoDoCliente key={row.code} row={row} comModulos={comModulos} zonas={zonas} pessoas={pessoas} />
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
