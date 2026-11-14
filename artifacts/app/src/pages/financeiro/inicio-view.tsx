import { formatarReais } from "@workspace/dominio";
import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
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

/**
 * O número que ainda não foi lido (carregamento v2, parte 13g, como o "Hoje
 * no armazém" da 13e): o bloco do esqueleto do tamanho do número, nunca o
 * zero nem "R$ 0,00" antes de ler.
 */
const BLOCO = <Esqueleto forma="contagem" className="h-4.5 w-7" />;
const TOTAL_LENDO = <Esqueleto forma="bloco" className="h-7 w-36" />;

/** A fila em números; lendo (`numeros` nulo), a mesma forma com os blocos. */
function Resumo({ numeros }: { numeros: NumerosDaFila | null }) {
  return (
    <section aria-labelledby="a-faturar" aria-busy={!numeros || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="a-faturar">A faturar</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="flex h-14 items-end px-5 pt-5 text-3xl font-extrabold tabular-nums">{numeros ? formatarReais(numeros.prontasCents) : TOTAL_LENDO}</p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-success-soft-foreground" rotulo="Prontas para faturar" valor={numeros ? numeros.prontas : BLOCO} />
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Aguardando autorização" valor={numeros ? numeros.aguardando : BLOCO} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Sem valor para faturar" valor={numeros ? numeros.semValor : BLOCO} />
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

/** A cobrança em números; lendo (`numeros` nulo), a mesma forma com os blocos. */
function Cobranca({ numeros }: { numeros: NumerosDaCobranca | null }) {
  return (
    <section aria-labelledby="a-receber" aria-busy={!numeros || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="a-receber">A receber</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <p className="flex h-14 items-end px-5 pt-5 text-3xl font-extrabold tabular-nums">
          {numeros ? formatarReais(numeros.aReceberCents + numeros.vencidoCents) : TOTAL_LENDO}
        </p>
        <ul className="mt-3">
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="A vencer" valor={numeros ? numeros.aReceber : BLOCO} />
          <LinhaDeNumero ponto="bg-destructive-soft-foreground" rotulo="Vencidas" valor={numeros ? numeros.vencidas : BLOCO} alerta={Boolean(numeros && numeros.vencidas > 0)} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Para enviar" valor={numeros ? numeros.paraEnviar : BLOCO} />
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
  // Lendo, a forma final com os blocos (nunca o zero nem o bloco rosado); sem leitura, o aviso da falha diz.
  const lateral =
    (inicio.linhas && inicio.faturas) || inicio.carregando ? (
      <>
        <Resumo numeros={inicio.linhas ? numerosDaFila(inicio.linhas) : null} />
        <Cobranca numeros={inicio.faturas ? numerosDaCobranca(inicio.faturas, hojeIso(hoje)) : null} />
      </>
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
      tentarFalhas={inicio.releitura ? { tentando: inicio.releitura.tentando, onTentar: inicio.releitura.tentar } : undefined}
    />
  );
}
