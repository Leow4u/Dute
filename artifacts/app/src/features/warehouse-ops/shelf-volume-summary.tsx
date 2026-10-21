import { Progress } from "@/components/ui/progress";
import { calculateShelfVolume, formatVolumeM3, type VolumeBox, type VolumeDimensions, type VolumePosition } from "@/lib/warehouse-volume";
import { cn } from "@/lib/utils";

const percentFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** A mesma leitura de volume para a guarda e o mapa; nunca decide encaixe. */
export function ShelfVolumeSummary({
  position,
  boxes,
  incomingBox,
  unconfirmed = false,
  title,
  className,
}: {
  position: VolumePosition;
  boxes: readonly VolumeBox[];
  incomingBox?: VolumeDimensions;
  unconfirmed?: boolean;
  title?: string;
  className?: string;
}) {
  const summary = calculateShelfVolume(position, boxes, incomingBox);
  const unknownOccupancy = unconfirmed && summary.boxCount === 0;
  const occupied = unknownOccupancy ? null : summary.occupiedM3;
  const free = unknownOccupancy ? null : summary.freeM3;
  const occupiedPercent = unknownOccupancy ? null : summary.occupiedPercent;
  const percentLabel = occupiedPercent === null ? null : `${percentFormatter.format(occupiedPercent)}% do volume ocupado`;
  const overCapacity = summary.totalM3 !== null && occupied !== null && occupied > summary.totalM3;
  const metrics: Array<{ label: string; value: number | null }> = [
    { label: "Volume total", value: summary.totalM3 },
    { label: "Ocupado", value: occupied },
    { label: "Livre estimado", value: free },
  ];
  return (
    <section aria-label={title ?? `Espaço na prateleira ${position.code}`} className={cn("@container space-y-3", className)}>
      <h3 className="text-sm font-semibold text-foreground">{title ?? `Espaço na prateleira ${position.code}`}</h3>
      <dl className="grid gap-3 @sm:grid-cols-3">
        {metrics.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-3 @sm:block">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={cn("text-base font-semibold @sm:mt-1 @sm:text-xl", label === "Livre estimado" ? "text-primary" : "text-foreground")}>
              {formatVolumeM3(value)}
            </dd>
          </div>
        ))}
      </dl>
      {occupiedPercent !== null ? (
        <div className="space-y-1.5">
          <Progress value={Math.min(100, Math.max(0, occupiedPercent))} aria-label="Volume ocupado" aria-valuetext={percentLabel ?? undefined} />
          <p className="text-xs text-muted-foreground">{percentLabel}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{unknownOccupancy ? "Ocupação não confirmada" : "Medidas incompletas para calcular a ocupação."}</p>
      )}
      {summary.pendingCount > 0 ? <p className="text-sm text-muted-foreground">Guarda em andamento. Volume livre indisponível até a confirmação.</p> : null}
      {overCapacity ? <p className="text-xs text-warning-soft-foreground">Volume registrado acima da capacidade cadastrada.</p> : null}
      {incomingBox && !unknownOccupancy && summary.pendingCount === 0 ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3 text-sm">
          <span className="font-medium text-foreground">Após guardar esta caixa</span>
          <span className="text-muted-foreground">
            Livre estimado: {formatVolumeM3(summary.projectedFreeM3)}
            {summary.projectedOccupiedPercent !== null ? ` · Ocupação: ${percentFormatter.format(summary.projectedOccupiedPercent)}%` : ""}
          </span>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Estimativa pelas medidas cadastradas e caixas já guardadas. Volume livre não garante encaixe.</p>
    </section>
  );
}
