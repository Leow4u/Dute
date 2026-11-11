import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ListaDeSeparacaoDocumento } from "@/features/warehouse-ops/lista-de-separacao-documento";
import type { FolhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";

/**
 * Pedidos › Lista de separação (separação com caixas, parte 1b): a barra de
 * cima, que não sai na impressão, e a folha
 * (docs/mockups/WmsSepararListaImpressa.dc.html). Os dados chegam por props
 * (pages/pedidos-lista.tsx). Sem legenda; uma ação: "Imprimir".
 */

export type EstadoDaLista = "carregando" | "nao_encontrado" | "erro" | "pronto";

export function PedidosListaView({
  estado,
  folha,
  avisos = [],
  onImprimir,
}: {
  estado: EstadoDaLista;
  folha: FolhaDaLista | null;
  /** A leitura que falhou (as posições, as caixas, o destino): a folha sai sem esse dado, e a tela diz qual. */
  avisos?: readonly string[];
  onImprimir: () => void;
}) {
  const mensagem =
    estado === "carregando"
      ? "Carregando"
      : estado === "erro"
        ? "Não foi possível carregar o pedido."
        : estado === "nao_encontrado" || !folha
          ? "Pedido não encontrado"
          : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-24">
      <div className="no-print flex flex-col gap-4">
        <Link href="/pedidos" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Pedidos
        </Link>
        <PageHeader
          title="Lista de separação"
          actions={
            <Button type="button" onClick={onImprimir} disabled={!folha || Boolean(mensagem)}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </Button>
          }
        />
      </div>
      {mensagem ? (
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
            <ListaDeSeparacaoDocumento folha={folha} />
          </div>
        </>
      ) : null}
    </div>
  );
}
