import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeBlogImage } from "../server/media.ts";

test("uploads are decoded, converted to WebP and stripped of metadata", async () => {
  const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } }).png().withMetadata({ orientation: 3 }).toBuffer();
  const image = await normalizeBlogImage(input, "image/png");
  const metadata = await sharp(image.bytes).metadata();
  assert.equal(image.width, 40);
  assert.equal(image.height, 20);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
});

test("arbitrary data, SVG, MIME mismatch and oversized uploads are refused", async () => {
  await assert.rejects(normalizeBlogImage(Buffer.from("<svg onload='alert(1)'/>"), "image/svg+xml"));
  await assert.rejects(normalizeBlogImage(Buffer.from("not an image"), "image/jpeg"));
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(normalizeBlogImage(png, "image/jpeg"));
  await assert.rejects(normalizeBlogImage(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png"));
});
