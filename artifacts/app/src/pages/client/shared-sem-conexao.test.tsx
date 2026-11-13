import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SEM_CONEXAO, SEM_RESPOSTA } from "@/lib/conexao";

import { ClientDataBoundary, clientOverviewQueryKey, type ClientOverview } from "./shared";

/**
 * O portal sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2
 * do celular, de 06/11/2026): sem conexão na releitura, o que já estava na
 * tela fica, e não vira "Portal indisponível".
 */

const OVERVIEW = { customer: { code: "BTG", name: "BTG Pactual" } } as unknown as ClientOverview;

function tela(erro: Error, dados: ClientOverview | undefined) {
  const client = new QueryClient();
  // A tela que já tentou: sem isso, a leitura com erro e sem dados tenta de
  // novo ao montar e aparece carregando.
  client.setQueryDefaults(clientOverviewQueryKey, { retryOnMount: false });
  if (dados) client.setQueryData(clientOverviewQueryKey, dados);
  else client.getQueryCache().build(client, { queryKey: clientOverviewQueryKey });
  const leitura = client.getQueryCache().find({ queryKey: clientOverviewQueryKey })!;
  // A releitura falhou: o react-query guarda o erro e mantém o que já tinha.
  leitura.setState({ ...leitura.state, status: "error", error: erro, errorUpdatedAt: Date.now(), fetchStatus: "idle" });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ClientDataBoundary>{(overview) => <p>{`Portal de ${overview.customer?.name}`}</p>}</ClientDataBoundary>
    </QueryClientProvider>,
  );
}

describe("o portal sem conexão", () => {
  it("com o que já estava lido, segue mostrando", () => {
    const html = tela(new Error(SEM_CONEXAO), OVERVIEW);
    expect(html).toContain("Portal de BTG Pactual");
    expect(html).not.toContain("Portal indisponível");
  });

  it("com o aparelho conectado e o servidor sem resposta, também segue mostrando (carregamento v2, parte 7a)", () => {
    const html = tela(Object.assign(new Error(SEM_RESPOSTA), { status: 503, data: { message: SEM_RESPOSTA, code: "sem_resposta" } }), OVERVIEW);
    expect(html).toContain("Portal de BTG Pactual");
    expect(html).not.toContain("Portal indisponível");
  });

  it("sem nada lido, diz que faltou conexão no lugar do portal", () => {
    const html = tela(new Error(SEM_CONEXAO), undefined);
    expect(html).toContain("Portal indisponível");
    expect(html).toContain(SEM_CONEXAO);
  });

  it("a falha que não é de conexão continua no lugar do portal", () => {
    const html = tela(new Error("Missing or insufficient permissions."), OVERVIEW);
    expect(html).toContain("Portal indisponível");
    expect(html).not.toContain("Portal de BTG Pactual");
  });
});
