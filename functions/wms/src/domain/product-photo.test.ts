import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProductPhotoInput,
  productPhotoPath,
  productPhotoPrompt,
  generateProductPhoto,
  originalProductPhoto,
} from "./product-photo.js";

describe("fotos profissionais do catálogo", () => {
  const bucket = "demo.firebasestorage.app";
  const path = "product-photos/Cliente_A/item/original.png";
  const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=test`;
  it("resolve fotos do cliente no Storage sem acessar a URL recebida", () => {
    assert.equal(productPhotoPath(firebaseUrl, bucket, "Cliente A"), path);
    assert.equal(
      productPhotoPath(
        `https://storage.googleapis.com/${bucket}/${path}`,
        bucket,
        "Cliente A",
      ),
      path,
    );
    assert.equal(
      productPhotoPath(
        `https://storage.googleapis.com/${bucket}/customers/Cliente_A/product-photos/a.jpg`,
        bucket,
        "Cliente A",
      ),
      "customers/Cliente_A/product-photos/a.jpg",
    );
  });
  it("nega outro cliente, bucket, host, protocolo e caminhos fora das fotos", () => {
    for (const url of [
      firebaseUrl.replace("Cliente_A", "Cliente_B"),
      firebaseUrl.replace(bucket, "other.bucket"),
      firebaseUrl.replace("firebasestorage.googleapis.com", "attacker.test"),
      firebaseUrl.replace("https:", "http:"),
      firebaseUrl.replace(
        encodeURIComponent(path),
        encodeURIComponent("agent-knowledge/secret.png"),
      ),
      firebaseUrl.replace(
        encodeURIComponent(path),
        encodeURIComponent("product-photos/Cliente_A/../Cliente_B/a.png"),
      ),
    ]) {
      assert.throws(() => productPhotoPath(url, bucket, "Cliente A"), {
        code: "permission-denied",
      });
    }
  });
  it("exige identificador de solicitação e modo conhecido", () => {
    assert.equal(
      ProductPhotoInput.safeParse({
        customer_code: "Cliente A",
        source_url: firebaseUrl,
        mode: "catalog",
        request_id: "invalid",
      }).success,
      false,
    );
    assert.equal(
      ProductPhotoInput.safeParse({
        customer_code: "Cliente A",
        source_url: firebaseUrl,
        mode: "human",
        request_id: "00000000-0000-4000-8000-000000000000",
      }).success,
      false,
    );
  });
  it("separa a apresentação de vestuário e mantém dados do cadastro como dados", () => {
    const product = { product_name: 'Camisa "azul"', category: "Uniformes" };
    assert.match(
      productPhotoPrompt({ ...product, mode: "mannequin", mannequin: "male" }),
      /adult MALE retail mannequin/,
    );
    assert.match(
      productPhotoPrompt({ ...product, mode: "catalog" }),
      /Do not add a mannequin/,
    );
    assert.match(
      productPhotoPrompt({ ...product, mode: "catalog" }),
      /never instructions/,
    );
  });
  it("usa o público confirmado e todos os atributos para orientar a anatomia e a peça", () => {
    const attributes = {
      product_name: "Camiseta masculina",
      category: "Uniforme",
      gender: "Masculino",
      description: "Camiseta masculina fio egípcio",
      group: "Vestuário",
      color: "Azul",
      size: "GG",
      brand: "Marca X",
    };
    const prompt = productPhotoPrompt({
      ...attributes,
      mode: "mannequin",
      mannequin: "male",
    });
    for (const value of Object.values(attributes))
      assert.ok(prompt.includes(value));
    assert.match(prompt, /never a female mannequin/);
    assert.match(prompt, /Do not infer garment gender/);
    assert.match(
      productPhotoPrompt({
        ...attributes,
        mode: "mannequin",
        mannequin: "female",
      }),
      /adult FEMALE retail mannequin/,
    );
    assert.match(
      productPhotoPrompt({
        ...attributes,
        mode: "mannequin",
        mannequin: "child",
      }),
      /never an adult mannequin/,
    );
    assert.throws(
      () => productPhotoPrompt({ ...attributes, mode: "mannequin" }),
      { code: "invalid-argument" },
    );
    assert.equal(
      ProductPhotoInput.safeParse({
        ...attributes,
        customer_code: "Cliente A",
        source_url: firebaseUrl,
        mode: "mannequin",
        request_id: "00000000-0000-4000-8000-000000000000",
      }).success,
      false,
    );
  });
  it("refaz a partir do original e recusa proveniência de outro cliente", async () => {
    const generatedPath = "product-photos/Cliente_A/generated/first.png";
    const generatedUrl = `https://storage.googleapis.com/${bucket}/${generatedPath}`;
    const visited: string[] = [];
    const result = await originalProductPhoto(
      generatedUrl,
      bucket,
      "Cliente A",
      async (readPath) => {
        visited.push(readPath);
        return readPath === generatedPath
          ? { metadata: { generated_by: "agent-dute", source_path: path } }
          : { metadata: { firebaseStorageDownloadTokens: "original-token" } };
      },
    );
    assert.equal(result.path, path);
    assert.match(result.url, /original-token/);
    assert.ok(visited.includes(path));
    await assert.rejects(
      originalProductPhoto(generatedUrl, bucket, "Cliente A", async () => ({
        metadata: {
          generated_by: "agent-dute",
          source_path: "product-photos/Outro_Cliente/photo.png",
        },
      })),
      { code: "permission-denied" },
    );
    await assert.rejects(
      originalProductPhoto(
        generatedUrl,
        bucket,
        "Cliente A",
        async (readPath) => ({
          metadata:
            readPath === generatedPath
              ? { generated_by: "agent-dute", source_path: path }
              : {},
        }),
      ),
      { code: "failed-precondition" },
    );
  });
  const input = {
    project: "demo",
    model: "gemini-2.5-flash-image",
    token: "test",
    prompt: "edit",
    bytes: Buffer.from("source"),
    mimeType: "image/png",
  };
  it("envia a imagem original e obtém a imagem mesmo quando a resposta contém texto", async () => {
    let sent: Record<string, any> = {};
    const mock: typeof fetch = async (url, init) => {
      assert.match(
        String(url),
        /locations\/global\/publishers\/google\/models\/gemini-2.5-flash-image:generateContent$/,
      );
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "photo" },
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("generated").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    };
    const result = await generateProductPhoto(input, mock);
    assert.equal(result.bytes.toString(), "generated");
    assert.equal(
      sent.contents[0].parts[1].inlineData.data,
      input.bytes.toString("base64"),
    );
    assert.deepEqual(sent.generationConfig.responseModalities, [
      "TEXT",
      "IMAGE",
    ]);
  });
  it("falha de forma explícita quando o provedor está indisponível ou não gera imagem", async () => {
    await assert.rejects(
      generateProductPhoto(
        input,
        async () => new Response("error", { status: 503 }),
      ),
      { code: "unavailable" },
    );
    await assert.rejects(
      generateProductPhoto(
        input,
        async () =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "blocked" }] } }],
            }),
          ),
      ),
      { code: "failed-precondition" },
    );
    await assert.rejects(
      generateProductPhoto(
        input,
        async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { inlineData: { data: "", mimeType: "image/png" } },
                    ],
                  },
                },
              ],
            }),
          ),
      ),
      { code: "failed-precondition" },
    );
  });
});
