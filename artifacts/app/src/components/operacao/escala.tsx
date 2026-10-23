import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar } from "@/components/operacao/partes";
import { rotuloDaDemandaFora, type AgendaEmEdicao, type OsDaFila } from "@/lib/operacao/fila";

/**
 * Escalar a OS (parte 3.5a), no Hoje e na Agenda (parte 3.6b): o formulário
 * no painel lateral. Só apresentação; as leituras e a gravação estão em
 * pages/operacao/use-escala.tsx.
 */

export type PessoaDaEquipe = { id: string; nome: string; funcao: string; ativo: boolean };

export type VeiculoDaAgenda = { id: string; placa: string; tipo: string; ativo: boolean };

/** O painel de escalar aberto: o título, o cliente, o formulário e como fechar. */
export type EscalaAberta = { titulo: string; cliente: string; conteudo: ReactNode; onFechar: () => void };

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

/**
 * Escalar a OS: data, hora, equipe e veículo. Sem equipe ou sem veículo, a OS
 * agenda e o Início avisa (parte 3.4b); a tela de Planejar OS, com o papel de
 * cada pessoa e vários veículos, é da parte 3.6. Cancelar pede o motivo.
 */
export function EscalaDaOs({
  os,
  pessoas,
  veiculos,
  agenda,
  onAgenda,
  onSalvar,
  onCancelar,
  ocupado,
  erro,
}: {
  os: OsDaFila;
  pessoas: readonly PessoaDaEquipe[];
  veiculos: readonly VeiculoDaAgenda[];
  agenda: AgendaEmEdicao;
  onAgenda: (agenda: AgendaEmEdicao) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const fora = os.demandaFora ?? null;
  const podeSalvar = !fora && Boolean(agenda.data);
  function alternar(id: string, marcado: boolean) {
    const equipe = marcado ? [...agenda.equipe, id] : agenda.equipe.filter((atual) => atual !== id);
    onAgenda({ ...agenda, equipe });
  }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (podeSalvar) onSalvar();
      }}
    >
      {fora ? <p className="text-sm font-semibold text-destructive">{rotuloDaDemandaFora(fora)}</p> : null}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      {fora ? null : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="os-data" rotulo="Data">
              <Input id="os-data" type="date" value={agenda.data} onChange={(event) => onAgenda({ ...agenda, data: event.target.value })} />
            </Campo>
            <Campo id="os-hora" rotulo="Hora">
              <Input id="os-hora" type="time" value={agenda.hora} onChange={(event) => onAgenda({ ...agenda, hora: event.target.value })} />
            </Campo>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">Equipe</legend>
            {pessoas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum colaborador ativo</p> : null}
            <ul className="flex flex-col gap-2">
              {pessoas.map((pessoa) => (
                <li key={pessoa.id}>
                  <label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={agenda.equipe.includes(pessoa.id)}
                      onChange={(event) => alternar(pessoa.id, event.target.checked)}
                    />
                    <Avatar nome={pessoa.nome} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{pessoa.nome}</span>
                      <span className="block truncate text-muted-foreground">{pessoa.ativo ? pessoa.funcao : `${pessoa.funcao} · Desativado`}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Campo id="os-veiculo" rotulo="Veículo">
            <select
              id="os-veiculo"
              className={campoClasse}
              value={agenda.veiculoId}
              onChange={(event) => onAgenda({ ...agenda, veiculoId: event.target.value })}
            >
              <option value="">Sem veículo</option>
              {veiculos.map((veiculo) => (
                <option key={veiculo.id} value={veiculo.id}>
                  {veiculo.ativo ? `${veiculo.placa} · ${veiculo.tipo}` : `${veiculo.placa} · ${veiculo.tipo} · Desativado`}
                </option>
              ))}
            </select>
          </Campo>
          <Button type="submit" disabled={ocupado || !podeSalvar}>
            {os.status === "agendada" ? "Salvar" : "Agendar"}
          </Button>
        </>
      )}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <Campo id="os-motivo" rotulo="Motivo do cancelamento">
          <Input id="os-motivo" value={agenda.motivo} onChange={(event) => onAgenda({ ...agenda, motivo: event.target.value })} />
        </Campo>
        <Button type="button" variant="outline" disabled={ocupado || agenda.motivo.trim().length < 3} onClick={onCancelar}>
          Cancelar OS
        </Button>
      </div>
    </form>
  );
}

export function PainelDaEscala({ escala }: { escala: EscalaAberta | null }) {
  return (
    <Sheet open={Boolean(escala)} onOpenChange={(aberto) => (aberto ? null : escala?.onFechar())}>
      <SheetContent className="w-full overflow-y-auto bg-card sm:max-w-md">
        {escala ? (
          <>
            <SheetHeader className="mb-5 text-left">
              <SheetTitle>{escala.titulo}</SheetTitle>
              <SheetDescription>{escala.cliente}</SheetDescription>
            </SheetHeader>
            {escala.conteudo}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
