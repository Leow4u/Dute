import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Skeleton } from "@/components/ui/skeleton";
import type { ItemDoInicio } from "@/lib/inicio-do-modulo";
import type { HojeNoArmazem } from "@/lib/inicio-do-wms";

/**
 * Início da Armazenagem na v3 (parte 4.7b), no molde do Início do Comercial e
 * da Operação (docs/mockups/ModOpInicio.dc.html): a data, a saudação, o que
 * espera a pessoa e, ao lado, o dia no armazém. Sem legenda: só rótulos,
 * dados e ações.
 */

export type InicioDoWms = {
  itens: readonly ItemDoInicio[];
  carregando: boolean;
  falhas: readonly string[];
  /** Os números do dia; null para quem não vê o armazém (o financeiro). */
  hoje: HojeNoArmazem | null;
};

function NumerosDoArmazem({ hoje }: { hoje: HojeNoArmazem }) {
  return (
    <section aria-labelledby="hoje-no-armazem" className="flex flex-col gap-3.5">
      <TituloDaSecao id="hoje-no-armazem">Hoje no armazém</TituloDaSecao>
      <ul className="rounded-lg border border-border bg-card">
        <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Pedidos para separar" valor={hoje.toPick} />
        <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Prontos para envio" valor={hoje.toShip} />
        <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Em rota de entrega" valor={hoje.inTransit} />
        <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Recebimentos em aberto" valor={hoje.openReceipts} />
        <LinhaDeNumero ponto="bg-success-soft-foreground" rotulo="SKUs em estoque" valor={hoje.skus} />
      </ul>
    </section>
  );
}

export function InicioDoWmsView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoWms }) {
  const lateral = inicio.hoje ? (
    inicio.carregando ? <Skeleton className="h-80 rounded-lg" /> : <NumerosDoArmazem hoje={inicio.hoje} />
  ) : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="na Armazenagem"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
    />
  );
}
