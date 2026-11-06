import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { horaDaLeitura } from "@/lib/conexao";
import { cn } from "@/lib/utils";

/**
 * A leitura falhou e a tela não tem nada para mostrar: a falha no lugar da
 * lista, com a nova tentativa. Erro nunca vira vazio
 * (docs/plataforma/diagnostico-carregamento.md; mockup
 * docs/mockups/WmsCarregandoPedidosErro.dc.html). Sem rede, o ícone e o tom
 * dizem que o problema é a conexão (`semConexao`).
 */
export function ErroNaLeitura({
  mensagem,
  tentando,
  onTentar,
  className,
  semConexao = false,
}: {
  mensagem: string;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
  semConexao?: boolean;
}) {
  const Icone = semConexao ? WifiOff : AlertCircle;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-lg",
          semConexao ? "bg-warning-soft text-warning-soft-foreground" : "bg-destructive-soft text-destructive",
        )}
      >
        <Icone className="size-5" aria-hidden="true" />
      </span>
      <p className="flex-1 text-base font-semibold text-foreground">{mensagem}</p>
      <Button type="button" variant="outline" disabled={tentando} aria-busy={tentando || undefined} onClick={onTentar}>
        {tentando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {tentando ? "Tentando de novo…" : "Tentar de novo"}
      </Button>
    </div>
  );
}

/**
 * Sem rede e sem nada lido: o aviso no lugar da lista
 * (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular).
 */
export function BlocoSemConexao(props: { tentando: boolean; onTentar: () => void; className?: string }) {
  return <ErroNaLeitura semConexao mensagem="Sem conexão." {...props} />;
}

/**
 * Sem rede, com a lista já lida: ela fica na tela, marcada com a hora da
 * última leitura (decisão 2 do celular; a peça "Erro na atualização" de
 * docs/mockups/WmsCarregandoPecas.dc.html, com o "Sem conexão").
 */
export function FaixaSemConexao({
  lidaEm,
  tentando,
  onTentar,
  className,
}: {
  lidaEm: number;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 rounded-lg border border-warning-soft-border bg-warning-soft py-0.5 pl-4 pr-1 text-sm font-bold text-warning-soft-foreground",
        className,
      )}
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{`Sem conexão · lista de ${horaDaLeitura(lidaEm)}`}</span>
      <button
        type="button"
        disabled={tentando}
        aria-busy={tentando || undefined}
        onClick={onTentar}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-extrabold underline underline-offset-4 disabled:no-underline disabled:opacity-70"
      >
        {tentando ? <Spinner /> : null}
        {tentando ? "Tentando de novo…" : "Tentar de novo"}
      </button>
    </div>
  );
}
