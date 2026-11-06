import { MutationObserver, QueryObserver, onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "./queryClient";

/**
 * Sem rede, o react-query não pausa a leitura nem a ação
 * (docs/plataforma/diagnostico-carregamento.md, seção 9, decisões 1 e 2 do
 * celular). Pausadas, a tela afirmava a lista vazia e a ação saía minutos
 * depois, sem aviso.
 */

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
});

describe("o cliente do react-query sem rede", () => {
  it("a leitura vai à camada do Firestore, que responde na hora", async () => {
    onlineManager.setOnline(false);
    const ler = vi.fn(async () => {
      throw new Error("Sem conexão. Tente de novo quando o sinal voltar.");
    });
    const leitura = new QueryObserver(queryClient, { queryKey: ["teste", "sem-rede"], queryFn: ler });
    const deixar = leitura.subscribe(() => undefined);
    await vi.waitFor(() => expect(leitura.getCurrentResult().isError).toBe(true));
    expect(ler).toHaveBeenCalledTimes(1);
    expect(leitura.getCurrentResult().fetchStatus).toBe("idle");
    deixar();
  });

  it("a ação é recusada na hora, sem ficar parada para sair depois", async () => {
    onlineManager.setOnline(false);
    const gravar = vi.fn(async () => {
      throw new Error("Sem conexão. Tente de novo quando o sinal voltar.");
    });
    const acao = new MutationObserver(queryClient, { mutationFn: gravar });
    await expect(acao.mutate()).rejects.toThrow("Sem conexão");
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(acao.getCurrentResult().isPaused).toBe(false);
  });

  it("guarda a escolha nos padrões, para toda leitura e toda ação", () => {
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBe("always");
    expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe("always");
  });
});
