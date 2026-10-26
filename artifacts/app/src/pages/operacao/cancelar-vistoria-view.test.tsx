import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { CancelarVistoriaView } from "./cancelar-vistoria-view";

/** Cancelar vistoria (pergunta 58): o motivo, Voltar e Cancelar vistoria. Sem legenda. */

const noop = () => undefined;

function render(extra: Partial<Parameters<typeof CancelarVistoriaView>[0]> = {}) {
  return renderToStaticMarkup(
    <CancelarVistoriaView motivo="" onMotivo={noop} problema={null} erro={null} ocupado={false} onVoltar={noop} onCancelar={noop} {...extra} />,
  );
}

describe("Cancelar vistoria", () => {
  it("o título, o motivo com o rótulo e as duas ações", () => {
    const html = render({ motivo: "O local estava fechado" });
    expect(textosDaTela(html)).toEqual(["Cancelar vistoria", "Motivo", "O local estava fechado", "Voltar"]);
    expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Motivo<\/label><textarea[^>]*id="\1"/);
    expect(html).toContain('maxLength="200"');
  });

  it("o problema e o erro do servidor aparecem como alerta; ocupado trava as ações", () => {
    expect(render({ problema: "Informe o motivo do cancelamento." })).toMatch(/role="alert"[^>]*>Informe o motivo do cancelamento\./);
    expect(render({ erro: "A OS foi atualizada. Recarregue e tente de novo." })).toContain("A OS foi atualizada. Recarregue e tente de novo.");
    expect(render({ ocupado: true }).match(/disabled=""/g)).toHaveLength(2);
  });

  it("só rótulos, dados e ações", () => {
    expect(textosForaDaLista(render({ problema: "Informe o motivo do cancelamento." }), ["Cancelar vistoria", "Motivo", "Voltar", "Informe o motivo do cancelamento."])).toEqual([]);
  });

  it("passa no axe (WCAG 2.1 A e AA)", async () => {
    expect(await violacoesDeAcessibilidade(render({ problema: "Informe o motivo do cancelamento." }))).toEqual([]);
  });
});
