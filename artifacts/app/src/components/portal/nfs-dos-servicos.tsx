import { formatarReais } from "@workspace/dominio";

import { dataBr } from "@/lib/comercial/clientes";
import { rotuloDaNf, situacaoDaCobranca, textoDaSituacao, type SituacaoDaCobranca } from "@/lib/financeiro/faturas";
import { aPagar, ordenarNfs, textoDaArmazenagemNaNf, textoDaDemandaNaNf, textoDaMedicaoNaNf, type NfDoPortal } from "@/lib/portal/servicos";
import { cn } from "@/lib/utils";

/**
 * As NFs dos serviços no portal (parte 4.3b): as da Operação, que o
 * Financeiro registra por demanda (`client_faturas`), com a armazenagem do
 * WMS que entrou na mesma NF (Fase 7) e as linhas sem demanda da medição
 * aprovada (pergunta 64). Ficam em Faturas, junto da fatura mensal da
 * armazenagem. As que esperam pagamento primeiro, pelo vencimento; cada uma
 * com as demandas, o valor e a situação. Identidade v3, sem legenda.
 */

const TOM: Record<SituacaoDaCobranca, string> = {
  a_vencer: "border-border bg-muted text-foreground",
  vencida: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  paga: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  cancelada: "border-border bg-muted text-muted-foreground",
};

export function NfsDosServicos({ nfs, hoje }: { nfs: readonly NfDoPortal[]; hoje: string }) {
  if (!nfs.length) return null;
  const lista = ordenarNfs(nfs, hoje);
  const falta = aPagar(nfs, hoje);
  return (
    <section aria-label="NFs dos serviços" className="v3 overflow-hidden rounded-lg border border-border bg-card text-foreground">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-5 py-3.5">
        <h2 className="text-base font-extrabold">NFs dos serviços</h2>
        {falta > 0 ? <span className="ml-auto text-base font-extrabold tabular-nums">{`A pagar ${formatarReais(falta)}`}</span> : null}
      </div>
      <ul>
        {lista.map((nf, indice) => {
          const situacao = situacaoDaCobranca(nf.fatura, hoje);
          const aberta = situacao === "a_vencer" || situacao === "vencida";
          return (
            <li key={nf.fatura.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 px-5 py-3.5", indice > 0 && "border-t border-muted")}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-extrabold tabular-nums">{rotuloDaNf(nf.fatura)}</span>
                <span className="text-xs font-semibold text-muted-foreground">{`Emitida ${dataBr(nf.fatura.nf.emitidaEm)} · vence ${dataBr(nf.fatura.vencimento)}`}</span>
                {nf.fatura.demandas.map((demanda) => (
                  <span key={demanda.numero} className="text-sm font-semibold">
                    {textoDaDemandaNaNf(nf, demanda.numero, demanda.valorCents)}
                  </span>
                ))}
                {nf.fatura.armazenagem.map((linha) => (
                  <span key={linha.competencia} className="text-sm font-semibold">
                    {textoDaArmazenagemNaNf(linha.competencia, linha.valorCents)}
                  </span>
                ))}
                {nf.fatura.medicoes.flatMap((medicao) =>
                  medicao.semDemanda.map((linha) => (
                    <span key={`${medicao.competencia}:${linha.servico}`} className="text-sm font-semibold">
                      {textoDaMedicaoNaNf(linha.servico, medicao.competencia, linha.valorCents)}
                    </span>
                  )),
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-base font-extrabold tabular-nums">{formatarReais(aberta ? nf.fatura.saldoCents : nf.fatura.valorCents)}</span>
                {aberta && nf.fatura.recebidoCents > 0 ? <span className="text-xs font-semibold text-muted-foreground">{`de ${formatarReais(nf.fatura.valorCents)}`}</span> : null}
                <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", TOM[situacao])}>{textoDaSituacao(nf.fatura, hoje)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
