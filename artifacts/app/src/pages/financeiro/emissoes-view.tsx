import { formatarReais } from "@workspace/dominio";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dataBr } from "@/lib/comercial/clientes";
import {
  ETAPA_ROTULO,
  MOTIVO_ROTULO,
  acoesDaEmissao,
  gruposDasEmissoes,
  itensDaEmissao,
  type AcaoDaEmissao,
  type EmissaoDoFinanceiro,
} from "@/lib/financeiro/emissoes";
import { cn } from "@/lib/utils";

/**
 * Financeiro › Emissões (Fase 7, parte 7.4f): as NFS-e pedidas à Omie, das
 * que precisam de uma pessoa (rejeitada pela prefeitura ou parada) às que
 * andam sozinhas e às concluídas. Os dados e as ações chegam por props
 * (pages/financeiro/emissoes.tsx). Sem legenda: rótulos, dados e ações; as
 * ações são da linha, nenhuma é a principal da tela.
 */

export type EstadoDasEmissoes = "carregando" | "erro" | "pronto";

export type AcoesDasEmissoes = {
  pedir: (id: string, acao: AcaoDaEmissao) => void;
  confirmarDesistencia: () => void;
  desistirDeDesistir: () => void;
};

export type EmissoesViewProps = {
  estado: EstadoDasEmissoes;
  emissoes: readonly EmissaoDoFinanceiro[];
  /** A emissão com a desistência aberta para confirmar. */
  desistindo: string | null;
  ocupado: boolean;
  aviso: string | null;
  falha: string | null;
  acoes: AcoesDasEmissoes;
};

const TOM_CRITICO = "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
const TOM_ANDAMENTO = "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
const TOM_OK = "border-success-soft-border bg-success-soft text-success-soft-foreground";
const TOM_NEUTRO = "border-border bg-muted text-muted-foreground";

function tomDaEtapa(emissao: EmissaoDoFinanceiro): string {
  if (emissao.etapa === "rejeitada" || emissao.etapa === "parada") return TOM_CRITICO;
  if (emissao.etapa === "autorizada") return TOM_OK;
  if (emissao.etapa === "desistida") return TOM_NEUTRO;
  return TOM_ANDAMENTO;
}

function Contador({ children }: { children: number }) {
  return <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-2 text-xs font-bold text-foreground">{children}</span>;
}

function Linha({ emissao, primeira, props }: { emissao: EmissaoDoFinanceiro; primeira: boolean; props: EmissoesViewProps }) {
  const { desistindo, ocupado, acoes } = props;
  const titulo = emissao.etapa === "autorizada" && emissao.nfse ? `${emissao.cliente} · NFS-e ${emissao.nfse.replace(/^0+(?=\d)/, "")}` : emissao.cliente;
  const mensagens = emissao.etapa === "rejeitada" ? emissao.mensagens.filter((mensagem) => mensagem.descricao || mensagem.correcao) : [];
  const confirmando = desistindo === emissao.id;
  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5", !primeira && "border-t border-muted")}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-extrabold">{titulo}</span>
        <span className="text-sm font-semibold text-muted-foreground">{itensDaEmissao(emissao)}</span>
        <span className="text-xs font-semibold text-muted-foreground">Vence em {dataBr(emissao.vencimento)}</span>
        {emissao.etapa === "parada" && emissao.motivo ? <span className="text-sm font-bold">{MOTIVO_ROTULO[emissao.motivo]}</span> : null}
        {emissao.etapa === "parada" && emissao.mensagem ? <span className="text-sm font-semibold text-muted-foreground">{emissao.mensagem}</span> : null}
        {mensagens.length
          ? mensagens.map((mensagem, indice) => (
              <span key={`${mensagem.codigo}-${indice}`} className="text-sm font-semibold text-muted-foreground">
                {[mensagem.descricao, mensagem.correcao].filter(Boolean).join(" ")}
              </span>
            ))
          : emissao.etapa === "rejeitada" && emissao.mensagem
            ? <span className="text-sm font-semibold text-muted-foreground">{emissao.mensagem}</span>
            : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-base font-extrabold tabular-nums">{formatarReais(emissao.totalCents)}</span>
        <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", tomDaEtapa(emissao))}>{ETAPA_ROTULO[emissao.etapa]}</span>
      </div>
      {emissao.etapa === "autorizada" && emissao.urlPdf ? (
        <div className="flex w-full justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={emissao.urlPdf} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Abrir a NFS-e
            </a>
          </Button>
        </div>
      ) : null}
      {acoesDaEmissao(emissao).length ? (
        <div className="flex w-full flex-wrap justify-end gap-2">
          {confirmando ? (
            <>
              <Button type="button" variant="destructive" size="sm" onClick={acoes.confirmarDesistencia} disabled={ocupado}>
                Confirmar desistência
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={acoes.desistirDeDesistir} disabled={ocupado}>
                Voltar
              </Button>
            </>
          ) : (
            acoesDaEmissao(emissao).map((acao) => (
              <Button key={acao} type="button" variant="outline" size="sm" onClick={() => acoes.pedir(emissao.id, acao)} disabled={ocupado} aria-label={`${acao === "retomar" ? "Tentar de novo" : "Desistir"}, ${emissao.cliente}`}>
                {acao === "retomar" ? "Tentar de novo" : "Desistir"}
              </Button>
            ))
          )}
        </div>
      ) : null}
    </li>
  );
}

function Secao({ id, titulo, emissoes, props }: { id: string; titulo: string; emissoes: readonly EmissaoDoFinanceiro[]; props: EmissoesViewProps }) {
  if (!emissoes.length) return null;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-3.5">
        <h2 id={id} className="text-base font-extrabold">
          {titulo}
        </h2>
        <Contador>{emissoes.length}</Contador>
      </div>
      <ul>
        {emissoes.map((emissao, indice) => (
          <Linha key={emissao.id} emissao={emissao} primeira={indice === 0} props={props} />
        ))}
      </ul>
    </section>
  );
}

export function EmissoesView(props: EmissoesViewProps) {
  const { estado, emissoes, aviso, falha } = props;
  const grupos = gruposDasEmissoes(emissoes);
  let conteudo;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar as emissões.</Vazio>;
  else if (!emissoes.length) conteudo = <Vazio>Nenhuma emissão</Vazio>;
  else
    conteudo = (
      <>
        <Secao id="precisam" titulo="Precisam de você" emissoes={grupos.precisam} props={props} />
        <Secao id="andamento" titulo="Em andamento" emissoes={grupos.andamento} props={props} />
        <Secao id="concluidas" titulo="Concluídas" emissoes={grupos.concluidas} props={props} />
      </>
    );
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Emissões</h1>
      </header>
      {aviso ? (
        <p role="status" className="text-sm font-bold text-success-soft-foreground">
          {aviso}
        </p>
      ) : null}
      {falha ? (
        <p role="alert" className="text-sm font-bold text-destructive-soft-foreground">
          {falha}
        </p>
      ) : null}
      {conteudo}
    </div>
  );
}

function Vazio({ children }: { children: string }) {
  return <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}
