import { formatarReais } from "@workspace/dominio";
import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { numerosDaFila, type NumerosDaFila } from "@/lib/financeiro/a-faturar";
import { numerosDaCobranca, type NumerosDaCobranca } from "@/lib/financeiro/faturas";
import { ROTA_A_FATURAR, ROTA_A_RECEBER } from "@/lib/financeiro/navegacao";
import { hojeIso } from "@/lib/operacao/fila";
import type { InicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";

/**
 * Início do Financeiro (partes 4.1b e 4.2b, no molde de docs/mockups/ModComInicio.dc.html):
 * o que espera a pessoa no Financeiro e, ao lado, a fila A faturar e a
 * cobrança em números. Sem legenda: só rótulos, dados e ações.
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

function Cobranca({ numeros }: { numeros: NumerosDaCobranca }) {
  return (
    <section aria-labelledby="a-receber" className="flex flex-col gap-3.5">
      <TituloDaSecao id="a-receber">A receber</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="px-5 pt-5 text-3xl font-extrabold tabular-nums">{formatarReais(numeros.aReceberCents + numeros.vencidoCents)}</p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="A vencer" valor={numeros.aReceber} />
          <LinhaDeNumero ponto="bg-destructive-soft-foreground" rotulo="Vencidas" valor={numeros.vencidas} alerta={numeros.vencidas > 0} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Para enviar" valor={numeros.paraEnviar} />
        </ul>
        <div className="border-t border-border px-5 py-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={ROTA_A_RECEBER}>Abrir A receber</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function InicioDoFinanceiroView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoFinanceiro }) {
  const lateral =
    inicio.linhas && inicio.faturas ? (
      <>
        <Resumo numeros={numerosDaFila(inicio.linhas)} />
        <Cobranca numeros={numerosDaCobranca(inicio.faturas, hojeIso(hoje))} />
      </>
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
