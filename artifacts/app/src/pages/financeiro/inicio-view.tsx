import { formatarReais } from "@workspace/dominio";
import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { numerosDaFila, type NumerosDaFila } from "@/lib/financeiro/a-faturar";
import { ROTA_A_FATURAR } from "@/lib/financeiro/navegacao";
import type { InicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";

/**
 * Início do Financeiro (parte 4.1b, no molde de docs/mockups/ModComInicio.dc.html):
 * o que espera a pessoa no Financeiro e, ao lado, a fila A faturar em números.
 * Sem legenda: só rótulos, dados e ações.
 */

function Resumo({ numeros }: { numeros: NumerosDaFila }) {
  return (
    <section aria-labelledby="a-faturar" className="flex flex-col gap-3.5">
      <TituloDaSecao id="a-faturar">A faturar</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="px-5 pt-5 text-3xl font-extrabold tabular-nums">{formatarReais(numeros.prontasCents)}</p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-success-soft-foreground" rotulo="Prontas para faturar" valor={numeros.prontas} />
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Aguardando autorização" valor={numeros.aguardando} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Sem valor para faturar" valor={numeros.semValor} />
        </ul>
        <div className="border-t border-border px-5 py-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={ROTA_A_FATURAR}>Abrir a fila</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function InicioDoFinanceiroView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoFinanceiro }) {
  const lateral = inicio.linhas ? (
    <Resumo numeros={numerosDaFila(inicio.linhas)} />
  ) : inicio.carregando ? (
    <Skeleton className="h-80 rounded-lg" />
  ) : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="no Financeiro"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
    />
  );
}
