import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";

import { Input } from "@/components/ui/input";
import { dataBr } from "@/lib/comercial/clientes";
import { ROTULO_DO_VINCULO, semAdmissao, temDatasDoVinculo, textosDoVinculo, type ColaboradorNoPainel } from "@/lib/rh/ficha";
import { hrefDaFicha } from "@/lib/rh/navegacao";
import { cn } from "@/lib/utils";

import { Contador, Pill, TOM_NEUTRO, TOM_VENCENDO, TOM_VENCIDO, Vazio } from "./pecas";

/**
 * Pessoas (partes 8.2c e 8.4b): quem está ativo no cadastro da Operação, com
 * a ficha resumida, as datas do vínculo próprio e a ficha de cada um. À
 * parte, em "Inativas na Operação", quem a coordenação desativou com a
 * admissão sem o desligamento (pergunta 70): o RH grava o desligamento na
 * ficha, e a pessoa sai da lista. Sem legenda: só rótulos, dados e ações.
 */

export type EstadoDaTela = "carregando" | "erro" | "pronto";

function buscaInclui(colaborador: ColaboradorNoPainel, busca: string): boolean {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  return !termo || `${colaborador.nome} ${colaborador.funcao}`.toLocaleLowerCase("pt-BR").includes(termo);
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function Linha({ colaborador, primeira }: { colaborador: ColaboradorNoPainel; primeira: boolean }) {
  const datas = temDatasDoVinculo(colaborador) ? textosDoVinculo(colaborador) : [];
  return (
    <li className={cn(!primeira && "border-t border-muted")}>
      <Link
        href={hrefDaFicha(colaborador.id)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 px-5 py-3.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-extrabold">{colaborador.nome}</span>
          <span className="text-sm font-semibold text-muted-foreground">
            {[colaborador.funcao, ROTULO_DO_VINCULO[colaborador.vinculo], ...datas].filter(Boolean).join(" · ")}
          </span>
          {colaborador.proximo_vencimento ? (
            <span className="text-xs font-semibold text-muted-foreground">Próximo vencimento {dataBr(colaborador.proximo_vencimento)}</span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-start justify-end gap-1.5">
          {colaborador.vencidos ? <Pill className={TOM_VENCIDO}>{plural(colaborador.vencidos, "vencido", "vencidos")}</Pill> : null}
          {colaborador.vencendo ? <Pill className={TOM_VENCENDO}>{plural(colaborador.vencendo, "vencendo", "vencendo")}</Pill> : null}
          {semAdmissao(colaborador) ? <Pill className={TOM_NEUTRO}>Sem admissão</Pill> : null}
          {colaborador.registros ? null : <Pill className={TOM_NEUTRO}>Sem registro</Pill>}
        </span>
      </Link>
    </li>
  );
}

function Lista({ colaboradores }: { colaboradores: readonly ColaboradorNoPainel[] }) {
  return (
    <ul>
      {colaboradores.map((colaborador, indice) => (
        <Linha key={colaborador.id} colaborador={colaborador} primeira={indice === 0} />
      ))}
    </ul>
  );
}

function Secao({ id, titulo, total, children }: { id: string; titulo: string; total: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-3.5">
        <h2 id={id} className="text-base font-extrabold">
          {titulo}
        </h2>
        <Contador>{total}</Contador>
      </div>
      {children}
    </section>
  );
}

export function PessoasView({ estado, colaboradores, busca, onBusca }: { estado: EstadoDaTela; colaboradores: readonly ColaboradorNoPainel[]; busca: string; onBusca: (valor: string) => void }) {
  const ativas = colaboradores.filter((colaborador) => colaborador.ativo);
  const inativas = colaboradores.filter((colaborador) => !colaborador.ativo);
  const lista = ativas.filter((colaborador) => buscaInclui(colaborador, busca));
  const listaDasInativas = estado === "pronto" ? inativas.filter((colaborador) => buscaInclui(colaborador, busca)) : [];
  let conteudo;
  if (estado === "carregando") conteudo = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") conteudo = <Vazio>Não foi possível carregar as pessoas.</Vazio>;
  else if (!ativas.length) conteudo = <Vazio>Nenhuma pessoa ativa</Vazio>;
  else if (!lista.length) conteudo = <Vazio>Nenhuma pessoa encontrada</Vazio>;
  else conteudo = <Lista colaboradores={lista} />;
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Pessoas</h1>
        <label className="relative block w-full min-w-0 md:ml-auto md:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Buscar" placeholder="Buscar nome ou função" value={busca} onChange={(evento) => onBusca(evento.target.value)} className="pl-9" />
        </label>
      </header>
      <Secao id="ativas" titulo="Ativas" total={ativas.length}>
        {conteudo}
      </Secao>
      {listaDasInativas.length ? (
        <Secao id="inativas-na-operacao" titulo="Inativas na Operação" total={inativas.length}>
          <Lista colaboradores={listaDasInativas} />
        </Secao>
      ) : null}
    </div>
  );
}
