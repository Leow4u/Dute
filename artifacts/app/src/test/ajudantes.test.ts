import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "./acessibilidade";
import { textosDaTela, textosForaDaLista } from "./textos";

describe("ajudantes de teste das telas", () => {
  it("o axe acusa botão sem nome, imagem sem texto alternativo e campo sem rótulo", async () => {
    const violacoes = await violacoesDeAcessibilidade(
      '<main><button type="button"></button><img src="/x.png"><input type="text"></main>',
    );
    expect(violacoes.some((linha) => linha.startsWith("button-name"))).toBe(true);
    expect(violacoes.some((linha) => linha.startsWith("image-alt"))).toBe(true);
    expect(violacoes.some((linha) => linha.startsWith("label"))).toBe(true);
    expect(await violacoesDeAcessibilidade('<main><button type="button">Salvar</button></main>')).toEqual([]);
  });

  it("os textos da tela saem um por vez, sem repetir, e a lista acusa o que sobra", () => {
    const html = '<div><h1>Hoje</h1><p>Hoje</p><span class="sr-only">Minha conta</span><script>var x = "não";</script></div>';
    expect(textosDaTela(html)).toEqual(["Hoje", "Minha conta"]);
    expect(textosForaDaLista('<p>Para agendar</p><p>Use este quadro para organizar o dia.</p>', ["Para agendar"])).toEqual([
      "Use este quadro para organizar o dia.",
    ]);
    expect(textosForaDaLista("<p>faltam 4h40</p>", [/^faltam \d+h\d{2}$/])).toEqual([]);
  });
});
