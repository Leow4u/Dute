import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogCancelar, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LinhaAutorizada, LinhaDoPrazoVencido } from "@/lib/comercial/autorizacoes";
import { dataBr } from "@/lib/comercial/clientes";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";

/**
 * Cancelar a autorização registrada por engano (recordAuthorization, cancel):
 * pede o motivo; as demandas sem outra autorização voltam a aguardar. A
 * gravação, com a chave de idempotência, é da página. O diálogo abre fora do
 * contêiner da tela (portal), então leva a classe .v3.
 */
export function CancelarAutorizacaoDialog({
  autorizacao,
  ocupado,
  erro,
  onVoltar,
  onConfirmar,
}: {
  autorizacao: LinhaAutorizada | null;
  ocupado: boolean;
  erro: string | null;
  onVoltar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const id = autorizacao?.id ?? null;
  useEffect(() => {
    setMotivo("");
  }, [id]);
  return (
    <Dialog
      open={autorizacao !== null}
      ocupado={ocupado}
      onOpenChange={(aberto) => {
        if (!aberto) onVoltar();
      }}
    >
      <DialogContent className="v3 max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar autorização</DialogTitle>
          {autorizacao ? (
            <DialogDescription>
              {[autorizacao.pedido, autorizacao.cliente, autorizacao.demandas.join(", ")].filter(Boolean).join(" · ")}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {autorizacao?.daMedicao ? (
          <p className="text-sm font-bold text-muted-foreground">
            A medição segue aprovada e a autorização não se refaz por aqui: as demandas voltam a esperar a medição.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="aut-motivo">Motivo</Label>
          <Textarea id="aut-motivo" rows={3} value={motivo} onChange={(evento) => setMotivo(evento.target.value)} disabled={ocupado} />
        </div>
        {erro ? (
          <p role="alert" className="text-sm font-bold text-destructive">
            {erro}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <DialogCancelar onClick={onVoltar}>Voltar</DialogCancelar>
          <BotaoDeAcao variant="destructive" estado={ocupado ? "andamento" : "repouso"} rotulo="Cancelar autorização" andamento="Cancelando a autorização…" onClick={() => onConfirmar(motivo)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Perder a demanda pelo prazo de faturamento vencido (parte 7.5b,
 * advanceDemand lose com o motivo prazo_faturamento): a nota é opcional; o
 * servidor confere o prazo do contrato de novo. Reabrir devolve a demanda à
 * etapa de antes.
 */
export function PerderPorPrazoDialog({
  linha,
  ocupado,
  erro,
  onVoltar,
  onConfirmar,
}: {
  linha: LinhaDoPrazoVencido | null;
  ocupado: boolean;
  erro: string | null;
  onVoltar: () => void;
  onConfirmar: (nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  const numero = linha?.numero ?? null;
  useEffect(() => {
    setNota("");
  }, [numero]);
  return (
    <Dialog
      open={linha !== null}
      ocupado={ocupado}
      onOpenChange={(aberto) => {
        if (!aberto) onVoltar();
      }}
    >
      <DialogContent className="v3 max-w-md">
        <DialogHeader>
          <DialogTitle>Perder por prazo de faturamento</DialogTitle>
          {linha ? <DialogDescription>{[linha.rotulo, linha.cliente, `venceu em ${dataBr(linha.limite)}`].join(" · ")}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="perda-nota">Nota</Label>
          <Textarea id="perda-nota" rows={3} maxLength={1000} value={nota} onChange={(evento) => setNota(evento.target.value)} disabled={ocupado} />
        </div>
        {erro ? (
          <p role="alert" className="text-sm font-bold text-destructive">
            {erro}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <DialogCancelar onClick={onVoltar}>Voltar</DialogCancelar>
          <BotaoDeAcao variant="destructive" estado={ocupado ? "andamento" : "repouso"} rotulo="Perder por prazo" andamento="Registrando a perda…" onClick={() => onConfirmar(nota)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
