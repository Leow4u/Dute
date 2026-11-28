// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import type { DocumentoView, EdicaoView } from "@/lib/eventos/tipos";
import { edicaoDaNecton } from "@/test/eventos-necton";

/**
 * O layout e a planilha anexados à edição pelo portal (spec, "Fotos e
 * documentos"): o arquivo sobe ao Storage e attachEventDocument o confere; a
 * linha vem do documento vivo; "Tirar" chama removeEventDocument; o arquivo
 * grande recusa antes de subir; antes do nascimento, nada se anexa. As
 * chamadas e as leituras ao vivo simuladas; dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  enviados: [] as Array<{ code: string; editionId: string; arquivo: File; resolver: (resultado: unknown) => void; rejeitar: (erro: unknown) => void }>,
  tiradas: [] as Array<Record<string, unknown>>,
  toasts: [] as Array<Record<string, unknown>>,
  viva: new Map<string, unknown>(),
}));

vi.mock("@/lib/eventos/enviar-anexo", () => ({
  enviarAnexoDoEvento: (code: string, editionId: string, arquivo: File) =>
    new Promise((resolver, rejeitar) => estado.enviados.push({ code, editionId, arquivo, resolver, rejeitar })),
}));
vi.mock("@/lib/wms/eventos", () => ({
  salvarEdicao: () => new Promise(() => undefined),
  enviarEdicao: () => new Promise(() => undefined),
  cancelarEdicao: () => new Promise(() => undefined),
  tirarDocumento: (entrada: Record<string, unknown>) => {
    estado.tiradas.push(entrada);
    return Promise.resolve({ id: entrada.edition_id, edicao: 3, documentos: 0 });
  },
}));
vi.mock("@/lib/eventos/use-eventos", async () => {
  const necton = await import("@/test/eventos-necton");
  const capa = { id: necton.edicaoDaNecton().event_id, customer_code: "BTG", name: "B2B Conference Necton", description: null, status: "active", editions_count: 1, last_edition_id: null, last_edition_label: null };
  const aoVivo = { erro: false, tentando: false, tentar: () => undefined, falta: null, lidaEm: null };
  return {
    useEdicaoDoEvento: (id: string | null) => ({ ...aoVivo, edicao: id ? estado.viva.get(id) : undefined }),
    useEventosDoCliente: () => ({ ...aoVivo, itens: [capa] }),
    usePrecosDoCliente: () => ({ ...aoVivo, itens: [] }),
    useEdicoesDoCliente: () => ({ ...aoVivo, itens: [] }),
  };
});
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { customer_code: "BTG", role: "cliente" } }, isLoaded: true }) }));
vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: { modules: ["wms"] } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: Record<string, unknown>) => estado.toasts.push(aviso) }) }));
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return { ...original, ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</> };
});

import { ClienteEventoEdicao, ClienteEventoNovo } from "./evento-formulario";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LAYOUT: DocumentoView = {
  id: "an_00000000000000a1",
  caminho: "portal/BTG/eventos/ced_0123456789abcdef/an_00000000000000a1.pdf",
  nome: "layout-necton-2027.pdf",
  tipo: "application/pdf",
  tamanho: 1_258_291,
  origem: "cliente",
  momento_id: null,
  registrado_por: null,
  registrado_em: null,
};
const NECTON: EdicaoView = { ...edicaoDaNecton(), documentos: [LAYOUT] };

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function abrir(caminho: string) {
  const memoria = memoryLocation({ path: caminho });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <Router hook={memoria.hook} searchHook={memoria.searchHook}>
        <Switch>
          <Route path="/portal/eventos/novo" component={ClienteEventoNovo} />
          <Route path="/portal/eventos/edicao" component={ClienteEventoEdicao} />
        </Switch>
      </Router>,
    ),
  );
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.getAttribute("aria-label") === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo || item.textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado;
}

async function escolher(seletor: string, arquivo: File) {
  const campo = container!.querySelector<HTMLInputElement>(seletor)!;
  await act(async () => {
    Object.defineProperty(campo, "files", { value: [arquivo], configurable: true });
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function arquivoDe(nome: string, tipo: string, tamanho: number): File {
  const arquivo = new File(["x"], nome, { type: tipo });
  Object.defineProperty(arquivo, "size", { value: tamanho });
  return arquivo;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.enviados = [];
  estado.tiradas = [];
  estado.toasts = [];
  estado.viva = new Map([[NECTON.id, NECTON]]);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("os anexos no formulário", () => {
  it("escolher o PDF chama enviarAnexoDoEvento com o cliente, a edição e o arquivo; a linha vem do documento vivo; Tirar chama tirarDocumento", async () => {
    await abrir(`/portal/eventos/edicao?id=${NECTON.id}`);
    expect(container!.textContent).toContain("layout-necton-2027.pdf · 1,2 MB");
    const pdf = arquivoDe("layout-novo.pdf", "application/pdf", 2_000);
    await escolher('input[type="file"][data-anexo="layout"]', pdf);
    expect(estado.enviados).toHaveLength(1);
    expect(estado.enviados[0]).toMatchObject({ code: "BTG", editionId: NECTON.id, arquivo: pdf });
    await act(async () => estado.enviados[0].resolver({ documento_id: "an_00000000000000b2" }));
    await act(async () => botao("Tirar layout-necton-2027.pdf").click());
    expect(estado.tiradas).toHaveLength(1);
    expect(estado.tiradas[0]).toMatchObject({ edition_id: NECTON.id, documento_id: LAYOUT.id });
    expect(typeof estado.tiradas[0].idempotency_key).toBe("string");
  });

  it("a planilha de 11 MB mostra a frase e não chama nada; a planilha sem tipo sobe pela extensão", async () => {
    await abrir(`/portal/eventos/edicao?id=${NECTON.id}`);
    await escolher('input[type="file"][data-anexo="planilha"]', arquivoDe("produtos.xlsx", XLSX, 11 * 1024 * 1024));
    expect(container!.textContent).toContain("produtos.xlsx: O documento passa de 10 MB.");
    expect(estado.enviados).toHaveLength(0);
    await escolher('input[type="file"][data-anexo="planilha"]', arquivoDe("produtos.xlsx", "", 500_000));
    expect(estado.enviados).toHaveLength(1);
    expect(container!.textContent).not.toContain("O documento passa de 10 MB.");
  });

  it("antes do nascimento os dois botões ficam travados", async () => {
    estado.viva = new Map();
    await abrir("/portal/eventos/novo");
    for (const rotulo of ["Anexar layout", "Anexar planilha"]) expect(botao(rotulo).getAttribute("aria-disabled")).toBe("true");
    expect(container!.querySelectorAll('input[type="file"]:not([disabled])')).toHaveLength(0);
  });
});
