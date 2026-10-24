// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As emissões da NFS-e pela Omie com as callables de mentira (parte 7.4f):
 * a ação leva a edição que a tela viu; a nova tentativa depois da falha leva
 * a mesma chave (se a primeira gravou, o servidor repete o resultado); cada
 * intenção tem a sua; desistir só chama depois da confirmação; a lista é lida
 * de novo depois de cada ação, deu certo ou não.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  leiturasDaLista: 0,
  leiturasDasBaixas: 0,
  chaves: 0,
  falhar: false,
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  FINANCEIRO_LIBERADO: true,
  OMIE_LIBERADA: true,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "fin-1", fullName: "Pessoa do financeiro", publicMetadata: { role: "financeiro" } }, isLoaded: true }),
}));

function bruta(id: string, extra: Record<string, unknown>) {
  return {
    id,
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "rejeitada",
    motivo_da_parada: null,
    mensagem: "A prefeitura recusou a NFS-e.",
    mensagens_da_prefeitura: [],
    demandas: ["10045"],
    armazenagem: [],
    total_cents: 100_000,
    vencimento: "2026-11-20",
    nfse: null,
    url_nfse: null,
    url_pdf: null,
    criada_em: "2026-10-23T12:00:00.000Z",
    edicao: 4,
    ...extra,
  };
}

const REJEITADA = "nfe_00000000000000000001";
const PARADA = "nfe_00000000000000000002";
const BAIXA = "bxa_000000000000000000000001";

vi.mock("@/lib/financeiro/api", () => ({
  novaChave: () => {
    estado.chaves += 1;
    return `k-${estado.chaves}`;
  },
  chamarFinanceiro: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    if (nome === "listNfSettlements") {
      estado.leiturasDasBaixas += 1;
      return {
        baixas: [
          {
            id: BAIXA,
            pagamento_id: "pag_000000000000000000000001",
            fatura_id: "fat_000000000000000000000001",
            customer_code: "ITAU",
            customer_name: "Itaú Unibanco",
            nf_numero: "815",
            etapa: "parada",
            motivo_da_parada: "titulo_liquidado",
            mensagem: "O título da OS já está recebido na Omie, sem o recebimento da Dute.",
            valor_cents: 500_000,
            recebido_em: "2026-10-22",
            criada_em: "2026-10-22T15:00:00.000Z",
            edicao: 9,
          },
        ],
      };
    }
    if (nome === "listNfEmissions") {
      estado.leiturasDaLista += 1;
      return {
        emissoes: [
          bruta(REJEITADA, {}),
          bruta(PARADA, { customer_code: "SAFRA", customer_name: "Banco Safra", etapa: "parada", motivo_da_parada: "falhas_seguidas", mensagem: "A Omie não respondeu.", edicao: 7 }),
        ],
      };
    }
    if (estado.falhar) throw new Error("Falha interna no servidor. Tente novamente ou avise o time técnico.");
    return { id: dados.id, etapa: dados.acao === "retomar" ? "reenviando" : "desistida" };
  },
}));

import { useEmissoesDoFinanceiro, type LeituraDasEmissoes } from "@/lib/financeiro/use-emissoes";

import FinanceiroEmissoes from "./emissoes";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.leiturasDaLista = 0;
  estado.leiturasDasBaixas = 0;
  estado.chaves = 0;
  estado.falhar = false;
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
        <FinanceiroEmissoes />
      </QueryClientProvider>,
    );
  });
  await esperar();
}

/** Pelo nome acessível: o aria-label da linha ou o texto do botão. */
async function clicar(nome: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => (item.getAttribute("aria-label") ?? item.textContent) === nome);
  if (!botao) throw new Error(`Botão "${nome}" não encontrado.`);
  await act(async () => {
    botao.click();
  });
  await esperar();
}

function acoes(nome = "actOnNfEmission") {
  return estado.chamadas.filter((chamada) => chamada.nome === nome).map((chamada) => chamada.dados);
}

describe("as emissões com as callables", () => {
  it("fora da liberação da Omie e para quem não abre o Financeiro, nada é lido e não há emissão", async () => {
    const lidas: LeituraDasEmissoes[] = [];
    function Sonda({ role, omie }: { role: string; omie: boolean }) {
      lidas.push(useEmissoesDoFinanceiro(role as "financeiro", true, omie));
      return null;
    }
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Sonda role="financeiro" omie={false} />
          <Sonda role="comercial" omie={true} />
        </QueryClientProvider>,
      );
    });
    await esperar();
    expect(estado.chamadas).toEqual([]);
    expect(lidas.at(-1)).toEqual({ emissoes: [], carregando: false, falhas: [] });
    expect(lidas.at(-2)).toEqual({ emissoes: [], carregando: false, falhas: [] });
  });

  it("tentar de novo leva a edição vista; a falha mantém a chave e a lista é lida de novo", async () => {
    await montar();
    expect(estado.leiturasDaLista).toBe(1);
    expect(container!.textContent).toContain("Precisam de você");

    estado.falhar = true;
    await clicar("Tentar de novo, Itaú Unibanco");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Falha interna");
    expect(estado.leiturasDaLista).toBe(2);

    estado.falhar = false;
    await clicar("Tentar de novo, Itaú Unibanco");
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Itaú Unibanco: emissão retomada");
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(acoes()).toEqual([
      { idempotency_key: "k-1", id: REJEITADA, acao: "retomar", expected_edicao: 4 },
      { idempotency_key: "k-1", id: REJEITADA, acao: "retomar", expected_edicao: 4 },
    ]);
    expect(estado.leiturasDaLista).toBe(3);

    // Outra intenção, outra chave.
    await clicar("Tentar de novo, Banco Safra");
    expect(acoes().at(-1)).toEqual({ idempotency_key: "k-2", id: PARADA, acao: "retomar", expected_edicao: 7 });
  });

  it("desistir só chama depois da confirmação; voltar fecha sem chamar", async () => {
    await montar();
    await clicar("Desistir, Banco Safra");
    expect(acoes()).toEqual([]);
    expect(container!.textContent).toContain("Confirmar desistência");

    await clicar("Voltar");
    expect(container!.textContent).not.toContain("Confirmar desistência");
    expect(acoes()).toEqual([]);

    await clicar("Desistir, Banco Safra");
    estado.falhar = true;
    await clicar("Confirmar desistência");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Falha interna");
    // A confirmação continua aberta para tentar de novo, com a mesma chave.
    estado.falhar = false;
    await clicar("Confirmar desistência");
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Banco Safra: emissão desistida");
    expect(container!.textContent).not.toContain("Confirmar desistência");
    expect(acoes()).toEqual([
      { idempotency_key: "k-1", id: PARADA, acao: "desistir", expected_edicao: 7 },
      { idempotency_key: "k-1", id: PARADA, acao: "desistir", expected_edicao: 7 },
    ]);
  });

  it("a baixa parada: dispensar só chama depois da confirmação, com a edição vista; tentar de novo leva a chave dela; as duas listas são lidas de novo", async () => {
    await montar();
    expect(container!.textContent).toContain("Baixas na Omie");
    expect(estado.leiturasDasBaixas).toBe(1);

    await clicar("Dispensar, Itaú Unibanco · NF 815");
    expect(acoes("actOnNfSettlement")).toEqual([]);
    estado.falhar = true;
    await clicar("Confirmar dispensa");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Falha interna");
    estado.falhar = false;
    await clicar("Confirmar dispensa");
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Itaú Unibanco · NF 815: baixa dispensada");
    expect(acoes("actOnNfSettlement")).toEqual([
      { idempotency_key: "k-1", id: BAIXA, acao: "dispensar", expected_edicao: 9 },
      { idempotency_key: "k-1", id: BAIXA, acao: "dispensar", expected_edicao: 9 },
    ]);
    expect(estado.leiturasDasBaixas).toBe(3);
    expect(estado.leiturasDaLista).toBe(3);

    await clicar("Tentar de novo, Itaú Unibanco · NF 815");
    expect(acoes("actOnNfSettlement").at(-1)).toEqual({ idempotency_key: "k-2", id: BAIXA, acao: "retomar", expected_edicao: 9 });
    // A ação da baixa não chama a da emissão.
    expect(acoes()).toEqual([]);
  });
});
