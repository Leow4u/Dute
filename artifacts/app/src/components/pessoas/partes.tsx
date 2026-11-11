import type { ReactNode } from "react";

import { TOM_DO_QUADRO } from "@/components/clientes/partes";
import { roleLabel } from "@/lib/access";
import { customerTone } from "@/lib/customer-registry";
import { normalizeProfileRole, type ProfileRole } from "@/lib/modules";
import { SITUACOES, SITUACAO_ROTULO, personInitials, personStatus, type Person, type Situacao } from "@/lib/pessoas";
import { cn } from "@/lib/utils";

/**
 * Peças de Pessoas e acessos na v3 (docs/mockups/ConfigPessoas*.dc.html):
 * o avatar, o perfil, a situação, a pessoa com o e-mail e o filtro com as
 * contagens. A página de Pessoas e a página do cliente usam as mesmas.
 */

/** As iniciais na cor da pessoa (tirada do e-mail: a mesma sempre); quem saiu fica cinza. */
export function AvatarDaPessoa({ person }: { person: Pick<Person, "name" | "email" | "state"> }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold",
        person.state === "removed" ? "bg-muted text-muted-foreground" : TOM_DO_QUADRO[customerTone(person.email || person.name)],
      )}
    >
      {personInitials(person.name)}
    </span>
  );
}

const TOM_DO_PERFIL: Record<ProfileRole, string> = {
  owner: "border-border bg-muted text-foreground",
  admin: "border-border bg-muted text-foreground",
  interno: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  wms: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  financeiro: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  suporte: "border-teal-soft-border bg-teal-soft text-teal-soft-foreground",
  campo: "border-border bg-muted text-foreground",
  comercial: "border-violet-soft-border bg-violet-soft text-violet-soft-foreground",
  rh: "border-teal-soft-border bg-teal-soft text-teal-soft-foreground",
  painel: "border-border bg-muted text-foreground",
  cliente: "border-border bg-muted text-foreground",
};

export function SeloDoPerfil({ role }: { role: unknown }) {
  const known = normalizeProfileRole(role);
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center truncate whitespace-nowrap rounded-md border px-2.5 text-xs font-bold",
        known ? TOM_DO_PERFIL[known] : "border-border bg-muted text-muted-foreground",
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

/** O ponto e o rótulo da situação; no convite, o envio do e-mail e o dia do pedido embaixo. */
export function SituacaoDaPessoa({ person }: { person: Pick<Person, "state" | "kind" | "emailStatus" | "lastSentAt"> }) {
  const { label, detail } = personStatus(person);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            person.state === "active" ? "bg-success" : person.state === "pending" ? "bg-warning" : "bg-muted-foreground/50",
          )}
        />
        {label}
      </span>
      {detail ? <span className="pl-4 text-xs font-semibold text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

/** Até quatro avatares sobrepostos (o índice dos clientes). */
export function PilhaDeAvatares({ pessoas }: { pessoas: ReadonlyArray<Pick<Person, "key" | "name" | "email">> }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center">
      {pessoas.slice(0, 4).map((person, index) => (
        <span
          key={person.key}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full border-2 border-card text-xs font-extrabold",
            TOM_DO_QUADRO[customerTone(person.email || person.name)],
            index > 0 && "-ml-1.5",
          )}
        >
          {personInitials(person.name)}
        </span>
      ))}
    </span>
  );
}

/** O avatar, o nome (com "você" na própria linha) e o e-mail. */
export function NomeDaPessoa({ person, voce = false }: { person: Pick<Person, "name" | "email" | "state">; voce?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <AvatarDaPessoa person={person} />
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-bold", person.state === "removed" ? "text-muted-foreground" : "text-foreground")}>
          {person.name}
          {voce ? <span className="ml-1.5 text-xs font-semibold text-muted-foreground">você</span> : null}
        </span>
        <span title={person.email} className="block truncate text-xs font-semibold text-muted-foreground">
          {person.email}
        </span>
      </span>
    </span>
  );
}

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

/** Todos, Ativos, Convites pendentes e Arquivados, cada um com a contagem (o mesmo filtro da galeria de Clientes). */
export function FiltroDeSituacao({
  valor,
  onValor,
  contagem,
}: {
  valor: Situacao;
  onValor: (situacao: Situacao) => void;
  contagem: Record<Situacao, number>;
}) {
  return (
    <div role="group" aria-label="Filtrar pela situação" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-1">
      {SITUACOES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={valor === item}
          onClick={() => onValor(item)}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-bold transition-colors sm:gap-2 sm:px-3.5",
            valor === item ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {SITUACAO_ROTULO[item]}
          <Contagem ativa={valor === item}>{contagem[item]}</Contagem>
        </button>
      ))}
    </div>
  );
}

/** Contagem ao lado do rótulo da aba ("Equipe Dutelog 6"). */
export function ContagemDaAba({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold tabular-nums text-foreground">
      {children}
    </span>
  );
}
