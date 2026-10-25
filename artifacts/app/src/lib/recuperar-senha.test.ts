import { describe, expect, it } from "vitest";

import { MENSAGEM_DA_RECUPERACAO, problemaDaRecuperacao } from "./recuperar-senha";

describe("Esqueci minha senha", () => {
  it("sem e-mail, avisa o que falta; com e-mail, segue", () => {
    expect(problemaDaRecuperacao("")).toBe("Informe o e-mail para trocar a senha.");
    expect(problemaDaRecuperacao("   ")).toBe("Informe o e-mail para trocar a senha.");
    expect(problemaDaRecuperacao("renata@itau.com.br")).toBeNull();
  });

  it("o envio que deu certo e o que falhou têm mensagens diferentes, e só a de sucesso fala da recuperação", () => {
    // A tela de entrada pinta de vermelho a mensagem que não fala de "recuperação".
    expect(MENSAGEM_DA_RECUPERACAO.enviada).toContain("recuperação");
    expect(MENSAGEM_DA_RECUPERACAO.falhou).not.toContain("recuperação");
    expect(problemaDaRecuperacao("")).not.toContain("recuperação");
  });
});
