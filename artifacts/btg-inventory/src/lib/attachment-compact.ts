/**
 * Redução de anexo antes de subir (nota fiscal ou pedido, em PDF ou foto).
 *
 * O caso real: o cliente escaneia a nota pelo celular e o PDF sai com uma
 * foto colorida em resolução cheia por página, 4 a 5 MB cada. Uma nota de
 * duas páginas passa de 9 MB e era recusada pelo limite de 8 MB. Em vez de
 * pedir para o cliente reescanear, o portal re-renderiza cada página em JPEG
 * com no máximo `PAGE_MAX_PIXELS` no lado maior e monta um PDF novo só com
 * as imagens. A mesma nota fica em torno de 1 MB, legível para a conferência
 * e para o Agent Dute.
 *
 * PDF com texto de verdade (DANFE gerado pelo ERP) não é rasterizado: ele já
 * é pequeno e o texto ajuda a leitura. Só vira imagem se passar do teto, que
 * é melhor do que recusar.
 *
 * A parte pura (decisão, escala e montagem do PDF) fica aqui para ser
 * testada em Node. A parte que depende de canvas e do pdf.js é injetável e
 * só é importada no navegador.
 */

/** Teto do anexo depois de reduzido. Igual ao do backend. */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Acima disto o arquivo passa pela redução antes de subir. */
export const COMPACT_ABOVE_BYTES = 2 * 1024 * 1024;
/** Acima disto nem tentamos abrir no navegador. */
export const SOURCE_MAX_BYTES = 80 * 1024 * 1024;
/** Lado maior da página ou foto depois de reduzida. Em A4 dá ~200 dpi. */
export const PAGE_MAX_PIXELS = 2000;
export const JPEG_QUALITY = 0.82;
/** Pontos por pixel no PDF montado: 200 dpi. */
const POINTS_PER_PIXEL = 72 / 200;

export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export type Decision = "reject_type" | "reject_size" | "keep" | "compact";

/**
 * O que fazer com o arquivo escolhido. `hasText` só importa para PDF e diz
 * se a primeira página tem texto extraível.
 */
export function attachmentDecision(file: { type: string; size: number }, hasText = false): Decision {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "reject_type";
  if (file.size <= 0 || file.size > SOURCE_MAX_BYTES) return "reject_size";
  if (file.size <= COMPACT_ABOVE_BYTES) return "keep";
  if (file.type === "application/pdf" && hasText && file.size <= ATTACHMENT_MAX_BYTES) return "keep";
  return "compact";
}

/** Fator para caber em `max` no lado maior, nunca ampliando. */
export function fitWithin(width: number, height: number, max = PAGE_MAX_PIXELS) {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return 1;
  return Math.min(1, max / longest);
}

export interface JpegPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/**
 * PDF mínimo com uma imagem JPEG por página (filtro DCTDecode, sem
 * recomprimir). Objetos: catálogo, árvore de páginas e, por página, a
 * página, o conteúdo e a imagem. O xref é calculado a partir dos offsets
 * reais para o arquivo abrir em qualquer leitor.
 */
export function buildImagePdf(pages: JpegPage[]): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error("PDF sem páginas.");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  function push(part: string | Uint8Array) {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    position += bytes.length;
  }
  function object(id: number, body: string | Uint8Array[]) {
    offsets[id] = position;
    push(`${id} 0 obj\n`);
    if (typeof body === "string") push(body);
    else for (const part of body) push(part);
    push("\nendobj\n");
  }

  const pageIds = pages.map((_, index) => 3 + index * 3);
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const width = (page.width * POINTS_PER_PIXEL).toFixed(2);
    const height = (page.height * POINTS_PER_PIXEL).toFixed(2);
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    object(contentId, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
    object(imageId, [
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
      page.jpeg,
      encoder.encode("\nendstream"),
    ]);
  });

  const size = 3 + pages.length * 3;
  const xref = position;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(position);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export interface CompactDeps {
  /** Foto -> JPEG reduzido. */
  compactImage: (file: File) => Promise<File>;
  /** Abre o PDF e diz se a primeira página tem texto extraível. */
  pdfHasText: (file: File) => Promise<boolean>;
  /** PDF -> PDF só de imagens JPEG reduzidas. */
  compactPdf: (file: File) => Promise<File>;
}

export class AttachmentRejected extends Error {
  constructor(
    readonly reason: Exclude<Decision, "keep" | "compact">,
    message: string,
  ) {
    super(message);
  }
}

export const REJECT_MESSAGES: Record<Exclude<Decision, "keep" | "compact">, string> = {
  reject_type: "Use PDF ou imagem (JPEG, PNG ou WebP).",
  reject_size: "Arquivo grande demais. Use até 15 MB.",
};

/**
 * Devolve o arquivo pronto para subir: o original quando já está pequeno, a
 * versão reduzida quando compensa. Se a redução falhar (PDF protegido,
 * imagem que o navegador não abre), o original segue desde que caiba.
 */
export async function prepareAttachment(file: File, deps: CompactDeps = browserDeps()): Promise<File> {
  const fits = (candidate: File) => candidate.size > 0 && candidate.size <= ATTACHMENT_MAX_BYTES;
  const isPdf = file.type === "application/pdf";
  let decision = attachmentDecision(file);
  if (decision === "compact" && isPdf) {
    const hasText = await deps.pdfHasText(file).catch(() => false);
    decision = attachmentDecision(file, hasText);
  }
  if (decision === "reject_type" || decision === "reject_size") {
    throw new AttachmentRejected(decision, REJECT_MESSAGES[decision]);
  }
  if (decision === "keep") return file;

  let compacted: File | null = null;
  try {
    compacted = await (isPdf ? deps.compactPdf(file) : deps.compactImage(file));
  } catch (error) {
    console.warn("prepareAttachment: redução falhou, seguindo com o original", { name: file.name, error });
  }
  if (compacted && fits(compacted) && (compacted.size < file.size || !fits(file))) return compacted;
  if (fits(file)) return file;
  throw new AttachmentRejected("reject_size", "Arquivo grande demais mesmo depois de reduzir. Use até 15 MB.");
}

// ------------------------------------------------------------- navegador

function browserDeps(): CompactDeps {
  return { compactImage, pdfHasText, compactPdf };
}

function jpegName(name: string) {
  return name.replace(/\.(jpe?g|png|webp|pdf)$/i, "") + ".jpg";
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Não consegui gerar a imagem reduzida."));
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível neste navegador.");
  // Fundo branco: PNG/WebP com transparência viraria preto no JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function compactImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = fitWithin(bitmap.width, bitmap.height);
    const { canvas, context } = makeCanvas(bitmap.width * scale, bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvasToJpeg(canvas);
    return new File([jpeg], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

async function loadPdfjs() {
  // Carregado só quando um PDF grande aparece: ~500 KB que o portal não
  // precisa no shell. O build legacy cobre Safari mais antigo no celular.
  // O worker entra como chunk .js do Vite (não como .mjs via ?url) para o
  // nginx servi-lo com MIME de script; com nosniff, .mjs errado é bloqueado.
  const [pdfjs, { default: PdfWorker }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker"),
  ]);
  if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  return pdfjs;
}

async function openPdf(file: File) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  // Sem wasm: não servimos os decodificadores JPX/ICC do pdf.js e um scan de
  // celular é JPEG puro, que o navegador decodifica sozinho.
  const task = pdfjs.getDocument({ data, useWasm: false, useSystemFonts: true });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

async function pdfHasText(file: File): Promise<boolean> {
  const { doc, close } = await openPdf(file);
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const chars = content.items.map((item) => ("str" in item ? item.str : "")).join("").trim().length;
    return chars >= 40;
  } finally {
    await close();
  }
}

async function compactPdf(file: File): Promise<File> {
  const { doc, close } = await openPdf(file);
  try {
    const pages: JpegPage[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: fitWithin(base.width, base.height) });
      const { canvas, context } = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({ jpeg: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    const bytes = buildImagePdf(pages);
    return new File([bytes], file.name, { type: "application/pdf", lastModified: file.lastModified });
  } finally {
    await close();
  }
}
