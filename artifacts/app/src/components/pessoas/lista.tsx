import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Person } from "@/lib/pessoas";
import { BotaoReenviar, MenuDaPessoa, type AcoesDasPessoas } from "./acoes";
import { NomeDaPessoa, SeloDoPerfil, SituacaoDaPessoa } from "./partes";

/**
 * A lista de pessoas: uma linha por pessoa, com o perfil (na equipe), onde ela
 * está (na busca) e a situação; "Reenviar" e o menu na ponta. No computador
 * as colunas têm cabeçalho; no celular a linha empilha: a pessoa e o menu em
 * cima, o resto embaixo.
 */

export type ModoDaLista = "equipe" | "busca" | "cliente";

// Na equipe e na busca cada linha é uma grade própria, alinhada ao cabeçalho
// pelas colunas de largura fixa (com ou sem "Reenviar"). No cliente, sem
// cabeçalho, a lista é a grade e as linhas a seguem (subgrid): a situação e as
// ações ficam do tamanho do maior conteúdo, e o e-mail ganha o resto.
const COLUNAS: Record<ModoDaLista, string> = {
  equipe: "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_8rem]",
  busca: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_8rem]",
  cliente: "sm:col-span-3 sm:grid-cols-subgrid",
};

const CONTEUDO_LARGO: Record<ModoDaLista, string> = {
  equipe: "lg:contents",
  busca: "lg:contents",
  cliente: "sm:contents",
};

const ACOES_LARGO: Record<ModoDaLista, string> = {
  equipe: "lg:col-start-auto lg:row-start-auto",
  busca: "lg:col-start-auto lg:row-start-auto",
  cliente: "sm:col-start-auto sm:row-start-auto",
};

/** Com a linha empilhada (celular), o "Reenviar" fica só no menu. */
const REENVIAR_ESTREITO: Record<ModoDaLista, string> = {
  equipe: "max-lg:hidden",
  busca: "max-lg:hidden",
  cliente: "max-sm:hidden",
};

const CABECALHO: Record<Exclude<ModoDaLista, "cliente">, string[]> = {
  equipe: ["Pessoa", "Perfil", "Situação"],
  busca: ["Pessoa", "Onde", "Perfil", "Situação"],
};

export function ListaDePessoas({
  modo,
  rotulo,
  pessoas,
  acoes,
  onde,
}: {
  modo: ModoDaLista;
  rotulo: string;
  pessoas: Person[];
  acoes: AcoesDasPessoas;
  /** Na busca: onde a pessoa está (a equipe ou o cliente, com o link). */
  onde?: (person: Person) => ReactNode;
}) {
  return (
    <div>
      {modo === "cliente" ? null : (
        <div
          aria-hidden="true"
          className={cn(
            "hidden items-center gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-extrabold uppercase tracking-wider text-muted-foreground lg:grid",
            COLUNAS[modo],
          )}
        >
          {CABECALHO[modo].map((titulo) => (
            <span key={titulo}>{titulo}</span>
          ))}
          <span />
        </div>
      )}
      <ul aria-label={rotulo} className={cn("divide-y divide-border/60", modo === "cliente" && "sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto]")}>
        {pessoas.map((person) => (
          <li key={person.key} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5", COLUNAS[modo])}>
            <NomeDaPessoa person={person} voce={person.kind === "user" && person.id === acoes.selfId} />
            <div className={cn("col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 pl-12", CONTEUDO_LARGO[modo])}>
              {modo === "busca" ? <div className="min-w-0 text-sm font-bold">{onde?.(person)}</div> : null}
              {modo === "cliente" ? null : (
                <div className="min-w-0">
                  <SeloDoPerfil role={person.role} />
                </div>
              )}
              <SituacaoDaPessoa person={person} />
            </div>
            <div className={cn("col-start-2 row-start-1 flex items-center justify-end gap-2", ACOES_LARGO[modo])}>
              <BotaoReenviar acoes={acoes} person={person} className={REENVIAR_ESTREITO[modo]} />
              <MenuDaPessoa acoes={acoes} person={person} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
