// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registrar andamento pelo escritório e tentar de novo: a ocorrência que já
 * gravou, com a resposta perdida, se repete igual (a callable devolve o
 * mesmo resultado pela chave). Antes, o instante era o do novo clique, e a
 * nova tentativa voltava recusada como outro conteúdo.
 */

const NUMERO = "10211-01";

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  recibos: new Map<string, string>(),
  perderResposta: false,
}));

// A callable como o servidor: a mesma chave com outro conteúdo é recusada;
// com o mesmo, devolve o resultado gravado.
vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    const chave = String(dados.idempotency_key);
    const conteudo = JSON.stringify(dados);
    const anterior = estado.recibos.get(chave);
    if (anterior !== undefined && anterior !== conteudo) {
      throw Object.assign(new Error("A chave de idempotência já foi usada com outro conteúdo."), { code: "functions/already-exists" });
    }
    estado.recibos.set(chave, conteudo);
    if (estado.perderResposta) {
      estado.perderResposta = false;
      throw Object.assign(new Error("Sem conexão com o servidor."), { code: "functions/unavailable" });
    }
    return { ocorrencia: "ocr_0000000000000001" };
  },
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "coord-1", fullName: "Coordenação", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/lib/operacao/leitura", () => ({
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => {
    if (chave === `service_orders/${NUMERO}`) {
      return {
        item: mapear(NUMERO, {
          status: "em_execucao",
          edicao: 5,
          demanda: "10211",
          customer_code: "ITAU",
          cliente_nome: "Itaú Unibanco",
          servicos: ["transporte"],
          janela: { data: "2026-10-25", inicio: "07:30", fim: "18:00" },
          locais: { origem: { endereco: "Faria Lima 3500" }, destino: { endereco: "Torre B" } },
          equipe: [{ colaborador_id: "col_cccccccccccccccc", nome: "Carlos Silva", papel: "lider", vinculo: "proprio" }],
          itens: [],
          etapas: [{ etapa: "saida_patio", instante: "2026-10-25T10:05:00.000Z" }],
        }),
        erro: false,
      };
    }
    return { item: null, erro: false };
  },
  useLeitura: () => ({ itens: [], erro: false }),
}));

vi.mock("@/lib/operacao/use-urls-das-fotos", () => ({ useUrlsDasFotos: () => ({}) }));

import PaginaOs from "./os";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function clicar(texto: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!botao) throw new Error(`Sem o botão ${texto}`);
  await act(async () => botao.click());
}

async function descrever(texto: string) {
  const campo = container!.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
  window.history.replaceState({}, "", `/operacao/os?numero=${NUMERO}`);
  estado.chamadas = [];
  estado.recibos = new Map();
  estado.perderResposta = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.useRealTimers();
});

describe("tentar de novo o andamento", () => {
  it("a ocorrência que gravou com a resposta perdida se repete igual, e o painel fecha", async () => {
    await act(async () => raiz!.render(<PaginaOs />));
    await clicar("Registrar andamento");
    await clicar("Ocorrência");
    await descrever("Elevador parado no térreo");

    estado.perderResposta = true;
    await clicar("Registrar");
    expect(container!.textContent).toContain("Sem conexão com o servidor.");

    // A pessoa tenta de novo, segundos depois.
    vi.setSystemTime(new Date("2026-10-25T15:00:07.000Z"));
    await clicar("Registrar");
    const ocorrencias = estado.chamadas.filter((chamada) => chamada.nome === "registerOccurrence").map((chamada) => chamada.dados);
    expect(ocorrencias).toHaveLength(2);
    expect(ocorrencias[1]).toEqual(ocorrencias[0]);
    expect(container!.textContent).not.toContain("A chave de idempotência já foi usada com outro conteúdo.");
    // Gravou: o painel fechou e o botão voltou.
    expect([...container!.querySelectorAll("button")].some((botao) => botao.textContent?.trim() === "Registrar andamento")).toBe(true);
  });
});
