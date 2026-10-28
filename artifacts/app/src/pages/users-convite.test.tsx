// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
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
}));

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useListBillingUsers: () =>
      useQuery({
        queryKey: ["billing-users"],
        queryFn: async () => ({ items: estado.usuariosAtivos }),
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
  window.history.replaceState({}, "", `/configuracoes/usuarios${busca}`);
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

async function abrirAcoesDoConvite() {
  await esperar(
    () =>
      document.querySelector('[aria-label="Ações de Paula Souza"]') !== null,
    "a pessoa convidada",
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Ações de Paula Souza"]')!
      .dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
  });
  await esperar(
    () => document.querySelector('[role="menu"]') !== null,
    "as ações do convite",
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

function reenviar() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Reenviar convite por e-mail",
  );
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (link: string) => {
        if (estado.copiaFalha) throw new Error("Cópia bloqueada");
        estado.linkCopiado = link;
      },
    },
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

describe("o cliente do convite", () => {
  it("explica o envio por e-mail e a criação da senha antes de convidar", async () => {
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    expect(criar()!.textContent).toBe("Criar convite e enviar e-mail");
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "O convite chega por e-mail em alguns minutos. A pessoa define a própria senha ao aceitar.",
    );
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

describe("o envio do convite pendente", () => {
  beforeEach(() => {
    estado.convitesPendentes = [
      {
        id: "a".repeat(36),
        nome: "Paula Souza",
        email: "paula@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
        status: "pending",
        email_status: "failed",
      },
    ];
  });

  it("mostra a falha de envio e permite agendar o reenvio", async () => {
    await abrirPessoas();
    await abrirAcoesDoConvite();
    expect(container!.textContent).toContain("Falha no envio do e-mail");
    expect(reenviar()).toBeDefined();
    await act(async () => reenviar()!.click());
    await confirmarReenvio();
    await esperar(
      () =>
        estado.notificacoes.some((item) => item.title === "Reenvio agendado"),
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

    estado.convitesPendentes = [
      { ...estado.convitesPendentes[0]!, status: "used" },
    ];
    estado.usuariosAtivos = [
      {
        id: "paula",
        nome: "Paula Souza",
        email: "paula@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
      },
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await esperar(
      () => container!.textContent!.includes("Ativo"),
      "a pessoa com acesso ativo",
    );
    expect(container!.textContent).toContain("Paula Souza");
    expect(container!.textContent).not.toContain("Convite pendente");
  });

  it("desabilita o reenvio enquanto o e-mail já está agendado", async () => {
    estado.convitesPendentes[0]!.email_status = "pending";
    await abrirPessoas();
    await abrirAcoesDoConvite();
    expect(container!.textContent).toContain("E-mail agendado");
    expect(reenviar()?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => reenviar()!.click());
    expect(estado.reenvios).toEqual([]);
  });

  it("exibe o erro quando o reenvio falha", async () => {
    estado.reenvioFalha = true;
    await abrirPessoas();
    await abrirAcoesDoConvite();
    await act(async () => reenviar()!.click());
    await confirmarReenvio();
    await esperar(
      () =>
        estado.notificacoes.some(
          (item) => item.title === "Convite não reenviado",
        ),
      "o erro do reenvio",
    );
    expect(
      estado.notificacoes.some((item) => item.title === "Reenvio agendado"),
    ).toBe(false);
  });
});

function botao(texto: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === texto,
  );
}
async function aba(nome: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (item) => item.textContent!.startsWith(nome),
  );
  expect(tab).toBeDefined();
  await act(async () =>
    tab!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
}
async function acoes(nome: string) {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(`[aria-label="Ações de ${nome}"]`)!
      .dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
  );
  await esperar(
    () => document.querySelector('[role="menu"]') !== null,
    "as ações da pessoa",
  );
}

describe("a tabela ampla de pessoas", () => {
  beforeEach(() => {
    estado.usuariosAtivos = [
      {
        id: "ana",
        nome: "Ana ativa",
        email: "ana@dutelog.com.br",
        role: "wms",
      },
      {
        id: "bia",
        nome: "Bia removida",
        email: "bia@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
        access_disabled: true,
      },
      {
        id: "oculta",
        nome: "Pessoa oculta",
        email: "oculta@itau.com.br",
        role: "cliente",
        access_disabled: true,
        directory_hidden: true,
      },
    ];
    estado.convitesPendentes = [
      {
        id: "a".repeat(36),
        nome: "Paula Souza",
        email: "paula@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
        status: "pending",
        email_status: "sent",
      },
    ];
  });

  it("separa acessos removidos e oculta quem já foi removido da lista", async () => {
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Ana ativa"),
      "a lista",
    );
    expect(container!.textContent).toContain("Paula Souza");
    expect(container!.textContent).not.toContain("Bia removida");
    expect(container!.textContent).not.toContain("Pessoa oculta");
    await aba("Arquivados");
    expect(container!.textContent).toContain("Bia removida");
    expect(container!.textContent).not.toContain("Ana ativa");
    expect(container!.textContent).not.toContain("Pessoa oculta");
  });

  it("busca nome e e-mail e mostra um vazio útil sem perder os contadores", async () => {
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Ana ativa"),
      "a lista",
    );
    await digitar("people-search", "PAULA@ITAU");
    expect(container!.textContent).toContain("Paula Souza");
    expect(container!.textContent).not.toContain("Ana ativa");
    await digitar("people-search", "não existe");
    expect(container!.textContent).toContain("Nenhuma pessoa encontrada");
    await aba("Arquivados");
    expect(container!.textContent).not.toContain("Bia removida");
    await digitar("people-search", "");
    expect(container!.textContent).toContain("Bia removida");
  });

  it("mostra a explicação dos perfis somente ao abrir a ajuda", async () => {
    await abrirPessoas();
    expect(container!.textContent).not.toContain(
      "Aprova pedidos, cuida do cadastro e do estoque.",
    );
    await act(async () => botao("Entender os perfis")!.click());
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "Aprova pedidos, cuida do cadastro e do estoque.",
    );
  });

  it("o reenvio visível pede confirmação e não recria nem exclui a pessoa", async () => {
    await abrirPessoas();
    await esperar(
      () => botao("Reenviar convite") !== undefined,
      "o reenvio na linha",
    );
    await act(async () => botao("Reenviar convite")!.click());
    expect(estado.reenvios).toEqual([]);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "paula@itau.com.br",
    );
    await confirmarReenvio();
    await esperar(() => estado.reenvios.length === 1, "um reenvio");
    expect(estado.convites).toEqual([]);
    expect(estado.remocoes).toEqual([]);
  });

  it("remover da lista exige confirmação e some somente depois do sucesso", async () => {
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Ana ativa"),
      "a lista",
    );
    await aba("Arquivados");
    await acoes("Bia removida");
    const remove = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Remover da lista");
    await act(async () => remove!.click());
    expect(estado.remocoes).toEqual([]);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain(
      "O histórico de ações será preservado",
    );
    await act(async () => botao("Remover da lista", dialog)!.click());
    await esperar(
      () => !container!.textContent!.includes("Bia removida"),
      "a pessoa removida da lista",
    );
    expect(estado.remocoes).toEqual(["/api/billing/users/bia/archive"]);
    expect(estado.usuariosAtivos.find((item) => item.id === "bia")!.email).toBe(
      "bia@itau.com.br",
    );
  });

  it("falha de remoção mantém a pessoa e a confirmação para tentar novamente", async () => {
    estado.remocaoFalha = true;
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Ana ativa"),
      "a lista",
    );
    await aba("Arquivados");
    await acoes("Bia removida");
    const remove = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Remover da lista");
    await act(async () => remove!.click());
    await act(async () =>
      botao(
        "Remover da lista",
        document.querySelector('[role="alertdialog"]')!,
      )!.click(),
    );
    await esperar(
      () =>
        estado.notificacoes.some(
          (item) => item.title === "Pessoa não removida",
        ),
      "a falha da remoção",
    );
    expect(container!.textContent).toContain("Bia removida");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("convidar novamente preenche a identidade e o cliente para revisar antes de enviar", async () => {
    await abrirPessoas();
    await esperar(
      () => container!.textContent!.includes("Ana ativa"),
      "a lista",
    );
    await aba("Arquivados");
    await acoes("Bia removida");
    const invite = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Convidar novamente");
    await act(async () => invite!.click());
    await esperar(() => criar() !== null, "o formulário preenchido");
    expect(
      document.querySelector<HTMLInputElement>("#invite-nome")!.value,
    ).toBe("Bia removida");
    expect(
      document.querySelector<HTMLInputElement>("#invite-email")!.value,
    ).toBe("bia@itau.com.br");
    expect(estado.convites).toEqual([]);
    await tentarCriar();
    expect(estado.convites[0]).toMatchObject({
      nome: "Bia removida",
      email: "bia@itau.com.br",
      role: "cliente",
      customer_code: "Itau",
    });
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
    expect(
      new Set(estado.convites.map((item) => item.idempotency_key)).size,
    ).toBe(1);
  });
  it("mantém o recibo do reenvio ao tentar novamente depois de uma falha", async () => {
    estado.convitesPendentes = [
      {
        id: "a".repeat(36),
        nome: "Paula Souza",
        email: "paula@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
        status: "pending",
        email_status: "failed",
      },
    ];
    estado.reenvioFalha = true;
    await abrirPessoas();
    await esperar(() => botao("Reenviar convite") !== undefined, "o reenvio");
    await act(async () => botao("Reenviar convite")!.click());
    await confirmarReenvio();
    await esperar(
      () =>
        estado.notificacoes.some(
          (item) => item.title === "Convite não reenviado",
        ),
      "a falha",
    );
    estado.reenvioFalha = false;
    await confirmarReenvio();
    await esperar(
      () =>
        estado.notificacoes.some((item) => item.title === "Reenvio agendado"),
      "a retomada",
    );
    expect(estado.chavesReenvio.length).toBe(2);
    expect(new Set(estado.chavesReenvio).size).toBe(1);
  });
  it("permite recuperar um reconvite mesmo com o e-mail já agendado", async () => {
    estado.convitesPendentes = [
      {
        id: "a".repeat(36),
        nome: "Paula Souza",
        email: "paula@itau.com.br",
        role: "cliente",
        customer_code: "Itau",
        status: "pending",
        email_status: "pending",
        login_preparation_pending: true,
      },
    ];
    await abrirPessoas();
    await esperar(
      () => botao("Reenviar convite") !== undefined,
      "o reenvio para recuperação",
    );
    expect(botao("Reenviar convite")!.disabled).toBe(false);
  });
});
