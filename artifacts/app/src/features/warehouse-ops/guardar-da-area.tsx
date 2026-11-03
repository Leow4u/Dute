import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { abrirGuardaDaArea, podeAbrirGuarda, verGuardaDaArea, type GuardaDaArea } from "@/lib/wms/guarda-da-area";

/**
 * "Guardar" no Estoque (docs/plataforma/recebimento-com-caixas.md, decisão
 * 16 e parte 7e; mockup WmsEstoqueGuardar): a coordenação abre a guarda do
 * saldo parado numa área de passagem, até o que está sem guarda. A guarda
 * aberta vai a Receber › Para guardar e segue a guarda de hoje.
 */

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** O corpo do diálogo, sem a busca nem o envio. */
export function GuardarDaAreaConteudo({
  nome,
  codigo,
  guarda,
  quantidade,
  motivo,
  enviando,
  onQuantidade,
  onMotivo,
  onCancelar,
  onAbrir,
}: {
  nome: string;
  codigo: string;
  guarda: GuardaDaArea;
  quantidade: string;
  motivo: string;
  enviando: boolean;
  onQuantidade: (valor: string) => void;
  onMotivo: (valor: string) => void;
  onCancelar: () => void;
  onAbrir: () => void;
}) {
  const pode = podeAbrirGuarda(Number(quantidade), guarda.sem_guarda, motivo);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-semibold text-foreground">{nome}</p>
        <p className="text-sm text-muted-foreground">{codigo}</p>
      </div>
      <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
        <tbody>
          <tr className="border-b border-border">
            <th scope="row" className="px-3 py-2 text-left font-normal">Livre no {guarda.location_id}</th>
            <td className="px-3 py-2 text-right tabular-nums">{numero.format(guarda.livre)}</td>
          </tr>
          <tr className="border-b border-border">
            <th scope="row" className="px-3 py-2 text-left font-normal">Em guardas abertas</th>
            <td className="px-3 py-2 text-right tabular-nums">{numero.format(guarda.em_guardas_abertas)}</td>
          </tr>
          <tr>
            <th scope="row" className="px-3 py-2 text-left font-semibold">Sem guarda</th>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">{numero.format(guarda.sem_guarda)}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="guardar-quantidade">Quantidade</Label>
          <Input
            id="guardar-quantidade"
            type="number"
            inputMode="decimal"
            min={0}
            max={guarda.sem_guarda}
            step="any"
            value={quantidade}
            onChange={(event) => onQuantidade(event.target.value)}
            className="text-right"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardar-motivo">Motivo</Label>
          <Input id="guardar-motivo" maxLength={300} value={motivo} onChange={(event) => onMotivo(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="button" disabled={!pode || enviando} onClick={onAbrir}>
          Abrir a guarda
        </Button>
      </div>
    </div>
  );
}

export function GuardarDaAreaDialog({
  aberto,
  onFechar,
  customerCode,
  skuCode,
  locationId,
  nome,
  codigo,
}: {
  aberto: boolean;
  onFechar: () => void;
  customerCode: string;
  skuCode: string;
  locationId: string;
  nome: string;
  codigo: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");
  // Uma chave por abertura do diálogo: repetir o clique não abre outra guarda.
  const chave = useRef("");
  // A quantidade começa no sem guarda uma vez por abertura; apagar o campo não a traz de volta.
  const preenchida = useRef(false);
  const guarda = useQuery({
    queryKey: ["guarda-da-area", customerCode, skuCode, locationId],
    queryFn: () => verGuardaDaArea({ customer_code: customerCode, sku_code: skuCode, location_id: locationId }),
    enabled: aberto && Boolean(customerCode && skuCode && locationId),
    staleTime: 0,
  });
  useEffect(() => {
    if (!aberto) return;
    chave.current = crypto.randomUUID();
    preenchida.current = false;
    setMotivo("");
    setQuantidade("");
  }, [aberto, locationId, skuCode]);
  useEffect(() => {
    if (!aberto || !guarda.data || preenchida.current) return;
    preenchida.current = true;
    setQuantidade(String(guarda.data.sem_guarda));
  }, [aberto, guarda.data]);

  const abrir = useMutation({
    mutationFn: () =>
      abrirGuardaDaArea({
        customer_code: customerCode,
        sku_code: skuCode,
        location_id: locationId,
        quantity: Number(quantidade),
        reason: motivo.trim(),
        idempotency_key: chave.current,
      }),
    onSuccess: (resultado) => {
      toast({ title: "Guarda aberta", description: `${numero.format(resultado.quantity)} un. · ${resultado.location_id} · em Receber › Para guardar` });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["guarda-da-area"] });
      onFechar();
    },
    onError: (error) => {
      toast({ title: "Não foi possível abrir a guarda", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardar do {locationId}</DialogTitle>
        </DialogHeader>
        {guarda.data ? (
          <GuardarDaAreaConteudo
            nome={nome}
            codigo={codigo}
            guarda={guarda.data}
            quantidade={quantidade}
            motivo={motivo}
            enviando={abrir.isPending}
            onQuantidade={setQuantidade}
            onMotivo={setMotivo}
            onCancelar={onFechar}
            onAbrir={() => abrir.mutate()}
          />
        ) : guarda.isError ? (
          <p className="text-sm text-destructive-soft-foreground">{guarda.error instanceof Error ? guarda.error.message : String(guarda.error)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
