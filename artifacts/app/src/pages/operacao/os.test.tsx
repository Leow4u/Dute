// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registrar andamento pelo escritório e tentar de novo: a ocorrência que já
 * gravou, com a resposta perdida, se repete igual (a callable devolve o
 * mesmo resultado pela chave). Antes, o instante era o do novo clique, e a
 * nova tentativa voltava recusada como outro conteúdo. E Cancelar vistoria
 * (pergunta 58): a coordenação cancela a vistoria em execução com o motivo.
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

// O envio ao Storage: a assinatura do celular já está lá e não sobe de novo.
const envios = vi.hoisted(() => ({ assinaturas: 0, fotos: 0 }));
vi.mock("@/lib/operacao/enviar-foto", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/enviar-foto")>()),
  enviarAssinatura: async () => {
    envios.assinaturas += 1;
  },
  enviarFoto: async () => {
    envios.fotos += 1;
  },
}));

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
  estado.os = {};
  estado.papel = "interno";
  envios.assinaturas = 0;
  envios.fotos = 0;
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

describe("cancelar a vistoria (pergunta 58)", () => {
  const botoes = () => [...container!.querySelectorAll("button")].map((botao) => botao.textContent?.trim());

  it("a coordenação cancela a vistoria em execução com o motivo; sem o motivo, a tela pede", async () => {
    estado.os = { tipo: "vistoria", servicos: ["vistoria"] };
    await act(async () => raiz!.render(<PaginaOs />));
    await clicar("Cancelar vistoria");
    // Com o painel aberto, Registrar andamento sai, e só o botão do painel cancela.
    expect(botoes()).not.toContain("Registrar andamento");
    expect(botoes().filter((texto) => texto === "Cancelar vistoria")).toHaveLength(1);

    await clicar("Cancelar vistoria");
    expect(container!.textContent).toContain("Informe o motivo do cancelamento.");
    expect(estado.chamadas).toEqual([]);

    await descrever("O local estava fechado; o cliente não recebeu a equipe.");
    await clicar("Cancelar vistoria");
    expect(estado.chamadas).toHaveLength(1);
    const [{ nome, dados }] = estado.chamadas;
    expect(nome).toBe("saveServiceOrder");
    expect(dados).toEqual({
      action: "cancel",
      idempotency_key: expect.any(String),
      numero: NUMERO,
      expected_edicao: 5,
      motivo: "O local estava fechado; o cliente não recebeu a equipe.",
    });
    // Gravou: o painel fechou.
    expect(container!.querySelector("textarea")).toBeNull();
  });

  it("Voltar fecha o painel sem gravar", async () => {
    estado.os = { tipo: "vistoria", servicos: ["vistoria"], status: "agendada" };
    await act(async () => raiz!.render(<PaginaOs />));
    await clicar("Cancelar vistoria");
    await clicar("Voltar");
    expect(container!.querySelector("textarea")).toBeNull();
    expect(estado.chamadas).toEqual([]);
  });

  it("a OS de serviço iniciada, a vistoria revisada e quem não coordena não veem Cancelar vistoria", async () => {
    await act(async () => raiz!.render(<PaginaOs />));
    expect(botoes()).not.toContain("Cancelar vistoria");

    estado.os = { tipo: "vistoria", servicos: ["vistoria"], status: "revisada" };
    await act(async () => raiz!.render(<PaginaOs key="revisada" />));
    expect(botoes()).not.toContain("Cancelar vistoria");

    estado.os = { tipo: "vistoria", servicos: ["vistoria"] };
    estado.papel = "financeiro";
    await act(async () => raiz!.render(<PaginaOs key="financeiro" />));
    expect(botoes()).not.toContain("Cancelar vistoria");
  });
});

describe("a conclusão recusada do campo (pergunta 66)", () => {
  const RECUSA = {
    chave: "c-celular",
    recusada_em: "2026-10-25T14:58:00.000Z",
    instante: "2026-10-25T14:52:00.000Z",
    informado_por: "col_cccccccccccccccc",
    registrado_por: { uid: "uid-carlos", role: "campo" },
    responsavel: { nome: "Renata Campos", cargo: "Facilities" },
    assinatura: `os/${NUMERO}/assinatura/as_0123456789abcdef.png`,
    motivo: "A OS já foi concluída.",
    anexada: null,
    dispensada: null,
  };
  const SEM_ACEITE = {
    instante: "2026-10-25T14:50:00.000Z",
    canal: "escritorio",
    meio: "telefone",
    informado_por: "col_cccccccccccccccc",
    aceite: "sem_aceite",
    responsavel: { nome: "Portaria" },
    assinatura: null,
    diferencas: [],
  };

  it("na OS concluída sem aceite, Anexar à conclusão e Dispensar chamam a callable com a chave da recusa", async () => {
    estado.os = { status: "em_revisao", conclusao: SEM_ACEITE, conclusao_recusada: RECUSA };
    await act(async () => raiz!.render(<PaginaOs />));
    expect(container!.textContent).toContain("Conclusão recusada do campo");
    await clicar("Anexar à conclusão");
    await clicar("Dispensar");
    expect(estado.chamadas).toEqual([
      { nome: "resolveFieldCompletion", dados: { idempotency_key: "recusa:anexar:2026-10-25T14:58:00.000Z", numero: NUMERO, acao: "anexar", recusada_em: "2026-10-25T14:58:00.000Z" } },
      { nome: "resolveFieldCompletion", dados: { idempotency_key: "recusa:dispensar:2026-10-25T14:58:00.000Z", numero: NUMERO, acao: "dispensar", recusada_em: "2026-10-25T14:58:00.000Z" } },
    ]);
  });

  it("na OS em execução, Concluir com estes dados abre a conclusão com a hora, quem concluiu, quem recebeu e a assinatura do celular, que não sobe de novo", async () => {
    estado.os = {
      conclusao_recusada: { ...RECUSA, motivo: "A hora vem antes de Saída do pátio (07:05)." },
      fotos: [{ id: "ft_0000000000000001", caminho: `os/${NUMERO}/fotos/ft_0000000000000001.jpg`, etapa: "fim", instante: "2026-10-25T14:40:00.000Z", canal: "celular" }],
    };
    await act(async () => raiz!.render(<PaginaOs />));
    expect([...container!.querySelectorAll("button")].map((botao) => botao.textContent?.trim())).not.toContain("Anexar à conclusão");
    await clicar("Concluir com estes dados");
    const campos = [...container!.querySelectorAll<HTMLInputElement>("input")];
    expect(campos.map((campo) => campo.value)).toEqual(expect.arrayContaining(["Renata Campos", "Facilities"]));
    expect(container!.textContent).toContain("Assinatura do celular");

    await clicar("Concluir OS");
    const conclusao = estado.chamadas.find((chamada) => chamada.nome === "completeServiceOrder");
    // A hora do celular (11:52 em São Paulo), não a do clique (12:00), e quem concluiu lá.
    expect(conclusao?.dados).toMatchObject({
      instante: "2026-10-25T11:52-03:00",
      informado_por: "col_cccccccccccccccc",
      aceite: "assinatura",
      responsavel: { nome: "Renata Campos", cargo: "Facilities" },
      assinatura: "as_0123456789abcdef.png",
    });
    expect(envios.assinaturas).toBe(0);
  });

  it("quem não coordena não vê as ações da recusa", async () => {
    estado.os = { status: "em_revisao", conclusao: SEM_ACEITE, conclusao_recusada: RECUSA };
    estado.papel = "financeiro";
    await act(async () => raiz!.render(<PaginaOs />));
    expect(container!.textContent).not.toContain("Conclusão recusada do campo");
  });
});
