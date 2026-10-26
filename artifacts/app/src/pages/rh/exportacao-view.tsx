import type { FormEvent } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ARQUIVOS_DA_EXPORTACAO,
  ROTULO_DO_ARQUIVO,
  competenciaDeHoje,
  competenciaValida,
  dataDaGeracao,
  textoDaCompetencia,
  type ArquivoDaExportacao,
  type ExportacaoNaLista,
} from "@/lib/rh/exportacao";
import { hrefDaFicha } from "@/lib/rh/navegacao";
import { cn } from "@/lib/utils";

import { Contador, Vazio } from "./pecas";

/**
 * Exportação (partes 8.3 e 8.4b): a planilha da competência para a
 * contabilidade, que transmite o eSocial. O rh gera e vê quem está sem a data
 * de admissão, com o link da ficha; owner, admin e rh baixam. Cada geração
 * sem mudança devolve a versão de antes. Sem legenda: só rótulos, dados e
 * ações.
 */

export type EstadoDaLista = "carregando" | "erro" | "pronto";

export type AcoesDaExportacao = {
  mudarCompetencia: (valor: string) => void;
  gerar: () => void;
  baixar: (id: string, arquivo: ArquivoDaExportacao) => void;
};

export type PessoaSemAdmissao = { id: string; nome: string };

export type PropsDaExportacao = {
  estado: EstadoDaLista;
  exportacoes: readonly ExportacaoNaLista[];
  grava: boolean;
  /** Os próprios ativos sem a data de admissão (parte 8.4), que entram na planilha pela regra do cadastro. */
  semAdmissao: readonly PessoaSemAdmissao[];
  hoje: string;
  competencia: string;
  ocupado: boolean;
  aviso: string | null;
  falha: string | null;
  acoes: AcoesDaExportacao;
};

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function Gerar({ hoje, competencia, ocupado, acoes }: Pick<PropsDaExportacao, "hoje" | "competencia" | "ocupado" | "acoes">) {
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    acoes.gerar();
  }
  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <label className="flex flex-col gap-1.5 text-sm font-bold">
        Competência
        <Input
          type="month"
          min="1900-01"
          max={competenciaDeHoje(hoje)}
          value={competencia}
          onChange={(evento) => acoes.mudarCompetencia(evento.target.value)}
          className="w-48"
          required
        />
      </label>
      <Button type="submit" disabled={ocupado || !competenciaValida(competencia, hoje)}>
        Gerar exportação
      </Button>
    </form>
  );
}

function SemAdmissao({ pessoas }: { pessoas: readonly PessoaSemAdmissao[] }) {
  if (!pessoas.length) return null;
  return (
    <div className="flex flex-col gap-2.5 border-t border-border px-5 pb-4 pt-3.5">
      <h3 id="sem-admissao" className="flex items-center gap-2.5 text-sm font-extrabold">
        Sem data de admissão
        <Contador>{pessoas.length}</Contador>
      </h3>
      <ul aria-labelledby="sem-admissao" className="flex flex-wrap gap-x-4 gap-y-2">
        {pessoas.map((pessoa) => (
          <li key={pessoa.id}>
            <Link href={hrefDaFicha(pessoa.id)} className="rounded text-sm font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {pessoa.nome}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Versao({ exportacao, primeira, ocupado, acoes }: { exportacao: ExportacaoNaLista; primeira: boolean; ocupado: boolean; acoes: AcoesDaExportacao }) {
  const titulo = `${textoDaCompetencia(exportacao.competencia)} · versão ${exportacao.versao}`;
  const autoria = [`Gerada em ${dataDaGeracao(exportacao.gerada_em)}`, exportacao.gerada_por].filter(Boolean).join(" por ");
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5", !primeira && "border-t border-muted")}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-extrabold">{titulo}</span>
        <span className="text-sm font-semibold text-muted-foreground">
          {plural(exportacao.exames, "exame", "exames")} · {plural(exportacao.colaboradores, "colaborador", "colaboradores")}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">{autoria}</span>
      </span>
      <span className="flex flex-wrap gap-2">
        {ARQUIVOS_DA_EXPORTACAO.map((arquivo) => (
          <Button
            key={arquivo}
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${ROTULO_DO_ARQUIVO[arquivo]}, ${titulo}`}
            onClick={() => acoes.baixar(exportacao.id, arquivo)}
            disabled={ocupado}
          >
            {ROTULO_DO_ARQUIVO[arquivo]}
          </Button>
        ))}
      </span>
    </li>
  );
}

export function ExportacaoView({ estado, exportacoes, grava, semAdmissao, hoje, competencia, ocupado, aviso, falha, acoes }: PropsDaExportacao) {
  let lista;
  if (estado === "carregando") lista = <Vazio>Carregando...</Vazio>;
  else if (estado === "erro") lista = <Vazio>Não foi possível carregar as exportações.</Vazio>;
  else if (!exportacoes.length) lista = <Vazio>Nenhuma exportação</Vazio>;
  else
    lista = (
      <ul>
        {exportacoes.map((exportacao, indice) => (
          <Versao key={exportacao.id} exportacao={exportacao} primeira={indice === 0} ocupado={ocupado} acoes={acoes} />
        ))}
      </ul>
    );
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-3xl font-extrabold tracking-tight">Exportação</h1>
      </header>
      {grava ? (
        <section aria-labelledby="gerar" className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 id="gerar" className="text-base font-extrabold">
              Gerar
            </h2>
          </div>
          <Gerar hoje={hoje} competencia={competencia} ocupado={ocupado} acoes={acoes} />
          <SemAdmissao pessoas={semAdmissao} />
        </section>
      ) : null}
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
      <section aria-labelledby="versoes" className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3.5 border-b border-border px-5 py-3.5">
          <h2 id="versoes" className="text-base font-extrabold">
            Versões
          </h2>
          <Contador>{exportacoes.length}</Contador>
        </div>
        {lista}
      </section>
    </div>
  );
}
