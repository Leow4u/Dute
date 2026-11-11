// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULO_ROTULO } from "@workspace/dominio";

/**
 * Configuração › Pessoas e acessos na v3 (docs/mockups/ConfigPessoas*.dc.html,
 * avaliadas em 11/11/2026): a equipe com a situação (Arquivados é uma delas)
 * e o perfil; os clientes num índice que leva à página de cada um; a busca
 * na equipe e nos clientes, dizendo onde a pessoa está; o convite da equipe
 * com os módulos de cada perfil. Os textos de cada tela estão listados (a
 * trava contra legenda) e o axe roda sobre cada uma.
 *
 * O convite de cliente só sai com o cliente escolhido: o que vem do
 * "Convidar" de Configurações › Clientes ou o que a pessoa escolhe. Antes,
 * sem escolha, ia o primeiro da lista, ou a BTG enquanto a lista carregava ou
 * quando ela falhava, e quem recebia o link entrava no portal de um cliente
 * que ninguém tinha escolhido.
 */

const estado = vi.hoisted(() => ({
  convites: [] as Array<Record<string, unknown>>,
  notificacoes: [] as Array<{ title: string; description?: string }>,
  linkCopiado: "",
  convitesPendentes: [] as Array<Record<string, unknown>>,
  usuariosAtivos: [] as Array<Record<string, unknown>>,
  reenvios: [] as string[],
  remocoes: [] as string[],
  remocaoFalha: false,
  reenvioFalha: false,
  criacaoFalha: false,
  chavesReenvio: [] as string[],
  copiaFalha: false,
  clientesFalham: false,
  usuariosFalham: false,
}));

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useListBillingUsers: () =>
      useQuery({
        queryKey: ["billing-users"],
        queryFn: async () => {
          if (estado.usuariosFalham) throw new Error("Falhou.");
          return { items: estado.usuariosAtivos };
        },
        refetchOnWindowFocus: false,
      }),
    getListBillingUsersQueryKey: () => ["billing-users"],
    useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({
    user: { uid: "owner-a", publicMetadata: { role: "owner" } },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/firebase", () => ({ firestore: {} }));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  getDocs: async () => ({
    docs: estado.convitesPendentes.map((item) => ({
      id: item.id,
      data: () => item,
    })),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (mensagem: { title: string; description?: string }) =>
      estado.notificacoes.push(mensagem),
  }),
}));

import Users from "./users";
import { ROLE_INFO } from "@/lib/access";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
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

const criar = () =>
  document.querySelector<HTMLButtonElement>(
    'button[type="submit"][form="invite-form"]',
  );

async function digitar(id: string, valor: string) {
  const campo = document.querySelector<HTMLInputElement>(`input#${id}`);
  if (!campo) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function abrirOConvite(busca: string) {
  await abrirPessoas(busca);
  await esperar(() => criar() !== null, "o formulário do convite");
  await digitar("invite-nome", "Paula Souza");
  await digitar("invite-email", "paula@itau.com.br");
  // A lista de clientes chegou (ou falhou).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function abrirPessoas(busca = "") {
  window.history.replaceState({}, "", `/configuracoes/pessoas${busca}`);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <Users />
      </QueryClientProvider>,
    ),
  );
}

async function abrirAcoes(nome: string) {
  await esperar(
    () => document.querySelector(`[aria-label="Ações de ${nome}"]`) !== null,
    `as ações de ${nome}`,
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(`[aria-label="Ações de ${nome}"]`)!
      .dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
  });
  await esperar(
    () => document.querySelector('[role="menu"]') !== null,
    "o menu da pessoa",
  );
}

function itemDoMenu(texto: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === texto,
  );
}

async function confirmarReenvio() {
  await esperar(
    () => document.querySelector('[role="dialog"]') !== null,
    "a confirmação do destinatário",
  );
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((item) => item.textContent === "Reenviar convite");
  await act(async () => button!.click());
}

function botao(texto: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === texto,
  );
}

function rotulado(rotulo: string) {
  return document.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`);
}

async function tentarCriar() {
  await act(async () => {
    criar()!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    document
      .querySelector<HTMLFormElement>("form#invite-form")
      ?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function aba(nome: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (item) => item.textContent!.startsWith(nome),
  );
  expect(tab, `aba ${nome}`).toBeDefined();
  await act(async () =>
    tab!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
}

/** O filtro da situação pelo rótulo (o botão traz a contagem junto). */
async function situacao(rotulo: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Filtrar pela situação"] button',
    ),
  ].find((item) => item.textContent!.startsWith(rotulo));
  expect(button, `situação ${rotulo}`).toBeDefined();
  await act(async () => button!.click());
}

/** Escolhe a opção pelo <select> que o Radix guarda para o formulário. */
async function escolher(valor: string, scope: ParentNode = document) {
  await act(async () => {
    const select = [...scope.querySelectorAll<HTMLSelectElement>("select")].find(
      (item) => [...item.options].some((option) => option.value === valor),
    );
    expect(select, `seletor com ${valor}`).toBeDefined();
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(select, valor);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function linhas(rotulo: string) {
  return [
    ...document.querySelectorAll<HTMLElement>(`ul[aria-label="${rotulo}"] > li`),
  ].map((item) => item.textContent ?? "");
}

function dialogo() {
  const elemento = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(elemento, "o diálogo").not.toBeNull();
  return elemento!;
}

beforeEach(() => {
  estado.convites = [];
  estado.notificacoes = [];
  estado.linkCopiado = "";
  estado.convitesPendentes = [];
  estado.usuariosAtivos = [];
  estado.reenvios = [];
  estado.remocoes = [];
  estado.remocaoFalha = false;
  estado.reenvioFalha = false;
  estado.criacaoFalha = false;
  estado.chavesReenvio = [];
  estado.copiaFalha = false;
  estado.clientesFalham = false;
  estado.usuariosFalham = false;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (link: string) => {
        if (estado.copiaFalha) throw new Error("Cópia bloqueada");
        estado.linkCopiado = link;
      },
    },
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/customers") {
        if (estado.clientesFalham)
          return json({ message: "Falha ao listar" }, 500);
        return json({
          items: [
            {
              id: "Itau",
              code: "Itau",
              name: "Itaú Unibanco",
              sku_prefix: "ITAU",
            },
            {
              id: "BTG_Pactual",
              code: "BTG Pactual",
              name: "BTG Pactual",
              sku_prefix: "BTG",
            },
          ],
        });
      }
      if (url.pathname === "/api/invites" && init?.method === "POST") {
        estado.convites.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        return estado.criacaoFalha
          ? json({ message: "Tente novamente." }, 500)
          : json({ ok: true }, 201);
      }
      if (url.pathname.endsWith("/archive") && init?.method === "POST") {
        estado.remocoes.push(url.pathname);
        if (estado.remocaoFalha)
          return json({ message: "Falha ao remover da lista." }, 500);
        const id = decodeURIComponent(url.pathname.split("/").at(-2)!);
        estado.usuariosAtivos = estado.usuariosAtivos.map((item) =>
          item.id === id ? { ...item, directory_hidden: true } : item,
        );
        return json({ ok: true });
      }
      if (url.pathname.endsWith("/resend") && init?.method === "POST") {
        estado.reenvios.push(url.pathname);
        estado.chavesReenvio.push(
          JSON.parse(String(init.body)).idempotency_key,
        );
        return estado.reenvioFalha
          ? json({ message: "Não foi possível reenviar o convite." }, 500)
          : json({ ok: true });
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

// --- A tela ---------------------------------------------------------------------------

const EQUIPE_E_CLIENTES = {
  usuarios: [
    { id: "owner-a", nome: "Leonardo", email: "diretoria@dutelog.com.br", role: "owner" },
    { id: "ana", nome: "Ana ativa", email: "ana@dutelog.com.br", role: "wms" },
    { id: "caio", nome: "Caio removido", email: "caio@dutelog.com.br", role: "suporte", access_disabled: true },
    { id: "bia", nome: "Bia removida", email: "bia@itau.com.br", role: "cliente", customer_code: "Itau", access_disabled: true },
    { id: "duda", nome: "Duda Lima", email: "duda@btg.com.br", role: "cliente", customer_code: "BTG Pactual" },
    { id: "oculta", nome: "Pessoa oculta", email: "oculta@itau.com.br", role: "cliente", access_disabled: true, directory_hidden: true },
  ],
  convites: [
    { id: "a".repeat(36), nome: "Paula Souza", email: "paula@itau.com.br", role: "cliente", customer_code: "Itau", status: "pending", email_status: "sent" },
    { id: "c".repeat(36), nome: "Carla Mendes", email: "carla@dutelog.com.br", role: "campo", status: "pending", email_status: "sent" },
  ],
};

const PERFIS = ["Administração (owner)", ...ROLE_INFO.map((info) => info.label)];
const MODULOS = Object.values(MODULO_ROTULO);

const TEXTOS_DA_EQUIPE = [
  "Pessoas e acessos", "Convidar pessoa", "Equipe Dutelog", "Clientes", /^\d+$/,
  "Todos", "Ativos", "Convites pendentes", "Arquivados", "Perfil: Todos", ...PERFIS,
  "Pessoa", "Perfil", "Situação",
  "L", "Leonardo", "você", "diretoria@dutelog.com.br", "Ativo",
  "AA", "Ana ativa", "ana@dutelog.com.br",
  "CM", "Carla Mendes", "carla@dutelog.com.br", "Convite pendente", "E-mail enviado", "Reenviar",
];

const TEXTOS_DOS_CLIENTES = [
  "Pessoas e acessos", "Convidar pessoa", "Equipe Dutelog", "Clientes", /^\d+$/,
  "Cliente", "Pessoas", "Convites pendentes",
  "BP", "BTG Pactual", "DL", "1 pessoa", "—",
  "IU", "Itaú Unibanco", "Itau", "Ninguém no portal", "1 convite pendente",
];

describe("Pessoas e acessos, a tela", () => {
  beforeEach(() => {
    estado.usuariosAtivos = EQUIPE_E_CLIENTES.usuarios.map((item) => ({ ...item }));
    estado.convitesPendentes = EQUIPE_E_CLIENTES.convites.map((item) => ({ ...item }));
  });

  it("duas abas: a equipe com a situação; os clientes num índice que leva à página de cada um; sem legenda e sem violação de acessibilidade", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    expect([...document.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual(["Equipe Dutelog3", "Clientes2"]);
    const equipe = linhas("Equipe Dutelog");
    expect(equipe).toHaveLength(3);
    expect(equipe.join(" | ")).toContain("Leonardovocê");
    expect(equipe.join(" | ")).toContain("Carla Mendes");
    for (const fora of ["Paula Souza", "Bia removida", "Duda Lima", "Caio removido", "Pessoa oculta"]) {
      expect(container!.textContent).not.toContain(fora);
    }
    // A própria pessoa não tem menu; os outros têm.
    expect(rotulado("Ações de Leonardo")).toBeNull();
    expect(rotulado("Ações de Ana ativa")).not.toBeNull();
    expect(
      [...document.querySelectorAll('[aria-label="Filtrar pela situação"] button')].map((item) => item.textContent),
    ).toEqual(["Todos3", "Ativos2", "Convites pendentes1", "Arquivados1"]);
    expect(botao("Entender os perfis")).toBeUndefined();
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_EQUIPE)).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);

    await aba("Clientes");
    await esperar(() => linhas("Clientes com portal").length === 2, "o índice dos clientes");
    expect(linhas("Clientes com portal")).toEqual([
      "BPBTG PactualDL1 pessoa—",
      "IUItaú UnibancoItauNinguém no portal1 convite pendente",
    ]);
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Clientes com portal"] a')].map((item) => item.getAttribute("href")),
    ).toEqual(["/configuracoes/clientes?cliente=BTG%20Pactual", "/configuracoes/clientes?cliente=Itau"]);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DOS_CLIENTES)).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("Arquivados é uma situação da equipe; o perfil fica ao lado", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await situacao("Arquivados");
    expect(linhas("Equipe Dutelog")).toEqual([expect.stringContaining("Caio removido")]);
    expect(linhas("Equipe Dutelog")[0]).toContain("Acesso removido");
    await situacao("Convites pendentes");
    expect(linhas("Equipe Dutelog")).toEqual([expect.stringContaining("Carla Mendes")]);
    await situacao("Todos");
    // O filtro do perfil (as regras em lib/pessoas.test.ts, teamInFilter).
    expect(rotulado("Filtrar pelo perfil")?.textContent).toBe("Perfil: Todos");
  });

  it("a busca acha na equipe e nos clientes, o arquivado também, e diz onde a pessoa está; sem resultado, diz isso", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await digitar("people-search", "PAULA@ITAU");
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(linhas("Resultados")).toEqual([expect.stringContaining("Paula Souza")]);
    const onde = document.querySelector<HTMLAnchorElement>('ul[aria-label="Resultados"] a');
    expect(onde?.textContent).toBe("Itaú Unibanco");
    expect(onde?.getAttribute("href")).toBe("/configuracoes/clientes?cliente=Itau");
    await digitar("people-search", "removid");
    expect(linhas("Resultados")).toEqual([
      expect.stringContaining("Caio removidocaio@dutelog.com.brEquipe DutelogSuporteAcesso removido"),
      expect.stringContaining("Bia removidabia@itau.com.brItaú UnibancoClienteAcesso removido"),
    ]);
    expect(
      textosForaDaLista(container!.innerHTML, [
        "Pessoas e acessos", "Convidar pessoa", "Resultados", /^\d+$/, "Pessoa", "Onde", "Perfil", "Situação",
        "CR", "Caio removido", "caio@dutelog.com.br", "Equipe Dutelog", "Suporte", "Acesso removido",
        "BR", "Bia removida", "bia@itau.com.br", "Itaú Unibanco", "Cliente",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await digitar("people-search", "não existe");
    expect(container!.textContent).toContain("Nenhuma pessoa encontrada");
    await digitar("people-search", "");
    expect(document.querySelector('[role="tab"]')).not.toBeNull();
  });

  it("o convite da equipe: os perfis em lista com os módulos que abrem; sem legenda e sem violação de acessibilidade", async () => {
    await abrirPessoas();
    await esperar(() => botao("Convidar pessoa") !== undefined, "o botão de convidar");
    await act(async () => botao("Convidar pessoa")!.click());
    await esperar(() => criar() !== null, "o convite");
    expect(dialogo().textContent).toContain("Convidar para a equipe");
    const radios = [...dialogo().querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((item) => item.id)).toContain("invite-perfil-interno");
    expect(radios.map((item) => item.id)).not.toContain("invite-perfil-cliente");
    expect(dialogo().querySelector("#invite-perfil-interno")!.getAttribute("aria-checked")).toBe("true");
    expect(dialogo().querySelector('label[for="invite-perfil-interno"]')!.textContent).toContain(MODULO_ROTULO.wms);
    expect(
      textosForaDaLista(dialogo().innerHTML, ["Convidar para a equipe", "Nome", "E-mail", "Perfil", ...PERFIS, ...MODULOS, "Cancelar", "Enviar convite", "Fechar"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await act(async () => dialogo().querySelector<HTMLButtonElement>("#invite-perfil-wms")!.click());
    await digitar("invite-nome", "Bruno Teixeira");
    await digitar("invite-email", "Bruno@Dutelog.com.br");
    await tentarCriar();
    await esperar(() => estado.convites.length > 0, "o convite enviado");
    expect(estado.convites[0]).toMatchObject({ nome: "Bruno Teixeira", email: "bruno@dutelog.com.br", role: "wms", customer_code: "Dutelog" });
  });

  it("na aba Clientes, 'Convidar pessoa' abre o convite do portal, que pede o cliente e mostra as telas dele", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await aba("Clientes");
    await act(async () => botao("Convidar pessoa")!.click());
    await esperar(() => criar() !== null, "o convite do portal");
    expect(dialogo().textContent).toContain("Convidar para o portal");
    expect(dialogo().textContent).not.toContain("Telas do portal");
    await digitar("invite-nome", "Juliana Prado");
    await digitar("invite-email", "juliana@btg.com.br");
    await esperar(() => dialogo().querySelector("select") !== null, "a lista de clientes");
    expect(criar()!.disabled).toBe(true);
    await escolher("BTG Pactual", dialogo());
    expect(dialogo().textContent).toContain("Telas do portal");
    expect(criar()!.disabled).toBe(false);
    await tentarCriar();
    await esperar(() => estado.convites.length > 0, "o convite enviado");
    expect(estado.convites[0]).toMatchObject({ role: "cliente", customer_code: "BTG Pactual" });
  });

  it("o reenvio visível pede confirmação e não recria nem exclui a pessoa", async () => {
    await abrirPessoas();
    await esperar(() => rotulado("Reenviar o convite de Carla Mendes") !== null, "o reenvio na linha");
    expect(rotulado("Reenviar o convite de Carla Mendes")!.textContent).toBe("Reenviar");
    await act(async () => rotulado("Reenviar o convite de Carla Mendes")!.click());
    expect(estado.reenvios).toEqual([]);
    expect(dialogo().textContent).toContain("carla@dutelog.com.br");
    await confirmarReenvio();
    await esperar(() => estado.reenvios.length === 1, "um reenvio");
    expect(estado.convites).toEqual([]);
    expect(estado.remocoes).toEqual([]);
  });

  it("remover da lista exige confirmação e some somente depois do sucesso", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await situacao("Arquivados");
    await abrirAcoes("Caio removido");
    await act(async () => itemDoMenu("Remover da lista")!.click());
    expect(estado.remocoes).toEqual([]);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("O histórico de ações será preservado");
    await act(async () => botao("Remover da lista", dialog)!.click());
    await esperar(() => !container!.textContent!.includes("Caio removido"), "a pessoa removida da lista");
    expect(estado.remocoes).toEqual(["/api/billing/users/caio/archive"]);
    expect(estado.usuariosAtivos.find((item) => item.id === "caio")!.email).toBe("caio@dutelog.com.br");
  });

  it("falha de remoção mantém a pessoa e a confirmação para tentar novamente", async () => {
    estado.remocaoFalha = true;
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await situacao("Arquivados");
    await abrirAcoes("Caio removido");
    await act(async () => itemDoMenu("Remover da lista")!.click());
    await act(async () => botao("Remover da lista", document.querySelector('[role="alertdialog"]')!)!.click());
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Pessoa não removida"),
      "a falha da remoção",
    );
    expect(container!.textContent).toContain("Caio removido");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("convidar novamente a pessoa de um cliente preenche a identidade e o cliente para revisar antes de enviar", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await digitar("people-search", "bia");
    await abrirAcoes("Bia removida");
    await act(async () => itemDoMenu("Convidar novamente")!.click());
    await esperar(() => criar() !== null, "o formulário preenchido");
    expect(dialogo().textContent).toContain("Convidar para o portal");
    expect(document.querySelector<HTMLInputElement>("#invite-nome")!.value).toBe("Bia removida");
    expect(document.querySelector<HTMLInputElement>("#invite-email")!.value).toBe("bia@itau.com.br");
    expect(estado.convites).toEqual([]);
    await tentarCriar();
    expect(estado.convites[0]).toMatchObject({ nome: "Bia removida", email: "bia@itau.com.br", role: "cliente", customer_code: "Itau" });
  });

  it("convidar novamente alguém da equipe volta com o perfil de antes", async () => {
    await abrirPessoas();
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe");
    await situacao("Arquivados");
    await abrirAcoes("Caio removido");
    await act(async () => itemDoMenu("Convidar novamente")!.click());
    await esperar(() => criar() !== null, "o formulário preenchido");
    expect(dialogo().textContent).toContain("Convidar para a equipe");
    expect(dialogo().querySelector("#invite-perfil-suporte")!.getAttribute("aria-checked")).toBe("true");
    await tentarCriar();
    expect(estado.convites[0]).toMatchObject({ email: "caio@dutelog.com.br", role: "suporte", customer_code: "Dutelog" });
  });

  it("a leitura que falhou diz isso, nunca o vazio, e lê de novo", async () => {
    estado.usuariosFalham = true;
    await abrirPessoas();
    await esperar(() => document.querySelector('[role="alert"]') !== null, "o aviso da falha");
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("Não foi possível carregar as pessoas e os convites.");
    expect(container!.textContent).not.toContain("Ninguém na equipe");
    estado.usuariosFalham = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => container!.textContent!.includes("Ana ativa"), "a equipe lida de novo");
  });
});

// --- O convite do portal --------------------------------------------------------------

describe("o cliente do convite", () => {
  it("o endereço de Clientes abre o convite do portal com o cliente, sem legenda", async () => {
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    expect(criar()!.textContent).toBe("Enviar convite");
    expect(dialogo().textContent).toContain("Convidar para o portal");
    expect(dialogo().textContent).not.toContain("O convite chega por e-mail");
  });

  it("confirma o agendamento do e-mail e preserva o link para compartilhar", async () => {
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    await tentarCriar();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Convite criado"),
      "a confirmação do convite",
    );
    expect(estado.notificacoes).toContainEqual({
      title: "Convite criado",
      description:
        "O envio por e-mail foi agendado. O link também foi copiado.",
    });
    expect(estado.linkCopiado).toContain(String(estado.convites[0]!.token));
    expect(estado.linkCopiado).toContain("/convite");
  });

  it("mantém a confirmação do agendamento quando o navegador bloqueia a cópia", async () => {
    estado.copiaFalha = true;
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    await tentarCriar();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Convite criado"),
      "a confirmação sem cópia",
    );
    expect(estado.notificacoes).toContainEqual({
      title: "Convite criado",
      description:
        "O envio por e-mail foi agendado. Você pode copiar o link nas ações do convite.",
    });
    expect(estado.linkCopiado).toBe("");
  });

  it("sem cliente escolhido, o convite não sai com o primeiro da lista", async () => {
    await abrirOConvite("?convidar=cliente");
    expect(criar()!.disabled).toBe(true);
    await tentarCriar();
    expect(estado.convites).toEqual([]);
  });

  it("com a lista de clientes falhando, o convite não sai para a BTG", async () => {
    estado.clientesFalham = true;
    await abrirOConvite("?convidar=cliente");
    await tentarCriar();
    expect(estado.convites).toEqual([]);
  });

  it("o cliente que vem do Convidar de Configurações › Clientes vale como escolhido", async () => {
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    await tentarCriar();
    expect(estado.convites.map((convite) => convite.customer_code)).toEqual([
      "Itau",
    ]);
  });
});

// --- O convite pendente ---------------------------------------------------------------

const CONVITE_DA_EQUIPE = {
  id: "a".repeat(36),
  nome: "Paula Souza",
  email: "paula@dutelog.com.br",
  role: "interno",
  status: "pending",
  email_status: "failed",
};

describe("o envio do convite pendente", () => {
  beforeEach(() => {
    estado.convitesPendentes = [{ ...CONVITE_DA_EQUIPE }];
  });

  it("mostra a falha de envio e permite agendar o reenvio", async () => {
    await abrirPessoas();
    await abrirAcoes("Paula Souza");
    expect(container!.textContent).toContain("Falha no envio do e-mail");
    expect(itemDoMenu("Reenviar convite por e-mail")).toBeDefined();
    await act(async () => itemDoMenu("Reenviar convite por e-mail")!.click());
    await confirmarReenvio();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Reenvio agendado"),
      "a confirmação do reenvio",
    );
    expect(estado.reenvios).toEqual([`/api/invites/${"a".repeat(36)}/resend`]);
  });

  it("mantém a pessoa visível como ativa quando o próximo acompanhamento encontra o convite aceito", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Convite pendente"),
      "o convite pendente",
    );

    estado.convitesPendentes = [{ ...CONVITE_DA_EQUIPE, status: "used" }];
    estado.usuariosAtivos = [
      { id: "paula", nome: "Paula Souza", email: "paula@dutelog.com.br", role: "interno" },
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await esperar(
      () => linhas("Equipe Dutelog").some((linha) => linha.includes("Paula Souza") && linha.includes("Ativo")),
      "a pessoa com acesso ativo",
    );
    expect(container!.textContent).not.toContain("Convite pendente");
  });

  it("desabilita o reenvio enquanto o e-mail já está agendado", async () => {
    estado.convitesPendentes[0]!.email_status = "pending";
    await abrirPessoas();
    await abrirAcoes("Paula Souza");
    expect(container!.textContent).toContain("E-mail agendado");
    expect(itemDoMenu("Reenviar convite por e-mail")?.getAttribute("aria-disabled")).toBe("true");
    expect(rotulado("Reenviar o convite de Paula Souza")!.disabled).toBe(true);
    await act(async () => itemDoMenu("Reenviar convite por e-mail")!.click());
    expect(estado.reenvios).toEqual([]);
  });

  it("exibe o erro quando o reenvio falha", async () => {
    estado.reenvioFalha = true;
    await abrirPessoas();
    await abrirAcoes("Paula Souza");
    await act(async () => itemDoMenu("Reenviar convite por e-mail")!.click());
    await confirmarReenvio();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Convite não reenviado"),
      "o erro do reenvio",
    );
    expect(estado.notificacoes.some((item) => item.title === "Reenvio agendado")).toBe(false);
  });
});

describe("repetir uma tentativa sem duplicar efeitos", () => {
  it("mantém token e recibo da criação após falha, e deixa corrigir campos inválidos", async () => {
    estado.criacaoFalha = true;
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    await tentarCriar();
    expect(estado.convites.length).toBeGreaterThan(0);
    estado.criacaoFalha = false;
    await tentarCriar();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Convite criado"),
      "a criação retomada",
    );
    expect(new Set(estado.convites.map((item) => item.token)).size).toBe(1);
    expect(new Set(estado.convites.map((item) => item.idempotency_key)).size).toBe(1);
  });

  it("mantém o recibo do reenvio ao tentar novamente depois de uma falha", async () => {
    estado.convitesPendentes = [{ ...CONVITE_DA_EQUIPE }];
    estado.reenvioFalha = true;
    await abrirPessoas();
    await esperar(() => rotulado("Reenviar o convite de Paula Souza") !== null, "o reenvio");
    await act(async () => rotulado("Reenviar o convite de Paula Souza")!.click());
    await confirmarReenvio();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Convite não reenviado"),
      "a falha",
    );
    estado.reenvioFalha = false;
    await confirmarReenvio();
    await esperar(
      () => estado.notificacoes.some((item) => item.title === "Reenvio agendado"),
      "a retomada",
    );
    expect(estado.chavesReenvio.length).toBe(2);
    expect(new Set(estado.chavesReenvio).size).toBe(1);
  });

  it("permite recuperar um reconvite mesmo com o e-mail já agendado", async () => {
    estado.convitesPendentes = [
      { ...CONVITE_DA_EQUIPE, email_status: "pending", login_preparation_pending: true },
    ];
    await abrirPessoas();
    await esperar(() => rotulado("Reenviar o convite de Paula Souza") !== null, "o reenvio para recuperação");
    expect(rotulado("Reenviar o convite de Paula Souza")!.disabled).toBe(false);
  });
});
