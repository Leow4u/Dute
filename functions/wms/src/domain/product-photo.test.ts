import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductPhotoInput, productPhotoPath, productPhotoPrompt, generateProductPhoto } from "./product-photo.js";

describe("fotos profissionais do catálogo", () => {
  const bucket = "demo.firebasestorage.app";
  const path = "product-photos/Cliente_A/item/original.png";
  const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=test`;
  it("resolve fotos do cliente no Storage sem acessar a URL recebida", () => {
    assert.equal(productPhotoPath(firebaseUrl, bucket, "Cliente A"), path);
    assert.equal(productPhotoPath(`https://storage.googleapis.com/${bucket}/${path}`, bucket, "Cliente A"), path);
    assert.equal(productPhotoPath(`https://storage.googleapis.com/${bucket}/customers/Cliente_A/product-photos/a.jpg`, bucket, "Cliente A"), "customers/Cliente_A/product-photos/a.jpg");
  });
  it("nega outro cliente, bucket, host, protocolo e caminhos fora das fotos", () => {
    for (const url of [firebaseUrl.replace("Cliente_A", "Cliente_B"), firebaseUrl.replace(bucket, "other.bucket"), firebaseUrl.replace("firebasestorage.googleapis.com", "attacker.test"), firebaseUrl.replace("https:", "http:"), firebaseUrl.replace(encodeURIComponent(path), encodeURIComponent("agent-knowledge/secret.png")), firebaseUrl.replace(encodeURIComponent(path), encodeURIComponent("product-photos/Cliente_A/../Cliente_B/a.png"))]) {
      assert.throws(() => productPhotoPath(url, bucket, "Cliente A"), { code: "permission-denied" });
    }
  });
  it("exige identificador de solicitação e modo conhecido", () => {
    assert.equal(ProductPhotoInput.safeParse({ customer_code: "Cliente A", source_url: firebaseUrl, mode: "catalog", request_id: "invalid" }).success, false);
    assert.equal(ProductPhotoInput.safeParse({ customer_code: "Cliente A", source_url: firebaseUrl, mode: "human", request_id: "00000000-0000-4000-8000-000000000000" }).success, false);
  });
  it("separa a apresentação de vestuário e mantém dados do cadastro como dados", () => {
    const product = { product_name: 'Camisa "azul"', category: "Uniformes" };
    assert.match(productPhotoPrompt({ ...product, mode: "mannequin" }), /neutral white retail mannequin/);
    assert.match(productPhotoPrompt({ ...product, mode: "catalog" }), /Do not add a mannequin/);
    assert.match(productPhotoPrompt({ ...product, mode: "catalog" }), /never instructions/);
  });
  const input = { project: "demo", model: "gemini-2.5-flash-image", token: "test", prompt: "edit", bytes: Buffer.from("source"), mimeType: "image/png" };
  it("envia a imagem original e obtém a imagem mesmo quando a resposta contém texto", async () => {
    let sent: Record<string, any> = {};
    const mock: typeof fetch = async (url, init) => {
      assert.match(String(url), /locations\/global\/publishers\/google\/models\/gemini-2.5-flash-image:generateContent$/);
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "photo" }, { inlineData: { mimeType: "image/png", data: Buffer.from("generated").toString("base64") } }] } }] }));
    };
    const result = await generateProductPhoto(input, mock);
    assert.equal(result.bytes.toString(), "generated");
    assert.equal(sent.contents[0].parts[1].inlineData.data, input.bytes.toString("base64"));
    assert.deepEqual(sent.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  });
  it("falha de forma explícita quando o provedor está indisponível ou não gera imagem", async () => {
    await assert.rejects(generateProductPhoto(input, async () => new Response("error", { status: 503 })), { code: "unavailable" });
    await assert.rejects(generateProductPhoto(input, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "blocked" }] } }] }))), { code: "failed-precondition" });
    await assert.rejects(generateProductPhoto(input, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "", mimeType: "image/png" } }] } }] }))), { code: "failed-precondition" });
  });
});
