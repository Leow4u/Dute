// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A regra única das respostas do Firestore, dos dois lados (carregamento v2,
 * parte 13j): a escuta ao vivo que fica só no cache marca o SDK como o
 * `getDocs` do `lib/cloud-api.ts` marca. Até a 13i, só a leitura do cloud-api
 * sabia do SDK offline: com só as escutas na tela (a Operação, o Comercial, o
 * campo, o portal), o "Tentar de novo" e a releitura não o acordavam, e ele só
 * tentava o servidor no relógio dele (até 60 s). Dados sintéticos; o SDK é de
 * mentira.
 */

type Assinatura = { alvo: { path?: string; id?: string; chave?: string }; proximo: (snapshot: unknown) => void; ativa: boolean };

const sdk = vi.hoisted(() => ({
  assinaturas: [] as Assinatura[],
  ordem: [] as string[],
  sessao: { usuario: null as null | { uid: string } },
}));

vi.mock("./firebase", () => ({
  get firebaseAuth() {
    return sdk.sessao.usuario ? { currentUser: sdk.sessao.usuario } : null;
  },
  firestore: {},
}));
vi.mock("./functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));
vi.mock("./auth", () => ({ useAppUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...original,
    doc: (_db: unknown, path: string, id: string) => ({ type: "document", path, id }),
    onSnapshot: (alvo: Assinatura["alvo"], ...resto: unknown[]) => {
      const [proximo] = (typeof resto[0] === "function" ? resto : resto.slice(1)) as [Assinatura["proximo"]];
      const assinatura: Assinatura = { alvo, proximo, ativa: true };
      sdk.assinaturas.push(assinatura);
      return () => {
        assinatura.ativa = false;
      };
    },
    queryEqual: (a: { chave?: string }, b: { chave?: string }) => a.chave === b.chave,
    refEqual: () => false,
    disableNetwork: async () => void sdk.ordem.push("desliga"),
    enableNetwork: async () => void sdk.ordem.push("liga"),
  };
});

import { acordarFirestore, aoVoltarOFirestore } from "./cloud-api";
import { useLeitura } from "./operacao/leitura";

const lista = (ids: string[], fromCache: boolean) => ({ docs: ids.map((id) => ({ id, data: () => ({}) })), metadata: { fromCache } });

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sdk.assinaturas.length = 0;
  sdk.ordem.length = 0;
  sdk.sessao.usuario = null;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Ordens() {
  useLeitura("sonda:ordens", () => ({ type: "query", chave: "ordens" }) as never, (id) => id);
  return null;
}

const daEscuta = () => sdk.assinaturas.filter((assinatura) => assinatura.ativa && assinatura.alvo.chave === "ordens").at(-1)!;

describe("a escuta ao vivo e o SDK que se deu por offline", () => {
  it("a escuta que fica só no cache deixa o app acordar o SDK; a resposta do servidor tira a marca", async () => {
    act(() => raiz!.render(<Ordens />));
    act(() => daEscuta().proximo(lista(["OS-1"], false)));
    expect(acordarFirestore()).toBeNull();

    // O servidor não responde há 10 s: a vista sai do dia, e o "Tentar de novo" e a releitura acordam o SDK.
    act(() => daEscuta().proximo(lista(["OS-1"], true)));
    const acordando = acordarFirestore();
    expect(acordando).not.toBeNull();
    await acordando;
    expect(sdk.ordem).toEqual(["desliga", "liga"]);

    act(() => daEscuta().proximo(lista(["OS-1"], false)));
    expect(acordarFirestore()).toBeNull();
  });

  it("com alguém logado, a escuta que fica só no cache faz o app esperar a volta pelo perfil", async () => {
    sdk.sessao.usuario = { uid: "u-teste" };
    const voltou = vi.fn();
    const deixar = aoVoltarOFirestore(voltou);
    act(() => raiz!.render(<Ordens />));
    act(() => daEscuta().proximo(lista(["OS-1"], false)));
    act(() => daEscuta().proximo(lista(["OS-1"], true)));
    const perfil = sdk.assinaturas.find((assinatura) => assinatura.ativa && assinatura.alvo.path === "users");
    expect(perfil?.alvo).toMatchObject({ path: "users", id: "u-teste" });
    act(() => perfil!.proximo({ metadata: { fromCache: false } }));
    expect(voltou).toHaveBeenCalledTimes(1);
    expect(acordarFirestore()).toBeNull();
    deixar();
  });
});
