import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { conferenceCanEditLine, type OpeningConferenceLine } from "@/lib/opening-conference";
import type { WarehouseBox } from "@/lib/warehouse-boxes";
import { formatNumber } from "@/lib/warehouse-ops/model";

export function OpeningConferenceSummary({
  box, lines, busy, onEdit, onRemove, onReview, onReopen, onResume,
}: {
  box: WarehouseBox;
  lines: OpeningConferenceLine[];
  busy: boolean;
  onEdit: (line: OpeningConferenceLine) => void;
  onRemove: (line: OpeningConferenceLine) => void;
  onReview: () => void;
  onReopen: () => void;
  onResume: () => void;
}) {
  const committing = box.status === "committing";
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={`Conferência da caixa ${box.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Conteúdo da caixa {box.code}</h3>
        <Badge variant="outline">{formatNumber(lines.length)} linhas · {formatNumber(lines.reduce((sum, line) => sum + line.counted_qty, 0))} un.</Badge>
      </div>
      {committing ? (
        <Alert>
          <AlertTitle>Guarda ainda não concluída</AlertTitle>
          <AlertDescription>
            Confira as linhas pendentes e retome a guarda. As linhas já publicadas serão preservadas.
          </AlertDescription>
        </Alert>
      ) : null}
      {lines.length ? (
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{line.product_name || line.client_item_code || line.sku_code}</div>
                <div className="text-sm text-muted-foreground">{line.client_item_code} {line.size ? `· tamanho ${line.size}` : ""} · {formatNumber(line.counted_qty)} un.</div>
                {line.status === "committed" ? <Badge variant="outline" className="mt-2">Já publicada</Badge> : null}
                {line.status === "processing" ? <Badge variant="outline" className="mt-2">Publicação em andamento</Badge> : null}
                {line.error ? <p className="mt-2 text-sm text-destructive">{line.error}</p> : null}
              </div>
              {conferenceCanEditLine(box, line) ? (
                <div className="flex gap-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit(line)} disabled={busy}><Pencil className="mr-2 size-4" />Editar</Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(line)} disabled={busy} aria-label={`Remover rascunho de ${line.product_name || line.client_item_code}`}><Trash2 className="size-4" /></Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Conte os produtos que estão nesta caixa de destino.</p>}
      <div className="flex flex-wrap gap-2">
        {box.status === "counting" ? <Button type="button" onClick={onReview} disabled={busy || !lines.length}>Revisar e fechar caixa</Button> : null}
        {box.status === "reviewed" ? <Button type="button" variant="outline" onClick={onReopen} disabled={busy}>Reabrir conferência</Button> : null}
        {committing ? <Button type="button" onClick={onResume} disabled={busy}>{busy ? <RefreshCw className="mr-2 size-4 animate-spin" /> : null}Retomar guarda</Button> : null}
      </div>
    </section>
  );
}
