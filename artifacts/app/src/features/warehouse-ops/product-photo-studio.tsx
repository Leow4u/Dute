import { useId, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchJson } from "@/lib/warehouse-ops/model";
import { type ProductPhoto } from "./shared";
import {
  type PhotoContext,
  type Mannequin,
  mannequinLabels,
  suggestMannequin,
  isGeneratedPhoto,
} from "./photo-context";

type Props = {
  photos: ProductPhoto[];
  customerCode: string;
  productName: string;
  category?: string;
  context?: PhotoContext;
  sourceUrl?: string;
  triggerLabel?: string;
  disabled?: boolean;
  onApprove: (
    photos: ProductPhoto[],
    primaryUrl?: string,
  ) => Promise<void> | void;
};

/** The generated preview is never added to the catalog until a person approves. */
export function ProductPhotoStudio({
  photos,
  customerCode,
  productName,
  category = "",
  context = {},
  sourceUrl,
  triggerLabel,
  disabled,
  onApprove,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"catalog" | "mannequin" | "garment">(
    "catalog",
  );
  const [previews, setPreviews] = useState<
    { original: ProductPhoto; generated: ProductPhoto }[]
  >([]);
  const [primary, setPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestion = suggestMannequin(productName, context);
  const [mannequin, setMannequin] = useState<Mannequin | undefined>(
    suggestion.value,
  );
  const capacity = Math.max(0, 8 - photos.length);
  const chosen = photos.filter((photo) => selected.includes(photo.fileUrl));

  async function generate() {
    if (mode === "mannequin" && !mannequin) {
      setError("Escolha o manequim antes de gerar a foto.");
      return;
    }
    setError("");
    setPreviews([]);
    setBusy(true);
    try {
      // Bounded sequential generation avoids bursts and lets partial successes be reviewed.
      for (const original of chosen.slice(0, capacity)) {
        const generated = await fetchJson<ProductPhoto>(
          "/api/products/generate-photo",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              customer_code: customerCode,
              source_url: original.fileUrl,
              mode,
              product_name: productName,
              category,
              ...context,
              mannequin: mode === "mannequin" ? mannequin : undefined,
              request_id: crypto.randomUUID(),
            }),
          },
        );
        setPreviews((current) => [
          ...current,
          {
            original: generated.sourceUrl
              ? { ...original, fileUrl: generated.sourceUrl }
              : original,
            generated,
          },
        ]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível gerar a foto. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setSaving(true);
    setError("");
    try {
      const generated = previews.map((preview) => preview.generated);
      await onApprove(generated, primary ? generated[0]?.fileUrl : undefined);
      setOpen(false);
      setPreviews([]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível salvar as fotos.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy || saving) return;
        if (next) {
          const source =
            photos.find((photo) => photo.fileUrl === sourceUrl) ??
            photos.find((photo) => !isGeneratedPhoto(photo.fileUrl)) ??
            photos[0];
          setSelected(source ? [source.fileUrl] : []);
          setMannequin(suggestion.value);
          setPreviews([]);
          setError("");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !photos.length || !capacity}
          title={
            !capacity ? "Limite de 8 fotos por produto atingido" : undefined
          }
        >
          <Sparkles data-icon="inline-start" />{" "}
          {triggerLabel || "Foto profissional com Agent Dute"}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (busy || saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy || saving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Fotos com Agent Dute</DialogTitle>
          <DialogDescription>
            {productName || "Produto"} · Fundo branco e iluminação de estúdio
          </DialogDescription>
        </DialogHeader>
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm">
            Dados do produto
            {[context.gender, context.size, context.color].filter(Boolean)
              .length
              ? ` · ${[context.gender, context.size, context.color].filter(Boolean).join(" · ")}`
              : ""}
          </summary>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {Object.entries({
              Descrição: context.description || productName,
              Categoria: category,
              Gênero: context.gender,
              Grupo: context.group,
              Tamanho: context.size,
              Cor: context.color,
              Marca: context.brand,
            })
              .filter(([, value]) => Boolean(value))
              .map(([label, value]) => (
                <div
                  key={label}
                  className={label === "Descrição" ? "col-span-2" : undefined}
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </details>
        <fieldset
          disabled={busy || saving}
          className="flex min-w-0 flex-col gap-3"
        >
          <legend className="mb-2 text-sm font-medium">Apresentação</legend>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => {
              if (value) {
                setMode(value as typeof mode);
                setPreviews([]);
              }
            }}
            variant="outline"
            className="flex flex-wrap justify-start"
            aria-label="Apresentação do produto"
          >
            <ToggleGroupItem value="catalog">Foto de catálogo</ToggleGroupItem>
            <ToggleGroupItem value="mannequin">
              Manequim de vitrine
            </ToggleGroupItem>
            <ToggleGroupItem value="garment">
              Roupa sem manequim
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-sm text-muted-foreground">
            {mode === "catalog"
              ? "Melhora fundo e iluminação mantendo a apresentação original. Para peças dobradas, esta é a opção mais fiel."
              : mode === "garment"
                ? "Apresenta somente a roupa, com suporte invisível e fundo branco."
                : "Usa somente o suporte necessário para a roupa. Camisetas e tricôs usam busto sem cabeça, mãos ou pernas."}
          </p>
          {mode === "mannequin" ? (
            <>
              <label
                htmlFor={`${id}-mannequin`}
                className="text-sm font-medium"
              >
                Manequim
              </label>
              <select
                id={`${id}-mannequin`}
                value={mannequin ?? ""}
                onChange={(event) => {
                  setMannequin((event.target.value as Mannequin) || undefined);
                  setPreviews([]);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione o manequim</option>
                {Object.entries(mannequinLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {suggestion.conflict ? (
                <p role="status" className="text-sm text-muted-foreground">
                  O gênero e a descrição divergem. Confirme o manequim para esta
                  geração.
                </p>
              ) : !suggestion.value ? (
                <p className="text-sm text-muted-foreground">
                  O cadastro não indica um manequim. Escolha antes de gerar.
                </p>
              ) : null}
            </>
          ) : null}
        </fieldset>
        {!previews.length ? (
          <fieldset
            disabled={busy || saving}
            className="flex min-w-0 flex-col gap-3"
          >
            <legend className="mb-2 text-sm font-medium">
              Escolha as fotos originais · até {capacity}
            </legend>
            <div className="flex flex-wrap gap-3">
              {photos.map((photo, index) => (
                <label
                  key={photo.fileUrl}
                  className="flex cursor-pointer flex-col gap-2"
                >
                  <img
                    src={photo.fileUrl}
                    alt={`Original ${index + 1}`}
                    className="size-24 rounded-md border bg-background object-contain"
                  />
                  <span className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={selected.includes(photo.fileUrl)}
                      disabled={
                        !selected.includes(photo.fileUrl) &&
                        selected.length >= capacity
                      }
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, photo.fileUrl]
                            : current.filter((url) => url !== photo.fileUrl),
                        )
                      }
                    />
                    Foto {index + 1} ·{" "}
                    {isGeneratedPhoto(photo.fileUrl)
                      ? "Gerada com IA"
                      : "Original"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="flex flex-col gap-4">
            {previews.map(({ original, generated }) => (
              <div key={generated.storagePath} className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-3">
                  <figure>
                    <img
                      src={original.fileUrl}
                      alt="Foto original do produto"
                      className="aspect-square w-full rounded-md border bg-background object-contain"
                    />
                    <figcaption className="mt-1 text-sm">Original</figcaption>
                  </figure>
                  <figure>
                    <img
                      src={generated.fileUrl}
                      alt="Proposta gerada pelo Agent Dute"
                      className="aspect-square w-full rounded-md border bg-background object-contain"
                    />
                    <figcaption className="mt-1 text-sm">
                      Gerada com IA
                    </figcaption>
                  </figure>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || saving}
                  onClick={() =>
                    setPreviews((current) =>
                      current.filter(
                        (preview) =>
                          preview.generated.storagePath !==
                          generated.storagePath,
                      ),
                    )
                  }
                >
                  Descartar esta proposta
                </Button>
              </div>
            ))}
            <label
              htmlFor={`${id}-primary`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${id}-primary`}
                checked={primary}
                disabled={busy || saving}
                onCheckedChange={(value) => setPrimary(value === true)}
              />
              Usar a primeira foto gerada como principal
            </label>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Confira cores, estampas, logos e formato antes de aprovar. Os
          originais são preservados.
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription role="alert">{error}</AlertDescription>
          </Alert>
        ) : null}
        <div
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {busy
            ? `Agent Dute está preparando e conferindo as fotos… ${previews.length}/${chosen.length}`
            : saving
              ? "Salvando fotos aprovadas…"
              : ""}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || saving}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          {previews.length ? (
            <Button
              type="button"
              disabled={busy || saving}
              onClick={() => void approve()}
            >
              {saving ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              Aprovar {previews.length > 1 ? "fotos" : "foto"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                busy ||
                saving ||
                !chosen.length ||
                chosen.length > capacity ||
                (mode === "mannequin" && !mannequin)
              }
              onClick={() => void generate()}
            >
              {busy ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              Gerar {chosen.length > 1 ? `${chosen.length} fotos` : "foto"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
