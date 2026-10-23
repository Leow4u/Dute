import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProductPhotoInput,
  productPhotoPath,
  productPhotoPrompt,
  generateProductPhoto,
  originalProductPhoto,
  reviewProductPhoto,
  PRODUCT_PHOTO_DEFAULT_MODEL,
  PRODUCT_PHOTO_INPUT_MAX_BYTES,
} from "./product-photo.js";

describe("apresentação comercial e conferência visual", () => {
  const base = {
    mode: "mannequin" as const,
    mannequin: "male" as const,
    product_name: "TRICOT MEIO ZÍPER PRETO M",
    category: "Tricô",
  };
  it("limita camisetas e tricôs ao busto e proíbe região íntima visível", () => {
    const prompt = productPhotoPrompt(base);
    assert.match(prompt, /HEADLESS, ARMLESS TORSO BUST/);
    assert.match(prompt, /physically ENDS INSIDE the garment hem/);
    assert.match(
      prompt,
      /NO lower torso, pelvis, crotch, groin, legs or hands/,
    );
    assert.match(
      prompt,
      /no genitalia, genital outlines, anatomical crotch bulges/,
    );
    assert.match(prompt, /reproduce visible logos and embroidery exactly/);
    assert.match(
      prompt,
      /keep its original presentation rather than hallucinating/,
    );
  });
  it("usa suporte coberto para peças de baixo e suporte invisível para vestidos", () => {
    assert.match(
      productPhotoPrompt({
        ...base,
        product_name: "Calça masculina",
        category: "Calça",
      }),
      /HEADLESS lower-body display form/,
    );
    assert.match(
      productPhotoPrompt({
        ...base,
        product_name: "Vestido feminino",
        category: "Vestido",
        mannequin: "female",
      }),
      /INVISIBLE garment support/,
    );
    assert.match(
      productPhotoPrompt({ ...base, mode: "catalog" }),
      /folded product MUST stay folded/,
    );
    assert.match(
      productPhotoPrompt({ ...base, mode: "garment", mannequin: undefined }),
      /Show ONLY the same garment/,
    );
    assert.ok(
      ProductPhotoInput.safeParse({
        ...base,
        mode: "garment",
        mannequin: undefined,
        customer_code: "Cliente",
        source_url: "https://example.test/source.jpg",
        request_id: "00000000-0000-4000-8000-000000000000",
      }).success,
    );
  });
  const input = {
    project: "demo",
    models: ["gemini-3.5-flash", "gemini-3.8-flash"],
    token: "test",
    prompt: "Busto de tricô masculino",
    original: { bytes: Buffer.from("original"), mimeType: "image/jpeg" },
    generated: { bytes: Buffer.from("generated"), mimeType: "image/png" },
  };
  const approved = {
    commercial_presentation: true,
    product_fidelity: true,
    branding_fidelity: true,
    framing: true,
  };
  const result = (review: unknown) =>
    new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(review) }] } },
        ],
      }),
    );
  it("confere original e proposta juntos antes de aprovar, incluindo logos e enquadramento", async () => {
    let sent: Record<string, any> = {};
    const review = await reviewProductPhoto(input, async (url, init) => {
      assert.match(String(url), /gemini-3.5-flash:generateContent$/);
      sent = JSON.parse(String(init?.body));
      return result(approved);
    });
    assert.deepEqual(review, { review: approved, model: "gemini-3.5-flash" });
    const images = sent.contents[0].parts.filter(
      (part: any) => part.inlineData,
    );
    assert.deepEqual(
      images.map((part: any) => part.inlineData.data),
      [
        input.original.bytes.toString("base64"),
        input.generated.bytes.toString("base64"),
      ],
    );
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
  });
  it("recusa anatomia inadequada, peça ou logo alterados e enquadramento incorreto", async () => {
    for (const criterion of Object.keys(approved)) {
      let calls = 0;
      await assert.rejects(
        reviewProductPhoto(input, async () => {
          calls += 1;
          return result({ ...approved, [criterion]: false });
        }),
        (error: any) => {
          assert.equal(error.code, "failed-precondition");
          assert.equal(error.details.photo_quality_rejected, true);
          return true;
        },
      );
      // Reprovação encerra: outro modelo não dá segunda opinião.
      assert.equal(calls, 1);
    }
  });
  it("passa ao próximo modelo quando um está aposentado e registra o motivo do Vertex AI", async (t) => {
    const logged = t.mock.method(console, "error", () => undefined);
    const requested: string[] = [];
    const review = await reviewProductPhoto(
      { ...input, models: ["", "gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.8-flash"] },
      async (url) => {
        requested.push(String(url).replace(/.*\/models\/|:generateContent$/g, ""));
        return requested.length === 1
          ? new Response(
              JSON.stringify({
                error: {
                  code: 404,
                  message: "Publisher Model `gemini-3.5-flash` was not found or your project does not have access to it.",
                  status: "NOT_FOUND",
                },
              }),
              { status: 404 },
            )
          : result(approved);
      },
    );
    assert.deepEqual(requested, ["gemini-3.5-flash", "gemini-3.8-flash"]);
    assert.deepEqual(review, { review: approved, model: "gemini-3.8-flash" });
    assert.equal(logged.mock.callCount(), 1);
    const [, details] = logged.mock.calls[0]!.arguments as [string, Record<string, unknown>];
    assert.equal(details.status, 404);
    assert.equal(details.model, "gemini-3.5-flash");
    assert.match(String(details.detail), /^NOT_FOUND: Publisher Model .* was not found/);
  });
  it("não libera a proposta se a conferência falhar ou responder dados incompletos", async (t) => {
    t.mock.method(console, "error", () => undefined);
    for (const invalid of [
      {},
      { ...approved, commercial_presentation: "true" },
      { approved: true },
    ]) {
      await assert.rejects(
        reviewProductPhoto(input, async () => result(invalid)),
        { code: "unavailable" },
      );
    }
    let calls = 0;
    await assert.rejects(
      reviewProductPhoto(input, async () => {
        calls += 1;
        return new Response("denied", { status: 403 });
      }),
      { code: "unavailable" },
    );
    assert.equal(calls, input.models.length);
    await assert.rejects(
      reviewProductPhoto(input, async () => new Response('{"candidates":[]}')),
      { code: "unavailable" },
    );
  });
  it("limita a soma das imagens para caber na requisição de conferência", async () => {
    await assert.rejects(
      reviewProductPhoto(
        {
          ...input,
          original: {
            ...input.original,
            bytes: Buffer.alloc(14 * 1024 * 1024),
          },
        },
        async () => {
          throw new Error("Não deve enviar requisição grande");
        },
      ),
      { code: "resource-exhausted" },
    );
  });
});

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
    model: "gemini-3-pro-image",
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
        /locations\/global\/publishers\/google\/models\/gemini-3-pro-image:generateContent$/,
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
                    thought: true,
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("draft").toString("base64"),
                    },
                  },
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
    assert.deepEqual(sent.generationConfig.imageConfig, {
      imageSize: "2K",
      aspectRatio: "1:1",
    });
  });
  it("usa Nano Banana Pro por padrão e rejeita arquivos acima do limite antes de cobrar uma geração", async () => {
    assert.equal(PRODUCT_PHOTO_DEFAULT_MODEL, "gemini-3-pro-image");
    let requested = "";
    await generateProductPhoto({ ...input, model: undefined }, async (url) => {
      requested = String(url);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("image").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    assert.match(requested, /gemini-3-pro-image:generateContent$/);
    await assert.rejects(
      generateProductPhoto(
        { ...input, bytes: Buffer.alloc(PRODUCT_PHOTO_INPUT_MAX_BYTES + 1) },
        async () => {
          throw new Error("Não deve enviar uma foto maior que 7 MB");
        },
      ),
      { code: "invalid-argument" },
    );
  });
  it("falha de forma explícita quando o provedor está indisponível ou não gera imagem", async (t) => {
    const logged = t.mock.method(console, "error", () => undefined);
    await assert.rejects(
      generateProductPhoto(
        input,
        async () =>
          new Response(
            JSON.stringify({ error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }),
            { status: 429 },
          ),
      ),
      { code: "unavailable" },
    );
    const [, details] = logged.mock.calls[0]!.arguments as [string, Record<string, unknown>];
    assert.equal(details.detail, "RESOURCE_EXHAUSTED: Quota exceeded");
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
