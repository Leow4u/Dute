import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, NotebookPen, Plus, X } from "lucide-react";

import { origemDaNota } from "@/lib/agente/anotacoes";
import { CHAVE_DAS_ANOTACOES, chaveNoAlvo, type AcaoDaRevisao, type ClienteDoAgente, type NotaDoAgente } from "@/lib/agente/cliente";
import { useClienteDoAgente } from "@/lib/agente/contexto";
import { LeituraDaListaDoAgente } from "@/components/agent/leitura-do-agente";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { useToast } from "@/hooks/use-toast";
import { useAcaoNaLinha, type AcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import { cn } from "@/lib/utils";

/**
 * Anotações que o Agent Dute sugeriu nas conversas. Pendentes não mudam
 * nenhuma resposta; a coordenação aprova (pode editar e escolher quem vê),
 * recusa ou arquiva. Cada decisão grava evento no backend. Com o agente do
 * núcleo, a coordenação também escreve a anotação aqui, e ela vale direto
 * (o antigo "Ensinar o Agent Dute" do painel, 04/11/2026).
 */

type Note = NotaDoAgente;

const MENOR_NOTA = 8;

/** A anotação escrita pela coordenação: o texto e quem o agente considera; vale direto. */
export function NewNote({ escrever }: { escrever: NonNullable<ClienteDoAgente["anotacoes"]["escrever"]> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const agente = useClienteDoAgente();
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<Note["visibility"]>("equipe");
  // A anotação nova é uma linha só: "Salvar" no relógio do carregamento v2 (Salvando…, Salva, Não salva).
  const save = useAcaoNaLinha<"nova">();
  const short = text.trim().length < MENOR_NOTA;
  const salvar = () => {
    const nota = { text: text.trim(), visibility };
    void save.executar(
      "nova",
      "salvar",
      () =>
        escrever(nota).then(
          (resultado) => {
            toast({ title: "Anotação salva: o Agent Dute passa a considerar" });
            setText("");
            return resultado;
          },
          (error: unknown) => {
            toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" });
            throw error;
          },
        ),
      { releitura: () => queryClient.invalidateQueries({ queryKey: chaveNoAlvo(agente, CHAVE_DAS_ANOTACOES) }) },
    );
  };
  return (
    <form
      className="mt-4 rounded-xl border border-border/70 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!short && !save.ocupada("nova")) salvar();
      }}
    >
      <label htmlFor="agent-new-note" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Nova anotação
      </label>
      <textarea
        id="agent-new-note"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={300}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm focus-visible:outline-hidden focus-visible:border-primary"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Quem o agente considera">
          {(["todos", "equipe"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              onClick={() => setVisibility(value)}
              className={cn("rounded-md px-2.5 py-1", visibility === value ? "bg-foreground text-background" : "text-muted-foreground")}
            >
              {value === "todos" ? "Cliente e equipe" : "Só equipe"}
            </button>
          ))}
        </div>
        <BotaoDeAcao
          type="submit"
          size="sm"
          estado={save.estado("nova", "salvar")}
          icone={<Plus className="h-3.5 w-3.5" />}
          rotulo="Salvar"
          andamento="Salvando…"
          sucesso="Salva"
          erro="Não salva"
          bloqueado={short && !save.ocupada("nova")}
        />
      </div>
    </form>
  );
}

export function AgentNotes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const agente = useClienteDoAgente();
  const notesQueryKey = chaveNoAlvo(agente, CHAVE_DAS_ANOTACOES);
  const notes = useQuery({
    queryKey: notesQueryKey,
    queryFn: () => agente.anotacoes.listar(),
  });
  // A decisão é por anotação (carregamento v2, momento 4): aprovar uma deixa as outras livres.
  const decide = useAcaoNaLinha<string>();
  const decidir = ({ id, action, text, visibility }: { id: string; action: AcaoDaRevisao; text?: string; visibility?: Note["visibility"] }) =>
    void decide.executar(
      id,
      action,
      () =>
        agente.anotacoes.decidir(id, action, { text, visibility }).then(
          (resultado) => {
            toast({ title: action === "approve" ? "Anotação aprovada: o Agent Dute passa a considerar" : action === "reject" ? "Anotação recusada" : "Anotação arquivada" });
            return resultado;
          },
          (error: unknown) => {
            toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" });
            throw error;
          },
        ),
      { releitura: () => queryClient.invalidateQueries({ queryKey: notesQueryKey }) },
    );

  const list = notes.data?.notes ?? [];
  const pending = list.filter((note) => note.status === "pending");
  const active = list.filter((note) => note.status === "active");

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-4">
      <header className="flex items-start gap-3">
        <NotebookPen className="mt-0.5 h-5 w-5 text-agent" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Anotações do Agent Dute</h2>
          <p className="text-sm text-muted-foreground">
            O que o agente sugeriu lembrar nas conversas. Só passa a valer depois de aprovado.
          </p>
        </div>
      </header>

      {agente.anotacoes.escrever ? <NewNote escrever={agente.anotacoes.escrever} /> : null}

      <LeituraDaListaDoAgente leitura={notes} rotulo="Carregando anotações…" falha="Não foi possível carregar as anotações." className="mt-4">
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Para aprovar{pending.length ? ` · ${pending.length}` : ""}
          </h3>
          {pending.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {pending.map((note) => (
                <PendingNote key={note.id} note={note} acoes={decide} onDecide={(input) => decidir({ id: note.id, ...input })} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma sugestão esperando.</p>
          )}

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Valendo{active.length ? ` · ${active.length}` : ""}
          </h3>
          {active.length ? (
            <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70">
              {active.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {note.text}
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {note.visibility === "equipe" ? "só equipe" : "cliente e equipe"}
                    </span>
                  </span>
                  <BotaoDeAcao
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground max-md:min-h-12"
                    estado={decide.estado(note.id, "archive")}
                    rotulo="Arquivar"
                    andamento="Arquivando…"
                    sucesso="Arquivada"
                    erro="Não arquivada"
                    onClick={() => decidir({ id: note.id, action: "archive" })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma anotação valendo ainda.</p>
          )}
        </>
      </LeituraDaListaDoAgente>
    </section>
  );
}

function PendingNote({
  note,
  acoes,
  onDecide,
}: {
  note: Note;
  acoes: Pick<AcaoNaLinha<string>, "estado" | "ocupada">;
  onDecide: (input: { action: "approve" | "reject"; text?: string; visibility?: Note["visibility"] }) => void;
}) {
  const ocupada = acoes.ocupada(note.id);
  const recusar = acoes.estado(note.id, "reject");
  const aprovar = acoes.estado(note.id, "approve");
  const [text, setText] = useState(note.text);
  const [visibility, setVisibility] = useState(note.visibility);
  return (
    <li className="rounded-xl border border-agent-border bg-agent-soft p-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={300}
        rows={2}
        aria-label="Texto da anotação"
        className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm focus-visible:outline-hidden focus-visible:border-primary"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {[origemDaNota(note), note.reason ? `“${note.reason}”` : ""].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Quem o agente considera">
          {(["todos", "equipe"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              onClick={() => setVisibility(value)}
              className={cn("rounded-md px-2.5 py-1", visibility === value ? "bg-foreground text-background" : "text-muted-foreground")}
            >
              {value === "todos" ? "Cliente e equipe" : "Só equipe"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <BotaoDeAcao
            variant="outline"
            size="sm"
            // No celular, as ações da linha com 48 px (seção 7).
            className="max-md:min-h-12"
            estado={recusar}
            icone={<X className="h-3.5 w-3.5" />}
            rotulo="Recusar"
            andamento="Recusando…"
            sucesso="Recusada"
            erro="Não recusada"
            bloqueado={ocupada && recusar === "repouso"}
            onClick={() => onDecide({ action: "reject" })}
          />
          <BotaoDeAcao
            size="sm"
            className="max-md:min-h-12"
            estado={aprovar}
            icone={<Check className="h-3.5 w-3.5" />}
            rotulo="Aprovar"
            andamento="Aprovando…"
            sucesso="Aprovada"
            erro="Não aprovada"
            bloqueado={(ocupada && aprovar === "repouso") || (!ocupada && text.trim().length < MENOR_NOTA)}
            onClick={() => onDecide({ action: "approve", text: text.trim() !== note.text ? text.trim() : undefined, visibility })}
          />
        </div>
      </div>
    </li>
  );
}
