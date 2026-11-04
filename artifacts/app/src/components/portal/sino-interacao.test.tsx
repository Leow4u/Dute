// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

const estado = vi.hoisted(() => ({
  documentos: [] as Array<Record<string, unknown>>,
  marcar: vi.fn(async () => ({ lidos_ate: "2026-11-04T12:00:00.000Z" })),
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid_cliente", publicMetadata: { role: "cliente", customer_code: "ITAU" } } }),
}));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: (_chave: string, _consulta: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => ({
    itens: estado.documentos.map((dados, indice) => mapear(`ntf_${indice}`, dados)).filter(Boolean), erro: false,
  }),
  useDocumento: () => ({ item: null, erro: false }),
}));
vi.mock("@/lib/operacao/api", () => ({ chamarOperacao: estado.marcar }));
vi.mock("@/lib/somente-armazenagem", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/somente-armazenagem")>(), SOMENTE_ARMAZENAGEM: true,
}));

import { SinoDoPortal } from "./sino";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let raiz: Root;
let container: HTMLDivElement;

beforeEach(() => {
  estado.documentos = [];
  estado.marcar.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  container.remove();
});

async function montar() {
  await act(async () => raiz.render(<Router ssrPath="/portal"><SinoDoPortal /></Router>));
}

describe("o sino no portal de armazenagem", () => {
  it("conta e mostra apenas avisos visíveis e marca a leitura pela callable existente", async () => {
    estado.documentos = [
      { modelo: "os_concluida", titulo: "OS concluída", link: "/portal/servicos?os=10050-01" },
      { modelo: "pedido_do_portal", titulo: "Solicitação recebida", link: "/portal/servicos" },
      { modelo: "estoque_disponivel", titulo: "Produtos disponíveis em estoque", link: "/portal/estoque" },
      { modelo: "estoque_parado", titulo: "Itens parados", link: "/portal/estoque" },
      { modelo: "nf_emitida", titulo: "NF emitida", link: "/portal/faturas" },
      { modelo: "estoque_disponivel", titulo: "Link de serviço pausado", link: "/portal/servicos/comprovante?os=10050-01" },
    ];
    await montar();
    const botao = container.querySelector("button")!;
    expect(botao.getAttribute("aria-label")).toBe("Avisos: 3 novos");
    expect(estado.marcar).not.toHaveBeenCalled();
    await act(async () => botao.click());
    const links = [...document.querySelectorAll('[role="dialog"] li a')];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/portal/estoque", "/portal/estoque", "/portal/faturas"]);
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Produtos disponíveis em estoque"), expect.stringContaining("Itens parados"), expect.stringContaining("NF emitida"),
    ]);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(/OS concluída|Solicitação recebida|Link de serviço pausado/);
    expect(estado.marcar).toHaveBeenCalledExactlyOnceWith("markNotificationsRead", {});
  });

  it("avisos ocultos não acendem o contador nem provocam gravação de leitura", async () => {
    estado.documentos = [{ modelo: "os_agendada", titulo: "OS agendada", link: "/portal/servicos?os=10050-01" }];
    await montar();
    const botao = container.querySelector("button")!;
    expect(botao.getAttribute("aria-label")).toBe("Avisos");
    await act(async () => botao.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Nenhum aviso.");
    expect(estado.marcar).not.toHaveBeenCalled();
  });
});
