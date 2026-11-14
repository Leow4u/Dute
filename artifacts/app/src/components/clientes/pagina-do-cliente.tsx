import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Archive, ChevronRight, Mail, Map as MapIcon, MoreHorizontal, Pencil } from "lucide-react";
import { MODULOS_CONTRATAVEIS, MODULO_ROTULO, type ModuloContratavel } from "@workspace/dominio";

import { ruasDaZona, ValorNaoLido } from "@/components/clientes/galeria-de-clientes";
import { Codigo, Pilula, QuadroDoCliente, Selo, SeloDaSituacao } from "@/components/clientes/partes";
import type { PessoasDoCliente } from "@/components/pessoas/do-cliente";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BlocoSemConexao } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CUSTOMERS_PATH,
  customerFormFrom,
  customerHasStorage,
  customerSince,
  inboundConferenceLabel,
  portalScreens,
  toggleContractedModule,
  zoneLabel,
  type AisleOccupancy,
  type CustomerForm,
  type CustomerRow,
  type CustomerStatus,
} from "@/lib/customer-registry";
import {
  OPERATION_TEMPLATES,
  canonicalSkuPrefix,
  skuExample,
  templateStatusLabel,
  type OperationTemplateKey,
  type PortalStatus,
} from "@/lib/operations";
import { useEspera } from "@/lib/carregando/use-espera";
import { segurarOFocoQueSai } from "@/lib/foco-de-volta";
import { cn } from "@/lib/utils";

/**
 * A página do cliente em Configurações › Clientes (docs/mockups/ConfigCliente.dc.html,
 * aprovada em 11/11/2026): o cabeçalho com a identidade e as ações, a faixa
 * de números e as seções em cartões, cada uma com o próprio "Editar" no
 * lugar (docs/mockups/ConfigClienteEditar.dc.html). Só a apresentação e o
 * estado dos formulários: gravar é da página (pages/settings-customers.tsx),
 * que manda à Function o cadastro inteiro com o que a seção mudou. O
 * arquivado fica só para leitura. Sem legenda.
 *
 * As pessoas do portal (docs/mockups/ConfigClientePessoas.dc.html) chegam
 * prontas da página (components/pessoas/do-cliente.tsx): o "Convidar" no
 * cabeçalho da seção Portal do cliente e a lista embaixo dos dados.
 */

export type OcupacaoDaZona = {
  estado: "carregando" | "erro" | "pronto";
  aisles: AisleOccupancy[];
  boxes: number;
  tentando: boolean;
  /** Relê as posições e as caixas; a promessa diz quando a tentativa pedida acabou. */
  onTentar: () => unknown;
  /** A falha é a falta de conexão: o aviso da conexão, como o das pessoas do portal, e não o erro vermelho. */
  semConexao?: boolean;
  /** A releitura falhou com a ocupação na tela: ela fica, e a falha escrita em cima, sem falar. */
  falhaNaReleitura?: boolean;
};

export type PaginaDoClienteProps = {
  row: CustomerRow;
  /** A leitura das posições (a zona do cliente): sem ela, a zona não é afirmada. */
  zonas: "carregando" | "erro" | "pronto";
  /** A leitura das pessoas (quantas entram no portal): sem ela, nunca "0 pessoas no portal". */
  pessoasLidas?: "carregando" | "erro" | "pronto";
  ocupacao: OcupacaoDaZona;
  /** Contatos ativos de aviso: undefined fora do Comercial; null carregando. */
  contatosAtivos: number | null | undefined;
  /** A seção "Avisos por e-mail" (pages/settings-customer-notifications.tsx). */
  avisos: ReactNode;
  /** Módulos contratados, onde a plataforma está liberada. */
  comModulos: boolean;
  /** Recebimento por caixa liberado no ambiente (lib/liberacao.ts). */
  recebimentoPorCaixa?: boolean;
  onSalvar: (patch: Partial<CustomerForm>) => Promise<void>;
  onArquivar: () => void;
  /** As pessoas do portal: o "Convidar" e a lista (components/pessoas/do-cliente.tsx). */
  pessoas?: Pick<PessoasDoCliente, "convidar" | "lista">;
};

// --- Peças ---------------------------------------------------------------------------

function Secao({ id, titulo, acao, children }: { id: string; titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <h2 id={id} className="text-base font-extrabold">
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Dados({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border/60 px-5">{children}</dl>;
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[168px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-sm font-semibold text-muted-foreground">{rotulo}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-foreground">{children}</dd>
    </div>
  );
}

function Vazio() {
  return <span className="text-muted-foreground">—</span>;
}

function BotaoEditar({ onClick, rotulo }: { onClick: () => void; rotulo: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick} aria-label={rotulo} data-editar-secao="">
      <Pencil aria-hidden="true" />
      Editar
    </Button>
  );
}

function Campo({ id, rotulo, inteiro = false, children }: { id: string; rotulo: string; inteiro?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", inteiro && "sm:col-span-2")}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

/** O formulário de uma seção: os campos, o erro do servidor e Cancelar/Salvar. */
function FormularioDaSecao({
  rotulo,
  salvando,
  erro,
  onCancelar,
  onSalvar,
  children,
}: {
  rotulo: string;
  salvando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onSalvar: () => void;
  children: ReactNode;
}) {
  // O Cancelar esmaece junto com o gerúndio do Salvar, aos 300 ms: a gravação rápida não o faz piscar.
  const esmaecido = useEspera(salvando, { segurarMinimo: true }).visivel;
  // O formulário fecha (salvou, ou Cancelar) com o foco nele: o foco volta ao "Editar" da seção, que volta no lugar
  // dele, ou ao título da seção; nunca ao body (2.4.3).
  const formulario = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    const elemento = formulario.current;
    return () => {
      if (!elemento) return;
      const secao = elemento.closest("section");
      segurarOFocoQueSai(elemento, () => secao?.querySelector<HTMLElement>("[data-editar-secao]") ?? secao?.querySelector<HTMLElement>("h2") ?? null);
    };
  }, []);
  return (
    <form
      ref={formulario}
      aria-label={rotulo}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!salvando) onSalvar();
      }}
    >
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">{children}</div>
      {erro ? (
        <p role="alert" className="px-5 pb-1 text-sm font-semibold text-destructive">
          {erro}
        </p>
      ) : null}
      <div className="flex justify-end gap-2.5 px-5 pb-5 pt-3">
        {/* Ocupado não é desabilitado: o Cancelar fica aria-disabled, e o Salvar é o botão de ação (parte 13e). */}
        <Button
          type="button"
          variant="ghost"
          aria-disabled={salvando || undefined}
          className={cn(salvando && "hover:bg-transparent", esmaecido && "opacity-45")}
          onClick={() => {
            if (!salvando) onCancelar();
          }}
        >
          Cancelar
        </Button>
        <BotaoDeAcao type="submit" estado={salvando ? "andamento" : "repouso"} rotulo="Salvar" andamento="Salvando…" />
      </div>
    </form>
  );
}

/** Editar e gravar uma seção: o estado do formulário, o andamento e o erro. */
function useEdicao<T>(onSalvar: (valores: T) => Promise<void>) {
  const [valores, setValores] = useState<T | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return {
    valores,
    salvando,
    erro,
    abrir: (inicial: T) => {
      setErro(null);
      setValores(inicial);
    },
    mudar: (patch: Partial<T>) => setValores((atual) => (atual ? { ...atual, ...patch } : atual)),
    cancelar: () => {
      if (salvando) return;
      setErro(null);
      setValores(null);
    },
    salvar: async () => {
      if (!valores || salvando) return;
      setSalvando(true);
      setErro(null);
      try {
        await onSalvar(valores);
        setValores(null);
      } catch (error) {
        setErro(error instanceof Error && error.message ? error.message : "Não foi possível salvar.");
      } finally {
        setSalvando(false);
      }
    },
  };
}

/** A sigla do SKU é obrigatória em toda gravação: sem ela no cadastro, o formulário pede. */
function CampoDaSigla({ id, valor, onMudar }: { id: string; valor: string; onMudar: (sigla: string) => void }) {
  return (
    <Campo id={id} rotulo="Sigla do SKU">
      <Input
        id={id}
        required
        value={valor}
        maxLength={6}
        className="font-mono uppercase"
        onChange={(event) => onMudar(canonicalSkuPrefix(event.target.value))}
      />
    </Campo>
  );
}

// --- Cabeçalho e números -----------------------------------------------------------

function Numero({ valor, rotulo }: { valor: ReactNode; rotulo: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-1.5 border-border/60 px-5 py-4 [&:not(:first-child)]:border-l max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(n+3)]:border-t">
      <dt className="text-sm font-semibold leading-snug text-muted-foreground">{rotulo}</dt>
      <dd className="text-2xl font-extrabold leading-none tracking-tight tabular-nums">{valor}</dd>
    </div>
  );
}

function Cabecalho({
  row,
  zonas,
  pessoasLidas = "pronto",
  contatosAtivos,
  onArquivar,
}: Pick<PaginaDoClienteProps, "row" | "zonas" | "pessoasLidas" | "contatosAtivos" | "onArquivar">) {
  const { profile, customer } = row;
  const desde = customerSince(customer);
  const arquivavel = !row.archived && customerHasStorage(customer);
  const prateleiras = row.zone && row.zone.positions > 0 ? row.zone : null;
  const ruas = prateleiras ? ruasDaZona(prateleiras.aisles) : null;
  return (
    <section aria-labelledby="cliente-titulo" className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <QuadroDoCliente row={row} tamanho="grande" />
          <div className="min-w-0">
            <h1 id="cliente-titulo" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
              {row.name}
              <SeloDaSituacao row={row} />
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-muted-foreground">
              <span>{row.code}</span>
              <span aria-hidden="true">·</span>
              <span>{profile.template.label}</span>
              {profile.pack ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Codigo>{profile.pack.key}</Codigo>
                </>
              ) : null}
              {desde ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{`cliente desde ${desde}`}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        {row.archived ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {contatosAtivos !== undefined ? (
              <Button asChild variant="secondary">
                <a href="#avisos-por-email">
                  <Mail aria-hidden="true" />
                  <span className="sm:hidden">Avisos</span>
                  <span className="hidden sm:inline">Avisos por e-mail</span>
                </a>
              </Button>
            ) : null}
            {arquivavel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="secondary" size="icon" aria-label="Mais ações">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem className="gap-2.5 font-bold text-destructive focus:text-destructive" onSelect={onArquivar}>
                    <Archive className="size-4" aria-hidden="true" />
                    Arquivar cliente
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 border-t border-border lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
        {zonas === "pronto" ? (
          <Numero valor={prateleiras ? prateleiras.positions : "—"} rotulo={ruas ? `prateleiras · ${ruas}` : "zona a definir"} />
        ) : (
          <Numero valor={<ValorNaoLido estado={zonas} />} rotulo="prateleiras" />
        )}
        <Numero
          valor={profile.template.portal === null ? "—" : pessoasLidas === "pronto" ? row.people : <ValorNaoLido estado={pessoasLidas} />}
          rotulo={profile.template.portal === null ? "sem portal" : "pessoas no portal"}
        />
        {contatosAtivos !== undefined ? <Numero valor={contatosAtivos ?? "—"} rotulo="contatos de aviso" /> : null}
        <Numero valor={profile.skuPrefix ?? "—"} rotulo={profile.skuPrefix ? "sigla do SKU" : "sigla do SKU a definir"} />
      </dl>
    </section>
  );
}

// --- Seções --------------------------------------------------------------------------

type ValoresDaOperacao = { operation_template: OperationTemplateKey; sku_prefix: string; modules: ModuloContratavel[] };

function SecaoOperacao({ row, comModulos, recebimentoPorCaixa, onSalvar }: Pick<PaginaDoClienteProps, "row" | "comModulos" | "recebimentoPorCaixa" | "onSalvar">) {
  const { profile } = row;
  const edicao = useEdicao<ValoresDaOperacao>((valores) => onSalvar(valores));
  const abrir = () => {
    const form = customerFormFrom(row.customer);
    edicao.abrir({ operation_template: form.operation_template, sku_prefix: form.sku_prefix, modules: form.modules });
  };
  const valores = edicao.valores;
  return (
    <Secao id="secao-operacao" titulo="Operação" acao={row.archived || valores ? null : <BotaoEditar onClick={abrir} rotulo="Editar operação" />}>
      {valores ? (
        <FormularioDaSecao rotulo="Operação" salvando={edicao.salvando} erro={edicao.erro} onCancelar={edicao.cancelar} onSalvar={() => void edicao.salvar()}>
          <Campo id="operacao-modelo" rotulo="Modelo de operação">
            <Select value={valores.operation_template} onValueChange={(value) => edicao.mudar({ operation_template: value as OperationTemplateKey })}>
              <SelectTrigger id="operacao-modelo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATION_TEMPLATES.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.status === "building" ? `${item.label} (em construção)` : item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <CampoDaSigla id="operacao-sigla" valor={valores.sku_prefix} onMudar={(sku_prefix) => edicao.mudar({ sku_prefix })} />
          {comModulos ? (
            <fieldset className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <legend className="mb-2 text-sm font-medium leading-none">Módulos contratados</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                {MODULOS_CONTRATAVEIS.map((key) => (
                  <label key={key} className="flex min-h-6 items-center gap-2 text-sm font-semibold">
                    <Checkbox
                      checked={valores.modules.includes(key)}
                      onCheckedChange={(checked) => edicao.mudar({ modules: toggleContractedModule(valores.modules, key, checked === true) })}
                    />
                    {MODULO_ROTULO[key]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </FormularioDaSecao>
      ) : (
        <Dados>
          <Dado rotulo="Modelo de operação">
            {profile.template.label}
            <Selo tom={profile.template.status === "ready" ? "ok" : "amber"}>{templateStatusLabel(profile.template)}</Selo>
          </Dado>
          <Dado rotulo="Pacote de código">{profile.pack ? <Codigo>{profile.pack.key}</Codigo> : "Nenhum"}</Dado>
          <Dado rotulo="Sigla do SKU">
            {profile.skuPrefix ? (
              <>
                <Codigo destaque>{profile.skuPrefix}</Codigo>
                <span className="font-mono text-xs text-muted-foreground">{skuExample(profile.skuPrefix)}</span>
              </>
            ) : (
              <Selo tom="warn">A definir</Selo>
            )}
          </Dado>
          {comModulos ? (
            <Dado rotulo="Módulos contratados">
              {profile.modules.map((modulo) => (
                <Pilula key={modulo}>{MODULO_ROTULO[modulo]}</Pilula>
              ))}
            </Dado>
          ) : null}
          <Dado rotulo="Conferência da chegada">{inboundConferenceLabel(profile, recebimentoPorCaixa)}</Dado>
        </Dados>
      )}
    </Secao>
  );
}

function SecaoArmazem({ row, zonas, ocupacao }: Pick<PaginaDoClienteProps, "row" | "zonas" | "ocupacao">) {
  const temZona = zonas === "pronto" && Boolean(row.zone && row.zone.positions > 0);
  return (
    <Secao
      id="secao-armazem"
      titulo="Armazém"
      acao={
        <Button asChild variant="secondary" size="sm">
          <Link href="/estoque/posicoes">
            <MapIcon aria-hidden="true" />
            Posições
          </Link>
        </Button>
      }
    >
      {zonas === "pronto" ? (
        <Dados>
          <Dado rotulo="Zona">{zoneLabel(row.zone)}</Dado>
          {temZona && ocupacao.estado === "pronto" ? (
            <>
              {ocupacao.aisles.map((rua) => (
                <Dado key={rua.aisle} rotulo={`Rua ${rua.aisle}`}>
                  <span aria-hidden="true" className="h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-foreground" style={{ width: `${rua.total ? Math.round((rua.occupied / rua.total) * 100) : 0}%` }} />
                  </span>
                  <span className="tabular-nums">{`${rua.occupied} de ${rua.total} ocupadas`}</span>
                </Dado>
              ))}
              <Dado rotulo="Caixas guardadas">
                <span className="tabular-nums">{ocupacao.boxes}</span>
              </Dado>
            </>
          ) : null}
        </Dados>
      ) : null}
      {zonas === "pronto" && temZona && ocupacao.estado === "pronto" && ocupacao.falhaNaReleitura ? (
        <FalhaNaSecao
          mensagem="Não foi possível atualizar a ocupação."
          alerta={false}
          tentando={ocupacao.tentando}
          onTentar={ocupacao.onTentar}
          className="border-t border-border/60 px-5 py-3"
        />
      ) : null}
      {zonas === "carregando" || (temZona && ocupacao.estado === "carregando") ? (
        <CarregandoNaRegiao
          rotulo="Carregando a ocupação…"
          onTentar={() => void ocupacao.onTentar()}
          className="border-border/60 px-5 py-3 [dl+&]:border-t"
        />
      ) : null}
      {zonas === "erro" || (temZona && ocupacao.estado === "erro") ? (
        ocupacao.semConexao ? (
          // A mesma falta, o mesmo aviso que as pessoas do portal mostram na página (momento 8).
          <div className="border-border/60 px-5 py-3 [dl+&]:border-t">
            <BlocoSemConexao tentando={ocupacao.tentando} onTentar={() => void ocupacao.onTentar()} />
          </div>
        ) : (
          <FalhaNaSecao
            mensagem="Não foi possível ler a ocupação."
            tentando={ocupacao.tentando}
            onTentar={ocupacao.onTentar}
            className="border-border/60 px-5 py-3 [dl+&]:border-t"
          />
        )
      ) : null}
    </Secao>
  );
}

function SecaoPortal({ row, onSalvar, pessoas }: Pick<PaginaDoClienteProps, "row" | "onSalvar" | "pessoas">) {
  const { profile } = row;
  const semSigla = !profile.skuPrefix;
  const edicao = useEdicao<{ portal_status: PortalStatus; sku_prefix: string }>((valores) =>
    onSalvar(semSigla ? valores : { portal_status: valores.portal_status }),
  );
  const editavel = !row.archived && profile.template.portal !== null;
  const telas = portalScreens(profile);
  const valores = edicao.valores;
  return (
    <Secao
      id="secao-portal"
      titulo="Portal do cliente"
      acao={
        valores ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {pessoas?.convidar}
            {editavel ? (
              <BotaoEditar
                rotulo="Editar portal do cliente"
                onClick={() => {
                  const form = customerFormFrom(row.customer);
                  edicao.abrir({ portal_status: form.portal_status, sku_prefix: form.sku_prefix });
                }}
              />
            ) : null}
          </div>
        )
      }
    >
      {valores ? (
        <FormularioDaSecao rotulo="Portal do cliente" salvando={edicao.salvando} erro={edicao.erro} onCancelar={edicao.cancelar} onSalvar={() => void edicao.salvar()}>
          {semSigla ? <CampoDaSigla id="portal-sigla" valor={valores.sku_prefix} onMudar={(sku_prefix) => edicao.mudar({ sku_prefix })} /> : null}
          <Campo id="portal-situacao" rotulo="Portal do cliente">
            <Select value={valores.portal_status} onValueChange={(value) => edicao.mudar({ portal_status: value === "inactive" ? "inactive" : "active" })}>
              <SelectTrigger id="portal-situacao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Sem portal</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </FormularioDaSecao>
      ) : (
        <Dados>
          <Dado rotulo="Situação">
            {row.archived ? <Selo tom="off">Arquivado</Selo> : profile.portalStatus === "active" ? <Selo tom="ok">Ativo</Selo> : <Selo tom="off">Sem portal</Selo>}
          </Dado>
          <Dado rotulo="Telas do portal">{telas.length ? telas.join(", ") : <Vazio />}</Dado>
        </Dados>
      )}
      {valores ? null : pessoas?.lista}
    </Secao>
  );
}

type ValoresDoContrato = Pick<
  CustomerForm,
  "name" | "legal_name" | "document" | "primary_contact_name" | "primary_contact_email" | "status" | "notes" | "sku_prefix"
>;

function SecaoContrato({ row, onSalvar }: Pick<PaginaDoClienteProps, "row" | "onSalvar">) {
  const { customer, profile } = row;
  const semSigla = !profile.skuPrefix;
  const edicao = useEdicao<ValoresDoContrato>((valores) => {
    const { sku_prefix, ...dados } = valores;
    return onSalvar(semSigla ? valores : dados);
  });
  const valores = edicao.valores;
  const contato = String(customer.primary_contact_name ?? "").trim();
  const email = String(customer.primary_contact_email ?? "").trim();
  const texto = (value: unknown) => String(value ?? "").trim();
  return (
    <Secao
      id="secao-contrato"
      titulo="Contrato"
      acao={
        row.archived || valores ? null : (
          <BotaoEditar
            rotulo="Editar contrato"
            onClick={() => {
              const form = customerFormFrom(customer);
              edicao.abrir({
                name: form.name,
                legal_name: form.legal_name,
                document: form.document,
                primary_contact_name: form.primary_contact_name,
                primary_contact_email: form.primary_contact_email,
                status: form.status,
                notes: form.notes,
                sku_prefix: form.sku_prefix,
              });
            }}
          />
        )
      }
    >
      {valores ? (
        <FormularioDaSecao rotulo="Contrato" salvando={edicao.salvando} erro={edicao.erro} onCancelar={edicao.cancelar} onSalvar={() => void edicao.salvar()}>
          {semSigla ? <CampoDaSigla id="contrato-sigla" valor={valores.sku_prefix} onMudar={(sku_prefix) => edicao.mudar({ sku_prefix })} /> : null}
          <Campo id="contrato-nome" rotulo="Nome exibido" inteiro={!semSigla}>
            <Input id="contrato-nome" required value={valores.name} onChange={(event) => edicao.mudar({ name: event.target.value })} />
          </Campo>
          <Campo id="contrato-razao" rotulo="Razão social">
            <Input id="contrato-razao" value={valores.legal_name} onChange={(event) => edicao.mudar({ legal_name: event.target.value })} />
          </Campo>
          <Campo id="contrato-cnpj" rotulo="CNPJ">
            <Input id="contrato-cnpj" value={valores.document} onChange={(event) => edicao.mudar({ document: event.target.value })} />
          </Campo>
          <Campo id="contrato-contato" rotulo="Contato principal">
            <Input id="contrato-contato" value={valores.primary_contact_name} onChange={(event) => edicao.mudar({ primary_contact_name: event.target.value })} />
          </Campo>
          <Campo id="contrato-email" rotulo="E-mail do contato">
            <Input
              id="contrato-email"
              type="email"
              value={valores.primary_contact_email}
              onChange={(event) => edicao.mudar({ primary_contact_email: event.target.value })}
            />
          </Campo>
          <Campo id="contrato-situacao" rotulo="Situação do contrato">
            <Select value={valores.status} onValueChange={(value) => edicao.mudar({ status: (value === "paused" ? "paused" : "active") as CustomerStatus })}>
              <SelectTrigger id="contrato-situacao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo id="contrato-observacoes" rotulo="Observações internas" inteiro>
            <Textarea id="contrato-observacoes" rows={3} value={valores.notes} onChange={(event) => edicao.mudar({ notes: event.target.value })} />
          </Campo>
        </FormularioDaSecao>
      ) : (
        <Dados>
          <Dado rotulo="Situação">
            {row.archived ? <Selo tom="off">Arquivado</Selo> : row.paused ? <Selo tom="warn">Pausado</Selo> : <Selo tom="ok">Ativo</Selo>}
          </Dado>
          <Dado rotulo="Razão social">{texto(customer.legal_name) || <Vazio />}</Dado>
          <Dado rotulo="CNPJ">{texto(customer.document) || <Vazio />}</Dado>
          <Dado rotulo="Contato principal">
            {contato || email ? (
              <span className="flex min-w-0 flex-col">
                {contato ? <span>{contato}</span> : null}
                {email ? <span className="break-all font-medium text-muted-foreground">{email}</span> : null}
              </span>
            ) : (
              <Vazio />
            )}
          </Dado>
          <Dado rotulo="Observações internas">{texto(customer.notes) ? <span className="whitespace-pre-line">{texto(customer.notes)}</span> : <Vazio />}</Dado>
        </Dados>
      )}
    </Secao>
  );
}

// --- Página --------------------------------------------------------------------------

export function PaginaDoCliente(props: PaginaDoClienteProps) {
  const { row } = props;
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Caminho" className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
        <Link href={CUSTOMERS_PATH} className="rounded text-foreground underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco">
          Clientes
        </Link>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span aria-current="page" className="truncate">
          {row.name}
        </span>
      </nav>
      <Cabecalho row={row} zonas={props.zonas} pessoasLidas={props.pessoasLidas} contatosAtivos={props.contatosAtivos} onArquivar={props.onArquivar} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <SecaoOperacao row={row} comModulos={props.comModulos} recebimentoPorCaixa={props.recebimentoPorCaixa} onSalvar={props.onSalvar} />
        <SecaoArmazem row={row} zonas={props.zonas} ocupacao={props.ocupacao} />
        <SecaoPortal row={row} onSalvar={props.onSalvar} pessoas={props.pessoas} />
        <SecaoContrato row={row} onSalvar={props.onSalvar} />
        {props.avisos}
      </div>
    </div>
  );
}

/** O código da busca não é de nenhum cliente da lista. */
export function ClienteNaoEncontrado() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Caminho" className="flex items-center gap-1.5 text-sm font-bold">
        <Link href={CUSTOMERS_PATH} className="rounded text-foreground underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco">
          Clientes
        </Link>
      </nav>
      <p role="status" className="rounded-lg border border-border bg-card px-5 py-12 text-center text-sm font-bold text-muted-foreground">
        Cliente não encontrado
      </p>
    </div>
  );
}
