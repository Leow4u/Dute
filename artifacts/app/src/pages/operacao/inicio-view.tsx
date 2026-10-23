import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROTA_HOJE } from "@/lib/operacao/navegacao";
import type { HojeNaOperacao, PessoaDeHoje } from "@/lib/operacao/pendencias";
import type { InicioDaOperacao } from "@/lib/operacao/use-inicio";
import { cn } from "@/lib/utils";

/**
 * Início da Operação (parte 2.6, docs/mockups/ModOpInicio.dc.html): o que
 * espera a coordenação e, ao lado, o dia e a equipe. Sem valores.
 */

function NumerosDoDia({ numeros }: { numeros: HojeNaOperacao }) {
  return (
    <section aria-labelledby="hoje-na-operacao" className="flex flex-col gap-3.5">
      <TituloDaSecao id="hoje-na-operacao">Hoje na operação</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <ul>
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Agendadas hoje" valor={numeros.agendadasHoje} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Para agendar" valor={numeros.paraAgendar} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Próximos dias" valor={numeros.proximosDias} />
        </ul>
        <div className="border-t border-border px-5 py-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={ROTA_HOJE}>Abrir o Hoje</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function EquipeDeHoje({ equipe }: { equipe: PessoaDeHoje[] }) {
  return (
    <section aria-labelledby="equipe-hoje" className="flex flex-col gap-3.5">
      <TituloDaSecao id="equipe-hoje">Equipe hoje</TituloDaSecao>
      {equipe.length ? (
        <ul className="rounded-lg border border-border bg-card">
          {equipe.map((pessoa) => (
            <li key={pessoa.id} className="flex items-center gap-3 border-t border-border px-5 py-3 first:border-t-0">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background"
              >
                {pessoa.iniciais}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold">{pessoa.nome}</span>
              <span className={cn("shrink-0 text-sm tabular-nums", pessoa.escala ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {pessoa.escala ?? "livre"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground">Nenhum colaborador ativo</p>
      )}
    </section>
  );
}

export function InicioDaOperacaoView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDaOperacao }) {
  const lateral =
    inicio.numeros || inicio.equipe ? (
      <>
        {inicio.numeros ? <NumerosDoDia numeros={inicio.numeros} /> : null}
        {inicio.equipe ? <EquipeDeHoje equipe={inicio.equipe} /> : null}
      </>
    ) : inicio.carregando ? (
      <Skeleton className="h-96 rounded-lg" />
    ) : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="na Operação"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
    />
  );
}
