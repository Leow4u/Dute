import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useLocation } from "wouter";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { formatBoxDimensions } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import { statusLabel, type TaskQueueEntry, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { destinoDaGuarda } from "@/lib/warehouse-ops/receiving";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import { guardarCaixa, horaCurta, naoCabeNaPrateleira, timelineDaCaixa, type CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";

import {
  DestinoDaCaixa,
  RecusaDaPrateleira,
  useDestinoDaCaixa,
  type DestinoDaCaixaEstado,
  type DestinoDaCaixaProps,
} from "./destino-da-caixa";

/**
 * A guarda da caixa do recebimento (docs/plataforma/recebimento-com-caixas.md,
 * parte 5f; mockups WmsGuardaCaixa, WmsGuardaCaixaCelular,
 * WmsGuardaCaixaSemPrateleira, WmsGuardaCaixaCelularSemPrateleira e
 * WmsGuardaNaoCabe): a caixa inteira vai à prateleira reservada para ela
 * ("Concluir guarda em B-02", parte 4f). Sem prateleira, ela ganha o destino
 * aqui, como na bancada (decisão 14, parte 4g); com destino, "Não cabe aqui"
 * solta a reserva e avisa a coordenação (decisão 15, parte 4h). A recusa do
 * servidor (o RECEBIMENTO curto, decisão 24) fica na própria guarda.
 */

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** "Rua B · prateleira 02 · zona BTG Pactual", pelo cadastro da prateleira. */
export function enderecoDaPrateleira(posicao: Pick<WarehousePosition, "aisle" | "shelf" | "customer_code"> | null | undefined) {
  if (!posicao) return null;
  return [
    posicao.aisle ? `Rua ${posicao.aisle}` : null,
    Number.isFinite(Number(posicao.shelf)) ? `prateleira ${String(posicao.shelf).padStart(2, "0")}` : null,
    posicao.customer_code ? `zona ${posicao.customer_code}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function medidasDaCaixa(caixa: CaixaDaChegada | null) {
  if (!caixa || caixa.length_m == null || caixa.width_m == null || caixa.height_m == null) return null;
  return formatBoxDimensions({
    length_m: caixa.length_m,
    width_m: caixa.width_m,
    height_m: caixa.height_m,
    gross_weight_kg: caixa.gross_weight_kg,
  });
}

/** O destino da guarda: a prateleira reservada para a caixa (ou onde ela foi guardada), ou o da tarefa. */
export function destinoDaCaixaNaGuarda(task: WarehouseTask) {
  const caixa = task.box ?? null;
  if (caixa) return (caixa.status === "committing" || caixa.status === "stored") && caixa.location_id ? caixa.location_id : "";
  return destinoDaGuarda(task);
}

export type GuardaDaCaixaProps = {
  task: WarehouseTask;
  /** A linha de endereço da prateleira de destino, quando o cadastro já chegou. */
  endereco: string | null;
  /** O cadastro das prateleiras ainda não chegou: o lugar da linha do endereço fica reservado, com o bloco neutro. */
  enderecoCarregando?: boolean;
  podeOperar: boolean;
  ocupado: boolean;
  /** A guarda está sendo concluída: o "Concluir guarda" mostra a espera dele; as outras ações, ocupadas. */
  guardando?: boolean;
  /** A recusa do servidor ao guardar, mostrada na própria guarda. */
  erro: string | null;
  destino: DestinoDaCaixaEstado;
  recusando: string | null;
  onDestino: Omit<DestinoDaCaixaProps, "estado" | "ocupado">;
  onCancelarRecusa: () => void;
  onRecusar: (motivo: string) => void;
  /** O "Não cabe aqui" com o destino confirmado, aberto. */
  liberando: boolean;
  onNaoCabe: () => void;
  onCancelarLiberar: () => void;
  onLiberar: (motivo: string) => void;
  onGuardar: () => void;
  /** A etiqueta da caixa com destino (parte 6): abre a tela de Etiquetas, também no celular (decisão 28). */
  onEtiqueta?: () => void;
};

/** A timeline da caixa (mockup WmsGuardaCaixa): da etapa mais recente para a primeira. */
function TimelineDaCaixa({ caixa }: { caixa: CaixaDaChegada }) {
  const etapas = timelineDaCaixa(caixa);
  if (!etapas.length) return null;
  return (
    <section aria-labelledby="timeline-da-caixa" className="flex flex-col gap-2">
      <h3 id="timeline-da-caixa" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Timeline</h3>
      <ol className="flex flex-col gap-2">
        {etapas.map((etapa, index) => (
          <li key={`${etapa.quando}-${etapa.titulo}`} className="flex items-start gap-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-extrabold text-background">
              {etapas.length - index}
            </span>
            <span>
              <strong>{etapa.titulo}</strong> <span className="text-muted-foreground">{etapa.detalhe}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** O corpo da guarda, sem as chamadas. */
export function GuardaDaCaixaConteudo(props: GuardaDaCaixaProps) {
  const { task, podeOperar, ocupado } = props;
  const caixa = task.box ?? null;
  const codigo = task.box_code ?? caixa?.code ?? "";
  const destino = destinoDaCaixaNaGuarda(task);
  const origem = task.source_location_id || task.items?.[0]?.source_location_id || "RECEBIMENTO";
  const linhas = task.box_lines ?? caixa?.lines ?? [];
  const medidas = medidasDaCaixa(caixa);
  const conteudo = linhas.map((linha) => `${linha.size || linha.client_item_code || linha.sku_code} ${numero.format(linha.counted_qty)}`).join(" · ");
  const detalhe = [medidas, conteudo].filter(Boolean).join(" · ");
  const concluida = !podeOperar && task.status === "completed";
  // A etiqueta impressa com outra prateleira: a caixa mudou de destino depois (parte 6).
  const etiquetaAntiga =
    caixa?.label_printed_at && caixa.label_printed_location && destino && caixa.label_printed_location.toUpperCase() !== destino.toUpperCase()
      ? caixa
      : null;
  const etiqueta =
    destino && props.onEtiqueta ? (
      <Button type="button" variant="outline" onClick={props.onEtiqueta}>
        <Printer aria-hidden="true" />
        Imprimir etiqueta
      </Button>
    ) : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground">Guarda</Badge>
        <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{statusLabel(task.status)}</Badge>
        {!destino && !concluida ? (
          <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">sem prateleira</Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold tracking-tight">Guardar caixa {codigo}</h2>
        <p className="text-sm text-muted-foreground">
          {[task.receipt_number, task.invoice_number ? `NF ${task.invoice_number}` : null, `origem ${origem}`].filter(Boolean).join(" · ")}
        </p>
      </div>

      {destino ? (
        <section aria-labelledby="destino-da-guarda" className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-5">
          <h3 id="destino-da-guarda" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
            {concluida ? "Guardada em" : "Destino"}
          </h3>
          <p className="text-4xl font-extrabold tracking-tight">{destino}</p>
          {props.endereco ? (
            <p className="text-sm">{props.endereco}</p>
          ) : props.enderecoCarregando ? (
            // O endereço chega depois do destino: o lugar dele fica reservado, sem pular a guarda quando ele entra.
            <span className="flex h-5 items-center">
              <Esqueleto forma="texto" className="w-56 max-w-full" />
            </span>
          ) : null}
          {etiquetaAntiga ? (
            <p className="mt-2 rounded-md border border-warning-soft-border bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
              Etiqueta impressa com {etiquetaAntiga.label_printed_location} · {horaCurta(etiquetaAntiga.label_printed_at)}
            </p>
          ) : null}
        </section>
      ) : podeOperar && caixa ? (
        <>
          <DestinoDaCaixa estado={props.destino} ocupado={ocupado} {...props.onDestino} />
          <RecusaDaPrateleira
            prateleira={props.recusando}
            caixa={codigo}
            detalhe={detalhe}
            enviando={ocupado}
            onCancelar={props.onCancelarRecusa}
            onRecusar={props.onRecusar}
          />
        </>
      ) : null}

      <section aria-labelledby="conteudo-da-guarda" className="flex flex-col gap-2">
        <h3 id="conteudo-da-guarda" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Conteúdo</h3>
        <ul className="flex flex-col gap-2">
          {linhas.map((linha) => (
            <li
              key={`${linha.inbound_item_id}:${linha.sku_code}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block font-bold">{linha.product_name || linha.sku_code}</span>
                <span className="block text-sm text-muted-foreground">{[linha.client_item_code, linha.sku_code].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 font-extrabold">{numero.format(linha.counted_qty)} un.</span>
            </li>
          ))}
        </ul>
      </section>
      {medidas ? <p className="text-sm text-muted-foreground">{medidas}</p> : null}

      {props.erro ? (
        <Alert variant="destructive">
          <AlertDescription>{props.erro}</AlertDescription>
        </Alert>
      ) : null}
      {podeOperar ? (
        // Ocupado não é desabilitado: "Concluir guarda" é o BotaoDeAcao, com "Guardando em B-02…" e o foco nele; o
        // "Não cabe aqui" espera com aria-disabled (carregamento v2, parte 13c).
        <div className="flex flex-col gap-2 @md:flex-row">
          <BotaoDeAcao
            className="max-md:min-h-12 @md:flex-1"
            estado={props.guardando ? "andamento" : "repouso"}
            rotulo={destino ? `Concluir guarda em ${destino}` : "Concluir guarda"}
            andamento={destino ? `Guardando em ${destino}…` : "Guardando…"}
            bloqueado={!props.guardando && (!destino || !caixa || ocupado)}
            onClick={props.onGuardar}
          />
          {destino ? (
            <Button
              type="button"
              variant="outline"
              className={cn("max-md:min-h-12", caixa && ocupado && "opacity-45 hover:bg-card active:bg-card")}
              disabled={!caixa}
              aria-disabled={ocupado || undefined}
              onClick={() => {
                if (!ocupado) props.onNaoCabe();
              }}
            >
              Não cabe aqui
            </Button>
          ) : null}
          {etiqueta}
        </div>
      ) : concluida && etiqueta ? (
        <div className="flex flex-col gap-2 @md:flex-row">{etiqueta}</div>
      ) : null}
      {podeOperar && destino ? (
        <RecusaDaPrateleira
          prateleira={props.liberando ? destino : null}
          caixa={codigo}
          detalhe={detalhe}
          enviando={ocupado}
          acao="Liberar"
          onCancelar={props.onCancelarLiberar}
          onRecusar={props.onLiberar}
        />
      ) : null}
      {caixa ? <TimelineDaCaixa caixa={caixa} /> : null}
    </div>
  );
}

/** A guarda com as chamadas: guardar, soltar a reserva e o destino da caixa sem prateleira. */
export function GuardaDaCaixa({ entry }: { entry: TaskQueueEntry }) {
  const { task } = entry;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { code: customerCode } = useActiveCustomer();
  const caixa = task.box ?? null;
  const receiptId = task.receipt_id ?? "";
  const codigo = task.box_code ?? caixa?.code ?? "";
  const podeOperar = task.can_advance !== false;
  const [revisoes, setRevisoes] = useState<Record<string, number>>({});
  const [liberando, setLiberando] = useState(false);
  const revisao = caixa ? Math.max(caixa.conference_revision, revisoes[caixa.code] ?? 0) : 0;
  const chave = () => crypto.randomUUID();
  const destino = destinoDaCaixaNaGuarda(task);

  const anotarRevisao = (valor: unknown, code: string) => {
    if (typeof valor === "number") setRevisoes((atual) => ({ ...atual, [code]: valor }));
  };
  const releitura = () => queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  const falhou = (titulo: string) => (error: unknown) => {
    toast({ title: titulo, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
  };

  const posicoes = useQuery({
    queryKey: ["warehouse-positions", "all-pages"],
    staleTime: 30_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
    enabled: Boolean(destino),
  });
  const destinoDaCaixa = useDestinoDaCaixa({
    caixa: podeOperar && caixa && caixa.status === "reviewed" ? caixa : null,
    receiptId,
    customerCode,
    revisao,
    chave,
    anotarRevisao,
    releitura,
    onConfirmado: () => undefined,
    falhou,
  });
  const daCaixa = () => ({
    receipt_id: receiptId,
    customer_code: customerCode || undefined,
    box_code: caixa!.code,
    expected_revision: revisao,
    idempotency_key: chave(),
  });
  const guardar = useMutation({
    mutationFn: () => guardarCaixa({ ...daCaixa(), location_id: destino }),
    onSuccess: () => {
      toast({ title: `Caixa ${caixa?.code ?? ""} guardada em ${destino}` });
      void releitura();
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
    },
  });
  const liberar = useMutation({
    mutationFn: (motivo: string) => naoCabeNaPrateleira({ ...daCaixa(), reason: motivo }),
    onSuccess: (resultado) => {
      setLiberando(false);
      if (caixa) anotarRevisao(resultado.conference_revision, caixa.code);
      void releitura();
    },
    onError: falhou("Não foi possível liberar a prateleira"),
  });
  const ocupado = guardar.isPending || liberar.isPending || destinoDaCaixa.ocupado;
  const posicao = (posicoes.data?.items ?? []).find((item) => item.code === destino) ?? null;

  return (
    <GuardaDaCaixaConteudo
      task={task}
      endereco={enderecoDaPrateleira(posicao)}
      enderecoCarregando={posicoes.isLoading}
      podeOperar={podeOperar}
      ocupado={ocupado}
      guardando={guardar.isPending}
      erro={guardar.error ? (guardar.error instanceof Error ? guardar.error.message : String(guardar.error)) : null}
      destino={destinoDaCaixa.estado}
      recusando={destinoDaCaixa.recusando}
      onDestino={destinoDaCaixa.acoes}
      onCancelarRecusa={destinoDaCaixa.onCancelarRecusa}
      onRecusar={destinoDaCaixa.onRecusar}
      liberando={liberando}
      onNaoCabe={() => setLiberando(true)}
      onCancelarLiberar={() => setLiberando(false)}
      onLiberar={(motivo) => liberar.mutate(motivo)}
      onGuardar={() => {
        guardar.reset();
        guardar.mutate();
      }}
      onEtiqueta={codigo ? () => navigate(labelsUrl({ boxes: [codigo], receipt: task.receipt_number ?? null })) : undefined}
    />
  );
}
