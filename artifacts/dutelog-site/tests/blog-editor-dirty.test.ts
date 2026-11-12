import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { draftFingerprint, editorBody, emptyDraft, parseDraft, type RichNode } from "../src/blog/model.ts";
import { blogEditorExtensions } from "../src/admin/editor-extensions.ts";

const require = createRequire(new URL("../node_modules/@tiptap/starter-kit/package.json", import.meta.url));
const { Editor } = require("@tiptap/core") as {
  Editor: new (options: Record<string, unknown>) => {
    getJSON: () => RichNode;
    setEditable: (editable: boolean) => void;
    destroy: () => void;
    state: { tr: { insertText: (text: string, position: number) => unknown } };
    view: { dispatch: (transaction: unknown) => void };
  };
};

const media = "351232ff-8af3-4800-bd30-af416927e86b";

function open(content: RichNode) {
  let echoed: RichNode = content;
  const editor = new Editor({
    extensions: blogEditorExtensions(),
    content,
    element: null,
    injectCSS: false,
    onUpdate: ({ editor: current }: { editor: { getJSON: () => RichNode } }) => {
      echoed = editorBody(current.getJSON());
    },
  });
  return { editor, read: () => echoed };
}

test("TipTap echo of bold, link, image and ordered list stays clean until the text changes", () => {
  const stored = parseDraft({
    ...emptyDraft(),
    title: "Planejamento",
    slug: "planejamento",
    excerpt: "Resumo do artigo",
    cover: { src: `/api/blog/media/${media}`, alt: "Capa" },
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Negrito", marks: [{ type: "bold" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Itálico", marks: [{ type: "italic" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Site", marks: [{ type: "link", attrs: { href: "https://www.dutelog.com.br/", target: "_blank", rel: "noopener noreferrer" } }] }] },
        { type: "image", attrs: { src: `/api/blog/media/${media}`, alt: "Sala" } },
        { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primeiro" }] }] }] },
      ],
    },
  });
  const saved = draftFingerprint(stored);
  const { editor, read } = open(stored.body);
  try {
    editor.setEditable(false);
    editor.setEditable(true);
    const raw = editor.getJSON();
    assert.notEqual(JSON.stringify(raw), JSON.stringify(stored.body));
    assert.deepEqual(read(), stored.body);
    assert.equal(draftFingerprint({ ...stored, body: read() }), saved);
    editor.view.dispatch(editor.state.tr.insertText("!", 1));
    assert.notEqual(draftFingerprint({ ...stored, body: read() }), saved);
    assert.notEqual(draftFingerprint({ ...stored, body: editorBody(editor.getJSON()) }), saved);
  } finally {
    editor.destroy();
  }
});

test("a paragraph and heading stay identical after TipTap reloads them", () => {
  const stored = parseDraft({
    ...emptyDraft(),
    title: "Simples",
    slug: "simples",
    excerpt: "Resumo",
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção" }] },
        { type: "paragraph", content: [{ type: "text", text: "Só texto." }] },
      ],
    },
  });
  const { editor, read } = open(stored.body);
  try {
    editor.setEditable(true);
    assert.equal(JSON.stringify(editor.getJSON()), JSON.stringify(stored.body));
    assert.equal(draftFingerprint({ ...stored, body: read() }), draftFingerprint(stored));
    editor.view.dispatch(editor.state.tr.insertText("!", 1));
    assert.notEqual(draftFingerprint({ ...stored, body: read() }), draftFingerprint(stored));
  } finally {
    editor.destroy();
  }
});
