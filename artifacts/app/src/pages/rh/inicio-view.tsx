import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
import { numerosDoRh, type NumerosDoRh } from "@/lib/rh/inicio";
import { ROTA_PESSOAS } from "@/lib/rh/navegacao";
import type { InicioDoRh } from "@/lib/rh/use-rh";

/**
 * Início do RH (parte 8.2c, no molde do Início dos outros módulos): quem tem
 * registro vencido ou vencendo e, ao lado, as pessoas ativas em números. Sem
 * legenda: só rótulos, dados e ações.
 */

/**
 * O número que ainda não foi lido (carregamento v2, parte 13g, como o "Hoje
 * no armazém" da 13e): o bloco do esqueleto do tamanho do número, nunca o
 * zero antes de ler.
 */
const BLOCO = <Esqueleto forma="contagem" className="h-4.5 w-7" />;

/** As pessoas em números; lendo (`numeros` nulo), a mesma forma com os blocos. */
function Resumo({ numeros }: { numeros: NumerosDoRh | null }) {
  return (
    <section aria-labelledby="pessoas" aria-busy={!numeros || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="pessoas">Pessoas ativas</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="flex h-14 items-end px-5 pt-5 text-3xl font-extrabold tabular-nums">{numeros ? numeros.pessoas : <Esqueleto forma="bloco" className="h-7 w-12" />}</p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-destructive-soft-foreground" rotulo="Registros vencidos" valor={numeros ? numeros.vencidos : BLOCO} alerta={Boolean(numeros && numeros.vencidos > 0)} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Vencem em 30 dias" valor={numeros ? numeros.vencendo : BLOCO} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Sem registro" valor={numeros ? numeros.semRegistro : BLOCO} />
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
  // Lendo, a forma final com os blocos (nunca o zero nem o bloco rosado); sem leitura, o aviso da falha diz.
  const lateral = inicio.painel || inicio.carregando ? <Resumo numeros={inicio.painel ? numerosDoRh(inicio.painel) : null} /> : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="no RH"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
      tentarFalhas={inicio.reler ? { tentando: Boolean(inicio.relendo), onTentar: inicio.reler, alerta: !inicio.falhaSoNaReleitura } : undefined}
    />
  );
}
