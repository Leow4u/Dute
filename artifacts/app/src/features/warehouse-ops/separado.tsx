import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";

/**
 * O "Separado" de Pedidos (pergunta 59; canvas "Telas das decisões de 26/10",
 * item 6). Quem opera o armazém confirma o separado completo com o lacre, como
 * antes. A coordenação informa o separado de cada linha; a linha a menos pede
 * o motivo (falta ou avaria) e um detalhe. O servidor (advanceWarehouseTask)
 * solta a diferença da reserva e segue com o separado.
 */

const numero = new Intl.NumberFormat("pt-BR");

export type MotivoDaDiferenca = "falta" | "avaria";

export type LinhaDoSeparado = {
  id: string;
  item: string;
  posicao: string;
  pedido: number;
  separado: number;
  motivo: MotivoDaDiferenca;
  detalhe: string;
};

const MOTIVOS: Array<{ valor: MotivoDaDiferenca; rotulo: string }> = [
  { valor: "falta", rotulo: "Falta" },
  { valor: "avaria", rotulo: "Avaria" },
];

/** As linhas da separação do pedido, com o separado igual ao pedido. */
export function linhasDoSeparado(order: OrderGroup): LinhaDoSeparado[] {
  return (order.pick?.items ?? [])
    .map((item, index) => {
      const pedido = Number(item.expected_quantity ?? item.quantity ?? 0);
      return {
        id: String(item.id ?? index),
        item: String(item.name ?? item.product_name ?? item.sku_code ?? item.sku ?? "Item"),
        posicao: String(item.location ?? ""),
        pedido,
        separado: pedido,
        motivo: "falta" as const,
        detalhe: "",
      };
    })
    .filter((linha) => linha.pedido > 0);
}

/** O separado entre 0 e o pedido; um número quebrado ou vazio vira 0. */
export function separadoDaLinha(linha: LinhaDoSeparado, valor: number) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(linha.pedido, Math.max(0, Math.round(valor)));
}

/** Confirma com algo separado e o detalhe no tamanho que o servidor aceita. */
export function separadoValido(linhas: LinhaDoSeparado[]) {
  return (
    linhas.some((linha) => linha.separado > 0) &&
    linhas.every((linha) => linha.separado >= 0 && linha.separado <= linha.pedido && linha.detalhe.trim().length <= 300)
  );
}

/** As linhas da conclusão da separação: na linha a menos, o motivo e o detalhe. */
export function linhasParaSeparar(linhas: LinhaDoSeparado[]) {
  return linhas.map((linha) =>
    linha.separado < linha.pedido
      ? {
          pick_line_id: linha.id,
          qty_picked: linha.separado,
          status: "confirmed",
          shortage_reason: linha.motivo,
          ...(linha.detalhe.trim() ? { shortage_detail: linha.detalhe.trim() } : {}),
        }
      : { pick_line_id: linha.id, qty_picked: linha.pedido, status: "confirmed" },
  );
}

export function SeparadoView({
  lacre,
  onLacre,
  linhas,
  onLinha,
}: {
  lacre: string;
  onLacre: (lacre: string) => void;
  /** As linhas que a coordenação confere; sem elas, só o lacre. */
  linhas?: LinhaDoSeparado[];
  onLinha?: (linha: LinhaDoSeparado) => void;
}) {
  const aMenos = (linhas ?? []).filter((linha) => linha.separado < linha.pedido);
  return (
    <div className="grid gap-4">
      <div className="grid max-w-[260px] gap-2">
        <Label htmlFor="lacre">Número do lacre</Label>
        <Input id="lacre" value={lacre} onChange={(event) => onLacre(event.target.value)} autoFocus />
      </div>
      {linhas?.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="pb-1.5 font-semibold">
                Item
              </th>
              <th scope="col" className="pb-1.5 text-right font-semibold">
                Pedido
              </th>
              <th scope="col" className="w-[150px] pb-1.5 pl-3 font-semibold">
                Separado
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const diferenca = linha.pedido - linha.separado;
              const mudar = (valor: number) => onLinha?.({ ...linha, separado: separadoDaLinha(linha, valor) });
              return (
                <tr key={linha.id} className="border-t border-border/60">
                  <td className="py-2.5">
                    <span className="font-semibold">{linha.item}</span>
                    {diferenca > 0 ? (
                      <span className="ml-2 rounded-md border border-destructive-soft-border bg-destructive-soft px-1.5 py-0.5 text-xs font-bold text-destructive-soft-foreground">
                        −{numero.format(diferenca)}
                      </span>
                    ) : null}
                    {linha.posicao ? <span className="block text-xs font-medium text-muted-foreground">{linha.posicao}</span> : null}
                  </td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{numero.format(linha.pedido)} un.</td>
                  <td className="py-2.5 pl-3">
                    <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-input bg-background">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-full rounded-none px-2.5"
                        aria-label={`Menos um: ${linha.item}`}
                        disabled={linha.separado <= 0}
                        onClick={() => mudar(linha.separado - 1)}
                      >
                        <Minus className="size-4" />
                      </Button>
                      <input
                        aria-label={`Separado de ${linha.item}`}
                        inputMode="numeric"
                        value={String(linha.separado)}
                        onChange={(event) => mudar(Number(event.target.value.replace(/\D/g, "") || 0))}
                        className="w-0 flex-1 border-x border-input bg-background text-center font-bold tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-full rounded-none px-2.5"
                        aria-label={`Mais um: ${linha.item}`}
                        disabled={linha.separado >= linha.pedido}
                        onClick={() => mudar(linha.separado + 1)}
                      >
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {aMenos.map((linha) => (
        <fieldset
          key={linha.id}
          className="grid gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft/40 px-4 py-3"
        >
          <legend className="px-1.5 text-sm font-bold">Motivo da diferença em {linha.item}</legend>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS.map((motivo) => (
              <label
                key={motivo.valor}
                className={cn(
                  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-input px-3.5 text-sm font-semibold",
                  linha.motivo === motivo.valor && "border-foreground bg-muted",
                )}
              >
                <input
                  type="radio"
                  name={`motivo-${linha.id}`}
                  value={motivo.valor}
                  checked={linha.motivo === motivo.valor}
                  onChange={() => onLinha?.({ ...linha, motivo: motivo.valor })}
                  className="size-4 accent-primary"
                />
                {motivo.rotulo}
              </label>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`detalhe-${linha.id}`}>Detalhe</Label>
            <Input
              id={`detalhe-${linha.id}`}
              value={linha.detalhe}
              maxLength={300}
              onChange={(event) => onLinha?.({ ...linha, detalhe: event.target.value })}
            />
          </div>
        </fieldset>
      ))}
    </div>
  );
}
