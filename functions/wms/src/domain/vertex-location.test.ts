import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { vertexAI } from "@genkit-ai/google-genai";
import { genkit } from "genkit";

import { PRODUCT_PHOTO_LOCATION, VERTEX_LOCATION, vertexGenerateContentUrl, vertexPlugin } from "./vertex-location.js";

/**
 * Onde o Vertex AI processa os pedidos do WMS (LGPD, decisão 12, 26/10/2026):
 * o Genkit de verdade, com o token e a rede falsos, e o endereço diz o local.
 */

// O plugin traz a própria cópia do google-auth-library: o token falso entra nela.
const fromPlugin = createRequire(createRequire(import.meta.url).resolve("@genkit-ai/google-genai"));
const { GoogleAuth } = fromPlugin("google-auth-library") as { GoogleAuth: { prototype: { getAccessToken(): Promise<string | null | undefined> } } };

describe("o local do Vertex AI no WMS", () => {
  it("o Genkit do WMS (Agent Dute, leitura de NF e de documento) pede na multirregião us", async (t) => {
    t.mock.method(GoogleAuth.prototype, "getAccessToken", async () => "token-de-teste");
    const requested: string[] = [];
    t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
      requested.push(target instanceof Request ? target.url : String(target));
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Pronto." }] }, finishReason: "STOP" }] }), {
        headers: { "content-type": "application/json" },
      });
    });

    const response = await genkit({ plugins: [vertexPlugin("demo-dute")] }).generate({ model: vertexAI.model("gemini-3.8-flash"), prompt: "Oi" });

    assert.equal(response.text, "Pronto.");
    assert.equal(requested.length, 1);
    const url = new URL(requested[0]!);
    assert.equal(url.host, "aiplatform.us.rep.googleapis.com");
    assert.match(url.pathname, /\/projects\/demo-dute\/locations\/us\/publishers\/google\/models\/gemini-3\.8-flash:generateContent$/);
  });

  it("a conferência da foto vai à us; a geração, que só existe no global, fica lá", () => {
    assert.equal(VERTEX_LOCATION, "us");
    assert.equal(PRODUCT_PHOTO_LOCATION, "global");
    assert.equal(
      vertexGenerateContentUrl("demo-dute", VERTEX_LOCATION, "gemini-3.5-flash"),
      "https://aiplatform.us.rep.googleapis.com/v1/projects/demo-dute/locations/us/publishers/google/models/gemini-3.5-flash:generateContent",
    );
    assert.equal(
      vertexGenerateContentUrl("demo-dute", PRODUCT_PHOTO_LOCATION, "gemini-3-pro-image"),
      "https://aiplatform.googleapis.com/v1/projects/demo-dute/locations/global/publishers/google/models/gemini-3-pro-image:generateContent",
    );
  });
});
