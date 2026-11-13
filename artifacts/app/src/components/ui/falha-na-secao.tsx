import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/**
 * A leitura de uma parte da tela que falhou (a ocupação do cliente, as pessoas
 * do portal, o painel que não se atualizou), na própria seção: a frase e o
 * "Tentar de novo", sem o cartão do `ErroNaLeitura`, que é o do lugar da lista
 * inteira. Erro nunca vira vazio nem some (carregamento v2, parte 13e).
 *
 * A nova tentativa segue o relógio da espera, como a do bloco (parte 7a):
 * "Tentando de novo…" com a caixa só depois de 300 ms, e pelo menos 500 ms; a
 * trava do toque segue o que o botão diz (`aria-disabled`, nunca `disabled`,
 * e o foco fica nele). Antes de reler, acorda a conexão de quem lê. No
 * celular, o botão tem 44 px.
 */
export function FalhaNaSecao({
  mensagem,
  tentando,
  onTentar,
  className,
  tom = "erro",
}: {
  mensagem: string;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
  /** "aviso": a frase no tom do aviso âmbar onde ela mora (a fonte do Início que não carregou). */
  tom?: "erro" | "aviso";
}) {
  const mostrando = useEspera(tentando, { segurarMinimo: true }).visivel;
  const tentarDeNovo = useTentarDeNovo();
  return (
    <div data-falha-na-secao="" className={cn("flex flex-wrap items-center gap-3", className)}>
      <p role="alert" className={cn("text-sm font-semibold", tom === "aviso" ? "text-warning-soft-foreground" : "text-destructive")}>
        {mensagem}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:min-h-11"
        aria-disabled={mostrando || undefined}
        aria-busy={mostrando || undefined}
        onClick={() => {
          if (!mostrando) tentarDeNovo(onTentar);
        }}
      >
        {mostrando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {mostrando ? "Tentando de novo…" : "Tentar de novo"}
      </Button>
    </div>
  );
}
