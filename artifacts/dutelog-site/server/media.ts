import sharp from "sharp";
import { BlogError } from "./types.ts";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export async function normalizeBlogImage(input: Buffer, contentType: string) {
  const expectedFormat = formats[contentType];
  if (!expectedFormat || !Buffer.isBuffer(input) || input.length === 0 || input.length > MAX_IMAGE_BYTES) {
    throw new BlogError(422, "invalid-image", "Envie uma imagem JPEG, PNG ou WebP de até 10 MiB.");
  }
  try {
    const decoder = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning", animated: false });
    const metadata = await decoder.metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || metadata.width > 12_000 || metadata.height > 12_000) {
      throw new Error("Unsupported image");
    }
    const { data, info } = await decoder.rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    throw new BlogError(422, "invalid-image", "Não foi possível ler a imagem. Use JPEG, PNG ou WebP estático, com dimensões de até 12.000 px e 40 megapixels.");
  }
}
