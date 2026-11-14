import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CLIENTE_DO_WMS, clienteDoNucleo, type ClienteDoAgente } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { AgentNotes, NewNote } from "./agent-notes";

/**
 * A anotação escrita pela coordenação no Conhecimento (04/11/2026), no lugar
 * do "Ensinar o Agent Dute" do painel antigo: o texto, quem o agente
 * considera e "Salvar". Só com o agente do núcleo, que grava pela
 * writeDuteNote; o agente do WMS não tem.
 */

function comAgente(cliente: ClienteDoAgente, conteudo: React.ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProvedorDoAgente cliente={cliente}>{conteudo}</ProvedorDoAgente>
    </QueryClientProvider>,
  );
}

describe("a nova anotação no Conhecimento", () => {
  const nucleo = clienteDoNucleo("wms", "ITAU");

  it("o texto, quem o agente considera (só a equipe, de saída) e salvar, que espera o texto", async () => {
    const html = comAgente(nucleo, <NewNote escrever={nucleo.anotacoes.escrever!} />);
    // As camadas do botão de ação (carregamento v2) ficam no DOM; só a atual fica na árvore de acessibilidade.
    expect(textosDaTela(html)).toEqual(["Nova anotação", "Cliente e equipe", "Só equipe", "Salvar", "Salvando…", "Salva", "Não salva", "Conferir"]);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Só equipe/);
    // Sem o texto, o Salvar fica travado sem sair da ordem do foco: aria-disabled, nunca disabled.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("só com o agente do núcleo", () => {
    expect(comAgente(nucleo, <AgentNotes />)).toContain("Nova anotação");
    expect(comAgente(CLIENTE_DO_WMS, <AgentNotes />)).not.toContain("Nova anotação");
  });
});
