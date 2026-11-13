import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Dialog, DialogCancelar, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
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
  codigosDaLinha,
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
  /** As linhas do pedido não vieram (e seguem assim enquanto tenta de novo): o aviso no lugar delas. */
  linhasFalharam?: boolean;
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
    /** Lê de novo as linhas do pedido; acaba quando elas respondem. */
    tentarLinhas?: () => Promise<unknown>;
  };
  /** Sem "Receber retorno": quem não opera o armazém só consulta. */
  somenteConsulta?: boolean;
  /**
   * Os retornos não vieram: o aviso, com "Tentar de novo", no lugar do grupo
   * que sumia (carregamento v2, parte 13c). Fica enquanto tenta de novo.
   */
  falha?: { tentar: () => Promise<unknown> } | null;
};

/** A leitura ao vivo vista como a da `FalhaNaLeitura`: a nova tentativa assina de novo e acaba na resposta. */
function leituraAoVivo(tentar: () => Promise<unknown>) {
  return { error: new Error("Leitura ao vivo recusada."), refetch: tentar as never };
}

export function RetornosView({ retornos, aberto, acoes, somenteConsulta = false, falha = null }: RetornosViewProps) {
  if (falha && !aberto) {
    return (
      <section aria-labelledby="retornos-da-operacao" className="flex flex-col gap-3">
        <h2 id="retornos-da-operacao" className="text-base font-semibold text-foreground">
          Retornos da Operação
        </h2>
        <FalhaNaLeitura leitura={leituraAoVivo(falha.tentar)} mensagem="Não consegui carregar os retornos da Operação." />
      </section>
    );
  }
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
              somenteConsulta ? undefined : (
                <Button type="button" onClick={() => acoes.abrir(retorno)}>
                  Receber retorno
                </Button>
              )
            }
          />
        ))}
      </QueueGroup>
      <Dialog open={aberto !== null} ocupado={aberto?.enviando ?? false} onOpenChange={(open) => !open && acoes.fechar()}>
        <DialogContent className="sm:max-w-[520px]">
          {aberto ? (
            <>
              <DialogHeader>
                <DialogTitle>{aberto.retorno.numero}: o que voltou</DialogTitle>
              </DialogHeader>
              {/* As linhas que não vieram nunca ficam em "Carregando..." para sempre: o aviso, com "Tentar de novo"; antes,
                  a espera em bloco, nada antes de 300 ms (carregamento v2, parte 13c). */}
              {aberto.linhas === null && aberto.linhasFalharam && acoes.tentarLinhas ? (
                <FalhaNaLeitura leitura={leituraAoVivo(acoes.tentarLinhas)} mensagem="Não consegui carregar os itens do pedido." />
              ) : aberto.linhas === null ? (
                <CarregandoNaRegiao rotulo="Carregando itens…" />
              ) : (
                <ul className="grid gap-3">
                  {aberto.linhas.map((linha) => (
                    <li key={linha.id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
                      <span className="flex min-w-0 flex-col">
                        {/* Sem reticências no celular: o " · GG" do fim é o que distingue a linha. */}
                        <span className="break-words text-sm font-medium text-foreground sm:truncate">{linha.item}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {codigosDaLinha(linha)} · saiu {linha.saiu}
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
                <DialogCancelar onClick={acoes.fechar}>Voltar</DialogCancelar>
                <BotaoDeAcao
                  estado={aberto.enviando ? "andamento" : "repouso"}
                  rotulo="Receber"
                  andamento="Recebendo…"
                  bloqueado={!aberto.enviando && aberto.linhas === null}
                  onClick={acoes.receber}
                />
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
/** `somenteConsulta`: quem não opera o armazém vê os retornos sem recebê-los. */
export function RetornosDaOperacao({ somenteConsulta = false }: { somenteConsulta?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { code: customerCode } = useActiveCustomer();
  // A leitura ao vivo que falha não se refaz sozinha: "Tentar de novo" assina de novo (a chave muda), e a falha fica na
  // tela até a nova responder (carregamento v2, parte 13c).
  const retornosAoVivo = useNovaAssinatura();
  const leitura = useLeitura(
    OPERACAO_LIBERADO ? `orders:retorno_a_receber#${retornosAoVivo.vez}` : null,
    (db) => query(collection(db, "orders"), where("retorno.status", "==", "a_receber")),
    retornoAReceber,
  );
  const retornos = (leitura.itens ?? []).filter((item) => item.customerCode === customerCode).sort((a, b) => (a.chegouEm ?? "").localeCompare(b.chegouEm ?? ""));
  const [aberto, setAberto] = useState<{ retorno: RetornoAReceber; voltou: Record<string, string>; notas: string; tentou: boolean; erro: string | null; enviando: boolean } | null>(null);
  const chave = useRef<string | null>(null);
  const linhasAoVivo = useNovaAssinatura();
  const linhas = useLeitura(
    aberto ? `order_items:${aberto.retorno.orderId}#${linhasAoVivo.vez}` : null,
    (db) => query(collection(db, "order_items"), where("order_id", "==", aberto?.retorno.orderId ?? "-")),
    linhaDoRetorno,
  );
  const linhasDoAberto = aberto && linhas.itens ? linhas.itens.map((linha) => ({ ...linha, voltou: aberto.voltou[linha.id] ?? linha.voltou })) : null;
  const problema = aberto?.tentou && linhasDoAberto ? problemaDoRetorno(linhasDoAberto) : null;
  const falhaDosRetornos = retornosAoVivo.falhou(leitura);
  const falhaDasLinhas = linhasAoVivo.falhou(linhas);

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
      somenteConsulta={somenteConsulta}
      retornos={retornos}
      falha={falhaDosRetornos ? { tentar: retornosAoVivo.tentar } : null}
      aberto={aberto ? { retorno: aberto.retorno, linhas: linhasDoAberto, linhasFalharam: falhaDasLinhas, notas: aberto.notas, problema, erro: aberto.erro, enviando: aberto.enviando } : null}
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
        tentarLinhas: linhasAoVivo.tentar,
      }}
    />
  );
}

/**
 * A nova tentativa de uma leitura ao vivo (`useLeitura`), que não se refaz
 * sozinha depois de recusada: `vez` entra na chave e assina de novo. A falha
 * fica na tela enquanto a nova assinatura não responde (o "Tentando de novo…"
 * da `FalhaNaLeitura`), e a promessa de `tentar` acaba na resposta.
 */
function useNovaAssinatura() {
  const [vez, setVez] = useState(0);
  const [falhaNaTela, setFalhaNaTela] = useState(false);
  const esperando = useRef<(() => void) | null>(null);
  const ultima = useRef<{ itens: unknown[] | null; erro: boolean }>({ itens: null, erro: false });
  useEffect(() => {
    const { itens, erro } = ultima.current;
    if (erro) setFalhaNaTela(true);
    else if (itens !== null) setFalhaNaTela(false);
    if ((erro || itens !== null) && esperando.current) {
      esperando.current();
      esperando.current = null;
    }
  });
  return {
    vez,
    tentar: () =>
      new Promise<void>((pronto) => {
        esperando.current = pronto;
        setVez((atual) => atual + 1);
      }),
    /** Anota a leitura de agora e diz se a falha está na tela (a de agora, ou a de antes enquanto tenta de novo). */
    falhou: (leitura: { itens: unknown[] | null; erro: boolean }) => {
      ultima.current = leitura;
      return leitura.erro || (falhaNaTela && leitura.itens === null);
    },
  };
}
