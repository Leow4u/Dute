import { useState } from "react";
import { Images, Loader2, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/warehouse-ops/model";
import { ProductPhotoStudio } from "./product-photo-studio";
import { type PhotoContext, isGeneratedPhoto } from "./photo-context";
import { type ProductPhoto } from "./shared";

type Props = {
  photos: ProductPhoto[];
  customerCode: string;
  productName: string;
  category: string;
  context: PhotoContext;
  disabled?: boolean;
  onManage: (change: {
    remove_photo_urls?: string[];
    primary_photo_url?: string;
  }) => Promise<void>;
  onApprove: (photos: ProductPhoto[], primaryUrl?: string) => Promise<void>;
};

export function ProductPhotoManager({
  photos,
  customerCode,
  productName,
  category,
  context,
  disabled,
  onManage,
  onApprove,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected =
    photos.find((photo) => photo.fileUrl === selectedUrl) ?? photos[0];
  const primary = selected?.fileUrl === photos[0]?.fileUrl;

  async function manage(change: Parameters<Props["onManage"]>[0]) {
    setBusy(true);
    setError("");
    try {
      await onManage(change);
      setRemoving(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? getErrorMessage(err)
          : "Não foi possível atualizar as fotos.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !photos.length}
        >
          <Images data-icon="inline-start" />
          Gerenciar fotos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fotos do produto</DialogTitle>
          <DialogDescription>{productName}</DialogDescription>
        </DialogHeader>
        {selected ? (
          <>
            <figure className="flex min-w-0 flex-col gap-2">
              <img
                src={selected.fileUrl}
                alt={`Foto ampliada de ${productName}`}
                className="max-h-96 w-full rounded-md border bg-background object-contain"
              />
              <figcaption className="text-sm">
                {isGeneratedPhoto(selected.fileUrl)
                  ? "Gerada com IA"
                  : "Original"}
                {primary ? " · Foto principal" : ""}
              </figcaption>
            </figure>
            <div className="flex flex-wrap gap-2" aria-label="Fotos do produto">
              {photos.map((photo, index) => (
                <Button
                  key={photo.fileUrl}
                  type="button"
                  variant={
                    selected.fileUrl === photo.fileUrl ? "default" : "outline"
                  }
                  className="size-16 p-1"
                  disabled={busy}
                  aria-label={`Ampliar foto ${index + 1}${index === 0 ? ", principal" : ""}`}
                  aria-pressed={selected.fileUrl === photo.fileUrl}
                  onClick={() => setSelectedUrl(photo.fileUrl)}
                >
                  <img
                    src={photo.fileUrl}
                    alt=""
                    className="size-full rounded-sm object-contain"
                  />
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || primary}
                onClick={() =>
                  void manage({ primary_photo_url: selected.fileUrl })
                }
              >
                <Star data-icon="inline-start" />
                {primary ? "Foto principal" : "Definir como principal"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                <Trash2 data-icon="inline-start" />
                Remover do produto
              </Button>
              <ProductPhotoStudio
                photos={photos}
                customerCode={customerCode}
                productName={productName}
                category={category}
                context={context}
                sourceUrl={selected.fileUrl}
                triggerLabel="Gerar novamente"
                disabled={busy}
                onApprove={onApprove}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma foto vinculada. Anexe uma foto na ficha do produto.
          </p>
        )}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Atualizando fotos…
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription role="alert">{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialog
          open={removing}
          onOpenChange={(next) => {
            if (!busy) setRemoving(next);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover esta foto do produto?</AlertDialogTitle>
              <AlertDialogDescription>
                A foto deixará de aparecer no catálogo e no portal. O arquivo
                será preservado no histórico.{" "}
                {primary && photos.length > 1
                  ? "A próxima foto será a principal."
                  : photos.length === 1
                    ? "O produto ficará sem foto."
                    : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || !selected}
                onClick={(event) => {
                  event.preventDefault();
                  if (selected)
                    void manage({ remove_photo_urls: [selected.fileUrl] });
                }}
              >
                Remover foto
              </AlertDialogAction>
            </AlertDialogFooter>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
