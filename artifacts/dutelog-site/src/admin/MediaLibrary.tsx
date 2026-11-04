import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, Search, Check, LoaderCircle } from "lucide-react";
import type { BlogMedia } from "../blog/model";
import { blogApi, errorMessage } from "./api";
import Dialog from "./Dialog";

export function MediaLibrary({
  onSelect,
}: {
  onSelect?: (image: BlogMedia) => void;
}) {
  const [items, setItems] = useState<BlogMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<BlogMedia | null>(null);
  const [selectedAlt, setSelectedAlt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    blogApi
      .media()
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function chooseFile(next: File | undefined) {
    setError("");
    setMessage("");
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setError("Escolha uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setError("A imagem deve ter no máximo 10 MB.");
      return;
    }
    setFile(next);
    setAlt("");
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || uploading || !alt.trim()) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const { item } = await blogApi.upload(file, alt.trim());
      setItems((current) => [item, ...current]);
      setFile(null);
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
      setMessage("Imagem adicionada à biblioteca.");
      if (onSelect) {
        setSelected(item);
        setSelectedAlt(item.alt);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  }
  const shown = items.filter((item) =>
    `${item.name} ${item.alt}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className="editorial-media">
      <div className="editorial-media-actions">
        <label className="editorial-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Buscar imagens"
            placeholder="Buscar na biblioteca"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label
          className={`editorial-button editorial-primary editorial-upload-label${uploading ? " is-disabled" : ""}`}
        >
          <Upload size={17} /> Enviar imagem
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>
      </div>
      <p className="editorial-hint">
        JPG, PNG ou WebP · até 10 MB. Adicione uma descrição para tornar a
        imagem acessível.
      </p>
      {error && (
        <div className="editorial-alert editorial-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="editorial-alert editorial-success" role="status">
          <Check size={16} /> {message}
        </div>
      )}
      {file && (
        <form onSubmit={upload} className="editorial-upload-preview">
          <img src={preview} alt="Imagem selecionada para envio" />
          <div>
            <strong>{file.name}</strong>
            <label className="editorial-field">
              Descrição da imagem
              <input
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                maxLength={300}
                required
                disabled={uploading}
                placeholder="Ex.: Equipe organizando caixas em um escritório"
              />
            </label>
            <div className="editorial-inline-actions">
              <button
                type="submit"
                className="editorial-button editorial-primary"
                disabled={uploading || !alt.trim()}
              >
                {uploading ? (
                  <LoaderCircle className="editorial-spin" size={16} />
                ) : (
                  <Upload size={16} />
                )}
                {uploading ? "Enviando…" : "Adicionar à biblioteca"}
              </button>
              <button
                type="button"
                className="editorial-button"
                disabled={uploading}
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>
      )}
      {loading ? (
        <div className="editorial-empty" role="status">
          <LoaderCircle className="editorial-spin" />
          <p>Carregando imagens…</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="editorial-empty">
          <ImagePlus size={30} />
          <h3>
            {query ? "Nenhuma imagem encontrada" : "Sua biblioteca começa aqui"}
          </h3>
          <p>
            {query
              ? "Tente outro nome ou descrição."
              : "Envie imagens para usar nas capas e no conteúdo dos artigos."}
          </p>
        </div>
      ) : (
        <div className="editorial-media-grid">
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`editorial-media-card${selected?.id === item.id ? " is-selected" : ""}`}
              onClick={() => {
                setSelected(item);
                setSelectedAlt(item.alt);
              }}
              aria-pressed={selected?.id === item.id}
            >
              <img src={item.src} alt={item.alt} loading="lazy" />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.width} × {item.height}
                </small>
              </span>
              {selected?.id === item.id && (
                <span className="editorial-image-check">
                  <Check size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="editorial-media-selection">
          <img src={selected.src} alt={selected.alt} />
          <div>
            <strong>{selected.name}</strong>
            {onSelect ? (
              <label className="editorial-field">
                Descrição neste artigo
                <input
                  value={selectedAlt}
                  onChange={(event) => setSelectedAlt(event.target.value)}
                  maxLength={300}
                />
              </label>
            ) : (
              <p>{selected.alt}</p>
            )}
          </div>
          {onSelect && (
            <button
              className="editorial-button editorial-primary"
              type="button"
              disabled={!selectedAlt.trim()}
              onClick={() => onSelect({ ...selected, alt: selectedAlt.trim() })}
            >
              <Check size={16} /> Usar imagem
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MediaPicker({
  onSelect,
  onClose,
}: {
  onSelect: (image: BlogMedia) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="Escolher imagem" onClose={onClose} wide>
      <MediaLibrary onSelect={onSelect} />
    </Dialog>
  );
}
