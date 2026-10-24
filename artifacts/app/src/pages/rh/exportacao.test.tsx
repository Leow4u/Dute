// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A exportação do RH com as callables de mentira (parte 8.3): a nova
 * tentativa depois da falha leva a mesma chave (se a primeira gravou, o
 * servidor repete o resultado); a geração que deu certo e a troca da
 * competência pedem chave nova; a lista é lida de novo depois de gerar; o
 * download baixa a planilha que o servidor montou.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  leiturasDaLista: 0,
  chaves: 0,
  falhar: false,
  baixados: [] as Array<{ nome: string; conteudo: string }>,
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  RH_LIBERADO: true,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "rh-1", fullName: "Pessoa rh", publicMetadata: { role: "rh" } }, isLoaded: true }),
}));

vi.mock("@/lib/rh/exportacao", async (original) => ({
  ...(await original<typeof import("@/lib/rh/exportacao")>()),
  diaEmSaoPaulo: () => "2026-10-24",
}));

vi.mock("@/lib/comercial/diario", () => ({
  baixarCsv: (nome: string, conteudo: string) => estado.baixados.push({ nome, conteudo }),
}));

vi.mock("@/lib/rh/api", () => ({
  novaChave: () => {
    estado.chaves += 1;
    return `k-${estado.chaves}`;
  },
  chamarRh: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    if (nome === "listRhExports") {
      estado.leiturasDaLista += 1;
      return {
        exportacoes: [
          { id: "exp_2026-09_v1", competencia: "2026-09", versao: 1, exames: 1, colaboradores: 4, gerada_em: "2026-10-05T12:00:00.000Z", gerada_por: "Pessoa rh" },
        ],
      };
    }
    if (nome === "exportRhMonth") {
      if (estado.falhar) throw new Error("Falha interna no servidor. Tente novamente ou avise o time técnico.");
      return { id: "exp_2026-09_v2", versao: 2, nova: true };
    }
    return { nome: "dute-rh-exames-2026-09-v1.csv", conteudo: "﻿Nome;CPF\r\n" };
  },
}));

import RhExportacao from "./exportacao";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.leiturasDaLista = 0;
  estado.chaves = 0;
  estado.falhar = false;
  estado.baixados.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
});

async function esperar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <RhExportacao />
      </QueryClientProvider>,
    );
  });
  await esperar();
}

async function clicar(rotulo: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent === rotulo);
  if (!botao) throw new Error(`Botão "${rotulo}" não encontrado.`);
  await act(async () => {
    botao.click();
  });
  await esperar();
}

async function mudarCompetencia(valor: string) {
  const campo = container!.querySelector<HTMLInputElement>('input[type="month"]')!;
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    definir.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

function geracoes() {
  return estado.chamadas.filter((chamada) => chamada.nome === "exportRhMonth").map((chamada) => [chamada.dados.idempotency_key, chamada.dados.competencia]);
}

describe("a exportação do RH com as callables", () => {
  it("abre na competência anterior; a falha mantém a chave, o sucesso troca e relê a lista", async () => {
    await montar();
    expect(container!.querySelector<HTMLInputElement>('input[type="month"]')!.value).toBe("2026-09");
    expect(estado.leiturasDaLista).toBe(1);

    estado.falhar = true;
    await clicar("Gerar exportação");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Falha interna");

    estado.falhar = false;
    await clicar("Gerar exportação");
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Setembro de 2026: versão 2 gerada");
    await clicar("Gerar exportação");
    expect(geracoes()).toEqual([
      ["k-1", "2026-09"],
      ["k-1", "2026-09"],
      ["k-2", "2026-09"],
    ]);
    expect(estado.leiturasDaLista).toBeGreaterThanOrEqual(3);
  });

  it("trocar a competência pede chave nova", async () => {
    await montar();
    await mudarCompetencia("2026-08");
    await clicar("Gerar exportação");
    expect(geracoes()).toEqual([["k-2", "2026-08"]]);
  });

  it("baixar pede a planilha da versão ao servidor e baixa o que ele montou", async () => {
    await montar();
    await clicar("Baixar exames");
    expect(estado.chamadas.filter((chamada) => chamada.nome === "downloadRhExport").map((chamada) => chamada.dados)).toEqual([{ id: "exp_2026-09_v1", arquivo: "exames" }]);
    expect(estado.baixados).toEqual([{ nome: "dute-rh-exames-2026-09-v1.csv", conteudo: "﻿Nome;CPF\r\n" }]);
  });
});
