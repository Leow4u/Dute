import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O "Conferir" da conclusão na bancada (carregamento v2, parte 11): ele só
 * relê a fila. Enquanto confere, o estado da conclusão continua sem resposta
 * e o diálogo recebe o `conferindo` à parte, para dizer "Conferindo…" sem
 * mostrar a conclusão andando de novo. A página inteira é pesada para montar
 * aqui; o diálogo com o `conferindo` tem o teste dele
 * (concluir-separacao.etapas.test.tsx).
 */

const FONTE = readFileSync(new URL("./pedidos-separar.tsx", import.meta.url), "utf8");

describe("o Conferir da conclusão na bancada", () => {
  it("conferindo não vira o andamento da conclusão", () => {
    const linha = FONTE.split("\n").find((texto) => texto.includes("const estadoDaConclusao"));
    expect(linha).toBeDefined();
    expect(linha).toContain("concluir.isPending");
    expect(linha).not.toContain("conferindo");
  });

  it("o diálogo recebe o conferindo", () => {
    expect(FONTE).toMatch(/<ConcluirSeparacaoDialog[\s\S]*?conferindo=\{conferindo\}[\s\S]*?\/>/);
  });
});
