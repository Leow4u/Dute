import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";

import { QuadroDoCliente } from "@/components/clientes/partes";
import { DialogosDasPessoas, useAcoesDasPessoas } from "@/components/pessoas/acoes";
import { ConviteDialog, pedidoDeEquipe, pedidoDePortal, type ClienteDoConvite, type PedidoDeConvite } from "@/components/pessoas/convite";
import { usePessoas } from "@/components/pessoas/dados";
import { ListaDePessoas } from "@/components/pessoas/lista";
import { ContagemDaAba, FiltroDeSituacao, PilhaDeAvatares } from "@/components/pessoas/partes";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, FaixaSemConexao } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { roleLabel } from "@/lib/access";
import { useAppUser } from "@/lib/auth";
import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { CUSTOMERS_QUERY_KEY, useCustomerRecords } from "@/lib/customer-records";
import { buildCustomerRows, customerHref, portalScreens } from "@/lib/customer-registry";
import { normalizeProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import {
  clientIndex,
  countSituations,
  isClientPerson,
  matchesSearch,
  pendingInvitesLabel,
  personCustomer,
  portalPeopleLabel,
  teamInFilter,
  teamRoles,
  type ClienteDoIndice,
  type Person,
  type Situacao,
} from "@/lib/pessoas";

/**
 * Configuração › Pessoas e acessos (docs/mockups/ConfigPessoas*.dc.html,
 * avaliadas pelo Leonardo em 11/11/2026). Duas abas: a equipe da Dutelog,
 * com a situação (Arquivados é uma delas) e o perfil, e os clientes, só um
 * índice: cada cliente tem a própria tela, a página dele em Configuração ›
 * Clientes, com as pessoas do portal. A busca acha qualquer pessoa, da equipe
 * ou de um cliente, e diz onde ela está. Sem legenda.
 *
 * "Convidar" de Configuração › Clientes chegava aqui com
 * ?convidar=cliente&cliente=<código>; o endereço continua abrindo o convite
 * do portal com o cliente escolhido.
 */

type Aba = "equipe" | "clientes";

const VAZIO_DA_SITUACAO: Record<Situacao, string> = {
  todos: "Ninguém na equipe",
  ativos: "Ninguém ativo",
  pendentes: "Nenhum convite pendente",
  arquivados: "Nenhum acesso removido",
};

function Vazio({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-lg border border-border bg-card px-5 py-12 text-center text-sm font-bold text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * A lista que ainda lê (carregamento v2, momento 1): o cartão no lugar dela e,
 * passados 300 ms, a caixa de 24 px com o rótulo, falado pelo Anunciador; aos
 * 10 s, a demora. Sem região viva solta.
 */
function Carregando({ rotulo, continuaARota = false, onTentar }: { rotulo: string; continuaARota?: boolean; onTentar?: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-5">
      <CarregandoNaRegiao rotulo={rotulo} continuaARota={continuaARota} onTentar={onTentar} />
    </div>
  );
}

function linkDoCliente(code: string, nome: string) {
  return (
    <Link href={customerHref(code)} className="rounded font-bold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      {nome}
    </Link>
  );
}

const COLUNAS_DO_INDICE = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.7fr)_minmax(0,1.5fr)_2.5rem]";

function IndiceDosClientes({ indice }: { indice: ClienteDoIndice[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        aria-hidden="true"
        className={`hidden items-center gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-extrabold uppercase tracking-wider text-muted-foreground lg:grid ${COLUNAS_DO_INDICE}`}
      >
        <span>Cliente</span>
        <span>Pessoas</span>
        <span>Convites pendentes</span>
        <span />
      </div>
      <ul aria-label="Clientes com portal" className="divide-y divide-border/60">
        {indice.map((linha) => (
          <li key={linha.code}>
            <Link
              href={customerHref(linha.code)}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3.5 text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-5 ${COLUNAS_DO_INDICE}`}
            >
              <span className="flex min-w-0 items-center gap-3.5">
                <QuadroDoCliente row={linha} tamanho="pequeno" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-extrabold leading-tight">{linha.name}</span>
                  {linha.code !== linha.name ? <span className="block truncate text-xs font-semibold text-muted-foreground">{linha.code}</span> : null}
                </span>
              </span>
              <span className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pl-14 lg:contents">
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-bold">
                  {linha.ativos.length ? <PilhaDeAvatares pessoas={linha.ativos} /> : null}
                  <span className={linha.ativos.length ? undefined : "font-semibold text-muted-foreground"}>{portalPeopleLabel(linha.ativos.length)}</span>
                </span>
                <span className="text-sm font-bold">
                  {linha.pendentes.length ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                      {pendingInvitesLabel(linha.pendentes.length)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground max-lg:hidden">—</span>
                  )}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="col-start-2 row-span-2 row-start-1 size-4 justify-self-end text-muted-foreground lg:col-start-auto lg:row-span-1 lg:row-start-auto"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Users() {
  const queryClient = useQueryClient();
  const { user } = useAppUser();
  const actorRole = normalizeProfileRole(user?.publicMetadata.role);
  const pessoas = usePessoas();
  const customers = useCustomerRecords();
  const rows = useMemo(() => buildCustomerRows(customers.data ?? [], [], []), [customers.data]);
  const nomes = useMemo(() => new Map(rows.map((row) => [row.code, row.name])), [rows]);
  const clientesDoConvite = useMemo<ClienteDoConvite[]>(
    () => rows.filter((row) => row.invitable).map((row) => ({ code: row.code, name: row.name, telas: portalScreens(row.profile) })),
    [rows],
  );

  const [aba, setAba] = useState<Aba>(() => (new URLSearchParams(window.location.search).get("convidar") === "cliente" ? "clientes" : "equipe"));
  const [pedido, setPedido] = useState<PedidoDeConvite | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("convidar") === "cliente" ? pedidoDePortal(params.get("cliente") ?? "") : null;
  });
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const [perfil, setPerfil] = useState("todos");

  const acoes = useAcoesDasPessoas({
    refresh: pessoas.refresh,
    onConvidarDeNovo: (person: Person) =>
      setPedido(
        isClientPerson(person)
          ? { tipo: "portal", nome: person.name, email: person.email, cliente: personCustomer(person), fixo: false }
          : { tipo: "equipe", nome: person.name, email: person.email, role: normalizeProfileRole(person.role) },
      ),
  });

  const equipe = pessoas.people.filter((person) => !isClientPerson(person));
  const contagem = countSituations(equipe);
  const perfis = teamRoles(equipe);
  const visiveis = teamInFilter(equipe, situacao, perfil);
  const indice = clientIndex(
    pessoas.people,
    rows.map((row) => ({ code: row.code, name: row.name, archived: row.archived, portalActive: row.profile.portalStatus === "active" })),
  );
  const termo = busca.trim();
  const resultados = termo ? pessoas.people.filter((person) => matchesSearch(person, termo)) : [];

  const onde = (person: Person) => {
    if (!isClientPerson(person)) return "Equipe Dutelog";
    const code = personCustomer(person);
    return linkDoCliente(code, nomes.get(code) ?? code);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-3xl font-extrabold tracking-tight">Pessoas e acessos</h1>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <label className="relative block min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="people-search"
              type="search"
              aria-label="Buscar pessoa"
              placeholder="Nome ou e-mail"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="w-full pl-9 sm:w-72"
            />
          </label>
          <Button type="button" onClick={() => setPedido(aba === "clientes" ? pedidoDePortal() : pedidoDeEquipe())}>
            <Plus aria-hidden="true" />
            Convidar pessoa
          </Button>
        </div>
      </header>

      {pessoas.carregando ? (
        <Carregando rotulo="Carregando pessoas…" continuaARota onTentar={() => void pessoas.refresh()} />
      ) : pessoas.falta && pessoas.falta.lidaEm === null ? (
        <BlocoSemConexao tentando={pessoas.tentando} onTentar={() => void pessoas.refresh()} />
      ) : pessoas.erro ? (
        <ErroNaLeitura
          mensagem="Não foi possível carregar as pessoas e os convites."
          tentando={pessoas.tentando}
          onTentar={() => void pessoas.refresh()}
        />
      ) : null}
      {pessoas.falta && pessoas.falta.lidaEm !== null ? (
        <FaixaSemConexao lidaEm={pessoas.falta.lidaEm} tentando={pessoas.tentando} onTentar={() => void pessoas.refresh()} />
      ) : pessoas.falhaNaReleitura ? (
        // A releitura que falhou não apaga a lista lida, e a falha fica escrita em cima dela, sem falar (momento 7).
        <FalhaNaSecao
          mensagem="Não foi possível atualizar as pessoas."
          alerta={false}
          tentando={pessoas.tentando}
          onTentar={pessoas.refresh}
          className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-3"
        />
      ) : null}
      {pessoas.carregando || pessoas.erro || (pessoas.falta && pessoas.falta.lidaEm === null) ? null : termo ? (
        <section aria-labelledby="pessoas-resultados" className="flex flex-col gap-4">
          <h2 id="pessoas-resultados" className="flex items-center border-b border-border pb-2.5 text-base font-extrabold">
            Resultados
            <ContagemDaAba>{resultados.length}</ContagemDaAba>
          </h2>
          {resultados.length ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ListaDePessoas modo="busca" rotulo="Resultados" pessoas={resultados} acoes={acoes} onde={onde} />
            </div>
          ) : (
            <Vazio>Nenhuma pessoa encontrada</Vazio>
          )}
        </section>
      ) : (
        <Tabs value={aba} onValueChange={(value) => setAba(value === "clientes" ? "clientes" : "equipe")}>
          <TabsList aria-label="Pessoas">
            <TabsTrigger value="equipe" className="text-base">
              Equipe Dutelog
              <ContagemDaAba>{contagem.todos}</ContagemDaAba>
            </TabsTrigger>
            <TabsTrigger value="clientes" className="text-base">
              Clientes
              <ContagemDaAba>{indice.length}</ContagemDaAba>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="equipe" className="mt-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <FiltroDeSituacao valor={situacao} onValor={setSituacao} contagem={contagem} />
              <Select value={perfil} onValueChange={setPerfil}>
                <SelectTrigger aria-label="Filtrar pelo perfil" className="w-auto min-w-44 font-semibold sm:ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Perfil: Todos</SelectItem>
                  {perfis.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {visiveis.length ? (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <ListaDePessoas modo="equipe" rotulo="Equipe Dutelog" pessoas={visiveis} acoes={acoes} />
              </div>
            ) : (
              <Vazio>{perfil === "todos" ? VAZIO_DA_SITUACAO[situacao] : "Nenhuma pessoa encontrada"}</Vazio>
            )}
          </TabsContent>
          <TabsContent value="clientes" className="mt-5">
            {customers.isLoading ? (
              <Carregando rotulo="Carregando clientes…" onTentar={() => void relerDoZero(queryClient, [CUSTOMERS_QUERY_KEY])} />
            ) : customers.isError && indice.length === 0 ? (
              <ErroNaLeitura
                mensagem={humanApiError(customers.error, "Não foi possível carregar os clientes.")}
                tentando={customers.isFetching}
                onTentar={() => void customers.refetch()}
              />
            ) : indice.length ? (
              <IndiceDosClientes indice={indice} />
            ) : (
              <Vazio>Nenhum cliente com portal</Vazio>
            )}
          </TabsContent>
        </Tabs>
      )}

      <DialogosDasPessoas acoes={acoes} />
      <ConviteDialog
        pedido={pedido}
        onFechar={() => setPedido(null)}
        clientes={clientesDoConvite}
        actorRole={actorRole}
        onCriado={async () => {
          setSituacao("todos");
          setBusca("");
          await pessoas.refresh();
        }}
      />
    </div>
  );
}
