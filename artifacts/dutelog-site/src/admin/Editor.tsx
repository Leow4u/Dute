import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Link2,
  Unlink,
  ImagePlus,
  Undo2,
  Redo2,
  Type,
  Heading2,
  Heading3,
} from "lucide-react";
import type { RichNode } from "../blog/model";
import MediaPicker from "./MediaLibrary";
import Dialog from "./Dialog";

export default function VisualEditor({
  content,
  onChange,
  disabled = false,
}: {
  content: RichNode;
  onChange: (value: RichNode) => void;
  disabled?: boolean;
}) {
  const [imagePicker, setImagePicker] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const [imageAltOpen, setImageAltOpen] = useState(false);
  const [imageAlt, setImageAlt] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          HTMLAttributes: { target: null, rel: null, class: null },
        },
      }),
      Image.configure({ allowBase64: false }),
    ],
    content,
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "editorial-prose",
        role: "textbox",
        "aria-label": "Conteúdo do artigo",
        "aria-multiline": "true",
        "data-placeholder": "Escreva sua próxima ideia…",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichNode),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      paragraph: current?.isActive("paragraph"),
      h2: current?.isActive("heading", { level: 2 }),
      h3: current?.isActive("heading", { level: 3 }),
      bold: current?.isActive("bold"),
      italic: current?.isActive("italic"),
      bullet: current?.isActive("bulletList"),
      ordered: current?.isActive("orderedList"),
      quote: current?.isActive("blockquote"),
      link: current?.isActive("link"),
      image: current?.isActive("image"),
      undo: current?.can().undo(),
      redo: current?.can().redo(),
    }),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  // Changing the loaded article is handled by a key on the parent editor.
  // Ordinary keystrokes never replace the document or move the caret.
  if (!editor)
    return (
      <div className="editorial-editor-loading" role="status">
        Preparando editor…
      </div>
    );
  function applyLink(event: React.FormEvent) {
    event.preventDefault();
    const value = href.trim();
    if (
      !value ||
      !(/^(https?:\/\/|mailto:)/i.test(value) || /^\/(?!\/)/.test(value)) ||
      /[\u0000-\u0020\u007f]/.test(value)
    ) {
      setLinkError(
        "Use um endereço completo com https://, um e-mail com mailto: ou um caminho do site começando por /.",
      );
      return;
    }
    editor!
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: value })
      .run();
    setLinkOpen(false);
  }
  const tool = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    selected = false,
    unavailable = false,
  ) => (
    <button
      type="button"
      className={selected ? "is-active" : ""}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled || unavailable}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <div className={`editorial-editor${disabled ? " is-disabled" : ""}`}>
      <div
        className="editorial-toolbar"
        role="toolbar"
        aria-label="Formatação do artigo"
      >
        <span className="editorial-tool-group">
          {tool(
            "Parágrafo",
            <Type size={17} />,
            () => editor.chain().focus().setParagraph().run(),
            active?.paragraph,
          )}
          {tool(
            "Título de seção",
            <Heading2 size={18} />,
            () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            active?.h2,
          )}
          {tool(
            "Subtítulo",
            <Heading3 size={18} />,
            () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
            active?.h3,
          )}
        </span>
        <span className="editorial-tool-group">
          {tool(
            "Negrito",
            <Bold size={17} />,
            () => editor.chain().focus().toggleBold().run(),
            active?.bold,
          )}
          {tool(
            "Itálico",
            <Italic size={17} />,
            () => editor.chain().focus().toggleItalic().run(),
            active?.italic,
          )}
          {tool(
            "Lista com marcadores",
            <List size={18} />,
            () => editor.chain().focus().toggleBulletList().run(),
            active?.bullet,
          )}
          {tool(
            "Lista numerada",
            <ListOrdered size={18} />,
            () => editor.chain().focus().toggleOrderedList().run(),
            active?.ordered,
          )}
          {tool(
            "Citação",
            <Quote size={17} />,
            () => editor.chain().focus().toggleBlockquote().run(),
            active?.quote,
          )}
        </span>
        <span className="editorial-tool-group">
          {tool(
            "Inserir ou editar link",
            <Link2 size={18} />,
            () => {
              setHref(String(editor.getAttributes("link").href || "https://"));
              setLinkError("");
              setLinkOpen(true);
            },
            active?.link,
          )}
          {active?.link &&
            tool("Remover link", <Unlink size={17} />, () =>
              editor.chain().focus().unsetLink().run(),
            )}
          {tool("Inserir imagem", <ImagePlus size={18} />, () =>
            setImagePicker(true),
          )}
          {active?.image && (
            <button
              type="button"
              disabled={disabled}
              className="editorial-tool-text"
              onClick={() => {
                setImageAlt(String(editor.getAttributes("image").alt || ""));
                setImageAltOpen(true);
              }}
            >
              Descrição da imagem
            </button>
          )}
        </span>
        <span className="editorial-tool-group">
          {tool(
            "Desfazer",
            <Undo2 size={17} />,
            () => editor.chain().focus().undo().run(),
            false,
            !active?.undo,
          )}
          {tool(
            "Refazer",
            <Redo2 size={17} />,
            () => editor.chain().focus().redo().run(),
            false,
            !active?.redo,
          )}
        </span>
      </div>
      <EditorContent editor={editor} />
      <div className="editorial-editor-foot">
        Selecione o texto para formatar. Use títulos de seção para organizar a
        leitura.
      </div>
      {imagePicker && (
        <MediaPicker
          onClose={() => setImagePicker(false)}
          onSelect={(image) => {
            editor
              .chain()
              .focus()
              .setImage({ src: image.src, alt: image.alt })
              .run();
            setImagePicker(false);
          }}
        />
      )}
      {linkOpen && (
        <Dialog title="Inserir link" onClose={() => setLinkOpen(false)}>
          <form className="editorial-dialog-form" onSubmit={applyLink}>
            <label className="editorial-field">
              Endereço do link
              <input
                autoFocus
                value={href}
                onChange={(event) => setHref(event.target.value)}
                placeholder="https://"
                required
              />
            </label>
            {linkError && (
              <p className="editorial-alert editorial-error" role="alert">
                {linkError}
              </p>
            )}
            <div className="editorial-inline-actions">
              <button
                className="editorial-button editorial-primary"
                type="submit"
              >
                Aplicar link
              </button>
              <button
                className="editorial-button"
                type="button"
                onClick={() => setLinkOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {imageAltOpen && (
        <Dialog
          title="Descrição da imagem"
          onClose={() => setImageAltOpen(false)}
        >
          <form
            className="editorial-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (imageAlt.trim()) {
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", { alt: imageAlt.trim() })
                  .run();
                setImageAltOpen(false);
              }
            }}
          >
            <label className="editorial-field">
              Texto alternativo
              <input
                autoFocus
                value={imageAlt}
                maxLength={300}
                onChange={(event) => setImageAlt(event.target.value)}
                required
              />
            </label>
            <p className="editorial-hint">
              Descreva o que aparece na imagem para quem utiliza leitor de tela.
            </p>
            <button
              className="editorial-button editorial-primary"
              type="submit"
            >
              Salvar descrição
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
