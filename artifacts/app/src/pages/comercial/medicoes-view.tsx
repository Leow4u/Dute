import type { ReactNode } from "react";
import { BookOpen, Check, MapPin, Paperclip, Plus, RotateCcw, Send, TriangleAlert } from "lucide-react";

import { AbasDoComercial } from "@/components/comercial/abas-do-comercial";
import { Button } from "@/components/ui/button";
import { dataBr, type CadastroComercial, type Carga } from "@/lib/comercial/clientes";
import { nomeDoCliente, nomesDosClientes, type Contrato } from "@/lib/comercial/contratos";
import {
  acoesDaMedicao,
  anexosDaMedicao,
  diasDaCompetencia,
  itemParaAplicar,
  linkDoAnexo,
  marcasDaLinha,
  prazoDeEnvio,
  resumoPorItem,
  rotuloDaCompetencia,
  rotuloDoAplicar,
  rotuloDoFrete,
  seloDaMedicao,
  veiculoEAjudantes,
  type ChipDeCompetencia,
  type LinhaDaMedicao,
  type Medicao,
  type SituacaoDaCompetencia,
  type TabelaDaLinha,
  type TomDaMedicao,
} from "@/lib/comercial/medicoes";
import { dataHoraCurta } from "@/lib/comercial/orcamentos";
import { formatarReais } from "@workspace/dominio";
import { cn } from "@/lib/utils";

/**
 * Aba Medições do Comercial (docs/mockups/ComMedicaoMensal.dc.html; parte 16b
 * de docs/plataforma/fase-6-comercial.md), só a apresentação: os dados e as
 * ações chegam por props (pages/comercial/medicoes.tsx). Conteúdo na
 * identidade v3 (.v3 em index.css) dentro do layout de hoje. Sem legenda:
 * rótulos, dados e ações; uma ação principal por situação da medição.
 */

export type AcoesDasMedicoes = {
  /** Abre a medição da competência (saveMedicao create). */
  abrir: () => void;
  enviar: () => void;
  aprovar: () => void;
  contestar: () => void;
  reabrir: () => void;
  exportar: () => void;
  novaLinha: () => void;
  editarLinha: (linhaId: string) => void;
  /** "Aplicar sábado": troca o item de diária pelo que a tabela tem para o dia. */
  aplicar: (linhaId: string, lpuItemId: string) => void;
  anexar: (linhaId: string) => void;
};

export type MedicoesViewProps = {
  estado: "carregando" | "erro" | "pronto";
  /** Os contratos que cobram por medição mensal. */
  contratos: Contrato[];
  /** Cadastro (`customers`): o nome do cliente de cada contrato. */
  clientes: CadastroComercial[];
  contrato: Contrato | null;
  onContrato: (id: string) => void;
  /** "AAAA-MM-DD" do dia. */
  hoje: string;
  chips: ChipDeCompetencia[];
  competencia: string;
  onCompetencia: (competencia: string) => void;
  /** A medição da competência: null quando ainda não foi aberta. */
  medicao: Medicao | null | "carregando" | "erro";
  /** As tabelas do contrato: só o nome delas aparece aqui. */
  tabelas: Carga<TabelaDaLinha>;
  /** Uma gravação em andamento: as ações esperam. */
  ocupado: boolean;
  /** A medição mudou enquanto a pessoa agia: a mensagem do servidor, com os dados já recarregados. */
  aviso: string | null;
  acoes: AcoesDasMedicoes;
  /** Telas do Comercial que já existem (barra de abas); o padrão é a do app. */
  telas?: readonly string[];
};

const TOM: Record<TomDaMedicao, string> = {
  ok: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  atencao: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  critico: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  neutro: "border-border bg-muted text-muted-foreground",
};

function Selo({ situacao }: { situacao: SituacaoDaCompetencia }) {
  const selo = seloDaMedicao(situacao);
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM[selo.tom])}>
      {selo.rotulo}
    </span>
  );
}

function Marca({ tom, children, icone }: { tom: "critico" | "atencao"; children: ReactNode; icone: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM[tom])}>
      {icone}
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

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}

function TituloDoCartao({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wider">{titulo}</h3>
      {children}
    </div>
  );
}

// --- Seletores ---------------------------------------------------------------------------

function SeletorDeContrato({ contratos, contrato, clientes, onContrato }: Pick<MedicoesViewProps, "contratos" | "contrato" | "clientes" | "onContrato">) {
  const nomes = nomesDosClientes(clientes);
  return (
    <div role="group" aria-label="Contrato" className="flex flex-wrap gap-2.5">
      {contratos.map((item) => {
        const ativo = item.id === contrato?.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => onContrato(item.id)}
            className={cn(
              "flex min-w-48 flex-col items-start gap-0.5 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
              ativo ? "border-foreground ring-1 ring-foreground" : "border-border hover:bg-surface-hover",
            )}
          >
            <b className="text-sm font-extrabold">{nomeDoCliente(nomes, item.dados.customer_code)}</b>
            <span className="text-xs font-semibold text-muted-foreground">{item.dados.nome}</span>
          </button>
        );
      })}
    </div>
  );
}

function Competencias({ chips, competencia, onCompetencia }: Pick<MedicoesViewProps, "chips" | "competencia" | "onCompetencia">) {
  return (
    <div role="group" aria-label="Competência" className="flex flex-wrap gap-2.5">
      {chips.map((chip) => {
        const ativo = chip.competencia === competencia;
        return (
          <button
            key={chip.competencia}
            type="button"
            aria-pressed={ativo}
            onClick={() => onCompetencia(chip.competencia)}
            className={cn(
              "flex min-w-48 flex-col items-start gap-1.5 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
              ativo ? "border-foreground ring-1 ring-foreground" : "border-border hover:bg-surface-hover",
            )}
          >
            <b className="text-sm font-extrabold">{chip.rotulo}</b>
            <Selo situacao={chip.situacao} />
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">{chip.resumo}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Cabeçalho ----------------------------------------------------------------------------------

function Fato({ rotulo, valor, sub, tom }: { rotulo: string; valor: string; sub?: string | null; tom?: "critico" }) {
  return (
    <div className="flex min-w-36 flex-1 basis-36 flex-col gap-0.5">
      <span className="text-xs font-bold text-muted-foreground">{rotulo}</span>
      <b className="text-lg font-extrabold tabular-nums">{valor}</b>
      {sub ? <i className={cn("text-xs font-semibold not-italic", tom === "critico" ? "text-destructive-soft-foreground" : "text-muted-foreground")}>{sub}</i> : null}
    </div>
  );
}

function periodoDasLinhas(linhas: readonly LinhaDaMedicao[]): string | null {
  if (linhas.length === 0) return null;
  const datas = linhas.map((linha) => linha.executada_em).sort();
  const de = dataBr(datas[0]).slice(0, 5);
  const ate = dataBr(datas[datas.length - 1]).slice(0, 5);
  return de === ate ? de : `${de} a ${ate}`;
}

function nomesDasTabelas(linhas: readonly LinhaDaMedicao[], tabelas: Carga<TabelaDaLinha>): string[] {
  if (!Array.isArray(tabelas)) return [];
  const ids = new Set(linhas.map((linha) => linha.tabela_id).filter((id): id is string => Boolean(id)));
  return tabelas.filter((tabela) => ids.has(tabela.id)).map((tabela) => tabela.nome);
}

function Marcador({ children, href }: { children: ReactNode; href?: string | null }) {
  const corpo = (
    <>
      <Check aria-hidden="true" className="size-4 text-success-soft-foreground" />
      {children}
    </>
  );
  const classes = "inline-flex h-10 items-center gap-1.5 text-sm font-bold";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(classes, "underline underline-offset-4")}>
      {corpo}
    </a>
  ) : (
    <span className={classes}>{corpo}</span>
  );
}

function Cabecalho(props: MedicoesViewProps & { medicao: Medicao | null; cliente: string }) {
  const { medicao, cliente, competencia, contrato, hoje, tabelas, ocupado, acoes } = props;
  const dias = diasDaCompetencia(competencia);
  const linhas = medicao?.linhas ?? [];
  const prazo = prazoDeEnvio(competencia, hoje);
  const status = medicao?.status ?? null;
  const permitidas = status ? acoesDaMedicao(status, linhas.length) : null;
  const nomesDaTabela = medicao ? nomesDasTabelas(linhas, tabelas) : [];
  const principal = (rotulo: string, aoClicar: () => void, opcoes: { desabilitado?: boolean; icone?: ReactNode } = {}) => (
    <Button type="button" onClick={aoClicar} disabled={ocupado || opcoes.desabilitado}>
      {opcoes.icone}
      {rotulo}
    </Button>
  );
  return (
    <section
      aria-label={`Medição ${cliente} ${rotuloDaCompetencia(competencia)}`}
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-extrabold tracking-tight">
            {cliente} · {rotuloDaCompetencia(competencia)}
          </h2>
          <Selo situacao={status ?? "nao_aberta"} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {permitidas ? (
            <Button type="button" variant="outline" onClick={acoes.exportar} disabled={ocupado || linhas.length === 0}>
              <BookOpen aria-hidden="true" />
              Exportar Diário de Bordo
            </Button>
          ) : null}
          {status === "rascunho" ? principal("Enviar ao cliente", acoes.enviar, { desabilitado: !permitidas?.podeEnviar, icone: <Send aria-hidden="true" /> }) : null}
          {status === "enviada" ? (
            <>
              <Marcador>Enviada {dataHoraCurta(medicao?.enviada_em ?? null) ?? ""}</Marcador>
              <Button type="button" variant="outline" onClick={acoes.contestar} disabled={ocupado}>
                Registrar contestação
              </Button>
              {principal("Registrar aprovação", acoes.aprovar)}
            </>
          ) : null}
          {status === "contestada" ? principal("Reabrir", acoes.reabrir, { icone: <RotateCcw aria-hidden="true" /> }) : null}
          {status === "aprovada" ? (
            <Marcador href={medicao?.aprovacao?.link && linkDoAnexo(medicao.aprovacao.link)}>
              Aprovada {dataHoraCurta(medicao?.aprovada_em ?? null) ?? ""}
            </Marcador>
          ) : null}
          {status === null ? principal("Abrir medição", acoes.abrir) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <Fato rotulo="Competência" valor={rotuloDaCompetencia(competencia)} sub={`${dias.de.slice(8)} a ${dataBr(dias.ate).slice(0, 5)}`} />
        <Fato rotulo="Contrato" valor={contrato?.dados.nome ?? "—"} sub="Medição mensal" />
        {medicao ? (
          <>
            <Fato rotulo="Demandas" valor={String(linhas.length)} sub={periodoDasLinhas(linhas)} />
            <Fato rotulo="Total" valor={formatarReais(medicao.total_cents)} sub={nomesDaTabela.length ? nomesDaTabela.join(" · ") : medicao.variante} />
          </>
        ) : null}
        <Fato rotulo="Envio até" valor={prazo.rotulo} sub={status === null || status === "rascunho" ? prazo.quando : null} tom={prazo.atrasado && (status === null || status === "rascunho") ? "critico" : undefined} />
      </div>
    </section>
  );
}

// --- Linhas -------------------------------------------------------------------------------------

function LinhaDaTabela({ linha, editavel, ocupado, acoes }: { linha: LinhaDaMedicao; editavel: boolean; ocupado: boolean; acoes: AcoesDasMedicoes }) {
  const marcas = marcasDaLinha(linha);
  const itens = veiculoEAjudantes(linha);
  const aplicar = itemParaAplicar(linha);
  const marcaDeDia = marcas.find((marca) => marca.marca === "dia_nao_bate_tarifa");
  const marcaDeRota = marcas.find((marca) => marca.marca === "rota_fora_da_tabela");
  const marcaDeAnexo = marcas.find((marca) => marca.marca === "sem_pedido_anexo");
  return (
    <tr className={cn("border-b border-muted align-top last:border-b-0", marcas.length > 0 && "bg-warning-soft/50")}>
      <td className="py-3 pl-5 pr-3">
        {editavel ? (
          <button
            type="button"
            aria-label={`Editar ${linha.os}`}
            onClick={() => acoes.editarLinha(linha.id)}
            className="block text-left font-extrabold tabular-nums underline-offset-4 hover:underline"
          >
            {linha.os}
          </button>
        ) : (
          <b className="block font-extrabold tabular-nums">{linha.os}</b>
        )}
        <span className="block text-xs font-semibold text-muted-foreground">
          {dataBr(linha.solicitada_em).slice(0, 5)} · {linha.area_solicitante}
        </span>
        {marcaDeAnexo ? (
          <div className="mt-1.5">
            <Marca tom={marcaDeAnexo.tom} icone={<Paperclip aria-hidden="true" className="size-3.5" />}>
              {marcaDeAnexo.texto}
            </Marca>
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <b className="block text-sm font-bold">{rotuloDoFrete(linha)}</b>
        {marcaDeDia ? (
          <div className="mt-1.5">
            <Marca tom={marcaDeDia.tom} icone={<TriangleAlert aria-hidden="true" className="size-3.5" />}>
              {marcaDeDia.texto}
            </Marca>
          </div>
        ) : null}
        {editavel && aplicar?.lpu_item_id ? (
          <div className="mt-1.5 flex">
            <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => acoes.aplicar(linha.id, aplicar.lpu_item_id as string)}>
              {rotuloDoAplicar(linha)}
            </Button>
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3">
        {itens.veiculo ? <b className="block text-sm font-bold">{itens.veiculo}</b> : null}
        {itens.ajudantes ? <span className="block text-xs font-semibold text-muted-foreground">{itens.ajudantes}</span> : null}
        {itens.outros ? <span className="block text-xs font-semibold text-muted-foreground">{itens.outros}</span> : null}
      </td>
      <td className="px-3 py-3">
        <b className="block text-sm font-bold">
          {linha.origem} → {linha.destino}
        </b>
        <span className="block text-xs font-semibold text-muted-foreground">{linha.mercadoria}</span>
        {marcaDeRota ? (
          <div className="mt-1.5">
            <Marca tom={marcaDeRota.tom} icone={<MapPin aria-hidden="true" className="size-3.5" />}>
              {marcaDeRota.texto}
            </Marca>
          </div>
        ) : null}
      </td>
      <td className="py-3 pl-3 pr-5 text-right tabular-nums">
        <b className="block text-sm font-bold">{formatarReais(linha.total_cents)}</b>
      </td>
    </tr>
  );
}

function Linhas({ medicao, editavel, ocupado, acoes, nomesDaTabela }: { medicao: Medicao; editavel: boolean; ocupado: boolean; acoes: AcoesDasMedicoes; nomesDaTabela: string[] }) {
  const n = medicao.linhas.length;
  return (
    <section aria-label="Demandas do mês" className="flex min-w-0 flex-[2.4_1_36rem] flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card">
      <TituloDoCartao titulo="Demandas do mês">
        <span className="flex flex-wrap items-center gap-2">
          {nomesDaTabela.length ? <Pill>{nomesDaTabela.join(" · ")}</Pill> : null}
          {editavel ? (
            <Button type="button" variant="outline" size="sm" onClick={acoes.novaLinha} disabled={ocupado}>
              <Plus aria-hidden="true" />
              Nova linha
            </Button>
          ) : null}
        </span>
      </TituloDoCartao>
      {n === 0 ? (
        <Vazio>Nenhuma OS nesta medição</Vazio>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold text-muted-foreground">
                <th className="py-2.5 pl-5 pr-3 font-bold">OS · solicitação</th>
                <th className="px-3 py-2.5 font-bold">Frete</th>
                <th className="px-3 py-2.5 font-bold">Veículo · ajudantes</th>
                <th className="px-3 py-2.5 font-bold">Origem → destino · mercadoria</th>
                <th className="py-2.5 pl-3 pr-5 text-right font-bold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {medicao.linhas.map((linha) => (
                <LinhaDaTabela key={linha.id} linha={linha} editavel={editavel} ocupado={ocupado} acoes={acoes} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 px-5 pb-4 pt-1 text-base font-extrabold">
        <span>
          Total · {n} {n === 1 ? "demanda" : "demandas"}
        </span>
        <b className="tabular-nums">{formatarReais(medicao.total_cents)}</b>
      </div>
    </section>
  );
}

// --- Lateral ------------------------------------------------------------------------------------

function Resumo({ medicao }: { medicao: Medicao }) {
  const grupos = resumoPorItem(medicao.linhas);
  return (
    <section aria-label="Resumo por item" className="flex flex-col gap-3 rounded-lg border border-border bg-card pb-4">
      <TituloDoCartao titulo="Resumo por item" />
      {grupos.length === 0 ? <Vazio>Nenhum item</Vazio> : null}
      {grupos.map((grupo) => (
        <div key={grupo.titulo} className="flex flex-col gap-2">
          <h4 className="px-5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{grupo.titulo}</h4>
          {grupo.itens.map((item) => (
            <div key={`${item.rotulo}|${item.preco}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 px-5 text-sm">
              <span className="font-semibold">{item.rotulo}</span>
              <i className="font-semibold not-italic tabular-nums text-muted-foreground">
                {item.quantidade} × {item.preco}
              </i>
              <b className="min-w-24 text-right font-bold tabular-nums">{formatarReais(item.total_cents)}</b>
            </div>
          ))}
        </div>
      ))}
      {grupos.length ? (
        <div className="mx-5 mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-border pt-3 text-base">
          <span className="font-extrabold">Total</span>
          <b className="font-extrabold tabular-nums">{formatarReais(medicao.total_cents)}</b>
        </div>
      ) : null}
    </section>
  );
}

function Anexos({ medicao, editavel, ocupado, acoes }: { medicao: Medicao; editavel: boolean; ocupado: boolean; acoes: AcoesDasMedicoes }) {
  const anexos = anexosDaMedicao(medicao.linhas);
  return (
    <section aria-label="Pedidos anexados" className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wider">Pedidos anexados</h3>
        <span
          className={cn(
            "inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold",
            anexos.completo ? TOM.ok : anexos.total === 0 ? TOM.neutro : TOM.critico,
          )}
        >
          {anexos.anexados} de {anexos.total}
        </span>
      </div>
      {anexos.total === 0 ? <Vazio>Nenhuma OS nesta medição</Vazio> : null}
      {anexos.itens.map((anexo) => {
        const link = linkDoAnexo(anexo.referencia);
        return (
          <div key={anexo.linhaId} className="flex items-center gap-2.5 border-t border-muted px-5 py-2.5 text-sm">
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="min-w-0 break-all font-bold underline underline-offset-4">
                {anexo.nome}
              </a>
            ) : (
              <b className="min-w-0 break-all font-bold" title={anexo.referencia}>
                {anexo.nome}
              </b>
            )}
            <i className="ml-auto font-semibold not-italic tabular-nums text-muted-foreground">{dataBr(anexo.data).slice(0, 5)}</i>
          </div>
        );
      })}
      {anexos.faltando.map((falta) => (
        <div key={falta.linhaId} className={cn("flex items-center gap-2.5 border-t border-muted px-5 py-2.5 text-sm", TOM.critico)}>
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          <b className="font-bold">{falta.os} · faltando</b>
          {editavel ? (
            <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={ocupado} onClick={() => acoes.anexar(falta.linhaId)}>
              <Paperclip aria-hidden="true" />
              Anexar
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Pendentes({ medicao }: { medicao: Medicao }) {
  if (medicao.demandas_pendentes.length === 0) return null;
  return (
    <section aria-label="Demandas pendentes" className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-5 pb-3 pt-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wider">Demandas pendentes</h3>
      </div>
      {medicao.demandas_pendentes.map((pendente) => (
        <div key={pendente.numero} className="flex flex-wrap items-baseline gap-x-3 border-t border-muted px-5 py-2.5 text-sm">
          <b className="font-extrabold tabular-nums">{pendente.numero}</b>
          <span className="font-semibold text-muted-foreground">{pendente.motivo}</span>
        </div>
      ))}
    </section>
  );
}

function Contestacao({ medicao }: { medicao: Medicao }) {
  if (medicao.status !== "contestada" || !medicao.contestacao) return null;
  const quando = dataHoraCurta(medicao.contestacao.em);
  return (
    <section aria-label="Contestação" className={cn("flex flex-col gap-1 rounded-lg border px-5 py-3.5", TOM.critico)}>
      <b className="text-sm font-extrabold">{["Contestada pelo cliente", quando].filter(Boolean).join(" · ")}</b>
      <p className="whitespace-pre-line text-sm font-semibold">{medicao.contestacao.nota}</p>
    </section>
  );
}

function Corpo(props: MedicoesViewProps & { medicao: Medicao }) {
  const { medicao, tabelas, ocupado, acoes } = props;
  const editavel = acoesDaMedicao(medicao.status, medicao.linhas.length).editavel;
  return (
    <>
      <Contestacao medicao={medicao} />
      <div className="flex flex-wrap items-start gap-5">
        <Linhas medicao={medicao} editavel={editavel} ocupado={ocupado} acoes={acoes} nomesDaTabela={nomesDasTabelas(medicao.linhas, tabelas)} />
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-5">
          <Resumo medicao={medicao} />
          <Anexos medicao={medicao} editavel={editavel} ocupado={ocupado} acoes={acoes} />
          <Pendentes medicao={medicao} />
        </div>
      </div>
    </>
  );
}

export function MedicoesView(props: MedicoesViewProps) {
  const { estado, contratos, contrato, clientes, medicao, aviso, telas } = props;
  const cliente = contrato ? nomeDoCliente(nomesDosClientes(clientes), contrato.dados.customer_code) : "";
  let conteudo: ReactNode;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar os contratos.</Vazio>;
  else if (contratos.length === 0 || !contrato) conteudo = <Vazio>Nenhum contrato cobra por medição mensal</Vazio>;
  else {
    conteudo = (
      <>
        {contratos.length > 1 ? <SeletorDeContrato contratos={contratos} contrato={contrato} clientes={clientes} onContrato={props.onContrato} /> : null}
        <Competencias chips={props.chips} competencia={props.competencia} onCompetencia={props.onCompetencia} />
        {aviso ? (
          <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm font-bold", TOM.atencao)}>
            {aviso}
          </div>
        ) : null}
        {medicao === "carregando" ? <Vazio>Carregando...</Vazio> : null}
        {medicao === "erro" ? <Vazio>Não foi possível carregar a medição.</Vazio> : null}
        {medicao === null || (typeof medicao === "object" && medicao !== null) ? (
          <>
            <Cabecalho {...props} medicao={medicao} cliente={cliente} />
            {medicao ? <Corpo {...props} medicao={medicao} /> : null}
          </>
        ) : null}
      </>
    );
  }
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Comercial</h1>
        <AbasDoComercial telas={telas} />
      </header>
      {conteudo}
    </div>
  );
}
