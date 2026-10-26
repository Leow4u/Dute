import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { genkitDoAgente, LOCAL_DO_VERTEX, MODELO_DO_AGENTE, MODELO_RESERVA, resumirComGenkit } from "./agente-modelo.js";

/**
 * Onde o Vertex AI processa (LGPD, decisão 12, 26/10/2026): o pedido sai do
 * plugin do Genkit de verdade, com o token e a rede falsos, e o endereço diz
 * o local. O local é o mesmo do WMS.
 */

// O plugin traz a própria cópia do google-auth-library: o token falso entra nela.
const doPlugin = createRequire(createRequire(import.meta.url).resolve("@genkit-ai/google-genai"));
const { GoogleAuth } = doPlugin("google-auth-library") as { GoogleAuth: { prototype: { getAccessToken(): Promise<string | null | undefined> } } };

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("o local do Vertex AI", () => {
  it("os pedidos do agente do núcleo vão à multirregião us, nos dois modelos", async (t) => {
    t.mock.method(GoogleAuth.prototype, "getAccessToken", async () => "token-de-teste");
    // O Genkit registra a falha do primeiro modelo.
    t.mock.method(console, "error", () => undefined);
    const destinos: string[] = [];
    t.mock.method(globalThis, "fetch", async (endereco: string | URL | Request) => {
      const url = new URL(endereco instanceof Request ? endereco.url : String(endereco));
      destinos.push(`${url.host} ${url.pathname.replace(/^\/v1(beta1)?\/projects\/demo-dute\//, "")}`);
      // O primeiro modelo falha: o resumo passa ao segundo, no mesmo local.
      return destinos.length === 1
        ? resposta({ error: { code: 503, message: "Indisponível.", status: "UNAVAILABLE" } }, 503)
        : resposta({ candidates: [{ content: { role: "model", parts: [{ text: "Resumo." }] }, finishReason: "STOP" }] });
    });

    const resumo = await resumirComGenkit(genkitDoAgente("demo-dute"))("", [{ papel: "user", conteudo: "Quantas caixas?", em: "2026-10-26T10:00:00.000Z" }]);

    assert.equal(resumo, "Resumo.");
    assert.deepEqual(destinos, [
      `aiplatform.us.rep.googleapis.com locations/us/publishers/google/models/${MODELO_RESERVA}:generateContent`,
      `aiplatform.us.rep.googleapis.com locations/us/publishers/google/models/${MODELO_DO_AGENTE}:generateContent`,
    ]);
  });

  it("é o mesmo local do WMS", () => {
    const doWms = readFileSync(fileURLToPath(new URL("../../../wms/src/domain/vertex-location.ts", import.meta.url)), "utf8");
    assert.equal(LOCAL_DO_VERTEX, "us");
    assert.equal(doWms.match(/export const VERTEX_LOCATION(?::[^=]+)? = "(\w+)";/)?.[1], LOCAL_DO_VERTEX);
  });
});
