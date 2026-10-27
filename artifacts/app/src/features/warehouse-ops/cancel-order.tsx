import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";

/**
 * Cancelar pedido (pergunta 59; canvas "Telas das decisões de 26/10", item
 * 6): o motivo e, no pedido já separado, o que volta à posição. O servidor
 * (cancelWarehouseOrder) solta a reserva, cancela as tarefas abertas e abre
 * a guarda do separado.
 */

const numero = new Intl.NumberFormat("pt-BR");

export type VoltaAPosicao = { id: string; item: string; quantidade: number; posicao: string };

/** O motivo que o servidor aceita: de 3 a 500 caracteres. */
export function motivoValido(motivo: string) {
  const limpo = motivo.trim();
  return limpo.length >= 3 && limpo.length <= 500;
}

/** O pedido ainda no armazém: a coordenação cancela antes da saída. */
export function pedidoCancelavel(order: OrderGroup) {
  return Boolean(order.orderId) && (order.stage === "separar" || order.stage === "enviar");
}

/** O que já foi separado volta à posição de onde saiu; antes da separação, nada se move. */
export function voltasDoPedido(order: OrderGroup): VoltaAPosicao[] {
  if (String(order.pick?.status ?? "") !== "completed") return [];
  return (order.pick?.items ?? [])
    .map((item, index) => ({
      id: String(item.id ?? index),
      item: String(item.name ?? item.product_name ?? item.sku_code ?? item.sku ?? "Item"),
      quantidade: Number(item.picked_quantity ?? 0),
      posicao: String(item.location ?? ""),
    }))
    .filter((volta) => volta.quantidade > 0);
}

export function CancelarPedidoView({
  motivo,
  voltas,
  onMotivo,
}: {
  motivo: string;
  voltas: VoltaAPosicao[];
  onMotivo: (motivo: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="motivo-do-cancelamento">Motivo</Label>
        <Textarea
          id="motivo-do-cancelamento"
          value={motivo}
          onChange={(event) => onMotivo(event.target.value)}
          rows={3}
          maxLength={500}
        />
      </div>
      {voltas.length ? (
        <section aria-labelledby="voltam-a-posicao" className="grid gap-2">
          <h3 id="voltam-a-posicao" className="text-sm font-semibold">
            Voltam à posição
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-1.5 font-semibold">
                  Item
                </th>
                <th scope="col" className="pb-1.5 text-right font-semibold">
                  Quantidade
                </th>
                <th scope="col" className="pb-1.5 text-right font-semibold">
                  Posição
                </th>
              </tr>
            </thead>
            <tbody>
              {voltas.map((volta) => (
                <tr key={volta.id} className="border-t border-border/60">
                  <td className="py-2">{volta.item}</td>
                  <td className="py-2 text-right tabular-nums">{numero.format(volta.quantidade)} un.</td>
                  <td className="py-2 text-right font-mono">{volta.posicao || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
