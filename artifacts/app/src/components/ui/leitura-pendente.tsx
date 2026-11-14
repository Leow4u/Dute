import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import type { LeituraPendente } from "@/lib/carregando/leitura-pendente";
import { cn } from "@/lib/utils";

/**
 * A lista que o formulário ainda não leu, no lugar dela (carregamento v2,
 * parte 13i): lendo, a espera da região ("Carregando clientes…", só aos
 * 300 ms); na falha, a frase e "Tentar de novo". O "Nenhum…" é de quem usa, e
 * só com a leitura feita: nunca afirmar vazio antes da primeira leitura.
 */
export function LeituraPendenteNaRegiao({
  leitura,
  carregando,
  falha,
  className,
}: {
  leitura: LeituraPendente;
  /** "Carregando clientes…", no gerúndio e com a reticência de um caractere. */
  carregando: string;
  /** "Não foi possível carregar os clientes." */
  falha: string;
  className?: string;
}) {
  if (leitura.estado === "carregando") return <CarregandoNaRegiao rotulo={carregando} onTentar={leitura.tentar} className={className} />;
  return (
    <FalhaNaSecao
      mensagem={falha}
      tentando={leitura.tentando}
      onTentar={leitura.tentar}
      className={cn("justify-center", className)}
    />
  );
}
