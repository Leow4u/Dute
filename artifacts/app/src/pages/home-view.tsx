import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Esqueleto } from "@/components/ui/esqueleto";
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
  /** Sem rede (decisão 2 do celular): a hora da leitura na tela, ou `null` sem nada lido. */
  semConexao?: { lidaEm: number | null; tentando: boolean; onTentar: () => void } | null;
  /** A nova tentativa das fontes que falharam. */
  tentarFalhas?: { tentando: boolean; onTentar: () => unknown; alerta?: boolean };
};

/**
 * O dia no armazém com a forma final desde a primeira pintura (carregamento
 * v2, parte 13e, e a prancha da abertura): o título e os rótulos reais e,
 * no lugar de cada número ainda não lido, o bloco do esqueleto, do tamanho do
 * número de 24 px (28 × 18); nunca o zero antes de ler. Sem o armazém lido (a
 * leitura falhou), "—": o aviso da falha diz por quê. O total de SKUs lê à
 * parte (o painel): lendo, o bloco; sem leitura, "—".
 */
function NumerosDoArmazem({ hoje, carregando }: { hoje: HojeNoArmazem; carregando: boolean }) {
  const bloco = <Esqueleto forma="contagem" className="h-4.5 w-7" />;
  const numero = (valor: number) => (carregando ? bloco : hoje.lido === false ? "—" : valor);
  return (
    <section aria-labelledby="hoje-no-armazem" aria-busy={carregando || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="hoje-no-armazem">Hoje no armazém</TituloDaSecao>
      <ul className="rounded-lg border border-border bg-card">
        <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Pedidos para separar" valor={numero(hoje.toPick)} />
        <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Prontos para envio" valor={numero(hoje.toShip)} />
        <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Em rota de entrega" valor={numero(hoje.inTransit)} />
        <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Recebimentos em aberto" valor={numero(hoje.openReceipts)} />
        <LinhaDeNumero
          ponto="bg-success-soft-foreground"
          rotulo="SKUs em estoque"
          valor={hoje.skus !== null ? hoje.skus : hoje.skusLendo ? bloco : "—"}
        />
      </ul>
    </section>
  );
}

export function InicioDoWmsView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDoWms }) {
  // Sem rede e sem nada lido, os números seriam zeros falsos: ficam de fora.
  const semNadaLido = inicio.semConexao?.lidaEm === null;
  const lateral = inicio.hoje && !semNadaLido ? <NumerosDoArmazem hoje={inicio.hoje} carregando={inicio.carregando} /> : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="na Armazenagem"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
      semConexao={inicio.semConexao ?? null}
      tentarFalhas={inicio.tentarFalhas}
    />
  );
}
