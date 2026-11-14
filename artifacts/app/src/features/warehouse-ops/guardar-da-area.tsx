import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Dialog, DialogCancelar, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { desfechoDoErro } from "@/lib/carregando/use-acao-na-linha";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
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

/** "do RECEBIMENTO", "da EXPEDICAO": o artigo da área. */
export function daArea(locationId: string): string {
  return `${locationId.toUpperCase() === "EXPEDICAO" ? "da" : "do"} ${locationId}`;
}

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
        <DialogCancelar ocupado={enviando} onClick={onCancelar} />
        <BotaoDeAcao estado={enviando ? "andamento" : "repouso"} rotulo="Abrir a guarda" andamento="Abrindo…" bloqueado={!enviando && !pode} onClick={onAbrir} />
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
  // A falha fica no diálogo enquanto tenta de novo, com "Tentar de novo"; antes, o texto da falha sem a nova tentativa
  // e o "Carregando..." seco (carregamento v2, parte 13c).
  const guardaNaTela = useLeituraComFalha(guarda);
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
    <Dialog open={aberto} ocupado={abrir.isPending} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardar {daArea(locationId)}</DialogTitle>
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
        ) : guardaNaTela.isError && desfechoDoErro(guardaNaTela.error) === "recusado" ? (
          // O servidor recusou (a área não é de passagem, o item sem saldo livre): tentar de novo não muda nada, e o
          // motivo não é uma falha de leitura.
          <Alert variant="destructive">
            <AlertDescription>{guardaNaTela.error instanceof Error ? guardaNaTela.error.message : String(guardaNaTela.error)}</AlertDescription>
          </Alert>
        ) : guardaNaTela.isError ? (
          <FalhaNaLeitura
            leitura={guarda}
            erro={guardaNaTela.error}
            mensagem={[`Não consegui carregar o saldo ${daArea(locationId)}.`, guardaNaTela.error instanceof Error ? guardaNaTela.error.message : ""].filter(Boolean).join(" ")}
          />
        ) : (
          <CarregandoNaRegiao rotulo="Carregando o saldo…" />
        )}
      </DialogContent>
    </Dialog>
  );
}
