import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A foto que sobe é a compactada (carregamento v2, parte 11; decisão 4 do
 * celular): no Receber, na Contagem e na ficha do item (uploadProductPhoto),
 * na OS (enviarFoto) e no anexo do portal (enviarSolicitacao), o que vai ao
 * Storage é o que a compactação devolveu, e não o arquivo escolhido. A
 * compactação e o Storage são simulados: o teste confere o que foi enviado.
 */

const espia = vi.hoisted(() => ({
  compactadas: [] as Array<{ nome: string; manterTipo: boolean }>,
  enviados: [] as Array<{ caminho: string; dados: Blob }>,
  chamadas: [] as string[],
}));

const COMPACTADA = vi.hoisted(() => new File(["jpeg-de-2000-px"], "compactada.jpg", { type: "image/jpeg" }));

vi.mock("@/lib/envio-de-fotos", async (original) => ({
  ...(await original<typeof import("@/lib/envio-de-fotos")>()),
  compactarFoto: async (arquivo: File, opcoes: { manterTipo?: boolean } = {}) => {
    espia.compactadas.push({ nome: arquivo.name, manterTipo: Boolean(opcoes.manterTipo) });
    return COMPACTADA;
  },
  enviarComProgresso: async (alvo: { caminho: string }, dados: Blob) => {
    espia.enviados.push({ caminho: alvo.caminho, dados });
  },
}));
vi.mock("@/lib/firebase", () => ({ firebaseStorage: {} }));
vi.mock("firebase/storage", () => ({
  ref: (_storage: unknown, caminho: string) => ({ caminho }),
  getDownloadURL: async (alvo: { caminho: string }) => `https://storage.example/${alvo.caminho}`,
}));
vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string) => {
    espia.chamadas.push(nome);
    return { solicitacao_id: "sol-1" };
  },
}));

import { uploadProductPhoto } from "@/features/warehouse-ops/shared";
import { enviarFoto } from "@/lib/operacao/enviar-foto";
import { enviarSolicitacao } from "@/lib/portal/enviar-solicitacao";
import { formularioInicial } from "@/lib/portal/solicitacao";

const ESCOLHIDA = new File([new Uint8Array(2_900_000)], "IMG_0001.jpg", { type: "image/jpeg" });

beforeEach(() => {
  espia.compactadas.length = 0;
  espia.enviados.length = 0;
  espia.chamadas.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ storage_path: "catalogo/BTG/POLO/foto.jpg" }), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("a foto que sobe é a compactada", () => {
  it("no catálogo do WMS (Receber, Contagem e a ficha do item): o destino pedido e o envio são os da compactada", async () => {
    await uploadProductPhoto(ESCOLHIDA, "POLO-GG", "BTG");
    expect(espia.compactadas).toEqual([{ nome: "IMG_0001.jpg", manterTipo: false }]);
    expect(espia.enviados).toHaveLength(1);
    expect(espia.enviados[0].dados).toBe(COMPACTADA);
    // O destino já leva o nome e o tamanho da compactada.
    const pedido = JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body));
    expect(pedido).toMatchObject({ file_name: "compactada.jpg", size_bytes: COMPACTADA.size, content_type: "image/jpeg" });
  });

  it("na OS: a foto compactada sobe no caminho da OS, mantendo o tipo, e só então a callable anexa", async () => {
    await enviarFoto("10211-01", { arquivo: ESCOLHIDA, nome: "ft_0000000000000001.jpg", instante: "2026-11-13T13:00:00.000Z" }, { chave: "foto:ft_0000000000000001.jpg" });
    expect(espia.compactadas).toEqual([{ nome: "IMG_0001.jpg", manterTipo: true }]);
    expect(espia.enviados).toEqual([{ caminho: "os/10211-01/fotos/ft_0000000000000001.jpg", dados: COMPACTADA }]);
    expect(espia.chamadas).toEqual(["attachPhoto"]);
  });

  it("no anexo do portal (Solicitar OS): o anexo compactado sobe, mantendo o tipo, antes da solicitação", async () => {
    const form = { ...formularioInicial("2026-11-13"), anexos: [{ arquivo: ESCOLHIDA, nome: "anexo-1.jpg", rotulo: "IMG_0001.jpg" }] };
    await enviarSolicitacao("BTG", form, "sol:chave");
    expect(espia.compactadas).toEqual([{ nome: "IMG_0001.jpg", manterTipo: true }]);
    expect(espia.enviados).toHaveLength(1);
    expect(espia.enviados[0].dados).toBe(COMPACTADA);
    expect(espia.chamadas).toEqual(["requestService"]);
  });
});
