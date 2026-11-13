// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * As fotos anexadas à OS (carregamento v2, parte 11): a que falha é dita uma
 * vez, pelo Anunciador ("1 foto não enviada"), com o motivo na tela, e não
 * também por um role="alert"; o motivo sai quando o "Tentar de novo" ou a
 * escolha nova começa. O "Anexar" fica ocupado sem `disabled` enquanto as
 * fotos sobem. Dados sintéticos; o Storage e a callable são simulados.
 */

const NUMERO = "10211-01";

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  recibos: new Map<string, string>(),
  perderResposta: false,
  /** O que muda na OS lida (a vistoria, o status). */
  os: {} as Record<string, unknown>,
  papel: "interno",
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
  useAppUser: () => ({ user: { uid: "coord-1", fullName: "Coordenação", publicMetadata: { role: estado.papel } }, isLoaded: true }),
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
          ...estado.os,
        }),
        erro: false,
      };
    }
    return { item: null, erro: false };
  },
  useLeitura: () => ({ itens: [], erro: false }),
}));

vi.mock("@/lib/operacao/use-urls-das-fotos", () => ({ useUrlsDasFotos: () => ({}) }));

// O envio ao Storage: a primeira foto falha; a segunda tentativa espera o teste soltar.
const envios = vi.hoisted(() => ({ assinaturas: 0, fotos: 0, soltar: null as null | (() => void) }));
vi.mock("@/lib/operacao/enviar-foto", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/enviar-foto")>()),
  enviarAssinatura: async () => {
    envios.assinaturas += 1;
  },
  enviarFoto: async () => {
    envios.fotos += 1;
    if (envios.fotos === 1) throw Object.assign(new Error("O arquivo não chegou ao servidor."), { code: "storage/retry-limit-exceeded" });
    await new Promise<void>((resolver) => {
      envios.soltar = resolver;
    });
  },
}));

import PaginaOs from "@/pages/operacao/os";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const falado: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
  window.history.replaceState({}, "", `/operacao/os?numero=${NUMERO}`);
  envios.fotos = 0;
  envios.soltar = null;
  falado.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});
afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  vi.useRealTimers();
});

async function esperar(cond: () => boolean, oque: string) {
  for (let i = 0; i < 300; i += 1) {
    if (cond()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error(`não aconteceu: ${oque}`);
}

describe("a foto da OS que falha", () => {
  it("é dita uma vez, pelo Anunciador, com o motivo na tela; o \"Tentar de novo\" tira o motivo, e o Anexar fica ocupado sem disabled", async () => {
    await act(async () => raiz!.render(<><Anunciador /><PaginaOs /></>));
    const obs = new MutationObserver(() => {
      const t = document.querySelector("[data-anunciador]")?.textContent?.trim();
      if (t && falado.at(-1) !== t) falado.push(t);
    });
    obs.observe(container!, { subtree: true, childList: true, characterData: true });
    const entrada = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const foto = new File(["x"], "obra.jpg", { type: "image/jpeg", lastModified: Date.parse("2026-10-25T12:00:00Z") });
    Object.defineProperty(entrada, "files", { value: [foto], configurable: true });
    await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar(() => /Foto 1 não enviada/.test(container!.textContent ?? ""), "a foto não enviada");
    await esperar(() => falado.includes("1 foto não enviada"), "o fim no Anunciador");
    // Uma região viva só: o Anunciador. O motivo fica na tela, sem alerta.
    expect(container!.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container!.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(container!.textContent).toContain("O arquivo não chegou ao servidor.");
    const tentar = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Tentar de novo")!;
    await act(async () => tentar.click());
    await esperar(() => envios.fotos === 2, "a segunda tentativa");
    // Subindo de novo: o motivo velho sai, e o Anexar fica ocupado, sem disabled.
    expect(container!.textContent).not.toContain("O arquivo não chegou ao servidor.");
    expect(entrada.hasAttribute("disabled")).toBe(false);
    expect(entrada.getAttribute("aria-disabled")).toBe("true");
    const clique = new MouseEvent("click", { bubbles: true, cancelable: true });
    entrada.dispatchEvent(clique);
    expect(clique.defaultPrevented).toBe(true);
    await act(async () => envios.soltar?.());
    await esperar(() => /1 foto enviada/.test(container!.textContent ?? ""), "a foto enviada");
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(await violacoesDeAcessibilidade(container!.querySelector("[data-fotos-enviando]")!.outerHTML)).toEqual([]);
    obs.disconnect();
  });
});
