import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { numerosDoRh, type NumerosDoRh } from "@/lib/rh/inicio";
import { ROTA_PESSOAS } from "@/lib/rh/navegacao";
import type { InicioDoRh } from "@/lib/rh/use-rh";

/**
 * Início do RH (parte 8.2c, no molde do Início dos outros módulos): quem tem
 * registro vencido ou vencendo e, ao lado, as pessoas ativas em números. Sem
 * legenda: só rótulos, dados e ações.
 */

function Resumo({ numeros }: { numeros: NumerosDoRh }) {
  return (
    <section aria-labelledby="pessoas" className="flex flex-col gap-3.5">
      <TituloDaSecao id="pessoas">Pessoas ativas</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="px-5 pt-5 text-3xl font-extrabold tabular-nums">{numeros.pessoas}</p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-destructive-soft-foreground" rotulo="Registros vencidos" valor={numeros.vencidos} alerta={numeros.vencidos > 0} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Vencem em 30 dias" valor={numeros.vencendo} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Sem registro" valor={numeros.semRegistro} />
        </ul>
        <div className="border-t border-border px-5 py-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={ROTA_PESSOAS}>Abrir Pessoas</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function InicioDoRhView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoRh }) {
  const lateral = inicio.painel ? <Resumo numeros={numerosDoRh(inicio.painel)} /> : inicio.carregando ? <Skeleton className="h-80 rounded-lg" /> : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="no RH"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
    />
  );
}
