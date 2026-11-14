import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
import type { ResumoDoComercial } from "@/lib/comercial/inicio";
import { competenciaAtual, rotuloDaCompetencia } from "@/lib/comercial/medicoes";
import { ROTA_ORCAMENTOS } from "@/lib/comercial/navegacao";
import { ETAPA_ROTULO, pontoDaEtapa } from "@/lib/comercial/orcamentos";
import { ETAPAS_DO_RESUMO } from "@/lib/comercial/pendencias";
import type { InicioDoComercial } from "@/lib/comercial/use-inicio";
import { hojeIso } from "@/lib/operacao/fila";

/**
 * Início do Comercial (parte 2.5, docs/mockups/ModComInicio.dc.html): o que
 * espera a pessoa no Comercial e, ao lado, os orçamentos por etapa e o mês.
 */

/**
 * O número que ainda não foi lido (carregamento v2, parte 13g, como o "Hoje
 * no armazém" da 13e): o bloco do esqueleto do tamanho do número de 24 px,
 * nunca o zero antes de ler.
 */
const BLOCO = <Esqueleto forma="contagem" className="h-4.5 w-7" />;

/** O resumo; lendo (`resumo` nulo), a mesma forma com os blocos no lugar dos números e o mês de hoje no título. */
function Resumo({ resumo, hoje }: { resumo: ResumoDoComercial | null; hoje: Date }) {
  const mes = rotuloDaCompetencia(resumo?.competencia ?? competenciaAtual(hojeIso(hoje))).split("/")[0];
  const numero = (valor: number | undefined) => (resumo && valor !== undefined ? valor : BLOCO);
  return (
    <>
      <section aria-labelledby="por-etapa" aria-busy={!resumo || undefined} className="flex flex-col gap-3.5">
        <TituloDaSecao id="por-etapa">Orçamentos por etapa</TituloDaSecao>
        <div className="rounded-lg border border-border bg-card">
          <ul>
            {ETAPAS_DO_RESUMO.map((etapa) => (
              <LinhaDeNumero key={etapa} ponto={pontoDaEtapa(etapa)} rotulo={ETAPA_ROTULO[etapa]} valor={numero(resumo?.porEtapa[etapa])} />
            ))}
          </ul>
          <div className="border-t border-border px-5 py-4">
            <Button asChild variant="outline" className="w-full">
              <Link href={ROTA_ORCAMENTOS}>Abrir a fila</Link>
            </Button>
          </div>
        </div>
      </section>
      <section aria-labelledby="no-mes" aria-busy={!resumo || undefined} className="flex flex-col gap-3.5">
        <TituloDaSecao id="no-mes">{mes}</TituloDaSecao>
        <ul className="rounded-lg border border-border bg-card">
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Enviados" valor={numero(resumo?.mes.enviados)} />
          <LinhaDeNumero ponto="bg-success-soft-foreground" rotulo="Fechados" valor={numero(resumo?.mes.fechados)} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Perdidos" valor={numero(resumo?.mes.perdidos)} />
        </ul>
      </section>
    </>
  );
}

export function InicioDoComercialView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoComercial }) {
  // Lendo, a forma final com os blocos (nunca o zero nem o bloco rosado); sem leitura, o aviso da falha diz.
  const lateral = inicio.resumo || inicio.carregando ? <Resumo resumo={inicio.resumo ?? null} hoje={hoje} /> : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="no Comercial"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
      tentarFalhas={inicio.reler ? { tentando: Boolean(inicio.relendo), onTentar: inicio.reler, alerta: !inicio.falhaSoNaReleitura } : undefined}
    />
  );
}
