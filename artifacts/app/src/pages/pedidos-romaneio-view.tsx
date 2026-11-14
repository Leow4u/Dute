import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { PageHeader } from "@/components/ui/page-header";
import { RomaneioDocumento } from "@/features/warehouse-ops/romaneio-documento";
import type { FolhaDoRomaneio } from "@/lib/warehouse-ops/romaneio";

/**
 * Pedidos › Romaneio (separação com caixas, parte 4c): a barra de cima, que
 * não sai na impressão, e a folha (docs/mockups/WmsSepararRomaneio.dc.html).
 * Os dados chegam por props (pages/pedidos-romaneio.tsx). Sem legenda; uma
 * ação: "Imprimir".
 */

export type EstadoDoRomaneio = "carregando" | "nao_encontrado" | "erro" | "em_separacao" | "pronto";

const MENSAGENS: Record<Exclude<EstadoDoRomaneio, "pronto">, string> = {
  carregando: "Carregando o pedido…",
  nao_encontrado: "Pedido não encontrado",
  erro: "Não foi possível carregar o pedido.",
  em_separacao: "Pedido em separação",
};

export function PedidosRomaneioView({
  estado,
  folha,
  voltar,
  avisos = [],
  onImprimir,
  onTentar,
}: {
  estado: EstadoDoRomaneio;
  folha: FolhaDoRomaneio | null;
  /** De volta ao pedido; sem ele, a Pedidos. */
  voltar?: { href: string; rotulo: string } | null;
  /** A leitura que falhou (o prazo): a folha sai sem esse dado, e a tela diz qual. */
  avisos?: readonly string[];
  onImprimir: () => void;
  /** Lê de novo o que ainda não chegou: "Tentar de novo" na demora, na desistência e na falha. */
  onTentar?: () => Promise<unknown>;
}) {
  const mensagem = estado !== "pronto" ? MENSAGENS[estado] : !folha ? MENSAGENS.nao_encontrado : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-24">
      <div className="no-print flex flex-col gap-4">
        <Link href={voltar?.href ?? "/pedidos"} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {voltar?.rotulo ?? "Pedidos"}
        </Link>
        <PageHeader
          title="Romaneio"
          actions={
            <Button type="button" onClick={onImprimir} disabled={!folha || Boolean(mensagem)}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </Button>
          }
        />
      </div>
{/* A primeira leitura é a espera em bloco do carregamento v2 (parte 13c): nada antes de 300 ms, a caixa e o rótulo,
          com o anúncio pelo Anunciador, no lugar do "Carregando" seco. A leitura ao vivo relê (o `tentar`): "Tentar de
          novo" aos 10 s e a desistência aos 70 s; a falha também tenta de novo. */}
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo={MENSAGENS.carregando} continuaARota onTentar={onTentar} className="no-print rounded-lg border border-border bg-card px-5 py-6" />
      ) : estado === "erro" && onTentar ? (
        <FalhaNaLeitura leitura={{ error: null, refetch: onTentar }} mensagem={MENSAGENS.erro} className="no-print" />
      ) : mensagem ? (
        <p role={estado === "erro" ? "alert" : undefined} className="no-print rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
          {mensagem}
        </p>
      ) : folha ? (
        <>
          {avisos.map((aviso) => (
            <p key={aviso} role="alert" className="no-print rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-soft-foreground">
              {aviso}
            </p>
          ))}
          {/* A folha tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela. */}
          <div className="overflow-x-auto rounded-lg border border-border bg-muted p-4">
            <RomaneioDocumento folha={folha} />
          </div>
        </>
      ) : null}
    </div>
  );
}
