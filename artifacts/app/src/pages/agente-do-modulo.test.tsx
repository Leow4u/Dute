import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ehTelaDoAgente, rotaDoAgente } from "@/lib/agente/navegacao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { AgenteNoModulo, SUGESTOES_DO_MODULO } from "./agente-do-modulo";

/**
 * O Agent Dute no shell de cada módulo (parte 5.5j): a conversa nova com as
 * perguntas do módulo, sem legenda (sem a frase de apresentação, sem as
 * dicas, sem a linha sob o campo e sem o anúncio do WhatsApp).
 */

const MODULOS = ["comercial", "operacao", "financeiro"] as const;

function tela(modulo: (typeof MODULOS)[number]) {
  const rota = rotaDoAgente(modulo);
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router ssrPath={rota}>
        <div className="v3">
          <AgenteNoModulo modulo={modulo} />
        </div>
      </Router>
    </QueryClientProvider>,
  );
}

describe("o Agent Dute em cada shell", () => {
  it("cada módulo tem a rota dele, e o shell dá a altura toda ao chat", () => {
    expect(MODULOS.map(rotaDoAgente)).toEqual(["/comercial/agente", "/operacao/agente", "/financeiro/agente"]);
    expect(["/agente", "/comercial/agente", "/operacao/agente?c=dute_1", "/financeiro/agente/"].every(ehTelaDoAgente)).toBe(true);
    expect(["/comercial", "/operacao/agenda", "/portal/agente"].some(ehTelaDoAgente)).toBe(false);
  });

  for (const modulo of MODULOS) {
    it(`${modulo}: a conversa nova com as perguntas do módulo, sem legenda e acessível`, async () => {
      const html = tela(modulo);
      expect(textosDaTela(html)).toEqual(["Nova conversa", "Rotinas", "Carregando…", "Agent Dute", "Como posso ajudar?", ...SUGESTOES_DO_MODULO[modulo].map((sugestao) => sugestao.prompt)]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    });
  }
});
