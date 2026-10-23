import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueueGroup, QueueRow } from "@/components/ui/queue-list";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { OPERACAO_LIBERADO } from "@/lib/liberacao";
import { novaChave } from "@/lib/operacao/api";
import { useLeitura } from "@/lib/operacao/leitura";
import { humanApiError } from "@/lib/permissions";
import {
  detalheDoRetorno,
  linhaDoRetorno,
  pedidoDoRetorno,
  problemaDoRetorno,
  retornoAReceber,
  type LinhaDoRetorno,
  type RetornoAReceber,
} from "@/lib/warehouse-ops/retorno";

/**
 * Devoluções › Retornos da Operação (docs/plataforma/fase-4-financeiro.md,
 * parte 4.5d): o retorno a receber de cada pedido cuja OS de volta terminou,
 * e o diálogo de conferir o que voltou e receber. Sem legenda: rótulos,
 * dados e ações. Segue o docs/sistema-visual.md do WMS até a v3.
 */

export type RetornoAberto = {
  retorno: RetornoAReceber;
  /** null enquanto as linhas do pedido carregam. */
  linhas: LinhaDoRetorno[] | null;
  notas: string;
  problema: string | null;
  erro: string | null;
  enviando: boolean;
};

export type RetornosViewProps = {
  retornos: RetornoAReceber[];
  aberto: RetornoAberto | null;
  acoes: {
    abrir: (retorno: RetornoAReceber) => void;
    fechar: () => void;
    mudarLinha: (id: string, voltou: string) => void;
    mudarNotas: (notas: string) => void;
    receber: () => void;
  };
};

export function RetornosView({ retornos, aberto, acoes }: RetornosViewProps) {
  if (!retornos.length && !aberto) return null;
  return (
    <>
      <QueueGroup title="Retornos da Operação" hint="a receber" count={retornos.length} empty="Nenhum retorno a receber.">
        {retornos.map((retorno) => (
          <QueueRow
            key={retorno.orderId}
            icon={Undo2}
            tone="deliver"
            title={retorno.numero}
            meta={detalheDoRetorno(retorno) || "—"}
            actions={
              <Button type="button" onClick={() => acoes.abrir(retorno)}>
                Receber retorno
              </Button>
            }
          />
        ))}
      </QueueGroup>
      <Dialog open={aberto !== null} onOpenChange={(open) => !open && acoes.fechar()}>
        <DialogContent className="sm:max-w-[520px]">
          {aberto ? (
            <>
              <DialogHeader>
                <DialogTitle>{aberto.retorno.numero}: o que voltou</DialogTitle>
              </DialogHeader>
              {aberto.linhas === null ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : (
                <ul className="grid gap-3">
                  {aberto.linhas.map((linha) => (
                    <li key={linha.id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{linha.nome}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {linha.skuCode} · saiu {linha.saiu}
                        </span>
                      </span>
                      <span className="grid gap-1.5">
                        <Label htmlFor={`retorno-${linha.id}`}>Voltou</Label>
                        <Input id={`retorno-${linha.id}`} inputMode="numeric" value={linha.voltou} onChange={(event) => acoes.mudarLinha(linha.id, event.target.value)} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2">
                <Label htmlFor="retorno-notas">Observação</Label>
                <Textarea id="retorno-notas" rows={2} value={aberto.notas} onChange={(event) => acoes.mudarNotas(event.target.value)} />
              </div>
              {aberto.problema || aberto.erro ? (
                <p role="alert" className="text-sm text-destructive">
                  {aberto.problema ?? aberto.erro}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={acoes.fechar}>
                  Voltar
                </Button>
                <Button type="button" disabled={aberto.enviando || aberto.linhas === null} onClick={acoes.receber}>
                  {aberto.enviando ? "Recebendo..." : "Receber"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const corpo = await response.text().catch(() => "");
    let mensagem = corpo;
    try {
      mensagem = String((JSON.parse(corpo) as { message?: unknown }).message ?? corpo);
    } catch {
      // corpo sem JSON: a mensagem é o texto
    }
    throw new Error(mensagem || `HTTP ${response.status}`);
  }
}

/** Os retornos a receber do cliente ativo, ao vivo, com a Operação liberada. */
export function RetornosDaOperacao() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { code: customerCode } = useActiveCustomer();
  const leitura = useLeitura(
    OPERACAO_LIBERADO ? "orders:retorno_a_receber" : null,
    (db) => query(collection(db, "orders"), where("retorno.status", "==", "a_receber")),
    retornoAReceber,
  );
  const retornos = (leitura.itens ?? []).filter((item) => item.customerCode === customerCode).sort((a, b) => (a.chegouEm ?? "").localeCompare(b.chegouEm ?? ""));
  const [aberto, setAberto] = useState<{ retorno: RetornoAReceber; voltou: Record<string, string>; notas: string; tentou: boolean; erro: string | null; enviando: boolean } | null>(null);
  const chave = useRef<string | null>(null);
  const linhas = useLeitura(
    aberto ? `order_items:${aberto.retorno.orderId}` : null,
    (db) => query(collection(db, "order_items"), where("order_id", "==", aberto?.retorno.orderId ?? "-")),
    linhaDoRetorno,
  );
  const linhasDoAberto = aberto && linhas.itens ? linhas.itens.map((linha) => ({ ...linha, voltou: aberto.voltou[linha.id] ?? linha.voltou })) : null;
  const problema = aberto?.tentou && linhasDoAberto ? problemaDoRetorno(linhasDoAberto) : null;

  async function receber() {
    if (!aberto || !linhasDoAberto) return;
    setAberto({ ...aberto, tentou: true, erro: null });
    if (problemaDoRetorno(linhasDoAberto)) return;
    setAberto({ ...aberto, tentou: true, erro: null, enviando: true });
    chave.current ??= novaChave();
    try {
      await postJson(`/api/orders/${encodeURIComponent(aberto.retorno.orderId)}/return`, pedidoDoRetorno(aberto.retorno.orderId, linhasDoAberto, aberto.notas, chave.current));
      chave.current = null;
      toast({ title: `Retorno do ${aberto.retorno.numero} recebido` });
      setAberto(null);
      void queryClient.invalidateQueries({ queryKey: ["returns-pending"] });
    } catch (error) {
      setAberto((atual) => (atual ? { ...atual, enviando: false, erro: humanApiError(error as Error, "Tente novamente em instantes.") } : atual));
    }
  }

  return (
    <RetornosView
      retornos={retornos}
      aberto={aberto ? { retorno: aberto.retorno, linhas: linhasDoAberto, notas: aberto.notas, problema, erro: aberto.erro, enviando: aberto.enviando } : null}
      acoes={{
        abrir: (retorno) => {
          chave.current = null;
          setAberto({ retorno, voltou: {}, notas: "", tentou: false, erro: null, enviando: false });
        },
        fechar: () => setAberto(null),
        mudarLinha: (id, voltou) => {
          chave.current = null;
          setAberto((atual) => (atual ? { ...atual, voltou: { ...atual.voltou, [id]: voltou }, erro: null } : atual));
        },
        mudarNotas: (notas) => {
          chave.current = null;
          setAberto((atual) => (atual ? { ...atual, notas } : atual));
        },
        receber: () => void receber(),
      }}
    />
  );
}
