import { useState } from "react";
import { Check, CircleCheck, X } from "lucide-react";
import { Link } from "wouter";

import { CAIXA_DO_TOM, LinhaDoPrecisa, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { PageHeader } from "@/components/ui/page-header";
import { origemDaNota } from "@/lib/agente/anotacoes";
import type { NotaDoAgente } from "@/lib/agente/cliente";
import type { AcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import type { ItemDoInicio } from "@/lib/inicio-do-modulo";
import { cn } from "@/lib/utils";

/**
 * O painel do Agent Dute na v3 (proposta aprovada pelo Leonardo em
 * 04/11/2026, docs/mockups/AgentePainel.dc.html), só a apresentação: os dados
 * e a decisão chegam por props (pages/agente-painel.tsx).
 *
 * "Para decidir" são as linhas do agente no "Precisa de você" da Armazenagem,
 * na mesma ordem: a anotação se aprova aqui mesmo; o alerta de itens parados
 * e os playbooks levam à tela que resolve. Ao lado, o que vale no agente.
 * Sem legenda: só rótulos, dados e ações.
 */

export type AbaDoAgente = { href: string; rotulo: string; atual: boolean };

export type NumerosDoAgente = {
  anotacoes: number | null;
  playbooks: number | null;
  documentos: number | null;
  rotinas: number | null;
};

export type DecisaoDaNota = {
  id: string;
  acao: "approve" | "reject";
  /** O texto ajustado; sem ajuste, fica o da sugestão. */
  text?: string;
  visibility?: NotaDoAgente["visibility"];
};

export type PainelDoAgenteViewProps = {
  abas: readonly AbaDoAgente[];
  carregando: boolean;
  falhas: readonly string[];
  /** As linhas do agente no "Precisa de você", na ordem dele. */
  linhas: readonly ItemDoInicio[];
  /** As anotações para aprovar, que a linha das anotações abre aqui. */
  notas: readonly NotaDoAgente[];
  numeros: NumerosDoAgente;
  /**
   * A decisão de cada anotação (carregamento v2, momento 4): aprovar uma deixa
   * as outras livres; na anotação ocupada, a outra ação fica travada.
   */
  acoes: Pick<AcaoNaLinha<string>, "estado" | "ocupada">;
  decidir: (decisao: DecisaoDaNota) => void;
};

/** A linha das anotações no "Precisa de você" do Início, aberta aqui. */
export const LINHA_DAS_ANOTACOES = "agent-notes";

const TAMANHO_DA_NOTA = 300;
const MENOR_NOTA = 8;

export function AbasDoAgente({ abas }: { abas: readonly AbaDoAgente[] }) {
  return (
    <nav aria-label="Agent Dute" className="inline-flex self-start rounded-md bg-muted p-0.5">
      {abas.map((aba) => (
        <Link
          key={aba.href}
          href={aba.href}
          aria-current={aba.atual ? "page" : undefined}
          className={cn(
            "flex min-h-9 items-center rounded-sm px-3.5 text-sm font-bold",
            aba.atual ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {aba.rotulo}
        </Link>
      ))}
    </nav>
  );
}

function NotaParaAprovar({ nota, acoes, decidir }: { nota: NotaDoAgente } & Pick<PainelDoAgenteViewProps, "acoes" | "decidir">) {
  const [texto, setTexto] = useState(nota.text);
  const [visibilidade, setVisibilidade] = useState(nota.visibility);
  const campo = `nota-${nota.id}`;
  const curta = texto.trim().length < MENOR_NOTA;
  const ocupada = acoes.ocupada(nota.id);
  const recusar = acoes.estado(nota.id, "reject");
  const aprovar = acoes.estado(nota.id, "approve");
  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-agent-border bg-agent-soft p-3.5">
      <label htmlFor={campo} className="sr-only">
        Texto da anotação
      </label>
      <textarea
        id={campo}
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        maxLength={TAMANHO_DA_NOTA}
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <p className="text-sm text-muted-foreground">{origemDaNota(nota)}</p>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div role="group" aria-label="Quem o agente considera" className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(["todos", "equipe"] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              aria-pressed={visibilidade === valor}
              onClick={() => setVisibilidade(valor)}
              className={cn(
                "min-h-9 rounded-sm px-3 text-sm font-semibold",
                visibilidade === valor ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {valor === "todos" ? "Cliente e equipe" : "Só equipe"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <BotaoDeAcao
            variant="outline"
            size="sm"
            estado={recusar}
            icone={<X aria-hidden="true" />}
            rotulo="Recusar"
            andamento="Recusando…"
            sucesso="Recusada"
            erro="Não recusada"
            bloqueado={ocupada && recusar === "repouso"}
            onClick={() => decidir({ id: nota.id, acao: "reject" })}
          />
          <BotaoDeAcao
            tinta
            size="sm"
            estado={aprovar}
            icone={<Check aria-hidden="true" />}
            rotulo="Aprovar"
            andamento="Aprovando…"
            sucesso="Aprovada"
            erro="Não aprovada"
            bloqueado={(ocupada && aprovar === "repouso") || (!ocupada && curta)}
            onClick={() =>
              decidir({ id: nota.id, acao: "approve", text: texto.trim() !== nota.text ? texto.trim() : undefined, visibility: visibilidade })
            }
          />
        </div>
      </div>
    </li>
  );
}

function LinhaDasAnotacoes({ item, notas, acoes, decidir }: { item: ItemDoInicio } & Pick<PainelDoAgenteViewProps, "notas" | "acoes" | "decidir">) {
  const Icone = item.icon;
  return (
    <li className="flex gap-4 border-t border-border px-5 py-4 first:border-t-0 md:px-6">
      <span className={cn("flex size-13 shrink-0 items-center justify-center rounded-lg border", CAIXA_DO_TOM[item.tone])}>
        <Icone className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="flex min-h-13 items-center text-base font-bold text-foreground">{item.title}</p>
        <ul className="flex flex-col gap-2.5">
          {notas.map((nota) => (
            <NotaParaAprovar key={nota.id} nota={nota} acoes={acoes} decidir={decidir} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function LinhaDoNumero({ href, rotulo, valor }: { href: string; rotulo: string; valor: number | null }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link href={href} className="flex items-center justify-between gap-3 px-5 py-3.5 text-base font-semibold text-foreground hover:bg-surface-hover">
        <span>{rotulo}</span>
        <span className="text-2xl font-extrabold tabular-nums">{valor ?? "—"}</span>
      </Link>
    </li>
  );
}

/** A linha do "Para decidir" que ainda lê: a caixa do ícone, o título e o apoio, em blocos neutros. */
function LinhaFantasma() {
  return (
    <div className="flex items-center gap-4 border-t border-border px-5 py-4 first:border-t-0 md:px-6">
      <Esqueleto forma="icone" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Esqueleto forma="texto" className="w-2/5" />
        <Esqueleto forma="texto" className="h-2.5 w-3/5" />
      </div>
    </div>
  );
}

export function PainelDoAgenteView({ abas, carregando, falhas, linhas, notas, numeros, acoes, decidir }: PainelDoAgenteViewProps) {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="Agent Dute">
        <AbasDoAgente abas={abas} />
      </PageHeader>

      {falhas.length ? (
        <p role="alert" className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-soft-foreground">
          Não foi possível carregar: {falhas.join(", ")}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-7">
        <section aria-labelledby="para-decidir" className="flex min-w-0 flex-[2.2_1_560px] flex-col gap-3.5">
          <TituloDaSecao id="para-decidir">Para decidir</TituloDaSecao>
          {carregando ? (
            <CartaoComBrilho className="rounded-lg border border-border bg-card">
              {[0, 1, 2].map((linha) => (
                <LinhaFantasma key={linha} />
              ))}
            </CartaoComBrilho>
          ) : linhas.length ? (
            <ul className="rounded-lg border border-border bg-card">
              {linhas.map((item, indice) =>
                item.id === LINHA_DAS_ANOTACOES ? (
                  <LinhaDasAnotacoes key={item.id} item={item} notas={notas} acoes={acoes} decidir={decidir} />
                ) : (
                  <LinhaDoPrecisa key={item.id} item={item} principal={indice === 0} />
                ),
              )}
            </ul>
          ) : (
            <p className="flex items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 text-base font-bold text-foreground md:px-6">
              <span className="flex size-13 shrink-0 items-center justify-center rounded-lg border border-success-soft-border bg-success-soft text-success-soft-foreground">
                <CircleCheck className="size-5" aria-hidden="true" />
              </span>
              Nada para decidir
            </p>
          )}
        </section>

        <section aria-labelledby="no-agente" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <TituloDaSecao id="no-agente">No agente</TituloDaSecao>
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            <LinhaDoNumero href="/agente/conhecimento" rotulo="Anotações valendo" valor={numeros.anotacoes} />
            <LinhaDoNumero href="/agente/conhecimento" rotulo="Playbooks valendo" valor={numeros.playbooks} />
            <LinhaDoNumero href="/agente/conhecimento" rotulo="Documentos" valor={numeros.documentos} />
            <LinhaDoNumero href="/agente?v=rotinas" rotulo="Suas rotinas" valor={numeros.rotinas} />
          </ul>
        </section>
      </div>
    </div>
  );
}
