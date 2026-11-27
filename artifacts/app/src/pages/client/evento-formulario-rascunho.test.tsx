// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import type { EventoView, PrecoDaEdicao } from "@/lib/eventos/leitura";
import type { EdicaoView, ResultadoDoSalvar } from "@/lib/eventos/tipos";
import { edicao as edicaoDeTeste, edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";

/**
 * O rascunho da edição no portal (spec, "As telas › Portal"; Review Focus da
 * parte 4): o nascimento pelo nome, a mesma chave na tentativa sem resposta,
 * o salvamento automático de um segundo, a recusa no campo, o conflito com
 * outra aba, a hora da entrega no local, a falta de saldo e o envio. Relógio
 * falso; as callables e as leituras ao vivo simuladas. Dados sintéticos.
 */

type Chamada<T> = { entrada: Record<string, unknown>; resolver: (resultado: T) => void; rejeitar: (erro: unknown) => void };

const estado = vi.hoisted(() => ({
  salvar: [] as Array<Chamada<unknown>>,
  enviar: [] as Array<Chamada<unknown>>,
  toasts: [] as Array<Record<string, unknown>>,
  viva: new Map<string, unknown>(),
  eventos: [] as unknown[],
  precos: [] as unknown[],
  overview: {} as Record<string, unknown>,
  versao: 0,
  ouvintes: new Set<() => void>(),
}));

vi.mock("@/lib/wms/eventos", () => ({
  salvarEdicao: (entrada: Record<string, unknown>) => new Promise((resolver, rejeitar) => estado.salvar.push({ entrada, resolver, rejeitar })),
  enviarEdicao: (entrada: Record<string, unknown>) => new Promise((resolver, rejeitar) => estado.enviar.push({ entrada, resolver, rejeitar })),
  cancelarEdicao: () => new Promise(() => undefined),
}));

vi.mock("@/lib/eventos/use-eventos", async () => {
  const { useSyncExternalStore } = await import("react");
  const ouvir = () =>
    useSyncExternalStore(
      (ouvinte) => {
        estado.ouvintes.add(ouvinte);
        return () => estado.ouvintes.delete(ouvinte);
      },
      () => estado.versao,
    );
  const aoVivo = { erro: false, tentando: false, tentar: () => undefined, falta: null, lidaEm: null };
  return {
    useEdicaoDoEvento: (id: string | null) => {
      ouvir();
      return { ...aoVivo, edicao: id ? estado.viva.get(id) : undefined };
    },
    useEventosDoCliente: () => {
      ouvir();
      return { ...aoVivo, itens: estado.eventos };
    },
    usePrecosDoCliente: () => {
      ouvir();
      return { ...aoVivo, itens: estado.precos };
    },
    useEdicoesDoCliente: () => {
      ouvir();
      return { ...aoVivo, itens: [] };
    },
  };
});

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { customer_code: "BTG", role: "cliente" } }, isLoaded: true }) }));
vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: { modules: ["wms"] } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: Record<string, unknown>) => estado.toasts.push(aviso) }) }));
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...original,
    ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => {
      useSyncExternalStore(
        (ouvinte) => {
          estado.ouvintes.add(ouvinte);
          return () => estado.ouvintes.delete(ouvinte);
        },
        () => estado.versao,
      );
      return <>{children(estado.overview)}</>;
    },
  };
});

import { ClienteEventoEdicao, ClienteEventoNovo } from "./evento-formulario";

const NECTON = edicaoDaNecton();
const CAPA: EventoView = {
  id: NECTON.event_id,
  customer_code: "BTG",
  name: "B2B Conference Necton",
  description: "Lounge, balcão de recepção e brindes da conferência B2B da Necton",
  status: "active",
  editions_count: 1,
  last_edition_id: NECTON.id,
  last_edition_label: "2027",
};
const PRECO: PrecoDaEdicao = { id: NECTON.id, valor_declarado_cents: 10_000_000, fechado_cents: null };

/** O overview do portal com os produtos da Necton (o saldo livre e o valor de cada SKU). */
function overviewCom(disponivel: (sku: string, livre: number) => number = (_sku, livre) => livre) {
  return {
    inventory: {
      items: produtosDaNecton().map((produto, indice) => ({
        sku_code: produto.sku,
        client_item_code: produto.clientItemCode,
        product_name: NECTON.itens[indice].product_name,
        category: NECTON.itens[indice].category,
        qty_available: disponivel(produto.sku, produto.available),
        qty_on_hand: produto.total,
        total_value: produto.value,
      })),
    },
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let memoria: ReturnType<typeof memoryLocation>;

async function abrir(caminho: string) {
  memoria = memoryLocation({ path: caminho, record: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <Router hook={memoria.hook} searchHook={memoria.searchHook}>
        <Switch>
          <Route path="/portal/eventos/novo" component={ClienteEventoNovo} />
          <Route path="/portal/eventos/edicao" component={ClienteEventoEdicao} />
          <Route path="/portal/eventos">
            <p>Lista dos eventos</p>
          </Route>
        </Switch>
      </Router>,
    ),
  );
}

const abrirANecton = () => abrir(`/portal/eventos/edicao?id=${NECTON.id}`);

function servidor(mudanca: () => void) {
  act(() => {
    mudanca();
    estado.versao += 1;
    for (const ouvinte of [...estado.ouvintes]) ouvinte();
  });
}

const campo = (seletor: string) => {
  const achado = container!.querySelector<HTMLInputElement>(seletor);
  if (!achado) throw new Error(`Sem o campo ${seletor}`);
  return achado;
};

async function digitar(seletor: string, valor: string) {
  const alvo = campo(seletor);
  await act(async () => {
    const prototipo = alvo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(alvo, valor);
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function sair(seletor: string) {
  await act(async () => {
    campo(seletor).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function responder<T>(chamada: Chamada<T> | undefined, resultado: T) {
  if (!chamada) throw new Error("Sem a chamada");
  await act(async () => chamada.resolver(resultado));
}

async function recusar(chamada: Chamada<unknown> | undefined, code: string, message: string) {
  if (!chamada) throw new Error("Sem a chamada");
  await act(async () => chamada.rejeitar(Object.assign(new Error(message), { code })));
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado;
}

async function clicar(rotulo: string) {
  await act(async () => botao(rotulo).click());
}

function salvo(edicao: EdicaoView, extra: Partial<EdicaoView> = {}): ResultadoDoSalvar {
  const edition = { ...edicao, ...extra };
  return { id: edition.id, edicao: edition.edicao, created: false, edition };
}

const ultimoPatch = () => estado.salvar.at(-1)!.entrada as { id: string; expected_edicao: number; patch: Record<string, unknown> };
const textoDe = (seletor: string) => container!.querySelector(seletor)?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.salvar = [];
  estado.enviar = [];
  estado.toasts = [];
  estado.viva = new Map([[NECTON.id, NECTON]]);
  estado.eventos = [CAPA];
  estado.precos = [PRECO];
  estado.overview = overviewCom();
  estado.versao = 0;
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  estado.ouvintes.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o nascimento", () => {
  it("nasce ao sair do nome: salvarEdicao com idempotency_key e name, e a rota vira edicao?id= sem entrada no histórico", async () => {
    estado.viva = new Map();
    await abrir("/portal/eventos/novo");
    await digitar("#evento-nome", "B2B Conference Necton");
    await avancar(2_000);
    expect(estado.salvar).toHaveLength(0);
    await sair("#evento-nome");
    expect(estado.salvar).toHaveLength(1);
    const criacao = estado.salvar[0].entrada as Record<string, unknown>;
    expect(criacao).toMatchObject({ name: "B2B Conference Necton", description: null });
    expect(typeof criacao.idempotency_key).toBe("string");
    expect("id" in criacao).toBe(false);
    const nascida = edicaoDeTeste({ id: NECTON.id, event_id: NECTON.event_id, event_name: "B2B Conference Necton", edicao: 1 });
    await responder(estado.salvar[0], { id: nascida.id, edicao: 1, created: true, edition: nascida });
    expect(memoria.history).toEqual([`/portal/eventos/edicao?id=${NECTON.id}`]);
    expect(campo("#evento-nome").value).toBe("B2B Conference Necton");
    expect(estado.salvar).toHaveLength(1);
    // Depois do nascimento, a mudança grava pelo patch, com a versão da criação.
    await digitar("#evento-local", "Hotel Unique");
    await avancar(1_000);
    expect(ultimoPatch()).toMatchObject({ id: NECTON.id, expected_edicao: 1, patch: { onde: { local: "Hotel Unique" } } });
  });

  it("a mesma chave repete na tentativa sem resposta; created: false não cria segunda rota", async () => {
    estado.viva = new Map();
    await abrir("/portal/eventos/novo");
    await digitar("#evento-nome", "Feira de Investimentos");
    await sair("#evento-nome");
    await recusar(estado.salvar[0], "unavailable", "Sem conexão.");
    expect(estado.toasts.at(-1)).toMatchObject({ title: "Rascunho não salvo" });
    expect(memoria.history).toEqual(["/portal/eventos/novo"]);
    await sair("#evento-nome");
    expect(estado.salvar).toHaveLength(2);
    expect((estado.salvar[1].entrada as { idempotency_key: string }).idempotency_key).toBe((estado.salvar[0].entrada as { idempotency_key: string }).idempotency_key);
    const ja = edicaoDeTeste({ id: "ced_00000000000000c9", event_name: "Feira de Investimentos", edicao: 2 });
    await responder(estado.salvar[1], { id: ja.id, edicao: 2, created: false, edition: ja });
    expect(memoria.history).toEqual([`/portal/eventos/edicao?id=${ja.id}`]);
    // A criação repetida pode ter achado outra coisa no servidor: o patch seguinte leva o formulário inteiro.
    await avancar(0);
    expect(ultimoPatch()).toMatchObject({ id: ja.id, expected_edicao: 2, patch: { evento: { name: "Feira de Investimentos" } } });
    expect(estado.salvar).toHaveLength(3);
  });
});

describe("o salvamento automático", () => {
  it("a mudança no local grava aos 1 000 ms com expected_edicao, sem o evento, o valor e os itens que não mudaram, e duas mudanças em 600 ms gravam uma vez", async () => {
    await abrirANecton();
    expect(campo("#coleta-valor").value).toBe("R$ 100.000,00");
    await digitar("#evento-local", "Hotel Unique Jardins");
    await avancar(600);
    await digitar("#evento-local", "Hotel Unique Jardins SP");
    await avancar(600);
    expect(estado.salvar).toHaveLength(0);
    await avancar(400);
    expect(estado.salvar).toHaveLength(1);
    const { id, expected_edicao, patch } = ultimoPatch();
    expect({ id, expected_edicao }).toEqual({ id: NECTON.id, expected_edicao: 3 });
    expect(patch.onde).toMatchObject({ local: "Hotel Unique Jardins SP" });
    expect(patch.coleta).toEqual({ onde: "BTG Pactual · Av. Brigadeiro Faria Lima, 3477", quantidade: 2190 });
    expect("itens" in patch).toBe(false);
    expect("evento" in patch).toBe(false);
    await responder(estado.salvar[0], salvo(NECTON, { edicao: 4 }));
    expect(textoDe("header")).toMatch(/Salvo \d{2}:\d{2}/);
    await digitar("#evento-endereco", "Av. Brigadeiro Luís Antônio, 4700 · Jardim Paulista");
    await avancar(1_000);
    expect(ultimoPatch().expected_edicao).toBe(4);
  });

  it("'A edição mudou em outra aba' refaz o formulário com o documento vivo e mostra a frase", async () => {
    await abrirANecton();
    await digitar("#evento-local", "Texto da aba velha");
    await avancar(1_000);
    await recusar(estado.salvar[0], "failed-precondition", "A edição mudou em outra aba");
    expect(estado.toasts.at(-1)).toMatchObject({ title: "A edição mudou em outra aba" });
    servidor(() => estado.viva.set(NECTON.id, { ...NECTON, edicao: 5, onde: { ...NECTON.onde, local: "Hotel Unique (outra aba)" } }));
    expect(campo("#evento-local").value).toBe("Hotel Unique (outra aba)");
    await avancar(2_000);
    expect(estado.salvar).toHaveLength(1);
    await digitar("#evento-telefone", "11 99999-0000");
    await avancar(1_000);
    expect(ultimoPatch()).toMatchObject({ expected_edicao: 5, patch: { onde: { local: "Hotel Unique (outra aba)", contato: { telefone: "11 99999-0000" } } } });
  });

  it("'A observação de Montagem passa de 300 caracteres' aparece sob o cronograma, sem o toast", async () => {
    await abrirANecton();
    await digitar('[aria-label="Observação da montagem"]', "x".repeat(301));
    await avancar(1_000);
    await recusar(estado.salvar[0], "invalid-argument", "A observação de Montagem passa de 300 caracteres");
    expect(textoDe("#evento-cronograma-problema")).toBe("A observação de Montagem passa de 300 caracteres");
    expect(estado.toasts).toEqual([]);
  });

  it("apagar a data da Montagem que tem um documento da Dutelog ligado: a frase sob o cronograma, sem o toast; a data volta do documento vivo e a gravação seguinte leva a Montagem pelo id", async () => {
    const comDocumento: EdicaoView = {
      ...NECTON,
      documentos: [
        { id: "dc_0000000000000001", caminho: "eventos/BTG/x/docs/dc_0000000000000001.pdf", nome: "montagem.pdf", tipo: "application/pdf", tamanho: 1000, origem: "dutelog", momento_id: "mo_00000003", registrado_por: null, registrado_em: null },
      ],
    };
    estado.viva.set(NECTON.id, comDocumento);
    await abrirANecton();
    await digitar('[aria-label="Data da montagem"]', "");
    await avancar(1_000);
    expect((ultimoPatch().patch.cronograma as Array<{ tipo: string }>).some((momento) => momento.tipo === "montagem")).toBe(false);
    await recusar(estado.salvar[0], "failed-precondition", "Montagem já tem registro e não sai do cronograma");
    expect(textoDe("#evento-cronograma-problema")).toBe("Montagem já tem registro e não sai do cronograma");
    expect(estado.toasts).toEqual([]);
    expect(campo('[aria-label="Data da montagem"]').value).toBe("2027-01-28");
    await digitar("#evento-local", "Hotel Unique Jardins");
    await avancar(1_000);
    expect((ultimoPatch().patch.cronograma as Array<{ id?: string; tipo: string }>).find((momento) => momento.tipo === "montagem")).toMatchObject({ id: "mo_00000003", data: "2027-01-28" });
  });

  it("a entrega no local só com o dia grava: aos 1 000 ms o patch.cronograma leva a entrega com hora: null, 'Salvo HH:MM' aparece e nenhuma frase fica sob o cronograma", async () => {
    await abrirANecton();
    await digitar('[aria-label="Hora da entrega no local"]', "");
    await avancar(1_000);
    expect((ultimoPatch().patch.cronograma as Array<{ tipo: string }>).find((momento) => momento.tipo === "entrega_no_local")).toMatchObject({ id: "mo_00000002", data: "2027-01-28", hora: null });
    await responder(estado.salvar[0], salvo(NECTON, { edicao: 4 }));
    expect(textoDe("header")).toMatch(/Salvo \d{2}:\d{2}/);
    expect(container!.querySelector("#evento-cronograma-problema")).toBeNull();
  });
});

describe("o envio", () => {
  it("Enviar sem a data do evento mostra 'Informe a data do evento' e não chama enviarEdicao; com tudo, grava o que espera, chama e volta à lista", async () => {
    await abrirANecton();
    await digitar('[aria-label="Data do evento"]', "");
    await clicar("Enviar para a Dutelog");
    expect(textoDe("#evento-cronograma-problema")).toBe("Informe a data do evento");
    expect(estado.enviar).toHaveLength(0);
    await digitar('[aria-label="Data do evento"]', "2027-01-29");
    expect(container!.querySelector("#evento-cronograma-problema")).toBeNull();
    await clicar("Enviar para a Dutelog");
    expect(estado.salvar).toHaveLength(1);
    await responder(estado.salvar[0], salvo(NECTON, { edicao: 4 }));
    expect(estado.enviar).toHaveLength(1);
    expect(estado.enviar[0].entrada).toMatchObject({ id: NECTON.id, expected_edicao: 4 });
    expect(typeof estado.enviar[0].entrada.idempotency_key).toBe("string");
    await responder(estado.enviar[0], { id: NECTON.id, status: "enviado", request_id: null, edition: { ...NECTON, status: "enviado", edicao: 5 } });
    expect(memoria.history.at(-1)).toBe("/portal/eventos");
    expect(estado.toasts.at(-1)).toMatchObject({ title: "Edição enviada à Dutelog" });
  });

  it("Enviar com a entrega no local só com o dia mostra 'Informe a data e a hora da entrega no local' sob o cronograma e não chama enviarEdicao, na edição com itens e na edição só com coleta", async () => {
    estado.viva.set(NECTON.id, { ...NECTON, cronograma: NECTON.cronograma.map((momento) => (momento.tipo === "entrega_no_local" ? { ...momento, previsto: { ...momento.previsto, hora: null } } : momento)) });
    await abrirANecton();
    await clicar("Enviar para a Dutelog");
    expect(textoDe("#evento-cronograma-problema")).toBe("Informe a data e a hora da entrega no local");
    expect(estado.enviar).toHaveLength(0);
    act(() => raiz?.unmount());
    container?.remove();

    estado.viva.set(NECTON.id, { ...(estado.viva.get(NECTON.id) as EdicaoView), itens: [] });
    await abrirANecton();
    await clicar("Enviar para a Dutelog");
    expect(textoDe("#evento-cronograma-problema")).toBe("Informe a data e a hora da entrega no local");
    expect(estado.enviar).toHaveLength(0);
  });

  it("com o GG acima do disponível, 'Falta saldo em 1 item: …' aparece sob 'O que vai · do estoque Dutelog'; Enviar põe a frase em itens e não chama enviarEdicao; o 'Saldo insuficiente para o SKU …' do servidor cai no mesmo campo", async () => {
    const gg = NECTON.itens[3].sku_code;
    estado.overview = overviewCom((sku, livre) => (sku === gg ? 60 : livre));
    await abrirANecton();
    const falta = "Falta saldo em 1 item: Polo Masculino Piquet Arpoador · GG (no evento 80, disponível 60)";
    expect(container!.textContent).toContain(falta);
    await clicar("Enviar para a Dutelog");
    expect(textoDe("#evento-itens-problema")).toBe(falta);
    expect(container!.textContent!.split(falta)).toHaveLength(2);
    expect(estado.enviar).toHaveLength(0);
    servidor(() => {
      estado.overview = overviewCom();
    });
    expect(container!.querySelector("#evento-itens-problema")).toBeNull();
    // O segundo toque logo depois do primeiro é o toque duplo, que o botão trava: a pessoa volta depois.
    await avancar(1_000);
    await clicar("Enviar para a Dutelog");
    expect(estado.enviar).toHaveLength(1);
    await recusar(estado.enviar[0], "failed-precondition", `Saldo insuficiente para o SKU ${gg}. Disponível: 60; solicitado: 80.`);
    expect(textoDe("#evento-itens-problema")).toBe(`Saldo insuficiente para o SKU ${gg}. Disponível: 60; solicitado: 80.`);
  });
});

describe("o nome e a descrição da capa", () => {
  it("mudar a Descrição depois do nascimento grava patch.evento só com a description, sem name; a mudança seguinte, no local, grava sem evento; com a capa renomeada noutra edição aberta do mesmo evento depois da adoção, a Descrição mudada grava ainda sem name, e a renomeação não se desfaz", async () => {
    await abrirANecton();
    await digitar("#evento-descricao", "Lounge e brindes");
    await avancar(1_000);
    expect(ultimoPatch().patch.evento).toEqual({ description: "Lounge e brindes" });
    await responder(estado.salvar[0], salvo(NECTON, { edicao: 4 }));
    await digitar("#evento-local", "Hotel Unique Jardins");
    await avancar(1_000);
    expect("evento" in ultimoPatch().patch).toBe(false);
    await responder(estado.salvar[1], salvo(NECTON, { edicao: 5 }));
    servidor(() => {
      estado.eventos = [{ ...CAPA, name: "B2B Necton 2027", description: "Lounge e brindes" }];
    });
    await digitar("#evento-descricao", "Lounge, balcão e brindes");
    await avancar(1_000);
    expect(ultimoPatch().patch.evento).toEqual({ description: "Lounge, balcão e brindes" });
  });
});
