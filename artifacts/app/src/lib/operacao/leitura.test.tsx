// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A nova tentativa da leitura ao vivo (carregamento v2, parte 13g,
 * necessidade 2): o `onSnapshot` que falha não volta sozinho. Antes, a falha
 * da Operação, do Comercial e do campo ficava sem saída ("Não foi possível
 * carregar", sem "Tentar de novo"); agora `tentar` assina de novo, a falha
 * fica à vista enquanto a nova assinatura não responde (o aviso não some com
 * o foco nele nem a tela volta a "carregando") e sai quando ela responde.
 * Dados sintéticos; o Firestore é de mentira.
 */

type Assinatura = { proximo: (snapshot: unknown) => void; falha: (erro: Error) => void; ativa: boolean };

const estado = vi.hoisted(() => ({ assinaturas: [] as Assinatura[] }));

vi.mock("../firebase", () => ({ firestore: {} }));
vi.mock("../auth", () => ({ useAppUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("firebase/firestore", () => ({
  onSnapshot: (_alvo: unknown, proximo: Assinatura["proximo"], falha: Assinatura["falha"]) => {
    const assinatura: Assinatura = { proximo, falha, ativa: true };
    estado.assinaturas.push(assinatura);
    return () => {
      assinatura.ativa = false;
    };
  },
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false }),
}));

import { juntarTentativas, novaTentativaDe, useDocumento, useLeitura, type NovaTentativa } from "./leitura";
import { useDocumento as useDocumentoDoComercial } from "../comercial/leitura";

const lista = (ids: string[]) => ({ docs: ids.map((id) => ({ id, data: () => ({ nome: id }) })) });
const documento = (id: string | null) => ({ id: id ?? "x", exists: () => id !== null, data: () => ({ nome: id }) });

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.assinaturas = [];
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** A última assinatura ativa, a que a tela escuta agora. */
function ativa(indice = -1): Assinatura {
  const ativas = estado.assinaturas.filter((assinatura) => assinatura.ativa);
  return ativas.at(indice)!;
}

describe("useLeitura com a nova tentativa", () => {
  it("a falha fica até a nova assinatura responder; a resposta tira a falha e traz os itens", () => {
    let visto: ReturnType<typeof useLeitura<string>> | null = null;
    function Sonda() {
      visto = useLeitura("colaboradores", () => ({}) as never, (id) => id);
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    expect(visto).toMatchObject({ itens: null, erro: false, tentando: false });
    expect(estado.assinaturas).toHaveLength(1);

    act(() => ativa().falha(new Error("permission-denied")));
    expect(visto).toMatchObject({ itens: null, erro: true, tentando: false });

    // Tentar de novo: assina outra vez, e a falha continua à vista enquanto espera.
    act(() => {
      void visto!.tentar();
    });
    expect(estado.assinaturas).toHaveLength(2);
    expect(estado.assinaturas[0]!.ativa).toBe(false);
    expect(visto).toMatchObject({ itens: null, erro: true, tentando: true });

    // Falhou de novo: segue na falha, sem o "tentando".
    act(() => ativa().falha(new Error("unavailable")));
    expect(visto).toMatchObject({ itens: null, erro: true, tentando: false });

    act(() => {
      void visto!.tentar();
    });
    act(() => ativa().proximo(lista(["col_1", "col_2"])));
    expect(visto).toMatchObject({ itens: ["col_1", "col_2"], erro: false, tentando: false });
  });

  it("a promessa da nova tentativa acaba quando a nova assinatura responde, o dado ou a falha (o \"Tentando de novo…\" da FalhaNaLeitura)", async () => {
    let visto: ReturnType<typeof useLeitura<string>> | null = null;
    function Sonda() {
      visto = useLeitura("orders:em_aberto", () => ({}) as never, (id) => id);
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    act(() => ativa().falha(new Error("unavailable")));
    let acabou = 0;
    act(() => {
      void visto!.tentar().then(() => {
        acabou += 1;
      });
    });
    await act(async () => undefined);
    expect(acabou).toBe(0);
    act(() => ativa().falha(new Error("unavailable")));
    await act(async () => undefined);
    expect(acabou).toBe(1);
    act(() => {
      void visto!.tentar().then(() => {
        acabou += 1;
      });
    });
    act(() => ativa().proximo(lista(["ord_1"])));
    await act(async () => undefined);
    expect(acabou).toBe(2);
    expect(visto).toMatchObject({ itens: ["ord_1"], erro: false, tentando: false });
  });

  it("outra chave no meio da falha volta a carregando, sem a falha da chave anterior", () => {
    let visto: ReturnType<typeof useLeitura<string>> | null = null;
    function Sonda({ chave }: { chave: string }) {
      visto = useLeitura(chave, () => ({}) as never, (id) => id);
      return null;
    }
    act(() => raiz!.render(<Sonda chave="hoje:2026-11-14" />));
    act(() => ativa().falha(new Error("unavailable")));
    act(() => {
      void visto!.tentar();
    });
    act(() => raiz!.render(<Sonda chave="hoje:2026-11-15" />));
    expect(visto).toMatchObject({ itens: null, erro: false, tentando: false });
  });
});

describe("useDocumento com a nova tentativa", () => {
  it("o documento que falhou é lido de novo; o que não existe responde null, sem falha", () => {
    let visto: ReturnType<typeof useDocumento<string>> | null = null;
    function Sonda() {
      visto = useDocumento("os_1", () => ({}) as never, (id) => id);
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    act(() => ativa().falha(new Error("unavailable")));
    expect(visto).toMatchObject({ item: undefined, erro: true });
    act(() => {
      void visto!.tentar();
    });
    expect(visto).toMatchObject({ item: undefined, erro: true, tentando: true });
    act(() => ativa().proximo(documento(null)));
    expect(visto).toMatchObject({ item: null, erro: false, tentando: false });
  });

  it("o documento do Comercial também tenta de novo", () => {
    let visto: ReturnType<typeof useDocumentoDoComercial> | null = null;
    function Sonda() {
      visto = useDocumentoDoComercial("quotes/q_1");
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    act(() => ativa().falha(new Error("unavailable")));
    expect(visto).toMatchObject({ erro: true });
    act(() => {
      void visto!.tentar();
    });
    expect(visto).toMatchObject({ erro: true, tentando: true });
    expect(estado.assinaturas.filter((assinatura) => assinatura.ativa)).toHaveLength(1);
  });
});

describe("a nova tentativa de várias leituras", () => {
  it("assina de novo só as que falharam ou não responderam", () => {
    const lida = { itens: ["a"], erro: false, tentando: false, tentar: vi.fn() };
    const falhou = { itens: null, erro: true, tentando: false, tentar: vi.fn() };
    const esperando = { item: undefined, erro: false, tentando: true, tentar: vi.fn() };
    const tentativa = novaTentativaDe([lida, falhou, esperando]);
    expect(tentativa.tentando).toBe(true);
    tentativa.tentar();
    expect(lida.tentar).not.toHaveBeenCalled();
    expect(falhou.tentar).toHaveBeenCalledTimes(1);
    expect(esperando.tentar).toHaveBeenCalledTimes(1);
  });

  it("juntar tentativas de origens diferentes chama todas", () => {
    const uma: NovaTentativa = { tentando: false, tentar: vi.fn() };
    const outra: NovaTentativa = { tentando: true, tentar: vi.fn() };
    const juntas = juntarTentativas(uma, outra);
    expect(juntas.tentando).toBe(true);
    juntas.tentar();
    expect(uma.tentar).toHaveBeenCalledTimes(1);
    expect(outra.tentar).toHaveBeenCalledTimes(1);
  });
});

describe("a nova tentativa não apaga o que já foi lido (necessidade 8)", () => {
  it("tentar na leitura já lida não assina de novo nem volta a carregando, também junto com outra que falhou", () => {
    let faturas: ReturnType<typeof useLeitura<string>> | null = null;
    let emissoes: ReturnType<typeof useLeitura<string>> | null = null;
    function Sonda() {
      faturas = useLeitura("financeiro:faturas", () => ({}) as never, (id) => id);
      emissoes = useLeitura("financeiro:emissoes", () => ({}) as never, (id) => id);
      return null;
    }
    act(() => raiz!.render(<Sonda />));
    act(() => estado.assinaturas[0]!.proximo(lista(["NF 1"])));
    act(() => estado.assinaturas[1]!.falha(new Error("unavailable")));
    expect(faturas).toMatchObject({ itens: ["NF 1"], erro: false });

    // O "Tentar de novo" do Início junta as duas: só a que falhou assina de novo.
    act(() => juntarTentativas({ tentando: false, tentar: faturas!.tentar }, { tentando: false, tentar: emissoes!.tentar }).tentar());
    expect(estado.assinaturas).toHaveLength(3);
    expect(estado.assinaturas[0]!.ativa).toBe(true);
    expect(faturas).toMatchObject({ itens: ["NF 1"], erro: false, tentando: false });
    expect(emissoes).toMatchObject({ itens: null, erro: true, tentando: true });

    act(() => {
      void faturas!.tentar();
    });
    expect(estado.assinaturas).toHaveLength(3);
    expect(faturas).toMatchObject({ itens: ["NF 1"], erro: false });
  });

  it("a nova tentativa chega às outras leituras da mesma chave que falharam (o menu do shell volta com o Início)", () => {
    let inicio: ReturnType<typeof useLeitura<string>> | null = null;
    let menu: ReturnType<typeof useLeitura<string>> | null = null;
    function Inicio() {
      inicio = useLeitura("demands", () => ({}) as never, (id) => id);
      return null;
    }
    function Menu() {
      menu = useLeitura("demands", () => ({}) as never, (id) => id);
      return null;
    }
    act(() =>
      raiz!.render(
        <>
          <Menu />
          <Inicio />
        </>,
      ),
    );
    act(() => {
      for (const assinatura of estado.assinaturas) assinatura.falha(new Error("permission-denied"));
    });
    expect(menu).toMatchObject({ erro: true });
    expect(inicio).toMatchObject({ erro: true });

    act(() => {
      void inicio!.tentar();
    });
    const novas = estado.assinaturas.filter((assinatura) => assinatura.ativa);
    expect(estado.assinaturas).toHaveLength(4);
    expect(novas).toHaveLength(2);
    expect(menu).toMatchObject({ erro: true, tentando: true });

    act(() => {
      for (const assinatura of novas) assinatura.proximo(lista(["10045"]));
    });
    expect(menu).toMatchObject({ itens: ["10045"], erro: false, tentando: false });
    expect(inicio).toMatchObject({ itens: ["10045"], erro: false, tentando: false });
  });

  it("a leitura da mesma chave que já leu não assina de novo pela nova tentativa da outra", () => {
    let lida: ReturnType<typeof useLeitura<string>> | null = null;
    let falhou: ReturnType<typeof useLeitura<string>> | null = null;
    function Lida() {
      lida = useLeitura("service_orders", () => ({}) as never, (id) => id);
      return null;
    }
    function Falhou() {
      falhou = useLeitura("service_orders", () => ({}) as never, (id) => id);
      return null;
    }
    act(() =>
      raiz!.render(
        <>
          <Lida />
          <Falhou />
        </>,
      ),
    );
    act(() => estado.assinaturas[0]!.proximo(lista(["10045-01"])));
    act(() => estado.assinaturas[1]!.falha(new Error("permission-denied")));
    act(() => {
      void falhou!.tentar();
    });
    expect(estado.assinaturas).toHaveLength(3);
    expect(estado.assinaturas[0]!.ativa).toBe(true);
    expect(lida).toMatchObject({ itens: ["10045-01"], erro: false });
    expect(falhou).toMatchObject({ erro: true, tentando: true });
  });
});
