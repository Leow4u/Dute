// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A nova tentativa das emissões e das baixas, que são consultas da callable
 * (revisão da parte 13l). A releitura que a tela faz sozinha (o intervalo de
 * 60 s, a releitura sozinha do app) não é a nova tentativa que a pessoa pediu:
 * o "Tentar de novo" do aviso da conexão não pode virar "Tentando de novo…",
 * com `aria-disabled` e `aria-busy`, sem ninguém ter tocado, nem ignorar o
 * toque que chega nessa hora. Até a 13l a falha da seção filtrava isso; o
 * aviso da conexão confia no `tentando` da leitura. Agora ele só vale para a
 * nova tentativa pedida, e o `tentar` devolve a promessa dela. Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({
  pendentes: [] as Array<{ nome: string; rejeitar: (erro: unknown) => void; resolver: (dados: unknown) => void }>,
}));

vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), FINANCEIRO_LIBERADO: true, OMIE_LIBERADA: true }));
vi.mock("@/lib/financeiro/api", () => ({
  novaChave: () => "k-1",
  chamarFinanceiro: (nome: string) =>
    new Promise((resolver, rejeitar) => {
      estado.pendentes.push({ nome, resolver, rejeitar });
    }),
}));

import { SemConexao } from "@/lib/conexao";
import { useBaixasDaNf, useBaixasDoFinanceiro, CHAVE_DAS_BAIXAS } from "@/lib/financeiro/use-baixas";
import { CHAVE_DAS_EMISSOES, useEmissoesDoFinanceiro } from "@/lib/financeiro/use-emissoes";
import type { NovaTentativa } from "@/lib/operacao/leitura";

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.pendentes = [];
  // A leitura tenta de novo uma vez (o `retry: 1` dela), sem esperar.
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  cliente.clear();
  container.remove();
  vi.unstubAllGlobals();
});

/** Responde sem rede cada chamada que espera, até a leitura chegar ao que se espera dela. */
async function semRedeAte(condicao: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        for (const chamada of estado.pendentes.splice(0)) chamada.rejeitar(new SemConexao());
        await Promise.resolve();
      });
      condicao();
    },
    { timeout: 3_000 },
  );
}

const LEITURAS: Array<[string, readonly unknown[], () => NovaTentativa]> = [
  ["as emissões", CHAVE_DAS_EMISSOES, () => useEmissoesDoFinanceiro("financeiro", true, true).releitura],
  ["as baixas", CHAVE_DAS_BAIXAS, () => useBaixasDoFinanceiro("financeiro", true, true).releitura],
  ["as baixas da NF", [...CHAVE_DAS_BAIXAS, "fat_1"], () => useBaixasDaNf("financeiro", "fat_1", true, true).releitura],
];

describe("a nova tentativa das consultas da callable do Financeiro (revisão da parte 13l)", () => {
  for (const [nome, chave, ler] of LEITURAS) {
    it(`${nome}: a releitura automática não é a nova tentativa pedida; o toque dela é`, async () => {
      let releitura: NovaTentativa | null = null;
      /** Quantas leituras da chave a tela vê lendo, no mesmo render da releitura. */
      let lendo = 0;
      function Sonda() {
        releitura = ler();
        lendo = useIsFetching({ queryKey: chave });
        return null;
      }
      await act(async () => {
        raiz!.render(
          <QueryClientProvider client={cliente}>
            <Sonda />
          </QueryClientProvider>,
        );
      });
      await semRedeAte(() => expect(releitura).toMatchObject({ falta: "conexao", lidaEm: null, falhou: true }));
      expect(releitura!.tentando).toBe(false);

      // A tela relê sozinha (o intervalo de 60 s): ninguém tocou em nada.
      act(() => void cliente.refetchQueries({ queryKey: chave }));
      await vi.waitFor(() => expect(lendo).toBe(1), { timeout: 3_000 });
      expect(releitura!.tentando).toBe(false);
      expect(releitura!.falta).toBe("conexao");

      // A pessoa toca no meio dela: a nova tentativa é dela, e a promessa acaba quando a leitura responde.
      let respondeu = false;
      await act(async () => {
        void Promise.resolve((releitura!.tentar as () => unknown)()).then(() => {
          respondeu = true;
        });
      });
      await vi.waitFor(() => expect(releitura!.tentando).toBe(true), { timeout: 3_000 });
      await semRedeAte(() => {
        expect(respondeu).toBe(true);
        expect(lendo).toBe(0);
        expect(releitura!.tentando).toBe(false);
      });
      expect(releitura!.falta).toBe("conexao");
    });
  }
});
