/* DEMO: tela Kits do portal. Composições salvas que viram pedido em um clique. */
import { useLocation } from "wouter";
import { Gift, MessageSquareText, PackageOpen, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ClientModuleLoading,
  ClientModuleShell,
  formatNumber,
  inventoryItemAvailable,
  inventoryItemPhoto,
  inventoryItemSku,
  getInventoryItems,
  useClientOverview,
} from "../../src/pages/client/shared";
import { kitsAvailable, useDeleteKit, useKits } from "./demo-api";

export function DemoKits() {
  const overview = useClientOverview();
  const kits = useKits();
  const deleteKit = useDeleteKit();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  if (overview.isLoading || kits.isLoading || !overview.data) return <ClientModuleLoading title="Carregando kits" />;

  const items = getInventoryItems(overview.data);
  const availableBySku = new Map<string, number>();
  const photoBySku = new Map<string, string | null>();
  for (const item of items) {
    const sku = inventoryItemSku(item);
    availableBySku.set(sku, (availableBySku.get(sku) ?? 0) + inventoryItemAvailable(item));
    if (!photoBySku.get(sku)) photoBySku.set(sku, inventoryItemPhoto(item));
  }
  const list = kits.data ?? [];

  return (
    <ClientModuleShell
      overview={overview.data}
      title="Kits"
      description="Composições prontas para enviar a creators, agências e eventos. Use no pedido e escolha os destinos."
      icon={Gift}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {list.map((kit) => {
          const pieces = kit.items.reduce((sum, item) => sum + item.quantity, 0);
          const canBuild = kitsAvailable(kit, availableBySku);
          return (
            <article key={kit.id} className="flex flex-col rounded-lg border border-border bg-card">
              <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
                <div className="min-w-0">
                  <h2 className="font-semibold">{kit.name}</h2>
                  {kit.description ? <p className="mt-0.5 text-sm text-muted-foreground">{kit.description}</p> : null}
                  {kit.message ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs leading-relaxed">
                      <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>Cartão: “{kit.message}”</span>
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  {formatNumber(pieces)} peças
                </span>
              </header>
              <ul className="flex flex-1 flex-col divide-y divide-border/50 px-4">
                {kit.items.map((item) => (
                  <li key={item.sku + item.name} className="flex items-center gap-3 py-2">
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {photoBySku.get(item.sku) ? (
                        <img src={photoBySku.get(item.sku)!} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <PackageOpen className="m-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <span className="shrink-0 text-sm font-medium">× {formatNumber(item.quantity)}</span>
                  </li>
                ))}
              </ul>
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
                <p className="text-sm">
                  <span className={canBuild > 0 ? "font-semibold text-foreground" : "font-semibold text-destructive"}>
                    {formatNumber(canBuild)} kits
                  </span>{" "}
                  <span className="text-muted-foreground">dá para montar com o estoque de hoje</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer text-muted-foreground"
                    aria-label={`Excluir ${kit.name}`}
                    onClick={() =>
                      deleteKit.mutate(kit.id, {
                        onSuccess: () => toast({ title: "Kit excluído", description: kit.name }),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" className="cursor-pointer" onClick={() => navigate(`/portal/estoque?kit=${encodeURIComponent(kit.id)}`)}>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Usar no pedido
                  </Button>
                </div>
              </footer>
            </article>
          );
        })}
        <article className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
          <Gift className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Criar um kit</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Monte o pedido no Estoque com os itens e as quantidades do kit e clique em Salvar como kit.
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-1 cursor-pointer" onClick={() => navigate("/portal/estoque")}>
            Ir para o Estoque
          </Button>
        </article>
      </div>
    </ClientModuleShell>
  );
}
