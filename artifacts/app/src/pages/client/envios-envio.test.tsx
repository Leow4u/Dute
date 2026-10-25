// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O aviso de envio enviado de novo depois da resposta perdida repete a
 * chave e os anexos que já subiram, e o servidor devolve o aviso gravado.
 * Antes, cada envio saía com uma chave nova e subia de novo o anexo que a
 * leitura da nota não tinha subido: a Dutelog recebia o aviso em dobro, com
 * um recebimento previsto a mais.
 */

const estado = vi.hoisted(() => ({
  avisos: [] as Array<Record<string, unknown>>,
  anexos: [] as string[],
  perdidas: 0,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ClienteEnvios } from "./envios";

const ITEM = {
  sku_code: "BTG-000101",
  client_item_code: "A.01.0805.002.PP",
  product_name: "Polo feminina piquet azul marinho PP",
  category: "Polo",
  qty_on_hand: 12,
  qty_available: 12,
};
const VISAO = { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: [ITEM] }, requests: [] };

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const botao = (texto: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto) ?? null;

async function digitar(campo: HTMLInputElement | null, valor: string) {
  if (!campo) throw new Error("Sem o campo");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function anexar(arquivos: File[]) {
  const campo = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!campo) throw new Error("Sem o campo de anexo");
  Object.defineProperty(campo, "files", { configurable: true, value: arquivos });
  await act(async () => {
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function enviarAviso() {
  const antes = estado.avisos.length;
  await act(async () => botao("Enviar aviso")!.click());
  await esperar(() => estado.avisos.length > antes, "o aviso");
  // A falha devolve o botão; o aviso que deu certo fecha o formulário.
  await esperar(() => {
    const enviar = botao("Enviar aviso");
    return enviar ? !enviar.disabled : botao("Avisar um envio") !== null;
  }, "o fim do envio");
  return estado.avisos.at(-1)!;
}

beforeEach(async () => {
  estado.avisos = [];
  estado.anexos = [];
  estado.perdidas = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") return json(VISAO);
      if (url.pathname === "/api/client/shipments/attachments") {
        const { file_name: nome } = JSON.parse(String(init?.body)) as { file_name: string };
        estado.anexos.push(nome);
        // O caminho muda a cada subida, como no servidor.
        const caminho = `client-shipments/BTG_Pactual/${estado.anexos.length}-${nome}`;
        return json({ file_name: nome, file_url: `https://arquivos/${caminho}`, storage_path: caminho, content_type: "application/pdf", size_bytes: 4 });
      }
      // A leitura da nota não acha itens: o aviso segue preenchido à mão.
      if (url.pathname === "/api/client/shipments/read-invoice") return json({ items: [] });
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.avisos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (estado.perdidas > 0) {
          estado.perdidas -= 1;
          return json({ message: "Falha interna no servidor. Tente novamente ou avise o time técnico." }, 500);
        }
        return json({ id: "creq_3", request_number: "REC-0021" }, 201);
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Router ssrPath="/portal/recebimentos">
          <ClienteEnvios />
        </Router>
      </QueryClientProvider>,
    ),
  );
  await esperar(() => botao("Avisar um envio") !== null, "a lista de envios");
  await act(async () => botao("Avisar um envio")!.click());
  await esperar(() => botao("Enviar aviso") !== null, "o formulário do aviso");
  await digitar(document.querySelector<HTMLInputElement>('input[placeholder="Quem vai entregar"]'), "Malharia Sul");
  await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Código do item"]'), "A.01.0805.002.PP");
  await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Peças"]'), "50");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("o aviso de envio enviado de novo", () => {
  it("depois da resposta perdida, repete a chave e não sobe o anexo de novo", async () => {
    // A primeira nota vai para a leitura (e sobe ali); a segunda sobe no envio.
    await anexar([
      new File([new Uint8Array([37, 80, 68, 70])], "nota.pdf", { type: "application/pdf" }),
      new File([new Uint8Array([37, 80, 68, 70])], "romaneio.pdf", { type: "application/pdf" }),
    ]);
    await esperar(() => estado.anexos.length === 1, "a leitura da nota");

    const primeiro = await enviarAviso();
    const segundo = await enviarAviso();

    expect(typeof primeiro.idempotency_key).toBe("string");
    expect(segundo.idempotency_key).toBe(primeiro.idempotency_key);
    expect(segundo.attachments).toEqual(primeiro.attachments);
    expect(estado.anexos).toEqual(["nota.pdf", "romaneio.pdf"]);
  });

  it("\"1.200\" peças vão como mil e duzentas", async () => {
    await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Peças"]'), "1.200");
    const aviso = await enviarAviso();
    expect((aviso.items as Array<{ quantity: number }>)[0]?.quantity).toBe(1200);
  });
});
