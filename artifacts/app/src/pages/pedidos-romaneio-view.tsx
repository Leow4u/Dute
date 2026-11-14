import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, FaixaAoVivo, FalhaNaLeitura, erroDaLeituraAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
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
  leitura,
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
  /**
   * O que falta às leituras ao vivo (parte 13l): sem conexão e sem nada lido,
   * o aviso da conexão no lugar da falha; com o romaneio lido, a faixa com a
   * hora; o prazo que não chegou sem conexão, o aviso da conexão.
   */
  leitura?: LeituraAoVivoNaTela;
}) {
  const mensagem = estado !== "pronto" ? MENSAGENS[estado] : !folha ? MENSAGENS.nao_encontrado : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-24">
      <div className="no-print flex flex-col gap-4">
        {/* O primário como texto (4,5:1 no fundo da v3; o text-primary dava 4,2:1; parte 13m). */}
        <Link href={voltar?.href ?? "/pedidos"} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-texto">
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
        <FalhaNaLeitura leitura={{ error: erroDaLeituraAoVivo(leitura?.falta), refetch: onTentar }} mensagem={MENSAGENS.erro} className="no-print" />
      ) : mensagem ? (
        <p role={estado === "erro" ? "alert" : undefined} className="no-print rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
          {mensagem}
        </p>
      ) : folha ? (
        <>
          {/* Sem conexão: o romaneio lido fica, com a hora; o que não chegou (o prazo), o aviso da conexão (parte 13l). */}
          {leitura ? <FaixaAoVivo leitura={leitura} objeto="romaneio" className="no-print" /> : null}
          {leitura?.falta === "conexao" && leitura.lidaEm == null ? (
            <BlocoSemConexao tentando={leitura.tentando} onTentar={() => leitura.tentar()} className="no-print" />
          ) : null}
          {avisos.map((aviso) => (
            <p key={aviso} role="alert" className="no-print rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-soft-foreground">
              {aviso}
            </p>
          ))}
          {/* A folha tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela, e recebe o foco
              do teclado para rolar (scrollable-region-focusable; parte 13m). */}
          <div
            role="region"
            aria-label="Folha do romaneio"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-muted p-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco"
          >
            <RomaneioDocumento folha={folha} />
          </div>
        </>
      ) : null}
    </div>
  );
}
