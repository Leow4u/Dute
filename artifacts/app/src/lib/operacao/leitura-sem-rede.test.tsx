// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A leitura ao vivo da Operação, do Comercial, do campo e do portal com o
 * aparelho sem rede (carregamento v2, parte 13i; o momento 8 e a decisão
 * 9.4.2). Sem rede, o `onSnapshot` não falha: responde com o que estiver no
 * cache, vazio na primeira visita, e a tela dizia "Nenhuma OS" ou que o
 * documento não existe. Agora, a resposta só do cache, sem nenhuma leitura do
 * servidor antes e com o aparelho sem rede, é falta de conexão (a falha da
 * leitura, nunca a lista vazia), como no `lib/cloud-api.ts`; o que já veio do
 * servidor fica na tela. Quando o servidor responde, mesmo com os mesmos
 * documentos do cache, a leitura chega: a escuta pede as mudanças de
 * metadados. Dados sintéticos; o Firestore é de mentira.
 */

type Assinatura = { opcoes: unknown; proximo: (snapshot: unknown) => void; falha: (erro: Error) => void; ativa: boolean };

const estado = vi.hoisted(() => ({ assinaturas: [] as Assinatura[] }));

vi.mock("../firebase", () => ({ firestore: {} }));
vi.mock("../auth", () => ({ useAppUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("firebase/firestore", () => ({
  // Aceita as duas formas: (alvo, proximo, falha) e (alvo, opcoes, proximo, falha).
  onSnapshot: (_alvo: unknown, ...resto: unknown[]) => {
    const [opcoes, proximo, falha] = typeof resto[0] === "function" ? [undefined, ...resto] : resto;
    const assinatura: Assinatura = { opcoes, proximo: proximo as Assinatura["proximo"], falha: falha as Assinatura["falha"], ativa: true };
    estado.assinaturas.push(assinatura);
    return () => {
      assinatura.ativa = false;
    };
  },
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false }),
}));

import { useDocumento, useLeitura } from "./leitura";
import { useDocumento as useDocumentoDoComercial, useLeitura as useLeituraDoComercial } from "../comercial/leitura";

const lista = (ids: string[], fromCache: boolean) => ({ docs: ids.map((id) => ({ id, data: () => ({ nome: id }) })), metadata: { fromCache } });
const documento = (id: string | null, fromCache: boolean) => ({ id: id ?? "x", exists: () => id !== null, data: () => ({ nome: id }), metadata: { fromCache } });

let raiz: Root | null = null;
let container: HTMLDivElement;
let semRede = false;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  semRede = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => !semRede);
  estado.assinaturas = [];
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ativa(): Assinatura {
  return estado.assinaturas.filter((assinatura) => assinatura.ativa).at(-1)!;
}

type Lida = { itens: string[] | null; erro: boolean };

function sondarLista(usar: typeof useLeitura | typeof useLeituraDoComercial) {
  const visto: { atual: Lida | null } = { atual: null };
  function Sonda() {
    const leitura = usar("ordens", () => ({}) as never, (id) => id);
    visto.atual = { itens: leitura.itens, erro: leitura.erro };
    return null;
  }
  act(() => raiz!.render(<Sonda />));
  return visto;
}

describe.each([
  ["Operação", useLeitura],
  ["Comercial", useLeituraDoComercial],
] as const)("useLeitura da %s sem rede", (_nome, usar) => {
  it("pede as mudanças de metadados, para saber quando o servidor respondeu", () => {
    sondarLista(usar);
    expect(ativa().opcoes).toEqual({ includeMetadataChanges: true });
  });

  it("a resposta só do cache, sem nada do servidor e sem rede, é a falha, nunca a lista vazia; o servidor traz a lista", () => {
    semRede = true;
    const visto = sondarLista(usar);
    act(() => ativa().proximo(lista([], true)));
    expect(visto.atual).toEqual({ itens: null, erro: true });
    // O cache com o que outra tela já leu também não é a lista: pode estar pela metade.
    act(() => ativa().proximo(lista(["OS-1"], true)));
    expect(visto.atual).toEqual({ itens: null, erro: true });

    // A rede voltou e o servidor respondeu, com o mesmo que o cache tinha.
    semRede = false;
    act(() => ativa().proximo(lista(["OS-1"], false)));
    expect(visto.atual).toEqual({ itens: ["OS-1"], erro: false });
  });

  it("com o aparelho conectado, o cache que chega antes do servidor vale (o servidor vem logo em seguida)", () => {
    const visto = sondarLista(usar);
    act(() => ativa().proximo(lista(["OS-1"], true)));
    expect(visto.atual).toEqual({ itens: ["OS-1"], erro: false });
  });

  it("o que já veio do servidor fica na tela quando a rede cai", () => {
    const visto = sondarLista(usar);
    act(() => ativa().proximo(lista(["OS-1", "OS-2"], false)));
    semRede = true;
    act(() => ativa().proximo(lista(["OS-1", "OS-2"], true)));
    expect(visto.atual).toEqual({ itens: ["OS-1", "OS-2"], erro: false });
  });
});

describe("useDocumento sem rede", () => {
  it("na Operação, o documento que não está no cache não vira 'não existe': é a falha, até o servidor responder", () => {
    semRede = true;
    let visto: { item: unknown; erro: boolean } | null = null;
    function Sonda() {
      const leitura = useDocumento("demands/10045", () => ({}) as never, (id) => id);
      visto = { item: leitura.item, erro: leitura.erro };
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    expect(ativa().opcoes).toEqual({ includeMetadataChanges: true });
    act(() => ativa().proximo(documento(null, true)));
    expect(visto).toEqual({ item: undefined, erro: true });
    semRede = false;
    act(() => ativa().proximo(documento("10045", false)));
    expect(visto).toEqual({ item: "10045", erro: false });
  });

  it("no Comercial, o mesmo", () => {
    semRede = true;
    let visto: { dados: unknown; erro: boolean } | null = null;
    function Sonda() {
      const leitura = useDocumentoDoComercial("quotes/10045");
      visto = { dados: leitura.dados, erro: leitura.erro };
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    expect(ativa().opcoes).toEqual({ includeMetadataChanges: true });
    act(() => ativa().proximo(documento(null, true)));
    expect(visto).toEqual({ dados: undefined, erro: true });
    semRede = false;
    act(() => ativa().proximo(documento("10045", false)));
    expect(visto).toEqual({ dados: { nome: "10045" }, erro: false });
  });

  it("com o servidor lido antes, o documento que some do cache sem rede fica como estava", () => {
    let visto: { item: unknown; erro: boolean } | null = null;
    function Sonda() {
      const leitura = useDocumento("demands/10045", () => ({}) as never, (id) => id);
      visto = { item: leitura.item, erro: leitura.erro };
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    act(() => ativa().proximo(documento("10045", false)));
    semRede = true;
    act(() => ativa().proximo(documento("10045", true)));
    expect(visto).toEqual({ item: "10045", erro: false });
  });
});
