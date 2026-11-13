// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As leituras ao vivo do portal com a nova tentativa (carregamento v2, parte
 * 13f): Minhas OS, as NFs, as solicitações, o sino e o comprovante
 * (`useLeituraDoPortal`, `useDocumentoDoPortal`), e as imagens do comprovante
 * (`useUrlsDasFotosComEstado`). A falha fica na tela durante a nova tentativa,
 * com o "tentando", até ela responder: o aviso não sai com o foco nele nem a
 * seção volta a "carregando". O Firestore e o Storage são simulados.
 */

const assinaturas = vi.hoisted(() => [] as Array<{ proximo: (instantaneo: unknown) => void; erro: (erro: unknown) => void; ativa: boolean }>);
const enderecos = vi.hoisted(() => [] as Array<{ caminho: string; resolver: (url: string) => void; rejeitar: (erro: unknown) => void }>);

vi.mock("@/lib/firebase", async (original) => ({ ...(await original<object>()), firestore: {}, firebaseStorage: {} }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<object>()),
  collection: (...partes: unknown[]) => partes,
  doc: (...partes: unknown[]) => partes,
  onSnapshot: (_alvo: unknown, proximo: (instantaneo: unknown) => void, erro: (erro: unknown) => void) => {
    const assinatura = { proximo, erro, ativa: true };
    assinaturas.push(assinatura);
    return () => {
      assinatura.ativa = false;
    };
  },
}));
vi.mock("firebase/storage", async (original) => ({
  ...(await original<object>()),
  ref: (_storage: unknown, caminho: string) => caminho,
  getDownloadURL: (caminho: string) =>
    new Promise<string>((resolver, rejeitar) => {
      enderecos.push({ caminho, resolver, rejeitar });
    }),
}));

import { collection, doc } from "firebase/firestore";

import { useUrlsDasFotosComEstado, type UrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { useDocumentoDoPortal, useLeituraDoPortal, type DocumentoDoPortal, type LeituraDoPortal } from "./leitura-do-portal";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  assinaturas.length = 0;
  enderecos.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
});

const lista = (ids: string[]) => ({ docs: ids.map((id) => ({ id, data: () => ({ id }) })) });
const documento = (id: string) => ({ id, exists: () => true, data: () => ({ id }) });
const ultima = () => assinaturas[assinaturas.length - 1]!;

describe("a leitura ao vivo do portal (useLeituraDoPortal)", () => {
  it("a falha fica durante a nova tentativa, com o tentando, até ela responder; a falha nova a mantém, o sucesso a tira", async () => {
    let leitura: LeituraDoPortal<string> | null = null;
    function Tela() {
      leitura = useLeituraDoPortal<string>("service_orders:ACME", (db) => collection(db as never, "service_orders") as never, (id) => id);
      return null;
    }
    await act(async () => raiz!.render(<Tela />));
    expect(leitura!).toMatchObject({ itens: null, erro: false, tentando: false });

    await act(async () => ultima().erro(new Error("permission-denied")));
    expect(leitura!).toMatchObject({ itens: null, erro: true, tentando: false });

    // A nova tentativa: a assinatura velha sai, e a falha fica, dizendo que tenta.
    const velha = ultima();
    await act(async () => leitura!.tentar());
    expect(velha.ativa).toBe(false);
    expect(assinaturas).toHaveLength(2);
    expect(leitura!).toMatchObject({ itens: null, erro: true, tentando: true });

    // Falhou de novo: a falha segue, sem o tentando.
    await act(async () => ultima().erro(new Error("unavailable")));
    expect(leitura!).toMatchObject({ itens: null, erro: true, tentando: false });

    await act(async () => leitura!.tentar());
    expect(leitura!).toMatchObject({ erro: true, tentando: true });
    await act(async () => ultima().proximo(lista(["10045-01"])));
    expect(leitura!).toMatchObject({ itens: ["10045-01"], erro: false, tentando: false });
  });

  it("sem a chave, nada é assinado e não há falha", async () => {
    let leitura: LeituraDoPortal<string> | null = null;
    function Tela() {
      leitura = useLeituraDoPortal<string>(null, (db) => collection(db as never, "x") as never, (id) => id);
      return null;
    }
    await act(async () => raiz!.render(<Tela />));
    expect(assinaturas).toHaveLength(0);
    expect(leitura!).toMatchObject({ itens: null, erro: false, tentando: false });
  });
});

describe("o documento ao vivo do portal (useDocumentoDoPortal)", () => {
  it("a falha fica durante a nova tentativa, com o tentando; o documento que chega a tira", async () => {
    let leitura: DocumentoDoPortal<string> | null = null;
    function Tela() {
      leitura = useDocumentoDoPortal<string>("service_orders/10045-01", (db) => doc(db as never, "service_orders", "10045-01") as never, (id) => id);
      return null;
    }
    await act(async () => raiz!.render(<Tela />));
    expect(leitura!).toMatchObject({ item: undefined, erro: false, tentando: false });
    await act(async () => ultima().erro(new Error("unavailable")));
    expect(leitura!).toMatchObject({ item: undefined, erro: true, tentando: false });
    await act(async () => leitura!.tentar());
    expect(leitura!).toMatchObject({ item: undefined, erro: true, tentando: true });
    await act(async () => ultima().erro(new Error("unavailable")));
    expect(leitura!).toMatchObject({ erro: true, tentando: false });
    await act(async () => leitura!.tentar());
    await act(async () => ultima().proximo(documento("10045-01")));
    expect(leitura!).toMatchObject({ item: "10045-01", erro: false, tentando: false });
  });
});

describe("as imagens do comprovante (useUrlsDasFotosComEstado)", () => {
  it("lendo até responder; a que não veio fica nos que falharam durante a nova tentativa, e a que veio fica na tela", async () => {
    let fotos: UrlsDasFotos | null = null;
    function Tela({ caminhos }: { caminhos: string[] }) {
      fotos = useUrlsDasFotosComEstado(caminhos);
      return null;
    }
    await act(async () => raiz!.render(<Tela caminhos={["os/assinatura.png", "os/foto.jpg"]} />));
    expect(fotos!).toMatchObject({ lendo: true, falharam: [], tentando: false });

    await act(async () => {
      enderecos.find((item) => item.caminho === "os/assinatura.png")!.resolver("https://exemplo.invalid/assinatura.png");
      enderecos.find((item) => item.caminho === "os/foto.jpg")!.rejeitar(new Error("storage/retry-limit-exceeded"));
    });
    expect(fotos!).toMatchObject({ lendo: false, falharam: ["os/foto.jpg"], tentando: false });
    expect(Object.keys(fotos!.urls)).toEqual(["os/assinatura.png"]);

    await act(async () => fotos!.tentar());
    expect(enderecos).toHaveLength(4);
    // Durante a nova tentativa: a falha fica, com o tentando, e a imagem que já veio continua na tela.
    expect(fotos!).toMatchObject({ lendo: false, falharam: ["os/foto.jpg"], tentando: true });
    expect(Object.keys(fotos!.urls)).toEqual(["os/assinatura.png"]);

    await act(async () => {
      for (const item of enderecos.slice(2)) item.resolver(`https://exemplo.invalid/${item.caminho}`);
    });
    expect(fotos!).toMatchObject({ lendo: false, falharam: [], tentando: false });
    expect(Object.keys(fotos!.urls).sort()).toEqual(["os/assinatura.png", "os/foto.jpg"]);
  });
});
