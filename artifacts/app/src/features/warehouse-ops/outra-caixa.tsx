import { Minus, Plus } from "lucide-react";

import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCancelar, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { separadoNasCaixas, somaDasInformadas, textoDaCandidata, type CaixaDaPrateleira, type CaixasInformadas } from "@/lib/warehouse-ops/caixas-da-separacao";

/**
 * "Outra caixa" (separação com caixas, parte 3b;
 * docs/mockups/WmsSepararOutraCaixa.dc.html): o sistema baixa a caixa mais
 * antiga, e a pessoa corrige de qual caixa da prateleira o item saiu. A soma
 * tem de fechar com a linha. Sem legenda.
 */

export type OutraCaixaDaLinha = {
  /** A linha da separação (pick_lines). */
  id: string;
  nome: string;
  posicao: string;
  /** O que a linha separa. */
  quantidade: number;
  /** As caixas da prateleira que têm o item, a mais antiga primeiro. */
  caixas: CaixaDaPrateleira[];
  /** A quantidade de cada caixa; começa na sugestão do sistema. */
  informadas: CaixasInformadas;
};

const numero = new Intl.NumberFormat("pt-BR");

function entre(valor: number, maximo: number) {
  return Math.max(0, Math.min(maximo, Math.floor(Number.isFinite(valor) ? valor : 0)));
}

/** A soma das caixas fecha com o que a linha tira das caixas desta prateleira. */
export function caixasFecham(linha: Pick<OutraCaixaDaLinha, "quantidade" | "caixas" | "informadas">) {
  return somaDasInformadas(linha.informadas) === separadoNasCaixas(linha.quantidade, linha.caixas);
}

export function OutraCaixaConteudo({
  linha,
  confirmando = false,
  onMudar,
  onVoltar,
  onConfirmar,
}: {
  linha: OutraCaixaDaLinha;
  confirmando?: boolean;
  onMudar: (linha: OutraCaixaDaLinha) => void;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  const mudar = (caixa: CaixaDaPrateleira, valor: number) => onMudar({ ...linha, informadas: { ...linha.informadas, [caixa.code]: entre(valor, caixa.disponivel) } });
  const esperado = separadoNasCaixas(linha.quantidade, linha.caixas);
  return (
    <div className="grid gap-4">
      <p className="text-sm font-medium text-muted-foreground">{[linha.nome, linha.posicao || null, `${numero.format(linha.quantidade)} un.`].filter(Boolean).join(" · ")}</p>
      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {linha.caixas.map((caixa) => {
          const qty = linha.informadas[caixa.code] ?? 0;
          return (
            <li key={caixa.code} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-foreground">{caixa.code}</p>
                <p className="text-xs text-muted-foreground">{textoDaCandidata(caixa)}</p>
              </div>
              <div className="flex h-10 w-[132px] shrink-0 items-stretch overflow-hidden rounded-lg border border-input bg-background">
                <Button type="button" variant="ghost" className="h-full rounded-none px-2.5" aria-label={`Menos um de ${caixa.code}`} disabled={qty <= 0} onClick={() => mudar(caixa, qty - 1)}>
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <input
                  aria-label={`Separado de ${caixa.code}`}
                  inputMode="numeric"
                  value={String(qty)}
                  onChange={(event) => mudar(caixa, Number(event.target.value.replace(/\D/g, "") || 0))}
                  className="w-0 flex-1 border-x border-input bg-background text-center font-bold tabular-nums"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="h-full rounded-none px-2.5"
                  aria-label={`Mais um de ${caixa.code}`}
                  disabled={qty >= caixa.disponivel}
                  onClick={() => mudar(caixa, qty + 1)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center justify-between text-sm font-semibold">
        <span>Separado</span>
        <span className="tabular-nums">
          {numero.format(somaDasInformadas(linha.informadas))} de {numero.format(esperado)} un.
        </span>
      </p>
      {/* Confirmando, o diálogo fica: o Voltar espera ocupado, e o confirmar é o BotaoDeAcao, com o gerúndio e o foco nele
          (carregamento v2, parte 13c). */}
      <DialogFooter>
        <DialogCancelar ocupado={confirmando} onClick={onVoltar}>
          Voltar
        </DialogCancelar>
        <BotaoDeAcao
          estado={confirmando ? "andamento" : "repouso"}
          rotulo="Confirmar caixas"
          andamento="Confirmando…"
          bloqueado={!confirmando && !caixasFecham(linha)}
          onClick={onConfirmar}
        />
      </DialogFooter>
    </div>
  );
}

export function OutraCaixaDialog({
  linha,
  confirmando,
  onMudar,
  onFechar,
  onConfirmar,
}: {
  /** A linha aberta no diálogo; null fecha. */
  linha: OutraCaixaDaLinha | null;
  confirmando?: boolean;
  onMudar: (linha: OutraCaixaDaLinha) => void;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Dialog open={Boolean(linha)} ocupado={Boolean(confirmando)} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>De qual caixa saiu?</DialogTitle>
        </DialogHeader>
        {linha ? <OutraCaixaConteudo linha={linha} confirmando={confirmando} onMudar={onMudar} onVoltar={onFechar} onConfirmar={onConfirmar} /> : null}
      </DialogContent>
    </Dialog>
  );
}
