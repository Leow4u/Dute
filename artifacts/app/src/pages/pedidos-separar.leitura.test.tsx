// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A separação concluída lê a fila do armazém uma vez (carregamento v2, parte
 * 10; o PR 5 do celular, docs/plataforma/diagnostico-carregamento.md, 9.2,
 * item 6: "o Separado não lê duas vezes"). A fila (`/api/warehouse/ops`) traz
 * até cerca de 9.900 documentos. Antes, o "Conferir" do prazo sem resposta
 * lia a fila para saber se a conclusão tinha valido e, valendo, lia de novo
 * no fim. Agora o fim usa a leitura que o "Conferir" acabou de fazer.
 */

const estado = vi.hoisted(() => ({ separado: false, leiturasDaFila: 0 }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ options: [], code: "BTG", isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: undefined, erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => () => null, useCatalogoDeSkus: () => ({ data: { items: [] }, isError: false, isPending: false }) }));
vi.mock("@/lib/warehouse-ops/use-lista-de-separacao", () => ({ useLeituraDaLista: () => ({ grupos: [] }) }));
vi.mock("@/lib/warehouse-ops/use-volumes-do-pedido", () => ({ useVolumesDoPedido: () => ({ volumes: [], estado: "carregando", pedido: null }) }));
vi.mock("@/lib/wms/separacao", () => ({
  // A conclusão passa do prazo sem resposta: a tela não sabe se valeu.
  concluirSeparacao: vi.fn(async () => {
    throw Object.assign(new Error("deadline"), { code: "functions/deadline-exceeded" });
  }),
  desfazerLinha: vi.fn(),
  dividirLinha: vi.fn(),
  fecharVolume: vi.fn(),
  separarLinha: vi.fn(),
  separarMenos: vi.fn(),
}));
// A bancada e o diálogo são de outras partes: aqui só os botões que levam ao "Conferir".
vi.mock("./pedidos-separar-view", () => ({
  PedidosSepararView: ({ onConcluir }: { onConcluir: () => void }) => (
    <button type="button" onClick={onConcluir}>
      Concluir separação
    </button>
  ),
}));
vi.mock("./pedido-separado-view", () => ({ PedidoSeparadoView: () => <p>Pedido separado</p> }));
vi.mock("@/features/warehouse-ops/concluir-separacao", () => ({
  ConcluirSeparacaoDialog: ({ aberto, estado: fim, onConfirmar, onConferir }: { aberto: boolean; estado: string; onConfirmar: () => void; onConferir: () => void }) =>
    aberto ? (
      <div>
        <button type="button" onClick={onConfirmar}>
          Confirmar separação
        </button>
        {fim === "sem-resposta" ? (
          <button type="button" onClick={onConferir}>
            Conferir
          </button>
        ) : null}
      </div>
    ) : null,
}));
vi.mock("@/features/warehouse-ops/dividir-em-volumes", () => ({ DividirEmVolumesDialog: () => null }));
vi.mock("@/features/warehouse-ops/outra-caixa", () => ({ OutraCaixaDialog: () => null }));
vi.mock("@/features/warehouse-ops/separar-menos", () => ({ SepararMenosDialog: () => null }));

import PaginaPedidosSeparar from "./pedidos-separar";

function fila() {
  const pick = { id: "pick_ord_1039", reference: "pick_ord_1039", title: "PED-1039", status: estado.separado ? "completed" : "planned", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] };
  const ship = { id: "ship_ord_1039", reference: "ship_ord_1039", title: "PED-1039", status: "ready_to_dispatch", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] };
  return { alerts: [], queues: { picking: { key: "picking", tasks: [pick] }, expedition: { key: "expedition", tasks: estado.separado ? [ship] : [] } } };
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (typeof globalThis.crypto?.randomUUID !== "function") vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "chave-1" });
  estado.separado = false;
  estado.leiturasDaFila = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), "http://localhost");
      if (url.pathname === "/api/warehouse/ops") estado.leiturasDaFila += 1;
      await new Promise((pronto) => setTimeout(pronto, 30));
      const corpo = url.pathname === "/api/warehouse/ops" ? fila() : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function botao(texto: string) {
  const achado = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === texto);
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado;
}

describe("a separação concluída e a fila do armazém", () => {
  it("o Conferir que acha a separação concluída lê a fila uma vez só, e a tela vai ao pedido separado", async () => {
    window.history.replaceState(null, "", "/pedidos/separar?pedido=ord_1039");
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Router>
            <PaginaPedidosSeparar />
          </Router>
        </QueryClientProvider>,
      );
    });
    await passar(100);
    expect(estado.leiturasDaFila).toBe(1);
    await act(async () => botao("Concluir separação").click());
    await act(async () => botao("Confirmar separação").click());
    await passar(100);
    // Sem resposta no prazo; por baixo, a conclusão valeu.
    estado.separado = true;
    const antes = estado.leiturasDaFila;
    await act(async () => botao("Conferir").click());
    await passar(1_000);
    expect(container.textContent).toContain("Pedido separado");
    expect(estado.leiturasDaFila - antes).toBe(1);
  });
});
