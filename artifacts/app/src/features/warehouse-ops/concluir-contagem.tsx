import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { unidadesComSinal, type RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { avisoDasPorContar } from "@/lib/warehouse-ops/rodadas-da-contagem";

/**
 * "Concluir contagem" (o registro da rodada, 18/11/2026; decisão 1 do
 * Leonardo): os números da rodada como a tela os tem e, com prateleira por
 * contar, o aviso de quantas ficam fora; conclui mesmo assim, pela
 * `completeCountRound`, que faz a mesma conta no servidor. Enquanto grava,
 * o diálogo não fecha (carregamento v2, parte 13a). Sem legenda.
 */

const numero = new Intl.NumberFormat("pt-BR");

export type ConcluirContagemProps = {
  rodada: RodadaDaContagem;
  estado: EstadoDaAcao;
  onCancelar: () => void;
  onConcluir: () => void;
};

export function ConcluirContagemConteudo({ rodada, estado, onCancelar, onConcluir }: ConcluirContagemProps) {
  const ocupado = estado === "andamento" || estado === "sucesso";
  const aviso = avisoDasPorContar(rodada);
  const numeros: Array<readonly [string, string]> = [
    ["Prateleiras contadas", `${numero.format(rodada.prateleirasContadas)} de ${numero.format(rodada.prateleiras)}`],
    ["Caixas confirmadas", `${numero.format(rodada.caixasConfirmadas)} de ${numero.format(rodada.caixas)}`],
    ["Caixas com diferença", numero.format(rodada.caixasComDiferenca)],
    ["Diferença líquida", unidadesComSinal(rodada.diferenca)],
  ];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ocupado) onConcluir();
      }}
    >
      <p className="font-semibold text-foreground">{rodada.titulo}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {numeros.map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg border border-border px-3 py-2">
            <dt className="text-xs font-bold text-muted-foreground">{rotulo}</dt>
            <dd className="text-lg font-extrabold tabular-nums text-foreground">{valor}</dd>
          </div>
        ))}
      </dl>
      {aviso ? <p className="text-sm font-semibold text-amber-soft-foreground">{aviso}</p> : null}
      <div className="flex justify-end gap-2">
        <DialogCancelar ocupado={ocupado} onClick={onCancelar} />
        <BotaoDeAcao type="submit" estado={estado} rotulo="Concluir contagem" andamento="Concluindo…" sucesso="Concluída" erro="Não concluída" />
      </div>
    </form>
  );
}

export function ConcluirContagemDialog({
  aberto,
  rodada,
  estado,
  onFechar,
  onConcluir,
  focoAoFechar,
}: {
  aberto: boolean;
  /** A rodada em andamento; sem ela, o diálogo não tem o que mostrar e fica fechado. */
  rodada: RodadaDaContagem | null;
  estado: EstadoDaAcao;
  onFechar: () => void;
  onConcluir: () => void;
  focoAoFechar?: () => HTMLElement | null | undefined;
}) {
  // Concluindo, o diálogo não fecha: nem o Esc, nem o clique fora, nem o X, que fica aria-disabled.
  const ocupado = estado === "andamento" || estado === "sucesso";
  return (
    <Dialog open={aberto && Boolean(rodada)} ocupado={ocupado} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined} focoAoFechar={focoAoFechar}>
        <DialogHeader>
          <DialogTitle>Concluir contagem</DialogTitle>
        </DialogHeader>
        {aberto && rodada ? <ConcluirContagemConteudo rodada={rodada} estado={estado} onCancelar={onFechar} onConcluir={onConcluir} /> : null}
      </DialogContent>
    </Dialog>
  );
}
