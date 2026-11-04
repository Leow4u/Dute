export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: RichMark[]; content?: RichNode[] };
export type BlogDraft = { title: string; slug: string; excerpt: string; category: string; service: string; cover: { src: string; alt: string }; body: RichNode };
export type BlogActor = { uid: string; email: string; name: string; role: "owner" | "admin" };
export type BlogRecord = { id: string; revision: number; draft: BlogDraft; createdAt: string; updatedAt: string; updatedBy: BlogActor; publishedAt: string | null; publishedSlug: string | null; publishedRevision?: number | null };
export type PublishedBlogPost = { id: string; content: BlogDraft; publishedAt: string; updatedAt: string };
export type BlogMedia = { id: string; src: string; alt: string; name: string; width: number; height: number; createdAt: string };
export const BLOG_CATEGORIES = ["Logística Corporativa", "Transporte de Cargas", "Armazenagem"];
export const BLOG_SERVICES = [
  { slug: "mudanca-corporativa", title: "Mudança Corporativa" },
  { slug: "inventario", title: "Inventário" },
  { slug: "mudancas-industriais", title: "Mudanças Industriais" },
  { slug: "transporte-de-tecnologias", title: "Transporte de Tecnologias" },
  { slug: "montagem-e-desmontagem", title: "Montagem e Desmontagem" },
  { slug: "remanejamento-interno", title: "Remanejamento Interno" },
  { slug: "gestao-de-mobiliario", title: "Gestão de Mobiliário" },
  { slug: "transporte-dedicado", title: "Transporte Dedicado" },
  { slug: "transporte-fracionado", title: "Transporte Fracionado" },
  { slug: "armazenagem", title: "Armazenagem" },
];
export class BlogValidationError extends Error {
  constructor(message: string) { super(message); this.name = "BlogValidationError"; }
}
export function emptyDraft(): BlogDraft {
  return { title: "", slug: "", excerpt: "", category: BLOG_CATEGORIES[0], service: "mudanca-corporativa", cover: { src: "", alt: "" }, body: { type: "doc", content: [{ type: "paragraph" }] } };
}
const mediaPattern = /^\/api\/blog\/media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
export function safeLink(value: unknown): boolean {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (value.startsWith("#")) return /^#[\w-]+$/.test(value);
  try { const url = new URL(value); return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function safeImageSrc(value: unknown): boolean {
  return typeof value === "string" && (mediaPattern.test(value) || /^\/images\/(corporate|detail|transport|storage)\.webp$/.test(value));
}
const invalid = (message: string): never => { throw new BlogValidationError(message); };
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`${label} inválido.`);
  return value as Record<string, unknown>;
}
function field(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length > max) return invalid(`${label}: informe um texto com até ${max} caracteres.`);
  return value;
}
const children: Record<string, string[]> = {
  doc: ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "image", "horizontalRule"],
  paragraph: ["text", "hardBreak"], heading: ["text", "hardBreak"],
  bulletList: ["listItem"], orderedList: ["listItem"],
  listItem: ["paragraph", "bulletList", "orderedList", "blockquote"],
  blockquote: ["paragraph", "heading", "bulletList", "orderedList"],
  image: [], horizontalRule: [], text: [], hardBreak: [],
};
function parseBody(value: unknown): RichNode {
  let count = 0, textLength = 0;
  const visit = (input: unknown, depth: number, parent?: string): RichNode => {
    if (++count > 5000 || depth > 12) return invalid("O artigo excede o limite de blocos ou de níveis de listas.");
    const node = object(input, "Bloco de texto");
    const type = field(node.type, "Tipo de bloco", 30);
    if (!Object.hasOwn(children, type) || (parent ? !children[parent].includes(type) : type !== "doc")) return invalid("O texto contém um bloco não permitido.");
    const result: RichNode = { type };
    if (type === "text") {
      result.text = field(node.text, "Texto", 200000);
      textLength += result.text.length;
      if (textLength > 200000) return invalid("O artigo excede 200 mil caracteres.");
    }
    const attrs = node.attrs === undefined ? {} : object(node.attrs, "Atributos");
    if (type === "heading") {
      if (attrs.level !== 2 && attrs.level !== 3) return invalid("Use títulos de nível 2 ou 3 no artigo.");
      result.attrs = { level: attrs.level };
    }
    if (type === "orderedList") {
      const start = attrs.start ?? 1;
      if (!Number.isInteger(start) || Number(start) < 1 || Number(start) > 9999) return invalid("Numeração da lista inválida.");
      result.attrs = { start };
    }
    if (type === "image") {
      if (!safeImageSrc(attrs.src)) return invalid("Escolha uma imagem da biblioteca do Blog.");
      result.attrs = { src: attrs.src, alt: field(attrs.alt ?? "", "Descrição da imagem", 500) };
    }
    if (node.marks !== undefined) {
      if (type !== "text" || !Array.isArray(node.marks) || node.marks.length > 8) return invalid("Formatação de texto inválida.");
      result.marks = node.marks.map((inputMark) => {
        const mark = object(inputMark, "Formatação");
        const markType = field(mark.type, "Formatação", 30);
        if (["bold", "italic", "strike", "underline", "code"].includes(markType)) return { type: markType };
        if (markType !== "link") return invalid("Formatação não permitida.");
        const link = object(mark.attrs, "Link");
        if (!safeLink(link.href)) return invalid("Use um link http, https, e-mail, telefone ou caminho do site.");
        return { type: "link", attrs: { href: link.href, target: "_blank", rel: "noopener noreferrer" } };
      });
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || (!children[type].length && node.content.length)) return invalid("Conteúdo do bloco inválido.");
      result.content = node.content.map((child) => visit(child, depth + 1, type));
    }
    return result;
  };
  return visit(value, 0);
}
export function parseDraft(value: unknown): BlogDraft {
  const draft = object(value, "Artigo");
  const title = field(draft.title, "Título", 200).trim();
  const slug = field(draft.slug, "Endereço", 100).trim();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return invalid("O endereço deve usar letras minúsculas, números e hífens.");
  const excerpt = field(draft.excerpt, "Resumo", 500).trim();
  const category = field(draft.category, "Categoria", 60);
  const service = field(draft.service, "Solução", 80);
  if (!BLOG_CATEGORIES.includes(category)) return invalid("Escolha uma categoria do Blog.");
  if (!BLOG_SERVICES.some((item) => item.slug === service)) return invalid("Escolha uma solução da Dutelog.");
  const cover = object(draft.cover, "Capa");
  const src = field(cover.src, "Imagem de capa", 150);
  if (src && !safeImageSrc(src)) return invalid("Escolha uma capa da biblioteca do Blog.");
  return { title, slug, excerpt, category, service, cover: { src, alt: field(cover.alt, "Descrição da capa", 500) }, body: parseBody(draft.body) };
}
export function validatePublication(value: unknown): BlogDraft {
  const draft = parseDraft(value);
  if (!draft.title) return invalid("Preencha o título antes de publicar.");
  if (!draft.slug) return invalid("Defina o endereço do artigo antes de publicar.");
  if (!draft.excerpt) return invalid("Escreva um resumo antes de publicar.");
  if (!draft.cover.src || !draft.cover.alt.trim()) return invalid("Escolha a capa e descreva a imagem antes de publicar.");
  let hasText = false;
  const visit = (node: RichNode) => {
    if (node.text?.trim()) hasText = true;
    if (node.type === "image" && !(typeof node.attrs?.alt === "string" && node.attrs.alt.trim())) invalid("Descreva todas as imagens do artigo antes de publicar.");
    node.content?.forEach(visit);
  };
  visit(draft.body);
  if (!hasText) return invalid("Escreva o conteúdo do artigo antes de publicar.");
  return draft;
}
export function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/, "");
}
export function mediaIds(draft: BlogDraft): string[] {
  const found = new Set<string>();
  const add = (src: unknown) => { if (typeof src === "string") { const id = src.match(mediaPattern)?.[1]; if (id) found.add(id); } };
  add(draft.cover.src);
  const visit = (node: RichNode) => { if (node.type === "image") add(node.attrs?.src); node.content?.forEach(visit); };
  visit(draft.body);
  return [...found];
}
export function readTime(body: RichNode): string {
  const texts: string[] = [];
  const visit = (node: RichNode) => { if (node.text) texts.push(node.text); node.content?.forEach(visit); };
  visit(body);
  const words = texts.join(" ").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 200))} min`;
}
type LegacyArticle = { title: string; slug: string; excerpt: string; category: string; service: string; image: string; sections: { title: string; paragraphs: string[]; bullets: string[] }[] };
export function legacyToDraft(article: LegacyArticle): BlogDraft {
  const paragraph = (text: string): RichNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
  return parseDraft({
    title: article.title, slug: article.slug, excerpt: article.excerpt, category: article.category, service: article.service,
    cover: { src: `/images/${article.image}.webp`, alt: `Cena ilustrativa de ${article.category.toLocaleLowerCase("pt-BR")}` },
    body: { type: "doc", content: article.sections.flatMap((section): RichNode[] => [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.title }] },
      ...section.paragraphs.map(paragraph),
      ...(section.bullets.length ? [{ type: "bulletList", content: section.bullets.map((text): RichNode => ({ type: "listItem", content: [paragraph(text)] })) }] : []),
    ]) },
  });
}
