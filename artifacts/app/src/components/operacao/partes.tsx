import { ChevronDown } from "lucide-react";

import type { StatusDaOs } from "@/lib/operacao/fila";
import { SERVICO_ROTULO, TIPO_ROTULO, iniciais, type TipoDaDemanda } from "@/lib/operacao/hoje";
import { cn } from "@/lib/utils";

/**
 * Peças das telas da Operação na v3 (Hoje, Demandas, Demanda): o selo do
 * tipo, os selos de dado, o filtro em pílula e o avatar com as iniciais.
 */

export type OpcaoDeFiltro = { valor: string; rotulo: string };

export const COR_DO_TIPO: Record<TipoDaDemanda, string> = {
  paraquedas: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  emergencial: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  planejada: "border-info-soft-border bg-info-soft text-info-soft-foreground",
};

export const ROTULO_DO_STATUS: Record<StatusDaOs, string> = {
  aberta: "Para agendar",
  agendada: "Agendada",
  em_execucao: "Em execução",
  em_revisao: "Em revisão",
  revisada: "Revisada",
  cancelada: "Cancelada",
};

/** A cor do status da OS, a mesma das colunas do Hoje. */
export const COR_DO_STATUS: Record<StatusDaOs, string> = {
  aberta: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  agendada: "border-violet-soft-border bg-violet-soft text-violet-soft-foreground",
  em_execucao: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  em_revisao: "border-teal-soft-border bg-teal-soft text-teal-soft-foreground",
  revisada: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelada: "border-transparent bg-muted text-muted-foreground",
};

export const selo = "inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-semibold";
export const seloNeutro = "border-border bg-muted text-foreground";
export const seloAlerta = "border-amber-soft-border bg-amber-soft text-amber-soft-foreground";

export function SeloDoTipo({ tipo }: { tipo: TipoDaDemanda }) {
  return <span className={cn(selo, COR_DO_TIPO[tipo])}>{TIPO_ROTULO[tipo]}</span>;
}

export function Avatar({ nome }: { nome: string }) {
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
      {iniciais(nome)}
    </span>
  );
}

export function Filtro({
  rotulo,
  todos,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  todos: string;
  valor: string;
  opcoes: readonly OpcaoDeFiltro[];
  onChange: (valor: string) => void;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{rotulo}</span>
      <select
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 appearance-none rounded-full border bg-card pl-3.5 pr-9 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          valor ? "border-foreground" : "border-border",
        )}
      >
        <option value="">{todos}</option>
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </label>
  );
}

export function Servicos({ servicos }: { servicos: readonly string[] }) {
  if (!servicos.length) return null;
  return (
    <p className="flex flex-wrap gap-1.5">
      {servicos.map((servico) => (
        <span key={servico} className={cn(selo, seloNeutro, "font-medium")}>
          {SERVICO_ROTULO[servico] ?? servico}
        </span>
      ))}
    </p>
  );
}
