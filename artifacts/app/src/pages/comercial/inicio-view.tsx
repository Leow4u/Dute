import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResumoDoComercial } from "@/lib/comercial/inicio";
import { rotuloDaCompetencia } from "@/lib/comercial/medicoes";
import { ROTA_ORCAMENTOS } from "@/lib/comercial/navegacao";
import { ETAPA_ROTULO, pontoDaEtapa } from "@/lib/comercial/orcamentos";
import { ETAPAS_DO_RESUMO } from "@/lib/comercial/pendencias";
import type { InicioDoComercial } from "@/lib/comercial/use-inicio";

/**
 * Início do Comercial (parte 2.5, docs/mockups/ModComInicio.dc.html): o que
 * espera a pessoa no Comercial e, ao lado, os orçamentos por etapa e o mês.
 */

function Resumo({ resumo }: { resumo: ResumoDoComercial }) {
  const mes = rotuloDaCompetencia(resumo.competencia).split("/")[0];
  return (
    <>
      <section aria-labelledby="por-etapa" className="flex flex-col gap-3.5">
        <TituloDaSecao id="por-etapa">Orçamentos por etapa</TituloDaSecao>
        <div className="rounded-lg border border-border bg-card">
          <ul>
            {ETAPAS_DO_RESUMO.map((etapa) => (
              <LinhaDeNumero key={etapa} ponto={pontoDaEtapa(etapa)} rotulo={ETAPA_ROTULO[etapa]} valor={resumo.porEtapa[etapa]} />
            ))}
          </ul>
          <div className="border-t border-border px-5 py-4">
            <Button asChild variant="outline" className="w-full">
              <Link href={ROTA_ORCAMENTOS}>Abrir a fila</Link>
            </Button>
          </div>
        </div>
      </section>
      <section aria-labelledby="no-mes" className="flex flex-col gap-3.5">
        <TituloDaSecao id="no-mes">{mes}</TituloDaSecao>
        <ul className="rounded-lg border border-border bg-card">
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Enviados" valor={resumo.mes.enviados} />
          <LinhaDeNumero ponto="bg-success-soft-foreground" rotulo="Fechados" valor={resumo.mes.fechados} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Perdidos" valor={resumo.mes.perdidos} />
        </ul>
      </section>
    </>
  );
}

export function InicioDoComercialView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoComercial }) {
  const lateral = inicio.resumo ? (
    <Resumo resumo={inicio.resumo} />
  ) : inicio.carregando ? (
    <Skeleton className="h-96 rounded-lg" />
  ) : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="no Comercial"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
    />
  );
}
